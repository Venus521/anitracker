/* v2.12.0 交付截图：右键菜单（片单/剧集）+ 重复检测报告 + 深浅色 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:/Users/Venus/.openclaw-autoclaw/workspace/.cluster/bangumi-tracker/app-test/node_modules/puppeteer-core/`);

const ROOT = 'D:/项目/01_媒体娱乐/ani-tracker';
const PORT = 8126;
const OUT = path.join(ROOT, 'DELIVERY', 'anitracker-v2.12.0-ctxmenu-20260925', 'shots');
const PY = 'C:/Users/Venus/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function probe(port, p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/* 一套固定的演示数据：一条 TV 海贼王、一条同名剧场版、一条有剧集的番 */
const SEED = () => {
  try { localStorage.removeItem('tr_shows'); } catch (e) {}
  window.shows = [];
  addShow({ sid: 'demo-op', title: '海贼王', year: '1999', total: 1168, cover: '', eps: [] });
  addShow({ sid: 'demo-mv', title: '海贼王 剧场版', year: '2000', total: 41, cover: '', eps: [] });
  addShow({ sid: 'demo-fr', title: '葬送的芙莉莲', year: '2023', total: 28, cover: '', eps: [] });
  addShow({ sid: 'demo-ep', title: '测试番·有剧集', year: '2020', total: 6, cover: '',
    eps: [{ s: 1, t: '第一集' }, { s: 2, t: '第二集' }, { s: 3, t: '第三集' }, { s: 4, t: '第四集' }] });
  renderList();
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { if (await probe(PORT, '/index.html')) break; await sleep(500); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function page_(theme) {
    const page = await browser.newPage();
    await page.setViewport({ width: 430, height: 950, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/api\.bgm\.tv|animefillerlist|tcb-api\.tencentcloudapi/.test(u)) return req.abort();
      req.continue();
    });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1700);
    if (theme) {
      await page.evaluate((t) => { try { localStorage.setItem('at_theme', t); } catch (e) {} }, theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1700);
    }
    await page.evaluate(SEED);
    await sleep(600);
    return page;
  }

  /* 1. 片单卡右键菜单（深色） */
  {
    const page = await page_();
    await page.evaluate(() => {
      const el = document.querySelector('#list .show[data-sid="demo-op"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + 40) }));
    });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, '01-片单右键菜单-深色.png') });
    console.log('  01');
    await page.close();
  }

  /* 2. 片单卡右键菜单（浅色） */
  {
    const page = await page_('light');
    await page.evaluate(() => {
      const el = document.querySelector('#list .show[data-sid="demo-op"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + 40) }));
    });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, '02-片单右键菜单-浅色.png') });
    console.log('  02');
    await page.close();
  }

  /* 3. 剧集行右键菜单 */
  {
    const page = await page_();
    await page.evaluate(() => { openDetail('demo-ep'); });
    await sleep(800);
    await page.evaluate(() => {
      const row = document.querySelector('#dGroups .eprow[data-ep="2"]');
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: Math.round(r.left + 60), clientY: Math.round(r.top + 22) }));
    });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, '03-剧集行右键菜单.png') });
    console.log('  03');
    await page.close();
  }

  /* 4. 重复检测报告：干净状态（只有同名不同作品，没有真重复） */
  {
    const page = await page_();
    await page.evaluate(() => {
      if (typeof openAccount === 'function') openAccount();
    });
    await sleep(900);
    await page.evaluate(() => {
      const b = document.getElementById('optDupScan'); if (b) b.click();
    });
    await sleep(600);
    await page.evaluate(() => {
      const card = document.querySelector('#optDupResult');
      if (card && card.closest('.sycard')) card.closest('.sycard').scrollIntoView({ block: 'center' });
    });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, '04-重复检测-只有同名不同作品.png') });
    console.log('  04');
    await page.close();
  }

  /* 5. 重复检测报告：有真重复（含「移除」按钮） */
  {
    const page = await page_();
    await page.evaluate(() => {
      /* 造两条真重复：同标题、同年、同集数 */
      shows.push({ sid: 'dup-a', title: '葬送的芙莉莲', year: '2023', total: 28, cover: '', eps: [] });
      shows.push({ sid: 'dup-b', title: '葬送的芙莉莲', year: '2023', total: 28, cover: '', eps: [] });
      save();
      if (typeof openAccount === 'function') openAccount();
    });
    await sleep(900);
    await page.evaluate(() => { const b = document.getElementById('optDupScan'); if (b) b.click(); });
    await sleep(700);
    await page.evaluate(() => {
      const card = document.querySelector('#optDupResult');
      if (card && card.closest('.sycard')) card.closest('.sycard').scrollIntoView({ block: 'center' });
    });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, '05-重复检测-含可移除的真重复.png') });
    console.log('  05');
    await page.close();
  }

  await browser.close();
  srv.kill();
  console.log('done -> ' + OUT);
})().catch((e) => { console.log('异常: ' + (e && e.stack || e)); process.exit(1); });
