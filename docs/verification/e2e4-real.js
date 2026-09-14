/* E2E-4 真网实测：8089 真身、无请求拦截、无 token —— 免绑定在线搜索（真 api.bgm.tv） */
const path = require('path');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const SHOTS = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\shots`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=460,1000'] });
  let pass = false;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(800);
    const noToken = await page.evaluate(() => !localStorage.getItem('at_bgm_token'));
    console.log('no token state:', noToken);
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '孤独摇滚'; doBgmSearch(); });
    await page.waitForFunction(() => document.getElementById('srList').textContent.includes('Bangumi 在线'), { timeout: 30000 }).catch(() => {});
    await sleep(2500);
    const r = await page.evaluate(() => ({
      list: document.getElementById('srList').textContent.slice(0, 300),
      msg: document.getElementById('srMsg').textContent,
      hasOnline: document.getElementById('srList').textContent.includes('Bangumi 在线'),
      hint: document.getElementById('addHint').textContent
    }));
    console.log('msg:', r.msg);
    console.log('hint:', r.hint);
    console.log('list head:', r.list.replace(/\n/g, ' '));
    pass = r.hasOnline && /孤独摇滚/.test(r.list) && pageErrors.length === 0;
    await page.screenshot({ path: path.join(SHOTS, 'live-05-real-search.png') });
    // 版本行
    await page.evaluate(() => syncOpen());
    await sleep(1200);
    const ver = await page.evaluate(() => (document.getElementById('verLine') || {}).textContent || '');
    console.log('version line:', ver);
    pass = pass && ver.includes('v2.4.0') && ver.includes('✓');
    await page.screenshot({ path: path.join(SHOTS, 'live-06-sync-v24.png') });
    console.log('pageErrors:', JSON.stringify(pageErrors.slice(0, 5)));
    console.log(pass ? 'E2E-4 REAL PASS' : 'E2E-4 REAL FAIL');
  } catch (e) {
    console.log('E2E-4 EXCEPTION:', e && (e.message || e));
  } finally {
    await browser.close();
  }
  process.exit(pass ? 0 : 1);
})();
