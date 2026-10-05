/* douban-live-smoke.js —— 真豆瓣、真网关、只读的一遍走查（v2.30.0 收尾时加的）
   为什么要它：e2e 门禁里豆瓣是替身，替身挡不住「豆瓣改了 HTML」这类事——
   只有真打一次 :3000 才知道解析器还认不认识现在的页面。
   规矩：全程不点导入（用的是空的临时浏览器 profile，也不写任何用户数据），只看清单长什么样。
   用法：node tests/douban-live-smoke.js   ·  网关没在跑/没连豆瓣就自己跳过（退出码 0） */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const ART = path.join(__dirname, '_artifacts');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = (host, port, p, ms) => new Promise(res => {
  const rq = http.get({ host, port, path: p, timeout: ms }, x => {
    let b = ''; x.on('data', d => b += d); x.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({ raw: b.slice(0, 120) }); } });
  });
  rq.on('error', () => res(null)); rq.on('timeout', () => { rq.destroy(); res(null); });
});

(async () => {
  const probe = await get('127.0.0.1', 3000, '/hub/api/db/status', 5000);
  if (!probe || !probe.ok) { console.log('SKIP 本机 :3000 网关没在跑 :: ' + JSON.stringify(probe)); process.exit(0); }
  if (!probe.logged) { console.log('SKIP 网关还没连豆瓣 :: ' + JSON.stringify(probe)); process.exit(0); }
  console.log('GATEWAY uid=' + probe.uid);

  /* 端口必须是网关放行名单里的（server.js:1391 只认 8089 / 8766 / venus521.github.io）：
     换别的端口，status 请求会被 CORS 挡掉，面板只会说「连不上网关」——那是量具的问题，不是功能的。 */
  const PORT = 8089;
  /* 与 run-regression 同款 AT_PY 解析：本机 python 若指到 Microsoft Store 别名，spawn 它会静默挂着 */
  const PY = process.env.AT_PY || (function () {
    try { require('child_process').execSync('python -c ""', { stdio: 'ignore', timeout: 3000 }); return 'python'; } catch (e) {
      return String.raw`C:\Users\Venus\AppData\Local\Python\pythoncore-3.14-64\python.exe`;
    }
  })();
  if (await new Promise(r => { const sk = require('net').connect(PORT, '127.0.0.1'); sk.on('connect', () => { sk.destroy(); r(true); }); sk.on('error', () => r(false)); })) {
    console.log('SKIP 端口 ' + PORT + ' 已被占用（大概是正常的本地服务在跑），不抢它的坑'); process.exit(0);
  }
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '120'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    up = await new Promise(r => {
      const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); r(true); });
      rq.on('error', () => r(false)); rq.on('timeout', () => { rq.destroy(); r(false); });
    });
    if (!up) await sleep(400);
  }
  if (!up) { console.log('FATAL 静态服务未就绪（AT_PY=' + PY + '可手动 python 服务器-空闲自退.py --port ' + PORT + '）'); try { srv.kill(); } catch (e) {} process.exit(1); }

  let browser, code = 0;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 980, height: 1240, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message || e)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1200);
    await page.evaluate(() => window.openAccount());
    await page.waitForFunction(() => !!document.getElementById('dbSyncOpen'), { timeout: 8000 });
    await page.click('#dbSyncOpen');
    /* 真豆瓣不是秒回：本机网关代抓三种状态逐页翻，实测 500 条要 25.7 秒 ⇒ 预算给 150 秒，
       期间把面板上那句进度话术抄回来看（秒数会不会走，就看这一眼） */
    const seenMsg = [];
    const t0 = Date.now();
    let rows0 = 0;
    while (Date.now() - t0 < 150000) {
      const st0 = await page.evaluate(() => ({
        n: document.querySelectorAll('#dbnBody .dbn-row').length,
        msg: (document.getElementById('dbnMsg') || {}).textContent || ''
      }));
      rows0 = st0.n;
      if (seenMsg[seenMsg.length - 1] !== st0.msg) { seenMsg.push(st0.msg); console.log('  · ' + Math.round((Date.now() - t0) / 1000) + 's ' + st0.msg); }
      if (st0.n > 0) break;
      await sleep(1000);
    }
    const ticking = seenMsg.filter(x => /已经 \d+ 秒/.test(x)).length;
    console.log('PROGRESS 话术换了 ' + seenMsg.length + ' 版，带秒数的 ' + ticking + ' 版');
    const shot = async f => page.screenshot({ path: path.join(ART, f) });
    const tv = await page.evaluate(() => ({
      rows: document.querySelectorAll('#dbnBody .dbn-row').length,
      has: document.querySelectorAll('#dbnBody .dbn-row.has').length,
      grp: Array.prototype.map.call(document.querySelectorAll('#dbnBody .dbn-grp'), x => x.textContent).join(' | '),
      withDate: Array.prototype.filter.call(document.querySelectorAll('#dbnBody .dbn-mm'), x => /标记 20\d\d-\d\d-\d\d/.test(x.textContent)).length,
      first: (document.querySelector('#dbnBody .dbn-row') || {}).textContent,
      msg: document.getElementById('dbnMsg').textContent
    }));
    await shot('live-douban-tv.png');
    console.log('TV   ' + JSON.stringify(tv));
    await page.evaluate(() => document.querySelector('#dbnScope [data-sc=all]').click());
    /* 换范围=重新拉一遍，又是一二十秒；只 sleep 1.5 秒就去数，数到的「0 条」是「还在路上」不是「没有」 */
    const t1 = Date.now();
    let rows1 = 0;
    while (Date.now() - t1 < 150000) {
      rows1 = await page.evaluate(() => document.querySelectorAll('#dbnBody .dbn-row').length);
      if (rows1 > 0) break;
      await sleep(1000);
    }
    console.log('含电影拉到第 ' + Math.round((Date.now() - t1) / 1000) + ' 秒出条目：' + rows1 + ' 行');
    const all = await page.evaluate(() => ({
      rows: document.querySelectorAll('#dbnBody .dbn-row').length,
      grp: Array.prototype.map.call(document.querySelectorAll('#dbnBody .dbn-grp'), x => x.textContent).join(' | ')
    }));
    await shot('live-douban-all.png');
    console.log('ALL  ' + JSON.stringify(all));
    /* 六百行清单怎么勾：先筛再勾——拿真片名试一次过滤，顺带留下这张能看的照片 */
    const fq = await page.evaluate(() => {
      const q = document.getElementById('dbnQ'); q.value = '金田一'; q.dispatchEvent(new Event('input'));
      const rows = document.querySelectorAll('#dbnBody .dbn-row');
      return { shown: rows.length, cnt: document.getElementById('dbnCnt').textContent, first: rows[0] ? rows[0].textContent : '' };
    });
    await sleep(300);
    await shot('live-douban-filter.png');
    console.log('FILTER ' + JSON.stringify(fq));
    if (fq.shown < 1 || !/金田一/.test(fq.first)) { console.log('SMOKE FAIL 片名过滤在真数据上不成立'); code = 1; }
    /* —— 推送方向：只读核对，绝不点推送 ——
       真数据上验三件事：① 方向切换后面板和说明都换过来；② 每行都写清「推成什么 / 推不了」，
       没有一条含糊成空；③ 「推不了」的理由分得清（没豆瓣号 vs 还没进片单）。
       不点推送：点了就是往真实账号里写东西，这个冒烟是「读到什么」，不是「改动什么」。 */
    await page.evaluate(() => { const q = document.getElementById('dbnQ'); if (q) { q.value = ''; q.dispatchEvent(new Event('input')); } });
    await page.evaluate(() => document.querySelector('#dbnDir [data-dir="push"]').click());
    await sleep(600);
    const push = await page.evaluate(() => {
      const rows = Array.prototype.map.call(document.querySelectorAll('#dbnBody .dbn-row'), x => x.textContent.replace(/\s+/g, ' '));
      return {
        rows: rows.length,
        withVerdict: rows.filter(t => /推成|推不了/.test(t)).length,
        noDbId: rows.filter(t => /推不了：这条没有豆瓣号/.test(t)).length,
        notInLib: rows.filter(t => /推不了：还没进片单/.test(t)).length,
        note: (document.getElementById('dbnDirNote') || {}).textContent || '',
        first: rows[0] || ''
      };
    });
    await shot('live-douban-push.png');
    console.log('PUSH  ' + JSON.stringify(push));
    if (push.note.indexOf('写回豆瓣') < 0) { console.log('SMOKE FAIL 切到推送方向后说明没换过来'); code = 1; }
    if (push.rows > 0 && push.withVerdict < push.rows) {
      console.log('SMOKE FAIL 真数据上有 ' + (push.rows - push.withVerdict) + ' 行没给出「推成什么/推不了」的结论（含糊 = 会误推）');
      code = 1;
    }
    fs.writeFileSync(path.join(__dirname, 'last-douban-live.json'), JSON.stringify({ at: new Date().toISOString(), probe, tv, all, push, errs }, null, 2));
    if (ticking < 2) { console.log('SMOKE FAIL 拉取期间没有走秒的进度话术（用户会以为卡死）'); code = 1; }
    if (tv.rows < 1 || tv.withDate < 1 || errs.length) {
      console.log('SMOKE FAIL 真豆瓣清单不成立 :: rows=' + tv.rows + ' 带日期=' + tv.withDate + ' errs=' + errs.slice(0, 2).join(' | '));
      code = 1;
    } else {
      console.log('SMOKE PASS 真豆瓣拉到 ' + tv.rows + ' 条（含电影 ' + all.rows + ' 条），标记日期解析出 ' + tv.withDate + ' 条，页面报错 0，全程没点导入');
    }
  } catch (e) {
    console.log('FATAL ' + (e && e.stack ? e.stack : e));
    code = 1;
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  process.exit(code);
})();
