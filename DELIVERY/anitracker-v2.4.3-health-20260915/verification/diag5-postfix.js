/* 诊断 5（修复后总复验）：版本/控制台/SW缓存/正常拉取/错误路径恢复/标记持久化/刷新一致性 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\anitracker-health-20260914`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });

  const t0 = Date.now();
  const consoleErrs = [], pageErrs = [], badResp = [], reqFails = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push({ text: m.text().slice(0, 300), dt: Date.now() - t0 }); });
  page.on('pageerror', e => pageErrs.push(String(e).slice(0, 400)));
  page.on('response', r => { if (r.status() >= 400) badResp.push({ url: r.url().slice(0, 200), status: r.status(), dt: Date.now() - t0 }); });
  page.on('requestfailed', r => reqFails.push({ url: r.url().slice(0, 200), err: (r.failure() || {}).errorText || '?', dt: Date.now() - t0 }));

  let blockAll = false;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (blockAll && /api\.bgm\.tv|bgm\.tv|proxy\.cors\.sh|codetabs/.test(u)) return req.abort('connectionrefused');
    req.continue();
  });

  // ============ Part 1: 首屏加载（带 v 参数） ============
  await page.goto('http://127.0.0.1:8089/index.html?v=375276448', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  const p1 = {};
  p1.state = await page.evaluate(async () => {
    let cachesKeys = [];
    try { cachesKeys = await caches.keys(); } catch (e) {}
    return {
      ver: (typeof AT_VERSION !== 'undefined') ? AT_VERSION : null,
      build: (typeof AT_BUILD !== 'undefined') ? AT_BUILD : null,
      faviconLink: !!document.querySelector('link[rel="icon"]'),
      swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      cachesKeys
    };
  });
  p1.faviconStatus = await page.evaluate(async () => { try { const r = await fetch('/favicon.ico', { cache: 'no-store' }); return r.status; } catch (e) { return String(e); } });
  await page.screenshot({ path: path.join(OUT, 'diag5-1-fresh.png') });

  // ============ Part 2: 正常拉取（含忙碌反馈采样） ============
  await page.evaluate(() => {
    localStorage.setItem('tr_shows', JSON.stringify([{ sid: 'post-test-1', title: '修复后测试条目', nameJp: '', cover: '', year: '2022', total: 0, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: 'B站追番导入', bgmId: '328609' }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => openDetail('post-test-1'));
  await sleep(600);
  const bannerBefore = await page.evaluate(() => (document.getElementById('nextBtn') || {}).textContent || '');
  const pullStart = Date.now();
  await page.click('#nextBtn');
  let busyFirst = null;
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    const st = await page.evaluate(() => {
      const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'post-test-1') : null;
      return { text: (document.getElementById('nextBtn') || {}).textContent || '', eps: s ? (s.eps || []).length : -1 };
    });
    if (!busyFirst && st.text.indexOf('正在拉取') >= 0) busyFirst = { at: Date.now() - pullStart, text: st.text };
    if (st.eps > 0) break;
  }
  await sleep(900);
  const p2 = await page.evaluate(() => {
    const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'post-test-1') : null;
    const tEl = document.getElementById('toast');
    return { eps: s ? (s.eps || []).length : -1, total: s ? s.total : -1, toast: tEl ? tEl.textContent : '', nb: (document.getElementById('nextBtn') || {}).textContent || '' };
  });
  p2.elapsedMs = Date.now() - pullStart;
  p2.busyFirst = busyFirst;
  p2.bannerBefore = bannerBefore;
  await page.screenshot({ path: path.join(OUT, 'diag5-2-pull-done.png') });

  // ============ Part 3: 标记 + 刷新持久化 ============
  await page.evaluate(() => { const s = shows.find(x => x.sid === 'post-test-1'); setEpStat(s, 1, 'watched'); save(); renderDetail(); });
  await sleep(400);
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  const p3 = await page.evaluate(() => { const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'post-test-1') : null; return s ? { marked: (s.statuses || {})['1'], eps: (s.eps || []).length } : null; });

  // ============ Part 4: 错误路径 + 无刷新恢复 ============
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('tr_shows'));
    list.push({ sid: 'err-test-2', title: '错误恢复测试条目', nameJp: '', cover: '', year: '2022', total: 0, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: 'B站追番导入', bgmId: '328609' });
    localStorage.setItem('tr_shows', JSON.stringify(list));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => openDetail('err-test-2'));
  await sleep(600);
  blockAll = true;
  const failStart = Date.now();
  await page.click('#nextBtn');
  let failToast = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const t = await page.evaluate(() => { const tEl = document.getElementById('toast'); return tEl && tEl.classList.contains('on') ? tEl.textContent : ''; });
    if (t && t.indexOf('失败') >= 0) { failToast = t; break; }
  }
  const failMs = Date.now() - failStart;
  await page.screenshot({ path: path.join(OUT, 'diag5-3-fail-blocked.png') });

  blockAll = false;
  const recStart = Date.now();
  await page.click('#nextBtn');
  let recOK = null;
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    const st = await page.evaluate(() => {
      const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'err-test-2') : null;
      const tEl = document.getElementById('toast');
      return { eps: s ? (s.eps || []).length : -1, toast: tEl && tEl.classList.contains('on') ? tEl.textContent : '' };
    });
    if (st.eps > 0) { recOK = { ok: true, ms: Date.now() - recStart, eps: st.eps }; break; }
    if (st.toast && st.toast.indexOf('失败') >= 0 && i > 4) { recOK = { ok: false, ms: Date.now() - recStart, toast: st.toast }; break; }
  }
  await page.screenshot({ path: path.join(OUT, 'diag5-4-recovered.png') });

  // ============ Part 5: 刷新一致性（普通/禁缓存） ============
  const p5 = {};
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 }); await sleep(1000);
  p5.normalReload = await page.evaluate(() => AT_VERSION);
  await page.setCacheEnabled(false);
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 }); await sleep(1000);
  await page.setCacheEnabled(true);
  p5.bypassReload = await page.evaluate(() => AT_VERSION);
  p5.serverVer = await page.evaluate(async () => { try { const r = await fetch('tracker-version.json?_=' + Date.now(), { cache: 'no-store' }); const j = await r.json(); return j.version; } catch (e) { return String(e); } });
  await page.screenshot({ path: path.join(OUT, 'diag5-5-final.png') });

  const summary = {
    startedAt: new Date(t0).toISOString(),
    part1: p1, part2: p2, part3: p3,
    part4: { failToast, failMs, recovery: recOK },
    part5: p5,
    consoleErrors: consoleErrs,
    pageErrors: pageErrs,
    badResponses: badResp,
    requestFailures: reqFails
  };
  fs.writeFileSync(path.join(OUT, 'diag5-result.json'), JSON.stringify(summary, null, 2));
  console.log('=== DIAG5 DONE ===');
  console.log(JSON.stringify({
    p1: { ver: p1.state.ver, build: p1.state.build, caches: p1.state.cachesKeys, favicon: p1.faviconStatus, consoleErrCount: consoleErrs.length },
    p2: { eps: p2.eps, ms: p2.elapsedMs, busyFirst },
    p3,
    p4: { failToast: (failToast || '').slice(0, 80), failMs, recovery: recOK },
    p5,
    badRespCount: badResp.length, reqFailCount: reqFails.length
  }, null, 2));
  await browser.close();
})().catch(e => { console.error('DIAG5 ERROR:', e); process.exit(1); });
