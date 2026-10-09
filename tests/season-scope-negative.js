/* v2.48.0 负测跑手：证明 season-scope-check.js 的每条新判据「真身坏了才会红」
   做法：把 index.html 复制几份，每份只回退一处（其余字不动），AT_PAGE 指过去跑门禁，
   断言「红的那条正是被回退的那条」。另跑一份完全没动过的复制品当对照组——
   对照组必须绿，否则说明复制品根本没被读（子集同名→输出与默认一模一样=假绿，这坑记过）。
   用法：node tests/season-scope-negative.js */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '_artifacts');
const GATE = path.join(__dirname, 'season-scope-check.js');
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
  try { rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'last-season-scope.json'), 'utf8')); } catch (e) {}
  return { rc: r.status, rep: rep, out: String(r.stdout || '') + String(r.stderr || '') };
}
function redIds(rep) {
  return (rep.failures || []).map(function (f) { return String(f).split(' ')[0]; });
}

let pass = 0, fail = 0; const bad = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; bad.push(id + ' ' + desc + (extra ? '  :: ' + extra : '')); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}

/* ---------- 对照组：完整复制品必须全绿，且门禁确实读的是这份 ---------- */
const ctrl = write('nsc_control.html', src);
const c = runGate(ctrl);
check('C0', '对照组（原样复制品）rc=0', c.rc === 0, 'rc=' + c.rc);
check('C1', '对照组确实读的是复制品（报告里的 page 就是它）',
  String(c.rep.page || '') === ctrl, String(c.rep.page));

/* ---------- mutations：每份复制品只回退一件事 ---------- */
function cut(anchor) {
  if (src.indexOf(anchor) < 0) throw new Error('真身里没有这个锚点，负测脚本已过期：' + JSON.stringify(anchor).slice(0, 70));
  return src.replace(anchor, '');
}
function swap(from, to) {
  if (src.indexOf(from) < 0) throw new Error('真身里没有这段，负测脚本已过期：' + JSON.stringify(from).slice(0, 70));
  return src.replace(from, to);
}
/* 按「锚点行 + 行数」整块替换：有些回退没法用单行锚点表达（比如把整段分词逻辑
   换回按字符扫），块宽写死，锚点找不到就抛——宁可脚本死，不静默改错地方 */
function replBlock(marker, n, text) {
  const lines = src.split('\n');
  const i = lines.findIndex(function (l) { return l.indexOf(marker) >= 0; });
  if (i < 0) throw new Error('真身里没有含这个锚点的行，负测脚本已过期：' + marker);
  const out = lines.slice(0, i).concat([text], lines.slice(i + n));
  return out.join('\n');
}
const cases = [
  {
    id: 'M1', desc: '加片补齐没接线 → S6 必须红',
    page: write('nsc_m1_nowirefill.html', cut('    eps=seasonRowsFor(cur,eps);\n')),
    expect: ['S6'],
  },
  {
    id: 'M2', desc: '手动补齐没接线 → S7 必须红',
    page: write('nsc_m2_nowirenow.html', cut('      eps=seasonRowsFor(s,eps);\n')),
    expect: ['S7'],
  },
  {
    id: 'M3', desc: '刷名没先切季 → S8 必须红',
    page: write('nsc_m3_nowirewebeps.html', swap('s.__webEps=seasonRowsFor(s,we);', 's.__webEps=we;')),
    expect: ['S8'],
  },
  {
    id: 'M4', desc: '护栏②（进度号超过本季就不切）拆掉 → G4/G5/G6 必须红',
    page: write('nsc_m4_noguard.html', cut('    if(hi>n) return list;\n')),
    expect: ['G4', 'G5', 'G6'],
  },
  {
    id: 'M5', desc: '切完不重排季内号 → E3 必须红',
    page: write('nsc_m5_norenum.html', swap('c.s=i+1; c.sn=no; return c;', 'c.sn=no; return c;')),
    expect: ['E3'],
  },
  {
    id: 'M6', desc: '剥壳尺子比切季尺子宽（第N期也剥）→ Q13「一把尺」必须红',
    page: write('nsc_m6_widescale.html', swap('[季部篇卷]/g', '[季部篇卷期]/g')),
    expect: ['Q13'],
  },
  {
    id: 'M7', desc: '身份判据松了（首条即算命中）→ S4 必须红',
    page: write('nsc_m7_looseidentity.html',
      swap("if(normTxt(x.name)===normTxt(tries[i])||normTxt(x.name)===want) hit=x;", "hit=x;")),
    expect: ['S4'],
  },
  {
    id: 'M9', desc: '复活「砍尾当前缀问」（Gravity Falls Shorts → 再多问一遍 Gravity Falls）→ L7 必须红',
    page: write('nsc_m9_prefixcut.html',
      swap("runs.push(cur.join(' ')); cur=[];",
           "for(var _k=cur.length;_k>=1;_k--){ runs.push(cur.slice(0,_k).join(' ')); } cur=[];")),
    expect: ['L7'],
  },
  {
    id: 'M10', desc: '拆掉「整段全是季/阶段词就不当名」这道闸 → L9/L9b 必须红',
    page: write('nsc_m10_nostopword.html', cut('      if(!nameTok) return;\n')),
    expect: ['L9', 'L9b'],
  },
  {
    id: 'M11', desc: '拉丁段退回「按字符扫」（旧版真身那条路，会摘出「破灭Flag」里的 Flag）→ L5/L13/S11 必须红',
    page: write('nsc_m11_charscan.html', replBlock('var segs=String(s).split', 8, `    var runs=[], _re=/[A-Za-z][A-Za-z0-9'&.+-]*/g, _m;
    while((_m=_re.exec(s))){ runs.push(_m[0]); }`)),
    expect: ['L5', 'L13', 'S11'],
  },
  {
    id: 'M12', desc: '整段摘名没接进查询链（webMatchShow + cnShowBySearch 都拔掉）→ S3/S3b 必须红',
    page: write('nsc_m12_nolatinwire.html', (function () {
      var t = swap('queryBases(k).concat(latinBases(k)).forEach', 'queryBases(k).forEach');
      if (t.indexOf('queryBases(cur).concat(latinBases(cur)).forEach') < 0) throw new Error('真身里 cnShowBySearch 那段锚点没了，负测脚本已过期');
      return t.replace('queryBases(cur).concat(latinBases(cur)).forEach', 'queryBases(cur).forEach');
    })()),
    expect: ['S3', 'S3b'],
  },
];

