/* v2.12.0 右键菜单：纯逻辑层单元测试（毫秒级，无浏览器）
   v2.14.0：查重/片单整理/高级设置按用户指令移除，相关用例（原 G/L/S22–S26）随之退役；
   normTxt 保留（搜索归一化仍在用），只测它。
   方法：按起止标记从 index.html slice 出代码块，eval 进隔离作用域后断言。
   坑（技能里已记）：eval 里顶层 return 会报 Illegal return statement，必须 new Function 包裹。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function sliceBetween(a, b) {
  const i = html.indexOf(a);
  if (i < 0) throw new Error('找不到起点标记：' + a);
  const j = html.indexOf(b, i);
  if (j < 0) throw new Error('找不到终点标记：' + b);
  return html.slice(i, j);
}

let pass = 0, fail = 0;
const failures = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; failures.push(id + ' ' + desc + (extra ? '  :: ' + extra : '')); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}

/* ---------- 1. normTxt 纯函数（搜索归一化，查重退役后仍在用） ---------- */
console.log('--- normTxt 标题归一化 ---');
const normLine = html.slice(html.indexOf('function normTxt('));
const normEnd = normLine.indexOf('\n');
const normSrc = normLine.slice(0, normEnd);
const util = (function () {
  const f = new Function(normSrc + '\n; return { normTxt: normTxt };');
  return f();
})();
const normTxt = util.normTxt;

check('N1', '全角/半角与空格归一：海贼王 = 海 贼 王', normTxt('海贼王') === normTxt('海  贼 王'), normTxt('海  贼 王'));
check('N2', '大小写归一：One Piece = ONE PIECE', normTxt('One Piece') === normTxt('ONE PIECE'));
check('N3', '标点归一：海贼王！ = 海贼王', normTxt('海贼王！') === normTxt('海贼王'));
check('N4', '空值安全：null → 空串', normTxt(null) === '', JSON.stringify(normTxt(null)));
check('N5', '「海贼王」与「海贼王 剧场版」不同（这是关键：不能判成重复）',
  normTxt('海贼王') !== normTxt('海贼王 剧场版'),
  normTxt('海贼王') + ' vs ' + normTxt('海贼王 剧场版'));


/* ---------- 2. 结构性断言：读源码确认真实接线在位 ---------- */
console.log('\n--- 结构性断言（读源码）---');
function has(s) { return html.indexOf(s) >= 0; }
function countOcc(s) { return html.split(s).length - 1; }

check('S1', '存在通用右键菜单引擎 openCtx / closeCtx', has('function openCtx(') && has('function closeCtx('));
check('S2', '存在 bindCtx（右键 + 长按双通道）', has('function bindCtx('));
check('S3', '长按 500ms 触发（与右键同一套 openCtx）', has('}, 500);') && has('_ctxLongPress'));
check('S4', '长按后阻止紧随的 click（避免误开详情页）', has('if (_ctxLongPress) {') && has('el.addEventListener(\'click\', function once(ev)'));
check('S5', '手指移动 >12px 取消长按（区分滚动与长按）', has('> 12 ||') || has('> 12)'));
check('S6', 'contextmenu 全局委托，只接管 .ctxable', has("closest('.ctxable')"));
check('S7', '菜单超出视口时自动回弹到可见区', has('if (L + w > mx - 8)') && has('if (T + hh > my - 8)'));
check('S8', 'Esc / 滚动 / resize / 点别处 都会关菜单',
  has("e.key === 'Escape'") && has("document.addEventListener('scroll', closeCtx, true)") && has("window.addEventListener('resize', closeCtx)"));
check('S9', '方向键可在菜单项间移动（键盘可达）', has("e.key === 'ArrowDown' || e.key === 'ArrowUp'"));

/* 三个挂载点都在 */
check('S10', '片单卡片挂了 bindCtx（.show[data-sid]）', has(".show[data-sid]") && has('openShowCtx('));
check('S11', '片单卡片真的带上了 data-sid 属性', has("'<div class=\"show\" data-sid=\"'"));
/* v2.17.0：片单主列表行是 .show[data-sid]；封面墙那套 .cards/.grid 随「工具」一起退役了 */
check('S11b', '片单行渲染后统一挂 bindCtx（querySelectorAll 取 .show[data-sid]）', has("querySelectorAll('.show[data-sid]')"));
check('S12', '搜索结果卡挂了 bindCtx（.sr[data-tv]）', has(".sr[data-tv]") && has('openSrCtx('));
check('S13', '搜索结果卡真的带上了 data-tv 属性', has('data-tv="'));
check('S14', '搜索结果缓存了 __srCache 供菜单取标题', has('window.__srCache'));
check('S15', '剧集行挂了 bindCtx（.eprow[data-ep]）', has(".eprow[data-ep]") && has('openEpCtx('));
check('S16', '剧集行真的带上了 data-ep 属性', has("class=\"eprow'+cls+'\" data-ep=\"'"));

