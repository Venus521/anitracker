/* run-v270-tests.js — AniTracker 专项测试（草稿保护 / 双语 / 别名联想 / 关联 / 分类实测 / 质量面板；
   T08 的「台账 + 修改历史」在 v2.14.0d 已按用户指令整块退役，那两条现在是**防复活**断言，别改回旧功能 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const ROOT = String.raw`D:\项目\01_媒体娱乐\ani-tracker`;
const OUT = path.join(ROOT, 'tests', '_artifacts', 'v270');
const PORT = 8100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(id, name, ok, detail) {
  results.push({ id: id, name: name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' T' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 220)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const pySrv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '900'], { stdio: 'ignore' });
  await sleep(1800);
  let browser;
  const pageErrors = [];
  /* 导航轨迹：这份门禁跑在 page.reload() 之后，页面里任何一次 history.back() 若和 pushState 对不上，
     就会真的退回「上一个文档」把执行上下文掀掉（表现为「Execution context was destroyed」且不知道死在哪步）。
     留一条轨迹，崩在哪一步、是不是导航引起，一眼可判。 */
  const navs = [];
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    page.on('dialog', d => d.accept());
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
    page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push(f.url().replace('http://127.0.0.1:' + PORT, '')); });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html?v=t270', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);

    /* 种子数据 */
    await page.evaluate(() => {
      const mk = (sid, title, jp, aliases, n) => ({
        sid: sid, title: title, nameJp: jp, aliases: aliases, year: '1999', total: n,
        status: 'watching', statuses: {}, addedAt: Date.now(), updAt: Date.now(),
        eps: Array.from({ length: n }, (_, i) => ({ s: i + 1, t: '第 ' + (i + 1) + ' 集' })), source: '测试种子'
      });
      localStorage.setItem('tr_shows', JSON.stringify([
        mk('test-op', '海贼王', 'One Piece', ['台译: 航海王', '罗马字: ONE PIECE'], 80),
        mk('test-nr', '火影忍者', 'Naruto', [], 5)
      ]));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2200);

    /* T01 版本与模块 */
    const t01 = await page.evaluate(() => ({ ver: (typeof AT_VERSION !== 'undefined') ? AT_VERSION : null, at270: !!(window.AT270 && AT270.V) }));
    check('01', '版本号是 x.y.z 且 AT270 模块就位', /^[\d.]+$/.test(String(t01.ver)) && t01.at270 === true, JSON.stringify(t01));

    /* T02 草稿：注册面板 点空白 → 自动存草稿 → 重开恢复 */
    await page.evaluate(() => { openAccount(); });
    await sleep(1600);
    await page.evaluate(() => { const l = document.getElementById('cbToReg'); if (l) l.click(); });
    await sleep(400);
    await page.evaluate(() => { document.getElementById('cbEmail').value = 'draft-op@example.com'; document.getElementById('cbEmailPass').value = 'DraftPass0916'; });
    await page.mouse.click(6, 6);
    await sleep(600);
    const t02a = await page.evaluate(() => {
      let d = null; try { d = JSON.parse(localStorage.getItem('at_drafts') || '{}'); } catch (e) {}
      return { mask: !!document.getElementById('syncMask'), draft: (d && d.syncMask) ? Object.keys(d.syncMask.fields).length : 0 };
    });
    check('02a', '点空白关闭后：面板已关且草稿已保存', t02a.mask === false && t02a.draft >= 2, JSON.stringify(t02a));
    await page.evaluate(() => { openAccount(); });
    await sleep(1400);
    await page.evaluate(() => { const l = document.getElementById('cbToReg'); if (l) l.click(); });
    await sleep(400);
    const t02b = await page.evaluate(() => {
      const band = document.querySelector('#syncMask .at270band');
      return { band: !!band, text: band ? band.textContent.slice(0, 60) : '' };
    });
    check('02b', '重新打开出现「恢复草稿」横幅', t02b.band === true, JSON.stringify(t02b));
    await page.evaluate(() => { const b = document.querySelector('#syncMask .at270band button.pri'); if (b) b.click(); });
    await sleep(400);
    const t02c = await page.evaluate(() => ({ email: document.getElementById('cbEmail') ? document.getElementById('cbEmail').value : '', pass: document.getElementById('cbEmailPass') ? document.getElementById('cbEmailPass').value : '' }));
    check('02c', '一键恢复已填内容（邮箱+密码）', t02c.email === 'draft-op@example.com' && t02c.pass === 'DraftPass0916', JSON.stringify(t02c));
    try { await page.screenshot({ path: OUT + '\\t02-draft-restored.png' }); } catch (e) {}
    await page.evaluate(() => { try { window.__closeSync(); } catch (e) {} });

    /* T03 手动添加：草稿 + 保存 + 去重 */
    await page.evaluate(() => { manualAdd(); });
    await sleep(600);
    const t03a = await page.evaluate(() => !!document.getElementById('at270AddMask'));
    check('03a', '手动添加为模态表单（非 prompt 链）', t03a === true, '');
    await page.evaluate(() => {
      document.getElementById('at270AddTitle').value = '测试番X';
      document.getElementById('at270AddJp').value = 'Test Anime X';
      document.getElementById('at270AddAlias').value = '台译: 测试别名\n简称: 测X';
      document.getElementById('at270AddTotal').value = '3';
    });
    await page.mouse.click(6, 6);
    await sleep(600);
    const t03b = await page.evaluate(() => { let d = {}; try { d = JSON.parse(localStorage.getItem('at_drafts') || '{}'); } catch (e) {} return { maskGone: !document.getElementById('at270AddMask'), draft: d.at270AddMask ? Object.keys(d.at270AddMask.fields).length : 0 }; });
    check('03b', '手动添加弹层点空白：草稿已保存', t03b.maskGone === true && t03b.draft >= 3, JSON.stringify(t03b));
    await page.evaluate(() => { manualAdd(); });
    await sleep(600);
    await page.evaluate(() => { const b = document.querySelector('#at270AddMask .at270band button.pri'); if (b) b.click(); });
    await sleep(300);
    const t03c = await page.evaluate(() => ({ title: document.getElementById('at270AddTitle').value, jp: document.getElementById('at270AddJp').value }));
    check('03c', '恢复草稿：标题/原文名完整回来', t03c.title === '测试番X' && t03c.jp === 'Test Anime X', JSON.stringify(t03c));
    await page.evaluate(() => { document.getElementById('at270AddSave').click(); });
    await sleep(900);
    const t03d = await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = shows.filter(x => x.title === '测试番X')[0];
      return s ? { found: true, aliases: s.aliases, jp: s.nameJp, eps: s.eps.length } : { found: false };
    });
    check('03d', '保存成功（别名 2 条 / 原文名 / 3 集）', t03d.found && t03d.aliases.length === 2 && t03d.jp === 'Test Anime X' && t03d.eps === 3, JSON.stringify(t03d));
    await page.evaluate(() => { manualAdd(); });
    await sleep(500);
    await page.evaluate(() => { document.getElementById('at270AddTitle').value = '测试番X'; document.getElementById('at270AddSave').click(); });
    await sleep(400);
    const t03e = await page.evaluate(() => {
      const msg = document.getElementById('at270AddMsg');
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      return { msg: (msg ? msg.textContent : ''), count: shows.filter(x => x.title === '测试番X').length };
    });
    check('03e', '重复添加被拦截', t03e.count === 1 && /已在片单/.test(t03e.msg), JSON.stringify(t03e));
    await page.evaluate(() => { const m = document.getElementById('at270AddMask'); if (m) m.remove(); });

    /* T04 别名/归一化检索 */
    const t04 = await page.evaluate(() => ({
      a: ownedInList('测试别名').map(x => x.title),
      b: ownedInList('ONE PIECE').map(x => x.title),
      c: ownedInList('one piece').map(x => x.title),
      d: ownedInList('航海王').map(x => x.title)
    }));
    check('04', '别名检索命中（台译/英文/原名多项写法）', t04.a.indexOf('测试番X') >= 0 && t04.b.indexOf('海贼王') >= 0 && t04.d.indexOf('海贼王') >= 0, JSON.stringify(t04));

    /* T05 集名双语 */
    await page.evaluate(() => { openDetail('test-op'); });
    await sleep(1100);
    await page.evaluate(() => { editSrc(2); });
    await sleep(400);
    await page.evaluate(() => {
      document.getElementById('seTO').value = 'Grand Line!';
      document.getElementById('seTC').value = '伟大航路';
      document.getElementById('seSave').click();
    });
    await sleep(800);
    const t05a = await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = shows.filter(x => x.sid === 'test-op')[0];
      const e = s.eps.filter(x => x.s === 2)[0];
      return { tOrig: e.tOrig, tCn: e.tCn, t: e.t };
    });
    check('05a', '集名双语保存（tOrig/tCn 落库）', t05a.tOrig === 'Grand Line!' && t05a.tCn === '伟大航路' && t05a.t === '伟大航路', JSON.stringify(t05a));
    const t05b = await page.evaluate(() => {
      const rows = document.querySelectorAll('#dGroups .eprow');
      let hit = '';
      rows.forEach(r => { const t2 = r.querySelector('.at270t2'); if (t2 && /Grand Line/.test(t2.textContent)) hit = r.querySelector('.nm').textContent; });
      return hit;
    });
    check('05b', '列表行显示第二语言一行', /Grand Line/.test(t05b) && /伟大航路/.test(t05b), t05b.slice(0, 80));
    const t05c = await page.evaluate(() => {
      const q = document.getElementById('qFilter');
      q.value = 'grand'; q.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof renderGrid === 'function') renderGrid();
      const n1 = document.querySelectorAll('#dGroups .eprow').length;
      q.value = '伟大航路'; renderGrid();
      const n2 = document.querySelectorAll('#dGroups .eprow').length;
      q.value = '77'; renderGrid();
      const n3 = document.querySelectorAll('#dGroups .eprow').length;
      q.value = ''; renderGrid();
      return { n1: n1, n2: n2, n3: n3 };
    });
    check('05c', '筛选支持两种语言写法与集号', t05c.n1 === 1 && t05c.n2 === 1 && t05c.n3 === 1, JSON.stringify(t05c));
    try { await page.screenshot({ path: OUT + '\\t05-bilingual-row.png' }); } catch (e) {}

    /* T06 联想 */
    await page.evaluate(() => { backList(); showAdd(); });
    await sleep(600);
    await page.evaluate(() => {
      const q = document.getElementById('qKw');
      q.value = '海贼'; q.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(400);
    const t06a = await page.evaluate(() => {
      const box = document.querySelector('.at270sug');
      return { shown: !!(box && box.style.display !== 'none'), items: box ? box.querySelectorAll('.it').length : 0, first: box && box.querySelector('.it') ? box.querySelector('.it').textContent.slice(0, 40) : '' };
    });
    check('06a', '输入「海贼」出现联想候选', t06a.shown && t06a.items >= 1, JSON.stringify(t06a));
    await page.evaluate(() => { const it = document.querySelector('.at270sug .it'); if (it) it.click(); });
    await sleep(300);
    const t06b = await page.evaluate(() => document.getElementById('qKw').value);
    check('06b', '点击候选一键填入', t06b === '海贼王', t06b);
    try { await page.screenshot({ path: OUT + '\\t06-suggest.png' }); } catch (e) {}
    await page.evaluate(() => { backList(); });
    await sleep(400);

    /* T07 关联条目（双向 + 解除） */
    await page.evaluate(() => { openDetail('test-op'); });
    await sleep(1000);
    await page.evaluate(() => { const b = document.getElementById('at270AddRel'); if (b) b.click(); });
    await sleep(500);
    await page.evaluate(() => {
      const r = document.querySelectorAll('#at270RelMask input[name=at270RelT]');
      if (r[1]) r[1].checked = true; /* 续作 */
      const kw = document.getElementById('at270RelKw');
      kw.value = '火影'; kw.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(400);
    await page.evaluate(() => { const it = document.querySelector('.at270sug .it'); if (it) it.click(); });
    await sleep(250);
    await page.evaluate(() => { document.getElementById('at270RelSave').click(); });
    await sleep(600);
    const t07a = await page.evaluate(() => { let r = []; try { r = JSON.parse(localStorage.getItem('at_relations') || '[]'); } catch (e) {} return r; });
    check('07a', '建立关联（续作）成功', t07a.length === 1 && t07a[0].type === '续作', JSON.stringify(t07a));
    const t07b = await page.evaluate(() => { const box = document.getElementById('at270Box'); return box ? box.textContent.indexOf('火影忍者') >= 0 : false; });
    check('07b', 'A 条目详情显示关联', t07b === true, '');
    await page.evaluate(() => { openDetail('test-nr'); });
    await sleep(900);
    const t07c = await page.evaluate(() => { const box = document.getElementById('at270Box'); return box ? box.textContent.indexOf('海贼王') >= 0 : false; });
    check('07c', 'B 条目详情同样可见（双向）', t07c === true, '');
    /* 解除是破坏性动作：v2.13.0 起走主题确认框（#udYes），不点确认就不该掉数据 */
    await page.evaluate(() => { const rows = document.querySelectorAll('#at270Box .at270row'); for (const r of rows) { const b = r.querySelector('button'); if (b && /解除/.test(b.textContent)) { b.click(); break; } } });
    await sleep(400);
    const t07d1 = await page.evaluate(() => { let r = []; try { r = JSON.parse(localStorage.getItem('at_relations') || '[]'); } catch (e) {} return { ask: !!document.getElementById('udYes'), count: r.length }; });
    check('07d1', '点「解除」先要确认，未确认不删数据', t07d1.ask === true && t07d1.count === 1, JSON.stringify(t07d1));
    await page.evaluate(() => { const y = document.getElementById('udYes'); if (y) y.click(); });
    await sleep(600);
    const t07d = await page.evaluate(() => { let r = []; try { r = JSON.parse(localStorage.getItem('at_relations') || '[]'); } catch (e) {} return r.length; });
    check('07d', '确认解除后清零', t07d === 0, 'count=' + t07d);

    /* T08 资料编辑 + 台账/历史（已退役，此处是防复活门禁） */
    await page.evaluate(() => { openDetail('test-op'); });
    await sleep(900);
    await page.evaluate(() => { const b = document.getElementById('at270EditProf'); if (b) b.click(); });
    await sleep(400);
    await page.evaluate(() => { document.getElementById('at270ProfJp').value = 'ONE PIECE (1999)'; document.getElementById('at270ProfSave').click(); });
    await sleep(600);
    const t08a = await page.evaluate(() => { const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]'); const s = shows.filter(x => x.sid === 'test-op')[0]; return s.nameJp; });
    check('08a', '资料编辑保存（原文名更新）', t08a === 'ONE PIECE (1999)', t08a);
    /* v2.14.0d 用户指令「已有的记录全清空」：logEdit 停笔、at_edit_log 加载即删、修改历史区连同入口一起拆。
       这三条测的是「不再长回来」，不是旧功能——改回绿的方式只有继续退役，别把展示加回去。 */
    const t08b = await page.evaluate(() => ({ raw: localStorage.getItem('at_edit_log'), n: (function () { try { return (JSON.parse(localStorage.getItem('at_edit_log') || '[]')).length; } catch (e) { return -1; } })() }));
    check('08b', '修改台账已退役：编辑后仍无存量', t08b.raw === null && t08b.n === 0, JSON.stringify(t08b));
    const t08c = await page.evaluate(() => {
      const box = document.getElementById('at270Box');
      return { btn: !!document.getElementById('at270HistAll'), mask: !!document.getElementById('at270HistMask'),
        head: box ? /修改历史|全部历史/.test(box.textContent) : true };
    });
    check('08c', '详情页不留「修改历史」入口', t08c.btn === false && t08c.mask === false && t08c.head === false, JSON.stringify(t08c));

    /* T09 分类实测：海贼王 54→TV原创 / 45→半原创 / 1→漫改 */
    await page.evaluate(async () => { try { await batchCalibrateAll(); } catch (e) {} });
    await sleep(2500);
    const t09a = await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = shows.filter(x => x.sid === 'test-op')[0];
      return { filler: (s.filler || '').slice(0, 80), mixed: (s.mixed || '').slice(0, 80) };
    });
    check('09a', '批量校准命中新数据（f/m 已挂到条目）', /54/.test(t09a.filler) && /45/.test(t09a.mixed), JSON.stringify(t09a));
    const t09b = await page.evaluate(() => {
      const s = bySid('test-op');
      const f = n => { const e = (s.eps || []).filter(x => x.s === n)[0]; return epTypeOf(s, e); };
      return { e54: f(54), e45: f(45), e1: f(1) };
    });
    check('09b', '54→TV原创 / 45→半原创 / 1→漫改', t09b.e54 === 'filler' && t09b.e45 === 'semi' && t09b.e1 === 'canon', JSON.stringify(t09b));
    /* 自动校准通路：清快照版本 → 重载 → 等待 boot 自动校准 */
    await page.evaluate(() => { localStorage.setItem('at_fg_snap', '"old"'); localStorage.removeItem('at_fg_cache'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(9000);
    const t09c = await page.evaluate(() => { const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]'); const s = shows.filter(x => x.sid === 'test-op')[0]; return { snap: localStorage.getItem('at_fg_snap'), filler: (s.filler || '').length }; });
    check('09c', '版本变化自动校准通路生效', t09c.snap === '"20260916b"' && t09c.filler > 0, JSON.stringify(t09c));

    /* T10 数据质量面板 + 审计数据 */
    await sleep(500);
    await page.evaluate(() => { AT270.quality(); });
    await sleep(600);
    const t10a = await page.evaluate(() => {
      const box = document.getElementById('at270QualMask');
      return { open: !!box, text: box ? box.textContent.replace(/\s+/g, ' ').slice(0, 120) : '' };
    });
    check('10a', '数据质量面板可打开且含覆盖率', t10a.open === true && /漫改|待核/.test(t10a.text), t10a.text.slice(0, 100));
    const t10b = await page.evaluate(() => { const a = AT270.audit(); return { series: a.series, missingOrig: a.missingOrig, cov: a.cov, alias: a.aliasSeries }; });
    check('10b', '审计数据可计算（含双语缺口）', t10b.series >= 3 && t10b.missingOrig >= 70, JSON.stringify(t10b));
    try { await page.screenshot({ path: OUT + '\\t10-quality.png' }); } catch (e) {}

    /* T12 空剧集本地方案（无 Bangumi） */
    await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      shows.push({ sid: 'test-eps1', title: '海贼王', nameJp: 'One Piece', aliases: [], year: '1999', total: 0, status: 'watching', statuses: {}, addedAt: Date.now(), updAt: Date.now(), eps: [], source: '测试种子' });
      shows.push({ sid: 'test-eps2', title: '测试番Y', nameJp: '', aliases: [], year: '', total: 6, status: 'watching', statuses: {}, addedAt: Date.now(), updAt: Date.now(), eps: [], source: '测试种子' });
      localStorage.setItem('tr_shows', JSON.stringify(shows));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    await page.evaluate(() => { openDetail('test-eps1'); });
    await sleep(1000);
    const t12a = await page.evaluate(() => {
      const g = document.getElementById('dGroups').textContent;
      const hasBtn = /从内置库补齐/.test(g) && /生成第1–N集/.test(g);
      AT270.fillFromLib();
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = shows.filter(x => x.sid === 'test-eps1')[0];
      return { hasBtn: hasBtn, eps: (s.eps || []).length, firstTitle: (s.eps || [])[0] ? (s.eps || [])[0].t.slice(0, 24) : '' };
    });
    check('12a', '内置库补齐剧集（海贼王中文集名，无需 Bangumi）', t12a.hasBtn === true && t12a.eps > 1000, JSON.stringify({ eps: t12a.eps, firstTitle: t12a.firstTitle }));
    await page.evaluate(() => { openDetail('test-eps2'); });
    await sleep(900);
    const t12b = await page.evaluate(() => {
      AT270.fillPlaceholders();
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = shows.filter(x => x.sid === 'test-eps2')[0];
      return { eps: (s.eps || []).length, t1: (s.eps || [])[0] ? (s.eps || [])[0].t : '' };
    });
    check('12b', '生成第1–N集占位（6 集）', t12b.eps === 6 && t12b.t1 === '第 1 集', JSON.stringify(t12b));

    /* T11 无 JS 错误 */
    check('11', '全程无页面 JS 错误', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

  } catch (e) {
    check('99', '测试执行异常', false, String(e) + ' 最近导航：' + JSON.stringify(navs.slice(-3)));
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { pySrv.kill(); } catch (e) {}
  }
  fs.writeFileSync(path.join(ROOT, 'tests', 'last-v270-test.json'), JSON.stringify({ at: new Date().toISOString(), results: results }, null, 1), 'utf-8');
  const okN = results.filter(r => r.ok).length;
  console.log('SUMMARY: ' + okN + '/' + results.length + ' passed');
  process.exit(results.some(r => !r.ok) ? 1 : 0);
})();
