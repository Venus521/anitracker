// 豆瓣封面同源中转（Node.js HTTP Web 函数）v2 —— 2026-10-03 抗超时/抗风控升级
// 浏览器端无法直连豆瓣（rexxar 要 Referer→400，图床反盗链→418）。
// 本函数在云端起 Web Server：带移动端 UA+Referer 抓 rexxar 搜索 → 直抓签名原图字节同源返回（绕开 400/418），
// 前端 fetch 拿字节转 dataURL 离线存。仅接 ?q= 剧名，不接任意 URL，无开放代理风险。
//
// v1 教训（2026-10-02 版）：SCF 超时只配了 3 秒，而 403 退避(1.5+3+4.5s)与 12s 单请求超时远超预算，
// 豆瓣稍慢整个请求就被网关掐死（表现为 433）——「很多封面拉不到」的第一根因。
// v2 的三道闸：
//   ① 时间预算制：全程 14s 预算（部署 timeout 提到 20s），每步检查剩余预算，403 不再做长退避；
//   ② 失败负缓存：确认「真没有这部剧/图」的剧名缓存 10 分钟，批量补封面时第二遍立刻 404 跳过；
//      ——风控（403/超时）导致的失败绝不进负缓存，否则冷却后真有的也查不到；
//   ③ 403 全局冷却 + 外呼节流：连续 3 次 403 → 全实例冷却 90s（期间快速 503）；豆瓣外呼间隔 ≥1s。
const http = require('http');
const https = require('https');
const url = require('url');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15';
const REF = 'https://m.douban.com/';

const BUDGET_MS = 14000;      // 单请求总预算（部署 timeout=20s，留网关余量）
const SEARCH_TIMEOUT = 5000;  // 单次搜索超时
const IMG_TIMEOUT = 6000;     // 单次图片超时
const CALL_GAP = 1000;        // 豆瓣外呼最小间隔（实例级节流）

function get(u, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(u, { method: 'GET', headers, timeout: timeoutMs || SEARCH_TIMEOUT }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), ctype: res.headers['content-type'] || 'image/jpeg' }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 成功缓存：LRU 300 条 / 7 天（同剧名不打豆瓣） ----
const CACHE = new Map();
const CACHE_MAX = 300;
const CACHE_TTL = 7 * 24 * 3600 * 1000;
function cacheGet(k) {
  const v = CACHE.get(k);
  if (!v) return null;
  if (Date.now() - v.at > CACHE_TTL) { CACHE.delete(k); return null; }
  CACHE.delete(k); CACHE.set(k, v);
  return v;
}
function cacheSet(k, val) {
  if (CACHE.has(k)) CACHE.delete(k);
  CACHE.set(k, val);
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}

// ---- 失败负缓存：只存「确认没有」（no subject / 无封面），10 分钟 ----
const NEG = new Map();
const NEG_MAX = 200;
const NEG_TTL = 10 * 60 * 1000;
function negGet(k) {
  const v = NEG.get(k);
  if (!v) return false;
  if (Date.now() - v > NEG_TTL) { NEG.delete(k); return false; }
  return true;
}
function negSet(k) {
  if (NEG.has(k)) NEG.delete(k);
  NEG.set(k, Date.now());
  while (NEG.size > NEG_MAX) NEG.delete(NEG.keys().next().value);
}

// ---- 403 全局冷却：按「请求级」计数（一部剧全源 403 才算 1 次，别把 4 级策略叠成 4 次），
//      连续 5 次 → 45s 冷却；冷却期内未缓存请求快速 503（缓存命中照常回）。 ----
let coolUntil = 0;
let streak403 = 0;
function note403() { if (++streak403 >= 5) coolUntil = Date.now() + 45 * 1000; }
function noteOk() { streak403 = 0; }
const cooling = () => Date.now() < coolUntil;

// ---- 实例级外呼节流：相邻豆瓣请求间隔 ≥ CALL_GAP ----
let gate = Promise.resolve();
let lastCall = 0;
function throttled(fn) {
  const run = gate.then(async () => {
    const wait = Math.max(0, lastCall + CALL_GAP - Date.now());
    if (wait) await sleep(wait);
    lastCall = Date.now();
    return fn();
  });
  gate = run.catch(() => {});
  return run;
}

