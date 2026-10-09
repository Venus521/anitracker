/* v2.48.0 门禁：查询剥壳 + 季级集数（纯逻辑，毫秒级，无浏览器）
   为什么要有这一份：这两条都只在「联网 + 有 tvId」时才走得到，
   浏览器门禁掐着网络跑不到，人工点又得等限流——所以按 ctxmenu-logic.js 的路子，
   把函数从 index.html 里 slice 出来 eval 进隔离作用域，直接喂实测数据断言。
   数据全来自 2026-10-09 本机逐个打 TVMaze 的真实返回（见 index.html 里的注释），
   负测：AT_PAGE 指到改动前那份（git show 851a6cc:index.html，底本钉住旧提交而不是 HEAD），必须红。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = process.env.AT_PAGE || 'index.html';
const html = fs.readFileSync(path.isAbsolute(PAGE) ? PAGE : path.join(ROOT, PAGE), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; failures.push(id + ' ' + desc + (extra ? '  :: ' + extra : '')); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}
function sliceBetween(startMark, endMark) {
  const i = html.indexOf(startMark);
  if (i < 0) throw new Error('找不到起点标记：' + startMark);
  const j = html.indexOf(endMark, i);
  if (j < 0) throw new Error('找不到终点标记：' + endMark);
  return html.slice(i, j);
}

/* ---------- 装载：normTxt + seasonSeqOf + queryBases + seasonRowsFor ----------
   负测那份（旧版页）里这些函数根本不存在：不许崩成 CRASH 把症状咽了，
   要按「功能缺失=什么都不剥、什么都不切」stub 掉，让该红的判据一条条红出来。 */
function sliceOpt(startMark, endMark, stubSrc, label) {
  if (html.indexOf(startMark) < 0) { console.log('NOTE 页里没有 ' + label + '，按缺失行为 stub'); return stubSrc; }
  /* 版本注释会跟着小版本挪（v2.48.0 季条目 → v2.49.0 季条目）：终点标记给一组，
     取页里最先出现的那个。只认一个死字符串的话，改一行注释就把闸门崩成 CRASH。 */
  var starts = html.indexOf(startMark);
  var ends = Array.isArray(endMark) ? endMark : [endMark];
  var pick = null;
  ends.forEach(function(m){ var j = html.indexOf(m, starts); if (j >= 0 && (pick === null || j < pick)) pick = j; });
  if (pick === null) throw new Error('找不到终点标记：' + ends.join(' | '));
  return html.slice(starts, pick);
}
let api;
try {
  const src = [
    sliceOpt('function normTxt(', '\n', "function normTxt(s){ return String(s==null?'':s).toLowerCase(); }", 'normTxt'),
    sliceOpt('var _CN_NUM=', '/* ===== v2.47.0 前缀指认', 'var _CN_NUM={};\n' +
      'function seasonSeqOf(){ return 0; }', 'seasonSeqOf'),
    sliceOpt('var SEASON_STRIP_PATS=', 'function queryBases(',
      'var SEASON_STRIP_PATS=[];\nfunction seasonStripTxt(v){ return String(v==null?"":v); }', 'SEASON_STRIP_PATS/seasonStripTxt'),
    sliceOpt('function queryBases(', ['/* ===== v2.48.0 季条目', '/* ===== v2.49.0 季条目'],
      'function queryBases(){ return []; }\nfunction latinBases(){ return []; }', 'queryBases/latinBases'),
    sliceOpt('function seasonRowsFor(', '/* 按剧名在全网库找一条',
      'function seasonRowsFor(s, all){ return (all||[]); }', 'seasonRowsFor'),
  ].join('\n');
  /* eval 里顶层 return 会报 Illegal return statement，必须 new Function 包裹（技能里的坑） */
  api = new Function(src + '\nreturn { normTxt: normTxt, seasonSeqOf: seasonSeqOf, queryBases: queryBases, latinBases: latinBases, cnBases: (typeof cnBases==="function"?cnBases:function(){ return []; }), seasonRowsFor: seasonRowsFor };')();
} catch (e) {
  console.log('CRASH 装载失败：' + e.message);
  fs.writeFileSync(path.join(__dirname, 'last-season-scope.json'), JSON.stringify({ pass, fail, failures, crash: String(e.message) }, null, 1));
  process.exit(1);
}
const normTxt = api.normTxt, queryBases = api.queryBases, latinBases = api.latinBases, seasonRowsFor = api.seasonRowsFor, seasonSeqOf = api.seasonSeqOf;

