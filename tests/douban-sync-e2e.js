/* douban-sync-e2e.js — 「豆瓣勾选式同步 + 观看时间」门禁（v2.30.0）
   为什么单独一个门禁：这条链路同时碰三样容易出事的东西——外部网关（本机 :3000 的豆瓣代理）、
   片单数据的合并写入（状态/时间谁覆盖谁）、以及一条全新的事件时间账。
   这里一个真实请求都不发：网关用 page.route 替身，其它出网一律回空包（免得后台补封面拖时间）。
   核心不变量：**没勾的条目一条都不许动**；本机手改的时间，豆瓣再拉一次也不许覆盖。
   用法：node tests/douban-sync-e2e.js  ·  自起静态服务 8138 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 500) });
  console.log((ok ? 'PASS' : 'FAIL') + ' B' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 320)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 「零直连」的主语是豆瓣那个站点，不是本项目自己的云中转（v2.27 起 douban-relay 就是正规出网通道，
   v2.31 的分集中文也走它）。判定只认主机名，别再拿 URL 里有没有 "douban" 这个词当尺子——
   中转折线的路径本身就写着 douban-relay，用词当尺子会把自己的通道判成违规直连。 */
const DB_HOST = /^https?:\/\/([a-z0-9-]+\.)*(douban\.com|doubanio\.com)([:\/]|$)/i;
const DB_RELAY = /service\.tcloudbase\.com\/douban-relay/i;
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const FIX = [
  { subjectId: '9001', title: '测试剧·在看A', origTitle: 'TEST A', year: '2024', genres: ['动画'], isAnime: true, rating: null, markedAt: '2026-08-26', pic: PX, status: 'do', ep: 0 },
  { subjectId: '9002', title: '测试剧·在看B', origTitle: '', year: '2023', genres: ['剧情'], isAnime: false, rating: 8, markedAt: '2026-09-01', pic: 'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2517955900.jpg', status: 'do', ep: 5 },
  { subjectId: '9003', title: '测试剧·看过C', origTitle: '', year: '2022', genres: ['动画'], isAnime: true, rating: null, markedAt: '2026-07-15', pic: '', status: 'collect', ep: 0 },
  { subjectId: '9004', title: '测试剧·想看D', origTitle: '', year: '2025', genres: [], isAnime: false, rating: null, markedAt: '2026-06-05', pic: '', status: 'wish', ep: 0 },
  { subjectId: '111', title: '测试剧A', origTitle: '', year: '2020', genres: [], isAnime: false, rating: null, markedAt: '2026-05-05', pic: '', status: 'collect', ep: 0 }
];
/* seed：片单里预先有一条带 dbId 的「想看」，用它验「已在片单」那一支 */
const SEED = [{ sid: 'db111', title: '测试剧A', dbId: '111', year: '2020', total: 0, eps: [], statuses: {}, status: 'want', source: '豆瓣·真人', addedAt: 1, updAt: 1 }];