class RateLimited extends Error {}   // 403 need_login
class NotFound extends Error {}      // 确认豆瓣没有（进负缓存）

async function fetchJson(u, deadline) {
  // v2：403 不做长退避（烧预算还助长超时）——抛给上层换策略/计数
  const r = await get(u, { 'User-Agent': UA, Referer: REF, Accept: 'application/json' }, SEARCH_TIMEOUT);
  if (r.status === 200) return JSON.parse(r.body.toString('utf-8'));
  if (r.status === 403) throw new RateLimited('403 need_login');
  throw new Error('http ' + r.status);
}

// 多策略搜索：带地区 → 不带地区 → 不限 type。覆盖冷门/地区下架剧。每级检查时间预算。
async function searchSubject(name, deadline) {
  const q = encodeURIComponent(name);
  const strategies = [
    'https://m.douban.com/rexxar/api/v2/search?q=' + q + '&type=tv&loc_id=108288',
    'https://m.douban.com/rexxar/api/v2/search?q=' + q + '&type=tv',
    'https://m.douban.com/rexxar/api/v2/search?q=' + q + '&type=movie',
    'https://m.douban.com/rexxar/api/v2/search?q=' + q
  ];
  const tried = [];
  let saw403 = 0;
  for (const s of strategies) {
    if (Date.now() > deadline) throw new RateLimited('budget exhausted'); // 预算尽，按可重试失败处理
    try {
      const sd = await fetchJson(s, deadline);
      const items = ((sd.subjects || {}).items) || [];
      if (items.length) return items;
      tried.push('0 results');
    } catch (e) {
      tried.push(e.message);
      if (e instanceof RateLimited) saw403++;
      if (e instanceof RateLimited && cooling()) throw e;   // 已触发冷却：别再撞剩下的策略
      await sleep(600);
    }
  }
  if (saw403 > 0) { note403(); throw new RateLimited('403 need_login (' + saw403 + '/' + strategies.length + ' strategies)'); }
  throw new NotFound('no subject for ' + name + ' [' + tried.join('; ') + ']');
}

function pickCover(items, name) {
  // 优先标题完全相等，其次前 5 条
  const cand = [];
  for (const it of items) {
    const t = it.target || {};
    const c = t.cover_url || t.cover;
    if (c) cand.push({ title: t.title || '', cover: c, year: t.year || '' });
  }
  if (!cand.length) return null;
  const exact = cand.find((c) => c.title === name);
  if (exact) return exact.cover;
  const loose = cand.find((c) => c.title.includes(name) || name.includes(c.title));
  return (loose || cand[0]).cover;
}