/* ---------- 1. queryBases：只多问一次，剥的是「怎么问」 ---------- */
console.log('--- queryBases 查询剥壳 ---');
function bases(k) { return JSON.stringify(queryBases(k)); }
check('Q1', '英文尾巴型：Hilda Season 3 → Hilda（实测 raw 0 条 / clean 有图）',
  bases('Hilda Season 3') === '["Hilda"]', bases('Hilda Season 3'));
check('Q2', '英文尾巴型：Amphibia Season 2 → Amphibia',
  queryBases('Amphibia Season 2').indexOf('Amphibia') >= 0, bases('Amphibia Season 2'));
check('Q3', '中文尾巴型：希尔达 第三季 → 希尔达',
  queryBases('希尔达 第三季').indexOf('希尔达') >= 0, bases('希尔达 第三季'));
check('Q4', '日文中缀型：夏目友人帳 第七季 → 夏目友人帳',
  queryBases('夏目友人帳 第七季').indexOf('夏目友人帳') >= 0, bases('夏目友人帳 第七季'));
check('Q5', '正名含空格不误伤：Adventure Time with Finn and Jake Season 1 → Adventure Time with Finn and Jake',
  bases('Adventure Time with Finn and Jake Season 1') === '["Adventure Time with Finn and Jake"]',
  bases('Adventure Time with Finn and Jake Season 1'));
check('Q6', '裸数字尾巴一律不剥：龙樱2 → 空（与 v2.44.3 同口径）',
  queryBases('龙樱2').length === 0, bases('龙樱2'));
check('Q7', '切不出季的尾巴不剥：夏目友人帳 漆 → 空（剥中了也只会拿回整部 86 集，把「没封面」换成「集数不对」）',
  queryBases('夏目友人帳 漆').length === 0, bases('夏目友人帳 漆'));
check('Q8', '没尾巴的原名不重复产出：Hilda → 空',
  queryBases('Hilda').length === 0, bases('Hilda'));
check('Q9', '空值安全：null / 空串 → 空数组',
  queryBases(null).length === 0 && queryBases('   ').length === 0);
check('Q10', '最多给 2 个变体（别把 8 次查询预算一次花光）',
  queryBases('进击的巨人 第二季 Season 2 Attack on Titan Season 2').length <= 2,
  bases('进击的巨人 第二季 Season 2 Attack on Titan Season 2'));
check('Q11', 'S1 缩写型也剥：Frasier S1 → Frasier',
  queryBases('Frasier S1').indexOf('Frasier') >= 0, bases('Frasier S1'));
check('Q12', 'S 型不吃单词：Showtime S1E2 之类带连号的正名不被动（边界要求）',
  queryBases('Grand S2E5 Special').length === 0, bases('Grand S2E5 Special'));
/* 一把尺：凡是 queryBases 肯剥的标题，seasonSeqOf 必须也认得这一季——
   否则剥中了拿回的是整部连号集表，等于把「没封面」换成「集数不对」。 */
const _scale=['Hilda Season 3','Amphibia Season 2','希尔达 第三季','夏目友人帳 第七季',
  'Adventure Time with Finn and Jake Season 1','Frasier S1','进击的巨人 第二季 Season 2 Attack on Titan Season 2',
  '龙樱2','夏目友人帳 漆','某剧 第三期','Show Part 2','某番 2クール目','Hilda',''];
let _off=[];
_scale.forEach(function(t){ queryBases(t).forEach(function(b){ if(!seasonSeqOf(t)) _off.push(t+'→'+b); }); });
check('Q13', '一把尺：queryBases 剥过的每一条，seasonSeqOf 都认得这一季（' + _scale.length + ' 条采样）',
  _off.length === 0, _off.join(' | '));