cases.forEach(function (k) {
  const r = runGate(k.page);
  const ids = redIds(r.rep);
  const missing = k.expect.filter(function (e) { return ids.indexOf(e) < 0; });
  check(k.id, k.desc, r.rc !== 0 && missing.length === 0 && String(r.rep.page || '') === k.page,
    'rc=' + r.rc + ' 红的=[' + ids.join(',') + '] 该红没红=[' + missing.join(',') + '] page=' + String(r.rep.page));
});

/* ---------- 旧版真身（改动前那份）：必须整批红，且不许崩 ----------
   底本钉在具体旧提交上，不用 HEAD：本轮改动一进了 HEAD，「HEAD 那份」就等于真身，
   这一项会 0 条红＝假绿（10-09 那次提交完当场撞到，红的就是这条判据自己）。 */
const BASE_REF = process.env.AT_BASE_REF || '851a6cc';   /* v2.47.0 前缀指认：那页里 queryBases / seasonRowsFor 都还没进 */
let before = null;
try {
  const g = cp.spawnSync('git', ['-C', ROOT, 'show', BASE_REF + ':index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (g.status === 0 && g.stdout && g.stdout.length > 10000) before = write('nsc_before_base.html', g.stdout);
  else console.log('NOTE 拿不到 ' + BASE_REF + ' 那份 index.html（' + String(g.stderr || '').slice(0, 120) + '），这一项跳过');
} catch (e) { console.log('NOTE git show 失败：' + e.message); }
if (before) {
  /* 底本自证：它要是已经含新函数，就不是「改动前」，下面那条红永远不会来 */
  const bSrc = fs.readFileSync(before, 'utf8');
  check('M8a', '底本自证：' + BASE_REF + ' 那份里确实还没有 queryBases / seasonRowsFor',
    bSrc.indexOf('function queryBases(') < 0 && bSrc.indexOf('function seasonRowsFor(') < 0);
  const r = runGate(before);
  const ids = redIds(r.rep);
  check('M8', '改动前那份：新判据成排红（≥8 条），且是判红不是崩（无 CRASH）',
    r.rc !== 0 && ids.length >= 8 && r.out.indexOf('CRASH') < 0,
    'rc=' + r.rc + ' 红 ' + ids.length + ' 条');
}

/* ---------- 收尾：把 last-season-scope.json 恢复成「真身跑出来的」那份 ---------- */
const back = runGate(REAL);
check('C9', '恢复真身跑：rc=0（报告文件指回真身）',
  back.rc === 0 && path.resolve(ROOT, String(back.rep.page || '')) === REAL,
  'rc=' + back.rc + ' page=' + String(back.rep.page));

console.log('\n==== season-scope-negative: pass=' + pass + ' fail=' + fail + ' ====');
fs.writeFileSync(path.join(__dirname, 'last-season-scope-negative.json'),
  JSON.stringify({ pass, fail, bad }, null, 1));
process.exit(fail ? 1 : 0);
