/* 手机「用起来」走查：不量像素，量**行为**。
   phone-look 管版式（出界/触点/小字），这一份管一个真人拿手机干几件事会不会别扭：
   加片→标记看到→返回看进度→搜→筛→长按→切主题视图→重开是否记住→键盘压不压输入框→深滚能不能回头。
   用法：node tests/phone-use.js [--keep-shots] */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8135;
const OUT = path.join(ROOT, 'tests', 'shots-phone', 'use');
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TP1A.220624.014) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';
const VW = 393, VH = 851;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/* 走查里所有「在线」一步都要被拦成真结果，否则测的是网络而不是交互。
   v2.17.0：在线源换成全网库（TVMaze），所以这里喂它那套响应形状。 */
const mkTvShow = (id, name) => ({
  id, name, type: 'Anime', language: 'Japanese', genres: ['Animation'], status: 'Ended',
  runtime: 24, premiered: '2023-10-02',
  image: { medium: '/tracker-icon-512.png', original: '/tracker-icon-512.png' },
  summary: '一部关于吃魔物的动画。', url: 'https://www.tvmaze.com/shows/' + id,
});
const SR_FIXTURE = {
  search: [
    { score: 99, show: mkTvShow(40001, 'Delicious in Dungeon') },
    { score: 95, show: mkTvShow(40002, 'Bocchi the Rock! 2nd Season') },
  ],
  subject: mkTvShow(40001, 'Delicious in Dungeon'),
  episodes: Array.from({ length: 24 }, (_, i) => ({
    id: 90000 + i, name: 'Episode ' + (i + 1), season: 1, number: i + 1, runtime: 24,
    airdate: '2023-10-' + String(i + 2).padStart(2, '0'), show: { id: 40001 },
  })),
};

