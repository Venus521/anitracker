/* v2.12.0 右键菜单 + 重复检测：纯逻辑层单元测试（毫秒级，无浏览器）
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

/* ---------- 1. normTxt / dupSeverity / findAllDupGroups 纯函数 ---------- */
console.log('--- normTxt 标题归一化 ---');
/* normTxt 在 1567 行（在 dupSeverity 之后），单独 slice 它一行 */
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

console.log('\n--- dupSeverity 分级（same / maybe）---');
/* dupSeverity 依赖 normTxt，必须一起注入作用域（踩过：只 slice 它自己 → ReferenceError） */
const sevSrc = sliceBetween('function dupSeverity(', '/* 把检测结果渲染');
const sev = (function () {
  const f = new Function(normSrc + '\n' + sevSrc + '\n; return { dupSeverity: dupSeverity };');
  return f();
})();
const dupSeverity = sev.dupSeverity;

/* 关键语义：findAllDupGroups 已按 year|total 预分组，
   所以进入同一组的 item 天然是同年同集数 → same。
   标题不一致时才降级为 maybe。 */
check('D1', '同标题同年同集数 → same',
  dupSeverity({ items: [{ title: '海贼王', year: '1999', total: 100 }, { title: '海贼王', year: '1999', total: 100 }] }) === 'same');
check('D2', '组内标题归一后相同 → same',
  dupSeverity({ items: [{ title: 'One Piece', year: '1999', total: 100 }, { title: 'ONE PIECE', year: '1999', total: 100 }] }) === 'same');
check('D3', '组内标题不同（同条目不同译名）→ maybe',
  dupSeverity({ items: [{ title: '海贼王', year: '1999', total: 100 }, { title: '航海王', year: '1999', total: 100 }] }) === 'maybe');
check('D4', '全角/标点差异归一后仍算同名 → same',
  dupSeverity({ items: [{ title: '海贼王！', year: '1999', total: 100 }, { title: '海 贼 王', year: '1999', total: 100 }] }) === 'same');
/* 缺字段时不应崩 */
const dNoYear = dupSeverity({ items: [{ title: 'A', total: 10 }, { title: 'A', total: 10 }] });
check('D5', '缺 year 时不崩且判 same', dNoYear === 'same', dNoYear);

/* findAllDupGroups：核心正确性——同名但 year|total 不同的作品不能被判成重复组
   注意：它读的是全局 shows、不收参数。做法：在包裹函数的作用域里声明 shows，
   再把 slice 出来的源码塞进去 —— 这样函数闭包捕获到的就是我们的 fixture。 */
console.log('\n--- findAllDupGroups 预分组（防误报关键）---');
const fadSrc = sliceBetween('function sortBySid(', '/* 把检测结果渲染');
function dupOn(fixture) {
  const f = new Function('shows', normSrc + '\n' + fadSrc +
    '\n; return findAllDupGroups();');
  return f(fixture);
}

/* 真重复：两条 2023·8集 同标题 */
const g1 = dupOn([
  { sid: 'a', title: '葬送的芙莉莲', year: '2023', total: 8 },
  { sid: 'b', title: '葬送的芙莉莲', year: '2023', total: 8 }
]);
check('G1', '真重复（同标题同年同集数）→ 检出 1 组',
  g1.length === 1 && g1[0].items.length === 2, JSON.stringify(g1.map(x => x.items.length)));

/* 误报场景：海贼王 TV 1168集 + 海贼王 剧场版 41集 —— 必须 0 组重复 */
const g2 = dupOn([
  { sid: 'd-one-piece', title: '海贼王', year: '1999', total: 1168 },
  { sid: 'mv-op', title: '海贼王', year: '2000', total: 41 }
]);
check('G2', '同名但年/集数不同 → 0 组重复（这是用户看到的「为什么有两个」）',
  g2.length === 0, JSON.stringify(g2.map(x => x.items.map(i => i.sid))));

/* 三胞胎：两条真重复 + 一条剧场版 → 只 1 组、组内 2 条 */
const g3 = dupOn([
  { sid: 'a', title: 'X', year: '2020', total: 12 },
  { sid: 'b', title: 'X', year: '2020', total: 12 },
  { sid: 'c', title: 'X', year: '2000', total: 41 }
]);
check('G3', '两真重复 + 一同名不同作品 → 只 1 组且组内 2 条（剧场版不入组）',
  g3.length === 1 && g3[0].items.length === 2,
  JSON.stringify(g3.map(x => x.items.map(i => i.sid))));

