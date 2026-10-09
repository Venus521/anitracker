/* v2.50.0 负测跑手：证明 tests/dbinfo-transport-check.js 的每条判据「真身坏了才会红」
   做法：把 index.html 复制几份，每份只回退一处（其余字不动），AT_PAGE 指过去跑门禁，
   断言「红的那条正是被回退的那条」。另跑一份完全没动过的复制品当对照组——
   对照组必须绿，且报告里的 page 必须等于这份复制品（换底本仍读旧底本=假绿，这坑记过）。
   用法：node tests/dbinfo-transport-negative.js */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '_artifacts');
const GATE = path.join(__dirname, 'dbinfo-transport-check.js');
const REAL = path.join(ROOT, 'index.html');
const src = fs.readFileSync(REAL, 'utf8');

function write(name, text) {
  if (!fs.existsSync(ART)) fs.mkdirSync(ART, { recursive: true });
  const p = path.join(ART, name);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}
function runGate(pagePath) {
  const r = cp.spawnSync(process.execPath, [GATE], {
    cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { AT_PAGE: pagePath }),
  });
  let rep = {};
  try { rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'last-dbinfo-transport.json'), 'utf8')); } catch (e) {}
  return { rc: r.status, rep: rep, out: String(r.stdout || '') + String(r.stderr || '') };
}
function redIds(rep) { return (rep.failures || []).map(f => String(f).split(' ')[0]); }

let pass = 0, fail = 0;
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}
function sub(text, from, to, label) {
  var hits = text.split(from).length - 1;
  if (hits !== 1) throw new Error(label + ' 锚点不唯一（命中 ' + hits + ' 处）——replace 会打到别处，红是假的');
  var out = text.replace(from, to);
  if (out === text) throw new Error(label + ' 没改成：替换后文本一模一样');
  var i = out.indexOf('async function dbInfo(');
  var j = out.indexOf('async function healDurFor(', i);
  if (i < 0 || j < 0 || out.slice(i, j).indexOf(to) < 0)
    throw new Error(label + ' 改动没落在 dbInfo 那一段里（量具自己先不对）');
  return out;
}

/* 对照组：什么都没动的复制品必须全绿，且读的确实是这份复制品 */
const ctrl = write('ndt_control.html', src);
let r = runGate(ctrl);
check('C00', '对照组（原样复制品）全绿：' + r.rc, r.rc === 0 && r.rep.fail === 0, 'rc=' + r.rc + ' fail=' + JSON.stringify(r.rep.failures));
check('C0b', '对照组自证：报告里的 page 就是这份复制品（不是真身——否则下面每一条红都是假的）',
  String(r.rep.page) === ctrl, 'page=' + r.rep.page);
check('C0c', '真身跑出来也必须是绿的（负测的基准线）', runGate(REAL).rc === 0);

const EPS = "var eps=isLocalServer()?['/db-info?q='+encodeURIComponent(title),cloud]:[cloud];";
check('C0d', '锚点自证：真身里那条 eps 写法确实是这一行（锚点漂了下面全是假红）',
  src.indexOf(EPS) >= 0, '找不到 eps 那一行');

function redOf(name, text, expectRed, expectGreen) {
  const p = write(name, text);
  const g = runGate(p);
  const ids = redIds(g.rep);
  if (g.out.indexOf('CRASH') >= 0) { check(name, '改坏这一处：门禁判红而不是崩', false, 'CRASH 吞了症状'); return; }
  const miss = expectRed.filter(x => ids.indexOf(x) < 0);
  const bleed = (expectGreen || []).filter(x => ids.indexOf(x) >= 0);
  check(name, '改坏一处 → 该红的红了' + (miss.length ? '（没红：' + miss.join(',') + '）' : '') +
    (bleed.length ? '；不该红的红了：' + bleed.join(',') : ''),
    g.rc !== 0 && miss.length === 0 && bleed.length === 0,
    'rc=' + g.rc + ' 红=' + ids.join(',') + ' 报告fail数=' + (g.rep.fail === undefined ? '?' : g.rep.fail));
}

/* M1 回到「只问云端」——就是 2026-10-09 那台机器上一条时长都收不回来的写法 */
redOf('ndt_m1_cloud_only.html', sub(src, EPS, 'var eps=[cloud];', 'M1'),
  ['T01', 'T02', 'T03', 'T04', 'T06', 'T15'], ['T10', 'T11', 'T08', 'T09']);
