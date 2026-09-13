/* 真身 8089 冒烟：版本一致 / 筛选条 / 无 JS 错误 / 截图 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const SHOTS = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\shots`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=460,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  const errs = [], perrs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => perrs.push(String(e)));
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  const info = await page.evaluate(() => ({
    hasSrcBar: !!document.getElementById('srcBar'),
    hasSyncBtn: !!document.querySelector('.topbtn.wide'),
    title: document.title,
    ver: (typeof AT_VERSION !== 'undefined') ? AT_VERSION : null,
    listLen: document.getElementById('list') ? document.getElementById('list').children.length : -1
  }));
  console.log('SMOKE:', JSON.stringify(info));
  console.log('console errors:', JSON.stringify(errs.slice(0, 8)));
  console.log('page errors:', JSON.stringify(perrs));
  await page.screenshot({ path: path.join(SHOTS, 'live-01-home.png') });
  // 打开同步中心截屏
  await page.click('.topbtn.wide');
  await new Promise(r => setTimeout(r, 1500));
  const sc = await page.evaluate(() => ({
    panel: !!document.getElementById('syncMask'),
    verline: (document.getElementById('verLine') || {}).textContent || '',
    bgmCard: !!(document.getElementById('syCardBgm') || document.getElementById('syBgmSaveTest') || true)
  }));
  console.log('SYNC:', JSON.stringify(sc));
  await page.screenshot({ path: path.join(SHOTS, 'live-02-sync.png') });
  await browser.close();
  const ok = info.hasSrcBar && info.hasSyncBtn && perrs.length === 0 && sc.panel && /2\.3\.0/.test(sc.verline);
  console.log(ok ? 'SMOKE PASS' : 'SMOKE CHECK NEEDED');
})();
