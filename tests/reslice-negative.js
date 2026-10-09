/* v2.49.0 负测跑手：证明 reslice-check.js 的每条新判据「真身坏了才会红」
   做法同 season-scope-negative.js：把 index.html 复制几份，每份只回退一处，
   AT_PAGE 指过去跑门禁，断言「红的那条正是被回退的那条」；
   另跑一份原样复制品当对照组（必须绿，且报告里的 page 得是这份——子集同名会假绿，记过）。
   用法：node tests/reslice-negative.js */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '_artifacts');
const GATE = path.join(__dirname, 'reslice-check.js');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const html = src;

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
  try { rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'last-reslice.json'), 'utf8')); } catch (e) {}
  const out = String(r.stdout || '') + String(r.stderr || '');
  /* 死在半路（锚点找不到 / CRASH / 没跑到判决行）一律算负测失败，不许静默绿 */
  if (out.indexOf('==== reslice:') < 0) throw new Error('门禁没跑到汇总行：' + out.slice(0, 200));
  return { rc: r.status, rep: rep, out: out };
}
function redIds(rep) { return (rep.failures || []).map(function (f) { return String(f).split(' ')[0]; }); }

let pass = 0, fail = 0; const bad = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; bad.push(id + ' ' + desc + (extra ? '  :: ' + extra : '')); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}
function must(srcText, anchor, label) {
  if (srcText.indexOf(anchor) < 0) throw new Error('真身里没有这段，负测脚本已过期：' + label + ' :: ' + JSON.stringify(anchor).slice(0, 60));
  return anchor;
}
function swap(from, to, label) { return src.replace(must(src, from, label), to); }
function cut(from, label) { return src.replace(must(src, from, label), ''); }

/* ---------- 对照组 ---------- */
const ctrl = write('nrs_control.html', src);
const c = runGate(ctrl);
check('C0', '对照组（原样复制品）rc=0', c.rc === 0, 'rc=' + c.rc);
check('C1', '对照组确实读的是复制品（报告里的 page 就是它）', String(c.rep.page || '') === ctrl, String(c.rep.page));
check('C2', '对照组红名单为空', redIds(c.rep).length === 0, redIds(c.rep).join(','));

/* ---------- 把整段功能摘掉那份：必须红（缺失不许被 stub 咽成绿）
   原来是读一份改动前落盘的复制品，现在当场摘——不依赖任何过期文件，
   摘没摘干净靠「函数定义在不在」自证。 ---------- */
const aBlk = html.indexOf("/* ===== v2.49.0 存量季切");
const zBlk = html.indexOf("async function webMatchShow(", aBlk);
check('C2b', '摘块的边界在真身里找得到（找不到就是脚本过期）', aBlk > 0 && zBlk > aBlk, String(aBlk) + '/' + String(zBlk));
const stripped = src.slice(0, aBlk) + src.slice(zBlk);
/* 判据压在「定义没了」上，不是「名字没了」：bootHeal 里那颗调用点在块外，
   摘掉整段功能后它仍然留在页里（这正是 C3/C4 要红的原因），按名字断言必假红。 */
check('C2c', '摘干净了：复制品里两个函数定义都不在（调用点在块外，留着不算没摘）',
  stripped.indexOf('function seasonResliceShow(') < 0 && stripped.indexOf('function bootSeasonReslice(') < 0);
const old = write('nrs_before.html', stripped);
const o = runGate(old);
const or_ = redIds(o.rep);
check('C3', '整段摘掉那份红（跑手没崩、判决行走到了）', o.rc === 1, 'rc=' + o.rc);
check('C4', '摘掉后红的正是新判据（R/B/S 三组都红才说明判据压在功能上，不是压在字符串上）',
  or_.length >= 10 && or_.indexOf('R1') >= 0 && or_.indexOf('B1') >= 0 && or_.indexOf('S1') >= 0, or_.join(','));
/* ---------- 逐条回退：红的那条必须是被回退的那条 ---------- */
function expectRed(label, id, desc, mutated, want, forbid) {
  const p = write(label + '.html', mutated);
  const g = runGate(p);
  const got = redIds(g.rep);
  check(id, desc, g.rc === 1 && want.every(function (w) { return got.indexOf(w) >= 0; }),
    'rc=' + g.rc + ' 红=' + got.join(','));
  if (forbid) {
    const leaked = got.filter(function (x) { return forbid.indexOf(x) >= 0; });
    check(id + 'b', desc + '（不误伤：' + forbid.join('/') + ' 仍绿）', leaked.length === 0, '误伤=' + leaked.join(','));
  }
}

