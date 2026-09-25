/* shots-v292.js — 拍 v2.9.2 同步面板改版对比图
   用法：node tests\shots-v292.js */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.9.2-sync-ux-20260925', 'shots');
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
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8097', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
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
  await waitPort(8097, '/index.html', 30);

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
  await page.goto('http://127.0.0.1:8097/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1400);

  /* 造一点数据：一部关联 Bangumi 的番 + 一部本地番 */
  await page.evaluate(() => {
    const now = Date.now();
    addShow({ sid: '900001', bgmId: '900001', title: '模拟番 第一季', nameJp: 'モギホン', cover: '', year: '2024',
      total: 8, eps: Array.from({ length: 8 }, (_, i) => ({ s: i + 1, t: '第' + (i + 1) + '集', type: 'unknown' })),
      statuses: {}, status: 'watching', addedAt: now, updAt: now, source: 'Bangumi' });
    addShow({ sid: 'man-' + now, title: '本地添加的番', nameJp: '', cover: '', year: '2026', total: 3,
      eps: [{ s: 1, t: '第1集', type: 'unknown' }], statuses: {}, status: 'watching',
      addedAt: now, updAt: now, source: '手动添加', manual: 1 });
  });
  await sleep(600);

  /* ① 同步面板：状态条 + 常开档 + 折叠档（未绑定态） */
  await page.evaluate(() => { localStorage.removeItem('at_bgm_token'); syncOpen(); });
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, '01-同步面板-未绑定.png'), fullPage: true });
  await page.evaluate(() => window.__closeSync()); await sleep(300);

  /* ② 同步面板：已绑定态（状态条显示上次同步 + 主按钮变「立即同步」） */
  await page.evaluate(() => {
    localStorage.setItem('at_bgm_token', 'demo');
    localStorage.setItem('tr_synclast', JSON.stringify({ at: new Date(Date.now() - 3600e3).toISOString(), res: { up: 12, down: 3, conflict: 0 } }));
    syncOpen();
  });
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, '02-同步面板-已绑定.png'), fullPage: true });
  await page.evaluate(() => window.__closeSync()); await sleep(300);

  /* ③ 折叠档展开后（低频功能都在，只是收起） */
  await page.evaluate(() => { syncOpen(); });
  await sleep(900);
  await page.evaluate(() => { document.querySelectorAll('details.syfold').forEach(d => { d.open = true; }); });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '03-同步面板-展开低频档.png'), fullPage: true });
  await page.evaluate(() => window.__closeSync()); await sleep(300);

  /* ④ 详情页：关联 Bangumi 的番 → 显示拉取/推送 */
  await page.evaluate(() => openDetail('900001'));
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, '04-详情页-已关联Bangumi.png'), clip: { x: 0, y: 0, width: 460, height: 620 } });

  /* ⑤ 详情页：本地番 → 同步按钮消失，日常按钮在前 */
  const localSid = await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
    return (a.filter(x => /^man-/.test(String(x.sid)))[0] || {}).sid;
  });
  await page.evaluate(sid => openDetail(sid), localSid);
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, '05-详情页-本地番无同步按钮.png'), clip: { x: 0, y: 0, width: 460, height: 620 } });

  console.log('SHOTS OK -> ' + OUT);
  await browser.close(); srv.kill(); mock.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