// ---- ② subject_suggest 搜索（2026-10-03 实测新增）：rexxar 对部分剧名按查询弹 403 登录墙时，
//      movie.douban.com/j/subject_suggest 同 IP 同刻全部 200，返回 {title, img(s_ratio_poster), episode, url}。
//      作为第 0 级策略放在 rexxar 之前：更松、更快、带精确标题。 ----
async function suggestSubject(name, deadline) {
  if (Date.now() > deadline) throw new RateLimited('budget exhausted');
  const u = 'https://movie.douban.com/j/subject_suggest?q=' + encodeURIComponent(name);
  const r = await get(u, { 'User-Agent': UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' }, SEARCH_TIMEOUT);
  if (r.status === 403) throw new RateLimited('403 need_login (suggest)');
  if (r.status !== 200) throw new Error('suggest http ' + r.status);
  let arr;
  try { arr = JSON.parse(r.body.toString('utf-8')); } catch (e) { throw new Error('bad suggest json'); }
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => ({ title: String(x.title || ''), cover: String(x.img || ''), ep: String(x.episode || '') }))
            .filter((x) => x.cover);
}

function pickSuggestCover(arr, name) {
  if (!arr.length) return null;
  const exact = arr.filter((x) => x.title === name);            // 标题完全相等优先
  const pool = exact.length ? exact : arr;
  return (pool.find((x) => x.ep) || pool[0]).cover;             // 再要带集数字段（剧集标志），否则取第一个
}

async function doubanCover(name, deadline) {
  const hit = cacheGet(name);
  if (hit) return { bytes: hit.buf, ctype: hit.ctype, hit: true };
  if (cooling()) throw new RateLimited('cooling down');      // 冷却期严格止损：缓存命中照常回，未缓存不再外呼
  if (negGet(name)) throw new NotFound('known miss (negative cached)');

  // 第 0 级：subject_suggest（对 rexxar 被 403 的剧名也能 200，见 pickSuggestCover 注）
  let cover = null;
  try {
    const arr = await throttled(() => suggestSubject(name, deadline));
    cover = pickSuggestCover(arr, name);
  } catch (e) { /* suggest 失败静默，继续 rexxar */ }

  // rexxar 4 级回退（带地区 → 不带地区 → 不限 type）
  if (!cover) {
    const items = await throttled(() => searchSubject(name, deadline));
    cover = pickCover(items, name);
  }
  if (!cover) { negSet(name); throw new NotFound('no cover for ' + name); }

  // 升级到原图：view/photo/s_ratio_poster 路径 → l_ratio（约 470KB，200 实测）；旧路径用 _[a-z] 尺寸后缀正则
  const big1 = cover.replace('s_ratio_poster', 'l_ratio_poster');
  const big2 = cover.replace(/_[a-z]\.(jpg|webp|png)$/i, '_b.jpg');
  let img = null;
  for (const c of [big1, cover, big2]) {
    if (Date.now() > deadline) break;
    try {
      const r = await get(c, { 'User-Agent': UA, Referer: 'https://movie.douban.com/' }, IMG_TIMEOUT);
      if (r.status === 200 && r.body.length > 1000) { img = r; break; }
    } catch (e) { /* try next */ }
  }
  if (!img) throw new NotFound('cover fetch failed for ' + name);

  noteOk();
  const out = { buf: img.body, ctype: img.ctype, at: Date.now() };
  cacheSet(name, out);
  return { bytes: out.buf, ctype: out.ctype, hit: false };
}

const PORT = process.env.PORT || 9000;
const server = http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  // 兜底：无论如何 19s 内必须给响应（部署 timeout 20s，别让网关代杀）
  const killer = setTimeout(() => { try { res.writeHead(502, cors); res.end('{"error":"hard deadline"}'); } catch (e) {} }, 19000);
  try {
    const q = url.parse(req.url, true).query.q || '';
    const name = decodeURIComponent(q).trim();
    if (!name) {
      clearTimeout(killer);
      res.writeHead(400, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
      return res.end(JSON.stringify({ error: 'need q' }));
    }
    const deadline = Date.now() + BUDGET_MS;
    const { bytes, ctype, hit } = await doubanCover(name, deadline);
    clearTimeout(killer);
    res.writeHead(200, Object.assign({
      'Content-Type': ctype,
      'Cache-Control': 'public, max-age=604800, immutable',
      'X-Cache-Hit': hit ? '1' : '0'
    }, cors));
    res.end(bytes);
  } catch (e) {
    clearTimeout(killer);
    if (e instanceof NotFound) {
      // 确认没有：404 让前端立刻退下一路源（TVMaze/TMDB/Wikidata/本地），不空等
      res.writeHead(404, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
      return res.end(JSON.stringify({ error: 'no subject' }));
    }
    if (e instanceof RateLimited || cooling()) {
      // 限流（无论是否已进入冷却）：503 + Retry-After，语义是「可重试」，前端立刻退下一路源
      res.writeHead(503, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '45' }, cors));
      return res.end(JSON.stringify({ error: 'douban rate limited' }));
    }
    res.writeHead(502, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
    res.end(JSON.stringify({ error: 'douban fail: ' + e.message }));
  }
});
server.listen(PORT, '0.0.0.0', () => console.log('douban-relay v2 listening on ' + PORT));
