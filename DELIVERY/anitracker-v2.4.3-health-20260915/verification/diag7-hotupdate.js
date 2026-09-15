/* 诊断 7：热更新可见性 —— SW 已激活时，普通刷新是否立即可见文件改动（无需强刷/换参数）
   注意：会对 index.html 做一次「改标题→验证→还原」的原子操作，双保险还原 + 哈希校验。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\anitracker-health-20260914`;
const FILE = String.raw`D:\项目\01_媒体娱乐\ani-tracker\index.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shaBuf = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });

  const originalBuf = fs.readFileSync(FILE);
  const original = originalBuf.toString('utf8');
  const shaBefore = shaBuf(originalBuf);
  const marker = '【热更新测试-' + Date.now() + '】';
  const result = { file: FILE, marker, shaBefore, baseline: null, afterChange: null, afterRevert: null, shaRevertOk: false };

  try {
    // 1) 基线加载（让 SW 完成安装/激活）
    await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2200);
    result.baseline = await page.evaluate(() => ({ title: document.title, swActive: !!(navigator.serviceWorker && navigator.serviceWorker.controller) }));

    // 2) 修改文件（标题加标记）
    const modified = original.replace('<title>追迹 · AniTracker</title>', '<title>追迹 · AniTracker ' + marker + '</title>');
    if (modified === original) throw new Error('title anchor not found');
    fs.writeFileSync(FILE, modified, 'utf8');
    await sleep(400);

    // 3) 普通刷新 → 期望标记立即可见
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1300);
    result.afterChange = await page.evaluate(() => ({ title: document.title }));
    result.markerVisibleAfterPlainReload = result.afterChange.title.indexOf(marker) >= 0;

    // 4) 还原 → 普通刷新 → 期望回到原状
    fs.writeFileSync(FILE, original, 'utf8');
    await sleep(400);
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1300);
    result.afterRevert = await page.evaluate(() => ({ title: document.title }));
    result.shaRevertOk = shaBuf(fs.readFileSync(FILE)) === shaBefore;
    result.pass = result.markerVisibleAfterPlainReload && result.afterRevert.title.indexOf(marker) < 0 && result.shaRevertOk;
  } finally {
    const cur = fs.readFileSync(FILE);
    if (shaBuf(cur) !== shaBefore) fs.writeFileSync(FILE, original, 'utf8');
  }

  fs.writeFileSync(path.join(OUT, 'diag7-hotupdate.json'), JSON.stringify(result, null, 2));
  console.log('=== DIAG7 HOT-UPDATE ===');
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => { console.error('DIAG7 ERR', e); process.exit(1); });
