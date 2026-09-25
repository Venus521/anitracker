/* 浅色主题下的 AI 面板（验证配色跟随主题） */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.10.1-ai-import-20260925', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const PY = process.env.AT_PY || (function () {
    try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
      const fb = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
      console.warn('[tests] PATH 中未找到 python，回退旧写死路径：' + fb + '（可用环境变量 AT_PY 覆盖）');
      return fb;
    }
  })();
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8102', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
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
  await waitPort(8102, '/index.html', 30);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (/tcb-api|tcloudbase|cloudbase|static\.cloudbase/.test(u)) return req.abort();
    if (u.includes('api.bgm.tv')) return req.continue({ url: u.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
    req.continue();
  });
  await page.goto('http://127.0.0.1:8102/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1300);
  await page.evaluate(() => { try { localStorage.setItem('at_theme', '"light"'); } catch (e) {} });
  await page.evaluate(() => applyTheme('light'));
  await sleep(500);

  await page.evaluate(() => {
    const now = Date.now();
    addShow({ sid: '900001', bgmId: '900001', title: '模拟番 第一季', nameJp: 'モギホン', cover: '', year: '2024',
      total: 16, eps: Array.from({ length: 16 }, (_, i) => ({ s: i + 1, t: '第' + (i + 1) + '集', type: 'unknown' })),
      statuses: {}, status: 'watching', addedAt: now, updAt: now, source: 'Bangumi' });
  });
  await sleep(500);
  await page.evaluate(() => openDetail('900001'));
  await sleep(700);
  await page.evaluate(() => aiPasteImport());
  await sleep(700);
  await page.evaluate(() => {
    const ta = document.getElementById('at270AiText');
    ta.value = '1-10集为漫改，11-15集是TV原创，16集半原创。另外第17集是总集篇。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'after-03-浅色主题.png') });

  // 极端情况：完全认不出来
  await page.evaluate(() => {
    const ta = document.getElementById('at270AiText');
    ta.value = '这部动画挺好看的，我很喜欢里面的角色。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  const noHit = await page.evaluate(() => {
    const b = document.getElementById('at270AiApply');
    return { applyDisabled: b ? b.disabled : null, prev: (document.getElementById('at270AiPrev') || {}).textContent || '' };
  });
  console.log('NO-HIT:', JSON.stringify(noHit));
  await page.screenshot({ path: path.join(OUT, 'after-04-认不出来.png') });
  console.log('SHOTS OK -> ' + OUT);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
