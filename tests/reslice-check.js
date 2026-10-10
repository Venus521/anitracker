/* v2.49.0 门禁：存量季切（纯逻辑，毫秒级，不开浏览器、不占端口）
   为什么要有这一份：这段只在「换了构建号 + 库里存量表跨季」时才走得到，
   浏览器门禁跑到它就把用户片单真改了，不能拿真片单当夹具；
   所以照 season-scope-check.js 的路子把两个函数从 index.html 里 slice 出来
   eval 进隔离作用域，夹具全是造的（数据形状取自页里注释记录的实测：
   希尔达整部 34 / 第三季 8，夏目友人帳整部 86 / 第七季 12）。
   负测：tests/reslice-negative.js（它当场把整段功能从复制品里摘出来跑，不依赖任何旧底本）。 */
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
function sliceOpt(startMark, endMark, stubSrc, label) {
  if (html.indexOf(startMark) < 0) { console.log('NOTE 页里没有 ' + label + '，按缺失行为 stub'); return stubSrc; }
  const starts = html.indexOf(startMark);
  const ends = Array.isArray(endMark) ? endMark : [endMark];
  let pick = null;
  ends.forEach(function (m) { const j = html.indexOf(m, starts); if (j >= 0 && (pick === null || j < pick)) pick = j; });
  if (pick === null) throw new Error('找不到终点标记：' + ends.join(' | '));
  return html.slice(starts, pick);
}

let calls, store, api;
function load(BUILD, list, keep) {
  calls = { save: 0, render: 0, toasts: [] };
  if (!keep) store = {};   /* keep=true 才测得出「账上已有本构建号」那条分支 */
  const src = [
    sliceOpt('var _CN_NUM=', '/* ===== v2.47.0 前缀指认',
      'var _CN_NUM={};\nfunction seasonSeqOf(){ return 0; }', 'seasonSeqOf'),
    sliceOpt('function seasonResliceShow(', '/* 按剧名在全网库找一条',
      'function seasonResliceShow(){ return {act:"skip",why:"页里没有这段"}; }\n' +
      'function bootSeasonReslice(){ return {ran:-2}; }', 'seasonResliceShow/bootSeasonReslice'),
  ].join('\n');
  api = new Function('AT_BUILD', 'shows', 'localStorage', 'save', 'renderList', 'toast',
    src + '\nreturn { seasonResliceShow: seasonResliceShow, bootSeasonReslice: bootSeasonReslice, seasonSeqOf: seasonSeqOf };')
    (BUILD, list, {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
    },
      function () { calls.save++; },
      function () { calls.render++; },
      function (m) { calls.toasts.push(String(m)); });
  return api;
}
/* 夹具：整部连号的集表（形状同 webRowsToEps 的产物：s=全书连号，sn/en=季内） */
function mkRows(seasons) {
  const rows = []; let n = 0;
  seasons.forEach(function (cnt, si) {
    for (let e = 1; e <= cnt; e++) {
      n++;
      const sea = si + 1;
      rows.push({ s: n, sn: sea, en: e, t: 'S' + sea + 'E' + e + ' 第' + e + '集', tOrig: 'Ep' + e, dur: 25, air: '2026-0' + sea + '-' + e });
    }
  });
  return rows;
}
load('fixture-build', []);   /* 先把 api 装上：下面这些判据只喂夹具，不碰片单 */
const HILDA = mkRows([13, 13, 8]);          /* 实测：整部 34，第三季真值 8 */
const NATSU = mkRows([13, 13, 13, 13, 11, 11, 12]);   /* 实测 id12310：整部 86，第七季 12 */

console.log('--- seasonResliceShow：切不切，看行身份 ---');
let s3 = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)) };
let r = api.seasonResliceShow(s3);
check('R1', '零进度 + 表跨季 → sliced，34 行收成 8 行（第 3 季真值）',
  r.act === 'sliced' && r.n === 8 && r.total === 34 && s3.eps.length === 8, JSON.stringify(r));
check('R2', '切完位序重编成 1..8，sn 仍是声明那一季（和 seasonRowsFor 一个口径）',
  s3.eps.map(function (x) { return x.s; }).join(',') === '1,2,3,4,5,6,7,8' &&
  s3.eps.every(function (x) { return x.sn === 3; }), s3.eps.map(function (x) { return x.s + '/' + x.sn; }).join(','));
