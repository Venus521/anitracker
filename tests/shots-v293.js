/* shots-v293.js — 拍 v2.9.3 详情页（移除「去门户播放」后）
   用法：node tests\shots-v293.js */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.9.3-pure-tracker-20260925', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PY = process.env.AT_PY || (function () {
    try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
      const fb = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
      console.warn('[tests] PATH 中未找到 python，回退旧写死路径：' + fb + '（可用环境变量 AT_PY 覆盖）');
      return fb;
    }
  })();
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8098', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
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
  await waitPort(8098, '/index.html', 30);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1080, deviceScaleFactor: 2 });
  page.on('dialog', d => d.accept());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.includes('api.bgm.tv')) return req.continue({ url: u.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
    const m = u.match(/^https?:\/\/(?:proxy\.cors\.sh\/|api\.codetabs\.com\/v1\/proxy\/\?)(.+)$/);
    if (m) return req.continue({ url: decodeURIComponent(m[1]).replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
    req.continue();
  });
  await page.goto('http://127.0.0.1:8098/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1400);

  await page.evaluate(() => {
    const now = Date.now();
    addShow({ sid: '900001', bgmId: '900001', title: '模拟番 第一季', nameJp: 'モギホン', cover: '', year: '2024',
      total: 8, eps: Array.from({ length: 8 }, (_, i) => ({ s: i + 1, t: '第' + (i + 1) + '集', type: 'unknown' })),
      statuses: {}, status: 'watching', addedAt: now, updAt: now, source: 'Bangumi' });
  });
  await sleep(600);
  await page.evaluate(() => openDetail('900001'));
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, '01-详情页-按钮区.png'), clip: { x: 0, y: 0, width: 460, height: 640 } });

  /* 断言按钮清单 */
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('#vDetail .ty')).map(b => b.textContent.trim()).filter(Boolean));
  console.log('BUTTONS: ' + JSON.stringify(btns));
  console.log('SHOTS OK -> ' + OUT);
  await browser.close(); srv.kill(); mock.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
