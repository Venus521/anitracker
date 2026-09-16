/* E2E-8 抽查核验：代表番每部抽 ~10% 集（≥3），判定器输出 vs 标题/显式数据来源对照 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const BASE = 'http://127.0.0.1:8091/index.html';
const OUT = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\audit-sample.json`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);
  const rep = await page.evaluate(() => {
    const lib = window.ANITRACKER_LIB || [];
    const withTitleTag = lib.filter(s => (s.eps || []).some(e => String(e.t || '').indexOf('【动画原创】') >= 0));
    const without = lib.filter(s => (s.eps || []).length && !(s.eps || []).some(e => String(e.t || '').indexOf('【动画原创】') >= 0) && !(s.eps || []).some(e => e.type));
    const movies = lib.filter(s => (s.eps || []).length && String(s.type || '') === '剧场版');
    const pick = [];
    withTitleTag.slice(0, 4).forEach(s => pick.push({ s, kind: '标题标注系' }));
    without.slice(0, 2).forEach(s => pick.push({ s, kind: '无标注系' }));
    movies.slice(0, 1).forEach(s => pick.push({ s, kind: '剧场版' }));
    const out = { total: lib.length, withTitleTag: withTitleTag.length, groups: [] };
    pick.forEach(({ s, kind }) => {
      const eps = s.eps || [];
      const n = Math.max(3, Math.min(15, Math.ceil(eps.length * 0.1)));
      const step = Math.max(1, Math.floor(eps.length / n));
      const rows = [];
      for (let i = 0, k = 0; i < eps.length && k < n; i += step, k++) {
        const e = eps[i];
        const inf = srcInfoOf(s, e);
        const hasTag = String(e.t || '').indexOf('【动画原创】') >= 0;
        const expSrc = e.type === 'filler' || e.type === 'semi' || e.type === 'movie' ? e.type : (hasTag ? (e.type === 'semi' ? 'semi' : 'filler') : null);
        rows.push({
          ep: e.s, title: String(e.t || '').slice(0, 24),
          judged: inf.src, by: inf.by,
          hasTag: hasTag, dataType: e.type || '',
          expect: expSrc || 'unknown',
          match: expSrc ? (inf.src === expSrc) : (inf.src === 'unknown')
        });
      }
      out.groups.push({ title: s.title, kind: kind, epsTotal: eps.length, sampled: rows.length, rows: rows });
    });
    return out;
  });
  await browser.close();
  let total = 0, match = 0;
  rep.groups.forEach(g => { g.rows.forEach(r => { total++; if (r.match) match++; }); });
  rep.sampled = total; rep.matched = match; rep.rate = total ? (match / total * 100).toFixed(1) + '%' : 'n/a';
  fs.writeFileSync(OUT, JSON.stringify(rep, null, 1));
  console.log('lib total:', rep.total, '| 标题标注系:', rep.withTitleTag, '| 抽样:', total, '| 一致:', match, '| 一致率:', rep.rate);
  rep.groups.forEach(g => {
    console.log('---- ' + g.title + '（' + g.kind + ', 共 ' + g.epsTotal + ' 集, 抽 ' + g.sampled + '）----');
    g.rows.forEach(r => console.log('  第' + r.ep + '集 [' + r.judged + '/' + r.by + '] 期望[' + r.expect + '] ' + (r.match ? 'OK' : 'MISMATCH') + ' ' + r.title));
  });
})().catch(e => { console.log('EXCEPTION', e && (e.stack || e.message)); process.exit(1); });