/* 菜单内容符合用户要求 */
check('S17', '片单菜单含「从片单移除」（用户要的删除番剧）', has("t: '从片单移除'"));
check('S18', '剧集菜单含「标记到这一集为止」（批量标记）', has("t: '标记到这一集为止'"));
check('S19', '剧集菜单含「改来源标注」（复用既有 editSrc）', has("t: '改来源标注（当前：'") && has('editSrc(+n)'));
check('S20', '搜索菜单含「加入片单」', has("t: '加入片单'"));
check('S21', '复制功能有 clipboard + execCommand 双兜底', has('navigator.clipboard.writeText') && has("document.execCommand('copy')"));

/* 重复检测接线 —— v2.14.0 已按用户指令移除（原 S22–S26 退役） */

/* 不能破坏既有功能 */
check('S27', 'normTxt 只有一个定义（我中途加过重复定义，必须已清掉）', countOcc('function normTxt(') === 1, 'count=' + countOcc('function normTxt('));
check('S28', 'delShow 走主题弹窗且保留移除语义（v2.13.0 起原生 confirm 全面退役）', has('function delShow(){') && has("uiConfirm('从片单移除《'") && has('tombPut(sidSnap)'));
check('S29', 'cycleEp 未被改动（剧集行原点击行为保留）', has('function cycleEp(n){'));
check('S30', 'addShow 去重逻辑未被改动', has('已在片单：《') && has('（未重复添加）'));
check('S31', 'CSS 有 .ctxmenu 且定义了 on 态', has('.ctxmenu{') && has('.ctxmenu.on{'));
check('S32', '深色主题有 ctxmenu 适配', has('html[data-theme=dark] .ctxmenu'));

/* 菜单项不泄漏脏串 */
check('S33', '菜单标题用 esc() 转义（防 XSS / 防脏串）', has("'<div class=\"ctxhd\">' + esc(head) + '</div>'"));
check('S34', '菜单项文案用 esc() 转义', has('esc(it.t)'));

/* v2.12.0 修的真实 bug：setEpStat 在 statuses 缺失时崩（Cannot set properties of undefined） */
console.log('\n--- setEpStat 防御性（statuses 缺失不能崩）---');
const sesSrc = sliceBetween('function setEpStat(', 'function cntWatched(');
function mkSetEpStat() {
  /* setEpStat 标完一集要盖「开始看」的时间戳（stampStart），这段是从 index.html 里切出来的真函数，
     不是空壳替身：哪天那个函数被改名或删掉，这里会当场报 ReferenceError，而不是静默放行。 */
  const stampSrc = (html.match(/function stampStart\([^\n]*\n/) || [''])[0];
  const f = new Function('SHOW', `
    var s = SHOW;
    function epStat(s,n){ var v=(s.statuses||{})[n]; return v===undefined?null:v; }
    ${stampSrc}
    ${sesSrc}
    return { setEpStat: setEpStat, epStat: epStat };
  `);
  return f;
}
check('E1', 'setEpStat 有 statuses 补位（源码层面）', has('if(!s.statuses) s.statuses={};'));
check('E2', 'cntWatched / cntRewatch 用 (s.statuses||{}) 读', has('var o=s.statuses||{}, n=0; for(var k in o){ if(o[k]===\'watched\')'));

/* 真跑一遍：残缺记录（无 statuses）标记第一集不能抛错 */
let eRun = null, eErr = null;
try {
  const s = { sid: 'x', eps: [{ s: 1 }, { s: 2 }] };   /* 故意不给 statuses */
  const f = mkSetEpStat();
  const inst = f(s);
  inst.setEpStat(s, '1', 'watched');
  inst.setEpStat(s, '2', 'rewatch');
  eRun = { st1: inst.epStat(s, '1'), st2: inst.epStat(s, '2') };
} catch (err) { eErr = err.message; }
check('E3', '残缺记录（无 statuses）标记两集不抛错且写入正确',
  !eErr && eRun && eRun.st1 === 'watched' && eRun.st2 === 'rewatch', eErr || JSON.stringify(eRun));

console.log('\n' + '='.repeat(50));
console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
if (fail) { console.log('\n失败项：'); failures.forEach(f => console.log('  - ' + f)); }
fs.writeFileSync(path.join(__dirname, 'last-ctxmenu-logic.json'),
  JSON.stringify({ pass, fail, failures, at: new Date().toISOString() }, null, 2));
process.exit(fail ? 1 : 0);
