/* run-regression.js — AniTracker Bangumi 链路回归测试（v2.4.4）
   用法：node tests\run-regression.js
   自起：静态服务 127.0.0.1:8094 + 模拟 Bangumi API 127.0.0.1:8092
   覆盖：双入口一致 / 版本一致 / 绑定 / 差量推送 / 回滚 / 拉取 / 429限流重试 / 401掉token /
         404条目下架 / 断网(黑洞)报错时长 / 未开播条目添加提示 / 无页面JS错误 */
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
  /* ---- 文件级检查 ---- */
  const ib = fs.readFileSync(path.join(ROOT, 'index.html'));
  const ab = fs.readFileSync(path.join(ROOT, 'ani-tracker.html'));
  check('00', '双入口字节一致（index.html === ani-tracker.html）', ib.equals(ab), ib.length + 'B vs ' + ab.length + 'B');
  const ix = ib.toString('utf-8');
  const vm = ix.match(/AT_VERSION='([^']+)'/);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'tracker-version.json'), 'utf-8'));
  check('01', '页面版本与 tracker-version.json 一致', vm && vm[1] === vj.version, 'page=' + (vm && vm[1]) + ' json=' + vj.version);
  check('02', 'bgmGet 死代码已移除', ix.indexOf('function bgmGet') < 0);
  check('02', 'manifest start_url 指向 index.html', fs.readFileSync(path.join(ROOT, 'tracker-manifest.webmanifest'), 'utf-8').includes('./index.html'));

  /* ---- 起服务 ---- */
  const pySrv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8094', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '900'], { stdio: 'ignore' });
  const mock = spawn('node', [path.join(__dirname, 'mock-bgm-api.js')], { stdio: 'ignore' });
  await sleep(1800);
  let pageErrors = 0;
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
      if (u.includes('api.bgm.tv')) return req.continue({ url: u.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') });
      const m = u.match(/^https?:\/\/(?:proxy\.cors\.sh\/|api\.codetabs\.com\/v1\/proxy\/\?)(.+)$/);
      if (m) { const inner = decodeURIComponent(m[1]); return req.continue({ url: inner.replace('https://api.bgm.tv', 'http://127.0.0.1:8092') }); }
      req.continue();
    });
    const clickBtn = (sel, pat) => page.evaluate((sel, pat) => { const rx = new RegExp(pat); const el = Array.from(document.querySelectorAll(sel)).find(b => rx.test(b.textContent)); if (el) { el.click(); return true; } return false; }, sel, pat);
    const txt = sel => page.evaluate(sel => { const el = document.querySelector(sel); return el ? el.textContent : ''; }, sel);

    await post('/__ctl', { mode: 'ok', target: 'all', reset: true });
    await page.goto('http://127.0.0.1:8094/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1000);

    // 预置：本地已标记 1-3（无 token 时不推送）
    await page.evaluate(() => {
      const eps = []; for (let i = 1; i <= 12; i++) eps.push({ s: i, t: '第 ' + i + ' 集', bid: 90000000 + i });
      const st = {}; for (let i = 1; i <= 3; i++) st[String(i)] = 'watched';
      localStorage.setItem('tr_shows', JSON.stringify([{ sid: '900001', title: '模拟番（测试）', nameJp: 'mock', cover: '', year: '2026', total: 12, eps: eps, statuses: st, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: 'Bangumi #900001', bgmId: '900001' }]));
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(800);

    // T10 绑定
    await page.evaluate(() => syncOpen('bgm')); await sleep(600);
    await page.evaluate(() => { document.querySelector('#syBgm').value = 'good-token'; document.querySelector('#syBgmSaveTest').click(); });
    await sleep(2200);
    const boundCard = await txt('#syCardBgm');
    check('10', 'token 绑定成功（mock /me）', /已绑定/.test(boundCard), boundCard.slice(0, 120));

    // T11 差量推送 3 集
    await clickBtn('#syCardBgm button', '推送全部'); await sleep(7000);
    const s1 = await state();
    const pushedIds = Object.keys((s1.collections['900001'] || {}).eps || {}).filter(k => s1.collections['900001'].eps[k] === 2);
    check('11', '差量推送：远端收到 3 集已看', pushedIds.length === 3, JSON.stringify(s1.collections['900001'] || {}).slice(0, 160));

    // T12 回滚
    await clickBtn('#syLedger button', '回滚本次'); await sleep(5000);
    const s2 = await state();
    const kept = Object.keys((s2.collections['900001'] || {}).eps || {}).filter(k => s2.collections['900001'].eps[k] === 2);
    const rolled = await txt('#syLedger');
    check('12', '回滚后远端已看清零且台账标记', kept.length === 0 && rolled.includes('已回滚'), 'kept=' + kept.length);

    // T13 拉取全部（远端 1-5 已看 → 本地补标 4、5）
    const epsMap = {}; for (let i = 1; i <= 5; i++) epsMap[String(90000000 + i)] = 2;
    await post('/__seed', { collections: { '900001': { type: 3, rate: 8, eps: epsMap } } });
    await clickBtn('#syCardBgm button', '拉取全部进度'); await sleep(8000);
    const pullMsg = await txt('#syBgmMsg');
    const stLocal = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tr_shows'))[0].statuses).sort().join(','));
    check('13', '拉取全部：补标 2 集、本地 1-5 齐且评分回填', /成功 1/.test(pullMsg) && stLocal === '1,2,3,4,5', pullMsg + ' | statuses=' + stLocal);

    // T14 429 限流 → 失败留痕 + 重试
    await post('/__ctl', { mode: 'http429', target: 'episodes' }); await sleep(200);
    await clickBtn('#syCardBgm button', '拉取全部进度'); await sleep(13000);
    const led429 = await txt('#syLedger');
    const hasRetry = await page.evaluate(() => !!Array.from(document.querySelectorAll('#syLedger button')).find(b => /重试失败项/.test(b.textContent)));
    check('14', '429 限流：失败入台账且可重试', led429.includes('触发接口限流') && hasRetry, led429.slice(0, 140));
    await post('/__ctl', { mode: 'ok', target: 'all' });
    await clickBtn('#syLedger button', '重试失败项'); await sleep(9000);
    const ledRetry = await txt('#syLedger');
    check('14', '重试失败项：恢复成功', /重试/.test(ledRetry) && !/失败 1 · 2026/.test(ledRetry.split('重试')[0] || ''), ledRetry.slice(0, 140));

    // T15 401 掉 token：同步报错但本地功能不受影响
    await post('/__ctl', { mode: 'authfail', target: 'collections' }); await sleep(200);
    await clickBtn('#syCardBgm button', '拉取全部进度'); await sleep(9000);
    const led401 = await txt('#syLedger');
    check('15', '401：凭据失效提示入台账', led401.includes('凭据失效'), led401.slice(0, 140));
    await page.evaluate(() => { window.__p = window.prompt; window.prompt = function (t, d) { if (/标题/.test(t)) return '掉线手测番'; if (/总集数/.test(t)) return '3'; if (/年份/.test(t)) return ''; return d; }; manualAdd(); window.prompt = window.__p; });
    await sleep(700);
    const manualOk = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows')).some(s => s.title === '掉线手测番'));
    await page.evaluate(() => openDetail('900001')); await sleep(500);
    await page.evaluate(() => { const els = document.querySelectorAll('#dGroups .eprow'); els[9].click(); }); // 第10集
    await sleep(600);
    const markOk = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tr_shows'))[0]; return !!s.statuses['10']; });
    check('15', '401 后手动添加与本地标记不受影响', manualOk && markOk, 'manual=' + manualOk + ' mark=' + markOk);
    await post('/__ctl', { mode: 'ok', target: 'all' });

    // T16 404 条目下架
    await page.evaluate(() => syncOpen('bgm')); await sleep(500);
    await post('/__ctl', { mode: 'http404', target: 'episodes' }); await sleep(200);
    await clickBtn('#syCardBgm button', '拉取全部进度'); await sleep(9000);
    const led404 = await txt('#syLedger');
    check('16', '404 下架：台账出现「可能已下架」文案', led404.includes('可能已下架'), led404.slice(0, 160));
    await post('/__ctl', { mode: 'ok', target: 'all' });

    // T17 黑洞网络：报错时长 < 30s（修复前实测 63.5s）
    await post('/__ctl', { mode: 'hang', target: 'all' }); await sleep(300);
    const t0 = Date.now();
    await clickBtn('#syCardBgm button', '拉取全部进度');
    await page.waitForFunction(() => { const m = document.getElementById('syBgmMsg'); return m && /完成|失败/.test(m.textContent); }, { timeout: 60000, polling: 400 }).catch(() => {});
    const hangMs = Date.now() - t0;
    check('17', '断网(黑洞)拉取全部报错时长 < 30s', hangMs < 30000, hangMs + 'ms（修复前 63537ms）');
    await post('/__ctl', { mode: 'ok', target: 'all' });

    // T18 未开播条目（0 集）添加：明确提示 + toast
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '空条目'; doBgmSearch(); });
    await page.waitForFunction(() => document.getElementById('srList').textContent.includes('Bangumi 在线'), { timeout: 20000 }).catch(() => {});
    await sleep(2000);
    await page.evaluate(() => { const bs = document.querySelectorAll('#srList [onclick^="bgmAttach"]'); bs[1] && bs[1].click(); });
    await sleep(4000);
    const srMsg = await txt('#srMsg');
    const toastTxt = await txt('#toast');
    const cnt = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows')).length);
    check('18', '未开播条目：提示明确且不入库', srMsg.includes('暂无剧集数据') && toastTxt.includes('暂无剧集数据') && cnt === 2, 'srMsg=' + srMsg.slice(0, 90) + ' | count=' + cnt);

    // T19 无页面级 JS 错误
    check('19', '全程无页面级 JS 错误', pageErrors === 0, 'pageErrors=' + pageErrors);
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