check('R3', 'en/时长/播出日这些行内容原样搬过来（只动编号，不猜别的）',
  s3.eps[7].en === 8 && s3.eps[7].dur === 25 && s3.eps[7].air === '2026-03-8' && s3.eps[0].t === 'S3E1 第1集',
  JSON.stringify(s3.eps[7]));
check('R4', '切完自带幂等：再调一次报 skip（整表本就是第 3 季）',
  api.seasonResliceShow(s3).act === 'skip' && s3.eps.length === 8);

const natsu = { title: '夏目友人帳 第七季', eps: JSON.parse(JSON.stringify(NATSU)) };
const rn = api.seasonResliceShow(natsu);
check('R5', '日番长表：86 行 → 12 行（第七季真值，同 v2.48.0 那条实测）',
  rn.act === 'sliced' && rn.n === 12 && rn.total === 86 && natsu.eps.length === 12, JSON.stringify(rn));

console.log('\n--- 有进度：只认标记那一行的 sn，不看最大标记数 ---');
const inSeason = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)),
  statuses: { '27': 'watched', '28': 'watched' }, epT: { '27': 1727000000000 } };
const rm = api.seasonResliceShow(inSeason);
check('R6', '标记位序 27/28 那一行本身就是第 3 季 → remapped（不是「数字大就不敢动」）',
  rm.act === 'remapped' && rm.n === 8 && rm.marks === 2, JSON.stringify(rm) + '|' +
  JSON.stringify(HILDA[26]) + '|' + JSON.stringify(HILDA[27]));
check('R7', '进度按同一张旧位→新位表平移：statuses/epT 只剩新键，旧键一条不剩',
  JSON.stringify(inSeason.statuses) === '{"1":"watched","2":"watched"}' &&
  JSON.stringify(inSeason.epT) === '{"1":1727000000000}',
  JSON.stringify(inSeason.statuses) + '|' + JSON.stringify(inSeason.epT));
check('R8', '平移后集名跟着走（第 1 集仍是 S3E1，没串到别的季去）',
  inSeason.eps[0].t === 'S3E1 第1集' && inSeason.eps[1].t === 'S3E2 第2集',
  JSON.stringify(inSeason.eps.slice(0, 2).map(function (x) { return x.t; })));

const crossSeason = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)), statuses: { '5': 'watched' } };
const snap = JSON.stringify(crossSeason);
const rc = api.seasonResliceShow(crossSeason);
check('R9', '标记位序 5 那一行是第 1 季 → refuse，整条记录一个字节没动',
  rc.act === 'refuse' && JSON.stringify(crossSeason) === snap, JSON.stringify(rc));
const beyond = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)), epT: { '40': 1 } };
const snap2 = JSON.stringify(beyond);
const rb2 = api.seasonResliceShow(beyond);
check('R10', '位序大过整表（34）的陈旧标记 → refuse，同样一个字节没动',
  rb2.act === 'refuse' && beyond.eps.length === 34 && JSON.stringify(beyond) === snap2, JSON.stringify(rb2));
const bothMark = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)),
  statuses: { '27': 'watched' }, epT: { '27': 1, '28': 2 } };
const rm2 = api.seasonResliceShow(bothMark);
check('R11', '同一位序在 statuses/epT 各记一次只算一个标记（marks 不去重就会虚报）',
  rm2.act === 'remapped' && rm2.marks === 2 && JSON.stringify(bothMark.epT) === '{"1":1,"2":2}',
  JSON.stringify(rm2) + '|' + JSON.stringify(bothMark));

const t1 = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)), total: 34 };
const rt1 = api.seasonResliceShow(t1);
check('R12', '界面上那行「N 集」用的是 s.total：整表长出来的 34 跟着收成 8（否则切了还显示 34）',
  rt1.act === 'sliced' && t1.total === 8 && rt1.wasTotal === 34, t1.total + '|' + JSON.stringify(rt1));
const t2b = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)), total: 26,
  statuses: { '27': 'watched' }, epT: {} };
const rt2 = api.seasonResliceShow(t2b);
check('R13', '用户手填过别的数（total=26 而表是 34）→ 那个数一个字不动',
  rt2.act === 'remapped' && t2b.total === 26, String(t2b.total));
