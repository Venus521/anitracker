/* shots-v2410.js —— v2.41.0「封面全都要」视觉验收
   拍四种状态在一张列表里并排的样子，确认「没封面的那张」现在的观感：
     01 浅色 列表视图（有封面 / 首字占位 / 死链占位 混排）
     02 深色 列表视图（同上）
     03 浅色 封面墙（grid）
     04 详情页：无封面时的首字票券海报 + 一键拉封面入口
   出网一律拦掉（只放行两张真实图所在的图床），免得启动自愈在拍摄期间把封面补上，
   拍到的就不是「缺封面」的样子了。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'DELIVERY', 'shots-v2410');
const IMG_A = 'https://cloud1-d7gsn5t0w6407b963-1460816419.tcloudbaseapp.com/covers/a8c0923b62b2.jpg';
const IMG_B = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-GCsPm7waJ4kS.png';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PY = process.env.AT_PY || 'python';
  const PORT = 8156;
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
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
  if (!await waitPort(PORT, '/index.html', 40)) { srv.kill(); console.error('服务没起来'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1180, height: 1000, deviceScaleFactor: 2 });
    page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (u.indexOf('cloud1-d7gsn5t0w6407b963') >= 0 || u.indexOf('s4.anilist.co') >= 0) return req.continue();
      if (/^https?:\/\/127\.0\.0\.1/.test(u)) return req.continue();
      if (/^data:/.test(u)) return req.continue();
      /* 其余出网一律掐掉：不让启动自愈在拍摄窗口里把封面补上 */
      return req.abort();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1200);

    await page.evaluate((a, b) => {
      try { localStorage.clear(); } catch (e) {}
      const now = Date.now();
      const mk = (sid, title, cover, extra) => Object.assign({
        sid: sid, title: title, cover: cover, year: '2026', total: 24,
        eps: Array.from({ length: 24 }, (_, i) => ({ s: i + 1, t: '第 ' + (i + 1) + ' 集' })),
        statuses: { 1: 'watched', 2: 'watched', 3: 'watched', 4: 'watched', 5: 'watched' },
        status: 'watching', addedAt: now, updAt: now, source: '内置库', kind: '动画'
      }, extra || {});
      window.shows = [
        mk('s-ok-1', '海贼王', a),
        mk('s-ok-2', '星际牛仔', b),
        mk('s-no-1', '庆余年', ''),
        mk('s-no-2', '漫长的季节', ''),
        mk('s-dead-1', '某部老番', 'https://lain.bgm.tv/pic/cover/l/xx/nope.jpg', { coverBy: 'net' })
      ];
      try { save(); } catch (e) {}
      renderList();
    }, IMG_A, IMG_B);
    await sleep(1500);

    /* 01 浅色列表 */
    await page.evaluate(() => { applyTheme('light'); renderSrcBar(); renderList(); });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '01-浅色-列表.png') });

    /* 02 深色列表 */
    await page.evaluate(() => { applyTheme('dark'); renderSrcBar(); renderList(); });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '02-深色-列表.png') });

    /* 03 封面墙 */
    await page.evaluate(() => {
      applyTheme('light');
      try { localStorage.setItem('at_view', 'grid'); } catch (e) {}
      if (typeof setListView === 'function') setListView('grid');
      renderList(); renderSrcBar();
    });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '03-浅色-封面墙.png') });

    /* 04 详情页：无封面那部的首字海报 */
    await page.evaluate(() => {
      try { localStorage.removeItem('at_view'); } catch (e) {}
      if (typeof setListView === 'function') setListView('list');
      applyTheme('light'); openDetail('s-no-1');
    });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '04-详情-首字占位.png'), clip: { x: 0, y: 0, width: 1180, height: 560 } });

    console.log('shots ->', OUT);
    fs.readdirSync(OUT).forEach(f => console.log('  ' + f));
  } finally {
    try { await browser.close(); } catch (e) {}
    srv.kill();
  }
})();
