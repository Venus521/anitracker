/* v2.11.0 账号面板截图：登录 Tab / 注册 Tab / 刷新续用 / 深色 / 浅色 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = 'D:/项目/01_媒体娱乐/ani-tracker';
const PORT = 8121;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.11.0-register-20260925', 'shots');
const PY = process.env.AT_PY || (function () {
  try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
    const fb = 'C:/Users/Venus/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe';
    console.warn('[tests] PATH 中未找到 python，回退旧写死路径：' + fb + '（可用环境变量 AT_PY 覆盖）');
    return fb;
  }
})();
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function probe(port, p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { if (await probe(PORT, '/index.html')) break; await sleep(500); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function shot(name, { theme, prep } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: 430, height: 950, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/api\.bgm\.tv|tcb-api\.tencentcloudapis?\.com|tcb-api\.tencentcloudapi\.com/.test(u)) return req.abort();
      req.continue();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1600);

    if (theme) {
      /* 注意：at_theme 存的是**裸字符串**（'light'），不是 JSON。
         写 JSON.stringify('light') 会变成带引号的 "light"，主题判断就不匹配了。 */
      await page.evaluate((t) => { try { localStorage.setItem('at_theme', t); } catch (e) {} }, theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1600);
    }
    if (prep) await page.evaluate(prep);
    await page.evaluate(() => { if (typeof window.openAccount === 'function') window.openAccount(); });
    await sleep(1500);

    /* 只截面板，不截整页 */
    const el = await page.$('.mask .panel');
    if (el) await el.screenshot({ path: path.join(OUT, name) });
    else await page.screenshot({ path: path.join(OUT, name) });
    console.log('  ' + name);
    await page.close();
  }

  console.log('截图输出到: ' + OUT);
  await shot('01-登录Tab.png');
  await shot('02-注册Tab.png', { prep: () => { setTimeout(() => { const t = document.getElementById('cbTabReg'); if (t) t.click(); }, 200); } });
  await shot('03-注册填好待发码.png', {
    prep: () => {
      setTimeout(() => {
        const t = document.getElementById('cbTabReg'); if (t) t.click();
        setTimeout(() => {
          const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
          set('cbEmail', 'you@example.com'); set('cbEmailPass', 'MyPass2026');
          const d = document.getElementById('cbNameFold'); if (d) d.open = true;
          set('cbNewName', 'tracker_venus');
        }, 300);
      }, 200);
    },
  });
  await shot('04-刷新后续用注册.png', {
    prep: () => {
      localStorage.setItem('at_reg_pending', JSON.stringify({ email: 'you@example.com', messageId: 'eyJhbGciOiJSUzI1NiJ9.demo.sig', at: Date.now() }));
    },
  });
  await shot('05-浅色主题注册.png', {
    theme: 'light',
    prep: () => { setTimeout(() => { const t = document.getElementById('cbTabReg'); if (t) t.click(); }, 200); },
  });

  await browser.close();
  srv.kill();
  console.log('done');
})().catch((e) => { console.log('异常: ' + (e && e.stack || e)); process.exit(1); });