const t3 = { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)) };
api.seasonResliceShow(t3);
check('R14', '老数据没这个字段时补上本季行数（不能让界面继续空着）', t3.total === 8, String(t3.total));
console.log('\n--- 不动的那些：没季号 / 没这一季 / 整表本就一季 / 没表 ---');
[['A1', { title: '希尔达', eps: JSON.parse(JSON.stringify(HILDA)) }, '没声明季号'],
 ['A2', { title: '希尔达 第五季', eps: JSON.parse(JSON.stringify(HILDA)) }, '表里没第 5 季的行'],
 ['A3', { title: 'Friends Season 1', eps: mkRows([8]) }, '整表本就是第 1 季'],
 ['A4', { title: '希尔达 第三季', eps: [] }, '没有剧集表'],
 ['A5', { title: '希尔达 第三季' }, '连 eps 都没有'],
].forEach(function (c) {
  const before = JSON.stringify(c[1]);
  const rr = api.seasonResliceShow(c[1]);
  check(c[0], c[2] + ' → skip，且不动内容', rr.act === 'skip' && JSON.stringify(c[1]) === before, JSON.stringify(rr));
});
check('A6', '只有 nameJp 带季号也认（标题英文、日文名标季，同 seasonRowsFor）',
  api.seasonResliceShow({ title: 'Some Show', nameJp: 'ある某 第二部', eps: mkRows([12, 13]) }).n === 13);
check('A7', '行没带 sn（老数据）按第 1 季算：第 2 季请求 → 表里没这一季 → skip，不误切',
  api.seasonResliceShow({ title: '某剧 第二季', eps: [{ s: 1, en: 1 }, { s: 2, en: 2 }] }).act === 'skip');
check('A8', 'null / undefined 不炸',
  api.seasonResliceShow(null).act === 'skip' && api.seasonResliceShow(undefined).act === 'skip');

console.log('\n--- bootSeasonReslice：一个构建只跑一次，动手前先备份 ---');
const list1 = [
  { title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)) },
  { title: '夏目友人帳 第七季', eps: JSON.parse(JSON.stringify(NATSU)) },
  { title: '某剧 第二季', eps: JSON.parse(JSON.stringify(HILDA)), statuses: { '5': 'watched' } },
  { title: '没季的剧', eps: mkRows([6]) },
];
const jsonBefore = JSON.stringify(list1);
const b1 = load('20261009d', list1).bootSeasonReslice();
check('B1', '首跑：ran=1，两部零进度的切了、一部标记对不上被拒、一部本来不用动',
  b1.ran === 1 && b1.sliced === 2 && b1.refuse === 1 && b1.skipped === 1, JSON.stringify(b1));
check('B2', '动手前整份片单快照进了 at_shows_bak_<构建号>（要还原就写回这份）',
  store['at_shows_bak_20261009d'] === jsonBefore && String(store['at_shows_bak_20261009d']).length > 100,
  String(store['at_shows_bak_20261009d'] || '').slice(0, 40));
check('B3', '构建号记进 at_reslice_build（下次同构建不再跑）', store['at_reslice_build'] === '20261009d');
check('B4', '有改动才落盘：save / renderList 各一次', calls.save === 1 && calls.render === 1,
  'save=' + calls.save + ' render=' + calls.render);
check('B5', '只报数字，不解释机制（界面不写字典名、不用已退役的活动日志）',
  calls.toasts.length === 1 && /2 部/.test(calls.toasts[0]) && /1 部进度看着不在这季里、没敢动/.test(calls.toasts[0]),
  calls.toasts.join(' || '));

const list2 = [{ title: '希尔达', eps: mkRows([6]) }];
load('20261009d', list2, true);   /* 账不动（沿用同一份 store），只把片单换一条 */
const b2b = api.bootSeasonReslice();
check('B6', '同构建第二次：ran=-1，一条不碰、不落盘、不弹窗',
  b2b.ran === -1 && b2b.sliced === 0 && calls.save === 0 && calls.render === 0 &&
  calls.toasts.length === 0 && list2[0].eps.length === 6, JSON.stringify(b2b));

const list3 = [{ title: '希尔达', eps: mkRows([6]) }, { title: '某剧 第二季', eps: JSON.parse(JSON.stringify(HILDA)) }];
store['at_reslice_build'] = '20261009c';
const b3 = load('20261009d', list3, true).bootSeasonReslice();
check('B7', '账上是上一个构建号 → 这一趟才重跑（换构建才重跑，这条正是版本进位要的效果）',
  b3.ran === 1 && b3.sliced === 1 && store['at_reslice_build'] === '20261009d', JSON.stringify(b3));

