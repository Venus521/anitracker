/* v2.49.0 门禁：爱奇艺这一环的判据（纯逻辑，毫秒级，不联网、不开浏览器）
   为什么要这一份：豆瓣匿名搜索关门（403 need_login）之后，中文条目只剩这一条活路，
   而它偏偏是「同名不同作」最容易撞车的库（2026-10-09 本机实测：《爱情宝典》正片和一条片花、
   《致命女人》剧集和一条 161 集的音频节目，就排在同一个搜索结果里相邻两行）。
   判据只要松一格就上错封面，所以把函数从 index.html 里 slice 出来 eval 进隔离作用域，
   直接喂实测的接口 JSON 断言；联网那一跳留给墙页去量。
   用法：node tests/iq-source-check.js ；负测：node tests/iq-source-negative.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = process.env.AT_PAGE || 'index.html';
const LF = String.fromCharCode(10);
const html = fs.readFileSync(path.isAbsolute(PAGE) ? PAGE : path.join(ROOT, PAGE), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; failures.push(id + ' ' + desc + (extra ? '  :: ' + extra : '')); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}
/* 起点缺失 → 按「这功能根本没有」stub（不许崩成 CRASH 把症状咽了）；
   终点标记给一组：版本注释会跟着小版本挪，只认死字符串的话改一行注释就把闸门崩了。
   stub 源码里的换行写成 @NL@，装载时统一换回来（避免 JS 串里再套一层转义）。 */
function sliceOpt(startMark, endMarks, stubSrc, label) {
  if (html.indexOf(startMark) < 0) { console.log('NOTE 页里没有 ' + label + '，按缺失行为 stub'); return stubSrc; }
  const starts = html.indexOf(startMark);
  const ends = Array.isArray(endMarks) ? endMarks : [endMarks];
  let pick = null;
  ends.forEach(function (m) { const j = html.indexOf(m, starts); if (j >= 0 && (pick === null || j < pick)) pick = j; });
  if (pick === null) throw new Error('找不到终点标记：' + ends.join(' | '));
  return html.slice(starts, pick);
}

const STUB_NORM = 'function normTxt(s){ return String(s==null?"":s).toLowerCase(); }';
const STUB_STRIP = 'var SEASON_STRIP_PATS=[];@NL@function seasonStripTxt(v){ return String(v==null?"":v); }';
const STUB_QB = 'function queryBases(){ return []; }@NL@function latinBases(){ return []; }@NL@function cnBases(){ return []; }';
const STUB_IQ = 'var IQ_ANIME_CH={};var IQ_LIVE_CH={};@NL@' +
  'function iqIsAnime(){ return false; }@NL@function iqIsMovie(){ return false; }@NL@' +
  'function iqChAllow(){ return false; }@NL@function iqRows(){ return []; }@NL@' +
  'function iqKeys(){ return []; }@NL@function iqPick(){ return null; }@NL@' +
  'function iqCoverFor(){ return ""; }';

let api;
try {
  const src = [
    sliceOpt('function normTxt(', LF, STUB_NORM, 'normTxt'),
    sliceOpt('var _CN_NUM=', '/* ===== v2.47.0 前缀指认', 'var _CN_NUM={};@NL@function seasonSeqOf(){ return 0; }', 'seasonSeqOf'),
    sliceOpt('var SEASON_STRIP_PATS=', 'function queryBases(', STUB_STRIP, 'seasonStripTxt'),
    sliceOpt('function queryBases(', ['/* ===== v2.48.0 季条目', '/* ===== v2.49.0 季条目'], STUB_QB, 'queryBases/latinBases/cnBases'),
    sliceOpt('var IQ_ANIME_CH=', '/* v2.26.0：判断当前是否跑在', STUB_IQ, 'iq 那一整块'),
  ].join(LF).split('@NL@').join(LF);
  /* eval 里顶层 return 会报 Illegal return statement，必须 new Function 包裹（技能里的坑） */
  api = new Function(src + LF + 'return { normTxt: normTxt, seasonStripTxt: seasonStripTxt, queryBases: queryBases, latinBases: latinBases, cnBases: cnBases, iqIsAnime: iqIsAnime, iqIsMovie: iqIsMovie, iqChAllow: iqChAllow, iqRows: iqRows, iqKeys: iqKeys, iqPick: iqPick };')();
} catch (e) {
  console.log('CRASH 装载失败：' + e.message);
  fs.writeFileSync(path.join(__dirname, 'last-iq-source.json'), JSON.stringify({ pass, fail, failures, crash: String(e.message), page: PAGE }, null, 1));
  process.exit(1);
}
const cnBases = api.cnBases, iqRows = api.iqRows, iqKeys = api.iqKeys, iqPick = api.iqPick, iqChAllow = api.iqChAllow;

