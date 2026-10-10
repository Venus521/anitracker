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
// v2.45.0：info 与封面各存各处（封面是大字节、走 120 条上限；info 只有几百字节，允许 300 条）
const INFO = new Map();
const CACHE = new Map();
/* v2.44.0：图从 ~5KB 涨到 ~120KB（见 upscaleCover），300 条就是 35MB，云函数内存吃不消。
   120 条 ≈ 14MB，够一轮批量补齐反复命中，也不会把实例撑爆。 */
const CACHE_MAX = 120;
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
/* v2.46.2：冷却**不许续期**。
   老写法是 `if (++streak403 >= 5) coolUntil = now + 45s`——一旦过了 5 次，
   **每一个** 403 都把冷却再往后推 45 秒。而真实流量是持续的（一键拉封面一口气几百部、
   详情页每次打开都问一次时长），于是「冷却 → 快速失败 → 客户端再问 → 又 403 → 再续 45s」
   **永远出不来**。实测（2026-10-08 23:2x）：连打 3 轮 info，前两轮都是
   `{"found":false,"reason":"cooling down"}`，第三轮才通——他那边看到的就是
   「时长还是估的、封面还是一片灰」，而函数这边其实一直活着，只是把门关着。
   现在：只在**没在冷却**时才计数，触发一次即清零；冷却期内 403 一律不再延期。 */
function note403() {
  if (cooling()) return;                 // 已经在冷却：别再往后推
  if (++streak403 >= 5) { coolUntil = Date.now() + 45 * 1000; streak403 = 0; }
}
function noteOk() { streak403 = 0; }
const cooling = () => Date.now() < coolUntil;
/* 冷却还剩多久：随失败响应一起回给客户端，让它知道「等一会儿再来」而不是「这部剧没有」 */
const coolMs = () => Math.max(0, coolUntil - Date.now());

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

/* v2.44.0：豆瓣进了自动补封面的链路（App 端 healCoverFor 不再只在手动时才调它），
   「一条都对不上就拿第一条」这条兜底必须收紧——自动场景下它等价于往片单里塞张错图，
   而本项目的老教训是「错封面比没封面更糟」（v2.14.0g，《海贼王》被换成水墨错图）。
   现在只认三种：标题完全相等 / 互相包含（庆余年 → 庆余年 第一季）/ 只搜到一条（无从歧义）。
   对不上就抛 NotFound → 前端立刻退下一路源，并进负缓存，下一轮不再白跑。 */
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
  if (loose) return loose.cover;
  if (cand.length === 1) return cand[0].cover;
  throw new NotFound('no title match for ' + name + ' (' + cand.length + ' candidates)');
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
/* suggest 返回的原始项里有 id（v2.45.0 起带上——详情接口的门票）。
   以前只留 title/img/ep/year/url，拿到字也换不到详情页那张卷上去。 */
  return arr.map((x) => ({ title: String(x.title || ''), cover: String(x.img || ''), ep: String(x.episode || ''),
                          year: String(x.year || ''), url: String(x.url || ''), id: String(x.id || '') }))
            .filter((x) => x.cover);
}

/* ===== v2.45.0 info 模式：同一次详情把「单集时长 / 类型 / 集数 / 封面」全量带回 =====
   起因：用户反复说「很多剧和番你自动拉的时长不对啊，都说了要看豆瓣」。
   v2.44.6 当时写下的结论是「豆瓣联想这条路压根没有格式信号、词条页是登录墙壳，免费源补不上」，
   所以那一版只做了「把假设摊开 + 给手填出口」。这套记账至今没改错，但它把探测停在了 suggest 那一层。
   实测（2026-10-08，同一台机器、同一份 UA/Referer）：
     suggest 拿到 id → rexxar 详情 /v2/tv/{id} 或 /v2/movie/{id} → 200，
     大宋提刑官 durations=["45分钟"] episodes_count=52 type=tv
     漫长的季节 durations=["60分钟"] / 武林外传 ["48分钟"] / 肖申克的救赎(movie) ["142分钟"]
   **豆瓣恰恰有这道题的正确答案**，只是它不在搜索层，在详情层。
   规矩沿用 pickCover 那条：名字对不上就不许出数——错时长比估时长更糟，它会让人信以为真。 */