/* ---------- 2. latinBases：双语名里那整段英文原名（实测 17/77 的来路） ---------- */
console.log('\n--- latinBases 拉丁整段 ---');
function lat(k) { return JSON.stringify(latinBases(k)); }
check('L1', '豆瓣双语名：希尔达 第三季 Hilda Season 3 → Hilda',
  latinBases('希尔达 第三季 Hilda Season 3').indexOf('Hilda') >= 0, lat('希尔达 第三季 Hilda Season 3'));
check('L2', '多词正名整段拿：致命女人 第一季 Why Women Kill Season 1 → Why Women Kill',
  latinBases('致命女人 第一季 Why Women Kill Season 1').indexOf('Why Women Kill') >= 0,
  lat('致命女人 第一季 Why Women Kill Season 1'));
check('L3', '带标点的名字整段拿（点号被 normTxt 吃掉，无所谓）：Star vs. the Forces of Evil',
  latinBases('星蝶公主 第一季 Star vs. the Forces of Evil Season 1')
    .some(function(v){ return normTxt(v) === normTxt('Star vs. the Forces of Evil'); }),
  lat('星蝶公主 第一季 Star vs. the Forces of Evil Season 1'));
check('L4', '小写也算名：人生删除事务所 dele ディーリー → dele',
  latinBases('人生删除事务所 dele ディーリー').indexOf('dele') >= 0, lat('人生删除事务所 dele ディーリー'));
/* 反例①（实测踩过）：中文正名里夹的拉丁碎片绝不能当名——'Flag' 在 TVMaze 是另一部真剧 */
check('L5', '中文正名里夹的拉丁碎片不摘（破灭Flag → 不能出 Flag，出了就是错封面）',
  latinBases('转生成为了只有乙女游戏破灭Flag的邪恶大小姐 第二季 乙女ゲームの破滅フラグしかない悪役令嬢に転生してしまった… X')
    .every(function(v){ return normTxt(v) !== normTxt('Flag'); }),
  lat('转生成为了只有乙女游戏破灭Flag的邪恶大小姐 第二季'));
/* 反例②：汉字与拉丁粘连的 token 整段不算名（'JIN-仁2' 里那截 JIN 拿不到 = 宁缺勿错） */
check('L6', '汉字粘连的 token 整段不认：仁医 完结篇 JIN-仁2 → 不产出 JIN',
  latinBases('仁医 完结篇 JIN-仁2').every(function(v){ return normTxt(v) !== 'jin'; }),
  lat('仁医 完结篇 JIN-仁2'));
/* 反例③：只做整段，不做前缀砍尾 */
check('L7', '不做砍尾：怪诞小镇迷你剧 第一季 Gravity Falls Shorts Season 1 只给整段，绝不给 Gravity Falls',
  (function(){ const a = latinBases('怪诞小镇迷你剧 第一季 Gravity Falls Shorts Season 1');
    return a.indexOf('Gravity Falls Shorts') >= 0 && a.indexOf('Gravity Falls') < 0; })(),
  lat('怪诞小镇迷你剧 第一季 Gravity Falls Shorts Season 1'));
check('L8', '连接词收尾的整段照样拿（Adventure Time with Finn and Jake 是一段，不砍）',
  latinBases('探险活宝 第一季 Adventure Time with Finn and Jake Season 1')
    .indexOf('Adventure Time with Finn and Jake') >= 0,
  lat('探险活宝 第一季 Adventure Time with Finn and Jake Season 1'));
/* L9 的判据写法吃过一次亏：原先只断言「不产出 Fourth Stage」，负测把 LATIN_STOP
   那道闸整行拆掉仍然全绿——因为真身按空格分词，那条标题实际摘出来的是 'Stage'，
   断言压根没压在它身上。改成「一条候选都不许有」，拆闸才真的红（见负测 M10）。
   实测（同日打 TVMaze search=Stage）：返回 10 条但没有一条正名叫 Stage
   （Stage Stars / Bonus Stage / Love Stage!!…），归一化全等闸当场挡住；
   所以今天少问一次的代价还没变成错封面——但这道闸拦的是同一类
   （Second Season / Part 2 / Ex 这类「不是片名的拉丁段」），留着。 */
