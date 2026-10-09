/* v2.49.0 干跑：存量季切这一版到底能碰到多少「真存量」——判据从 index.html 原样 slice 出来用，
   不在这里另写一套（口径必须和页面一致）。打的样本两份：
   A) ani-tracker-lib.json 那 302 部（离线库，用户片单里从库里填的那批就是这个形状）；
   B) 服务器日志里 78 条去重条目名（都是 TVMaze 三条路都不中的那批）。 */
const fs = require('fs'); const path = require('path');
const ROOT = __dirname, NL = String.fromCharCode(10);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function cut(a, b) { const i = html.indexOf(a); if (i < 0) throw new Error('no start ' + a);
  const ends = Array.isArray(b) ? b : [b]; let pick = null;
  ends.forEach(function (m) { const j = html.indexOf(m, i); if (j >= 0 && (pick === null || j < pick)) pick = j; });
  if (pick === null) throw new Error('no end ' + ends.join('|')); return html.slice(i, pick); }
const src = [
  cut('var _CN_NUM=', '/* ===== v2.47.0 前缀指认'),
  cut('function seasonResliceShow(', 'async function webMatchShow('),
].join(NL);
const api = new Function(src + NL + 'return { seasonSeqOf: seasonSeqOf, seasonResliceShow: seasonResliceShow };')();

/* A：库里每一份集表原样当存量表用（行里有没有 sn，是这一版能不能切的唯一分水岭） */
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'ani-tracker-lib.json'), 'utf8'));
const tally = {}, reasons = {}; let withSn = 0, seqTitle = 0;
lib.forEach(function (e) {
  if (api.seasonSeqOf(e.title) || api.seasonSeqOf(e.nameJp)) seqTitle++;
  if ((e.eps || []).some(function (r) { return r && r.sn; })) withSn++;
  const r = api.seasonResliceShow({ title: e.title, nameJp: e.nameJp, eps: (e.eps || []).slice() });
  tally[r.act] = (tally[r.act] || 0) + 1;
  reasons[r.why] = (reasons[r.why] || 0) + 1;
});

/* B：日志那 78 条条目名——只看「标题里有没有声明季号」（有才谈得上切） */
const seen = {}, titles = [];
fs.readFileSync(path.join(ROOT, '服务器日志.txt'), 'utf8').split(NL).forEach(function (line) {
  const m = /[?&]q=([^&\s"]+)/.exec(line); if (!m) return;
  let t = decodeURIComponent(m[1]).replace(/&#39;/g, String.fromCharCode(39)).replace(/&amp;/g, '&').trim();
  if (t.length < 2 || seen[t]) return; seen[t] = 1; titles.push(t);
});
let logSeq = 0; const logSeqNames = [];
titles.forEach(function (t) { const n = api.seasonSeqOf(t); if (n) { logSeq++; logSeqNames.push(t + ' → 第' + n + '季'); } });

const out = { libEntries: lib.length, libRowsHaveSn: withSn, libTitlesWithSeason: seqTitle,
  libActs: tally, libReasons: reasons, logTitles: titles.length, logTitlesWithSeason: logSeq, logSeasonNames: logSeqNames };
fs.writeFileSync(path.join(ROOT, 'last-reslice-dry.json'), JSON.stringify(out, null, 1), 'utf8');
console.log(JSON.stringify({ libEntries: out.libEntries, libRowsHaveSn: out.libRowsHaveSn,
  libTitlesWithSeason: out.libTitlesWithSeason, libActs: out.libActs, logTitles: out.logTitles,
  logTitlesWithSeason: out.logTitlesWithSeason }, null, 1));