/* ---------- 实测夹具（2026-10-09 本机直打 search.video.iqiyi.com 原样抄回） ----------
   注意 channel 是「电视剧,2」这种「频道,权重」的串，图字段带的是 http 直链，
   命中词还被包了 <em> 高亮标签——解析层必须把这些都处理掉。 */
const FIX_AQBD = {data: {docinfos: [
  {albumDocInfo: {albumTitle: '<em>爱情宝典</em>', channel: '电视剧,2', itemTotalNumber: 26,
    albumVImage: 'http://pic0.iqiyipic.com/image/20240321/a3/19/a_50008670_m_601_m15.jpg'}},
  {albumDocInfo: {albumTitle: '《爱情宝典》：女人本以为找了个好老公，结果竟跳进了火坑', channel: '片花,10',
    albumVImage: 'http://m.iqiyipic.com/u2/image/20240306/29/e4/pv_7730973630005600_d_601.jpg'}},
]}};
const FIX_ZMN = {data: {docinfos: [
  {albumDocInfo: {albumTitle: '<em>致命女人</em>', channel: '电视剧,2', itemTotalNumber: 24,
    albumVImage: 'http://pic5.iqiyipic.com/image/20230110/a6/32/a_100526823_m_601.jpg'}},
  {albumDocInfo: {albumTitle: '致命女人：血色情杀录（音频）', channel: '教育,12', itemTotalNumber: 161,
    albumVImage: 'http://pic5.iqiyipic.com/image/20240321/26/b3/a_100568771_m_601.jpg'}},
]}};
const FIX_SGB = {data: {docinfos: [
  {albumDocInfo: {albumTitle: '水果篮子', channel: '动漫,4', itemTotalNumber: 25,
    albumVImage: 'https://pic6.iqiyipic.com/image/20200916/69/a7/a_100238938_m_601_m6.jpg'}},
  {albumDocInfo: {albumTitle: '水果篮子 第2季', channel: '动漫,4', itemTotalNumber: 25,
    albumVImage: 'https://pic0.iqiyipic.com/image/20200916/7b/ff/a_100396605_m_601_m10.jpg'}},
]}};
const FIX_LIMIT = {data: '服务器繁忙，请稍后再试'};   /* 实测限流时 data 直接是一句文案（字符串） */
function R(name, ch, pic) { return {name: name, ch: ch, pic: pic === undefined ? 'http://pic0.iqiyipic.com/x.jpg' : pic}; }

/* ---------- 1. cnBases：中文站只认中文正名 ---------- */
console.log('--- cnBases 中文正名钥匙 ---');
function cb(k) { return JSON.stringify(cnBases(k)); }
check('CN1', '双语名剥完英文尾巴只剩正名：致命女人 第二季 Why Women Kill Season 2 → 致命女人',
  cb('致命女人 第二季 Why Women Kill Season 2') === '["致命女人"]', cb('致命女人 第二季 Why Women Kill Season 2'));
check('CN2', '日文假名段不算中文正名（水果篮子 第一季 フルーツバスケット → 水果篮子）',
  cb('水果篮子 第一季 フルーツバスケット') === '["水果篮子"]', cb('水果篮子 第一季 フルーツバスケット'));
check('CN3', '释放组前缀【.bc】这类残料要摘干净，不能把括号带进钥匙',
  cb('【.bc】某番 v2') === '["某番"]', cb('【.bc】某番 v2'));
check('CN4', '纯英文名不产钥匙（爱奇艺是中文站，问它也问不出东西）',
  cb('Hilda Season 3').length === 2 && cb('Hilda Season 3') === '[]', cb('Hilda Season 3'));
