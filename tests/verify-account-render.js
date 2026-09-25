/* 验证：允许 SDK 加载时，账号面板是否渲染出「登录/注册」表单
   只拦 CloudBase 的数据/认证接口（tcb-api），放行 static.cloudbase.net 的 SDK。
   这样能区分「产品坏了」和「我截图时把 SDK 也拦了」。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.10.0-account-20260925', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const PY = process.env.AT_PY || (function () {
    try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
      const fb = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
      console.warn('[tests] PATH 中未找到 python，回退旧写死路径：' + fb + '（可用环境变量 AT_PY 覆盖）');
      return fb;
    }
  })();
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8100', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
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
  await waitPort(8100, '/index.html', 30);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1080, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  let sdkLoaded = false;
  page.on('request', req => {
    const u = req.url();
    if (/static\.cloudbase\.net/.test(u)) { sdkLoaded = true; return req.continue(); }   // 放行 SDK
    if (/tcb-api\.tencentcloudapi\.com/.test(u)) return req.abort();                     // 只拦数据接口
    req.continue();
  });
  page.on('response', r => { if (/cloudbase\.full\.js/.test(r.url())) console.log('SDK HTTP', r.status()); });
  await page.goto('http://127.0.0.1:8100/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2500);

  console.log('window.cloudbase =', await page.evaluate(() => typeof window.cloudbase));
  console.log('window.CBSync    =', await page.evaluate(() => typeof window.CBSync));

  await page.evaluate(() => openAccount());
  await sleep(2600);

  const probe = await page.evaluate(() => {
    const a = document.getElementById('cbArea');
    return {
      text: a ? a.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '(no #cbArea)',
      hasLogin: !!document.getElementById('cbLogin'),
      hasUser: !!document.getElementById('cbUser'),
      hasPass: !!document.getElementById('cbPass'),
      hasToReg: !!document.getElementById('cbToReg')
    };
  });
  console.log('ACCT AREA:', JSON.stringify(probe, null, 2));
  await page.screenshot({ path: path.join(OUT, '05-账号区-真实加载.png') });
  const box = await page.evaluate(() => {
    const el = document.getElementById('syCardAcct'); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(460, r.width + 16), height: r.height + 16 };
  });
  if (box) await page.screenshot({ path: path.join(OUT, '05b-账号区特写-真实加载.png'), clip: box });

  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
