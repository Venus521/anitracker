/* v2.23.0 实证：粘贴面板「清空」按钮尺寸 + 集名语言提示（桌面 460 与手机 393 两档各量一次）
   用法：node tests/v2230-shot.js  ·  自起静态服务 8139，截图落在 tests/shots-v2230/ */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const FX = require('./ai-add-fixture.js');
const OUT = path.join(__dirname, 'shots-v2230');
const PORT = 8139;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(id, name, ok, detail) {
  results.push({ id: id, name: name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 400) });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const PY = process.env.AT_PY || String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
  const waitPort = async () => {
    for (let i = 0; i < 30; i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true;
      await sleep(500);
    }
    return false;
  };
  if (!(await waitPort())) { console.log('FATAL: 静态服务未就绪'); process.exit(1); }

  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });

    for (const dev of [{ tag: 'desktop', w: 460, h: 1000, touch: false }, { tag: 'phone', w: 393, h: 851, touch: true }]) {
      const page = await browser.newPage();
      await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: 2, hasTouch: dev.touch, isMobile: dev.touch });
      await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => window.AT270 && window.AT270.aiStdParse, { timeout: 15000 });

      /* ① 国产动画（产地中国，AI 还多给了英文） */
      await page.evaluate(() => window.aiAdd());
      await page.waitForFunction(() => !!document.getElementById('at270StdText'), { timeout: 6000 });
      await page.evaluate(t => {
        const ta = document.getElementById('at270StdText');
        ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, FX.ANIME_CN);
      await page.waitForFunction(() => {
        const el = document.getElementById('at270StdPrev');
        return el && /凡人修仙传/.test(el.textContent);
      }, { timeout: 8000, polling: 100 });
      const cn = await page.evaluate(() => {
        const clr = document.getElementById('at270StdClr');
        const r = clr.getBoundingClientRect();
        const panel = document.querySelector('#at270StdMask .panel');
        return {
          clr: { w: Math.round(r.width), h: Math.round(r.height) },
          overflow: panel.scrollWidth - panel.clientWidth,
          flds: Array.from(document.querySelectorAll('#at270StdPrev .fld')).map(f => f.textContent).join('|'),
          note: document.getElementById('at270StdPrev').textContent
        };
      });
      check(dev.tag + '-1', dev.tag + '：清空按钮可点区 ≥38px 且面板不横向溢出',
        cn.clr.h >= 38 && cn.clr.w >= 38 && cn.overflow <= 1, JSON.stringify(cn.clr) + ' overflow=' + cn.overflow);
      check(dev.tag + '-2', dev.tag + '：产地字段出现 + 中国产地提示「只留中文」',
        /产地中国/.test(cn.flds) && /产地中国：集名只留中文/.test(cn.note), cn.flds + ' :: ' + cn.note.slice(0, 120));
      await page.evaluate(() => {
        const p = document.getElementById('at270StdPrev');
        if (p) p.scrollIntoView({ block: 'center' });
      });
      await sleep(200);
      await page.screenshot({ path: path.join(OUT, 'v2230-' + dev.tag + '-cn.png'), fullPage: false });

      /* ② 外国条目却只给中文集名 → 要提醒补原文 */
      await page.evaluate(t => {
        const ta = document.getElementById('at270StdText');
        ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, FX.FRIENDS_NO_ORIG);
      await page.waitForFunction(() => {
        const el = document.getElementById('at270StdPrev');
        return el && /老友记/.test(el.textContent);
      }, { timeout: 8000, polling: 100 });
      const half = await page.evaluate(() => document.getElementById('at270StdPrev').textContent);
      check(dev.tag + '-3', dev.tag + '：外国条目缺原文 → 当场提醒补双语集名',
        /外文条目要双语集名/.test(half) && /3 \/ 3 集没给原文/.test(half), half.slice(0, 160));
      await page.evaluate(() => {
        const p = document.getElementById('at270StdPrev');
        if (p) p.scrollIntoView({ block: 'center' });
      });
      await sleep(200);
      await page.screenshot({ path: path.join(OUT, 'v2230-' + dev.tag + '-noorig.png'), fullPage: false });
      await page.close();
    }
  } catch (e) {
    console.log('FATAL: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  const fails = results.filter(r => !r.ok);
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS' + (fails.length ? ' :: FAILED: ' + fails.map(r => r.id).join(',') : ''));
  process.exitCode = fails.length ? 1 : 0;
})();