/* bgmId 相同即同一条目 */
const g4 = dupOn([
  { sid: 'a', title: '甲', bgmId: 999 },
  { sid: 'b', title: '乙（异名同条目）', bgmId: 999 }
]);
check('G4', 'bgmId 相同 → 检出 1 组',
  g4.length === 1, JSON.stringify(g4.map(x => x.items.map(i => i.sid))));

/* 空输入不崩 */
const g5 = dupOn([]);
check('G5', '空片单不崩', Array.isArray(g5) && g5.length === 0, JSON.stringify(g5));

/* renderDupReport 的 lookalikes：前缀关系（「海贼王」⊂「海贼王 剧场版」）必须被收进来。
   归一化后两者并不相等（海贼王 vs 海贼王剧场版），只靠「同名」抓不到 —— 这正是
   用户问「为什么航海王有两个」却报告说「没有发现重复」的根因。 */
console.log('\n--- lookalikes：前缀关系兜底 ---');
const lkSrc = sliceBetween('function renderDupReport(', 'var AT_VERSION=');
function lookOn(fixture) {
  const f = new Function('shows', `var document={getElementById:function(){return null}};
    function esc(x){return String(x);}
    function removeShowBySid(){}
    ${normSrc}
    ${fadSrc}
    ${lkSrc}
    var _box = { innerHTML: '' };
    renderDupReport(_box);
    return _box.innerHTML;`);
  return f(fixture);
}
const lkOut = lookOn([
  { sid: 'd-one-piece', title: '海贼王', year: '1999', total: 1168 },
  { sid: 'mv-op', title: '海贼王 剧场版', year: '2000', total: 41 },
]);
check('L1', '「海贼王」TV 与「海贼王 剧场版」被归入「同名但不同的作品」',
  /同名但不同的作品/.test(lkOut), lkOut.slice(0, 200).replace(/</g, '‹'));
check('L2', '该类明确写「不是重复数据，无需处理」', /不是重复数据，无需处理/.test(lkOut));
check('L3', '该类不出现「疑似重复」标题（不给移除按钮）',
  !/组疑似重复/.test(lkOut) && !/移除<\/button>/.test(lkOut));

/* 无关的两条不该被前缀规则误收 */
const lkNone = lookOn([
  { sid: 'a', title: '葬送的芙莉莲', year: '2023', total: 28 },
  { sid: 'b', title: '进击的巨人', year: '2013', total: 25 },
]);
check('L4', '两条无关的作品 → 报告说「没有发现重复」', /没有发现重复番剧/.test(lkNone), lkNone.slice(0, 160));

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
check('S12', '搜索结果卡挂了 bindCtx（.sr[data-bgm]）', has(".sr[data-bgm]") && has('openSrCtx('));
check('S13', '搜索结果卡真的带上了 data-bgm 属性', has('data-bgm="'));
check('S14', '搜索结果缓存了 __srCache 供菜单取标题', has('window.__srCache'));
check('S15', '剧集行挂了 bindCtx（.eprow[data-ep]）', has(".eprow[data-ep]") && has('openEpCtx('));
check('S16', '剧集行真的带上了 data-ep 属性', has("class=\"eprow'+cls+'\" data-ep=\"'"));

/* 菜单内容符合用户要求 */
check('S17', '片单菜单含「从片单移除」（用户要的删除番剧）', has("t: '从片单移除'"));
check('S18', '剧集菜单含「标记到这一集为止」（批量标记）', has("t: '标记到这一集为止'"));
check('S19', '剧集菜单含「改来源标注」（复用既有 editSrc）', has("t: '改来源标注（当前：'") && has('editSrc(+n)'));
check('S20', '搜索菜单含「加入片单」', has("t: '加入片单'"));
check('S21', '复制功能有 clipboard + execCommand 双兜底', has('navigator.clipboard.writeText') && has("document.execCommand('copy')"));

/* 重复检测接线 */
check('S22', '存在 findAllDupGroups（按标题 + 按 bgmId 双路查）', has('function findAllDupGroups(') && has('byBgm'));
check('S23', '账号面板新增「片单整理」卡', has('片单整理') && has('id="optDupScan"'));
check('S24', '查重按钮已接线 renderDupReport', has("_dupBtn.onclick") && has('function renderDupReport('));
check('S25', '报告区分「疑似重复」与「同名不同作品」两类', has('组疑似重复') && has('同名但不同的作品'));
check('S26', '同名不同作品那类明确写「不是重复数据」', has('不是重复数据，无需处理'));

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
const sesSrc = sliceBetween('function setEpStat(', 'function fmtTs(');
function mkSetEpStat() {
  const f = new Function('SHOW', `
    var s = SHOW;
    function epStat(s,n){ var v=(s.statuses||{})[n]; return v===undefined?null:v; }
    function pushHist(){}
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
