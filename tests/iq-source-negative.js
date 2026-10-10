/* v2.49.0 负测跑手：证明 iq-source-check.js 的每条新判据「真身坏了才会红」
   做法照 season-scope-negative.js：把 index.html 复制几份，每份只回退一处，
   AT_PAGE 指过去跑门禁，断言「红的那条正是被回退的那条」；
   另跑一份完全没动过的复制品当对照组——对照组必须绿且报告里的 page 就是它
   （子集同名→输出与默认一模一样=假绿，这坑记过）。
   说明：IQ3/IQ4 那两条是「坏输入不许炸」类判据，任何回退都不会让它红（限流时
   data 是字符串，取 .docinfos 也只是 undefined），所以它不进负测用例，只当护栏。
   用法：node tests/iq-source-negative.js */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '_artifacts');
const GATE = path.join(__dirname, 'iq-source-check.js');
const REAL = path.join(ROOT, 'index.html');
const NL = String.fromCharCode(10);
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
  try { rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'last-iq-source.json'), 'utf8')); } catch (e) {}
  return { rc: r.status, rep: rep, out: String(r.stdout || '') + String(r.stderr || '') };
}
function redIds(rep) { return (rep.failures || []).map(function (f) { return String(f).split(' ')[0]; }); }

let pass = 0, fail = 0; const bad = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; bad.push(id + ' ' + desc + (extra ? '  :: ' + extra : '')); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}

const ctrl = write('niq_control.html', src);
const c = runGate(ctrl);
check('C0', '对照组（原样复制品）rc=0', c.rc === 0, 'rc=' + c.rc);
check('C1', '对照组确实读的是复制品（报告里的 page 就是它）',
  String(c.rep.page || '') === ctrl, String(c.rep.page));

function cut(anchor) {
  if (src.indexOf(anchor) < 0) throw new Error('真身里没有这个锚点，负测脚本已过期：' + JSON.stringify(anchor).slice(0, 70));
  return src.replace(anchor, '');
}
function swap(from, to) {
  if (src.indexOf(from) < 0) throw new Error('真身里没有这段，负测脚本已过期：' + JSON.stringify(from).slice(0, 70));
  return src.replace(from, to);
}
function replBlock(marker, n, text) {
  const lines = src.split(NL);
  const i = lines.findIndex(function (l) { return l.indexOf(marker) >= 0; });
  if (i < 0) throw new Error('真身里没有含这个锚点的行，负测脚本已过期：' + marker);
  return lines.slice(0, i).concat([text], lines.slice(i + n)).join(NL);
}

const cases = [
  {
    id: 'N1', desc: '拆掉「必须有图」这道闸 → IQ11 必须红',
    page: write('niq_n1_nopicgate.html', cut('    if(!r||!r.pic) continue;' + NL)),
    expect: ['IQ11'],
  },
  {
    id: 'N2', desc: '类型同侧恒真（动漫/真人/电影不分了）→ IQ7/IQ8/IQ9/IQ10 必须红',
    page: write('niq_n2_nochgate.html', replBlock('function iqChAllow(s,ch){', 6, 'function iqChAllow(s,ch){ return true; }')),
    expect: ['IQ7', 'IQ8', 'IQ9', 'IQ10'],
  },
  {
    id: 'N3', desc: '身份判据拆掉（频道有图就认第一行）→ IQ12/IQ13 必须红',
    page: write('niq_n3_noequal.html', cut('    if(ks.indexOf(normTxt(r.name))<0) continue;' + NL)),
    expect: ['IQ12', 'IQ13'],
  },
  {
    id: 'N4', desc: '封面链没接这一跳 → K2/K3 必须红',
    page: write('niq_n4_nowire.html', cut('    if(!url){ url=await iqCoverFor(s); }' + NL)),
    expect: ['K2', 'K3'],
  },
  {
    id: 'N5', desc: '拆掉「只在本机模式走」闸门 → K4 必须红',
    page: write('niq_n5_nolocalhost.html', cut("  if(!isLocalServer()) return '';")),
    expect: ['K4'],
  },
  {
    id: 'N6', desc: '解析层不剥 <em> 高亮标签 → IQ1/IQ6/IQ10 必须红（名字对不上，整批命中就没了）',
    page: write('niq_n6_noemstrip.html', swap("String(a.albumTitle||'').replace(/<[^>]+>/g,'')", "String(a.albumTitle||'')")),
    expect: ['IQ1', 'IQ6', 'IQ10'],
  },
  {
    id: 'N7', desc: '剥季号尺子失效（一把尺断了）→ CN1/CN2/CN8 必须红',
    page: write('niq_n7_nostrip.html', swap("SEASON_STRIP_PATS.forEach(function(p){ p.lastIndex=0; s=s.replace(p,' '); });", "/* 负测：这把尺整体失效 */")),
    expect: ['CN1', 'CN2', 'CN8'],
  },
  {
    id: 'N8', desc: '钥匙预算放开（4 把改 9 把）→ K8 必须红',
    page: write('niq_n8_nobudget.html', swap("cnBases(v).forEach(push); }); }catch(e){}\n  return out.slice(0,4);", "cnBases(v).forEach(push); }); }catch(e){}\n  return out.slice(0,9);")),
    expect: ['K8'],
  },
  {
    id: 'N10', desc: '退避账每次都清（拆掉「同构建不再清」）→ R3/R4 必须红',
    page: write('niq_n10_alwayshclear.html', swap("if(!cur||localStorage.getItem(K)===cur) return false;", "if(!cur) return false;")),
    expect: ['R3', 'R4'],
  },
  {
    id: 'N11', desc: '构建号缺失也照清（开机就清成重试风暴）→ R5 必须红',
    page: write('niq_n11_nocurbuild.html', swap("if(!cur||localStorage.getItem(K)===cur) return false;", "if(localStorage.getItem(K)===cur) return false;")),
    expect: ['R5'],
  },
  {
    id: 'N12', desc: '开机治理里没接线这一步 → R7 必须红',
    page: write('niq_n12_nowirereset.html', cut('try{ _atCoverTryReset(); }catch(e){ atErr("bootHeal.catch", e); }')),
    expect: ['R7'],
  },
  {
    id: 'N13', desc: '清账清错了键（写成别的 localStorage 键）→ R1 必须红',
    page: write('niq_n13_wrongkey.html', swap("localStorage.setItem(\'at_cover_try\',\'{}\');", "localStorage.setItem(\'at_drafts\',\'{}\');")),
    expect: ['R1'],
  },
];