expectRed('nrs_m1', 'M1', '季外标记那道闸整行拆掉 → refuse 判据红（R9/R10）',
  swap('if(bad) return {act:"refuse"', 'if(false) return {act:"refuse"', 'm1'),
  ['R9', 'R10']);

expectRed('nrs_m2', 'M2', '「那一行到底是不是这一季」不记了 → 跨季标记被当成季内（R9 红，R10 那条靠位序超表仍然绿）',
  swap('      if(sn===no) idx.push(i+1); else outOf.push(i+1);',
    '      if(sn===no) idx.push(i+1); else if(0) outOf.push(i+1);', 'm2'),
  ['R9'], ['R10']);

expectRed('nrs_m3', 'M3', '行身份退回硬当第 1 季 → 第三季那种整部表一条也切不动（R1/R2/R5 红）',
  swap('var sn=Number((s.eps[i]||{}).sn)||1;', 'var sn=1;', 'm3'),
  ['R1', 'R2', 'R5']);

expectRed('nrs_m4', 'M4', '切完不重编号（位序留着全书号）→ 界面还是 27/34 那种数（R2 红）',
  swap('      c.s=q+1; c.sn=no; keep.push(c);', '      keep.push(c);', 'm4'),
  ['R2'], ['R1']);

expectRed('nrs_m5', 'M5', 'statuses 的键不平移 → 进度跟着旧位序走，等于挪到别的集（R7 红）',
  swap('nst[String(remap[o1]||o1)]=mk[k2];', 'nst[k2]=mk[k2];', 'm5'),
  ['R7']);

expectRed('nrs_m6', 'M6', 'epT 的键不平移 → 时间戳留在旧位序（R7/R11 红）',
  swap('ntp[String(remap[o2]||o2)]=tt[k2];', 'ntp[k2]=tt[k2];', 'm6'),
  ['R7', 'R11']);

expectRed('nrs_m7', 'M7', '动手前不备份整份片单 → 出问题没法还原（B2 红，其余照旧）',
  cut('try{ localStorage.setItem("at_shows_bak_"+cur,JSON.stringify(shows)); }catch(e){}', 'm7'),
  ['B2']);

expectRed('nrs_m8', 'M8', '「同构建不再跑」这道闸拆掉 → 每次开机都重划一遍（B6 红）',
  swap('if(!cur||localStorage.getItem("at_reslice_build")===cur){ out.ran=-1; return out; }',
    'if(!cur){ out.ran=-1; return out; }', 'm8'),
  ['B6']);

expectRed('nrs_m9', 'M9', '跑完不记构建号 → 每次都当首跑重算（B3 红）',
  swap('localStorage.setItem("at_reslice_build",cur);', 'void 0;', 'm9'),
  ['B3']);

expectRed('nrs_m10', 'M10', '接线没接进开机流程（0b 那行拆掉）→ 存量永远不动（S2 红）',
  swap('try{ bootSeasonReslice(); }catch(e){}', 'try{ void 0; }catch(e){}', 'm10'),
  ['S2']);

expectRed('nrs_m11', 'M11', '这一趟不写回执 → 下次核数只能靠猜（B10/B10b 红）',
  swap('localStorage.setItem("at_reslice_last",JSON.stringify({b:cur,t:Date.now(),sliced:out.sliced,remapped:out.remapped,refuse:out.refuse,skipped:out.skipped}));',
       'void 0;', 'm11'),
  ['B10', 'B10b']);
/* total 那行两处（零进度分支 + 平移分支）一起拆：R12/R14 必须红，R13 必须仍绿
   （R13 断的是「手填的数不许动」，拆了它反而更不动——红它就是把判据压错了地方）。 */
expectRed('nrs_m12', 'M12', '切完不跟着改界面上那个「N 集」→ 表收了、数还写 34（R12/R14 红，R13 仍绿）',
  src.split('if(!oldTot||oldTot===total) s.total=keep.length;').join(''),
  ['R12', 'R14'], ['R13']);
console.log('\n==== reslice-negative: pass=' + pass + ' fail=' + fail + ' ====');
/* 收尾：把门禁那份报告刷回真身——子进程跑复制品时会覆盖 last-reslice.json，
   盘上留个复制品的数，下一轮读它的人就上当了。 */
runGate(path.join(ROOT, 'index.html'));
fs.writeFileSync(path.join(__dirname, 'last-reslice-negative.json'),
  JSON.stringify({ pass: pass, fail: fail, reds: bad }, null, 1), 'utf8');
if (fail) { console.log('红的负测：' + bad.join(' | ')); process.exit(1); }
