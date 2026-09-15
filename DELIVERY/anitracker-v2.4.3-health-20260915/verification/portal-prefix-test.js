/* 门户按钮诊断（修复前证据）：点击"去门户播放"记录实际落点 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\anitracker-health-20260914`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  const before = { url: 'http://127.0.0.1:8089/index.html' };
  await page.goto(before.url, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => {
    localStorage.setItem('tr_shows', JSON.stringify([{ sid: 'portal-test', title: '孤独摇滚！', nameJp: '', cover: '', year: '2022', total: 12, eps: [{ s: 1, t: '第1集', dur: 24 }], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: '手动添加' }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => openDetail('portal-test'));
  await sleep(700);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
    page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.indexOf('去门户播放') >= 0); b && b.click(); })
  ]);
  await sleep(1500);
  const after = await page.evaluate(() => ({ title: document.title, body: (document.body.innerText || '').slice(0, 250) }));
  const evidence = { clickedAt: before.url, landedUrl: page.url(), landedTitle: after.title, landedBody: after.body };
  fs.writeFileSync(path.join(OUT, 'portal-prefix-TEST.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(OUT, 'portal-prefix-pre.png') });
  console.log('=== PORTAL PRE-FIX EVIDENCE ===');
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
