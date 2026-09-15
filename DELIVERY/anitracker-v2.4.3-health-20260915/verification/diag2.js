/* 诊断 2：复现"空条目→点横幅自动拉取剧集"用户路径 + 后续标记进度，记录全链路网络事件 */
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

  page.on('console', m => { if (['error','warning'].includes(m.type())) rec({ t:'console', type:m.type(), text:m.text().slice(0,300) }); });
  page.on('pageerror', e => rec({ t:'pageerror', text:String(e).slice(0,400) }));
  page.on('request', r => { const u=r.url(); if(/bgm\.tv|cors\.sh|codetabs|proxy/i.test(u)) rec({ t:'req', url:u.slice(0,220), method:r.method() }); });
  page.on('response', r => { const u=r.url(); if(/bgm\.tv|cors\.sh|codetabs|proxy/i.test(u)) rec({ t:'res', url:u.slice(0,220), status:r.status() }); });
  page.on('requestfailed', r => { const u=r.url(); if(/bgm\.tv|cors\.sh|codetabs|proxy/i.test(u)) rec({ t:'reqfail', url:u.slice(0,220), err:(r.failure()&&r.failure().errorText)||'?' }); });

  // 1) 打开页面并写入种子数据（模拟用户被导入的空条目，已关联 Bangumi 328609）
  await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    const shows = [
      { sid:'bili-test-001', title:'测试空条目（已关联 Bangumi）', nameJp:'', cover:'', year:'2022',
        total:0, eps:[], statuses:{}, status:'watching', addedAt: Date.now(), updAt: Date.now(),
        source:'B站追番导入', bgmId:'328609' }
    ];
    localStorage.setItem('tr_shows', JSON.stringify(shows));
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  rec({ t:'note', text:'page loaded with seeded data' });
  await page.screenshot({ path: path.join(OUT, 'diag2-1-list.png') });

  // 2) 打开详情（走真实入口函数）
  await page.evaluate(() => openDetail('bili-test-001'));
  await sleep(900);
  const banner = await page.evaluate(() => { const nb=document.getElementById('nextBtn'); return nb? { text:nb.textContent, disabled:nb.disabled } : null; });
  rec({ t:'banner', banner });
  await page.screenshot({ path: path.join(OUT, 'diag2-2-detail-empty.png') });

  // 3) 点击横幅 → 拉取剧集（观察最长 120 秒）
  rec({ t:'note', text:'clicking banner...' });
  await page.click('#nextBtn');
  let pullResult = null;
  for (let w = 0; w <= 120; w += 1) {
    await sleep(1000);
    const st = await page.evaluate(() => {
      const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'bili-test-001') : null;
      const tEl = document.getElementById('toast');
      return {
        eps: s ? (s.eps || []).length : -1,
        total: s ? s.total : -1,
        toast: tEl ? (tEl.classList.contains('on') ? tEl.textContent : '') : '',
        directState: (typeof _directState !== 'undefined') ? _directState : 'undef',
        nb: (document.getElementById('nextBtn') || {}).textContent || ''
      };
    });
    if (st.eps > 0) { pullResult = st; rec({ t:'pull-success', waited:w, st }); break; }
    if (/失败/.test(st.toast)) { pullResult = st; rec({ t:'pull-fail-toast', waited:w, st }); break; }
    if (w % 15 === 0) rec({ t:'progress', waited:w, st });
  }
  await page.screenshot({ path: path.join(OUT, 'diag2-3-after-pull.png') });

  // 4) 若拉取成功：测试标记第 1 集已看，然后刷新页面确认持久化
  let markResult = null;
  if (pullResult && pullResult.eps > 0) {
    markResult = await page.evaluate(async () => {
      try {
        const s = shows.find(x => x.sid === 'bili-test-001');
        setEpStat(s, 1, 'watched'); save(); renderDetail();
        await new Promise(r => setTimeout(r, 400));
        const s2 = shows.find(x => x.sid === 'bili-test-001');
        return { marked: (s2.statuses||{})['1'], epCount: (s2.eps||[]).length };
      } catch (e) { return { err: String(e) }; }
    });
    rec({ t:'mark', markResult });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'diag2-4-after-mark.png') });

    // reload → check persistence
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1200);
    const persist = await page.evaluate(() => {
      const s = (typeof shows !== 'undefined') ? shows.find(x => x.sid === 'bili-test-001') : null;
      return s ? { eps:(s.eps||[]).length, marked:(s.statuses||{})['1'], total:s.total } : null;
    });
    rec({ t:'persist-after-reload', persist });
    await page.screenshot({ path: path.join(OUT, 'diag2-5-after-reload.png') });
  }

  const summary = {
    startedAt: new Date(t0).toISOString(),
    banner, pullResult, markResult: markResult || null,
    eventCount: events.length,
    events
  };
  fs.writeFileSync(path.join(OUT, 'diag2-result.json'), JSON.stringify(summary, null, 2));
  console.log('=== DIAG2 DONE ===');
  console.log(JSON.stringify({ banner, pullResult, markResult }, null, 2));
  await browser.close();
})().catch(e => { console.error('DIAG2 ERROR:', e); process.exit(1); });
