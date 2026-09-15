/* run-regression.js — AniTracker 回归测试（v2.6.0：同步已删 + 季度秒切 + 封面自愈 + 影院深色主题）
   用法：node tests\run-regression.js · 自起静态服务 8094 + 模拟 Bangumi API 8092 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const ROOT = path.resolve(__dirname, '..');
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' T' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 220)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, obj) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: 8092, path: p, method: 'POST', headers: { 'Content-Type': 'application/json' } }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res(b)); }); r.on('error', rej); r.end(JSON.stringify(obj || {})); });
const state = () => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 8092, path: '/__state' }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res(JSON.parse(b))); }).on('error', rej); });

(async () => {
  /* ---- 文件级 ---- */
  const ib = fs.readFileSync(path.join(ROOT, 'index.html'));
  const ab = fs.readFileSync(path.join(ROOT, 'ani-tracker.html'));
  check('00', '双入口字节一致', ib.equals(ab), ib.length + 'B vs ' + ab.length + 'B');
  const ix = ib.toString('utf-8');
  const vm = ix.match(/AT_VERSION='([^']+)'/);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'tracker-version.json'), 'utf-8'));
  check('01', '版本一致（2.6.0）', vm && vm[1] === vj.version && vj.version === '2.6.0', 'page=' + (vm && vm[1]) + ' json=' + vj.version);
  check('02', 'BGMSYNC=false 开关存在；bgmGet 仍不存在', /var BGMSYNC=false;/.test(ix) && ix.indexOf('function bgmGet') < 0);

  const pySrv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8094', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '900'], { stdio: 'ignore' });
  const mock = spawn('node', [path.join(__dirname, 'mock-bgm-api.js')], { stdio: 'ignore' });
  await sleep(1800);
  let pageErrors = 0; let mockReqs = 0;
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    page.on('pageerror', () => { pageErrors++; });
    page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (u.includes('api.bgm.tv')) { mockReqs++; return req.continue({ url: u.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') }); }
      const m = u.match(/^https?:\/\/(?:proxy\.cors\.sh\/|api\.codetabs\.com\/v1\/proxy\/\?)(.+)$/);
      if (m) { const inner = decodeURIComponent(m[1]); return req.continue({ url: inner.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') }); }
      req.continue();
    });
    const txt = sel => page.evaluate(sel => { const el = document.querySelector(sel); return el ? el.textContent : ''; }, sel);

    await post('/__ctl', { mode: 'ok', target: 'all', reset: true });
    await page.goto('http://127.0.0.1:8094/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1100);

    // T10 同步 UI 已删
    const syncBtnGone = await page.evaluate(() => !document.querySelector('[data-bgm-sync]'));
    await page.evaluate(() => syncOpen('bgm')); await sleep(900);
    const noBgmCard = await page.evaluate(() => !document.getElementById('syCardBgm') || document.getElementById('syCardBgm').textContent.trim() === '');
    const introOk = await page.evaluate(() => !document.getElementById('syncMask').textContent.includes('Bangumi 双向同步'));
    check('10', '同步 UI 已删（详情按钮/绑定卡/中心文案）', syncBtnGone && noBgmCard && introOk, 'btn=' + syncBtnGone + ' card=' + noBgmCard);
    await page.evaluate(() => window.__closeSync()); await sleep(300);

    // T11 搜索分季（mock 4 条 → 同系列 3 部分组 + 单条平铺）
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '模拟番'; doBgmSearch(); });
    await page.waitForFunction(() => document.getElementById('srList').textContent.includes('Bangumi 在线'), { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    const sr = await page.evaluate(() => ({
      groups: document.querySelectorAll('#srList .srgroup').length,
      chips: document.querySelectorAll('#srList .srchip').length,
      addBtns: document.querySelectorAll('#srList .srchip button').length,
      groupText: (document.querySelector('#srList .srgroup .srgt') || {}).textContent || '',
      flat: document.querySelectorAll('#srList > div.sr').length
    }));
    check('11', '搜索结果自动分季（1 组 3 chips + 单条平铺）', sr.groups === 1 && sr.chips === 3 && sr.addBtns === 3 && /模拟番/.test(sr.groupText), JSON.stringify(sr).slice(0, 200));

    // T12 从 chip 加入 → 自动带季度条 + 预取缓存
    const beforeCnt = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').length);
    await page.evaluate(() => { const b = document.querySelectorAll('#srList .srchip button')[0]; b.click(); });
    await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && /已加入/.test(t.textContent); }, { timeout: 30000 }).catch(() => {});
    await sleep(4500); // 等预取（3 部 × 读节流 350ms）
    const added = await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]'); const s = a.filter(x => String(x.bgmId) === '900001')[0] || a[a.length - 1];
      return { n: a.length, sid: s.sid, parts: (s.parts || []).length, curPart: s.curPart, cache: Object.keys(JSON.parse(localStorage.getItem('at_series_cache') || '{}')).filter(k => k.indexOf('e9') === 0) };
    });
    check('12', 'chip 加入：入片单+带 3 部季度条+缓存预取', added.n === beforeCnt + 1 && added.parts === 3 && added.cache.length >= 2, JSON.stringify(added).slice(0, 220));

    // T13 季度秒切（缓存命中，零网络）
    await page.evaluate(sid => openDetail(sid), added.sid);
    await sleep(700);
    mockReqs = 0;
    const t0 = Date.now();
    await page.evaluate(() => { const ps = document.querySelectorAll('#dParts .part'); const target = Array.from(ps).find(x => /第2季/.test(x.textContent) || /季度/.test(x.textContent)); (ps[1] || ps[0]).click(); });
    await page.waitForFunction(() => !!document.querySelector('#dParts .pvbar'), { timeout: 8000, polling: 60 }).catch(() => {});
    const swMs = Date.now() - t0;
    const pv = await page.evaluate(() => ({ bar: !!document.querySelector('#dParts .pvbar'), barText: (document.querySelector('#dParts .pvbar') || {}).textContent || '', addBtn: !!Array.from(document.querySelectorAll('#dParts .pvbar button')).find(b => /加入片单/.test(b.textContent)) }));
    check('13', '季度秒切：缓存命中零网络，进入预览模式', pv.bar && pv.addBtn && swMs < 1500 && mockReqs === 0, swMs + 'ms mockReqs=' + mockReqs + ' ' + JSON.stringify(pv).slice(0, 120));
    await page.screenshot({ path: path.join(ROOT, 'docs', 'shots', 'v250-preview.png') });

    // T14 预览不可标记 + 加入片单后可标记且持久
    await page.evaluate(() => { const els = document.querySelectorAll('#dGroups .eprow'); els[0] && els[0].click(); });
    await sleep(400);
    const pvToast = await page.evaluate(() => document.getElementById('toast').textContent);
    const stStill0 = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tr_shows')).filter(x => x.sid === 'pv-900003')[0]; return !s; });
    await page.evaluate(() => pvCommit()); await sleep(700);
    const committed = await page.evaluate(() => { const a = JSON.parse(localStorage.getItem('tr_shows') || '[]'); const s = a.filter(x => String(x.bgmId) === '900003')[0]; return s && !s.pv && (s.eps || []).length === 8; });
    await page.evaluate(() => { const els = document.querySelectorAll('#dGroups .eprow'); els[0] && els[0].click(); }); await sleep(400);
    const marked = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tr_shows')).filter(x => String(x.bgmId) === '900003')[0]; return s && Object.keys(s.statuses || {}).length === 1; });
    check('14', '预览不可标记；加入片单后可标记且持久（8集）', /预览模式/.test(pvToast) && stStill0 && committed && marked, 'pvToast=' + pvToast.slice(0, 40) + ' committed=' + committed + ' marked=' + marked);

    // T15 同步行为禁用：即使本地有 token，标记也不产生任何同步请求
    await page.evaluate(() => localStorage.setItem('at_bgm_token', 'dummy-token-should-not-be-used'));
    await page.evaluate(() => openDetail('900001')); await sleep(600);
    mockReqs = 0;
    await page.evaluate(() => { const els = document.querySelectorAll('#dGroups .eprow'); els[2] && els[2].click(); });
    await sleep(3500);
    check('15', '同步已删：有 token 也不发任何 /collections 请求', mockReqs === 0, 'mockReqs=' + mockReqs);

    // T16 未开播条目提示（v2.4.4 行为保持）
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '空条目'; doBgmSearch(); });
    await page.waitForFunction(() => document.getElementById('srList').textContent.includes('Bangumi 在线'), { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    const cntBefore16 = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').length);
    await page.evaluate(() => { const btns = Array.from(document.querySelectorAll('#srList button')); const b = btns.find(x => /bgmAttach\(900002/.test(x.getAttribute('onclick') || '')); if (b) b.click(); });
    await page.waitForFunction(() => { const m = document.getElementById('srMsg'); return m && /暂无剧集数据/.test(m.textContent); }, { timeout: 20000 }).catch(() => {});
    const noEps = await page.evaluate(() => document.getElementById('srMsg').textContent);
    const cntAfter16 = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').length);
    check('16', '未开播条目：明确提示不入库', noEps.includes('暂无剧集数据') && cntAfter16 === cntBefore16, noEps.slice(0, 90) + ' | n=' + cntBefore16 + '->' + cntAfter16);

    // T17 断网补拉快速报错
    await page.evaluate(() => { const a = JSON.parse(localStorage.getItem('tr_shows') || '[]'); const s = a.filter(x => String(x.bgmId) === '900001')[0]; s.eps = []; s.total = 0; localStorage.setItem('tr_shows', JSON.stringify(a)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(800);
    await page.setOfflineMode(true);
    await page.evaluate(() => openDetail('900001')); await sleep(500);
    const tOff = Date.now();
    await page.evaluate(() => document.getElementById('nextBtn').click());
    await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && /拉取剧集失败/.test(t.textContent); }, { timeout: 30000 }).catch(() => {});
    const offMs = Date.now() - tOff;
    await page.setOfflineMode(false);
    check('17', '断网补拉：快速报错且提示可读', offMs < 25000, offMs + 'ms');

    // T19 主题：默认深色 + 切换 + 持久化 + 占位图联动
    const th1 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), btn: !!document.getElementById('themeBtn'), phDark: coverPH().indexOf('221d15') >= 0 }));
    await page.evaluate(() => cycleTheme()); await sleep(300);
    const th2 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('at_theme'), phLight: coverPH().indexOf('f2e9d8') >= 0 }));
    await page.evaluate(() => cycleTheme()); await sleep(300);
    const th3 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('at_theme') }));
    check('19', '主题：默认深色/切换/持久化/占位图联动', th1.attr === 'dark' && th1.btn && th1.phDark && th2.attr === 'light' && th2.ls === 'light' && th2.phLight && th3.attr === 'dark' && th3.ls === 'dark', JSON.stringify({ th1, th2, th3 }).slice(0, 260));

    // T20 封面自愈入口与防裂图属性
    await page.evaluate(() => renderList()); await sleep(300);
    const entry = await page.evaluate(() => ({
      chip: document.getElementById('srcBar').textContent.indexOf('补封面') >= 0,
      btn: !!document.querySelector('button[onclick="healThisCover()"]'),
      rp: (function () { const im = document.querySelector('#list .show img'); return im ? im.getAttribute('referrerpolicy') : null; })(),
      fn: typeof coverHealAll === 'function' && typeof healCoverFor === 'function'
    }));
    check('20', '封面自愈入口就绪（chip/按钮/防裂图属性/函数）', entry.chip && entry.btn && entry.rp === 'no-referrer' && entry.fn, JSON.stringify(entry).slice(0, 220));

    // T21 封面自愈：有 bgmId 直拉 + 无 bgmId 标题搜索；失败登记退避
    await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      a.push({ sid: 'heal-empty', title: '模拟番（测试）', nameJp: 'mock anime (test)', cover: '', total: 12, eps: [], statuses: {}, status: 'watching', bgmId: '900001', source: '测试' });
      a.push({ sid: 'heal-remote', title: '模拟番 第二季', nameJp: 'mock anime S2', cover: 'https://lain.bgm.tv/fake-should-be-replaced.jpg', total: 8, eps: [], statuses: {}, status: 'watching', source: '测试' });
      a.push({ sid: 'heal-fail', title: '找不到的番剧 XYZ', nameJp: '', cover: '', total: 1, eps: [], statuses: {}, status: 'watching', source: '测试' });
      localStorage.setItem('tr_shows', JSON.stringify(a));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(7000); /* 等启动小批量自愈触发（4s 延时）并跑完 */
    await page.waitForFunction(() => window._coverHealRunning === false, { timeout: 90000, polling: 400 }).catch(() => {});
    await page.evaluate(() => { coverHealAll(true); return true; }); /* 手动全量（重试失败项，幂等） */
    await sleep(800);
    await page.waitForFunction(() => window._coverHealRunning === false, { timeout: 90000, polling: 400 }).catch(() => {});
    await sleep(800);
    const heal1 = await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const find = id => a.filter(s => s.sid === id)[0] || {};
      const tryMap = JSON.parse(localStorage.getItem('at_cover_try') || '{}');
      return {
        e: String(find('heal-empty').cover || '').slice(0, 22),
        r: String(find('heal-remote').cover || '').slice(0, 22),
        f: String(find('heal-fail').cover || ''),
        tryE: tryMap['heal-empty'] && tryMap['heal-empty'].ok,
        tryF: tryMap['heal-fail'] && tryMap['heal-fail'].ok
      };
    });
    check('21', '封面自愈：空封面条目补齐为本地 dataURL', heal1.e.indexOf('data:image') === 0 && heal1.r.indexOf('data:image') === 0, JSON.stringify(heal1).slice(0, 220));
    check('22', '封面自愈：失败条目登记退避台账且不误报', heal1.f === '' && heal1.tryE === true && heal1.tryF === false, JSON.stringify(heal1).slice(0, 220));

    // T23 刷新后封面持久（localStorage dataURL 读回）
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(900);
    const persist = await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = a.filter(x => x.sid === 'heal-empty')[0] || {};
      return { ok: String(s.cover || '').indexOf('data:image') === 0 };
    });
    check('23', '刷新后封面持久（localStorage dataURL 读回）', persist.ok, JSON.stringify(persist));

    // T24 离线补封面：快速跳过不卡死，占位保持
    await page.evaluate(() => { const a = JSON.parse(localStorage.getItem('tr_shows') || '[]'); a.push({ sid: 'heal-off', title: '离线测试番', cover: '', total: 1, eps: [], statuses: {}, status: 'watching', source: '测试' }); localStorage.setItem('tr_shows', JSON.stringify(a)); });
    await page.setOfflineMode(true);
    const tOff2 = Date.now();
    await page.evaluate(() => { coverHealAll(true); return true; });
    await sleep(1800);
    const off2 = await page.evaluate(() => ({ running: !!window._coverHealRunning, cover: (JSON.parse(localStorage.getItem('tr_shows')).filter(s => s.sid === 'heal-off')[0] || {}).cover }));
    await page.setOfflineMode(false);
    check('24', '离线补封面：快速跳过不卡死，占位保持', off2.cover === '' && !off2.running && (Date.now() - tOff2) < 20000, JSON.stringify(off2));

    // T25 无剧集+有总集数条目：详情页给出拉取入口（不再误报「全部标记过了」）
    await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      a.push({ sid: 'needs-eps', title: '手动添加的番', cover: '', total: 24, eps: [], statuses: {}, status: 'watching', source: '手动添加' });
      localStorage.setItem('tr_shows', JSON.stringify(a));
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(900);
    await page.evaluate(() => openDetail('needs-eps')); await sleep(600);
    const nbTxt = await page.evaluate(() => document.getElementById('nextBtn').textContent);
    check('25', '无剧集+有总集数：显示拉取/关联入口而非误报', /暂无剧集数据/.test(nbTxt) && !/全部标记过了/.test(nbTxt), nbTxt.slice(0, 80));

    // T18 无页面级 JS 错误
    check('18', '全程无页面级 JS 错误', pageErrors === 0, 'pageErrors=' + pageErrors);
  } catch (e) {
    check('99', '测试执行异常', false, String(e && e.stack || e).slice(0, 400));
  }
  try { if (browser) await browser.close(); } catch (e) {}
  try { mock.kill(); } catch (e) {}
  try { pySrv.kill(); } catch (e) {}
  fs.writeFileSync(path.join(__dirname, 'last-regression.json'), JSON.stringify({ t: new Date().toISOString(), results }, null, 1));
  const fails = results.filter(r => !r.ok);
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS' + (fails.length ? ' :: FAILED: ' + fails.map(r => 'T' + r.id + r.name).join(' | ') : ''));
  process.exit(fails.length ? 1 : 0);
})();
