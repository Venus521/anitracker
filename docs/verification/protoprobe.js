/* 定点探针：找出 360 宽度下超出视口的元素 */
const path = require('path');
const url = require('url');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const SRC = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\docs\排版评估与原型.html`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 900, deviceScaleFactor: 1 });
  await page.goto(url.pathToFileURL(SRC).href, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 300));
  const out = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const bad = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > cw + 1 && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
        bad.push({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 48),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 36)
        });
      }
    });
    return { clientWidth: cw, scrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 30) };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
