/* 版面几何自检（替代视觉抽查）：溢出/重叠/可见性，360/460/1280 三档 */
const path = require('path');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const SHOTS = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\shots`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, e) => { results.push([n, !!c]); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (e ? ('  ' + e) : '')); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    const now = Date.now();
    const plain = n => { const a = []; for (let i = 1; i <= n; i++) a.push({ s: i, t: '第' + i + '集' }); return a; };
    const shows = [
      { sid: '901', bgmId: '901', title: '这是一个特别特别长的测试番剧标题用来验证文字溢出与截断行为', total: 12, status: 'watching', type: 'manga-adapt',
        statuses: { 1: 'watched', 2: 'watched' }, filler: '3,6-8', mixed: '4',
        eps: plain(12).map((e, i) => i === 2 ? { s: 3, t: '原创特别篇 【动画原创】这是一个特别长的单集标题用于验证两行截断效果' } : e) },
      { sid: '902', title: '测试未校准番', total: 12, status: 'watching', type: 'manga-adapt', statuses: {}, eps: plain(12) }
    ];
    localStorage.setItem('tr_shows', JSON.stringify(shows));
    localStorage.removeItem('at_hide_src');
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(500);

  for (const w of [360, 460, 1280]) {
    await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
    await sleep(300);
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const btns = [...document.querySelectorAll('.top .topbtn, .top button')].map(b => b.getBoundingClientRect()).filter(b => b.width > 0);
      let overlap = false;
      for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i], b = btns[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlap = true;
      }
      const wide = document.querySelector('.topbtn.wide');
      const wideRect = wide ? wide.getBoundingClientRect() : null;
      const srcchip = document.querySelector('#srcBar .srcchip');
      const chipRect = srcchip ? srcchip.getBoundingClientRect() : null;
      const covLine = [...document.querySelectorAll('#list .tiny')].some(x => x.textContent.includes('原创'));
      return {
        overflow, overlap,
        wideVisible: wideRect && wideRect.width > 40 && wideRect.top < innerHeight,
        chipVisible: chipRect && chipRect.width > 40 && chipRect.height > 20,
        covLine,
        listRows: document.querySelectorAll('#list .show').length
      };
    });
    ok('宽度 ' + w + '：无横向溢出', r.overflow <= 1, 'overflow=' + r.overflow);
    ok('宽度 ' + w + '：顶栏按钮无重叠', !r.overlap);
    ok('宽度 ' + w + '：同步入口可见', r.wideVisible);
    ok('宽度 ' + w + '：来源筛选条可见', r.chipVisible);
    ok('宽度 ' + w + '：列表含覆盖信息', r.covLine && r.listRows >= 2);
    if (w === 460) await page.screenshot({ path: path.join(SHOTS, 'live-03-list-460.png') });
    if (w === 360) await page.screenshot({ path: path.join(SHOTS, 'live-04-list-360.png') });
  }
  await browser.close();
  const fails = results.filter(x => !x[1]).length;
  console.log('==== LAYOUT SUMMARY: ' + (results.length - fails) + '/' + results.length + ' ====');
  process.exit(fails ? 1 : 0);
})();
