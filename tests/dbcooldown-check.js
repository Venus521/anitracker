/* tests/dbcooldown-check.js —— 「限流 ≠ 查不到」门禁（v2.46.2）
   他第三轮说的是「还是老问题」，一次点了三个：剧还是重复 / 封面还是没有 / 时长还是不对。
   查下来后两个是同一条根因，而且**是静默的**：

     豆瓣那边一 403，云函数就进 45 秒冷却；老代码里 `note403()` 是
     「每来一个 403 就把冷却再推 45 秒」——流量不断就**永远出不来**
     （2026-10-08 23:2x 实测：连打三轮 info，前两轮 cooling down，第三轮才通）。
     而客户端这边，`dbInfo` 把 `found:false` **一律写进负缓存**，`_durAutoSeen` 也照记
     「这部已经试过」；封面那边 503 与 404 同样待遇 → `coverMark(false)` 锁 2 小时。
     于是：**豆瓣那 45 秒的限流，被他记成了「这部剧天生没有时长 / 没有封面」**，
     整个会话、乃至两小时之内再也不问。他看到的就是「时长一直是估的、封面一直灰着」。

   本门禁守「限流必须留后路」，每条都对着上面那个真身：
     L01 撞限流 → 不写负缓存：冷却过去后同一部能补上真值
     L02 真查不到 → 才写死：第二次连问都不问（请求计数 = 1）
     L03 冷却期内开详情页 → 不落「已试过」的账：冷却结束后自动再取一次
     L04 封面撞 503 → 认出是限流（dbCooling 为真），退避只歇 5 分钟而不是 2 小时
     L05 一键拉封面撞冷却 → 停下整轮并明说，**不把剩余条目锁进 2 小时退避表**
     L06 片单里有重复 → 横幅把话说出来（原来只有一枚要靠猜的小图标）
     E00 全程无页面级 JS 错误

   量具：fetch 换成可判的替身（info 应答 / 503 应答随手切换），其余请求照旧 abort。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'tests', '_artifacts', 'dbcooldown');
const PORT = 8195;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (ok ? '' : '  :: ' + String(detail).slice(0, 340)));
  ok ? pass++ : fail++;
}
function probePort(port) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/index.html', timeout: 1500 },
      (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probePort(PORT)) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const PAGE = process.env.AT_PAGE || 'index.html';
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/^https?:\/\/127\.0\.0\.1/.test(u) || /^data:/.test(u)) return req.continue();
      return req.abort();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);

    /* 装替身：只接管豆瓣中转那两条路，其余照旧（照旧的那部分会被 request interception 掐掉） */
    const stubbed = await page.evaluate(() => {
      window.AT_NO_AUTODUR = true;
      window.__orig = window.fetch.bind(window);
      window.__calls = [];
      window.__infoResp = { found: false, reason: 'cooling down', limited: true, coolMs: 45000 };
      window.__cover503 = false;
      window.__toasts = [];
      window.toast = function (t) { window.__toasts.push(String(t || '')); };
      window.fetch = async function (u, o) {
        const s = String(u || '');
        window.__calls.push(s);
        if (s.indexOf('mode=info') >= 0) {
          return { ok: true, status: 200, json: async () => window.__infoResp };
        }
        if (s.indexOf('douban-relay') >= 0 && s.indexOf('mode=') < 0 && window.__cover503) {
          return { ok: false, status: 503,
            json: async () => ({ error: 'douban rate limited', coolMs: 45000 }),
            blob: async () => new Blob([]) };
        }
        return window.__orig(u, o);
      };
      return { hasInfo: typeof window.dbInfo, hasCool: typeof window.dbCooling, hasMark: typeof window.coverMark };
    });
    check('L00', '三个入口都挂得上（dbInfo / dbCooling / coverMark）；负测时没有就该红不该崩',
      stubbed.hasInfo === 'function' && stubbed.hasCool === 'function' && stubbed.hasMark === 'function',
      JSON.stringify(stubbed));

    const seed = (title, extra) => page.evaluate((f) => {
      window.shows = [{ sid: 'l-' + Math.random().toString(36).slice(2, 7), title: f.t, kind: '',
        total: f.total || 52, year: f.year || '2005', eps: [], statuses: {},
        addedAt: Date.now(), updAt: Date.now(), epDur: 0 }];
      return window.shows[0].sid;
    }, { t: title, total: (extra && extra.total) || 52, year: (extra && extra.year) || '2005' });

    /* L01 · 撞限流不写负缓存：同一部稍后再问，能补上真值 */
    await seed('大宋提刑官');
    const l1 = await page.evaluate(async () => {
      if (typeof window.dbInfo !== 'function' || typeof window.dbCooling !== 'function') return { miss: true };
      window.__calls = [];
      window.__infoResp = { found: false, reason: 'cooling down', limited: true, coolMs: 45000 };
      const a = await window.dbInfo('大宋提刑官');
      const cooling = window.dbCooling();
      /* 冷却过去：同一部再问一次（这回给真值） */
      window._dbCoolUntil = 0;
      window.__infoResp = { found: true, title: '大宋提刑官', id: '2239292', type: 'tv', dur: 45,
        eps: 52, genres: ['剧情'], year: '2005', cover: '' };
      const b = await window.dbInfo('大宋提刑官');
      return { a: a, cooling: cooling, b: b, n: window.__calls.length };
    });
    check('L01', '撞限流（limited:true）不写负缓存：冷却过去后同一部能补上真值 45 分',
      l1.a === null && l1.cooling === true && l1.b && l1.b.dur === 45 && l1.n === 2,
      JSON.stringify(l1));

    /* L02 · 真查不到才写死：第二次连问都不问 */
    const l2 = await page.evaluate(async () => {
      if (typeof window.dbInfo !== 'function') return { miss: true };
      window.__calls = [];
      window.__infoResp = { found: false, reason: 'no subject for 真没有这部剧' };
      const a = await window.dbInfo('真没有这部剧');
      const b = await window.dbInfo('真没有这部剧');
      return { a: a, b: b, n: window.__calls.length };
    });
    check('L02', '真查不到才写死负缓存：第二次直接取缓存，一个请求都不发',
      l2.a === null && l2.b === null && l2.n === 1, JSON.stringify(l2));

    /* L03 · 冷却期内开详情页：不落「已试过」的账，冷却结束后自动再取一次 */
    /* 年份要对得上（同年卫兵：差 >1 年不认），种子带了 2023 */
    await seed('漫长的季节', { total: 12, year: '2023' });
    const l3 = await page.evaluate(async () => {
      const s = window.shows[0];
      if (typeof window._autoDurFor !== 'function') return { miss: true };
      window._dbCoolUntil = Date.now() + 3000;         /* 正在冷却 */
      window._durAutoSeen = {};
      window.__infoResp = { found: false, reason: 'cooling down', limited: true, coolMs: 3000 };
      window._autoDurFor(s.sid);                       /* 冷却期内那一次：不许记账 */
      const seenDuringCool = !!window._durAutoSeen[String(s.sid)];
      /* 手动等冷却过去再走一遍（门禁不等真 3 秒：直接把冷却清零再调） */
      window._dbCoolUntil = 0;
      window.__infoResp = { found: true, title: '漫长的季节', id: '35588177', type: 'tv', dur: 60,
        eps: 12, genres: ['剧情'], year: '2023', cover: '' };
      if (typeof window.healDurFor === 'function') await window.healDurFor(s, { save: false, silent: true });
      return { seenDuringCool: seenDuringCool, epDur: Number(s.epDur) || 0, from: String(s.epDurFrom || '') };
    });
    check('L03', '冷却期内不落「这部已经试过」的账；冷却结束后自动补上真值 60 分',
      l3.seenDuringCool === false && l3.epDur === 60 && l3.from === 'db', JSON.stringify(l3));

    /* L04 · 封面 503 = 限流：认出来（dbCooling 真），且退避是 5 分钟不是 2 小时 */
    const l4 = await page.evaluate(async () => {
      window._dbCoolUntil = 0;
      window.__cover503 = true;
      if (typeof window.doubanRelayCover !== 'function') return { miss: true };
      await window.doubanRelayCover('大宋提刑官', '2239292');
      const cooling = window.dbCooling();
      const sid = 'l4-soft';
      window.coverMark(sid, false, true);              /* 撞限流的失败 */
      const soft = window.coverCanAuto({ sid: sid });
      /* 把时间往前拨 6 分钟，看它是不是已经可以重来（2 小时那条永远不会） */
      const m = JSON.parse(localStorage.getItem('at_cover_try') || '{}');
      m[sid].at = Date.now() - 6 * 60 * 1000;
      localStorage.setItem('at_cover_try', JSON.stringify(m));
      const softAfter6m = window.coverCanAuto({ sid: sid });
      window.coverMark('l4-hard', false, false);       /* 真没封面 */
      const hardAfter6m = window.coverCanAuto({ sid: 'l4-hard' });
      window.__cover503 = false;
      return { cooling: cooling, soft: soft, softAfter6m: softAfter6m, hardAfter6m: hardAfter6m };
    });
    check('L04', '封面撞 503：认出是限流（dbCooling 真），退避只歇 5 分钟（6 分钟后可重试）；真没封面仍锁 2 小时',
      l4.cooling === true && l4.soft === false && l4.softAfter6m === true && l4.hardAfter6m === false,
      JSON.stringify(l4));

    /* L05 · 一键拉封面撞冷却：停下整轮并明说，不把条目锁死 */
    const l5 = await page.evaluate(async () => {
      window.shows = [];
      for (let i = 0; i < 3; i++) window.shows.push({ sid: 'l5-' + i, title: '补封面的剧' + i,
        total: 12, eps: [], statuses: {}, addedAt: Date.now(), updAt: Date.now() });
      try { localStorage.removeItem('at_cover_try'); } catch (e) {}
      window.__toasts = [];
      window.__cover503 = true;
      window._dbCoolUntil = Date.now() + 45000;        /* 正在冷却 */
      window._coverHealRunning = false;
      if (typeof window.coverHealAll !== 'function') return { miss: true };
      await window.coverHealAll(true, 3);
      const said = window.__toasts.filter((t) => t.indexOf('限流') >= 0);
      /* 关键：被跳过的那几部不许进 2 小时退避表 */
      const m = JSON.parse(localStorage.getItem('at_cover_try') || '{}');
      const locked = Object.keys(m).filter((k) => k.indexOf('l5-') === 0 && !m[k].soft);
      window.__cover503 = false; window._dbCoolUntil = 0;
      return { said: said, locked: locked, keys: Object.keys(m).filter((k) => k.indexOf('l5-') === 0) };
    });
    check('L05', '一键拉封面撞冷却：明说「豆瓣正在限流，已停下」，且不把任何一部锁进 2 小时退避表',
      l5.said && l5.said.length > 0 && l5.locked && l5.locked.length === 0, JSON.stringify(l5));
    console.log('INFO L05 说的是：' + String((l5.said && l5.said[0]) || '').slice(0, 160));

    /* L06 · 片单里有重复：横幅把话说出来 */
    const l6 = await page.evaluate(() => {
      window.shows = [
        { sid: 'l6a', title: '海贼王', nameJp: 'ONE PIECE', total: 1122, eps: [], statuses: {}, addedAt: Date.now(), updAt: Date.now() },
        { sid: 'l6b', title: 'One Piece', total: 1122, eps: [], statuses: {}, addedAt: Date.now(), updAt: Date.now() }
      ];
      window._dupCache = { at: 0, groups: null };
      try { window.renderList(); } catch (e) {}
      try { window.renderSrcBar(); } catch (e) {}
      const b = document.getElementById('dupBar');
      return { vis: !!(b && b.style.display !== 'none'), txt: b ? String(b.textContent || '').replace(/\s+/g, ' ').trim() : '',
        btn: !!(b && b.querySelector('button')) };
    });
    check('L06', '检出重复时横幅可见、写明条数、带一颗能点的「看看是哪几组」',
      l6.vis === true && /1/.test(l6.txt) && l6.btn === true, JSON.stringify(l6));
    console.log('INFO L06 横幅写的是：' + String(l6.txt).slice(0, 160));

    check('E00', '全程无页面级 JS 错误', errs.length === 0, errs.join(' | '));
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log('\nGATES ' + (fail ? 'RED' : 'ALL GREEN') + ' pass=' + pass + ' fail=' + fail + '  artifacts=' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH ' + String(e)); process.exit(2); });