/* M2 顺序颠倒：先问云端（本机照样被 CORS 拦，等于本机模式白等一发） */
redOf('ndt_m2_order.html', sub(src, EPS,
  "var eps=isLocalServer()?[cloud,'/db-info?q='+encodeURIComponent(title)]:[cloud];", 'M2'),
  ['T01', 'T04'], ['T10']);
/* M5 不分模式都走同源：发布站点/手机上会去打一个不存在的端点 */
redOf('ndt_m5_always_local.html', sub(src, EPS,
  "var eps=['/db-info?q='+encodeURIComponent(title),cloud];", 'M5'),
  ['T10'], ['T01']);
/* M3 本机答不上就落负缓存：一次限流判成这部永远没有（v2.46.2 那次的同一条锁） */
redOf('ndt_m3_cache_miss.html', sub(src, "      if(!r.ok) continue;               /* 这条端点没答上",
  "      if(!r.ok){ _dbInfoCache[title]=null; continue; }               /* 这条端点没答上", 'M3'),
  ['T07'], ['T13']);
/* M4 503 也落账：豆瓣 45 秒的限流会被写成「这部没有时长」 */
redOf('ndt_m4_cache_503.html', sub(src, '        return null;                    /* 限流不是',
  '        _dbInfoCache[title]=null;\n        return null;                    /* 限流不是', 'M4'),
  ['T09'], ['T07']);
/* M6 把名字全等搬到搬运工身上：判决该留在 applyDbInfo/dbInfoAccept（搬下来就没有粒度哨、没有别名档） */
redOf('ndt_m6_gate_in_transport.html', sub(src, '      if(j&&j.found){ _dbInfoCache[title]=j; return j; }',
  "      if(j&&j.found){ if(String(j.title||'')!==String(title)) return null; _dbInfoCache[title]=j; return j; }", 'M6'),
  ['T14'], ['T02']);
/* M7 摘掉逐发中止：一条端点挂住会把开机那串逐部校正一起拖死 */
redOf('ndt_m7_no_abort.html', sub(src,
  'var ctl=new AbortController(); var tm=setTimeout(function(){ try{ ctl.abort(); }catch(e){} },9000);',
  'var ctl=new AbortController(); var tm=0;', 'M7'),
  ['T16'], ['T01']);

/* ---------- 改动前那份：底本钉死旧提交，不用 HEAD（HEAD 会被我自己的提交推平=假绿） ---------- */
const BASE_REF = process.env.AT_BASE_REF || '851a6cc';   /* v2.47.0：那会儿时长只有云端一条道，正是这次撞墙的那条 */
let before = null;
try {
  const g = cp.spawnSync('git', ['-C', ROOT, 'show', BASE_REF + ':index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (g.status === 0 && g.stdout && g.stdout.length > 10000) before = write('ndt_before_base.html', g.stdout);
  else console.log('NOTE 拿不到 ' + BASE_REF + ' 那份 index.html（' + String(g.stderr || '').slice(0, 120) + '），这一项跳过');
} catch (e) { console.log('NOTE git show 失败：' + e.message); }
if (before) {
  const bSrc = fs.readFileSync(before, 'utf8');
  check('B0a', '底本自证：' + BASE_REF + ' 那份里确实还没有 /db-info 这条同源路',
    bSrc.indexOf('/db-info') < 0, '底本里竟然有 /db-info');
  const rb = runGate(before);
  const ids = redIds(rb.rep);
  check('B0b', '改动前那份：本机优先与编码这两条判据必须红（红得出来才叫「真身坏了才红」）',
    rb.rc !== 0 && ids.indexOf('T01') >= 0 && ids.indexOf('T15') >= 0 && rb.out.indexOf('CRASH') < 0,
    'rc=' + rb.rc + ' 红=' + ids.join(','));
}

/* ---------- 收尾：把 last-dbinfo-transport.json 恢复成「真身跑出来的」那份 ---------- */
const back = runGate(REAL);
check('Z0', '收尾复跑真身：绿（报告已还原成这一份）', back.rc === 0, 'rc=' + back.rc + ' ' + JSON.stringify(back.rep.failures));

console.log('==== dbinfo-transport-negative pass=' + pass + ' fail=' + fail + ' ====');
fs.writeFileSync(path.join(__dirname, 'last-dbinfo-transport-negative.json'),
  JSON.stringify({ pass: pass, fail: fail, gate: 'dbinfo-transport-check.js', baseRef: BASE_REF }, null, 1));
process.exit(fail ? 1 : 0);
