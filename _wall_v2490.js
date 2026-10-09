/* v2.49.0 证据生成器：爱奇艺这一环对「日志里 TVMaze 三条路都不中的那批条目」实测能救回几部
   判据不是我另写一遍——是把 index.html 里的 iqKeys/iqPick/iqRows/iqChAllow 原样 slice 出来
   eval 进隔离作用域（和 tests/iq-source-check.js 同一套路），打的却是本机 8099 的真中转。
   为什么分两遍跑：日志里只有条目名，没带片单里的 kind（动画/真人剧），
   而类型同侧这条闸就是要吃 kind 的——所以 A 遍按「kind 缺失走真人侧」（页面真身那条保守规则），
   B 遍只补 A 没中的、按 kind=动画 再跑一遍。两遍的数分开报，口径写进墙页，不混成一个数。 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const NL = String.fromCharCode(10);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function cut(a, b) {
  const i = html.indexOf(a);
  if (i < 0) throw new Error('找不到起点标记：' + a);
  let ends = Array.isArray(b) ? b : [b], pick = null;
  ends.forEach(function (m) { const j = html.indexOf(m, i); if (j >= 0 && (pick === null || j < pick)) pick = j; });
  if (pick === null) throw new Error('找不到终点标记：' + ends.join(' | '));
  return html.slice(i, pick);
}
const src = [
  cut('function normTxt(', NL),
  cut('var _CN_NUM=', '/* ===== v2.47.0 前缀指认'),
  cut('var SEASON_STRIP_PATS=', 'function queryBases('),
  cut('function queryBases(', ['/* ===== v2.48.0 季条目', '/* ===== v2.49.0 季条目']),
  cut('var IQ_ANIME_CH=', '/* v2.26.0：判断当前是否跑在'),
].join(NL);
const api = new Function(src + NL +
  'return { normTxt: normTxt, queryBases: queryBases, latinBases: latinBases, cnBases: cnBases,' +
  ' iqKeys: iqKeys, iqRows: iqRows, iqPick: iqPick, iqIsAnime: iqIsAnime, iqChAllow: iqChAllow };')();

/* 样本：服务器日志里全部 q= 查询（去掉 URL 残料），按名去重——就是那批「灰着不动」的条目名 */
const seenMap = {}, titles = [];
fs.readFileSync(path.join(ROOT, '服务器日志.txt'), 'utf8').split(NL).forEach(function (line) {
  const m = /[?&]q=([^&\s"]+)/.exec(line);
  if (!m) return;
  let t = decodeURIComponent(m[1]).replace(/&#39;/g, String.fromCharCode(39)).replace(/&amp;/g, '&');
  t = t.trim();
  if (t.length < 2 || seenMap[t]) return;
  seenMap[t] = 1; titles.push(t);
});

function relay(name) {
  return new Promise(function (res) {
    const u = 'http://127.0.0.1:8099/iq-relay?q=' + encodeURIComponent(name);
    const req = http.get(u, { agent: false, timeout: 15000 }, function (r) {
      let buf = '';
      r.setEncoding('utf8');
      r.on('data', function (d) { buf += d; });
      r.on('end', function () {
        if (r.statusCode !== 200) { res({ err: 'http ' + r.statusCode, body: buf.slice(0, 60) }); return; }
        try { res({ json: JSON.parse(buf) }); } catch (e) { res({ err: 'json fail' }); }
      });
    });
    req.on('timeout', function () { req.destroy(); res({ err: 'timeout' }); });
    req.on('error', function (e) { res({ err: String(e.message || e).slice(0, 60) }); });
  });
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* 一遍：拿页面的 iqKeys 逐把问，命中就停；同时记下是哪一把钥匙中的、以及每个候选被什么挡掉 */
async function sweep(s) {
  const keys = api.iqKeys(s), rec = { title: s.title, keys: keys, hit: null, blocked: [], errs: [] };
  for (let i = 0; i < keys.length; i++) {
    const r = await relay(keys[i]);
    if (r.err) { rec.errs.push(keys[i] + ' :: ' + r.err); await sleep(120); continue; }
    const rows = api.iqRows(r.json);
    const hit = api.iqPick(s, rows);
    if (hit) { rec.hit = { keyIndex: i, key: keys[i], name: hit.name, ch: hit.ch, pic: hit.pic }; return rec; }
    rows.slice(0, 4).forEach(function (x) {
      if (!x.pic) return;
      const same = api.normTxt(x.name) === api.normTxt(keys[i]);
      if (same && !api.iqChAllow(s, x.ch)) rec.blocked.push(x.name + ' [' + x.ch + '] 频道不同侧');
      else if (same) rec.blocked.push(x.name + ' [' + x.ch + '] 无可用图');
    });
    await sleep(120);
  }
  return rec;
}

function whichFamily(s, key) {
  if (key === s.title) return '原样';
  try { if (api.cnBases(s.title).indexOf(key) >= 0) return '中文正名'; } catch (e) {}
  try { if (api.queryBases(s.title).indexOf(key) >= 0) return '剥季号'; } catch (e) {}
  return '别的叫法';
}

/* 续跑：每次请求要打真中转（热片一次 0.7~1.1MB，实测单发 2.5s），一部最多 8 发，
   78 部一轮 ≈ 25~30 分钟，比一条命令的存活时间长——所以每跑完一部就把记录追加到
   wall2490-records.jsonl，下次进来跳过已跑的。判据一条没动，动的只是「什么时候停笔」。
   注意：只有 78 条全跑完才出数（PARTIAL 阶段不落任何汇总文件），免得把半截样本写成结论。 */
const REC = path.join(ROOT, 'tests', '_artifacts', 'wall2490-records.jsonl');
const doneA = {}, doneB = {};
try {
  fs.readFileSync(REC, 'utf8').split(NL).forEach(function (l) {
    if (!l.trim()) return;
    const o = JSON.parse(l);
    doneA[o.a.title] = o.a;
    if (o.b) doneB[o.b.title] = o.b;
  });
} catch (e) { /* 第一次跑还没这个文件 */ }

(async function main() {
  const t0 = Date.now();
  const budget = Number(process.env.AT_BUDGET || 0) * 1000;
  for (let i = 0; i < titles.length; i++) {
    if (doneA[titles[i]]) continue;
    const s = { title: titles[i] };
    const ra = await sweep(s);
    doneA[ra.title] = ra;
    let rb = null;
    if (!ra.hit) {
      rb = await sweep({ title: titles[i], kind: '动画' });
      doneB[rb.title] = rb;
    }
    process.stdout.write((ra.hit ? 'A中 ' : 'A— ') + titles[i].slice(0, 24) + NL);
    if (rb) process.stdout.write('  B' + (rb.hit ? '中 ' : '— ') + titles[i].slice(0, 24) + NL);
    fs.appendFileSync(REC, JSON.stringify({ a: ra, b: rb }) + NL);
    if (budget && Date.now() - t0 > budget) {
      process.stdout.write('PARTIAL 本轮时间盒到，已跑 ' + Object.keys(doneA).length + '/' + titles.length + NL);
      process.exit(0);
    }
  }
  const A = [], B = [];
  for (let i = 0; i < titles.length; i++) {
    const ra = doneA[titles[i]];
    if (!ra) continue;
    A.push(ra);
    if (!ra.hit && doneB[titles[i]]) B.push(doneB[titles[i]]);
  }
  if (A.length < titles.length) {
    process.stdout.write('PARTIAL 记录只有 ' + A.length + '/' + titles.length + '，不出数' + NL);
    process.exit(0);
  }
  const hitA = A.filter(function (r) { return r.hit; });
  const hitB = B.filter(function (r) { return r.hit; });
  const fam = {};
  hitA.concat(hitB).forEach(function (r) {
    const f = whichFamily({ title: r.title }, r.hit.key);
    fam[f] = (fam[f] || 0) + 1;
  });
  const blocked = [];
  A.concat(B).forEach(function (r) { if (!r.hit && r.blocked.length) blocked.push(r.title + ' → ' + r.blocked.join('；')); });
  const errs = [];
  A.concat(B).forEach(function (r) { r.errs.forEach(function (e) { errs.push(r.title + ' :: ' + e); }); });

  /* 「挡掉」是**记录数**，不是一部数：A 遍按真人侧问、B 遍按动画侧问，同一部常常 A 遍被频道闸挡、
     B 遍就中了（这正是这道闸要的：名字全等但爱奇艺把条目挂在另一侧就不许认）。
     所以另算「两遍都被挡」的那批——那才是真的「名字对上却故意不取」。 */
  const bothBlocked = A.filter(function (r) {
    if (r.hit || !r.blocked.length) return false;
    const b = doneB[r.title];
    return !!(b && !b.hit && b.blocked.length);
  }).map(function (r) { return r.title; });
  const chCount = {};
  A.concat(B).forEach(function (r) {
    r.blocked.forEach(function (s) {
      const m = /\[([^\]]+)\]/.exec(s);
      if (m) chCount[m[1]] = (chCount[m[1]] || 0) + 1;
    });
  });

  const img = function (pic) { return '/iq-img?url=' + encodeURIComponent(pic); };
  const esc = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const chips = [
    ['样本（日志里去重后的条目名）', titles.length],
    ['真人侧命中（kind 缺失那条保守规则）', hitA.length],
    ['动画侧补中（只补 A 没中的）', hitB.length],
    ['合计拿到海报', hitA.length + hitB.length],
    ['仍一条图都没有', titles.length - hitA.length - hitB.length],
    ['被挡记录数（一部两遍各记一条，不算两部）', blocked.length],
    ['两遍都被挡＝名字全等但爱奇艺挂在另一侧', bothBlocked.length],
    ['中转报错（截断/限流/超时）', errs.length],
  ];
  let h = '<!doctype html><meta charset="utf-8"><title>v2.49.0 爱奇艺这一环实测墙页</title>' +
    '<style>body{font:14px/1.6 system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}' +
    '.chip{display:inline-block;margin:4px 8px 4px 0;padding:6px 12px;background:#fff;border:1px solid #ddd;border-radius:14px}' +
    '.chip b{font-size:20px;margin-right:6px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:12px;margin:18px 0}' +
    '.card{background:#fff;border:1px solid #e3e3e3;border-radius:8px;padding:8px}.card img{width:100%;height:192px;object-fit:cover;border-radius:5px;display:block}' +
    '.card .t{font-size:12px;margin-top:6px}.card .k{font-size:11px;color:#777}h2{margin:26px 0 8px;font-size:16px}' +
    'pre{white-space:pre-wrap;background:#fff;border:1px solid #e3e3e3;border-radius:8px;padding:10px;font-size:12px}</style>';
  h += '<h1>v2.49.0 爱奇艺这一环：实测能救回几部</h1>';
  h += '<p>口径：样本＝服务器日志里出现过的 q= 查询（去重 ' + titles.length + ' 条），都是 TVMaze 三条路都不中的条目名；' +
    '判据＝从 index.html 原样 slice 出来的 iqKeys/iqPick/iqRows/iqChAllow（不是这份脚本另写一套）；' +
    '打的地址＝本机 8099 的 /iq-relay（和页面走的同一条中转）。' +
    'A 遍按真身的保守规则（kind 缺失＝真人侧），B 遍只补 A 没中的、按 kind=动画 再问。' +
    '「被挡」是**记录数**：同一部在 A 遍被频道闸挡、B 遍可能就中了（这恰是闸要的效果），两遍都挡的才列在最后一节。</p>';
  chips.forEach(function (c) { h += '<span class="chip"><b>' + c[1] + '</b>' + esc(c[0]) + '</span>'; });
  h += '<h2>钥匙家族分布（命中是靠哪一把问出来的）</h2><pre>';
  Object.keys(fam).sort(function (a, b) { return fam[b] - fam[a]; }).forEach(function (k) { h += k + '：' + fam[k] + NL; });
  h += '</pre>';
  h += '<h2>拿到海报的（每张都是 /iq-img 现搬回来的字节，图裂了就是中转没通）</h2><div class="grid">';
  hitA.concat(hitB).forEach(function (r) {
    h += '<div class="card"><img src="' + img(r.hit.pic) + '" alt=""><div class="t">' + esc(r.title) +
      '</div><div class="k">' + esc(r.hit.name) + ' · ' + esc(r.hit.ch) + ' · 靠「' + esc(whichFamily({ title: r.title }, r.hit.key)) + '」</div></div>';
  });
  h += '</div>';
  h += '<h2>名字对上了却被挡掉的（宁缺勿错：频道不同侧 / 没有可用图；下面每行是「一遍」的记录）</h2><pre>' +
    (blocked.length ? esc(blocked.join(NL)) : '（无）') + '</pre>';
  h += '<h2>挡掉的频道分布（爱奇艺把同名条目挂在哪个频道）</h2><pre>';
  Object.keys(chCount).sort(function (a, b) { return chCount[b] - chCount[a]; }).forEach(function (k) { h += k + '：' + chCount[k] + NL; });
  h += '</pre>';
  h += '<h2>两遍都被挡的这几部＝名字全等但那条目在另一侧/是另一部（故意不取，留给待指认）</h2><pre>' +
    (bothBlocked.length ? esc(bothBlocked.join(NL)) : '（无）') + '</pre>';
  h += '<h2>还是没图的那些（前 40 条）</h2><pre>' +
    esc(A.filter(function (r) { return !r.hit && !B.some(function (x) { return x.title === r.title && x.hit; }); })
      .slice(0, 40).map(function (r) { return r.title + '  问过：' + r.keys.join(' / '); }).join(NL)) + '</pre>';
  h += '<h2>中转报错</h2><pre>' + (errs.length ? esc(errs.join(NL)) : '（无）') + '</pre>';
  fs.writeFileSync(path.join(ROOT, 'tests', '_artifacts', 'v2490-wall.html'), h, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'last-iq-wall.json'), JSON.stringify({
    sample: titles.length, hitLive: hitA.length, hitAnimeSide: hitB.length, total: hitA.length + hitB.length,
    families: fam, blockedCount: blocked.length, blockedTitlesBothPass: bothBlocked.length,
    blockedChannels: chCount, errCount: errs.length,
  }, null, 1), 'utf8');
  console.log(NL + '样本 ' + titles.length + ' | 真人侧 ' + hitA.length + ' | 动画侧补 ' + hitB.length +
    ' | 合计 ' + (hitA.length + hitB.length) + ' | 挡掉 ' + blocked.length + ' | 报错 ' + errs.length);
  console.log('墙页 tests/_artifacts/v2490-wall.html');
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
