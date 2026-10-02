/* 手机窗口：在电脑Chrome里开一个能真点的手机尺寸窗口（鼠标当手指）。
   和 phone-look.js 同一套模拟（393×851 / DPR 2.75 / 触屏 / Android WebView UA / hover:none），
   区别只在于它有头、不跑断言、不退出——想点哪屏就点哪屏。
   数据是临时浏览器配置里的演示片，关掉就没了；云端同步的请求一律掐掉，绝不碰你真实片单。
   用法：node tests/phone-live.js [--w 393 --h 851] */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8134;
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TP1A.220624.014) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
}
const VW = arg('--w', 393);
const VH = arg('--h', 851);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/* 演示片单：状态各异，好让「在看/想看/看完/长列表/宫格」一次看全 */
const SEED = () => {
  try { localStorage.removeItem('tr_shows'); } catch (e) {}
  window.shows = [];
  addShow({ sid: 'p-op', title: '海贼王', year: '1999', total: 1100,
    cover: '/tracker-icon-512.png', eps: [] });
  addShow({ sid: 'p-fr', title: '葬送的芙莉莲', year: '2023', total: 28,
    cover: '/tracker-icon-512.png', eps: [] });
  addShow({ sid: 'p-sk', title: '孤独摇滚！', year: '2022', total: 12,
    cover: '/tracker-icon-512.png', eps: [] });
  addShow({ sid: 'p-mp', title: '我的青春恋爱物语果然有问题', year: '2013', total: 13,
    cover: '', eps: [] });
  const s = window.shows.filter((x) => x.sid === 'p-fr')[0];
  s.eps = Array.from({ length: 28 }, (_, i) => ({ s: i + 1, t: '第 ' + (i + 1) + ' 话' }));
  s.eps.slice(0, 16).forEach((e) => { e.w = 'watched'; });
  s.watching = 'watching';
  window.shows.filter((x) => x.sid === 'p-sk')[0].watching = 'completed';
  window.shows.filter((x) => x.sid === 'p-mp')[0].watching = 'wish';
  renderList();
};

/* Chrome 有最小窗宽（这台机器实测 500 逻辑像素），比它窄的手机视口装不进去；
   高度也受屏幕限制：这台屏可用高只有 720，851 高的窗口会被 Windows 塞成最小化。
   所以先探屏幕，再按能装下的尺寸开，装不下就如实说，别默默给一个假宽度的「手机」。
   边框余量分两个：Win11 的 app 窗口左右只有隐形调整边（各 8），上面还有一条标题栏（31）。 */
const FRAME_W = 16;
const FRAME_H = 40;

(async () => {
  const srv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '1800'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60; i++) { if (await probe()) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const URL = 'http://127.0.0.1:' + PORT + '/index.html';
  /* --app 必须给真实地址：给 about:blank 会退化成带标签栏和地址栏的普通窗口，一眼就不是手机。
     ignoreDefaultArgs 摘掉 --enable-automation：留着它 Chrome 会在顶上钉一条
     「自动测试软件正在控制 Chrome」的横幅，手机比例的画面被压掉一截。
     同理不能传 --no-sandbox——那会招来另一条「不受支持的命令行标记」横幅，
     而这条横幅摘不掉（--test-type 在这台 Chrome 上无效），Windows 上本来也不需要它。
     --hide-scrollbars 让滚动条不占版面：真机的滚动条是浮层，有头 Chrome 默认却吃掉 15px。 */
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--hide-scrollbars', '--app=' + URL] });
  const done = (code) => { try { srv.kill(); } catch (e) {} process.exit(code); };
  browser.on('disconnected', () => { console.log('窗口已关闭，服务一并退出'); done(0); });
  process.on('SIGINT', () => done(0));

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.setUserAgent(UA);
  const cdp = await page.createCDPSession();

  const avail = await page.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight }));
  const winH = Math.min(VH + FRAME_H, avail.h - 4);
  const cssH = Math.max(420, winH - FRAME_H);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId,
    bounds: { windowState: 'normal', left: 60, top: 4, width: VW + FRAME_W, height: winH } });

  await page.setViewport({ width: VW, height: cssH, deviceScaleFactor: 2.75,
    isMobile: true, hasTouch: true });
  /* 命门同 phone-look：puppeteer 的 hasTouch 不改媒体特性，必须走 CDP 显式声明
     hover:none / pointer:coarse，否则 @media(hover:none) 那批手机样式一条都不命中。 */
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'hover', value: 'none' },
    { name: 'pointer', value: 'coarse' },
  ] });
  await page.evaluateOnNewDocument(() => {
    window.AndroidShell = {
      checkUpdate() { window.__atUpd && window.__atUpd('已是最新版 v1.4（5）', true); },
      checkContent() { window.__atWeb && window.__atWeb('网页内容已是最新（code 102）', true); },
      appVersion() { return '1.4（5）'; },
      contentCode() { return '102'; },
      toast(m) { console.log('shell toast: ' + m); },
    };
  });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    /* 只掐云端同步：演示数据不许流进你真实的片单库；Bangumi 查询保持可用 */
    if (/tcb-api\.tencentcloudapi/.test(req.url())) return req.abort();
    req.continue();
  });
  page.on('pageerror', (e) => console.log('页面错误: ' + String(e).slice(0, 160)));

  /* 桩和拦截是页面加载之后才挂上的，重载一次才是手机那份 */
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);
  await page.evaluate(SEED);
  await sleep(800);

  const m = await page.evaluate(() => ({
    hoverNone: matchMedia('(hover:none)').matches,
    coarse: matchMedia('(pointer:coarse)').matches,
    narrow: matchMedia('(max-width:520px)').matches,
    w: innerWidth, h: innerHeight,
  }));
  console.log('手机窗口已打开  ' + m.w + '×' + m.h +
    '  · (hover:none) ' + (m.hoverNone ? '命中' : '未命中!!') +
    ' · (pointer:coarse) ' + (m.coarse ? '命中' : '未命中!!') +
    ' · (max-width:520px) ' + (m.narrow ? '命中' : '未命中'));
  if (m.w !== VW) console.log('注意：实际视口宽 ' + m.w + '，不是真机的 ' + VW + '（Chrome 最小窗宽夹的）');
  if (m.h < VH) console.log('注意：屏幕可用高 ' + avail.h + '，装不下真机的 ' + VH +
    ' 高，按 ' + m.h + ' 显示；宽度没被夹的话，手机样式就是真的');
  console.log('地址：' + URL + '    关掉窗口即收工（服务跟着退出）');
  await new Promise(() => {});
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
