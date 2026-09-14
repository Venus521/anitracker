/* E2E-3 v2: v2.4 免绑定搜索/添加/离线/去重/关联/开关（修正选择器与等待） */
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
const net = { offline: false };
const dialogQ = [];

function subj(id, cn, jp, date, eps) {
  return { id, name_cn: cn, name: jp, date: date || '', eps: eps || 0, type: 2, images: { common: '', large: '' } };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=460,1000'] });
  let failed = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('dialog', async d => {
      try {
        const v = dialogQ.length ? dialogQ.shift() : undefined;
        if (v === null) await d.dismiss(); else if (v === undefined) await d.accept(); else await d.accept(String(v));
      } catch (e) {}
    });

    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      try {
        const u = req.url();
        if (net.offline) {
          if (u.startsWith('http://127.0.0.1:8091/')) return req.continue();
          return req.abort('failed');
        }
        if (u.startsWith('https://api.bgm.tv/')) {
          if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS, body: '' });
          if (u.endsWith('/v0/search/subjects')) {
            const body = JSON.parse(req.postData() || '{}');
            const kw = String(body.keyword || '');
            let data = [];
            if (/海贼王|航海王|ONE PIECE/i.test(kw)) data = [subj(999001, '海贼王', 'ONE PIECE', '1999-10-20', 3), subj(999002, '航海王', 'ONE PIECE', '1999-10-20', 3)];
            else if (/孤独摇滚/.test(kw)) data = [subj(328609, '孤独摇滚！', 'ぼっち・ざ・ろっく！', '2022-10-08', 12)];
            else if (/离线测试番/.test(kw)) data = [subj(888001, '离线测试番', 'Offline Test', '2026-01-01', 5)];
            else data = [];
            return req.respond({ status: 200, headers: CORS, body: JSON.stringify({ data }) });
          }
          if (u.endsWith('/v0/subjects/999002')) return req.respond({ status: 200, headers: CORS, body: JSON.stringify({ id: 999002, name_cn: '航海王', name: 'ONE PIECE', date: '1999-10-20', images: { common: '' } }) });
          if (u.indexOf('/v0/episodes?subject_id=999002') >= 0) {
            return req.respond({ status: 200, headers: CORS, body: JSON.stringify({ data: [
              { id: 9101, sort: 1, ep: 1, type: 0, name: 'e1', name_cn: '第1集' },
              { id: 9102, sort: 2, ep: 2, type: 0, name: 'e2', name_cn: '第2集' },
              { id: 9103, sort: 3, ep: 3, type: 0, name: 'e3', name_cn: '第3集' }
            ] }) });
          }
          return req.respond({ status: 404, headers: CORS, body: '{}' });
        }
        if (/tcloudbaseapp\.com|lain\.bgm\.tv|proxy\.cors\.sh|api\.codetabs\.com/.test(u)) return req.respond({ status: 404, headers: {}, body: '' });
        return req.continue();
      } catch (e) { try { await req.continue(); } catch (e2) {} }
    });
    try { await page.setBypassServiceWorker(true); } catch (e) {}

    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(() => {
      const shows = [
        { sid: 'int-1', title: '海贼王', total: 3, status: 'watching', type: 'manga-adapt', statuses: {}, eps: [{ s: 1, t: '第1集' }], addedAt: Date.now(), updAt: Date.now() }
      ];
      localStorage.setItem('tr_shows', JSON.stringify(shows));
      localStorage.removeItem('at_sync_log');
      localStorage.removeItem('at_flags');
      localStorage.removeItem('at_bgm_token');
    });
    await page.evaluate(async () => { try { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);

    const showCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').length);
    const lastLog = (kind) => page.evaluate((k) => {
      const lg = JSON.parse(localStorage.getItem('at_sync_log') || '[]').filter(x => k ? x.kind === k : true);
      return lg.length ? lg[lg.length - 1] : null;
    }, kind);
    const gotoSearch = async (kw) => {
      await page.evaluate((k) => {
        if (document.getElementById('vAdd').style.display === 'none') showAdd();
        document.getElementById('qKw').value = k;
        doBgmSearch();
      }, kw);
    };
    const onlineRow = (title, button) => `(() => {
      const hs=[...document.querySelectorAll('#srList > *')]; let inOn=false;
      for(const el of hs){ if(el.classList && el.classList.contains('srsec')){ inOn=el.textContent.includes('在线'); continue; }
        if(inOn && el.classList.contains('sr') && el.textContent.includes(${JSON.stringify(title)}) && el.textContent.includes(${JSON.stringify(button)})) return el; }
      return null; })()`;

    // 1. 免绑定双源搜索（海贼王）
    await gotoSearch('海贼王');
    await page.waitForFunction(() => document.getElementById('srList').textContent.includes('Bangumi 在线'), { timeout: 15000 });
    const r1 = await page.evaluate(() => ({
      list: document.getElementById('srList').textContent,
      msg: document.getElementById('srMsg').textContent,
      hint: document.getElementById('addHint').textContent
    }));
    ok('无 token 可搜索（不再被拦）', r1.list.length > 0, r1.msg);
    ok('「我的片单」分区出现', r1.list.includes('我的片单') && r1.list.includes('海贼王'));
    ok('「Bangumi 在线」分区出现（含航海王）', r1.list.includes('Bangumi 在线') && r1.list.includes('航海王'));
    ok('免绑定提示可见', r1.hint.includes('免绑定'));
    await page.screenshot({ path: path.join(SHOTS, 'e2e-08-search-dual.png') });

    // 2. 重复添加拦截（在线结果「海贼王」，应与片单同名拦截）
    const n0 = await showCount();
    await page.waitForFunction(`!!${onlineRow('海贼王', '添加')}`, { timeout: 15000 });
    await page.evaluate(`(() => { const el=${onlineRow('海贼王', '添加')}; el.querySelector('button').click(); })()`);
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已在片单'), { timeout: 6000 });
    ok('重复添加被拦截并提示', true);
    ok('拦截后数量不变', (await showCount()) === n0, 'before=' + n0);

    // 3. 在线添加成功（航海王）
    await page.waitForFunction(`!!${onlineRow('航海王', '添加')}`, { timeout: 15000 });
    await page.evaluate(`(() => { const el=${onlineRow('航海王', '添加')}; el.querySelector('button').click(); })()`);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').some(x => x.bgmId === '999002'), { timeout: 20000 });
    const afterAdd = await page.evaluate(() => {
      const arr = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = arr.find(x => x.bgmId === '999002');
      return { count: arr.length, eps: s.eps.length };
    });
    ok('在线添加成功（bgmId=999002，3 集）', afterAdd.count === n0 + 1 && afterAdd.eps === 3, JSON.stringify(afterAdd));
    await sleep(300);
    const lg1 = await lastLog('add');
    ok('台账记录在线添加', lg1 && String(lg1.note).includes('在线搜索'), JSON.stringify(lg1 && lg1.note));

    // 4. 本地库命中并添加（银魂）
    await gotoSearch('银魂');
    await page.waitForFunction(() => document.getElementById('srList').textContent.includes('本地库'), { timeout: 15000 });
    const n1 = await showCount();
    await page.waitForFunction(() => [...document.querySelectorAll('#srList .sr')].some(x => x.textContent.includes('银魂') && x.textContent.includes('添加')), { timeout: 15000 });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#srList .sr')].find(x => x.textContent.includes('银魂') && x.textContent.includes('添加'));
      row.querySelector('button').click();
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').some(x => x.title === '银魂'), { timeout: 20000 });
    const r2b = await page.evaluate(() => {
      const arr = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = arr.find(x => x.title === '银魂');
      return { count: arr.length, src: s && s.source };
    });
    ok('本地库添加成功', r2b.count === n1 + 1 && String(r2b.src).includes('内置库'), JSON.stringify(r2b));
    await sleep(300);
    const lg2 = await lastLog('add');
    ok('台账记录本地库添加', lg2 && String(lg2.note).includes('本地库'), JSON.stringify(lg2 && lg2.note));
    await page.waitForFunction(() => document.getElementById('vList').style.display !== 'none', { timeout: 8000 });
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '银魂'; doBgmSearch(); });
    await page.waitForFunction(() => {
      const t = document.getElementById('srList').textContent;
      return t.includes('我的片单') && t.includes('银魂') && (t.match(/银魂/g) || []).length === 1;
    }, { timeout: 25000 });
    ok('添加后回列表；再搜银魂：进「我的片单」且本地库去重', true);

    // 5. 离线（网络不可用）
    net.offline = true;
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '海贼王'; doBgmSearch(); });
    await page.waitForFunction(() => (document.getElementById('addHint').textContent + document.getElementById('srMsg').textContent + document.getElementById('srList').textContent).includes('在线搜索暂不可用'), { timeout: 30000 });
    const r3 = await page.evaluate(() => ({ list: document.getElementById('srList').textContent, hint: document.getElementById('addHint').textContent }));
    ok('断网：本地结果照常 + 明确提示', r3.list.includes('我的片单') && r3.list.includes('海贼王') && r3.hint.includes('在线搜索暂不可用'), r3.hint.slice(0, 90));
    await page.screenshot({ path: path.join(SHOTS, 'e2e-09-search-offline.png') });

    // 6. 手动添加
    const n2 = await showCount();
    dialogQ.push('离线测试番', '5', '2026');
    await page.evaluate(() => manualAdd());
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').some(x => x.title === '离线测试番'), { timeout: 8000 });
    const r4 = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('tr_shows') || '[]').find(x => x.title === '离线测试番');
      return { sid: s.sid, eps: s.eps.length, src: s.source };
    });
    ok('手动添加成功（离线可用，5 集）', String(r4.sid).indexOf('man-') === 0 && r4.eps === 5 && r4.src === '手动添加', JSON.stringify(r4));
    const lg3 = await lastLog('add');
    ok('台账记录手动添加', lg3 && String(lg3.note).includes('手动添加'), JSON.stringify(lg3 && lg3.note));

    // 7. 刷新持久（离线）
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);
    ok('刷新后「离线测试番」仍在', await page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').some(x => x.title === '离线测试番')));
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '离线测试番'; doBgmSearch(); });
    await page.waitForFunction(() => document.getElementById('srList').textContent.includes('离线测试番'), { timeout: 15000 });
    ok('离线时本地也能搜到已添加的番', await page.evaluate(() => document.getElementById('srList').textContent.includes('我的片单')));

    // 8. 开关回退
    await page.evaluate(() => { setFlag('searchNoSync', false); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(400);
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '海贼王'; doBgmSearch(); });
    await page.waitForFunction(() => document.getElementById('srMsg').textContent.includes('已关闭'), { timeout: 6000 });
    const r6 = await page.evaluate(() => ({ msg: document.getElementById('srMsg').textContent, list: document.getElementById('srList').textContent }));
    ok('开关关闭：回退为拦截并提示', r6.msg.includes('已关闭') && r6.list.trim() === '', (r6.msg || '').slice(0, 100));
    await page.evaluate(() => { setFlag('searchNoSync', true); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(400);

    // 9. 关联 Bangumi
    net.offline = false;
    await page.evaluate(() => {
      const r = [...document.querySelectorAll('#list .show')].find(x => x.textContent.includes('离线测试番'));
      r.querySelector('.info').click();
    });
    await sleep(350);
    const r7 = await page.evaluate(() => { const b = document.getElementById('btnAssoc'); return { visible: b && b.style.display !== 'none' }; });
    ok('未关联番显示「关联Bangumi」按钮', r7.visible === true);
    await page.evaluate(() => assocUi());
    await page.waitForFunction(() => (document.getElementById('assocList') || {}).textContent && document.getElementById('assocList').textContent.includes('离线测试番'), { timeout: 15000 });
    await page.screenshot({ path: path.join(SHOTS, 'e2e-11-assoc.png') });
    ok('关联搜索返回候选', true);
    await page.evaluate(() => { const btn = [...document.querySelectorAll('#assocList button')].find(b => b.textContent === '关联'); btn.click(); });
    await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('tr_shows') || '[]').find(x => x.title === '离线测试番'); return s && s.bgmId === '888001'; }, { timeout: 8000 });
    const r9 = await page.evaluate(() => { const b = document.getElementById('btnAssoc'); return { hidden: b && b.style.display === 'none' }; });
    ok('关联成功：bgmId=888001 且按钮隐藏', r9.hidden === true);
    const lg4 = await lastLog('add');
    ok('台账记录关联操作', lg4 && String(lg4.note).includes('关联'), JSON.stringify(lg4 && lg4.note));

    // 10. 同步中心高级设置
    await page.evaluate(() => { document.querySelector('#vDetail .back').click(); });
    await sleep(200);
    await page.evaluate(() => syncOpen());
    await sleep(900);
    const r10 = await page.evaluate(() => ({
      panel: !!document.getElementById('syncMask'),
      optChecked: document.getElementById('optNoSync') && document.getElementById('optNoSync').checked,
      unmapped: (document.getElementById('advUnmapped') || {}).textContent || ''
    }));
    ok('同步中心打开且高级设置存在', r10.panel && r10.optChecked === true);
    ok('未关联计数展示', r10.unmapped.includes('未关联') || r10.unmapped.includes('均已关联'), r10.unmapped.slice(0, 90));
    await page.evaluate(() => { const cb = document.getElementById('optNoSync'); cb.checked = false; cb.onchange(); });
    await sleep(200);
    ok('开关切换持久化', (await page.evaluate(() => JSON.parse(localStorage.getItem('at_flags') || '{}').searchNoSync)) === false);
    await page.evaluate(() => { const cb = document.getElementById('optNoSync'); cb.checked = true; cb.onchange(); });
    await page.screenshot({ path: path.join(SHOTS, 'e2e-10-sync-adv.png') });
    await page.evaluate(() => window.__closeSync());

    console.log('\npage errors:', JSON.stringify(pageErrors.slice(0, 8)));
    ok('无页面级 JS 错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 250));
  } catch (e) {
    console.log('E2E-3v2 EXCEPTION:', e && (e.stack || e.message || e));
    results.push({ name: 'exception', pass: false, extra: String(e && (e.message || e)) });
  } finally {
    await browser.close();
  }
  failed = results.filter(r => !r.pass).length;
  fs.writeFileSync(path.join(SHOTS, 'e2e3-results.json'), JSON.stringify(results, null, 1));
  console.log('\n==== E2E-3v2 SUMMARY: ' + (results.length - failed) + '/' + results.length + ' passed ====');
  process.exit(failed ? 1 : 0);
})();
