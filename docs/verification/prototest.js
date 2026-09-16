/* 排版原型验证：三档宽度/边界样例/自包含性 + 截图 */
const path = require('path');
const fs = require('fs');
const url = require('url');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const SRC = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\docs\排版评估与原型.html`;
const SHOTS = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\shots`;
const results = [];
const ok = (n, c, e) => { results.push({ name: n, pass: !!c }); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (e ? ('  ' + e) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  let failed = 0;
  try {
    const page = await browser.newPage();
    const errs = [], perrs = [], ext = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => perrs.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request', req => { const u = req.url(); if (!u.startsWith('file://') && !u.startsWith('data:')) ext.push(u); req.continue(); });
    const fileUrl = url.pathToFileURL(SRC).href;
    for (const w of [360, 460, 1280]) {
      await page.setViewport({ width: w, height: 1000, deviceScaleFactor: w === 1280 ? 1 : 2 });
      await page.goto(fileUrl, { waitUntil: 'load' });
      await sleep(300);
      const r = await page.evaluate(() => {
        const doc = document.documentElement;
        const screens = getComputedStyle(document.querySelector('.screens')).gridTemplateColumns.split(' ').length;
        const longEl = document.querySelector('.long');
        const clampEl = document.querySelector('.clamp2');
        return {
          overflow: doc.scrollWidth - doc.clientWidth,
          screensCols: screens,
          ellipsis: getComputedStyle(longEl).textOverflow === 'ellipsis' && longEl.scrollWidth > longEl.clientWidth,
          rightOk: longEl.getBoundingClientRect().right <= doc.clientWidth + 1,
          clamp: getComputedStyle(clampEl).webkitLineClamp,
          fsBody: getComputedStyle(doc).getPropertyValue('--fs-body').trim()
        };
      });
      ok('宽度 ' + w + '：无横向溢出', r.overflow <= 1, 'overflow=' + r.overflow);
      if (w === 460) ok('460：试排单列', r.screensCols === 1);
      if (w === 1280) ok('1280：试排双列', r.screensCols === 2);
      ok('宽度 ' + w + '：超长标题省略号生效', r.ellipsis === true);
      ok('宽度 ' + w + '：标题右缘不越界', r.rightOk === true);
      ok('宽度 ' + w + '：两行截断生效', r.clamp === '2');
      ok('宽度 ' + w + '：字号令牌就位(--fs-body=14px)', r.fsBody === '14px');
      await page.screenshot({ path: path.join(SHOTS, 'proto-full-' + w + '.png'), fullPage: w <= 460 });
    }
    await page.setViewport({ width: 1280, height: 1200, deviceScaleFactor: 1 });
    await page.goto(fileUrl, { waitUntil: 'load' });
    await sleep(300);
    const secs = await page.$$('section');
    if (secs[3]) await secs[3].screenshot({ path: path.join(SHOTS, 'proto-typo-1280.png') });
    if (secs[4]) await secs[4].screenshot({ path: path.join(SHOTS, 'proto-screens-1280.png') });
    if (secs[5]) await secs[5].screenshot({ path: path.join(SHOTS, 'proto-boundary-1280.png') });
    ok('章节截图 3 张（章节数≥6）', secs.length >= 6, 'sections=' + secs.length);
    ok('无外部资源请求（自包含）', ext.length === 0, ext.slice(0, 3).join(' '));
    ok('无页面级 JS 错误', perrs.length === 0, perrs.join('|').slice(0, 200));
    console.log('console errors:', JSON.stringify(errs.slice(0, 5)));
  } catch (e) {
    console.log('EXCEPTION:', e && (e.stack || e.message));
    results.push({ name: 'exception', pass: false });
  } finally {
    await browser.close();
  }
  failed = results.filter(r => !r.pass).length;
  fs.writeFileSync(path.join(SHOTS, 'proto-results.json'), JSON.stringify(results, null, 1));
  console.log('\n==== PROTO SUMMARY: ' + (results.length - failed) + '/' + results.length + ' passed ====');
  process.exit(failed ? 1 : 0);
})();
