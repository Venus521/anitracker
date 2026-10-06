/* shots-v2420.js —— v2.42.0「记住登录状态和密码」视觉验收
   拍登录面板：勾选框 + 下面那行风险说明 + 预填后的样子（浅/深各一张）。
   出网一律掐掉，面板按「未登录」渲染，不依赖 CloudBase 是否连得上。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'shots-v2420');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PY = process.env.AT_PY || 'python';
  const PORT = 8158;
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  const waitPort = async () => {
    for (let i = 0; i < 40; i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true; await sleep(500);
    }
    return false;
  };
  if (!await waitPort()) { srv.kill(); console.error('服务没起来'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 940, deviceScaleFactor: 2 });
    page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (/^https?:\/\/127\.0\.0\.1/.test(u) || /^data:/.test(u)) return req.continue();
      return req.abort();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);
    await sleep(4000);

    /* 记住一个假账号，让面板呈现「填回来了」的样子 */
    await page.evaluate(async () => {
      await window.AT_REMEMBER.save('venus@example.com', 'demo-password');
      applyTheme('light');
      openAccount();
    });
    await sleep(2600);
    await page.screenshot({ path: path.join(OUT, '01-浅色-登录面板.png') });

    await page.evaluate(() => { applyTheme('dark'); });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '02-深色-登录面板.png') });

    console.log('shots ->', OUT);
    fs.readdirSync(OUT).forEach(f => console.log('  ' + f));
  } finally {
    try { await browser.close(); } catch (e) {}
    srv.kill();
  }
})();
