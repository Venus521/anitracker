/* 清洁环境复现检查：可指定 BASE 环境的整页加载 + 拉取测试 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\anitracker-health-20260914`;
const BASE = process.env.CE_BASE || 'http://127.0.0.1:8097';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  const errs = [], perrs = [], bad = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 220)); });
  page.on('pageerror', e => perrs.push(String(e).slice(0, 320)));
  page.on('response', r => { if (r.status() >= 400) bad.push({ url: r.url().slice(0, 160), status: r.status() }); });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  const st = await page.evaluate(async () => {
    let cachesKeys = [];
    try { cachesKeys = await caches.keys(); } catch (e) {}
    return { ver: AT_VERSION, build: AT_BUILD, faviconLink: !!document.querySelector('link[rel="icon"]'), cachesKeys };
  });
  const fav = await page.evaluate(async () => { try { const r = await fetch('/favicon.ico', { cache: 'no-store' }); return r.status; } catch (e) { return String(e); } });

  await page.evaluate(() => {
    localStorage.setItem('tr_shows', JSON.stringify([{ sid: 'ce-test', title: '清洁环境测试', nameJp: '', cover: '', year: '2022', total: 0, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: '手动添加', bgmId: '328609' }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => openDetail('ce-test'));
  await sleep(500);
  await page.click('#nextBtn');
  let eps = -1;
  for (let i = 0; i < 90; i++) {
    await sleep(250);
    eps = await page.evaluate(() => { const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'ce-test') : null; return s ? (s.eps || []).length : -1; });
    if (eps > 0) break;
  }
  await page.screenshot({ path: path.join(OUT, 'clean-env-check.png') });
  const result = { base: BASE, ...st, faviconStatus: fav, pullEps: eps, consoleErrors: errs, pageErrors: perrs, badResponses: bad };
  fs.writeFileSync(path.join(OUT, 'clean-env-check.json'), JSON.stringify(result, null, 2));
  console.log('=== CLEAN-ENV CHECK ===');
  console.log(JSON.stringify({ ver: st.ver, build: st.build, favicon: fav, cachesKeys: st.cachesKeys, pullEps: eps, errCount: errs.length, perrCount: perrs.length, badCount: bad.length }, null, 2));
  await browser.close();
})().catch(e => { console.error('CE ERROR:', e); process.exit(1); });
