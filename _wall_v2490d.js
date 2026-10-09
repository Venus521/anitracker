/* v2.49.0 证据生成器：存量按季切这一环，肉眼看得见的「切之前 / 切之后」。
   判据不是我另写一遍——是把 index.html 里的 seasonSeqOf + seasonResliceShow 原样 slice 出来
   eval 进隔离作用域（和 tests/reslice-check.js 同一套路），喂的夹具形状取自实测：
   希尔达整部 34／第三季 8、夏目友人帳整部 86／第七季 12。
   另外两份干跑数字直接从落盘文件读：last-reslice-dry.json（真数据）、last-reslice*.json（门禁）。 */
const fs = require('fs'); const path = require('path');
const ROOT = __dirname, NL = String.fromCharCode(10);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function cut(a, b) {
  const i = html.indexOf(a); if (i < 0) throw new Error('找不到起点标记：' + a);
  const ends = Array.isArray(b) ? b : [b]; let pick = null;
  ends.forEach(function (m) { const j = html.indexOf(m, i); if (j >= 0 && (pick === null || j < pick)) pick = j; });
  if (pick === null) throw new Error('找不到终点标记：' + ends.join(' | '));
  return html.slice(i, pick);
}
const src = [
  cut('var _CN_NUM=', '/* ===== v2.47.0 前缀指认'),
  cut('function seasonResliceShow(', 'async function webMatchShow('),
].join(NL);
const api = new Function(src + NL + 'return { seasonSeqOf: seasonSeqOf, seasonResliceShow: seasonResliceShow };')();

function mkRows(seasons) {
  const rows = []; let n = 0;
  seasons.forEach(function (cnt, si) {
    for (let e = 1; e <= cnt; e++) { n++; const sea = si + 1;
      rows.push({ s: n, sn: sea, en: e, t: 'S' + sea + 'E' + e + ' 第' + e + '集', dur: 25 }); }
  });
  return rows;
}
const HILDA = mkRows([13, 13, 8]);
const clone = function (o) { return JSON.parse(JSON.stringify(o)); };
const libNoSn = mkRows([6]).map(function (x) { delete x.sn; return x; });
const cases = [
  { k: '零进度（最保守那条）', s: { title: '希尔达 第三季', total: 34, eps: clone(HILDA), statuses: {}, epT: {} },
    note: '库里挂着整部 34 行，一条标记都没有 => 切成第 3 季那 8 行，行号重编 1..8' },
  { k: '有进度，且全在那一季的行上', s: { title: '希尔达 第三季', total: 34, eps: clone(HILDA),
      statuses: { '27': 'watched', '28': 'watched' }, epT: { '27': 1727000000000 } },
    note: '标记记的是位序 27/28——去看这两行本身：sn 都是 3 => 照切，并把 27/28 平移到 1/2（旧键一条不剩）' },
  { k: '有进度落在别的季上', s: { title: '希尔达 第三季', total: 34, eps: clone(HILDA), statuses: { '5': 'watched' }, epT: {} },
    note: '位序 5 那一行是第 1 季第 5 集 => 判据不认这套编号，整条一个字节不碰（多半你真在追第 1 季）' },
  { k: '离线库那种表（行不带 sn）', s: { title: '海贼王 第二季', total: 6, eps: clone(libNoSn), statuses: {}, epT: {} },
    note: '库里 18513 行都是这形状：没有行身份证据 => skip，不靠位置猜' },
];
cases.forEach(function (c) { c.before = clone(c.s); c.rowsBefore = c.s.eps.length; c.res = api.seasonResliceShow(c.s); c.after = clone(c.s); });

