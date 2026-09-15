/* mock-bgm-api.js — AniTracker 回归测试用本地 Bangumi API 模拟器（127.0.0.1:8092）
   控制端点：GET /__state · POST /__ctl {mode,target,reset} · POST /__seed {collections}
   故障模式：ok | http429 | http500 | http404 | authfail | hang（target=all|me|search|subjects|episodes|collections）
   条目：900001=模拟番（12 集，bid 90000001..90000012）；900002=空条目番（0 集，用于未开播路径） */
const http = require('http');
const PORT = 8092;
const STATE = { mode: 'ok', target: 'all', collections: {} };
const EPS = [];
for (let i = 1; i <= 12; i++) EPS.push({ id: 90000000 + i, sort: String(i), name: '第 ' + i + ' 集', name_cn: '第 ' + i + ' 集', type: 0 });
const SUBJECTS = {
  '900001': { id: 900001, name: 'mock anime (test)', name_cn: '模拟番（测试）', date: '2026-01-01', type: 2, eps: 12, images: { common: '' }, summary: '本地模拟条目' },
  '900002': { id: 900002, name: 'empty subject (test)', name_cn: '空条目番（无剧集）', date: '2026-10-01', type: 2, eps: 0, images: { common: '' }, summary: '未开播/未录入剧集的条目' }
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
  const auth = req.headers['authorization'] || '';
  const okAuth = auth === 'Bearer good-token';
  if (p === '/v0/me') { if (!okAuth) return send(res, 401, { title: 'Unauthorized', description: 'invalid token' }); return send(res, 200, { id: 1, username: 'tester', nickname: '测试用户', sign: 'mock' }); }
  if (p === '/v0/search/subjects' && req.method === 'POST') {
    return send(res, 200, { data: [
      { id: 900001, name: 'mock anime (test)', name_cn: '模拟番（测试）', date: '2026-01-01', type: 2, eps: 12, images: { common: '' } },
      { id: 900002, name: 'empty subject (test)', name_cn: '空条目番（无剧集）', date: '2026-10-01', type: 2, eps: 0, images: { common: '' } }
    ] });
  }
  if (p.startsWith('/v0/subjects/')) { const id = p.split('/').pop(); if (SUBJECTS[id]) return send(res, 200, SUBJECTS[id]); return send(res, 404, { title: 'Not Found' }); }
  if (p === '/v0/episodes') { const sid = u.searchParams.get('subject_id'); if (sid === '900001') return send(res, 200, { data: EPS }); return send(res, 200, { data: [] }); }
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
