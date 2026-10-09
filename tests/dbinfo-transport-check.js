/* v2.50.0 门禁：时长这条路的**传输**判据（纯逻辑，毫秒级，不联网、不开浏览器）
   为什么要有这一份：2026-10-09 实测，页面里 10 部 0 部拿到时长，而 python 直问同一个
   云端端点 10 部 6 部有真值——差别不在豆瓣有没有数据，在浏览器许不许收：
   CloudBase 网关对 loopback 来源回 access-control-allow-origin: http://127.0.0.1:8089,*
   （一个头里两个值，按规范非法）+ allow-credentials: true ⇒ Chrome 判 CORS 拦死。
   修法是把时长也变同源（本机 /db-info 优先，云端兜底），封面早就是这么活的。
   这条路只有几行，但它决定「随便找一部」有没有时长，所以每条都钉死：
     顺序（本机在前）、降级（本机的 502/404 才许问云端）、非本机模式不许撞同源、
     限流(503)与「确认没有」的记账区别、以及**判决不许搬到传输层**（全等仍在 dbInfoAccept）。
   负测：tests/dbinfo-transport-negative.js（当场把这几行改坏，按「该红哪条」验收）。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = process.env.AT_PAGE || 'index.html';
const html = fs.readFileSync(path.isAbsolute(PAGE) ? PAGE : path.join(ROOT, PAGE), 'utf8');
const CLOUD = 'https://cloud.example/douban-relay';
const NAME = '爱情宝典';
const ENC = encodeURIComponent(NAME);

let pass = 0, fail = 0;
const failures = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; failures.push(id + ' ' + desc + (extra ? '  :: ' + extra : '')); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}
function sliceFn(startMark, endMark) {
  const i = html.indexOf(startMark);
  if (i < 0) return null;
  const j = html.indexOf(endMark, i);
  if (j < 0) return null;
  return html.slice(i, j);
}
const DBINFO = sliceFn('async function dbInfo(', 'async function healDurFor(');

/* 一场跑法：fe 决定每个端点回什么（按 URL 里有没有 /db-info 分本机/云端） */
function run(opts) {
  opts = opts || {};
  const calls = [], cools = [];
  const resp = (status, body) => ({ status: status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });
  const fe = (u) => {
    const s = String(u);
    calls.push(s);
    const local = s.indexOf('/db-info') === 0;
    const plan = opts[local ? 'local' : 'cloud'];
    if (plan === 'throw') return Promise.reject(new Error('CORS blocked'));
    if (typeof plan === 'function') return Promise.resolve(plan(resp));
    return Promise.resolve(resp(plan && plan[0] || 200, plan && plan[1]));
  };
  const src = DBINFO === null ? 'function dbInfo(){ return null; }' : DBINFO;
  const mk = new Function('env',
    'var _dbInfoCache={};' +
    'var navigator={onLine:true};' +
    'var isLocalServer=function(){ return env.localMode; };' +
    'var DOUBAN_RELAY_CLOUD=env.cloud;' +
    'var dbCoolNote=function(ms){ env.cools.push(ms); };' +
    'var fetch=env.fetch;' +
    'var AbortController=env.AbortController;' +
    src + '\nreturn { dbInfo: dbInfo, cache: function(){ return _dbInfoCache; } };');
  const api = mk({ localMode: opts.localMode !== false, cloud: CLOUD, cools: cools, fetch: fe,
    AbortController: AbortController });
  return { api: api, calls: calls, cools: cools };
}

const LOCAL0 = '/db-info?q=' + ENC;
const CLOUD0 = CLOUD + '?mode=info&q=' + ENC;
const FOUND = { found: true, title: NAME, id: '3619080', type: 'tv', dur: 50, eps: 26, genres: ['爱情'], year: '2002', cover: 'x' };

