/* 拍 AI 导入面板的「改造前」状态，供前后对比 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const ROOT = path.resolve(__dirname, '..');
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.10.1-ai-import-20260925', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PY = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8101', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-bgm-api.js')], { stdio: 'ignore' });
  const waitPort = async (port, p, tries) => {
    for (let i = 0; i < (tries || 30); i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true; await sleep(500);
    }
    return false;
  };
  await waitPort(8101, '/index.html', 30);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (/tcb-api|tcloudbase|cloudbase|static\.cloudbase/.test(u)) return req.abort();
    if (u.includes('api.bgm.tv')) return req.continue({ url: u.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
    const m = u.match(/^https?:\/\/(?:proxy\.cors\.sh\/|api\.codetabs\.com\/v1\/proxy\/\?)(.+)$/);
    if (m) return req.continue({ url: decodeURIComponent(m[1]).replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
    req.continue();
  });
  await page.goto('http://127.0.0.1:8101/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1300);

  const tag = process.argv[2] || 'before';

  await page.evaluate(() => {
    const now = Date.now();
    addShow({ sid: '900001', bgmId: '900001', title: '模拟番 第一季', nameJp: 'モギホン', cover: '', year: '2024',
      total: 16, eps: Array.from({ length: 16 }, (_, i) => ({ s: i + 1, t: '第' + (i + 1) + '集', type: 'unknown' })),
      statuses: {}, status: 'watching', addedAt: now, updAt: now, source: 'Bangumi' });
  });
  await sleep(500);
  await page.evaluate(() => openDetail('900001'));
  await sleep(800);
  await page.evaluate(() => aiPasteImport());
  await sleep(900);

  await page.screenshot({ path: path.join(OUT, `${tag}-01-空面板.png`) });

  // 贴入一段 AI 回答 → 预览态
  await page.evaluate(() => {
    const ta = document.getElementById('at270AiText');
    ta.value = '该动画的剧集构成如下：1-10集为漫画改编，11-15集是TV原创，第16集为半原创（部分原作+部分原创）。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const btn = await page.evaluate(() => {
    const b = document.getElementById('at270AiPrevBtn'); if (b) b.click(); return !!b;
  });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, `${tag}-02-识别结果.png`) });

  const info = await page.evaluate(() => {
    const g = id => { const e = document.getElementById(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    return {
      hasPrevBtn: !!document.getElementById('at270AiPrevBtn'),
      hasApplyBtn: !!document.getElementById('at270AiApply'),
      applyVisible: (() => { const e = document.getElementById('at270AiApply'); return e ? e.style.display !== 'none' : false; })(),
      prevText: g('at270AiPrev'),
      buttons: Array.from(document.querySelectorAll('#at270AiMask .sybtn, #at270AiMask .row2 button')).map(b => b.textContent.trim())
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('SHOTS OK -> ' + OUT);
  await browser.close(); srv.kill(); mock.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