cases.forEach(function (k) {
  const r = runGate(k.page);
  const ids = redIds(r.rep);
  const missing = k.expect.filter(function (e) { return ids.indexOf(e) < 0; });
  check(k.id, k.desc, r.rc !== 0 && missing.length === 0 && String(r.rep.page || '') === k.page,
    'rc=' + r.rc + ' 红的=[' + ids.join(',') + '] 该红没红=[' + missing.join(',') + '] page=' + String(r.rep.page));
});

/* ---------- 改动前那份：新判据必须成排红，且是判红不是崩 ----------
   底本钉在具体旧提交上，不用 HEAD：本轮改动一进了 HEAD，「HEAD 那份」就等于真身，
   这一项会 0 条红＝假绿（10-09 那次提交完当场撞到）。 */
const BASE_REF = process.env.AT_BASE_REF || '851a6cc';   /* v2.47.0 前缀指认：那页里还没有 iqCoverFor */
let before = null;
try {
  const g = cp.spawnSync('git', ['-C', ROOT, 'show', BASE_REF + ':index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (g.status === 0 && g.stdout && g.stdout.length > 10000) before = write('niq_before_base.html', g.stdout);
  else console.log('NOTE 拿不到 ' + BASE_REF + ' 那份 index.html（' + String(g.stderr || '').slice(0, 120) + '），这一项跳过');
} catch (e) { console.log('NOTE git show 失败：' + e.message); }
if (before) {
  /* 底本自证：它要是已经含新函数，就不是「改动前」，下面那条红永远不会来 */
  const bSrc = fs.readFileSync(before, 'utf8');
  check('N9a', '底本自证：' + BASE_REF + ' 那份里确实还没有 iqCoverFor', bSrc.indexOf('function iqCoverFor(') < 0);
  const r = runGate(before);
  const ids = redIds(r.rep);
  check('N9', '改动前那份：新判据成排红（≥10 条），且是判红不是崩（无 CRASH）',
    r.rc !== 0 && ids.length >= 10 && r.out.indexOf('CRASH') < 0,
    'rc=' + r.rc + ' 红 ' + ids.length + ' 条（底本 ' + BASE_REF + '）');
}

/* ---------- 收尾：把 last-iq-source.json 恢复成「真身跑出来的」那份 ---------- */
const back = runGate(REAL);
check('C9', '恢复真身跑：rc=0（报告文件指回真身）',
  back.rc === 0 && path.resolve(ROOT, String(back.rep.page || '')) === REAL,
  'rc=' + back.rc + ' page=' + String(back.rep.page));

console.log('\n==== iq-source-negative: pass=' + pass + ' fail=' + fail + ' ====');
fs.writeFileSync(path.join(__dirname, 'last-iq-source-negative.json'),
  JSON.stringify({ pass, fail, bad }, null, 1));
process.exit(fail ? 1 : 0);