const dry = JSON.parse(fs.readFileSync(path.join(ROOT, 'last-reslice-dry.json'), 'utf8'));
const iq = JSON.parse(fs.readFileSync(path.join(ROOT, 'last-iq-wall.json'), 'utf8'));
const rg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'last-reslice.json'), 'utf8'));
const rgn = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'last-reslice-negative.json'), 'utf8'));
const build = /AT_BUILD\s*=\s*['"]?([0-9a-z]+)/.exec(html);
const esc = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
function strip(sh, label) {
  const eps = (sh && sh.eps) || []; const mk = Object.keys((sh && sh.statuses) || {});
  const tt = Object.keys((sh && sh.epT) || {});
  let out = '<div class="strip"><span class="lab">' + esc(label) + '</span>';
  for (let i = 1; i <= eps.length; i++) {
    const on = mk.indexOf(String(i)) >= 0 || tt.indexOf(String(i)) >= 0;
    out += '<i class="cell' + (on ? ' on' : '') + '" title="' + esc((eps[i - 1] || {}).t || '') +
      ' 位序' + i + ((eps[i - 1] && eps[i - 1].sn) ? ' sn' + eps[i - 1].sn : '') + '"></i>';
  }
  out += '<span class="cnt">' + (mk.length + tt.length) + '/' + eps.length + '</span></div>';
  return out;
}
let h = '<!doctype html><meta charset="utf-8"><title>v2.49.0 存量按季切 · 肉眼墙页</title>' +
  '<style>body{font:14px/1.65 system-ui,sans-serif;margin:26px;background:#fafafa;color:#212121}' +
  'h1{font-size:22px}h2{font-size:16px;margin:26px 0 8px}' +
  '.chip{display:inline-block;margin:4px 8px 4px 0;padding:6px 12px;background:#fff;border:1px solid #ddd;border-radius:14px}' +
  '.chip b{font-size:20px;margin-right:6px}' +
  '.case{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:14px;margin:12px 0}' +
  '.case h3{margin:0 0 4px;font-size:15px}.note{color:#666;font-size:12.5px;margin:2px 0 10px}' +
  '.strip{display:flex;align-items:center;gap:3px;margin:5px 0;flex-wrap:wrap}' +
  '.lab{width:78px;color:#777;font-size:12px}i.cell{width:11px;height:11px;background:#e6e6e6;border-radius:2px;display:inline-block}' +
  'i.cell.on{background:#2e7d32}.cnt{margin-left:8px;font-size:12px;color:#444}' +
  '.verdict{font-size:12.5px;margin-top:6px}.verdict b{font-family:ui-monospace,Consolas,monospace}' +
  'pre{white-space:pre-wrap;background:#fff;border:1px solid #e3e3e3;border-radius:8px;padding:10px;font-size:12.5px}' +
  'table{border-collapse:collapse;background:#fff}td,th{border:1px solid #e0e0e0;padding:6px 10px;font-size:13px;text-align:left}</style>';
h += '<h1>存量按季切：切之前 / 切之后（build ' + (build ? build[1] : '?') + '）</h1>';
h += '<p>口径：下面每个方块＝一行剧集；绿格＝那一行上有进度标记（<code>statuses</code>/<code>epT</code> 记的是位序）。' +
  '判据不是在这里另写一遍——把 index.html 里的 <code>seasonSeqOf</code> + <code>seasonResliceShow</code> 原样 slice 出来 eval 进隔离作用域跑的，' +
  '跟门禁 <code>tests/reslice-check.js</code> 同一份码。夹具形状取自实测：希尔达整部 34／第三季 8。</p>';
[['门禁 reslice-check', rg.pass, rg.fail], ['负测 reslice-negative', rgn.pass, rgn.fail],
 ['爱奇艺那一环救回（78 部样本）', iq.total, iq.sample - iq.total],
 ['干跑：库里有行身份证据的条目', dry.libRowsHaveSn, dry.libEntries - dry.libRowsHaveSn],
].forEach(function (c) { h += '<span class="chip"><b>' + c[1] + '</b>' + esc(c[0]) + '（红/不动 ' + c[2] + '）</span>'; });
h += '<h2>四种真存量形状，各喂一遍真判据</h2>';
cases.forEach(function (c) {
  const act = c.res.act;
  h += '<div class="case"><h3>' + esc(c.k) + '</h3><div class="note">' + esc(c.note) + '</div>';
  h += strip(c.before, '切之前');
  if (act === 'sliced' || act === 'remapped') h += strip(c.after, '切之后');
  h += '<div class="verdict">判据说：<b>' + esc(JSON.stringify(c.res)) + '</b>';
  if (act === 'sliced' || act === 'remapped') h += '　=> 动了，' + c.rowsBefore + ' 行收成 ' + c.after.eps.length + ' 行';
  else if (act === 'refuse') h += '　=> 一条没碰（界面上仍是 ' + c.rowsBefore + ' 行那个数）';
  else h += '　=> 没动（' + esc(c.res.why || '') + '）';
    var bt=c.before.total, at2=(act==='sliced'||act==='remapped')?c.after.total:c.before.total;
  h += '<div class="verdict">界面上那行写的「N 集」（读 <code>s.total</code>）：<b>' + bt + ' → ' + at2 + '</b></div>';
h += '</div></div>';
});
h += '<h2>干跑打在两份真数据上（当场跑出来的，不是推算）</h2><table>' +
  '<tr><th>样本</th><th>数量</th><th>这一版能动吗</th></tr>' +
  '<tr><td>离线库 ani-tracker-lib.json</td><td>' + dry.libEntries + ' 部 / 集表行里带 sn 的 ' + dry.libRowsHaveSn +
  ' 部</td><td>能动 <b>' + dry.libRowsHaveSn + '</b> 部：没有行身份证据 ⇒ 其余全 skip（宁缺勿错）</td></tr>' +
  '<tr><td>同上，标题里带季号的</td><td>' + dry.libTitlesWithSeason + ' 部</td><td>缺的不是季号，是行身份 ⇒ 仍 skip</td></tr>' +
  '<tr><td>服务器日志里那批条目名</td><td>' + dry.logTitles + ' 条</td><td>' + dry.logTitlesWithSeason +
  ' 条标题带季号；切不切得动看它的表从哪填：TVMaze 那类网页行带 sn ⇒ 能切</td></tr></table>';
h += '<h2>你片单里真改了几部：这一版自己把数写进回执</h2>';
h += '<pre>at_reslice_last = {"b":"构建号","sliced":0,"remapped":0,"refuse":0,"skipped":0}</pre>';
h += '<pre>换构建号那趟开机跑一次；动手前整份片单先快照进 at_shows_bak_&lt;构建号&gt;（要还原就写回这份）。' + NL +
  '本机这个浏览器 profile 里 tr_shows 是空的（2 字节），云端那份要账号密码才读得到——' + NL +
  '所以「真改了几部」不在这页上编数，由回执在你自己那趟开机里报；弹窗只报数字，不解释机制。</pre>';
h += '<h2>带季号的那些条目名（日志实测 ' + dry.logTitlesWithSeason + ' 条，来自 last-reslice-dry.json）</h2><pre>' +
  esc((dry.logSeasonNames || []).join(NL)) + '</pre>';
fs.writeFileSync(path.join(ROOT, 'tests', '_artifacts', 'v2490d-reslice-wall.html'), h, 'utf8');
console.log('WALL tests/_artifacts/v2490d-reslice-wall.html bytes=' + h.length + NL +
  cases.map(function (c) { return c.k + ' => ' + c.res.act + ' ' + (c.res.n || '') + '/' + (c.res.total == null ? '-' : c.res.total); }).join(NL));