const list4 = [{ title: '没季的剧', eps: mkRows([6]) }];
const b4 = load('20261009e', list4).bootSeasonReslice();
check('B8', '零改动那一跑：不 save、不 renderList、不弹，但构建号照样记账（别每开机重算）',
  b4.ran === 1 && b4.skipped === 1 && calls.save === 0 && calls.render === 0 &&
  calls.toasts.length === 0 && store['at_reslice_build'] === '20261009e', JSON.stringify(b4));
const list5 = [{ title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)) },
  { title: '某剧 第二季', eps: JSON.parse(JSON.stringify(HILDA)), statuses: { '5': 'watched' } }];
load('20261009f', list5).bootSeasonReslice();
const rec = JSON.parse(store['at_reslice_last'] || 'null');
check('B10', '这一趟的账落成回执 at_reslice_last（改了几部/拒了几部，下次核数不用猜）',
  !!rec && rec.b === '20261009f' && rec.sliced === 1 && rec.refuse === 1 && typeof rec.t === 'number',
  JSON.stringify(rec));
load('20261009g', [{ title: '没季的剧', eps: mkRows([6]) }]).bootSeasonReslice();
const rec2 = JSON.parse(store['at_reslice_last'] || 'null');
check('B10b', '零改动那一跑同样留回执（skipped=1、其余 0，不是不落痕）',
  !!rec2 && rec2.b === '20261009g' && rec2.sliced === 0 && rec2.skipped === 1, JSON.stringify(rec2));
check('B9', '没有 AT_BUILD（比如本地直接打开文件）→ 不跑，绝不瞎改片单',
  (function () { const q = load('', [{ title: '希尔达 第三季', eps: JSON.parse(JSON.stringify(HILDA)) }]);
    const o = q.bootSeasonReslice(); return o.ran === -1 && o.sliced === 0; })());

console.log('\n--- 结构性断言（读源码）---');
function has(x) { return html.indexOf(x) >= 0; }
function cnt(x) { return html.split(x).length - 1; }
check('S1', '两个函数都在页里定义（各一处）',
  cnt('function seasonResliceShow(') === 1 && cnt('function bootSeasonReslice(') === 1);
check('S2', '接线在 bootHeal 里紧跟退避账复位那一行，且只接一次',
  cnt('try{ bootSeasonReslice(); }catch(e){ atErr("bootHeal.catch", e); }') === 1 &&
  html.indexOf('try{ _atCoverTryReset(); }catch(e){ atErr("bootHeal.catch", e); }') < html.indexOf('try{ bootSeasonReslice(); }catch(e){ atErr("bootHeal.catch", e); }'),
  'call=' + cnt('try{ bootSeasonReslice(); }catch(e){ atErr("bootHeal.catch", e); }'));
check('S3', '判据只看行身份（sn）与位序，没退回「最大标记数」那种启发式',
  has('var sn=Number((s.eps[i]||{}).sn)||1;') && !has('var hi=0;'),
  'hi=' + cnt('var hi=0;'));
check('S4', 'refuse 分支在任何赋值之前（对不上就整条不碰）',
  html.indexOf('if(bad) return {act:"refuse"') < html.indexOf('var keep=[], q, remap={};'));
check('S5', '身份闸没松：这段不碰标题判据，normTxt 全等那条路一条没改',
  cnt('function seasonResliceShow(') === 1 && has('if(normTxt(x.name)===normTxt(tries[i])||normTxt(x.name)===want) hit=x;'));
check('S6', '集数只来自官方集表那一季的行数：这段（切+跑）里没有 itemTotalNumber'
  + '（整页只出现一次，在接口形状注释里）',
  (function(){ const a=html.indexOf('function seasonResliceShow(');
    const b=html.indexOf('async function webMatchShow(', a); const only=html.indexOf('itemTotalNumber');
    return a>0 && b>a && html.slice(a,b).indexOf('itemTotalNumber')<0 &&
      html.split('itemTotalNumber').length-1===1 && only>0; })());
console.log('\n==== reslice: pass=' + pass + ' fail=' + fail + ' (' + PAGE + ') ====');
fs.writeFileSync(path.join(__dirname, 'last-reslice.json'),
  JSON.stringify({ page: PAGE, pass, fail, failures }, null, 1));
if (fail) process.exit(1);