check('CN5', '整段本来就是正名时不重复产出（魔卡少女樱 → 空，原样那一把已经够）',
  cb('魔卡少女樱') === '[]', cb('魔卡少女樱'));
check('CN6', '拉丁字母打断的中文名：截出来的是「头文字」不是「头文字D」——截短只会问不到，不会配错图',
  cb('头文字D 第四季 頭文字D：Fourth Stage') === '["头文字","頭文字"]', cb('头文字D 第四季 頭文字D：Fourth Stage'));
check('CN7', '预算：一次最多两把', cnBases('爱情宝典 第2季 番外篇 剧场版 合集').length <= 2,
  cb('爱情宝典 第2季 番外篇 剧场版 合集'));
check('CN8', '季号必须先剥再切（不剥就会把「第二季」当一把钥匙递出去）',
  cb('某某某 第三季 完结篇').indexOf('第三季') < 0, cb('某某某 第三季 完结篇'));
check('CN9', '坏输入不炸', cnBases(null).length === 0 && cnBases('').length === 0);

/* ---------- 2. iqRows：解析层 ---------- */
console.log('--- iqRows 接口解析 ---');
const rowsA = iqRows(FIX_AQBD), rowsZ = iqRows(FIX_ZMN);
/* 旧版那份（负测的 AT_PAGE）里这些函数根本不存在，取 [0] 会先把量具自己打死（打死就一条红都报不出来，只留个 rc=1）：一律先用空对象兜住，让该红的逐条红出来。 */
const A0 = rowsA[0] || {}, Z0 = rowsZ[0] || {};
check('IQ1', '实测 JSON 拆成行：两行、名字剥掉 <em> 高亮标签',
  rowsA.length === 2 && A0.name === '爱情宝典' && A0.ch === '电视剧',
  JSON.stringify(A0));
check('IQ2', '图字段取到 http 直链（原样交给 /iq-img 去搬，页面不直连图床）',
  String(A0.pic || '').indexOf('http') === 0 && String(A0.pic || '').indexOf('iqiyipic.com') > 0, A0.pic);
check('IQ3', '限流形态（data 是一句文案）按「没搜到」处理，不许炸也不许当命中',
  iqRows(FIX_LIMIT).length === 0);
check('IQ4', '缺字段 / 空对象 / null 都不炸',
  iqRows(null).length === 0 && iqRows({}).length === 0 && iqRows({data: {docinfos: [{}], x: 1}}).length === 0);

/* ---------- 3. iqKeys / iqPick：三把钥匙 + 三道闸 ---------- */
console.log('--- iqKeys 与 iqPick 判据 ---');
const E_ZMN = {title: '致命女人 第二季 Why Women Kill Season 2', kind: '真人剧'};
const E_AQBD = {title: '爱情宝典', kind: '真人剧'};
const E_SGB = {title: '水果篮子', kind: '动画'};
const E_SGB_LIVE = {title: '水果篮子', kind: '真人剧'};
const E_MOV = {title: '夏目友人帐', kind: '剧场版'};
const E_MK = {title: '魔卡少女樱', kind: '动画'};
const E_XM = {title: '夏目友人帳 第七季', kind: '动画'};   /* 繁体「帳」 */

const ks = iqKeys(E_ZMN);
check('IQ5', '三把钥匙都在：原样、剥季号、中文正名，每把都含中文，最多四把',
  ks.indexOf('致命女人 第二季 Why Women Kill Season 2') >= 0 && ks.indexOf('致命女人') >= 0 &&
  ks.length <= 4 && ks.every(function (v) { return /[\u4e00-\u9fff]/.test(v); }), JSON.stringify(ks));
check('IQ6', '双语名条目实测命中：爱奇艺的 albumTitle 就是「致命女人」，靠中文正名那把认上',
  !!iqPick(E_ZMN, rowsZ) && iqPick(E_ZMN, rowsZ).name === '致命女人', JSON.stringify(iqPick(E_ZMN, rowsZ)));
check('IQ7', '同名不同作被类型同侧挡住：动画条目不许拿真人电视剧的图，反之亦然（两头都量）',
  !!iqPick(E_SGB, iqRows(FIX_SGB)) && !iqPick(E_SGB_LIVE, iqRows(FIX_SGB)),
  JSON.stringify(iqPick(E_SGB, iqRows(FIX_SGB)) || {}));
