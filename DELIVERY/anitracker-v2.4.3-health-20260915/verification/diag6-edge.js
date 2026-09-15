/* 诊断 6：异常路径套件 —— 双击防重/手动编辑/移除/超时模拟/刷新中断/无参数/版本行 */
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

  const consoleErrs = [], pageErrs = [], badResp = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push({ text: m.text().slice(0, 250) }); });
  page.on('pageerror', e => pageErrs.push(String(e).slice(0, 400)));
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('192.0.2.1')) badResp.push({ url: r.url().slice(0, 180), status: r.status() }); });

  let mode = 'off';            // off | refuse | unroutable
  let subjectReqs = 0, epReqs = 0;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (mode !== 'off' && /api\.bgm\.tv|proxy\.cors\.sh|codetabs/.test(u)) {
      if (mode === 'refuse') return req.abort('connectionrefused');
      if (mode === 'unroutable') return req.continue({ url: 'http://192.0.2.1:81/' });
    }
    if (u.includes('/subjects/')) subjectReqs++;
    if (u.includes('/episodes?subject_id=')) epReqs++;
    req.continue();
  });

  const out = {};

  // ========== Part A: 双击防重复拉取 ==========
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => {
    localStorage.setItem('tr_shows', JSON.stringify([{ sid: 'dbl-test', title: '双击防护测试', nameJp: '', cover: '', year: '2022', total: 0, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: 'B站追番导入', bgmId: '328609' }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => openDetail('dbl-test'));
  await sleep(500);
  subjectReqs = 0; epReqs = 0;
  await page.click('#nextBtn').catch(() => {});
  await page.click('#nextBtn').catch(() => {});
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const eps = await page.evaluate(() => { const s = shows.find(x => x.sid === 'dbl-test'); return s ? (s.eps || []).length : -1; });
    if (eps > 0) break;
  }
  out.partA = await page.evaluate(() => { const s = shows.find(x => x.sid === 'dbl-test'); return { eps: s ? (s.eps || []).length : -1 }; });
  out.partA.subjectReqs = subjectReqs;
  out.partA.episodeReqs = epReqs;
  out.partA.singlePull = subjectReqs === 1 && out.partA.eps === 16;
  await page.screenshot({ path: path.join(OUT, 'diag6-A-double-click.png') });

  // ========== Part B: 手动编辑集数（有效 24 / 非法 abc / 取消 null） ==========
  await page.evaluate(() => {
    window.__pq = [];
    const orig = window.prompt;
    window.__origPrompt = orig;
    window.prompt = function () { return window.__pq.length ? window.__pq.shift() : null; };
  });
  await page.evaluate(() => { window.__pq = ['24']; editTotal(); });
  await sleep(400);
  const b1 = await page.evaluate(() => { const s = shows.find(x => x.sid === 'dbl-test'); return s ? s.total : -1; });
  await page.evaluate(() => { window.__pq = ['abc']; editTotal(); });
  await sleep(300);
  const b2 = await page.evaluate(() => { const s = shows.find(x => x.sid === 'dbl-test'); return s ? s.total : -1; });
  await page.evaluate(() => { window.__pq = [null]; editTotal(); });
  await sleep(300);
  const b3 = await page.evaluate(() => { const s = shows.find(x => x.sid === 'dbl-test'); return s ? s.total : -1; });
  out.partB = { after24: b1, afterAbc: b2, afterCancel: b3, ok: b1 === 24 && b2 === 24 && b3 === 24 };
  await page.screenshot({ path: path.join(OUT, 'diag6-B-edit-total.png') });

  // ========== Part C: 从片单移除 ==========
  await page.evaluate(() => { window.confirm = () => true; });
  const cntBefore = await page.evaluate(() => shows.length);
  await page.evaluate(() => delShow());
  await sleep(600);
  const cntAfter = await page.evaluate(() => shows.length);
  const backAtList = await page.evaluate(() => document.getElementById('vList').style.display !== 'none');
  out.partC = { before: cntBefore, after: cntAfter, backAtList, ok: cntAfter === cntBefore - 1 && backAtList };
  await page.screenshot({ path: path.join(OUT, 'diag6-C-removed.png') });

  // ========== Part D: 超时模拟（不可路由地址，测有界失败） ==========
  await page.evaluate(() => {
    localStorage.setItem('tr_shows', JSON.stringify([{ sid: 'timeout-test', title: '超时模拟测试', nameJp: '', cover: '', year: '2022', total: 0, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: 'B站追番导入', bgmId: '328609' }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => openDetail('timeout-test'));
  await sleep(500);
  mode = 'unroutable';
  const d0 = Date.now();
  await page.click('#nextBtn');
  let dToast = null;
  for (let i = 0; i < 160; i++) {
    await sleep(250);
    const t = await page.evaluate(() => { const tEl = document.getElementById('toast'); return tEl && tEl.classList.contains('on') ? tEl.textContent : ''; });
    if (t && t.indexOf('失败') >= 0) { dToast = t; break; }
  }
  out.partD = { elapsedMs: Date.now() - d0, toast: dToast, bounded: (Date.now() - d0) < 45000 };
  mode = 'off';
  await page.screenshot({ path: path.join(OUT, 'diag6-D-timeout.png') });

  // ========== Part E: 拉取中途刷新 ==========
  await page.evaluate(() => {
    localStorage.setItem('tr_shows', JSON.stringify([{ sid: 'interrupt-test', title: '中断测试', nameJp: '', cover: '', year: '2022', total: 0, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: 'B站追番导入', bgmId: '328609' }]));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => openDetail('interrupt-test'));
  await sleep(500);
  await page.click('#nextBtn');
  await sleep(300);
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  const midState = await page.evaluate(() => { const s = shows.find(x => x.sid === 'interrupt-test'); return s ? { eps: (s.eps || []).length, hasStatuses: !!s.statuses && typeof s.statuses === 'object' } : null; });
  // 若中断导致未完成，再点一次确认可继续
  if (midState && midState.eps === 0) {
    await page.evaluate(() => openDetail('interrupt-test'));
    await sleep(400);
    await page.click('#nextBtn');
    for (let i = 0; i < 80; i++) { await sleep(250); const eps = await page.evaluate(() => { const s = shows.find(x => x.sid === 'interrupt-test'); return s ? (s.eps || []).length : -1; }); if (eps > 0) break; }
  }
  out.partE = await page.evaluate(() => { const s = shows.find(x => x.sid === 'interrupt-test'); return { midEps: null, finalEps: s ? (s.eps || []).length : -1, sidOk: !!s, statusesOk: !!s && !!s.statuses }; });
  out.partE.midEps = midState ? midState.eps : null;
  out.partE.ok = out.partE.finalEps === 16 && out.partE.statusesOk;
  await page.screenshot({ path: path.join(OUT, 'diag6-E-interrupt.png') });

  // ========== Part F: 无参数加载 ==========
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  out.partF = await page.evaluate(() => ({ ver: AT_VERSION, build: AT_BUILD, listOk: !!document.querySelector('.show') }));
  await page.screenshot({ path: path.join(OUT, 'diag6-F-noparam.png') });

  // ========== Part G: 同步中心版本行 ==========
  try {
    await page.evaluate(() => { try { openSync('bgm'); } catch (e) { window.__syncErr = String(e); } });
    await sleep(2000);
    out.partG = await page.evaluate(() => ({
      maskShown: !!(document.getElementById('syncMask') && document.getElementById('syncMask').style.display !== 'none'),
      verLine: (document.getElementById('verLine') || {}).textContent || null,
      syncErr: window.__syncErr || null
    }));
    await page.screenshot({ path: path.join(OUT, 'diag6-G-sync.png') });
  } catch (e) { out.partG = { err: String(e) }; }

  const summary = { out, consoleErrors: consoleErrs, pageErrors: pageErrs, badResponses: badResp };
  fs.writeFileSync(path.join(OUT, 'diag6-result.json'), JSON.stringify(summary, null, 2));
  console.log('=== DIAG6 DONE ===');
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch(e => { console.error('DIAG6 ERROR:', e); process.exit(1); });