const findings = [];
/* 一条发现立刻打印：这份是门禁，中途崩掉不能把已经跑出来的结论一起带走 */
const F = (level, task, what, detail) => {
  const f = { level, task, what, detail: detail || '' };
  findings.push(f);
  console.log('  [' + level.toUpperCase() + '] ' + task + ' · ' + what + (f.detail ? '\n        ' + f.detail : ''));
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probe()) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const shots = [];
  const errs = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [
      { name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
    await page.evaluateOnNewDocument(() => {
      window.AndroidShell = {
        checkUpdate() {}, checkContent() {}, appVersion() { return '1.4（5）'; },
        contentCode() { return '102'; }, toast(m) { console.log('shell toast: ' + m); },
      };
    });
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/tcb-api\.tencentcloudapi/.test(u)) return req.abort();
      const reply = (obj) => req.respond({ status: 200, contentType: 'application/json; charset=utf-8',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
      if (/api\.tvmaze\.com\/search\/shows/.test(u)) return reply(SR_FIXTURE.search);
      if (/api\.tvmaze\.com\/shows\/\d+\/episodes/.test(u)) return reply(SR_FIXTURE.episodes);
      if (/api\.tvmaze\.com\/shows\/\d+/.test(u)) return reply(SR_FIXTURE.subject);
      return req.continue();
    });

    const url = 'http://127.0.0.1:' + PORT + '/index.html';
    const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n) }); shots.push(n); };
    const reset = async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1200);
      await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} location.reload(); });
      await sleep(1500);
    };
    /* 手机真人用拇指：一律 page.tap，不 page.click（click 不发 touch 序列，绕得过触摸专用分支） */
    const tap = async (sel) => { await page.tap(sel); await sleep(450); };
    /* 点某个具体元素前**必须先滚进视口**：tap(x,y) 用的是视口坐标，
       元素在 851 之外时点到的是空气——上一版就是这么把好的「双击标记」误报成 BAD 的。 */
    const tapEl = async (sel, times) => {
      const n = times || 1;
      const st = await page.evaluate((s) => {
        const e = document.querySelector(s); if (!e) return { ok: false, why: '元素不存在' };
        e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect();
        return { ok: true, inView: r.top >= 0 && r.bottom <= window.innerHeight,
          x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
      }, sel);
      if (!st.ok) return st;
      await sleep(420);
      const box = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, inView: r.top >= 0 && r.bottom <= window.innerHeight }; }, sel);
      if (!box.inView) return { ok: false, why: '滚进视口后仍不可见', box };
      for (let i = 0; i < n; i++) { await page.touchscreen.tap(box.x, box.y); await sleep(n > 1 ? 130 : 450); }
      return { ok: true, box };
    };
    const typeInto = async (sel, txt) => {
      await page.focus(sel);
      await page.keyboard.type(txt, { delay: 24 });
      await sleep(700);
    };
    const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 900));

    /* ── 任务 0：冷启动（全新用户，本机没数据、网被掐成假数据） ── */
    await reset();
    await shot('00-冷启动.png');
    let t = await bodyText();
    F('note', '0 冷启动', '首屏文案', t.slice(0, 120));
    const firstAddVisible = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button,[onclick]')].find((x) => /添加/.test(x.textContent || ''));
      if (!b) return { ok: false, why: '首屏找不到「添加」按钮' };
      const r = b.getBoundingClientRect();
      return { ok: r.top >= 0 && r.bottom <= window.innerHeight, r: { top: Math.round(r.top), h: Math.round(r.height) },
        w: Math.round(r.width), h: Math.round(r.height) };
    });
    if (!firstAddVisible.ok) F('bad', '0 冷启动', '新用户第一眼没有可点的「添加」（首屏外或不存在）', JSON.stringify(firstAddVisible));

    /* ── 任务 1：加一部片（真人最常做的一步） ── */
    await tap('#vList>.top button[aria-label="添加番剧"]');
    await shot('01-添加面板.png');
    const addFocus = await page.evaluate(() => ({
      active: document.activeElement && document.activeElement.id,
      inView: document.activeElement ? document.activeElement.getBoundingClientRect().bottom <= window.innerHeight : false,
    }));
    if (addFocus.active !== 'qKw') F('bad', '1 加片', '进添加页后搜索框没自动聚焦，用户还得自己点一下', JSON.stringify(addFocus));

    await typeInto('#qKw', '迷宫饭');
    await page.evaluate(() => doSearch());
    /* 等结果区真的渲染出条目：2.5 秒定值在慢机器上会抢跑（量到空列表→整步误判） */
    await page.waitForFunction(() => document.querySelectorAll('#srList .sr').length > 0, { timeout: 12000 }).catch(() => { });
    await sleep(400);
    await shot('01b-搜索结果.png');
    const sr = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#srList .sr, #srList .sritem, #srList > *')];
      const btns = [...document.querySelectorAll('#srList button')].map((b) => (b.textContent || '').trim());
      return { msg: (document.getElementById('srMsg') || {}).textContent || '',
        rowCount: rows.length, btns: btns.slice(0, 12),
        firstBtnRect: (() => { const b = document.querySelector('#srList button'); if (!b) return null;
          const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })() };
    });
    if (!sr.rowCount) F('bad', '1 加片', '搜到了但结果区是空的（全网库有数据却不渲染）', sr.msg);
    if (/代理|超时|不可达/.test(sr.msg)) F('bad', '1 加片', '有数据可用却仍报网络诊断', sr.msg.slice(0, 90));
    F('note', '1 加片', '结果行数/按钮', sr.rowCount + ' 行 · ' + sr.btns.join('、') + ' · ' + JSON.stringify(sr.firstBtnRect));

    const pre = await page.evaluate(() => ({
      n: (window.shows || []).length,
      /* 基准文案必须在点击**之前**取：点了就同步出回执的话，点击后再取 prev 会
         把刚冒出来的那条当成「旧消息」，轮询永远等不到「新文案」。 */
      toast: (document.getElementById('toast') || {}).textContent || '',
    }));
    const picked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#srList button')].find((x) => /添加|追+|\+/.test(x.textContent || ''));
      if (!b) return null; b.click(); return (b.textContent || '').trim();
    });
    /* toast 只活 2.2 秒，单点采样必然不是踩早就是踩晚（两版都翻过车：等 2200ms 采到
       「刚消失」、等 700ms 采到「还没出现」）。改成轮询：6 秒内闪过任何新回执就算有反馈，
       并记下它是点完第几毫秒冒出来的——这个数本身就是「点了有没有反应」的度量。 */
    const feedback = await page.evaluate(async (prevToast) => {
      const el = () => document.getElementById('toast');
      const t0 = Date.now();
      while (Date.now() - t0 < 6000) {
        const e = el();
        const txt = e ? (e.textContent || '').trim() : '';
        if (e && e.classList.contains('on') && txt && txt !== prevToast) {
          return { toastOn: true, toast: txt, appearedAfterMs: Date.now() - t0 };
        }
        if (document.querySelector('.mask')) return { toastOn: false, dialog: true, appearedAfterMs: Date.now() - t0 };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { toastOn: false, toast: (el() || {}).textContent || '', dialog: !!document.querySelector('.mask'), appearedAfterMs: -1 };
    }, pre.toast);
    await shot('01c-加完之后.png');
    const addAfter = await page.evaluate(() => ({
      n: (window.shows || []).length,
      view: document.getElementById('vAdd').style.display === '' ? 'vAdd'
        : document.getElementById('vList').style.display === '' ? 'vList' : 'vDetail',
      kw: (document.getElementById('qKw') || {}).value,
    }));
    if (addAfter.n <= pre.n) F('bad', '1 加片', '点了「添加」结果没进片单', '按钮=' + picked + ' · ' + JSON.stringify(addAfter));
    if (addAfter.n > pre.n && !feedback.toastOn && !feedback.dialog) F('mid', '1 加片', '加成功没有任何反馈（无 toast、无弹窗），用户不知道加没加上了', JSON.stringify(feedback));
    if (addAfter.view === 'vAdd' && addAfter.n > pre.n) F('mid', '1 加片', '加完还停在搜索页，得手动返回才看到片单', addAfter.view);
    /* 反馈要即时：实测内置库添加原先点了 2.2 秒才冒回执（封面下载卡在主路径上），
       这段时间屏上毫无变化，用户只会以为没点上、再点一次。 */
    if (addAfter.n > pre.n && feedback.toastOn && feedback.appearedAfterMs > 1200)
      F('mid', '1 加片', '点完「添加」干了 ' + feedback.appearedAfterMs + 'ms 才有反应，中间像卡住了', JSON.stringify(feedback));
    F('note', '1 加片', '加完状态', JSON.stringify(feedback) + ' · ' + JSON.stringify(addAfter));

    /* ── 任务 2：回到片单，打开详情，标记「看到第 N 集」 ── */
    await page.evaluate(() => backList());
    await sleep(600);
    await page.evaluate(() => openDetail((window.shows[0] || {}).sid));
    await sleep(1400);
    await shot('02-详情.png');
    const dstat = await page.evaluate(() => {
      const s = window.shows[0]; const el = document.getElementById('nextBtn');
      return { sid: s && s.sid, title: s && s.title, total: s && s.total, next: el ? (el.textContent || '').trim() : '',
        epRows: document.querySelectorAll('#dGroups [data-ep]').length };
    });
    if (!dstat.epRows) F('bad', '2 标记进度', '详情页一部 24 话的番却没有任何剧集行', JSON.stringify(dstat));
    /* 打开一部番，真人第一件要做的事就是「看到第几集」。这颗钮落在首屏外，
       等于每次记进度都得先滚过一屏设置类工具——上一版实测 top≈700（5 颗低频工具钮 + 来源覆盖条压在它前面）。 */
    const fold = await page.evaluate(() => {
      const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
      return { vh: window.innerHeight, next: R('#nextBtn'), tools: R('#vDetail .dtools'),
        cov: R('#dSrcCov'), groups: R('#dGroups'), del: R('#delBtn') };
    });
    if (!fold.next) F('bad', '2 标记进度', '详情页找不到「标记下一集」', JSON.stringify(fold));
    else {
      if (fold.next.top < 0 || fold.next.bottom > fold.vh)
        F('bad', '2 标记进度', '点开一部番，主操作「标记下一集」不在首屏内，每次记进度都要先滚一趟', JSON.stringify(fold));
      if (fold.tools && fold.groups && fold.tools.top < fold.groups.top)
        F('mid', '2 标记进度', '低频工具（编辑集数/来源校准/AI 导入…）仍排在剧集列表前面', JSON.stringify(fold));
      F('note', '2 标记进度', '首屏 ' + fold.vh + 'px 内各块位置', JSON.stringify(fold));
    }
    /* 真人：双击某一集 = 已看到这里（代码注释里写的手势）。两下都tap同一个点，中间 130ms。 */
    const epSel = '#dGroups [data-ep="16"]';
    const hasEp16 = await page.evaluate((s) => !!document.querySelector(s), epSel);
    let tapRes = null;
    if (hasEp16) {
      tapRes = await tapEl(epSel, 2);
      await sleep(900);
    }
    await shot('02b-标记后.png');
    const afterMark = await page.evaluate(() => {
      const s = window.shows[0]; const t = document.getElementById('toast');
      let w = 0; const st = (s && s.statuses) || {};
      for (let i = 1; i <= ((s && s.total) || 0); i++) if (st[i] === 'watched') w++;
      return { has: !!s, watched: w, toast: t ? (t.textContent || '').trim() : '', toastOn: t ? t.classList.contains('on') : false,
        next: (document.getElementById('nextBtn') || {}).textContent || '' };
    });
    if (!afterMark.has) F('bad', '2 标记进度', '加完片回到列表却查不到任何条目（上一步「添加」其实没落库）', JSON.stringify(addAfter));
    if (hasEp16 && !afterMark.watched) F('bad', '2 标记进度', '双击某一集（文档写的「已看到这里」手势）没标记上任何集', JSON.stringify({ tapRes, afterMark }));
    if (hasEp16 && !afterMark.toastOn) F('mid', '2 标记进度', '标记成功但没反馈', JSON.stringify(afterMark));
    F('note', '2 标记进度', '双击第16话后', JSON.stringify({ tapRes, afterMark }));

    /* ── 任务 3：返回片单，进度是否带回来了 ── */
    await page.evaluate(() => backList());
    await sleep(900);
    await shot('03-返回片单.png');
    const listProg = await page.evaluate(() => {
      const el = document.querySelector('.show .num b'); const card = document.querySelector('.show');
      return { num: el ? (el.textContent || '').trim() : '', cardText: card ? (card.innerText || '').replace(/\s+/g, ' ').slice(0, 90) : '' };
    });
    if (!listProg.cardText) F('bad', '3 返回', '返回片单后列表是空的', JSON.stringify(listProg));
    F('note', '3 返回', '片单行文案', listProg.cardText);

    /* ── 任务 4：在片单里搜 + 切筛选（拇指点标签） ── */
    await typeInto('#listQ', '迷宫');
    await sleep(600);
    await shot('04-片单搜索.png');
    const lsq = await page.evaluate(() => ({
      rows: document.querySelectorAll('.show').length, empty: !!document.querySelector('.empty') }));
    if (!lsq.rows) F('bad', '4 片单内搜索', '搜自己有的一部片搜不到', JSON.stringify(lsq));
    await page.evaluate(() => { const i = document.getElementById('listQ'); i.value = ''; setListQ(''); });
    await sleep(400);
    const filt = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#filters .fbtn')].map((x) => (x.textContent || '').trim());
      return b;
    });
    F('note', '4 筛选', '筛选项', filt.join(' / '));
    if (filt.length) {
      const hit = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#filters .fbtn')].find((x) => /想看|wish|收藏/.test(x.textContent || ''));
        if (!b) return null; b.click(); return (b.textContent || '').trim();
      });
      await sleep(600);
      await shot('04b-切筛选.png');
      const fz = await page.evaluate(() => ({ rows: document.querySelectorAll('.show').length,
        active: [...document.querySelectorAll('#filters .fbtn')].filter((x) => x.className.includes('on') || x.getAttribute('aria-current')).map((x) => (x.textContent || '').trim()) }));
      if (hit && !fz.active.length) F('mid', '4 筛选', '切了筛选但当前项没有视觉状态，看不出正在看哪一档', '档=' + hit);
      await page.evaluate(() => setFilter('all'));
      await sleep(400);
    }

    /* ── 任务 5：长按一部片（手机上的右键） ── */
    const cardBox = await page.evaluate(() => { const c = document.querySelector('.show'); if (!c) return null;
      const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 30) }; });
    if (cardBox) {
      await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
      }, cardBox);
      await sleep(600);
      await shot('05-长按菜单.png');
      const menu = await page.evaluate(() => {
        const m = document.querySelector('.ctxmenu.on, .ctxmenu');
        if (!m) return null;
        const r = m.getBoundingClientRect(); const items = [...m.querySelectorAll('.ctxi')].map((x) => (x.textContent || '').trim().slice(0, 10));
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
          fits: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, items };
      });
      if (!menu) F('bad', '5 长按', '手机上长按片单卡片弹不出菜单（桌面右键有，手机没有=功能等于不存在）');
      else {
        if (!menu.fits) F('bad', '5 长按', '菜单超出屏幕', JSON.stringify(menu));
        F('note', '5 长按', '菜单项', menu.items.join(' / '));
        await page.evaluate(() => { const m = document.querySelector('.ctxmenu'); if (m) m.classList.remove('on'); });
      }
    } else F('mid', '5 长按', '列表里没有 .show 卡片可长按');

    /* ── 任务 6：改主题 / 改视图，杀掉页面重开还记不记得 ── */
    await page.evaluate(() => { cycleTheme(); if (listViewMode() !== 'grid') toggleListView(); });
    await sleep(600);
    const before = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), view: listViewMode() }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const after = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), view: listViewMode(),
      rows: document.querySelectorAll('.show').length }));
    await shot('06-重开后.png');
    if (after.theme !== before.theme) F('bad', '6 重开记忆', '主题没记住（改了深色，重开又变回去）', JSON.stringify({ before, after }));
    if (after.view !== before.view) F('bad', '6 重开记忆', '视图没记住（切了封面墙，重开回列表）', JSON.stringify({ before, after }));
    if (!after.rows) F('bad', '6 重开记忆', '重开以后片单空了（数据没落盘）', JSON.stringify(after));

    /* ── 任务 6b：封面墙上点 ⋮（v2.21.0 起动作只住在这颗钮里，长按是隐藏手势） ── */
    const gm = await page.evaluate(() => {
      const b = document.querySelector('.cards.grid .gmore'); if (!b) return null;
      const r = b.getBoundingClientRect(), gp = b.closest('.gp').getBoundingClientRect();
      const cs = getComputedStyle(b, '::before');
      const dw = parseFloat(cs.width), dh = parseFloat(cs.height);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height),
        discPct: Math.round(dw * dh / (gp.width * gp.height) * 1000) / 10,
        cols: getComputedStyle(document.querySelector('.cards.grid')).gridTemplateColumns.split(' ').length };
    });
    if (!gm) F('bad', '6b 封面墙', '切到封面墙却没有 ⋮ 入口（触屏没有 hover，动作就等于不存在）');
    else {
      if (gm.w < 34 || gm.h < 34) F('bad', '6b 封面墙', '⋮ 触点小于 34px，拇指按不中', gm.w + '×' + gm.h);
      if (gm.discPct > 5) F('mid', '6b 封面墙', '⋮ 的实心部分盖掉海报超过 5%（用户反馈「太挡了」量的就是这块）', gm.discPct + '%');
      await page.evaluate((p) => { const el = document.elementFromPoint(p.x, p.y); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y })); }, gm);
      await sleep(500);
      await shot('06b-封面墙点⋮.png');
      const menu = await page.evaluate(() => {
        const m = document.querySelector('.ctxmenu.on'); if (!m) return null;
        const r = m.getBoundingClientRect();
        return { items: [...m.querySelectorAll('.ctxi')].map((x) => (x.textContent || '').trim().slice(0, 10)),
          fits: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight };
      });
      if (!menu) F('bad', '6b 封面墙', '点 ⋮ 弹不出菜单（动作收进这里，弹不出等于片单不能操作）');
      else {
        if (!menu.fits) F('bad', '6b 封面墙', '⋮ 菜单超出屏幕', JSON.stringify(menu));
        if (!menu.items.some((t) => t.indexOf('标记下一集') >= 0)) F('bad', '6b 封面墙', '⋮ 菜单里没有「标记下一集已看」', menu.items.join('/'));
        else F('note', '6b 封面墙', '触点 ' + gm.w + '×' + gm.h + ' · 实心盖海报 ' + gm.discPct + '% · 每行 ' + gm.cols + ' 列 · 菜单项 ' + menu.items.join(' / '));
        await page.evaluate(() => { const m = document.querySelector('.ctxmenu'); if (m) m.classList.remove('on'); });
      }
    }

    /* ── 任务 7：键盘弹起来会不会把正在输入的框顶到看不见的地方 ── */
    await tap('#vList>.top button[aria-label="添加番剧"]');
    await page.focus('#qKw');
    /* 软键盘：把 visual viewport 高度压掉 45%，模拟 Android 输入法占屏 */
    await cdp.send('Emulation.setVisualViewportOverride', { width: VW, height: Math.round(VH * 0.55),
      offsetTop: 0, offsetLeft: 0, scale: 1, z: 1, clientWidth: VW, clientHeight: Math.round(VH * 0.55) }).catch(() => {});
    await page.setViewport({ width: VW, height: Math.round(VH * 0.55), deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
    await sleep(900);
    await shot('07-键盘弹起.png');
    const kb = await page.evaluate(() => {
      const el = document.activeElement; if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect(); const vv = window.visualViewport;
      return { id: el.id, top: Math.round(r.top), bottom: Math.round(r.bottom),
        vh: Math.round(window.innerHeight), vvH: vv ? Math.round(vv.height) : 0, visible: r.top >= 0 && r.bottom <= window.innerHeight };
    });
    if (kb && !kb.visible) F('mid', '7 键盘', '输入法弹起后正在输入的框被顶出可视区（要够着屏幕顶端才能看见）', JSON.stringify(kb));
    F('note', '7 键盘', '压到 55% 高时', JSON.stringify(kb));
    await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
    await sleep(500);

    /* ── 任务 8：片单一长，滚到底还能不能回到顶 / 还能不能加片 ── */
    await page.evaluate(() => {
      for (let i = 0; i < 26; i++) addShow({ sid: 'bulk-' + i, title: '长列表测试 ' + i, year: '2020', total: 12,
        cover: '/tracker-icon-512.png', eps: [] });
    });
    await sleep(900);
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(900);
    await shot('08-滚到底.png');
    const deep = await page.evaluate(() => {
      const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
        return { top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= window.innerHeight }; };
      const f = document.getElementById('fabAdd');
      const fr = f ? f.getBoundingClientRect() : null;
      const cs = f ? getComputedStyle(f) : null;
      return { scrollY: Math.round(window.scrollY), docH: document.body.scrollHeight,
        headAdd: q('.top button[aria-label="添加番剧"]'), stickyHead: q('.frow'),
        fab: f ? { on: f.classList.contains('on'), display: cs.display,
          w: Math.round(fr.width), h: Math.round(fr.height),
          inView: fr.top >= 0 && fr.bottom <= window.innerHeight && fr.left >= 0 && fr.right <= window.innerWidth,
          hitTest: (() => { const e = document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2);
            return !!(e && (e === f || f.contains(e))); })() } : null };
    });
    F('note', '8 深滚动', '滚到底时主操作在哪', JSON.stringify(deep));
    /* 筛选条深滚后在屏上是**有意为之**，不是缺陷：393 宽下它要占两行，连搜索框吸顶就是永久 161px（19% 屏幕），
       第二行只剩「弃 0」。所以只给主操作做悬浮钮，筛选回顶再点。这里只留观察，别哪天又被"顺手修好"。 */
    if (deep.stickyHead && !deep.stickyHead.inView)
      F('note', '8 深滚动', '筛选/搜索条深滚后回到顶部才看得见（权衡后的取舍，非缺陷）', JSON.stringify(deep.stickyHead));
    if (!deep.fab) F('mid', '8 深滚动', '手机端没有任何悬浮主操作，深滚后想加片得一路滑回顶部');
    else {
      if (!deep.fab.on) F('mid', '8 深滚动', '滚过一屏了但悬浮「＋」没出现', JSON.stringify(deep.fab));
      if (deep.fab.on && !deep.fab.inView) F('bad', '8 深滚动', '悬浮「＋」出现了却不在屏幕内', JSON.stringify(deep.fab));
      if (deep.fab.on && Math.min(deep.fab.w, deep.fab.h) < 44) F('bad', '8 深滚动', '悬浮「＋」小于 44px，拇指按不中', JSON.stringify(deep.fab));
      if (deep.fab.on && !deep.fab.hitTest) F('bad', '8 深滚动', '悬浮「＋」看得见却被别的东西盖住（点了没反应）', JSON.stringify(deep.fab));
    }
    /* 光「出现了」不算，得证明它真能把添加页拉开 */
    if (deep.fab && deep.fab.on && deep.fab.hitTest) {
      const before = await page.evaluate(() => document.getElementById('vAdd').style.display);
      await page.evaluate(() => { const f = document.getElementById('fabAdd'); const r = f.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }).then((p) => page.touchscreen.tap(p.x, p.y));
      await sleep(700);
      const after = await page.evaluate(() => ({ vAdd: document.getElementById('vAdd').style.display,
        fabOn: document.getElementById('fabAdd').classList.contains('on') }));
      if (after.vAdd === before) F('bad', '8 深滚动', '悬浮「＋」点下去没反应（开着却打不开添加页）', JSON.stringify({ before, after }));
      else if (after.fabOn) F('mid', '8 深滚动', '进了添加页悬浮「＋」还赖在屏幕上', JSON.stringify(after));
      await shot('08b-悬浮钮打开添加.png');
      await page.evaluate(() => backList());
      await sleep(500);
    }

    /* ── 任务 9：详情页 24 话滚到底，「移除」这种危险操作离常用操作多远 ── */
    await page.evaluate(() => { backList(); });
    await sleep(500);
    await page.evaluate(() => { const hit = window.shows.filter((s) => /Delicious|迷宫/.test((s.title || '') + ' ' + (s.aliases || []).join(' ')))[0];
      openDetail(hit ? hit.sid : window.shows[0].sid); });
    await sleep(1200);
    const danger = await page.evaluate(() => {
      const b = document.getElementById('delBtn')
        || [...document.querySelectorAll('#vDetail button')].find((x) => /移除/.test(x.textContent || ''));
      if (!b) return null; const r = b.getBoundingClientRect();
      return { text: (b.textContent || '').trim(), h: Math.round(r.height), w: Math.round(r.width), docH: document.body.scrollHeight };
    });
    if (danger && Math.min(danger.w, danger.h) < 44) F('mid', '9 危险操作', '"从片单移除"是全页最不可逆的一颗，触点却不到 44px', JSON.stringify(danger));
    /* 低频工具钮被挪到列表之后，得肉眼确认它们在尾部排得整齐、没和「移除」挤成一团 */
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(700);
    await shot('09-详情尾部工具.png');
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    const confirmNeeded = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#vDetail button')].find((x) => /移除/.test(x.textContent || ''));
      if (!b) return 'no-btn'; b.click(); return 'clicked';
    });
    await sleep(900);
    await shot('09b-点移除之后.png');
    if (confirmNeeded === 'clicked') {
      const stillThere = await page.evaluate(() => ({ panel: !!document.querySelector('.mask'),
        toast: (document.getElementById('toast') || {}).textContent || '' }));
      if (!stillThere.panel && !/确认|撤销|已移除/.test(stillThere.toast))
        F('bad', '9 危险操作', '手机上「从片单移除」点一下就真删了，既无确认也无撤销——误触直接丢数据', JSON.stringify(stillThere));
      await page.evaluate(() => { const m = document.querySelector('.mask'); if (m) { const n = [...m.querySelectorAll('button')].find((x) => /取消/.test(x.textContent || '')); if (n) n.click(); } });
    }

    /* ── 任务 10：返回手势到底退回哪一层 ──
       用户指令原文「返回是返回上一层，不要手指用全面屏手势自动退回到桌面」。
       壳（MainActivity）把 KEYCODE_BACK 交给 WebView 历史：canGoBack→goBack()。
       所以页面里 history.back() 就等于那一次手势——真手指在本机跑不了，这条路是等价替代。 */
    await sleep(400);
    const back = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const st = () => ({
        layers: (window.AT_LAYERS || []).length,
        view: document.getElementById('vDetail').style.display !== 'none' ? 'detail'
          : document.getElementById('vAdd').style.display !== 'none' ? 'add' : 'list',
        mask: !!document.querySelector('.mask'),
      });
      const sid = window.shows[0].sid;
      backList(); await wait(300);
      const root = st();
      openDetail(sid); await wait(350);
      const onDetail = st();
      uiConfirm('返回手势测试', function () { }); await wait(300);
      const withMask = st();
      history.back(); await wait(450);              /* 手势①：只该关掉弹窗 */
      const b1 = st();
      history.back(); await wait(450);              /* 手势②：详情回片单 */
      const b2 = st();
      /* 第三下不按了：根页没层可关时，壳的 canGoBack() 若还返回 true，就会走真历史（回上一页/重载）
         而不是退 App。这里改成读现场——回到初始那一格时 history.state 该是 null。 */
      const rootAgain = { layers: (window.AT_LAYERS || []).length, stateNull: history.state === null };
      /* 另一条路：用户点弹窗自己的「取消」——那格历史必须跟着补掉，
         否则下一次手势先吃掉一个空状态，手感就是「返回按了没反应」。 */
      openDetail(sid); await wait(350);
      uiConfirm('取消即补历史', function () { }); await wait(280);
      const selfBefore = st();
      const no = document.querySelector('#uiDlgMask #udNo');
      if (no) no.click();
      await wait(480);
      const selfClosed = st();
      history.back(); await wait(450);
      const selfBack = st();
      return { root, onDetail, withMask, b1, b2, rootAgain, selfBefore, selfClosed, selfBack, popstateBound: typeof atCloseTop === 'function' };
    });
    F('note', '10 返回手势', '各步状态', JSON.stringify(back));
    if (!back.popstateBound) F('bad', '10 返回手势', '页面里没有接管返回的层栈（手势一回退就直接退 App）');
    else {
      if (back.onDetail.layers < 1 || back.onDetail.view !== 'detail')
        F('bad', '10 返回手势', '打开详情没有压下一格可返回的层', JSON.stringify(back.onDetail));
      if (!back.withMask.mask) F('mid', '10 返回手势', '前提不成立：弹窗没开起来');
      if (back.b1.mask || back.b1.view !== 'detail')
        F('bad', '10 返回手势', '弹窗开着时回退，关掉的不是弹窗（或连详情一起退了）', JSON.stringify({ withMask: back.withMask, b1: back.b1 }));
      if (back.b2.view !== 'list' || back.b2.layers !== 0)
        F('bad', '10 返回手势', '详情页回退没回到片单（用户要点×才能出去）', JSON.stringify(back.b2));
      if (back.rootAgain.layers !== 0)
        F('bad', '10 返回手势', '回到片单后层栈没清空，多出来的那几格历史还会吃掉后续手势', JSON.stringify(back.rootAgain));
      if (!back.rootAgain.stateNull)
        F('bad', '10 返回手势', '片单根页上还留着 pushState 的历史格：返回键会后退真历史（重载/回上一屏）而不是退 App', JSON.stringify(back.rootAgain));
      if (back.selfClosed.mask) F('mid', '10 返回手势', '点「取消」后弹窗还在（非回退关闭失效）', JSON.stringify(back.selfClosed));
      if (back.selfBack.view !== 'list' || back.selfBack.layers !== 0)
        F('bad', '10 返回手势', '用「取消」关掉弹窗后再回退，先吃掉了一格空历史（手感＝返回失灵一次）',
          JSON.stringify({ selfClosed: back.selfClosed, selfBack: back.selfBack }));
    }

    /* ── 任务 11：后台自动任务会不会把用户自己的操作反馈顶掉 ──
       toast 只有一条通道。实测抓到过真的抢：双击标记后 1.2 秒（用户那条还没走完 2.2 秒寿命），
       屏上已经被换成「来源校准完成」这种和用户动作无关的话。
       规矩：toast(m,'bg') 不许顶掉正在显示的消息。这里直接验规则本身——
       按时间窗去猜「3 秒后又冒出一句什么」判不准（那时用户那条已自然过期，属正常播报，不该算缺陷）。 */
    const sem = await page.evaluate(() => {
      var g = () => { var t = document.getElementById('toast');
        return { text: t.textContent || '', on: t.classList.contains('on') }; };
      toast('用户操作回执·已看到第 8 集');
      var a = g();
      toast('后台自动补齐封面', 'bg');       /* 应让位，不许改屏 */
      var b = g();
      toast('另一条用户消息');               /* 用户消息之间该覆盖 */
      var c = g();
      return { a: a, b: b, c: c };
    });
    if (!(sem.a.on && /用户操作回执/.test(sem.a.text)))
      F('mid', '11 反馈被抢', '前提不成立：用户消息自己就没显示出来', JSON.stringify(sem));
    if (sem.b.text !== sem.a.text)
      F('bad', '11 反馈被抢', '后台播报（bg）顶掉了正在显示的用户回执——用户最后看到的一句不是自己动作的结果',
        '用户="' + sem.a.text + '" 被换成 "' + sem.b.text + '"');
    if (!/另一条用户消息/.test(sem.c.text))
      F('mid', '11 反馈被抢', '该覆盖时没覆盖，用户后一条消息被挡住了', JSON.stringify(sem.c));
    F('note', '11 反馈被抢', 'toast 优先级规则', 'bg 让位=' + (sem.b.text === sem.a.text) + ' · 用户可覆盖=' + /另一条/.test(sem.c.text));
    /* 顺带核后台链路：v2.17.0 起「开机自动校准」是离线扫表、根本不播报（改成播报就是留雷），
       联网重校只在「体检」面板由用户自己点，那句属于用户消息、允许覆盖。 */
    const tagged = await page.evaluate(() => {
      const src = [...document.querySelectorAll('script')].map((s) => s.textContent).join('\n');
      const boot = (src.match(/function calibrateAllLocal\(\)\{[\s\S]*?\n\}/) || [''])[0];
      return { cover: /已自动补齐[^\n]{0,40}'bg'/.test(src),
        bootFound: !!boot, bootQuiet: !!boot && !/toast\(/.test(boot) };
    });
    if (!tagged.cover) F('mid', '11 反馈被抢', '补封面是后台播报却没标 bg，将来还会顶掉用户反馈', JSON.stringify(tagged));
    if (!tagged.bootFound) F('mid', '11 反馈被抢', '找不到开机自动校准函数（后台链路改名了，这条断言失效）');
    else if (!tagged.bootQuiet) F('mid', '11 反馈被抢', '开机自动校准在播报，会顶掉用户刚拿到的回执', JSON.stringify(tagged));

    /* ── 任务 12：超长番（海贼王 1100 集）——这部 App 最狠的真实场景 ──
       翻页器、跨页标记、打开耗时，都是量版式看不出来的。 */
    await page.evaluate(() => {
      try { localStorage.clear(); } catch (e) {}
      window.shows = [];
      addShow({ sid: 'onek', title: '海贼王', year: '1999', total: 1100, cover: '/tracker-icon-512.png',
        eps: Array.from({ length: 1100 }, (_, i) => ({ s: i + 1, t: '第 ' + (i + 1) + ' 话' })) });
      renderList();
    });
    await sleep(700);
    const openMs = await page.evaluate(() => { const a = performance.now(); openDetail('onek'); return Math.round(performance.now() - a); });
    await sleep(1200);
    const long = await page.evaluate(() => {
      const rows = document.querySelectorAll('#dGroups [data-ep]').length;
      const pgs = [...document.querySelectorAll('#dGroups .pg, .pager .pg')];
      const small = pgs.filter((p) => { const r = p.getBoundingClientRect(); return Math.min(r.width, r.height) < 34; }).length;
      const last = pgs[pgs.length - 1];
      const nr = document.getElementById('nextBtn').getBoundingClientRect();
      return { rows, pages: pgs.length, small,
        lastPage: last ? (last.textContent || '').trim() : '', docH: document.body.scrollHeight,
        nextTop: Math.round(nr.top), nextBottom: Math.round(nr.bottom), vh: window.innerHeight,
        next: (document.getElementById('nextBtn') || {}).textContent || '' };
    });
    await shot('12-超长番1100集.png');
    if (!long.rows) F('bad', '12 超长番', '1100 集的番打开后一集都不显示', JSON.stringify(long));
    if (long.nextBottom > long.vh) F('bad', '12 超长番', '超长番打开后「标记下一集」也在首屏外', JSON.stringify(long));
    if (openMs > 1200) F('mid', '12 超长番', '打开超长番时同步渲染卡了 ' + openMs + 'ms（界面会明显顿一下）');
    if (long.small) F('mid', '12 超长番', '翻页按钮有 ' + long.small + ' 颗小于 34px，手机上够不着', JSON.stringify(long));
    F('note', '12 超长番', '同步渲染 ' + openMs + 'ms · 本页 ' + long.rows + ' 行 · 页码钮 ' + long.pages + ' 颗（末页标 ' + long.lastPage + '，翻页器上下各一份）· 文档高 ' + long.docH + ' · 「标记下一集」top ' + long.nextTop);
    /* 翻到最后一页，标记该页最后一集：跨页手势得能用（别硬写集号，末页是 1081–1100） */
    const cross = await page.evaluate(() => {
      const pgs = [...document.querySelectorAll('#dGroups .pg, .pager .pg')];
      const last = pgs[pgs.length - 1];
      if (!last) return { ok: false, why: '没有翻页按钮' };
      last.click(); return { ok: true, label: (last.textContent || '').trim() };
    });
    await sleep(1200);
    await shot('12b-超长番末页.png');
    const tail = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#dGroups [data-ep]')];
      if (!rows.length) return { n: 0 };
      const nums = rows.map((r) => +r.getAttribute('data-ep'));
      const max = Math.max.apply(null, nums);
      return { n: rows.length, max, first: Math.min.apply(null, nums) };
    });
    if (!tail.n) F('bad', '12 超长番', '翻到末页后一行都没有', JSON.stringify(cross));
    else {
      F('note', '12 超长番', '末页显示第 ' + tail.first + '–' + tail.max + ' 集（' + tail.n + ' 行）');
      await tapEl('#dGroups [data-ep="' + tail.max + '"]', 2);
      await sleep(900);
      const marked = await page.evaluate((m) => {
        const s = bySid('onek'); let w = 0;
        for (let i = 1; i <= 1100; i++) if ((s.statuses || {})[i] === 'watched') w++;
        return { w, toast: (document.getElementById('toast') || {}).textContent || '',
          next: (document.getElementById('nextBtn') || {}).textContent || '' };
      }, tail.max);
      if (marked.w < tail.max - 1) F('bad', '12 超长番', '末页双击第 ' + tail.max + ' 集没把进度记上（跨页手势失效）', JSON.stringify({ marked, tail }));
      F('note', '12 超长番', '末页双击第 ' + tail.max + ' 集后：已看 ' + marked.w + ' 集 · ' + marked.toast);
      await shot('12c-超长番跨页标记.png');
    }

    const perr = errs.filter((e) => e.indexOf('pageerror:') === 0);
    if (perr.length) F('bad', '全程', '跑这一趟抛了 JS 错', perr.slice(0, 3).join(' || '));

    const bad = findings.filter((f) => f.level === 'bad');
    const mid = findings.filter((f) => f.level === 'mid');
    console.log('\n=== 手机「用起来」走查 ' + VW + '×' + VH + ' ===');
    /* 逐条已经在跑的时候打过了（防崩），收尾只回读「要改的那几颗」，别再整份重抄一遍 */
    bad.concat(mid).forEach((f) => console.log('  [' + f.level.toUpperCase() + '] ' + f.task + ' · ' + f.what + (f.detail ? '\n        ' + f.detail : '')));
    console.log('\n截图 ' + shots.length + ' 张 → ' + OUT);
    console.log('SUMMARY: ' + (bad.length || mid.length ? 'BAD ' + bad.length + ' · MID ' + mid.length : '没发现影响使用的问题'));
    fs.writeFileSync(path.join(OUT, 'use-findings.json'), JSON.stringify({ findings, errs, shots }, null, 2));
    process.exitCode = bad.length ? 1 : 0;
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