check('IQ8', '剧场版只认电影频道（拿动漫频道的 TV 版当剧场版封面=错图）',
  !iqPick(E_MOV, [R('夏目友人帐', '动漫')]) && !!iqPick(E_MOV, [R('夏目友人帐', '电影')]));
check('IQ9', 'kind 缺失的条目走真人侧（保守：不给动画频道的图）',
  !!iqPick({title: '爱情宝典'}, [R('爱情宝典', '电视剧')]) && !iqPick({title: '爱情宝典'}, [R('爱情宝典', '动漫')]));
check('IQ10', '片花/音频这类频道一律不认（实测就在正片隔壁一行）',
  !iqPick(E_AQBD, [R('爱情宝典', '片花')]) && !!iqPick(E_AQBD, rowsA));
check('IQ11', '没图直接放弃：宁缺勿错，拿名字对上但没海报也不写',
  !iqPick(E_AQBD, [R('爱情宝典', '电视剧', '')]) && !!iqPick(E_AQBD, [R('爱情宝典', '电视剧')]));
check('IQ12', '别名不硬凑：魔卡少女樱 ↔ 百变小樱 认不出就空手，留给待指认',
  !iqPick(E_MK, [R('百变小樱', '动漫')]) && !!iqPick(E_MK, [R('魔卡少女樱', '动漫')]));
check('IQ13', '繁简不硬凑：normTxt 不做繁简折叠，对不上就不给（不许为了命中率松身份闸）',
  !iqPick(E_XM, [R('夏目友人帐', '动漫')]));
check('IQ14', '只看前 8 行（第 9 行才有的命中不取，防越翻越偏）',
  !iqPick(E_AQBD, [R('甲', '电视剧'), R('乙', '电视剧'), R('丙', '电视剧'), R('丁', '电视剧'),
    R('戊', '电视剧'), R('己', '电视剧'), R('庚', '电视剧'), R('辛', '电视剧'), R('爱情宝典', '电视剧')]));
check('IQ15', '坏输入不炸', !iqPick(null, null) && !iqPick(E_AQBD, []) && iqChAllow(null, '') === false);

/* ---------- 4. 结构性断言（读源码）：接线在位、出口只有本机中转 ---------- */
console.log('--- 结构性断言 ---');
function has(s) { return html.indexOf(s) >= 0; }
function cnt(s) { return html.split(s).length - 1; }
check('K1', 'iq 这一整块六个函数都在页里',
  has('function iqChAllow(') && has('function iqRows(') && has('function iqKeys(') &&
  has('function iqPick(') && has('async function iqCoverFor('));
check('K2', 'healCoverFor 里接了线（拉不到封面才会走到这一跳）',
  has("if(!url){ url=await iqCoverFor(s); }"));
check('K3', '接线位置在豆瓣那一跳之前（豆瓣一秒都出不来，别让它排在后面空等）',
  html.indexOf("url=await iqCoverFor(s);") > 0 && html.indexOf('if(!url && doubanFirst(s)){') > 0 &&
  html.indexOf("url=await iqCoverFor(s);") < html.indexOf('if(!url && doubanFirst(s)){'),
  'iq=' + html.indexOf("url=await iqCoverFor(s);") + ' 豆瓣=' + html.indexOf('if(!url && doubanFirst(s)){'));
check('K4', '非本机模式直接跳过（中转只有本机服务有，云上跑不去空等超时）',
  has("if(!isLocalServer()) return '';"));
check('K5', '页面绝不直连爱奇艺接口，出口只有同源 /iq-img（浏览器直连没有 CORS，也免掉第三方 cookie 面）',
  !has("fetch('https://search.video.iqiyi") && has("return '/iq-img?url='+encodeURIComponent(hit.pic);"));
check('K6', '身份判据仍是 normTxt 全等（多问几把钥匙，没松闸）',
  has('if(ks.indexOf(normTxt(r.name))<0) continue;'));
check('K7', '频道表只定义一处（两侧同侧判据都读它）',
  cnt('var IQ_ANIME_CH=') === 1 && cnt('var IQ_LIVE_CH=') === 1);
