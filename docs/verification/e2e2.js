/* E2E-2 v2: Bangumi 同步链路（模拟 API + SW 旁路 + 事件式等待） */
const path = require('path');
const fs = require('fs');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const BASE = 'http://127.0.0.1:8091/index.html';
const SHOTS = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\shots`;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (extra ? ('  ' + extra) : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Content-Type': 'application/json'
};

const remote = {
  subj: {
    '901': { subject_id: 901, type: 3, rate: 0, ep_status: 3 },
    '902': { subject_id: 902, type: 3, rate: 0, ep_status: 1 }
  },
  eps: { '901': { 1001: 2, 1003: 2 }, '902': { 2001: 2 } },
  fail902: false
};
const log = { patches: [], puts: [], posts: [] };
let apiSeen = 0, apiMocked = 0;

function epsData(sid) {
  const base = (+sid === 901 ? 1000 : 2000);
  const data = [];
  for (let i = 1; i <= 12; i++) {
    const id = base + i;
    data.push({ episode: { id, sort: i, ep: i, name: 'ep' + i, name_cn: '' }, type: remote.eps[sid][id] || 0, updated_at: 0 });
  }
  return data;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=460,1000']
  });
  let failed = 0;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('dialog', async d => { try { await d.accept(); } catch (e) {} });

    // 拦截 API（先注册）
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      try {
        const u = req.url();
        if (!u.startsWith('https://api.bgm.tv/')) return req.continue();
        apiSeen++;
        if (req.method() === 'OPTIONS') { apiMocked++; return req.respond({ status: 204, headers: CORS, body: '' }); }
        const auth = req.headers()['authorization'] || '';
        if (auth !== 'Bearer TOKEN_OK') { apiMocked++; return req.respond({ status: 401, headers: CORS, body: JSON.stringify({ title: 'Unauthorized' }) }); }
        if (u === 'https://api.bgm.tv/v0/me') { apiMocked++; return req.respond({ status: 200, headers: CORS, body: JSON.stringify({ id: 1, username: 'tester' }) }); }
        let m;
        if ((m = u.match(/\/v0\/users\/-\/collections\/(\d+)\/episodes\?/))) {
          const sid = m[1]; apiMocked++;
          if (sid === '902' && remote.fail902) return req.respond({ status: 500, headers: CORS, body: '{"title":"boom"}' });
          return req.respond({ status: 200, headers: CORS, body: JSON.stringify({ total: 12, limit: 1000, offset: 0, data: epsData(sid) }) });
        }
        if ((m = u.match(/\/v0\/users\/-\/collections\/(\d+)\/episodes$/)) && req.method() === 'PATCH') {
          const sid = m[1]; apiMocked++;
          const body = JSON.parse(req.postData() || '{}');
          log.patches.push({ sid, body });
          (body.episode_id || []).forEach(id => { remote.eps[sid][id] = body.type; });
          return req.respond({ status: 204, headers: CORS, body: '' });
        }
        if ((m = u.match(/\/v0\/users\/-\/collections\/-\/episodes\/(\d+)$/))) {
          const eid = +m[1]; apiMocked++;
          const sid = (eid >= 2000 && eid < 3000) ? '902' : '901';
          const body = JSON.parse(req.postData() || '{}');
          log.puts.push({ eid, body });
          if (remote.eps[sid]) remote.eps[sid][eid] = body.type;
          return req.respond({ status: 204, headers: CORS, body: '' });
        }
        if ((m = u.match(/\/v0\/users\/-\/collections\/(\d+)$/))) {
          const sid = m[1]; apiMocked++;
          if (req.method() === 'GET') return req.respond({ status: 200, headers: CORS, body: JSON.stringify(remote.subj[sid]) });
          if (req.method() === 'POST') {
            const body = JSON.parse(req.postData() || '{}');
            log.posts.push({ sid, body });
            remote.subj[sid].type = body.type;
            if (body.rate !== undefined) remote.subj[sid].rate = body.rate;
            return req.respond({ status: 204, headers: CORS, body: '' });
          }
        }
        if ((m = u.match(/\/v0\/episodes\?subject_id=(\d+)/))) {
          const sid = m[1]; apiMocked++;
          const base = (+sid === 901 ? 1000 : 2000);
          const data = [];
          for (let i = 1; i <= 12; i++) data.push({ id: base + i, sort: i, ep: i, name: '', name_cn: '' });
          return req.respond({ status: 200, headers: CORS, body: JSON.stringify({ total: 12, limit: 100, offset: 0, data }) });
        }
        apiMocked++;
        return req.respond({ status: 404, headers: CORS, body: '{}' });
      } catch (e) {
        try { await req.continue(); } catch (e2) {}
      }
    });

    // 尝试旁路 SW（避免 SW 转发导致拦截失效）
    try { await page.setBypassServiceWorker(true); } catch (e) { console.log('bypassSW not available:', String(e).slice(0, 80)); }

    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(() => {
      const now = Date.now();
      const plain = n => { const a = []; for (let i = 1; i <= n; i++) a.push({ s: i, t: '第' + i + '集' }); return a; };
      const shows = [
        { sid: '901', bgmId: '901', title: '测试混合番', total: 12, status: 'watching', type: 'manga-adapt',
          statuses: { 1: 'watched', 2: 'watched' }, hist: [{ t: now - 5000, act: 'watched', ep: 2 }, { t: now - 9000, act: 'watched', ep: 1 }],
          filler: '3,6-8', mixed: '4', eps: plain(12).map((e, i) => i === 2 ? { s: 3, t: '原创特别篇 【动画原创】' } : e) },
        { sid: '902', bgmId: '902', title: '测试未校准番', total: 12, status: 'watching', type: 'manga-adapt', statuses: {}, eps: plain(12) }
      ];
      localStorage.setItem('tr_shows', JSON.stringify(shows));
      localStorage.removeItem('at_sync_log');
      localStorage.removeItem('at_hide_src');
      localStorage.setItem('at_bgm_token', 'TOKEN_OK');
    });
    // 注销 SW 兜底（万一 bypass 不可用）
    await page.evaluate(async () => { try { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);

    const waitLog = (expr, timeout) => page.waitForFunction(expr, { timeout: timeout || 45000, polling: 300 });
    const logKinds = () => page.evaluate(() => JSON.parse(localStorage.getItem('at_sync_log') || '[]'));

    // 1. 入口一次点击 & 绑定状态（含 /me 实网模拟）
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]')||true`, 8000).catch(() => {});
    await page.click('.topbtn.wide');
    await sleep(900);
    const sc1 = await page.evaluate(() => ({
      panel: !!document.getElementById('syncMask'),
      who: (document.getElementById('bgmWho') || {}).textContent || '',
      ver: (document.getElementById('verLine') || {}).textContent || ''
    }));
    ok('同步入口一次点击可达', sc1.panel === true);
    ok('Bangumi 绑定状态（/me 模拟）', sc1.who.includes('tester'), sc1.who);
    ok('版本对齐 ✓（页面=服务端 2.3.0）', sc1.ver.includes('服务端 v2.3.0') && sc1.ver.includes('✓'), sc1.ver);
    await page.screenshot({ path: path.join(SHOTS, 'e2e-06-sync-center.png') });
    await page.evaluate(() => window.__closeSync());

    // 2. 单番拉取（补标 ep3）
    await page.evaluate(() => { const r = [...document.querySelectorAll('#list .show')].find(x => x.textContent.includes('测试混合番')); r.querySelector('.info').click(); });
    await sleep(250);
    const curSid1 = await page.evaluate(() => window.curSid);
    ok('详情已打开(curSid=901)', String(curSid1) === '901', String(curSid1));
    await page.evaluate(() => { bgmPullProgress(); });
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').some(x=>x.kind==='bgm-pull-one')`, 60000);
    await sleep(300);
    const pull1 = await page.evaluate(() => {
      const A = JSON.parse(localStorage.getItem('tr_shows') || '[]').find(s => s.sid === '901');
      const lg = JSON.parse(localStorage.getItem('at_sync_log') || '[]');
      const e = lg.filter(x => x.kind === 'bgm-pull-one').pop();
      return { ep3: A.statuses['3'] || null, ep4: A.statuses['4'] || null, ok: e && e.ok, fail: e && e.fail };
    });
    ok('拉取补标 ep3', pull1.ep3 === 'watched', JSON.stringify(pull1));
    ok('未误标 ep4', pull1.ep4 === null);
    ok('台账 成功且无失败', pull1.ok >= 1 && pull1.fail === 0, JSON.stringify(pull1));

    // 3. 标记 ep5（自动推送）+ 整番推送（只推差集 1002）
    await page.evaluate(() => { const rows = [...document.querySelectorAll('#dGroups .eprow')]; rows.find(x => x.querySelector('.no').textContent.trim() === '5').click(); });
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').some(x=>x.kind==='bgm-ep-auto')`, 60000);
    ok('单集自动推送写台账', true);
    await page.evaluate(() => { bgmPushOneShow(); });
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').some(x=>x.kind==='bgm-push-one')`, 60000);
    await sleep(300);
    const push1 = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('at_sync_log') || '[]').filter(x => x.kind === 'bgm-push-one').pop();
      return { ok: e.ok, fail: e.fail, undoN: (e.items[0] && e.items[0].undo && e.items[0].undo.pushed.length) || 0 };
    });
    const p901 = log.patches.filter(p => p.sid === '901');
    const lastPatch = p901[p901.length - 1];
    ok('整番推送=只推差集[1002]', lastPatch && lastPatch.body.episode_id.join(',') === '1002', JSON.stringify(p901.map(x => x.body)));
    ok('台账 undo=1 集', push1.undoN === 1, JSON.stringify(push1));

    // 4. 回滚该次推送
    const lastPushId = await page.evaluate(() => { const e = JSON.parse(localStorage.getItem('at_sync_log') || '[]').filter(x => x.kind === 'bgm-push-one').pop(); return e.id; });
    const pcBefore = log.patches.length;
    await page.evaluate((id) => { bgmRollback(id); }, lastPushId);
    await waitLog(`(JSON.parse(localStorage.getItem('at_sync_log')||'[]').find(x=>x.id==='${lastPushId}')||{}).rolledBack===true`, 60000);
    const rbPatch = log.patches.slice(pcBefore).pop();
    ok('回滚请求=恢复为0', rbPatch && rbPatch.body.type === 0 && rbPatch.body.episode_id.join(',') === '1002', JSON.stringify(rbPatch));
    ok('远端已恢复(1002=0)', remote.eps['901'][1002] === 0);

    // 5. 推送全部 ×2（幂等）
    await page.evaluate(() => { document.querySelector('#vDetail .back').click(); });
    await sleep(200);
    await page.evaluate(() => { syncOpen(); });
    await sleep(800);
    const pcA = log.patches.length;
    await page.evaluate(() => { bgmPushAll(document.getElementById('syncMask')); });
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').filter(x=>x.kind==='bgm-push-all').length>=1`, 90000);
    await sleep(500);
    const firstAll = log.patches.slice(pcA).filter(p => p.sid === '901');
    ok('推送全部：补差[1002]', firstAll.length === 1 && firstAll[0].body.episode_id.join(',') === '1002', JSON.stringify(firstAll.map(x => x.body)));
    const pc2 = log.patches.length;
    await page.evaluate(() => { bgmPushAll(document.getElementById('syncMask')); });
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').filter(x=>x.kind==='bgm-push-all').length>=2`, 90000);
    await sleep(600);
    const secondAll = log.patches.slice(pc2);
    ok('连续两次推送：第二次零写入（幂等）', secondAll.length === 0, JSON.stringify(secondAll));
    const store1 = await page.evaluate(() => { const A = JSON.parse(localStorage.getItem('tr_shows') || '[]').find(s => s.sid === '901'); return Object.keys(A.statuses).sort().join(','); });
    ok('本地标记不重不漏 1,2,3,5', store1 === '1,2,3,5', store1);
    ok('远端=本地(1001,1002,1003,1005)', [1001, 1002, 1003, 1005].every(id => remote.eps['901'][id] === 2));

    // 6. 拉取全部：500 失败 → 重试成功
    remote.fail902 = true;
    await page.evaluate(() => { bgmPullAll(document.getElementById('syncMask')); });
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').filter(x=>x.kind==='bgm-pull-all').length>=1`, 90000);
    await sleep(400);
    const pull2 = await page.evaluate(() => { const e = JSON.parse(localStorage.getItem('at_sync_log') || '[]').filter(x => x.kind === 'bgm-pull-all').pop(); return { ok: e.ok, fail: e.fail, items: e.items.map(i => i.title + '|' + (i.ok ? 'ok' : i.err)) }; });
    ok('拉取全部：1成功1失败(500)', pull2.ok === 1 && pull2.fail === 1, JSON.stringify(pull2.items));
    await page.evaluate(() => { renderLedger(document.getElementById('syncMask')); });
    await sleep(300);
    await page.evaluate(() => { const rows = [...document.querySelectorAll('#syLedger .lgrow')]; if (rows[0]) rows[0].querySelector('.lg1').click(); });
    await sleep(200);
    ok('台账可展开明细', await page.evaluate(() => !!document.querySelector('#syLedger .lgdet.open')));
    await page.screenshot({ path: path.join(SHOTS, 'e2e-07-ledger.png') });
    remote.fail902 = false;
    const retryId = await page.evaluate(() => { const e = JSON.parse(localStorage.getItem('at_sync_log') || '[]').filter(x => x.kind === 'bgm-pull-all').pop(); return e.id; });
    await page.evaluate((id) => { bgmRetry(id); }, retryId);
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').some(x=>x.kind==='bgm-retry'&&!x.fail&&x.ok>=1)`, 90000);
    const ep1of902 = await page.evaluate(() => { const B = JSON.parse(localStorage.getItem('tr_shows') || '[]').find(s => s.sid === '902'); return B.statuses['1'] || null; });
    ok('失败重试后 902 补标 ep1', ep1of902 === 'watched');

    // 7. 401 凭据失效
    await page.evaluate(() => { localStorage.setItem('at_bgm_token', 'BADTOKEN'); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);
    await page.evaluate(() => { const r = [...document.querySelectorAll('#list .show')].find(x => x.textContent.includes('测试混合番')); r.querySelector('.info').click(); });
    await sleep(250);
    await page.evaluate(() => { bgmPullProgress(); });
    await waitLog(`JSON.parse(localStorage.getItem('at_sync_log')||'[]').some(x=>x.kind==='bgm-pull-one'&&x.fail>0&&String(x.items[0].err).indexOf('凭据失效')>=0)`, 60000);
    ok('401：台账给出“凭据失效”恢复指引', true);
    await page.evaluate(() => { localStorage.setItem('at_bgm_token', 'TOKEN_OK'); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);

    // 8. 双跑核查 + 拦截统计
    const paths = await page.evaluate(() => {
      const s = document.documentElement.innerHTML;
      return { oldPath: (s.match(/collections\/[^'"{}]*\/episodes\/[^'"{}]*ep\.bid/g) || []).length };
    });
    ok('无旧路径残留（无双跑）', paths.oldPath === 0);
    console.log('API seen:', apiSeen, ' mocked:', apiMocked);
    ok('请求拦截生效（>10 次被模拟）', apiSeen > 10 && apiMocked > 10, 'seen=' + apiSeen + ' mocked=' + apiMocked);

    console.log('\npage errors:', JSON.stringify(pageErrors.slice(0, 8)));
    ok('无页面级 JS 错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 250));
  } catch (e) {
    console.log('E2E-2v2 EXCEPTION:', e && (e.stack || e.message || e));
    results.push({ name: 'exception', pass: false, extra: String(e && (e.message || e)) });
  } finally {
    await browser.close();
  }
  failed = results.filter(r => !r.pass).length;
  fs.writeFileSync(path.join(SHOTS, 'e2e2-results.json'), JSON.stringify(results, null, 1));
  console.log('\n==== E2E-2v2 SUMMARY: ' + (results.length - failed) + '/' + results.length + ' passed ====');
  process.exit(failed ? 1 : 0);
})();