(async () => {
  console.log('--- 装载 ---');
  check('T00', '页里找得到 async function dbInfo（.slice 成功，量具本身先自证）',
    DBINFO !== null && DBINFO.length > 400, DBINFO === null ? 'slice 失败' : 'len=' + DBINFO.length);

  console.log('--- 顺序与降级 ---');
  let r = run({ local: [200, FOUND] });
  let out = await r.api.dbInfo(NAME);
  check('T01', '本机模式第一发是同源 /db-info（不是云端）：这一条就是 CORS 那堵墙的正解',
    r.calls.length === 1 && r.calls[0] === LOCAL0, JSON.stringify(r.calls));
  check('T02', '本机答上了就直接用，不必再问云端：带回 dur=50',
    !!out && Number(out.dur) === 50 && String(out.title) === NAME, JSON.stringify(out));
  const n1 = r.calls.length;
  await r.api.dbInfo(NAME);
  check('T03', '同一场里第二次问同一部不再发请求（命中 _dbInfoCache，开机批量才不会重复打豆瓣）',
    r.calls.length === n1, 'calls=' + r.calls.length);

  r = run({ local: [502, 'suggest empty (soft limit)'], cloud: [200, Object.assign({}, FOUND, { dur: 45 })] });
  out = await r.api.dbInfo(NAME);
  check('T04', '本机答不上（旧版服务/豆瓣软限流回 502）才降级问云端，且顺序是本机在前',
    r.calls.length === 2 && r.calls[0] === LOCAL0 && r.calls[1] === CLOUD0, JSON.stringify(r.calls));
  check('T05', '降级真接得住：云端那份 45 分落进来了',
    !!out && Number(out.dur) === 45, JSON.stringify(out));

  r = run({ local: [404, { found: false, reason: 'no subject for x' }], cloud: 'throw' });
  out = await r.api.dbInfo(NAME);
  check('T06', '本机说「没有」也再给云端一次机会（本机判据与云端不同套时不至于漏）',
    r.calls.length === 2 && out === null, JSON.stringify(r.calls) + ' out=' + JSON.stringify(out));
  check('T07', '全条落空不落负缓存：下一场开详情页还会再问（v2.46.2 那条锁在这里同样成立）',
    Object.keys(r.api.cache()).length === 0, JSON.stringify(Object.keys(r.api.cache())));

  console.log('--- 限流不是「没有」 ---');
  var L503 = [503, { found: false, limited: true, reason: '403 need_login', coolMs: 8000 }];
  r = run({ local: L503, cloud: L503 });
  out = await r.api.dbInfo(NAME);
  check('T08', '本机 503 记冷却（dbCoolNote 收到 8000）',
    r.cools.length === 1 && Number(r.cools[0]) === 8000, JSON.stringify(r.cools));
  check('T09', '本机 503 立刻收手：不接着把云端也烧一遍，也不缓存',
    r.calls.length === 1 && out === null && Object.keys(r.api.cache()).length === 0,
    'calls=' + JSON.stringify(r.calls) + ' cache=' + JSON.stringify(Object.keys(r.api.cache())));

  r = run({ localMode: false, cloud: [200, Object.assign({}, FOUND, { dur: 42 })] });
  out = await r.api.dbInfo(NAME);
  check('T10', '非本机模式只问云端：绝不同源瞎撞（那台机器上根本没有这个端点）',
    r.calls.length === 1 && r.calls[0] === CLOUD0, JSON.stringify(r.calls));
  check('T11', '非本机模式照样拿得到真值（云端对发布来源的 CORS 是干净的 *，实测过）',
    !!out && Number(out.dur) === 42, JSON.stringify(out));

  r = run({ localMode: false, cloud: 'throw' });
  out = await r.api.dbInfo(NAME);
  check('T12', '云端被拦/断网异常：返回 null 不抛错，也不写任何缓存（跑完不崩=量具与真身都干净）',
    out === null && Object.keys(r.api.cache()).length === 0, JSON.stringify(out));

  r = run({ local: [200, { found: false, reason: 'no subject' }], cloud: [200, { found: false }] });
  out = await r.api.dbInfo(NAME);
  check('T13', '端点回 200 但 found:false 不写缓存：一条「没有」都不许把这部锁死',
    out === null && Object.keys(r.api.cache()).length === 0, JSON.stringify(Object.keys(r.api.cache())));

  console.log('--- 判决留在页面层 ---');
  check('T14', '传输层一个字都不判：dbInfo 里既没有 normTxt / dbInfoAccept / 年份比较，也不许碰带回来的 j.title / j.year（判据一搬进搬运工，粒度哨和别名档就双双失联）',
    DBINFO.indexOf('normTxt') < 0 && DBINFO.indexOf('dbInfoAccept') < 0 &&
    DBINFO.indexOf('Math.abs') < 0 && DBINFO.indexOf('j.title') < 0 && DBINFO.indexOf('j.year') < 0,
    '命中了就说明判决被搬到搬运工身上');

  var Q = String.fromCharCode(39);
  var flat = DBINFO.replace(/\s+/g, '');

  check('T15', '剧名一律 encodeURIComponent：本机与云端两条都是（中文直接拼进 URL 会被 parse_qs 吃掉）',
    flat.indexOf(Q + '/db-info?q=' + Q + '+encodeURIComponent(title)') >= 0 &&
    flat.indexOf('mode=info&q=' + Q + '+encodeURIComponent(title)') >= 0,
    '缺编码：' + flat.slice(flat.indexOf('/db-info'), flat.indexOf('/db-info') + 60));

  check('T16', '每一发都带 9000ms 中止：一条端点挂住不许拖死开机那串逐部校正',
    /setTimeout\(function\(\)\{[^}]*ctl\.abort\(\)/.test(DBINFO) && DBINFO.indexOf(',9000)') >= 0, '没有逐发中止');

  const HEAL = sliceFn('async function healDurFor(', 'var _durAutoSeen=') || '';
  check('T17', '修时长那条链没被换掉：durNeedsFix → dbInfo → applyDbInfo 三段还在',
    HEAL.indexOf('durNeedsFix(s)') >= 0 && HEAL.indexOf('dbInfo(') >= 0 && HEAL.indexOf('applyDbInfo(') >= 0,
    'len=' + HEAL.length);
  const AUTO = sliceFn('function _autoDurFor(', '/* v2.41.0') || '';
  check('T18', '限流时不落「这部已经试过」的账：_autoDurFor 里 dbCooling 分支仍在，且排了冷却后的重试',
    AUTO.indexOf('dbCooling()') >= 0 && /setTimeout\(\s*function\(\)\{[^}]*healDurFor/.test(AUTO), 'len=' + AUTO.length);
  const CVI = html.indexOf('async function doubanRelayCover(');
  const COVER = CVI < 0 ? '' : html.slice(CVI, CVI + 900);
  check('T19', '对照：封面那条早就是本机优先（时长这次照它改，不是新发明一条路）',
    COVER.indexOf('/cover-relay?q=') >= 0 && COVER.indexOf('isLocalServer()') >= 0, 'len=' + COVER.length);

  console.log('==== dbinfo-transport pass=' + pass + ' fail=' + fail + ' ====');
  fs.writeFileSync(path.join(__dirname, 'last-dbinfo-transport.json'),
    JSON.stringify({ page: PAGE, pass: pass, fail: fail, failures: failures }, null, 1));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH ' + e.stack); process.exit(1); });