check('K8', '预算写死：钥匙最多 4 把、只看前 8 行、单次中转 7 秒超时',
  has('cnBases(v).forEach(push); }); }catch(e){}' + LF + '  return out.slice(0,4);') &&
  has('i<list.length&&i<8') && has('},7000);'));
const SRV = fs.readFileSync(path.join(ROOT, '服务器-空闲自退.py'), 'utf8');
check('K9', '本机服务两个中转路由都在（/iq-relay 搬 JSON、/iq-img 搬图）',
  SRV.indexOf('/iq-relay') >= 0 && SRV.indexOf('/iq-img') >= 0);
check('K10', '白名单独立成模块（服务端只放行 iqiyipic.com，本机服务不当开放代理）',
  fs.existsSync(path.join(ROOT, 'iq_relay_rules.py')) && SRV.indexOf('iq_relay_rules') >= 0);

/* ---------- 5. 退避账进位清一次（常驻化的另一半：新源别让旧账挡在门外） ---------- */
console.log('--- _atCoverTryReset 行为 ---');
const RESET_SRC = sliceOpt('function _atCoverTryReset(', '/* ===== v2.48.0 查询剥壳',
  'function _atCoverTryReset(){ return false; }', '_atCoverTryReset');
function mkStore(init) {
  const m = Object.assign({}, init || {});
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
           setItem: function (k, v) { m[k] = String(v); }, _m: m };
}
function runReset(build, store) {
  /* 页面的真身读的是全局 AT_BUILD 与全局 localStorage，这里按参数注入同名变量，跑的就是页面上那份代码 */
  const f = new Function('AT_BUILD', 'localStorage', RESET_SRC + LF + 'return _atCoverTryReset();');
  return f(build, store);
}
const st1 = mkStore({ at_cover_try: '{"123":{"at":1,"ok":false}}', at_try_build: '20260101a' });
const r1 = runReset('20261009z', st1);
check('R1', '换了构建：清账（at_cover_try 归零）并返回 true',
  r1 === true && st1._m.at_cover_try === '{}', String(r1) + ' ' + String(st1._m.at_cover_try));
check('R2', '构建号也记进账里（下次同构建不再清）', st1._m.at_try_build === '20261009z', String(st1._m.at_try_build));
const r2 = runReset('20261009z', st1);
check('R3', '同一构建再调：返回 false，不许反复清（否则退避白写、重试风暴回来）',
  r2 === false, String(r2));
const st2 = mkStore({ at_cover_try: '{"9":{"at":1}}', at_try_build: '20261009z' });
const r3 = runReset('20261009z', st2);
check('R4', '构建没进位：账原样留着（旧的 2 小时退避照旧生效）',
  r3 === false && st2._m.at_cover_try === '{"9":{"at":1}}', String(st2._m.at_cover_try));
const st3 = mkStore({ at_cover_try: '{"9":{"at":1}}' });
check('R5', 'AT_BUILD 缺失/空串时一律不清（防每次开机都清成风暴）',
  runReset('', st3) === false && runReset(undefined, st3) === false && st3._m.at_cover_try === '{"9":{"at":1}}');
const boom = { getItem: function () { throw new Error('SecurityError'); }, setItem: function () { throw new Error('SecurityError'); } };
check('R6', 'localStorage 被隐私模式挡住时返回 false 不炸', runReset('20261009z', boom) === false);
check('R7', '开机治理里排在封面补齐之前（先清账再扫，否则这一轮还是旧账）',
  html.indexOf('_atCoverTryReset();') > 0 && html.indexOf('_atCoverTryReset();') < html.indexOf('_atCoverCatchup();'),
  'reset=' + html.indexOf('_atCoverTryReset();') + ' catchup=' + html.indexOf('_atCoverCatchup();'));

/* ---------- 汇总 ---------- */
console.log('\n==== iq-source: pass=' + pass + ' fail=' + fail + ' (' + PAGE + ') ====');
fs.writeFileSync(path.join(__dirname, 'last-iq-source.json'),
  JSON.stringify({ pass, fail, failures, page: path.isAbsolute(PAGE) ? PAGE : path.join(ROOT, PAGE) }, null, 1));
process.exit(fail ? 1 : 0);