function normName(s) {
  return String(s || '').replace(/[\s\u3000·・:：!！?？\-—_….,，'"“”()（）[\]【】<>《》]/g, '').toLowerCase();
}
function parseDurMin(arr) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  const m = String(arr[0] || '').match(/(?:(\d+)\s*小时)?\s*(\d+)\s*分钟/);
  if (!m) return 0;
  const v = (Number(m[1] || 0) * 60) + Number(m[2] || 0);
  return (v > 0 && v <= 600) ? v : 0;   /* 越界的脏数不许冒充实测（与前端 durOf 同一条线） */
}
// 一个 id 可能是剧也可能是电影：两条路问过来，谁回数据认谁。
// 注意：这里**不能**再套一层 throttled()——外层 doubanInfo/doubanCover 已经在同一种节流里，
// 嵌套会让内层等外层那张 gate（它要等内层跑完才 settle），两边互等即死锁（实测 19s 硬超时挂死）。
// 现有代码里 suggestSubject / searchSubject 的 fetch 都是**裸调用**，同一条规矩。
async function subjectDetail(id, deadline) {
  for (const api of ['tv', 'movie']) {
    if (Date.now() > deadline) throw new RateLimited('budget exhausted');
    try {
      const d = await fetchJson('https://m.douban.com/rexxar/api/v2/' + api + '/' + id, deadline);
      if (d && (d.id || d.title)) return d;
    } catch (e) {
      if (e instanceof RateLimited) throw e;      // 预算/风控：不换策略，直接交上层
      /* 其余（404/坏 JSON）换下一路 */
    }
  }
  return null;
}
const INFO_TTL = 7 * 24 * 3600 * 1000;
const INFO_MAX = 300;
async function doubanInfo(name, deadline) {
  const key = 'info:' + name;
  const c = INFO.get(key);
  if (c && Date.now() - c.at < INFO_TTL) { INFO.delete(key); INFO.set(key, c); return c.val; }
  if (cooling()) throw new RateLimited('cooling down');
  if (negGet(key)) throw new NotFound('known miss (info)');

  // 第 0 级：suggest（便宜、带 id）；只有**标题全等**的那条才配拿 id
  let picked = null;
  try {
    const arr = await throttled(() => suggestSubject(name, deadline));
    picked = arr.find((x) => normName(x.title) === normName(name) && x.id) || null;
  } catch (e) { /* suggest 失败静默，继续 rexxar 搜索 */ }

  // 第 1 级：rexxar 搜索（suggest 里没有完全同名时用），同样只认全等的那条
  if (!picked) {
    try {
      const items = await throttled(() => searchSubject(name, deadline));
      for (const it of items) {
        const t = it.target || {};
        if (normName(t.title) === normName(name) && t.id) { picked = { id: String(t.id), title: t.title }; break; }
      }
    } catch (e) { if (e instanceof RateLimited) throw e; }
  }
  if (!picked || !picked.id) { negSet(key); throw new NotFound('no subject for ' + name); }

  const d = await subjectDetail(picked.id, deadline);
  if (!d) { negSet(key); throw new NotFound('no detail for ' + name); }
  /* 只认名字全等的记录：搜索可以给《怪奇物语》回《怪奇物语 第五季》（78 分钟/8 集），
     把那个数写进「怪奇物语」整部＝凭空造错账。这一关是刻意的，不放松成包含匹配。 */
  if (normName(d.title) !== normName(name)) { negSet(key); throw new NotFound('title mismatch: ' + d.title); }

  const val = {
    found: true, title: d.title, id: picked.id,
    type: String(d.type || d.subtype || ''),
    dur: parseDurMin(d.durations),
    eps: Number(d.episodes_count) || 0,
    genres: Array.isArray(d.genres) ? d.genres.slice(0, 8) : [],
    year: String(d.year || ''),
    cover: String(d.cover_url || '')
  };
  INFO.set(key, { at: Date.now(), val });
  if (INFO.size > INFO_MAX) INFO.delete(INFO.keys().next().value);
  noteOk();
  return val;
}

function pickSuggestCover(arr, name) {
  if (!arr.length) return null;
  const exact = arr.filter((x) => x.title === name);            // 标题完全相等优先
  const pool = exact.length ? exact : arr;
  const hit = pool.find((x) => x.ep) || pool[0];                // 再要带集数字段（剧集标志），否则取第一个
  if (!hit) return null;
  // v2.44.0：与 pickCover 同一条规矩——没对上剧名就不许出图（理由见 pickCover 注）
  if (hit.title !== name && hit.title.indexOf(name) < 0 && name.indexOf(hit.title) < 0 && arr.length !== 1) return null;
  return hit.cover;
}

/* v2.44.0：rexxar 给的封面 URL 自带 imageView2 缩放指令
   （...&imageView2/0/q/80/w/9999/h/120/format/jpg），等于豆瓣自己就把图压成了 120px 的邮票，
   前端再按 200×300 转存，存下来的是一张被放大的糊图——「封面全都有，就是看着糊」的根因。
   修法只改尺寸指令、签名原样保留：
     · sa_cv / sa_ct 是签名，去掉或换路径（view/photo/l、raw）一律回 12 字节的错误体；
     · 把 /h/<N> 改成 /h/600 实测 120×169/5KB → 600×846/117KB（庆余年），三倍超采样，
       压成 200×300 后边缘干净；再往上（h/800，208KB）画质增益已经看不出来，
       但云函数内存里的字节缓存会跟着翻番，故停在 600。
   suggest 通道给的是 s_ratio_poster 小图，仍走「换 l_ratio_poster」那条老路。 */
function upscaleCover(u) {
  if (!u) return u;
  if (u.indexOf('imageView2') >= 0) return u.replace(/\/h\/\d+/, '/h/600');
  /* v2.45.0：详情页给的 m_ratio_poster 是手机列表上的小图（约 3:4 小尺寸），
     换成同一张图的 l_ratio_poster 原尺寸 */
  if (u.indexOf('m_ratio_poster') >= 0) return u.replace('m_ratio_poster', 'l_ratio_poster');
  return u;
}

async function doubanCover(name, deadline, id) {
  const hit = cacheGet(name);
  if (hit) return { bytes: hit.buf, ctype: hit.ctype, hit: true };
  if (cooling()) throw new RateLimited('cooling down');      // 冷却期严格止损：缓存命中照常回，未缓存不再外呼
  if (negGet(name)) throw new NotFound('known miss (negative cached)');

  // v2.45.0：已知准确的词条 id 时直接进详情取图——省掉 suggest + 四级搜索那一串，
  // 一条巨贵的链路压成一次请求。id 来自 info 模式那一次「名字全等」的核对（没核对过不会有 id）。
  let cover = null;
  if (id) {
    try {
      const d = await subjectDetail(id, deadline);
      cover = (d && (d.cover_url || d.cover)) || null;
    } catch (e) { cover = null; }   // id 那条路失败就退回老的去 chip 链
  }

  // 第 0 级：subject_suggest（对 rexxar 被 403 的剧名也能 200，见 pickSuggestCover 注）
  if (!cover) {
    try {
      const arr = await throttled(() => suggestSubject(name, deadline));
      cover = pickSuggestCover(arr, name);
    } catch (e) { /* suggest 失败静默，继续 rexxar */ }
  }

  // rexxar 4 级回退（带地区 → 不带地区 → 不限 type）
  if (!cover) {
    const items = await throttled(() => searchSubject(name, deadline));
    try { cover = pickCover(items, name); }
    catch (e) { if (e instanceof NotFound) negSet(name); throw e; }   // 对不上剧名＝确认没有，进负缓存
  }
  if (!cover) { negSet(name); throw new NotFound('no cover for ' + name); }

  // 升级到大图，三条路按 URL 形态挑一条（见 upscaleCover 注）
  const big1 = upscaleCover(cover);
  const big2 = cover.replace('s_ratio_poster', 'l_ratio_poster');   // 旧形态兜底（约 470KB，200 实测）
  let img = null;
  for (const c of [big1, big2, cover]) {
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

// ---- 2026-10-11 审计加固（B1）----
// CORS 不再 `*`：端点 URL 公开写在前端规则里，`*` 等于任何网页都能白嫖这个函数烧配额、
// 借道爬豆瓣，还把 403 冷却烧到正常用户头上。改为按来源白名单回显：自家页面会出现的
// 全部来源（本机/局域网 :8089、file:// 的 null、GitHub Pages、CloudBase 托管域、APK 内
// LocalServer 的 127.0.0.1）。白名单外不回 ACAO——浏览器自己拦；服务端间调用不看这个头。
function corsHeaders(req) {
  const o = String(req.headers.origin || '');
  let allow = '';
  if (o === 'null') {
    allow = 'null';
  } else if (o) {
    try {
      const u = new url.URL(o);
      const h = u.hostname;
      const lanPage = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) && u.port === '8089';
      if ((h === '127.0.0.1' || h === 'localhost' || lanPage ||
           h.endsWith('.tcloudbaseapp.com') || o === 'https://venus521.github.io') &&
          (u.protocol === 'https:' || u.protocol === 'http:')) {
        allow = o;
      }
    } catch (e) { allow = ''; }
  }
  return allow
    ? { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET,OPTIONS', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

// 每 IP 轻量限流（实例级；SCF 多实例各管各的，够把无脑白嫖挡在外面，正常批量补封面
// 有 1s 外呼节流排着队，远摸不到这条线）。240 次/分钟，超了 429 + Retry-After。
const RPM = new Map();
const RPM_MAX = 240;
const RPM_WIN = 60000;
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket.remoteAddress || '?';
}
function overRate(ip) {
  const now = Date.now();
  const v = RPM.get(ip) || { n: 0, t: now };
  if (now - v.t > RPM_WIN) { v.n = 0; v.t = now; }
  v.n++;
  RPM.set(ip, v);
  if (RPM.size > 5000) RPM.clear();
  return v.n > RPM_MAX;
}
// 重复 query 参数会让 parse 出数组（审计 B5），只认第一个
const one = (v) => (Array.isArray(v) ? String(v[0] || '') : String(v || ''));

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (overRate(clientIp(req))) {
    res.writeHead(429, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '30' }, cors));
    return res.end(JSON.stringify({ error: 'rate limited' }));
  }
  // 兜底：无论如何 19s 内必须给响应（部署 timeout 20s，别让网关代杀）
  const killer = setTimeout(() => { try { res.writeHead(502, cors); res.end('{"error":"hard deadline"}'); } catch (e) {} }, 19000);
  try {
    const name = decodeURIComponent(one(url.parse(req.url, true).query.q)).trim();
    if (!name) {
      clearTimeout(killer);
      res.writeHead(400, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
      return res.end(JSON.stringify({ error: 'need q' }));
    }
    // —— 联想模式（v2.29.0）：?q=剧名&mode=suggest → JSON 条目（title/img/episode/year/url）。
    //    给添加页搜索第四区「豆瓣联想」用：中文国产剧在英文库经常 0 结果，这里直接给豆瓣标准名。
    //    联想是锦上添花：任何失败都回 200 + 空列表，前端不等它。 ----
    if (one(url.parse(req.url, true).query.mode) === 'suggest') {
      try {
        const arr = await suggestSubject(name, Date.now() + BUDGET_MS);
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' }, cors));
        return res.end(JSON.stringify({ items: arr.slice(0, 8).map((x) => ({ title: x.title, img: x.cover, episode: x.ep, year: x.year, url: x.url })) }));
      } catch (e) {
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
        return res.end(JSON.stringify({ items: [] }));
      }
    }
    // —— 详情模式（v2.45.0）：?mode=info&q=剧名 → 单集时长 / 类型 / 集数 / 封面一次带回。
    //    这是「自动拉的时长不对」的正解：豆瓣的分钟数在详情层，不在搜索层（见 doubanInfo 注）。
    //    失败一律 200 + found:false：它不是网络错误，是「这部剧查不到 / 名字没对上」，
    //    前端拿到就静默退下一路源，不许把它当成 Promise 失败抛到界面上。 ----
    if (one(url.parse(req.url, true).query.mode) === 'info') {
      try {
        const v = await doubanInfo(name, Date.now() + BUDGET_MS);
        clearTimeout(killer);
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, cors));
        return res.end(JSON.stringify(v));
      } catch (e) {
        clearTimeout(killer);
        /* v2.46.2：把「限流」和「这部剧查不到」分开说。
           两者原来都是 `found:false`，前端一视同仁地写进负缓存——于是「豆瓣那 45 秒」
           被他记成了「这部剧没有时长」，整个会话再也不问。冷却时附上 coolMs 让它能等。 */
        const limited = (e instanceof RateLimited) || cooling();
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
        return res.end(JSON.stringify({ found: false, reason: String((e && e.message) || e),
          limited: limited, coolMs: limited ? coolMs() : 0 }));
      }
    }
    const q2 = url.parse(req.url, true).query;
    const deadline = Date.now() + BUDGET_MS;
    // id 与本机 db_info_rules.id_ok 同一把尺（审计 B3）：^5~9位纯数字$，不合就当没给——
    // 否则 `id=../../...` 能在同主机内做路径注入。
    const rawId = one(q2.id).trim();
    const coverId = /^[0-9]{5,9}$/.test(rawId) ? rawId : '';
    const { bytes, ctype, hit } = await doubanCover(name, deadline, coverId);
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
      // v2.46.2：带上真实剩余毫秒——前端据此排重试，而不是把这一部锁进 2 小时退避表。
      const ms = Math.max(5000, coolMs());
      res.writeHead(503, Object.assign({ 'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(Math.ceil(ms / 1000)) }, cors));
      return res.end(JSON.stringify({ error: 'douban rate limited', coolMs: ms }));
    }
    res.writeHead(502, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
    // 细节只进实例日志，不外吐上游错误内幕（审计 B4）
    console.log('douban fail:', (e && e.message) || e);
    res.end(JSON.stringify({ error: 'douban upstream error' }));
  }
});
server.listen(PORT, '0.0.0.0', () => console.log('douban-relay v2 listening on ' + PORT));
