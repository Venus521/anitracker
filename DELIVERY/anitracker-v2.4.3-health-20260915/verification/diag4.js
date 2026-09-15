/* 诊断 4：缓存与刷新一致性 —— 普通刷新 / 全量绕缓存 / 版本号轮询 / SW 状态 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\anitracker-health-20260914`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function snap(page, label) {
  const st = await page.evaluate(() => ({
    ver: (typeof AT_VERSION !== 'undefined') ? AT_VERSION : null,
    build: (typeof AT_BUILD !== 'undefined') ? AT_BUILD : null,
    swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    swState: navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.controller.state : null,
    listRendered: !!document.querySelector('.show') || !!document.getElementById('emptyBox'),
    bodyLen: (document.body.innerText || '').length,
    lsCount: Object.keys(localStorage).length
  }));
  return { label, ...st };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  const results = [];

  // 首次加载
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:8089/index.html?v=375276448', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  results.push({ ...(await snap(page, 'first-load-with-v')), ms: Date.now() - t0 });

  // 普通刷新
  let t = Date.now();
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  results.push({ ...(await snap(page, 'normal-reload')), ms: Date.now() - t });

  // 带随机 v 刷新（模拟一键打开）
  t = Date.now();
  await page.goto('http://127.0.0.1:8089/index.html?v=' + Math.floor(Math.random() * 1e9), { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  results.push({ ...(await snap(page, 'random-v-reload')), ms: Date.now() - t });

  // 不带参数
  t = Date.now();
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  results.push({ ...(await snap(page, 'no-param')), ms: Date.now() - t });

  // 全量绕缓存刷新（等同 Ctrl+F5 关闭缓存）
  t = Date.now();
  await page.setCacheEnabled(false);
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  await page.setCacheEnabled(true);
  results.push({ ...(await snap(page, 'bypass-cache-reload')), ms: Date.now() - t });

  // 检查 tracker-version.json 与页面版本
  const ver = await page.evaluate(async () => {
    try { const r = await fetch('tracker-version.json?_=' + Date.now(), { cache: 'no-store' }); const j = await r.json(); return { server: j.version, build: j.build, page: AT_VERSION }; }
    catch (e) { return { err: String(e) }; }
  });

  // 隐身等价：新开持久化隔离的 browser context（新 profile 语义）
  const ctx2 = await browser.createBrowserContext();
  const page2 = await ctx2.newPage();
  t = Date.now();
  await page2.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  const incog = await snap(page2, 'fresh-context (incognito-like)');
  await ctx2.close();

  const summary = { startedAt: new Date(t0).toISOString(), results, versionCheck: ver, incognitoLike: incog };
  fs.writeFileSync(path.join(OUT, 'diag4-result.json'), JSON.stringify(summary, null, 2));
  console.log('=== DIAG4 DONE ===');
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch(e => { console.error('DIAG4 ERROR:', e); process.exit(1); });
