/* v2.24.0 封面门禁（用户反馈「上错花轿嫁对郎、还有很多剧为什么没封面」）
   量三件事，全部离线可跑（DNS 层掐网，封面补齐必然失败 → 正好验证「拉不到不许留白」）：
   ① 详情页有「⇪ 本地封面」入口，面板能把粘贴/拖入的图片压成 200×300 dataURL 并写进条目；
   ② 写了之后 coverNeedsHeal=false（自愈不许再动用户自己选的封面）；
   ③ healCoverFor 拉不到封面时，把 s._cvOld 里的老封面还原回来（不留白）。
   用法：node tests/v2240-cover.js · 自起静态服务 8141 · 截图落 tests/shots-v2240/ */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(__dirname, 'shots-v2240');
const PORT = 8141;
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
      await page.waitForFunction(() => window.AT270 && window.pickCover && window.healCoverFor, { timeout: 15000 });

      /* 建一条「中文老剧」：模拟《上错花轿嫁对郎》这种全网库查不到的条目 */
      await page.evaluate(() => {
        window.shows = window.shows || [];
        window.shows.push({
          sid: 'cov-test-1', title: '上错花轿嫁对郎', nameJp: '', aliases: [], cover: '', total: 20,
          eps: [{ s: 1, sn: 1, en: 1, t: '第 1 集' }], statuses: {}, status: 'watching',
          addedAt: Date.now(), updAt: Date.now(), source: 'AI 固定格式 · 真人剧', region: '中国'
        });
        save(); if (typeof renderList === 'function') renderList();
        if (typeof openDetail === 'function') openDetail('cov-test-1');
      });
      await sleep(300);

      const btn = await page.evaluate(() => {
        const b = document.getElementById('btnPickCover');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { txt: b.textContent, w: Math.round(r.width), h: Math.round(r.height) };
      });
      const minH = dev.touch ? 38 : 30;
      check(dev.tag + '-1', dev.tag + '：详情页有「⇪ 本地封面」入口（可点区 ' + minH + 'px）',
        !!btn && /本地封面/.test(btn.txt) && btn.h >= minH && btn.w >= 38, JSON.stringify(btn));

      /* Ctrl+V 粘贴一张假图片（canvas → File → DataTransfer） */
      await page.evaluate(() => window.pickCover());
      await page.waitForFunction(() => !!document.getElementById('atCoverMask'), { timeout: 6000 });
      await page.evaluate(async () => {
        const b = await new Promise(res => {
          const c = document.createElement('canvas'); c.width = 600; c.height = 900;
          const x = c.getContext('2d');
          x.fillStyle = '#8d5524'; x.fillRect(0, 0, 600, 900);
          x.fillStyle = '#fff'; x.fillRect(120, 300, 360, 260);
          c.toBlob(res, 'image/jpeg', 0.9);
        });
        const file = new File([b], 'poster.jpg', { type: 'image/jpeg' });
        const dt = new DataTransfer();
        dt.items.add(file);
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      });
      await page.waitForFunction(() => {
        const b = document.getElementById('cvGo');
        return b && !b.disabled;
      }, { timeout: 8000, polling: 100 });
      const prevRect = await page.evaluate(() => {
        const img = document.querySelector('#cvPrev img');
        const clr = document.getElementById('cvClear');
        const panel = document.querySelector('#atCoverMask .panel');
        const rc = clr.getBoundingClientRect();
        return { hasImg: !!img, clrH: Math.round(rc.height), overflow: panel.scrollWidth - panel.clientWidth };
      });
      await page.screenshot({ path: path.join(OUT, 'v2240-' + dev.tag + '-panel.png'), fullPage: false });

      await page.evaluate(() => document.getElementById('cvGo').click());
      await sleep(500);
      const applied = await page.evaluate(() => {
        const s = (window.shows || []).filter(x => x.sid === 'cov-test-1')[0];
        return {
          isData: /^data:image\//.test(String(s.cover || '')),
          by: String(s.coverBy || ''), kb: Math.round(String(s.cover || '').length / 1024),
          needsHeal: (typeof coverNeedsHeal === 'function') ? coverNeedsHeal(s) : null,
          maskGone: !document.getElementById('atCoverMask')
        };
      });
      check(dev.tag + '-2', dev.tag + '：粘贴的图片压成 dataURL 写进条目，账号封面不再被自愈覆盖',
        applied.isData && applied.by === 'user' && applied.kb > 1 && applied.kb < 200 &&
        applied.needsHeal === false && applied.maskGone && prevRect.hasImg && prevRect.clrH >= 38 && prevRect.overflow <= 1,
        JSON.stringify({ applied: applied, prev: prevRect }));

      /* 拉不到封面时必须有旧封面可还原，不留白 */
      const keep = await page.evaluate(async () => {
        const s = (window.shows || []).filter(x => x.sid === 'cov-test-1')[0];
        const old = s.cover;
        s._cvOld = old; s.cover = '';           /* 模拟「被洗封面」那一刻 */
        const ok = await window.healCoverFor(s, { save: false });
        return { ok: ok, same: s.cover === old, hasDangling: !!s._cvOld };
      }, );
      check(dev.tag + '-3', dev.tag + '：重拉封面失败 → 老封面原样还原（不再留白）',
        keep.ok === false && keep.same === true && keep.hasDangling === false, JSON.stringify(keep));

      await page.evaluate(() => { try { backList(); } catch (e) {} });
      await sleep(200);
      await page.screenshot({ path: path.join(OUT, 'v2240-' + dev.tag + '-list.png'), fullPage: false });
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
  fs.writeFileSync(path.join(__dirname, 'last-v2240-cover.json'), JSON.stringify({ at: new Date().toISOString(), results: results }, null, 2));
  process.exitCode = fails.length ? 1 : 0;
})();
