/* shots-v2100.js — 拍 v2.10.0 账号面板（同步移除、账号上位后）
   用法：node tests\shots-v2100.js */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const ROOT = path.resolve(__dirname, '..');
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.10.0-account-20260925', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PY = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8099', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
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
  await waitPort(8099, '/index.html', 30);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1080, deviceScaleFactor: 2 });
  page.on('dialog', d => d.accept());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    // 屏蔽 CloudBase 云请求，拍纯本地形态（不出网、不卡加载）
    if (/tcb-api|tcloudbase|cloudbase/.test(u)) return req.abort();
    if (u.includes('api.bgm.tv')) return req.continue({ url: u.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
    const m = u.match(/^https?:\/\/(?:proxy\.cors\.sh\/|api\.codetabs\.com\/v1\/proxy\/\?)(.+)$/);
    if (m) return req.continue({ url: decodeURIComponent(m[1]).replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
    req.continue();
  });
  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1400);

  // 01 顶栏：入口已由「同步」改名「账号」
  await page.screenshot({ path: path.join(OUT, '01-顶栏-账号入口.png'), clip: { x: 0, y: 0, width: 460, height: 240 } });

  // 02 账号面板全貌
  await page.evaluate(() => openAccount());
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, '02-账号面板.png') });

  // 03 账号区特写（登录/注册）
  const acctBox = await page.evaluate(() => {
    const el = document.getElementById('syCardAcct');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(460, r.width + 16), height: r.height + 16 };
  });
  if (acctBox) await page.screenshot({ path: path.join(OUT, '03-账号区特写.png'), clip: acctBox });

  // 04 详情页按钮区（拉取/推送已消失）
  await page.evaluate(() => window.__closeSync());
  await sleep(400);
  await page.evaluate(() => {
    const now = Date.now();
    addShow({ sid: '900001', bgmId: '900001', title: '模拟番 第一季', nameJp: 'モギホン', cover: '', year: '2024',
      total: 8, eps: Array.from({ length: 8 }, (_, i) => ({ s: i + 1, t: '第' + (i + 1) + '集', type: 'unknown' })),
      statuses: {}, status: 'watching', addedAt: now, updAt: now, source: 'Bangumi' });
  });
  await sleep(500);
  await page.evaluate(() => openDetail('900001'));
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, '04-详情页-按钮区.png'), clip: { x: 0, y: 0, width: 460, height: 620 } });

  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('#vDetail .ty')).map(b => b.textContent.trim()).filter(Boolean));
  console.log('DETAIL BUTTONS: ' + JSON.stringify(btns));
  console.log('TOP LABEL: ' + await page.evaluate(() => document.querySelector('.topbtn.wide').textContent.trim()));
  console.log('SHOTS OK -> ' + OUT);
  await browser.close(); srv.kill(); mock.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