check('L9', '整段全是季/阶段词就不当名：头文字D 第四季 頭文字D：Fourth Stage → 一条候选都不产出',
  latinBases('头文字D 第四季 頭文字D：Fourth Stage').length === 0,
  lat('头文字D 第四季 頭文字D：Fourth Stage'));
check('L9b', '空格连写的纯阶段词整段（Fourth Stage / Second Season）一律不当名',
  latinBases('头文字D 第四季 Fourth Stage').length === 0
    && latinBases('某剧 Second Season').length === 0,
  lat('头文字D 第四季 Fourth Stage') + ' || ' + lat('某剧 Second Season'));
check('L10', '纯中文名没有拉丁段：大宋提刑官 → 空；空值安全 null → 空',
  latinBases('大宋提刑官').length === 0 && latinBases(null).length === 0);
check('L11', '与原名相同的不重复产出：Hilda → 空（原名叫已经问过了）',
  latinBases('Hilda').length === 0, lat('Hilda'));
check('L12', '最多 2 段（查询预算要留着）',
  latinBases('剧名 Alpha Beta Gamma 第二季 Gamma Beta Alpha').length <= 2,
  lat('剧名 Alpha Beta Gamma 第二季 Gamma Beta Alpha'));
/* 总判据（把上面几条收口）：摘出来的每一段，必须是原标题里**完整的空格分词**——
   「破灭Flag」那种从汉字中间抠出来的碎片，一律不许出现在候选里。 */
const _tokTitles=['希尔达 第三季 Hilda Season 3','致命女人 第一季 Why Women Kill Season 1',
  '星蝶公主 第一季 Star vs. the Forces of Evil Season 1','怪诞小镇迷你剧 第一季 Gravity Falls Shorts Season 1',
  '探险活宝 第一季 Adventure Time with Finn and Jake Season 1',
  '转生成为了只有乙女游戏破灭Flag的邪恶大小姐 第二季 乙女ゲームの破滅フラグしかない悪役令嬢に転生してしまった… X',
  '头文字D 第四季 頭文字D：Fourth Stage','人生删除事务所 dele ディーリー','大宋提刑官'];
function wholeToken(title, v){
  const toks=String(title).split(/[\s　]+/);
  const want=v.split(/[\s　]+/).map(function(x){ return normTxt(x); });
  for(let i=0;i+want.length<=toks.length;i++){
    let ok=true;
    for(let j=0;j<want.length;j++){ if(normTxt(toks[i+j])!==want[j]){ ok=false; break; } }
    if(ok) return true;
  }
  return false;
}
let _frag=[];
_tokTitles.forEach(function(t){ latinBases(t).forEach(function(v){ if(!wholeToken(t, v)) _frag.push(t.slice(0,14)+' → '+v); }); });
check('L13', '整段判据：'+_tokTitles.length+' 条采样里，候选全是原标题的完整分词（汉字里抠碎片=0 条）',
  _frag.length === 0, _frag.join(' | '));

/* ---------- 3. seasonRowsFor：季条目只拿本季，切不动就原样 ---------- */
console.log('\n--- seasonRowsFor 季级集数 ---');
/* 造一条整部连号的官方集表（就是 webRowsToEps 的产物形状：s=全书连号，sn/en=季内） */
function mkShow(seasons) {
  const rows = []; let n = 0;
  seasons.forEach((cnt, si) => {
    for (let e = 1; e <= cnt; e++) {
      n++;
      const sea = si + 1;
      rows.push({ s: n, sn: sea, en: e, t: 'S' + sea + 'E' + e + ' Ep' + e, tOrig: 'Ep' + e, dur: 25, air: '' });
    }
  });
  return rows;
}
function countScoped(s, all) { return seasonRowsFor(s, all).length; }

const hilda = mkShow([13, 13, 8]);          /* 实测：整部 34，第三季真值 8 */
check('E1', '希尔达 第三季：34 集整部 → 8 集（实测 TVMaze S3=8）',
  countScoped({ title: '希尔达 第三季' }, hilda) === 8, String(countScoped({ title: '希尔达 第三季' }, hilda)));
