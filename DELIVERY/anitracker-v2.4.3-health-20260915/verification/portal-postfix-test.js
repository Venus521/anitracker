/* 门户按钮复验（修复后）：点击"去门户播放"应落到 localhost:3000 搜索页 */
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
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => {
    localStorage.setItem('tr_shows', JSON.stringify([{ sid: 'portal-test2', title: '孤独摇滚！', nameJp: '', cover: '', year: '2022', total: 12, eps: [{ s: 1, t: '第1集', dur: 24 }], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: '手动添加' }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => openDetail('portal-test2'));
  await sleep(700);

  const clickedBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.indexOf('去门户播放') >= 0);
    if (!b) return false;
    b.click(); return true;
  });
  await sleep(2500);
  const after = await page.evaluate(() => ({ title: document.title, body: (document.body.innerText || '').slice(0, 300) }));
  const evidence = {
    buttonClicked: clickedBtn,
    landedUrl: page.url(),
    landedTitle: after.title,
    landedBody: after.body
  };
  fs.writeFileSync(path.join(OUT, 'portal-postfix-TEST.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(OUT, 'portal-postfix.png') });
  console.log('=== PORTAL POST-FIX ===');
  console.log(JSON.stringify(evidence, null, 2));
  const okUrl = /localhost:3000\/search\/\?q=/.test(evidence.landedUrl);
  console.log('VERDICT:', okUrl ? 'PASS (landed on portal search)' : 'CHECK NEEDED');
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
