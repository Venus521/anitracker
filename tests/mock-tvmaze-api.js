/* mock-tvmaze-api.js — 回归测试用的「全网库」本地替身（127.0.0.1:8093）· v2.17.0
   为什么要它：真站在测试里不可靠（免费公共 API 会限流、会改数据），
   而门禁要断言的是「本页面拿到这份数据后的行为」，所以把响应固定下来。
   路由与 TVMaze 一致（页面里 WAPI 被请求改写规则指到本机）：
     GET /search/shows?q=KW&limit=20   → [{score,show},…]
     GET /shows/:id                    → show
     GET /shows/:id/episodes           → [episode,…]
     GET /shows/:id/akas               → [{name,country},…]（v2.36.0：刷名找中文名用）
     GET /cover/:id.jpg                → 1x1 JPEG（封面自愈用例要能真的解码）
   控制端点：GET /__state · POST /__ctl {mode,target,reset}
   故障模式：ok | http500 | http404 | hang（hang=不回包，用来验 4 秒超时）
   条目：900001 双季动画（2×12 集）· 900002 无分集（未开播）·
        900003 Friends 真人剧（3 季 ×5 集，中文「老友记」要靠别名表命中）·
        900004 单季动画（12 集，用来验证「单季不出季度条」）·
        900005 中文剧（language=Chinese，name 是外文名、真名在 akas 的 CN 条目——
        复刻 TVMaze 对《刁蛮公主》的真实形态，v2.36.0 刷名铁律用例专用） */
const http = require('http');
const PORT = 8093;
const STATE = { mode: 'ok', target: 'all' };
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64');
const COVER_URL = id => 'http://127.0.0.1:' + PORT + '/cover/' + id + '.jpg';

function mkEps(showId, seasons, per) {
  const out = []; let n = 1;
  for (let s = 1; s <= seasons; s++) {
    for (let e = 1; e <= per; e++) {
      out.push({
        id: showId * 1000 + n, name: 'Episode ' + n,
        season: s, number: e, runtime: 24, airdate: '2026-0' + s + '-0' + (e < 10 ? e : 9),
        show: { id: showId }
      });
      n++;
    }
  }
  return out;
}
const SHOWS = {
  '900001': { id: 900001, name: 'Mock Anime (Test)', type: 'Anime', language: 'Japanese', genres: ['Animation', 'Comedy'], status: 'Running', runtime: 24, premiered: '2026-01-01', image: { medium: COVER_URL('900001'), original: COVER_URL('900001') }, url: 'https://www.tvmaze.com/shows/900001/mock-anime' },
  '900002': { id: 900002, name: 'Empty Show (Test)', type: 'Scripted', language: 'English', genres: ['Drama'], status: 'To Be Determined', runtime: 30, premiered: '2027-01-01', image: { medium: '', original: '' }, url: 'https://www.tvmaze.com/shows/900002/empty-show' },
  '900003': { id: 900003, name: 'Friends', type: 'Scripted', language: 'English', genres: ['Comedy', 'Romance'], status: 'Ended', runtime: 30, premiered: '1994-09-22', image: { medium: COVER_URL('900003'), original: COVER_URL('900003') }, url: 'https://www.tvmaze.com/shows/900003/friends' },
  '900004': { id: 900004, name: 'Single Season Show (Test)', type: 'Anime', language: 'Japanese', genres: ['Animation'], status: 'Ended', runtime: 24, premiered: '2026-04-01', image: { medium: COVER_URL('900004'), original: COVER_URL('900004') }, url: 'https://www.tvmaze.com/shows/900004/single' },
  '900005': { id: 900005, name: 'Mock Cn Show (Test)', type: 'Scripted', language: 'Chinese', genres: ['Drama', 'Comedy'], status: 'Ended', runtime: 45, premiered: '2016-03-01', image: { medium: COVER_URL('900005'), original: COVER_URL('900005') }, url: 'https://www.tvmaze.com/shows/900005/mock-cn-show' }
};
const EPS = {
  '900001': mkEps(900001, 2, 12),
  '900002': [],
  '900003': mkEps(900003, 3, 5),
  '900004': mkEps(900004, 1, 12),
  '900005': mkEps(900005, 1, 10)
};
/* v2.36.0：别名表。拼音条目故意排在前——刷名必须认「国家=CN 且名含 CJK」，
   把拼音（Diao Man Gong Zhu 这类）当中文名算事故 */
const AKAS = {
  '900005': [
    { name: 'Mock Pinyin Show', country: { name: 'China', code: 'CN', timezone: 'Asia/Shanghai' } },
    { name: '气泡公主（测试）', country: { name: 'China', code: 'CN', timezone: 'Asia/Shanghai' } }
  ]
};
/* 关键词 → 条目 id：故意让中文词命不中，逼着页面走别名表（真实 TVMaze 就这样） */
const BY_KEYWORD = {
  mock: ['900001'], anime: ['900001'], empty: ['900002'],
  friends: ['900003'], 'single': ['900004']
};
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}
function send(res, code, obj) {
  cors(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj || {}));
}
function readBody(req) {
  return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); });
}
const CODES = { http500: 500, http404: 404 };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const p = u.pathname;
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (p === '/__state') return send(res, 200, STATE);
  if (p === '/__ctl') {
    const b = await readBody(req);
    if (b.mode !== undefined) STATE.mode = b.mode;
    if (b.target !== undefined) STATE.target = b.target;
    return send(res, 200, STATE);
  }
  const tgt = STATE.target === 'all' ? '' : STATE.target;
  if (STATE.mode !== 'ok' && (!tgt || p.includes(tgt))) {
    if (STATE.mode === 'hang') return;
    if (CODES[STATE.mode]) return send(res, CODES[STATE.mode], { error: 'mock ' + STATE.mode });
  }
  if (p.startsWith('/cover/')) {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': TINY_JPEG.length });
    return res.end(TINY_JPEG);
  }
  if (p === '/__douban_suggest') {
    /* v2.29.0：豆瓣联想替身——mode=suggest 走这里（regression 拦截器也直接 respond，两路都备） */
    const q = String(u.searchParams.get('q') || '').trim();
    return send(res, 200, { items: q ? [{ title: 'Mock 国产剧 (豆瓣)', img: '', episode: '12', year: '2026', url: 'https://movie.douban.com/subject/99000001/?suggest=' + encodeURIComponent(q) }] : [] });
  }
  if (p === '/search/shows') {
    const q = String(u.searchParams.get('q') || '').trim().toLowerCase();
    const ids = BY_KEYWORD[q] || [];
    return send(res, 200, ids.map(id => ({ score: 0.99, show: SHOWS[id] })));
  }
  let m = p.match(/^\/shows\/(\d+)\/episodes$/);
  if (m) return send(res, 200, EPS[m[1]] || []);
  m = p.match(/^\/shows\/(\d+)\/akas$/);
  if (m) return send(res, 200, AKAS[m[1]] || []);
  m = p.match(/^\/shows\/(\d+)$/);
  if (m) return SHOWS[m[1]] ? send(res, 200, SHOWS[m[1]]) : send(res, 404, { error: 'no show' });
  return send(res, 404, { error: 'not found', path: p });
});
server.listen(PORT, '127.0.0.1', () => console.log('mock tvmaze api on :' + PORT));