const natsume = mkShow([13, 13, 13, 13, 11, 11, 12]);   /* 实测 id12310：整部 86，第七季 12 */
check('E2', '夏目友人帳 第七季：整部 86 集 → 12 集（实测 S7=12）',
  countScoped({ title: '夏目友人帳 第七季' }, natsume) === 12, String(countScoped({ title: '夏目友人帳 第七季' }, natsume)));

/* 重排：季内号 1..n，sn 保持声明的那一季，en 原样 */
const scopedHilda = seasonRowsFor({ title: '希尔达 第三季' }, hilda);
check('E3', '重排后编号是本季内 1..8（不再是全书 27..34）',
  scopedHilda.map(e => e.s).join(',') === '1,2,3,4,5,6,7,8', scopedHilda.map(e => e.s).join(','));
check('E4', '重排后 sn=3 / en=1..8 保留（canonEpList 靠 sn-en 对官方集名）',
  scopedHilda.every(e => e.sn === 3) && scopedHilda[7].en === 8, JSON.stringify(scopedHilda[7]));
check('E5', '原表没被改坏（返回的是新对象，整部表仍是 34 行）',
  hilda.length === 34 && hilda[26].s === 27, String(hilda[26].s));
/* 幂等：拿同一份整部表再切一次，结果必须一模一样 */
check('E6', '幂等：连切两次结果相同',
  JSON.stringify(seasonRowsFor({ title: '希尔达 第三季' }, hilda)) === JSON.stringify(scopedHilda));

/* 护栏①：没声明季 / 库里没这一季 / 整部就这一季 → 原样返回（同一引用，绝不猜） */
check('G1', '没声明季号：希尔达 → 原样整部（同一引用）',
  seasonRowsFor({ title: '希尔达' }, hilda) === hilda);
check('G2', '库里查不到那一季：希尔达 第五季 → 原样整部（不猜）',
  seasonRowsFor({ title: '希尔达 第五季' }, hilda) === hilda);
const oneSeason = mkShow([8]);
check('G3', '整部就一季：Friends Season 1 → 原样（filter 等于全表时不动）',
  seasonRowsFor({ title: 'Friends Season 1' }, oneSeason) === oneSeason);

/* 护栏②：本地行号或观看标记超过「本季集数」= 这套编号是整部连号，切了会把进度挪到别的季 */
const alreadyWhole = { title: '希尔达 第三季', eps: hilda.map(e => ({ s: e.s })), statuses: { '5': 'watched' } };
check('G4', '本地已按整部填过（34 行）→ 原样整部，不错改用户进度',
  seasonRowsFor(alreadyWhole, hilda) === hilda);
const markBeyond = { title: '希尔达 第三季', eps: [], statuses: { '30': 'watched' } };
check('G5', '标记落在 30 集（超过本季 8）→ 原样整部',
  seasonRowsFor(markBeyond, hilda) === hilda);
const epTBeyond = { title: '希尔达 第三季', eps: [], statuses: {}, epT: { '12': 1 } };
check('G6', '时间戳 epT 落在 12 集（超过本季 8）→ 原样整部',
  seasonRowsFor(epTBeyond, hilda) === hilda);

/* 反过来：占位集 + 季内标记，必须照切，且标记一条不动 */
const phItem = {
  title: '希尔达 第三季',
  eps: [1, 2, 3, 4, 5, 6, 7, 8].map(k => ({ s: k, t: '第 ' + k + ' 集', ph: 1 })),
  statuses: { '1': 'watched', '2': 'watched', '3': 'watched' }, epT: { '3': 1727000000000 },
};
const phScoped = seasonRowsFor(phItem, hilda);
check('G7', '占位集（1..8）+ 季内进度 → 照样切成 8 集', phScoped.length === 8, String(phScoped.length));
check('G8', '切完不碰用户标记：statuses 仍是 1/2/3，epT 仍是 3',
  JSON.stringify(phItem.statuses) === '{"1":"watched","2":"watched","3":"watched"}' &&
  JSON.stringify(Object.keys(phItem.epT)) === '["3"]', JSON.stringify(phItem.statuses) + '|' + JSON.stringify(phItem.epT));

