/* mock-bgm-api.js — AniTracker 回归测试用本地 Bangumi API 模拟器（127.0.0.1:8092）· v2.6.0
   控制端点：GET /__state · POST /__ctl {mode,target,reset} · POST /__seed {collections}
   故障模式：ok | http429 | http500 | http404 | authfail | hang
   条目：900001=模拟番（12集）· 900002=空条目番（0集）· 900003=模拟番 第二季（8集）· 900004=模拟番 剧场版（1集）
   → 搜索"模拟番"会得到同系列 3 部 + 单独 1 部，用于分季分组断言
   v2.6.0 新增：条目封面端点 /cover/{id}.jpg（1x1 JPEG），用于封面自愈用例 */
const http = require('http');
const PORT = 8092;
const STATE = { mode: 'ok', target: 'all', collections: {} };
function mkEps(prefix, n) { const a = []; for (let i = 1; i <= n; i++) a.push({ id: prefix + i, sort: String(i), name: '第 ' + i + ' 集', name_cn: '第 ' + i + ' 集', type: 0 }); return a; }
const EPS_BY_SID = { '900001': mkEps('90000000', 12), '900003': mkEps('90000300', 8), '900004': mkEps('90000400', 1) };
/* 1x1 白色 JPEG（有效可解码） */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64');
const COVER_URL = id => 'http://127.0.0.1:8092/cover/' + id + '.jpg';
const SUBJECTS = {
  '900001': { id: 900001, name: 'mock anime (test)', name_cn: '模拟番（测试）', date: '2026-01-01', type: 2, eps: 12, total_episodes: 12, images: { common: COVER_URL('900001') }, summary: '本地模拟条目' },
  '900002': { id: 900002, name: 'empty subject (test)', name_cn: '空条目番（无剧集）', date: '2026-10-01', type: 2, eps: 0, total_episodes: 0, images: { common: '' }, summary: '未开播/未录入剧集的条目' },
  '900003': { id: 900003, name: 'mock anime S2', name_cn: '模拟番 第二季', date: '2026-07-01', type: 2, eps: 8, total_episodes: 8, images: { common: COVER_URL('900003') }, summary: '同系列第二季' },
  '900004': { id: 900004, name: 'mock anime movie', name_cn: '模拟番 剧场版', date: '2025-12-01', type: 2, eps: 1, total_episodes: 1, images: { common: COVER_URL('900004') }, summary: '同系列剧场版' }
};
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}
function send(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj || {})); }
function readBody(req) { return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); }); }
const CODES = { http429: 429, http500: 500, http404: 404, authfail: 401 };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const p = u.pathname;
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (p === '/__state') return send(res, 200, STATE);
  if (p === '/__ctl') { const b = await readBody(req); if (b.mode !== undefined) STATE.mode = b.mode; if (b.target !== undefined) STATE.target = b.target; if (b.reset) STATE.collections = {}; return send(res, 200, STATE); }
  if (p === '/__seed') { const b = await readBody(req); if (b.collections) STATE.collections = b.collections; return send(res, 200, STATE); }
  const tgt = STATE.target === 'all' ? '' : STATE.target;
  if (STATE.mode !== 'ok' && (!tgt || p.includes(tgt))) {
    if (STATE.mode === 'hang') return;
    if (CODES[STATE.mode]) return send(res, CODES[STATE.mode], { title: 'mock-' + STATE.mode, description: 'injected fault' });
  }
  /* v2.6.0：封面端点（JPEG），支持 CORS */
  if (p.startsWith('/cover/')) {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': TINY_JPEG.length });
    return res.end(TINY_JPEG);
  }
  const auth = req.headers['authorization'] || '';
  const okAuth = auth === 'Bearer good-token';
  if (p === '/v0/me') { if (!okAuth) return send(res, 401, { title: 'Unauthorized', description: 'invalid token' }); return send(res, 200, { id: 1, username: 'tester', nickname: '测试用户', sign: 'mock' }); }
  if (p === '/v0/search/subjects' && req.method === 'POST') {
    return send(res, 200, { data: [
      { id: 900001, name: 'mock anime (test)', name_cn: '模拟番（测试）', date: '2026-01-01', type: 2, eps: 12, total_episodes: 12, images: { common: COVER_URL('900001') } },
      { id: 900002, name: 'empty subject (test)', name_cn: '空条目番（无剧集）', date: '2026-10-01', type: 2, eps: 0, total_episodes: 0, images: { common: '' } },
      { id: 900003, name: 'mock anime S2', name_cn: '模拟番 第二季', date: '2026-07-01', type: 2, eps: 8, total_episodes: 8, images: { common: COVER_URL('900003') } },
      { id: 900004, name: 'mock anime movie', name_cn: '模拟番 剧场版', date: '2025-12-01', type: 2, eps: 1, total_episodes: 1, images: { common: COVER_URL('900004') } }
    ] });
  }
  if (p.startsWith('/v0/subjects/')) { const id = p.split('/').pop(); if (SUBJECTS[id]) return send(res, 200, SUBJECTS[id]); return send(res, 404, { title: 'Not Found' }); }
  if (p === '/v0/episodes') { const sid = u.searchParams.get('subject_id'); return send(res, 200, { data: EPS_BY_SID[sid] || [] }); }
  if (!okAuth) return send(res, 401, { title: 'Unauthorized', description: 'invalid token' });
  let m = p.match(/^\/v0\/users\/-\/collections\/(\d+)\/episodes$/);
  if (m) {
    const sid = m[1]; const col = STATE.collections[sid];
    if (req.method === 'GET') {
      if (!col) return send(res, 200, { data: [] });
      return send(res, 200, { data: Object.keys(col.eps || {}).map(eid => ({ type: col.eps[eid], episode: { id: +eid } })) });
    }
    if (req.method === 'PATCH') {
      const b = await readBody(req); if (!col) return send(res, 400, { title: 'collection not found' });
      (b.episode_id || []).forEach(eid => { col.eps = col.eps || {}; col.eps[String(eid)] = b.type; });
      return send(res, 200, { detail: 'ok', count: (b.episode_id || []).length });
    }
  }
  m = p.match(/^\/v0\/users\/-\/collections\/-\/episodes\/(\d+)$/);
  if (m && req.method === 'PUT') {
    const eid = m[1]; const b = await readBody(req);
    for (const sid of Object.keys(STATE.collections)) {
      const col = STATE.collections[sid];
      if (col.eps && col.eps[eid] !== undefined) { col.eps[eid] = b.type; return send(res, 200, { detail: 'ok' }); }
    }
    if (STATE.collections['900001']) { STATE.collections['900001'].eps = STATE.collections['900001'].eps || {}; STATE.collections['900001'].eps[eid] = b.type; return send(res, 200, { detail: 'ok-created' }); }
    return send(res, 400, { title: 'no collection for episode' });
  }
  m = p.match(/^\/v0\/users\/-\/collections\/(\d+)$/);
  if (m) {
    const sid = m[1]; const col = STATE.collections[sid];
    if (req.method === 'GET') { if (!col) return send(res, 404, { title: 'Not Found' }); return send(res, 200, { type: col.type, rate: col.rate || 0, ep_status: Object.values(col.eps || {}).filter(t => t === 2).length, private: false }); }
    if (req.method === 'POST') { const b = await readBody(req); STATE.collections[sid] = STATE.collections[sid] || { eps: {} }; if (b.type) STATE.collections[sid].type = b.type; if (b.rate !== undefined) STATE.collections[sid].rate = b.rate; return send(res, 202, { detail: 'ok' }); }
  }
  return send(res, 404, { title: 'Not Found', path: p });
});
server.listen(PORT, '127.0.0.1', () => console.log('mock bgm api on :' + PORT));
