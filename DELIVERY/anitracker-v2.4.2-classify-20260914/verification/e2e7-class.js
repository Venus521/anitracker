/* E2E-7 分类体系验证：系列级删除 / 每集独立 / 待核语义 / 联网查证入口 */
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const BASE = 'http://127.0.0.1:8091/index.html';
const results = [];
const ok = (n, c, e) => { results.push({ name: n, pass: !!c }); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (e ? ('  ' + String(e).slice(0, 80)) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const perrs = [];
  page.on('pageerror', e => perrs.push(String(e).slice(0, 200)));
  await page.setViewport({ width: 460, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);

  /* A 注入旧数据（带系列级 type=tv-original，无任何集级证据）→ reload 触发迁移 */
  await page.evaluate(() => {
    const eps = []; for (let i = 1; i <= 12; i++) eps.push({ s: i, t: '第 ' + i + ' 集' });
    shows.push({ sid: 'old-type', title: '旧数据测试番', nameJp: '', cover: '', year: '2020', total: 12, eps: eps, statuses: {}, status: 'watching', type: 'tv-original', source: '测试', addedAt: Date.now(), updAt: Date.now() });
    save();
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  const mig = await page.evaluate(() => { const s = shows.find(x => x.sid === 'old-type'); return { hasType: s ? ('type' in s) : null, n: s ? s.eps.length : 0 }; });
  ok('A1 迁移后系列级字段已移除', mig.hasType === false, 'type in data=' + mig.hasType);

  await page.evaluate(() => { openDetail('old-type'); });
  await sleep(300);
  const a = await page.evaluate(() => ({
    meta: document.getElementById('dMeta').innerHTML,
    grid: document.getElementById('dGroups').textContent,
    cov: document.getElementById('dSrcCov').textContent,
    pill: document.querySelector('#list .show .s') ? document.querySelector('#list .show .s').textContent : '(list hidden)'
  }));
  ok('A2 详情页无系列级徽章', !a.meta.includes('type-tag'), a.meta.slice(0, 60));
  ok('A3 不再摊派：每集显示待核', (a.grid.match(/待核/g) || []).length === 12 && !a.grid.includes('TV原创'), '待核x' + (a.grid.match(/待核/g) || []).length);
  ok('A4 覆盖行为「待核 12」', a.cov.includes('待核 12'), a.cov.slice(0, 60));

  /* B 列表行与筛选行 */
  await page.evaluate(() => { backList(); });
  await sleep(300);
  const b = await page.evaluate(() => ({
    row: (document.querySelector('#list .show .s') || {}).textContent || '',
    typeRow: (document.getElementById('showTypeRow') || {}).innerHTML === '' || document.getElementById('showTypeRow') === null ? 'empty' : document.getElementById('showTypeRow').innerHTML
  }));
  ok('B1 列表行无系列级标签', !/原作改编|TV原创|半原创|未分类/.test(b.row), b.row.slice(0, 50));
  ok('B2 列表类型筛选行已移除', b.typeRow === 'empty', b.typeRow.slice(0, 40));

  /* C 标题判定与手动标注仍生效（每集独立） */
  await page.evaluate(() => { const s = shows.find(x => x.sid === 'old-type'); s.eps[2].t = '特别篇 【动画原创】'; s.eps[0].src = 'canon'; s.eps[0].srcNote = '资料核对'; s.updAt = Date.now(); save(); statInvalidate(s.sid); openDetail('old-type'); });
  await sleep(300);
  const c = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#dGroups .eprow')];
    return { r1: rows[0].textContent, r3: rows[2].textContent, cov: document.getElementById('dSrcCov').textContent };
  });
  ok('C1 人工标注集显示漫改', c.r1.includes('漫改'), c.r1.slice(0, 40));
  ok('C2 标题判定集显示TV原创', c.r3.includes('TV原创'), c.r3.slice(0, 40));
  ok('C3 覆盖行：漫改1 · TV原创1 · 待核10', c.cov.includes('漫改 1') && c.cov.includes('TV原创 1') && c.cov.includes('待核 10'), c.cov.slice(0, 70));

  /* D editSrc 面板文案 */
  await page.evaluate(() => { editSrc(5); });
  await sleep(200);
  const d = await page.evaluate(() => { const m = document.getElementById('srcEditMask'); const t = m ? m.textContent : ''; const r = m ? m.remove() : null; return t; });
  ok('D1 标注面板文案对齐（漫改/待核）', d.includes('漫改') && d.includes('待核') && !d.includes('原作改编') && !d.includes('未判定'));

  /* E 来源标注工具：联网查证入口 */
  await page.evaluate(() => { showSrcTools(); });
  await sleep(200);
  const e2 = await page.evaluate(() => { const m = document.getElementById('srcToolsMask'); const t = m ? m.textContent : ''; return { t, wiki: !!document.querySelector('#srcToolsMask [onclick*=webCheck]') }; });
  ok('E1 联网查证入口存在（维基/萌百/AFG）', e2.t.includes('维基百科') && e2.t.includes('萌娘百科') && e2.t.includes('AFG 英文站') && e2.wiki);
  await page.evaluate(() => { const m = document.getElementById('srcToolsMask'); if (m) m.remove(); });

  /* F 内置库「长篇」栏目分类保留 */
  await page.evaluate(() => { renderInternalLib(); });
  await sleep(400);
  const f = await page.evaluate(() => ({
    filters: document.getElementById('filters').textContent,
    row: (document.querySelector('#list .show .s') || {}).textContent || ''
  }));
  ok('F1 内置库栏目筛选保留（全部/长篇等）', f.filters.includes('全部'), f.filters.slice(0, 40));
  ok('F2 内置库行无语义分类泄漏', !/manga-adapt|tv-original|semi-original/.test(f.row + f.filters), f.row.slice(0, 50));

  ok('Z1 无页面 JS 错误', perrs.length === 0, perrs.join('|').slice(0, 160));
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  await browser.close();
  const fail = results.filter(r => !r.pass).length;
  console.log('\n==== CLASS SUMMARY: ' + (results.length - fail) + '/' + results.length + ' passed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('EXCEPTION', e && (e.stack || e.message)); process.exit(1); });