/* 日番「部/篇」型标题：seasonSeqOf 认得的也要能切 */
const two = mkShow([12, 13]);
check('G9', '英文 Season N 型：Demo Season 2 → 拿第二季那 13 集',
  countScoped({ title: 'Demo Season 2' }, two) === 13, String(countScoped({ title: 'Demo Season 2' }, two)));
check('G10', '只有 nameJp 带季号时也能识别（标题英文、日文名标季）',
  countScoped({ title: 'Some Show', nameJp: 'ある某 第二部' }, two) === 13,
  String(seasonSeqOf('ある某 第二部')) + '/' + String(countScoped({ title: 'Some Show', nameJp: 'ある某 第二部' }, two)));
check('G11', '空表 / 缺参不炸',
  seasonRowsFor({ title: '希尔达 第三季' }, []).length === 0 && seasonRowsFor(null, hilda) === hilda);

/* ---------- 3. 结构性断言：接线在位，身份判据一条没松 ---------- */
console.log('\n--- 结构性断言（读源码）---');
function has(s) { return html.indexOf(s) >= 0; }
function countOcc(s) { return html.split(s).length - 1; }
check('S1', 'queryBases / seasonRowsFor 都在页里定义', has('function queryBases(') && has('function seasonRowsFor('));
check('S2', '旧的 seasonScopeEps 已退役（两条路共用一套判据，不留半成品）',
  countOcc('seasonScopeEps') === 0, String(countOcc('seasonScopeEps')));
check('S3', 'webMatchShow 把剥壳与拉丁整段都排在原名之后追加（先给原名叫机会）',
  has('queryBases(k).concat(latinBases(k)).forEach(function(b){ if(b&&tries.indexOf(b)<0) tries.push(b); });'));
check('S3b', 'cnShowBySearch 也用这两把钥匙（国剧双语名那条路）',
  has('queryBases(cur).concat(latinBases(cur)).forEach'));
check('S4', 'webMatchShow 的身份判据仍是归一化全等（多问几次，没松闸）',
  has('if(normTxt(x.name)===normTxt(tries[i])||normTxt(x.name)===want) hit=x;'));
check('S5', 'cnShowBySearch 的三道闸仍在：language=Chinese + 只认第 1 条 + 必须带图',
  has("String(top.language||'')!=='Chinese'") &&
  has('var top=arr[0];') && has('var u=webCoverOf(top);'));
check('S6', '加片补齐（webFillEpisodes）按季切', has('eps=seasonRowsFor(cur,eps);'));
check('S7', '手动补齐（fillEpisodesNow）按季切', has('eps=seasonRowsFor(s,eps);'));
check('S8', '刷名（refreshNamesFor）建索引前先按季切', has('s.__webEps=seasonRowsFor(s,we);'));
check('S9', 'webMatchShow 查询预算 8 次（实测本机打 TVMaze 一条约 0.24 秒，8 次约 2 秒），不是无限重试',
  has('for(var i=0;i<tries.length&&i<8;i++){'));
check('S10', '季号标记只有一处定义（queryBases / latinBases / seasonSeqOf 同一把尺靠它）',
  countOcc('var SEASON_STRIP_PATS=[') === 1 && has('function seasonStripTxt(') &&
  has('var pats=SEASON_STRIP_PATS;') && has('var s=seasonStripTxt(raw);'),
  'SEASON_STRIP_PATS 定义 ' + countOcc('var SEASON_STRIP_PATS=[') + ' 处');
check('S11', '拉丁段按「整段是拉丁的空格分词」认（不是按字符扫，那条会摘出「破灭Flag」的 Flag）',
  has('var TOK=/^[A-Za-z][A-Za-z0-9') && has('if(TOK.test(t)'));

/* ---------- 汇总 ---------- */
console.log('\n==== season-scope: pass=' + pass + ' fail=' + fail + ' (' + PAGE + ') ====');
fs.writeFileSync(path.join(__dirname, 'last-season-scope.json'),
  JSON.stringify({ page: PAGE, pass, fail, failures }, null, 1));
if (fail) process.exit(1);
