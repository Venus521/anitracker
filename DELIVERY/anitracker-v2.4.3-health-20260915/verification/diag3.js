/* 诊断 3：错误路径 —— 模拟 api.bgm.tv 被阻断（Clash 关闭场景），观察点横幅后的真实行为与恢复能力 */
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
  const events = [];
  const t0 = Date.now();
  const rec = o => { o.dt = Date.now() - t0; events.push(o); };

  // 注意：requestfailed 事件在拦截 abort 时未必触发，我们也记录 console 信息
  page.on('console', m => { if (['error','warning'].includes(m.type())) rec({ t:'console', type:m.type(), text:m.text().slice(0,300) }); });
  page.on('pageerror', e => rec({ t:'pageerror', text:String(e).slice(0,400) }));

  await page.setRequestInterception(true);
  let blockBgm = true, blockProxies = true;
  page.on('request', req => {
    const u = req.url();
    if (blockBgm && /api\.bgm\.tv|bgm\.tv|lain\.bgm\.tv/.test(u)) { rec({ t:'blocked-bgm', url:u.slice(0,180) }); return req.abort('connectionrefused'); }
    if (blockProxies && /proxy\.cors\.sh|codetabs\.com/.test(u)) { rec({ t:'blocked-proxy', url:u.slice(0,180) }); return req.abort('connectionrefused'); }
    req.continue();
  });

  // 1) 打开页面，种入空条目
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    const shows = [
      { sid:'bili-test-err', title:'错误路径测试条目', nameJp:'', cover:'', year:'2022', total:0, eps:[], statuses:{}, status:'watching', addedAt: Date.now(), updAt: Date.now(), source:'B站追番导入', bgmId:'328609' }
    ];
    localStorage.setItem('tr_shows', JSON.stringify(shows));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => openDetail('bili-test-err'));
  await sleep(600);

  // 2) 阻断网络下点击横幅 → 记录 120 秒内的行为（含 toast 时间线）
  rec({ t:'note', text:'click banner with ALL bgm+proxy blocked' });
  const before = Date.now();
  await page.click('#nextBtn');
  let toastTimeline = [], lastToast = '';
  let outcomeA = null;
  for (let w = 0; w <= 75; w++) {
    await sleep(1000);
    const st = await page.evaluate(() => {
      const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'bili-test-err') : null;
      const tEl = document.getElementById('toast');
      return { eps: s ? (s.eps || []).length : -1, toast: tEl ? (tEl.classList.contains('on') ? tEl.textContent : '') : '', directState: (typeof _directState !== 'undefined') ? _directState : 'undef' };
    });
    if (st.toast && st.toast !== lastToast) { toastTimeline.push({ at: w, toast: st.toast }); lastToast = st.toast; }
    if (/失败/.test(st.toast) && w > 3) { outcomeA = { waited: w, st }; break; }
    if (w === 75) outcomeA = { waited: w, st, note: 'still no fail toast after 75s' };
  }
  rec({ t:'outcome-blocked', outcomeA, toastTimeline });
  await page.screenshot({ path: path.join(OUT, 'diag3-1-blocked-fail.png') });

  // 3) 解除阻断，不刷新，直接再点一次横幅 → 观察是否能恢复
  blockBgm = false; blockProxies = false;
  rec({ t:'note', text:'unblock; click banner again WITHOUT reload (retry path)' });
  const t1 = Date.now();
  await page.click('#nextBtn');
  let outcomeB = null;
  for (let w = 0; w <= 90; w++) {
    await sleep(1000);
    const st = await page.evaluate(() => {
      const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'bili-test-err') : null;
      const tEl = document.getElementById('toast');
      return { eps: s ? (s.eps || []).length : -1, toast: tEl ? (tEl.classList.contains('on') ? tEl.textContent : '') : '', directState: (typeof _directState !== 'undefined') ? _directState : 'undef' };
    });
    if (st.eps > 0) { outcomeB = { waited: w, st, recovered: true }; break; }
    if (/失败/.test(st.toast) && w > 3) { outcomeB = { waited: w, st, recovered: false }; break; }
    if (w === 90) outcomeB = { waited: w, st, note: 'no terminal state after 90s' };
  }
  rec({ t:'outcome-retry-after-unblock', outcomeB, elapsedMs: Date.now() - t1 });
  await page.screenshot({ path: path.join(OUT, 'diag3-2-retry-after-unblock.png') });

  const summary = { startedAt: new Date(t0).toISOString(), outcomeA, outcomeB, toastTimeline, eventCount: events.length, events };
  fs.writeFileSync(path.join(OUT, 'diag3-result.json'), JSON.stringify(summary, null, 2));
  console.log('=== DIAG3 DONE ===');
  console.log(JSON.stringify({ outcomeA, outcomeB, toastTimeline }, null, 2));
  await browser.close();
})().catch(e => { console.error('DIAG3 ERROR:', e); process.exit(1); });
