/* v2.12.0 右键菜单 + 重复检测：浏览器 E2E（真实 Chrome + 项目自带服务器）
   复用项目资产：服务器-空闲自退.py；轮询就绪，不用固定 sleep 等服务器；
   拦掉外部 API 让测试不依赖网络；断言 pageerror === 0。 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8124;
const PY = process.env.AT_PY || (function () {
  try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
    const fb = String.raw`C:/Users/Venus/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe`;
    console.warn('[tests] PATH 中未找到 python，回退旧写死路径：' + fb + '（可用环境变量 AT_PY 覆盖）');
    return fb;
  }
})();
const CHROME = process.env.AT_CHROME || String.raw`C:/Program Files/Google/Chrome/Application/chrome.exe`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function probe(port, p) {
  return new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 1200 }, r => { r.resume(); res(true); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}

let pass = 0, fail = 0;
const failures = [];
function check(id, desc, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + id + ' ' + desc); }
  else { fail++; failures.push(id + ' ' + desc); console.log('FAIL ' + id + ' ' + desc + (extra ? '  :: ' + extra : '')); }
}

(async () => {
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'),
    '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });

  let ready = false;
  for (let i = 0; i < 40; i++) { if (await probe(PORT, '/index.html')) { ready = true; break; } await sleep(400); }
  check('01', '项目自带服务器启动并可访问', ready);
  if (!ready) { srv.kill(); process.exit(1); }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=430,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  /* 「标记到这一集为止」等操作带 confirm()，无头环境必须自动接受，
     否则对话框会挂住 evaluate（实测踩过：Runtime.callFunctionOn timed out）。 */
  page.on('dialog', async d => { try { await d.accept(); } catch (e) {} });
  /* 外部 API 一律拦掉，测试不依赖网络 */
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/api\.bgm\.tv|tcb-api\.tencentcloudapi\.com|cloudbase/i.test(u)) { r.abort().catch(() => {}); }
    else r.continue().catch(() => {});
  });

  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(1600);

  /* ---- 造测试数据：走 addShow 真函数（技能里记的坑：直接改 localStorage 不刷新内存 shows[]） ---- */
  await page.evaluate(() => {
    try { localStorage.removeItem('tr_shows'); } catch (e) {}
    window.shows = [];
  });
  await page.evaluate(() => {
    /* 用真实 addShow 写入两条同名但不同年份/集数（模拟「海贼王」这种情况） */
    addShow({ sid: 't-tv', title: '海贼王', year: '1999', total: 1168, cover: '', eps: [] });
    addShow({ sid: 't-mv', title: '海贼王 剧场版', year: '2000', total: 41, cover: '', eps: [] });
    /* 再写入一条集数齐全的，用来测剧集行右键 */
    addShow({ sid: 't-eps', title: '测试番', year: '2020', total: 6, cover: '',
      eps: [{ s: 1, t: '第一集' }, { s: 2, t: '第二集' }, { s: 3, t: '第三集' }, { s: 4, t: '第四集' }] });
    renderList();
  });
  await sleep(500);

  /* ---- 02 片单卡片带 data-sid ---- */
  const cards = await page.evaluate(() => {
    const ns = document.querySelectorAll('#list .show[data-sid]');
    return { n: ns.length, sids: Array.from(ns).map(x => x.getAttribute('data-sid')) };
  });
  check('02', '片单卡片都带 data-sid 且挂了 ctxable', cards.n === 3 && cards.sids.indexOf('t-tv') >= 0, JSON.stringify(cards));

  /* ---- 03 右键打开菜单 ---- */
  const box = await page.evaluate(() => {
    const el = document.querySelector('#list .show[data-sid="t-tv"]');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await sleep(320);
  const menu1 = await page.evaluate(() => {
    const m = document.querySelector('.ctxmenu');
    if (!m) return { ok: false };
    const style = getComputedStyle(m);
    return {
      ok: m.classList.contains('on'),
      items: Array.from(m.querySelectorAll('.ctxi')).map(b => b.querySelector('span:nth-child(2)').textContent),
      head: (m.querySelector('.ctxhd') || {}).textContent || '',
      visible: style.opacity === '1',
    };
  });
  check('03', '右键片单卡能打开菜单且可见', menu1.ok && menu1.visible, JSON.stringify(menu1));
  check('04', '片单菜单含「从片单移除」「复制番名」「标记下一集已看」',
    menu1.items.some(t => t.indexOf('从片单移除') >= 0) &&
    menu1.items.some(t => t.indexOf('复制番名') >= 0) &&
    menu1.items.some(t => t.indexOf('标记下一集已看') >= 0),
    JSON.stringify(menu1.items));
  check('05', '菜单标题显示番名与集数', /海贼王/.test(menu1.head) && /1168/.test(menu1.head), menu1.head);
  check('06', '当前状态「在看」不在菜单里重复出现',
    !menu1.items.some(t => t.indexOf('改为「在看」') >= 0), JSON.stringify(menu1.items));

  /* ---- 07 点菜单项：改状态 ---- */
  const changed = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.ctxmenu .ctxi'));
    const b = btns.filter(x => x.textContent.indexOf('改为「看完」') >= 0)[0];
    if (!b) return { ok: false };
    b.click();
    return { ok: true, status: (typeof bySid === 'function') && (bySid('t-tv') || {}).status };
  });
  await sleep(300);
  const afterChange = await page.evaluate(() => {
    const s = bySid('t-tv');
    return { status: s && s.status, menuGone: !document.querySelector('.ctxmenu.on') };
  });
  check('07', '点「改为看完」真的改了状态且菜单已关闭',
    changed.ok && afterChange.status === 'done' && afterChange.menuGone, JSON.stringify(afterChange));

  /* ---- 08 Esc 关闭菜单 ---- */
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await sleep(250);
  const opened2 = await page.evaluate(() => !!(document.querySelector('.ctxmenu') || {}).classList && document.querySelector('.ctxmenu').classList.contains('on'));
  await page.keyboard.press('Escape');
  await sleep(220);
  const closed = await page.evaluate(() => document.querySelector('.ctxmenu').classList.contains('on'));
  check('08', 'Esc 能关闭菜单', opened2 && !closed, JSON.stringify({ opened2, closed }));

  /* ---- 09 点别处关闭菜单 ---- */
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await sleep(250);
  await page.mouse.click(30, 700);
  await sleep(250);
  const closed2 = await page.evaluate(() => document.querySelector('.ctxmenu').classList.contains('on'));
  check('09', '点页面别处能关闭菜单', !closed2);

  /* ---- 10 菜单不出界（右侧边缘右键） ---- */
  await page.evaluate(() => {
    const el = document.querySelector('#list .show[data-sid="t-mv"]');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 425, clientY: 860 }));
  });
  await sleep(300);
  const edge = await page.evaluate(() => {
    const m = document.querySelector('.ctxmenu');
    const r = m.getBoundingClientRect();
    return { on: m.classList.contains('on'), right: Math.round(r.right), bottom: Math.round(r.bottom), w: window.innerWidth, h: window.innerHeight };
  });
  check('10', '贴右下角右键时菜单不出界（自动回弹）',
    edge.on && edge.right <= edge.w - 4 && edge.bottom <= edge.h - 4, JSON.stringify(edge));

  /* ---- 11 剧集行右键 ---- */
  await page.evaluate(() => { window.__closeCtxAll && window.__closeCtxAll(); closeCtx(); });
  await page.evaluate(() => { openDetail('t-eps'); });
  await sleep(700);
  const epMenu = await page.evaluate(() => {
    const row = document.querySelector('#dGroups .eprow[data-ep="2"]');
    if (!row) return { ok: false, reason: 'no eprow' };
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 20) }));
    return { ok: true };
  });
  await sleep(320);
  const epMenuItems = await page.evaluate(() => {
    const m = document.querySelector('.ctxmenu');
    if (!m || !m.classList.contains('on')) return { ok: false };
    return {
      ok: true,
      head: (m.querySelector('.ctxhd') || {}).textContent || '',
      items: Array.from(m.querySelectorAll('.ctxi')).map(b => b.querySelector('span:nth-child(2)').textContent),
    };
  });
  check('11', '剧集行右键能打开菜单', epMenu.ok && epMenuItems.ok, JSON.stringify({ epMenu, epMenuItems }));
  check('12', '剧集菜单含「标记到这一集为止」与「标记已看」',
    (epMenuItems.items || []).some(t => t.indexOf('标记到这一集为止') >= 0) &&
    (epMenuItems.items || []).some(t => t.indexOf('标记已看') >= 0),
    JSON.stringify(epMenuItems.items));
  check('13', '剧集菜单标题显示集号与集名',
    /第 2 集/.test(epMenuItems.head || '') && /第二集/.test(epMenuItems.head || ''), epMenuItems.head);

  /* ---- 14 剧集菜单：标记到这一集为止 ---- */
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.ctxmenu .ctxi'));
    const b = btns.filter(x => x.textContent.indexOf('标记到这一集为止') >= 0)[0];
    if (b) b.click();
  });
  await sleep(350);
  const bulk = await page.evaluate(() => {
    const s = bySid('t-eps');
    const w = (s.eps || []).filter(e => epStat(s, e.s) === 'watched').map(e => e.s);
    return { watched: w, menuGone: !document.querySelector('.ctxmenu.on') };
  });
  check('14', '「标记到第 2 集为止」把第 1、2 集标为已看',
    bulk.watched.join(',') === '1,2' && bulk.menuGone, JSON.stringify(bulk));

  /* ---- 15 菜单内的「复制番名」不报错（无剪贴板权限也应兜底） ---- */
  await page.evaluate(() => { backList(); });
  await sleep(450);
  await page.evaluate(() => {
    const el = document.querySelector('#list .show[data-sid="t-tv"]');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 20) }));
  });
  await sleep(300);
  const beforeErr = pageErrors.length;
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.ctxmenu .ctxi'));
    const b = btns.filter(x => x.textContent.indexOf('复制番名') >= 0)[0];
    if (b) b.click();
  });
  await sleep(450);
  const toastTxt = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  check('15', '点「复制番名」触发 toast 且不产生页面错误',
    /已复制|复制失败/.test(toastTxt) && pageErrors.length === beforeErr, JSON.stringify({ toastTxt, newErr: pageErrors.slice(beforeErr) }));

  /* ---- 24 原有功能未退化：卡片左键仍能进详情 ---- */
  await page.evaluate(() => { closeCtx(); });
  await sleep(200);
  const clickOk = await page.evaluate(() => {
    const el = document.querySelector('#list .show[data-sid="t-tv"] .info');
    if (!el) return false;
    el.click();
    return true;
  });
  await sleep(600);
  const inDetail = await page.evaluate(() => {
    const d = document.getElementById('vDetail');
    return { shown: d && d.style.display !== 'none', title: (document.getElementById('dTitle') || {}).textContent };
  });
  check('24', '卡片左键点击仍能正常进入详情页（未退化）',
    clickOk && inDetail.shown && /海贼王/.test(inDetail.title || ''), JSON.stringify(inDetail));
  /* 回到列表，避免影响后续用例 */
  await page.evaluate(() => { if (typeof backList === 'function') backList(); });
  await sleep(400);

  /* ---- 16 重复检测：同名不同作品不该被判为重复 ----
     （放在最后做，因为它会往片单里加数据） */
  const dup1 = await page.evaluate(() => {
    const gs = findAllDupGroups();
    return {
      n: gs.length,
      groups: gs.map(g => ({ key: g.key, titles: g.items.map(x => x.title), sev: dupSeverity(g) })),
    };
  });
  check('16', '「海贼王」与「海贼王 剧场版」不被判为重复组', dup1.n === 0, JSON.stringify(dup1));

  /* ---- 17 真重复能被检出 ----
     注意：addShow 自带同名去重（跨源防重复），所以直接 addShow 第二条会被拦。
     这里用 shows.push 绕过 —— 正是为了模拟「历史数据里已经存在两条」的情况。 */
  const dup2 = await page.evaluate(() => {
    shows.push({ sid: 't-dup', title: '海贼王', year: '1999', total: 1168, cover: '', eps: [] });
    const gs = findAllDupGroups();
    const hit = gs.filter(g => g.items.some(x => x.sid === 't-dup'))[0];
    return { n: gs.length, sev: hit ? dupSeverity(hit) : null, titles: hit ? hit.items.map(x => x.title) : null };
  });
  check('17', '存在同年同集数的同名条目 → 检出为同一组且判 same',
    dup2.n === 1 && dup2.sev === 'same', JSON.stringify(dup2));

  /* ---- 18 报告 UI：两类分开呈现 ---- */
  const rep = await page.evaluate(() => {
    /* 再加一条同名但不同集数，制造 maybe 类 */
    shows.push({ sid: 't-dup2', title: '海贼王', year: '2023', total: 8, cover: '', eps: [] });
    const host = document.createElement('div');
    host.id = 'optDupResult';
    document.body.appendChild(host);
    renderDupReport(host);
    const txt = host.textContent;
    host.remove();
    return { txt: txt.slice(0, 500) };
  });
  check('18', '报告同时给出「疑似重复」与「同名但不同的作品」两类',
    /组疑似重复/.test(rep.txt) && /同名但不同的作品/.test(rep.txt), rep.txt.slice(0, 260));
  check('19', '报告明确说明同名不同作品「不是重复数据」', /不是重复数据/.test(rep.txt), rep.txt.slice(0, 260));
  /* ---- 20 账号面板里真的有「片单整理」入口 ---- */
  const acct = await page.evaluate(() => {
    try { if (typeof openAccount === 'function') openAccount(); } catch (e) {}
    return {
      hasCard: !!Array.from(document.querySelectorAll('.sycard h4')).filter(h => /片单整理/.test(h.textContent)).length,
      hasBtn: !!document.getElementById('optDupScan'),
      hasResult: !!document.getElementById('optDupResult'),
    };
  });
  await sleep(400);
  check('20', '账号面板有「片单整理」卡 + 检查按钮 + 结果容器',
    acct.hasCard && acct.hasBtn && acct.hasResult, JSON.stringify(acct));

  /* ---- 21 点检查按钮能出结果 ---- */
  const scan = await page.evaluate(() => {
    const b = document.getElementById('optDupScan');
    if (b) b.click();
    return true;
  });
  await sleep(400);
  const scanOut = await page.evaluate(() => (document.getElementById('optDupResult') || {}).textContent || '');
  check('21', '点「检查重复番剧」真的渲染出报告',
    scan && scanOut.length > 8 && /组疑似重复|同名但不同的作品|没有发现重复/.test(scanOut), scanOut.slice(0, 160));

  /* ---- 22 长按路径（触屏模拟） ---- */
  await page.evaluate(() => { window.__closeSync && window.__closeSync(); closeCtx(); backList(); });
  await sleep(400);
  const longPress = await page.evaluate(async () => {
    const el = document.querySelector('#list .show[data-sid="t-tv"]');
    if (!el) return { ok: false, reason: 'no card' };
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + 30);
    const mk = (type, extra) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t], ...extra });
    };
    el.dispatchEvent(mk('touchstart'));
    await new Promise(r => setTimeout(r, 700));          /* 超过 500ms 长按阈值 */
    const on = !!(document.querySelector('.ctxmenu') || {}).classList && document.querySelector('.ctxmenu').classList.contains('on');
    el.dispatchEvent(mk('touchend'));
    return { ok: on };
  });
  await sleep(300);
  check('22', '长按 700ms 能打开菜单（手机端路径）', longPress.ok, JSON.stringify(longPress));

  /* ---- 23 长按后不误触发卡片点击（不该跳详情页） ---- */
  const afterLong = await page.evaluate(() => {
    const d = document.getElementById('vDetail');
    return { detailShown: d && d.style.display !== 'none' };
  });
  check('23', '长按开菜单后没有误跳到详情页', !afterLong.detailShown, JSON.stringify(afterLong));

  /* ---- 25 全程零页面错误 ---- */
  check('25', '全程无页面级 JS 错误', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 4)));

  await browser.close();
  srv.kill();

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
  if (fail) { console.log('\n失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  fs.writeFileSync(path.join(__dirname, 'last-ctxmenu-e2e.json'),
    JSON.stringify({ pass, fail, failures, pageErrors, at: new Date().toISOString() }, null, 2));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E 崩溃：', e); process.exit(1); });