(async () => {
  const PORT = 8138;
  const PY = process.env.AT_PY || (function () {
    try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
      return String.raw`C:\Users\Venus\AppData\Local\Python\pythoncore-3.14-64\python.exe`;
    }
  })();
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  const waitPort = async () => {
    for (let i = 0; i < 40; i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true;
      await sleep(400);
    }
    return false;
  };
  if (!(await waitPort())) { console.log('FATAL: 静态服务未就绪'); process.exit(1); }

  let browser;
  const pageErrors = [], netOut = [], hits3000 = [], dbData = [], dbImg = [], relayHits = [];
  let lastPull = '';
  const H = { 'Access-Control-Allow-Origin': '*' };
  const MOVIE = { subjectId: '7001', title: '测试电影·看过M', origTitle: '', year: '2021', genres: ['剧情'], isAnime: false, rating: 7, markedAt: '2026-03-03', pic: '', status: 'collect', ep: 0 };
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 980, height: 1180, deviceScaleFactor: 1 });
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));
    await page.setRequestInterception(true);
    /* 规矩（沿用 run-regression）：整页只能有一个 request 监听器，两个会把同一请求 handle 两次而报错 */
    page.on('request', req => {
      const u = req.url();
      if (u.indexOf('localhost:3000') >= 0) {
        hits3000.push(u);
        if (/\/hub\/api\/db\/status/.test(u)) return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: true, logged: true, uid: '137602186' }) });
        if (/\/hub\/api\/db\/cookie/.test(u)) return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: true, uid: '137602186' }) });
        if (/\/hub\/api\/db\/pull/.test(u)) {
          lastPull = u;
          /* 替身要照网关的真规矩来（server.js:907）：type=tv 才只给剧集，没有 type 参数=剧集+电影。
             最初写成认 type=all，于是「含电影」永远拉不到电影 —— 是量具错，不是代码错。 */
          const items = /type=tv/.test(u) ? FIX : FIX.concat([MOVIE]);
          return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: true, items, count: items.length, truncated: false }) });
        }
      }
      if (u.indexOf('http://127.0.0.1:' + PORT + '/') === 0 || u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return req.continue();
      if (!/127\.0\.0\.1|localhost/.test(u)) {
        /* 分「拿数据」和「拿图」两类：标记数据必须一律走本机网关；封面图是 doubanio 外链（真豆瓣 500 条全带图），
           它不构成账号暴露（no-referrer + 懒加载），但也不能混进「零直连」这句话里蒙人。 */
        const rt = req.resourceType();
        if (DB_HOST.test(u)) { (rt === 'image' ? dbImg : dbData).push(req.method() + ' ' + rt + ' ' + u); }
        if (DB_RELAY.test(u)) { relayHits.push(req.method() + ' ' + rt + ' ' + u); }
        netOut.push(req.method() + ' ' + rt + ' ' + u);
      }
      /* 其余外部请求回空包（带 CORS 头：v2.20.0 教训——缺头页面判「网络不可用」会连锁触发自动问 AI） */
      return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: '[]' });
    });
    /* 种子为什么连着两个标志位一起种（实测踩过）：开机有一次性大扫除 purgeAllOnce，
       它的标志位在新 profile 里不存在 → 加载即把整张片单清空，种子就这么没了。
       at_e2e_seeded 只种一次：evaluateOnNewDocument 每次导航前都跑，B14 要刷新验持久化，
       不设闸会把已经导入的时间账冲掉。 */
    await page.evaluateOnNewDocument(d => {
      if (localStorage.getItem('at_e2e_seeded')) return;
      localStorage.setItem('tr_shows', d);
      localStorage.setItem('at_purge_v2140e', '1');
      localStorage.setItem('at_dedup_v2191', '1');
      localStorage.setItem('at_e2e_seeded', '1');
    }, JSON.stringify(SEED));
    /* 探针（只在测试里）：谁把豆瓣面板摘掉的，摘的瞬间把调用栈记下来。
       面板凭空消失过一次，光看结果分不清是页面代码还是测试步骤自己关的。 */
    await page.evaluateOnNewDocument(() => {
      window.__rmLog = [];
      const rm = Element.prototype.remove;
      Element.prototype.remove = function () {
        try {
          if (this.id === 'dbnMask' || this.id === 'uiDlgMask') {
            window.__rmLog.push(this.id + ' << ' + String((new Error().stack || '').split(String.fromCharCode(10)).slice(1, 4).join(' | ')));
          }
        } catch (e) {}
        return rm.apply(this, arguments);
      };
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1200);

    console.log('PROBE seed: ' + JSON.stringify(await page.evaluate(() => ({ ls: localStorage.getItem('at_e2e_seeded'), n: (window.shows || []).length, raw: (localStorage.getItem('tr_shows') || '').slice(0, 120) }))));
    /* ---------- B1 开机自检：新函数都在（主脚本一处语法错会让整块失效） ---------- */
    const boot = await page.evaluate(() => ({
      missing: ['openDoubanSync', 'dbnPull', 'dbnConnect', 'dbnImport', 'dbApplyOne', 'dbTargetOf', 'dbStamp',
        'dbStampTimes', 'timeLineHtml', 'editWatchTime', 'fmtDay', 'parseDay', 'dayDiff', 'importDoubanFile']
        .filter(n => typeof window[n] !== 'function')
    }));
    check('01', '开机自检：豆瓣同步与观看时间的 14 个函数全部就位', boot.missing.length === 0, '缺失：' + boot.missing.join(','));

    /* ---------- B2 账号面板有豆瓣入口，点开即自动拉（自动的是拉，自选的是入库） ---------- */
    await page.evaluate(() => window.openAccount());
    await page.waitForFunction(() => !!document.getElementById('dbSyncOpen'), { timeout: 6000 });
    await page.click('#dbSyncOpen');
    await page.waitForFunction(() => document.querySelectorAll('#dbnBody .dbn-row').length >= 5, { timeout: 8000, polling: 100 });
    await page.screenshot({ path: path.join(__dirname, '_artifacts', 'dbn-panel.png') });
    const open = await page.evaluate(() => ({
      mask: !!document.getElementById('dbnMask'),
      rows: document.querySelectorAll('#dbnRow, #dbnBody .dbn-row').length,
      has: document.querySelectorAll('#dbnBody .dbn-row.has').length,
      grp: Array.prototype.map.call(document.querySelectorAll('#dbnBody .dbn-grp'), x => x.textContent).join(' | '),
      picked: document.querySelectorAll('#dbnBody .dbn-row.on').length,
      goTxt: document.getElementById('dbnGo').textContent,
      msg: document.getElementById('dbnMsg').textContent
    }));
    check('02', '面板一开就自动打网关拉标记（status + pull 各一次），列表按状态分组渲染',
      open.mask && open.rows === 5 && /在看 2 条/.test(open.grp) && /看过 2 条/.test(open.grp) && /想看 1 条/.test(open.grp) &&
      hits3000.filter(u => /\/db\/status/.test(u)).length >= 1 && /type=tv/.test(lastPull),
      JSON.stringify(open) + ' hits=' + hits3000.length);
    check('03', '默认一条都不勾（导入钮写着「还没勾条目」），已在片单那条带 has 标灰',
      open.picked === 0 && open.has === 1 && /还没勾条目/.test(open.goTxt) && /勾选|拉到了/.test(open.msg),
      JSON.stringify(open));

    await page.evaluate(() => document.getElementById('dbnNew').click());
    const pick = await page.evaluate(() => ({
      picked: document.querySelectorAll('#dbnBody .dbn-row.on').length,
      goTxt: document.getElementById('dbnGo').textContent,
      cnt: document.getElementById('dbnCnt').textContent,
      hasPicked: !!document.querySelector('#dbnBody .dbn-row.has.on')
    }));
    check('04', '「只选未入库」一键勾上 4 条，已在片单那条自动排除',
      pick.picked === 4 && !pick.hasPicked && /导入勾上的 4 部/.test(pick.goTxt) && /已勾 4/.test(pick.cnt),
      JSON.stringify(pick));

    await page.evaluate(() => document.getElementById('dbnGo').click());
    await sleep(700);
    const after = await page.evaluate(() => {
      const a = window.shows || [];
      const g = id => a.filter(x => x.sid === id)[0] || {};
      const D = (s, f) => window.fmtDay(s[f] || 0);
      return {
        n: a.length,
        seed: { status: g('db111').status, tDone: D(g('db111'), 'tDone') },
        aS: g('db9001').status, aD: D(g('db9001'), 'tStart'), aF: g('db9001').tStartFrom,
        cS: g('db9003').status, cD: D(g('db9003'), 'tDone'), cF: g('db9003').tDoneFrom, cStart: D(g('db9003'), 'tStart'),
        dS: g('db9004').status, dStart: D(g('db9004'), 'tStart'), dDone: D(g('db9004'), 'tDone'),
        note: document.getElementById('dbnMsg').textContent
      };
    });
    const dayA = after.aD, dayC = after.cD;
    check('05', '勾上的 4 条入库：状态按豆瓣落（在看/看完/想看），豆瓣标记日期变成开始或看完时间',
      after.n === 5 && after.aS === 'watching' && dayA === '2026-08-26' && after.aF === 'db' &&
      after.cS === 'done' && dayC === '2026-07-15' && after.cF === 'db' && !after.cStart &&
      after.dS === 'want' && !after.dStart && !after.dDone,
      JSON.stringify(after));
    check('06', '没勾的那条（已在片单的「测试剧A」）一条都没动：状态仍是想看、没被写进看完时间',
      after.seed.status === 'want' && !after.seed.tDone, JSON.stringify(after.seed) + ' note=' + after.note);

    /* ---------- B7 详情页时间行 + 列表卡「看完」日期 ---------- */
    /* 这两张是要递到用户眼前的照片：账号面板和豆瓣面板还压在上面的话，拍出来全是遮挡。
       真机路径本来就是「列表 → 点卡片 → 详情」，那时候没有任何面板开着。 */
    await page.evaluate(() => { if (window.__closeDbn) window.__closeDbn(); if (window.__closeSync) window.__closeSync(); });
    await sleep(300);
    await page.evaluate(() => window.openDetail('db9003'));
    await sleep(500);
    const det = await page.evaluate(() => {
      const el = document.getElementById('dTime');
      return { shown: el.style.display !== 'none', txt: el.textContent.replace(/\s+/g, ' ').trim(), rows: el.querySelectorAll('.src').length };
    });
    await page.screenshot({ path: path.join(__dirname, '_artifacts', 'dbn-detail.png') });
    check('07', '详情页时间行：看完 2026-07-15 + 来源标「豆瓣」',
      det.shown && /看完 2026-07-15/.test(det.txt) && det.rows === 1, JSON.stringify(det));
    await page.evaluate(() => window.backList());
    await sleep(400);
    const card = await page.evaluate(() => {
      const it = Array.prototype.filter.call(document.querySelectorAll('#list .show'),
        n => /测试剧·看过C/.test(n.textContent))[0];
      return it ? it.querySelector('.s').textContent : '';
    });
    await page.screenshot({ path: path.join(__dirname, '_artifacts', 'dbn-list.png') });
    check('08', '列表卡只在「看完」的条目上露完成日期，写成「2026-07-15 看完」不重复状态词（其它卡不多一行）',
      /2026-07-15 看完/.test(card) && (card.match(/看完/g) || []).length === 1, card.slice(0, 120));

    /* ---------- B9 本机标记不覆盖豆瓣给的时间 ---------- */
    const keep = await page.evaluate(() => {
      const s = window.bySid('db9001'), before = s.tStart;
      window.setEpStat(s, 1, 'watched');
      return { before: before, after: s.tStart, from: s.tStartFrom, done: !!s.tDone };
    });
    check('09', '在豆瓣导入的「在看」条目上标记单集：开始时间保持豆瓣那天，不另起一个',
      keep.before === keep.after && keep.from === 'db' && !keep.done, JSON.stringify(keep));
    /* ---------- B10 手改的时间，豆瓣再拉一次也不许覆盖 ---------- */
    await page.evaluate(() => window.editWatchTime('db9001'));
    await page.waitForFunction(() => !!document.querySelector('#uiDlgMask .udF'), { timeout: 5000 });
    await page.evaluate(() => {
      const f = document.querySelectorAll('#uiDlgMask .udF');
      f[0].value = '2020-01-01'; f[1].value = '2020-02-02';
      document.getElementById('udYes').click();
    });
    await sleep(500);
    await page.evaluate(() => window.openDoubanSync());
    /* 第二次打开面板：拉不到行时在结案前把话术和命中打出来，别让它闷在 waitForFunction 里 */
    const seen = await page.evaluate(async () => {
      const T = () => { const m = document.getElementById('dbnMsg'); return m ? m.textContent : '(no #dbnMsg; masks=' + Array.prototype.map.call(document.querySelectorAll('.mask'), x => x.id).join(',') + ')'; };
      for (let i = 0; i < 60; i++) {
        const n = document.querySelectorAll('#dbnBody .dbn-row').length;
        if (n >= 5) return { n, msg: T(), ok: true };
        await new Promise(r => setTimeout(r, 100));
      }
      return { n: document.querySelectorAll('#dbnBody .dbn-row').length, msg: T(), rm: (window.__rmLog || []).slice(-4), ok: false };
    });
    if (!seen.ok) console.log('DBG B10b: ' + JSON.stringify(seen) + ' hits3000=' + JSON.stringify(hits3000) + ' netOut=' + JSON.stringify(netOut.slice(0, 4)));
    if (!seen.ok) throw new Error('第二次开面板没拉到条目：' + seen.msg);
    const reimp = await page.evaluate(async () => {
      const rows = Array.prototype.slice.call(document.querySelectorAll('#dbnBody .dbn-row'));
      const r = rows.filter(x => /测试剧·在看A/.test(x.textContent))[0];
      r.click();
      document.getElementById('dbnGo').click();
      await new Promise(res => setTimeout(res, 300));
      const s = window.bySid('db9001');
      return { tStart: s.tStart, from: s.tStartFrom, fmt: window.fmtDay(s.tStart), tDone: window.fmtDay(s.tDone) };
    });
    check('10', '手改成 2020-01-01 后再从豆瓣导入同一条：时间纹丝不动（来源仍是「手改」）',
      reimp.fmt === '2020-01-01' && reimp.from === 'me', JSON.stringify(reimp));

    /* ---------- B11 状态胶囊驱动时间：看完落一笔，改回在看撤掉本机那笔 ---------- */
    await page.evaluate(() => window.__closeDbn());
    await page.evaluate(() => window.openDetail('db9002'));
    await sleep(400);
    const st1 = await page.evaluate(async () => {
      const btn = Array.prototype.slice.call(document.querySelectorAll('#dStatus .st')).filter(b => /看完/.test(b.textContent))[0];
      btn.click();
      await new Promise(res => setTimeout(res, 200));
      const s = window.bySid('db9002');
      return { done: !!s.tDone, from: s.tDoneFrom, start: window.fmtDay(s.tStart) };
    });
    const st2 = await page.evaluate(async () => {
      const btn = Array.prototype.slice.call(document.querySelectorAll('#dStatus .st')).filter(b => /在看/.test(b.textContent))[0];
      btn.click();
      await new Promise(res => setTimeout(res, 200));
      const s = window.bySid('db9002');
      return { done: !!s.tDone, start: window.fmtDay(s.tStart), from: s.tStartFrom };
    });
    check('11', '点「看完」当场记下完成时间（本机），改回「在看」把本机那笔撤掉、豆瓣给的开始时间留着',
      st1.done && st1.from === 'me' && st1.start === '2026-09-01' && !st2.done && st2.start === '2026-09-01' && st2.from === 'db',
      JSON.stringify({ st1, st2 }));

    /* ---------- B12 「含电影」切换范围 · B13 离线文件走同一张勾选清单 ---------- */
    await page.evaluate(() => window.openDoubanSync());
    await page.waitForFunction(() => document.querySelectorAll('#dbnBody .dbn-row').length >= 5, { timeout: 8000, polling: 100 });
    await page.evaluate(() => document.querySelector('#dbnScope [data-sc=all]').click());
    await page.waitForFunction(() => document.querySelectorAll('#dbnBody .dbn-row').length >= 6, { timeout: 8000, polling: 100 });
    const wide = await page.evaluate(() => ({
      rows: document.querySelectorAll('#dbnBody .dbn-row').length,
      hasMovie: /测试电影·看过M/.test(document.getElementById('dbnBody').textContent)
    }));
    check('12', '范围切「含电影」立刻重拉（去掉 type=tv，按网关口径就是含电影）并多出电影那条',
      wide.rows === 6 && wide.hasMovie && !/type=tv/.test(lastPull), JSON.stringify(wide) + ' lastPull=' + lastPull);

    const CSV = '离线测试剧,2019,看过,8,2026-01-09\n离线测试剧2,2021,在看,0,2026-02-11';
    const tmp = path.join(__dirname, '_artifacts', 'douban-offline-sample.csv');
    fs.writeFileSync(tmp, '﻿' + CSV, 'utf8');
    const fi = await page.$('#dbnFile');
    await fi.uploadFile(tmp);
    await page.waitForFunction(() => /离线测试剧/.test(document.getElementById('dbnBody').textContent), { timeout: 6000, polling: 100 });
    const off = await page.evaluate(async () => {
      const rows = Array.prototype.slice.call(document.querySelectorAll('#dbnBody .dbn-row'));
      rows.filter(x => x.textContent.indexOf('2019') >= 0)[0].click();
      const before = window.shows.length;
      document.getElementById('dbnGo').click();
      await new Promise(res => setTimeout(res, 300));
      const s = window.shows.filter(x => /离线测试剧/.test(x.title) && x.year === '2019')[0] || {};
      return { added: window.shows.length - before, status: s.status, done: window.fmtDay(s.tDone), src: s.source };
    });
    check('13', '离线 CSV 进同一张勾选清单：勾一条只入一条，第 5 列的日期变成看完时间',
      off.added === 1 && off.status === 'done' && off.done === '2026-01-09', JSON.stringify(off));
    await page.evaluate(() => window.__closeDbn());

    /* ---------- B18 片名过滤：真豆瓣一次 500 条，几百行里逐条找等于没得选 ---------- */
    await page.evaluate(() => window.openDoubanSync());
    await page.waitForFunction(() => document.querySelectorAll('#dbnBody .dbn-row').length >= 5, { timeout: 8000, polling: 100 });
    await page.evaluate(() => { const q = document.getElementById('dbnQ'); q.value = '在看'; q.dispatchEvent(new Event('input')); });
    const flt = await page.evaluate(() => {
      const rows = () => Array.prototype.slice.call(document.querySelectorAll('#dbnBody .dbn-row'));
      const shown = rows().length;
      document.getElementById('dbnAll').click();
      const pickedShown = rows().filter(x => x.classList.contains('on')).length;
      const cnt = document.getElementById('dbnCnt').textContent;
      const q = document.getElementById('dbnQ'); q.value = ''; q.dispatchEvent(new Event('input'));
      return { shown, pickedShown, cnt, all: rows().length, pickedAll: rows().filter(x => x.classList.contains('on')).length };
    });
    check('18', '片名过滤只留命中行，「全选」只管看得见的那批，清掉过滤后勾还在',
      flt.shown === 2 && flt.pickedShown === 2 && /过滤后 2 条/.test(flt.cnt) && flt.all === 5 && flt.pickedAll === 2,
      JSON.stringify(flt));
    await page.evaluate(() => window.__closeDbn());

    /* ---------- B19 剧名铁律：外语剧＝中文+原文，中文段兜底匹配（用户令 2026-10-06） ---------- */
    /* 9001 夹具自带 origTitle:'TEST A' —— 按新规矩，清单和片单里它都该是双语名「测试剧·在看A TEST A」。
       中文段匹配用单元式断言：临时塞一条同名纯中文名条目（无 dbId），用假 subjectId 绕开 dbId 命中，
       dbTargetOf 必须靠 cnTitle 判出「已在片单」；完事移除且不 save()，B14 的条数不受影响。 */
    await page.evaluate(() => { window.shows.push({ sid: 'cn9001x', title: '测试剧·在看A', total: 0, eps: [], statuses: {}, status: 'watching', addedAt: 1, updAt: 1 }); });
    await page.evaluate(() => window.openDoubanSync());
    await page.waitForFunction(() => document.querySelectorAll('#dbnBody .dbn-row').length >= 5, { timeout: 8000, polling: 100 });
    const bi = await page.evaluate(() => {
      const rows = Array.prototype.slice.call(document.querySelectorAll('#dbnBody .dbn-row'));
      const r = rows.filter(x => /测试剧·在看A/.test(x.textContent))[0];
      const hit = !!window.dbTargetOf({ subjectId: '999999', title: '测试剧·在看A TEST A', cnTitle: '测试剧·在看A' });
      const s = (window.shows || []).filter(x => x.sid === 'db9001')[0] || {};
      return { rowTitle: r ? ((r.querySelector('.dbn-tt') || {}).textContent || '') : '', hit, imported: s.title || '' };
    });
    check('19', '剧名铁律：豆瓣「中文名/原名」拼成双语剧名进清单和片单；片单里纯中文名的旧条目靠中文段判「已在片单」',
      bi.rowTitle === '测试剧·在看A TEST A' && bi.hit && bi.imported === '测试剧·在看A TEST A',
      JSON.stringify(bi));
    await page.evaluate(() => { const i = (window.shows || []).findIndex(x => x.sid === 'cn9001x'); if (i >= 0) window.shows.splice(i, 1); });
    await page.evaluate(() => window.__closeDbn());

    /* ---------- B14 刷新后时间账还在 · B15 全程无 JS 错误、没打真实外网 ---------- */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const persist = await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const g = id => a.filter(x => x.sid === id)[0] || {};
      return { n: a.length, cDone: window.fmtDay(g('db9003').tDone), aStart: window.fmtDay(g('db9001').tStart), off: g('db9003').tDoneFrom };
    });
    check('14', '刷新后时间账仍在（写进了 localStorage，不是只在内存里）',
      persist.n === 6 && persist.cDone === '2026-07-15' && persist.aStart === '2020-01-01' && persist.off === 'db',
      JSON.stringify(persist));

    /* ---------- B15 手机宽度：面板不横向溢出、勾选行触点够大（真机必踩的两条） ---------- */
    await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
    await sleep(300);
    await page.evaluate(() => window.openDoubanSync());
    await page.waitForFunction(() => document.querySelectorAll('#dbnBody .dbn-row').length >= 5, { timeout: 8000, polling: 100 });
    await sleep(400);
    await page.screenshot({ path: path.join(__dirname, '_artifacts', 'dbn-panel-phone.png') });
    const ph = await page.evaluate(() => {
      const rows = Array.prototype.slice.call(document.querySelectorAll('#dbnBody .dbn-row'));
      const small = rows.filter(el => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height) < 34; }).length;
      const over = rows.filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).length;
      const tiny = Array.prototype.slice.call(document.querySelectorAll('#dbnMask *'))
        .filter(el => el.children.length === 0 && (el.textContent || '').trim())
        .map(el => parseFloat(getComputedStyle(el).fontSize)).filter(px => px < 11).length;
      const im = Array.prototype.slice.call(document.querySelectorAll('#dbnBody img'));
      return { n: rows.length, small, over, tiny, w: window.innerWidth, sw: document.documentElement.scrollWidth,
        imgN: im.length, imgLazy: im.filter(x => x.getAttribute('loading') === 'lazy').length };
    });
    check('15', '393 宽下面板不横向溢出、每条勾选行触点 ≥34px、面板内无 11px 以下正文',
      ph.n >= 5 && ph.small === 0 && ph.over === 0 && ph.tiny === 0 && ph.sw <= ph.w + 1, JSON.stringify(ph));
    await page.evaluate(() => window.__closeDbn());

    /* 手机尺寸下的两处显示（可见交付的照片就是这两张） */
    await page.evaluate(() => window.openDetail('db9003'));
    await sleep(400);
    await page.screenshot({ path: path.join(__dirname, '_artifacts', 'dbn-detail-phone.png') });
    await page.evaluate(() => window.backList());
    await sleep(300);
    await page.screenshot({ path: path.join(__dirname, '_artifacts', 'dbn-list-phone.png') });

    /* 口径要说清（真豆瓣实测：500 条全带 doubanio 外链封面）：
       「零直连」管的是标记数据那一路——fetch/xhr 一律只认本机 :3000 网关；
       封面图仍是外链，但必须懒加载（500 张全量拉图在手机上是灾难）。
       开机 4 秒后的静默补封面（coverHealAll）本来就会打 tvmaze/wikidata，那是既有功能，单独观测。 */
    const urlOf = s => s.slice(s.lastIndexOf(' ') + 1);
    const heal = netOut.filter(s => /fetch|xhr/.test(s) && !DB_HOST.test(urlOf(s)) && !DB_RELAY.test(urlOf(s)) && urlOf(s).indexOf('127.0.0.1') < 0 && urlOf(s).indexOf('localhost') < 0);
    console.log('OBS 其它出网 ' + heal.length + ' 次（既有补封面行为）：' + heal.slice(0, 2).join(' | '));
    console.log('OBS 自建云中转 douban-relay ' + relayHits.length + ' 次（v2.31 分集中文与产地判定走这条，不是豆瓣站点直连）：' + relayHits.slice(0, 2).join(' | '));
    check('16', '豆瓣标记数据零直连（fetch/xhr 里没有任何豆瓣域名，标记走本机 :3000 网关、分集名走自建云中转）+ 面板封面全部懒加载',
      dbData.length === 0 && hits3000.length >= 4 && ph.imgN >= 1 && ph.imgLazy === ph.imgN,
      '豆瓣直连=' + dbData.slice(0, 2).join(' | ') + ' 图直连' + dbImg.length + '次 网关命中' + hits3000.length + '次 云中转' + relayHits.length + '次 封面' + JSON.stringify({ imgN: ph.imgN, imgLazy: ph.imgLazy }));
    check('17', '全程无页面级 JS 错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  } catch (e) {
    console.log('FATAL: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    try { if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  const fails = results.filter(r => !r.ok);
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS' +
    (fails.length ? ' :: FAILED: B' + fails.map(r => r.id).join(',B') : ''));
  fs.writeFileSync(path.join(__dirname, 'last-douban-sync.json'), JSON.stringify({ at: new Date().toISOString(), results: results }, null, 2));
  process.exitCode = fails.length ? 1 : 0;
})();
