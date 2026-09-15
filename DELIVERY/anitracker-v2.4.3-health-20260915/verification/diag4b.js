/* 诊断 4b：解释 body 文本量异常 + 渲染完整度检查（含种子数据） */
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
  const consoleMsgs = [], pageErrors = [];
  page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 300) }));
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 400)));

  const report = {};
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  report.emptyState = await page.evaluate(() => ({
    bodyLen: document.body.innerText.length,
    text: document.body.innerText.slice(0, 500),
    wrapExists: !!document.querySelector('.wrap'),
    vListDisplay: (document.getElementById('vList') || {}).style ? document.getElementById('vList').style.display : 'n/a',
    listChildren: (document.getElementById('list') || { children: [] }).children.length,
    listHTMLLen: ((document.getElementById('list') || {}).innerHTML || '').length,
    hasEmptyBox: !!document.getElementById('emptyBox'),
    allIds: Array.from(document.querySelectorAll('[id]')).map(e => e.id).slice(0, 60)
  }));
  await page.screenshot({ path: path.join(OUT, 'diag4b-1-empty.png') });

  // 种子：一条完整条目（有 eps）
  await page.evaluate(() => {
    const eps = []; for (let i = 1; i <= 12; i++) eps.push({ s: i, t: '第' + i + '集', ref: null, dur: 24 });
    localStorage.setItem('tr_shows', JSON.stringify([{
      sid: 'seed-full-001', title: '种子数据条目（12集）', nameJp: '', cover: '', year: '2022',
      total: 12, eps: eps, statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: '手动添加'
    }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  report.withData = await page.evaluate(() => ({
    bodyLen: document.body.innerText.length,
    text: document.body.innerText.slice(0, 400),
    showCount: document.querySelectorAll('.show').length,
    listChildren: (document.getElementById('list') || { children: [] }).children.length
  }));
  await page.screenshot({ path: path.join(OUT, 'diag4b-2-with-data.png') });

  // 打开详情
  await page.evaluate(() => openDetail('seed-full-001'));
  await sleep(700);
  report.detail = await page.evaluate(() => ({
    bodyLen: document.body.innerText.length,
    text: document.body.innerText.slice(0, 400),
    nextBtnText: (document.getElementById('nextBtn') || {}).textContent || '',
    epsGridCount: document.querySelectorAll('#grid .ep, .ep').length
  }));
  await page.screenshot({ path: path.join(OUT, 'diag4b-3-detail.png') });

  report.consoleErrors = consoleMsgs.filter(m => m.type === 'error').slice(0, 10);
  report.pageErrors = pageErrors;
  fs.writeFileSync(path.join(OUT, 'diag4b-result.json'), JSON.stringify(report, null, 2));
  console.log('DONE diag4b');
  await browser.close();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
