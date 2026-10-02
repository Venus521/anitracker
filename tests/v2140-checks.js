/* v2140-checks.js — v2.14.0 界面重设计专项断言（AniList 混合风列表 / 双视图 / 集数批量标记 / 宫格）
   用法：npm run test:v2140（自起静态服务 8097 + Chrome 无头） */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8097;
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' V' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 240)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ---- 文件级 ---- */
  const ib = fs.readFileSync(path.join(ROOT, 'index.html'));
  const ab = fs.readFileSync(path.join(ROOT, 'ani-tracker.html'));
  check('01', '双入口字节一致', ib.equals(ab), ib.length + 'B vs ' + ab.length + 'B');
  const ix = ib.toString('utf-8');
  const verM = ix.match(/AT_VERSION='([^']+)', AT_BUILD='([^']+)'/);
  /* 版本对账以 package.json 为准：写死字面量的话每批都要来改一次断言，忘了改就是假绿 */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  check('02', 'index 版本与 package.json 同步（build 不断言具体字母）', !!verM && verM[1] === pkg.version, verM && verM[0]);
  const tv = JSON.parse(fs.readFileSync(path.join(ROOT, 'tracker-version.json'), 'utf-8'));
  check('03', 'tracker-version.json 与页面一致', verM && tv.version === verM[1] && tv.build === verM[2], tv.version + '/' + tv.build);
  const sw = fs.readFileSync(path.join(ROOT, 'tracker-sw.js'), 'utf-8');
  /* SW 缓存名同样对账：名字里带 build 号，改页面忘改 SW 就直接红，不必每批回来把「v14」改成「v15」 */
  const cacheM = sw.match(/var CACHE='anitracker-v(\d+)-([0-9]{8}[a-z])'/);
  check('04', 'SW 缓存名与页面 build 对齐（当前 anitracker-v' + (cacheM ? cacheM[1] : '?') + '-' + (cacheM ? cacheM[2] : '?') + '）',
    !!cacheM && verM && cacheM[2] === verM[2], cacheM && cacheM[0]);
  check('05', '列表新样式到位（progline/hover操作列/封面墙网格）',
    ix.includes('.show .progline{') && ix.includes('.show:hover .acts') && ix.includes('.cards.grid{'));
  check('06', '双视图切换（at_view 记忆 + toggleListView 重渲染）',
    /function listViewMode\(\)\{[^}]*at_view/.test(ix) && ix.includes("localStorage.setItem('at_view'") && ix.includes('function toggleListView()'));
  check('07', 'epbar 只剩宫格开关（滑动条退役；v2.17.0 来源角标默认常显、开关一并删）',
    !ix.includes('id="epBarR"') && !ix.includes('function markUpTo') && ix.includes('onclick="toggleEpGrid()"') &&
    !ix.includes('toggleEpTy'));
  check('08', '集数点击全部走 epClick（批量手势），无原生 dblclick 绑定',
    (ix.match(/onclick="epClick/g) || []).length >= 2 && !/addEventListener\(['"]dblclick['"]/.test(ix));
  check('09', 'renderList 未知状态兜底（不再渲染 undefined）', ix.includes("(ST_NAME[s.status||'watching']||s.status)"));
  check('10', 'bulkWatchRange 只补空档；历史日志退役（无 bulk 记录写入）',
    ix.includes('epStat(s,e.s)===null') && !ix.includes("bulk:a+'-'+b") && !ix.includes('s.hist.push'));
  check('21', '来源角标降噪：斜纹横幅退役→扁平小角标（align-self 防拉伸成横幅）',
    !ix.includes('repeating-linear-gradient') && ix.includes('.fcnt{display:inline-block;align-self:flex-start'));
  /* v2.21.0：占位图改成灰阶骨架、零文字，「真实入口」这条轴从「文案里写着重拉封面」变成「重拉封面这颗按钮在页上，海报上不写」 */
  const phBlock = ix.slice(ix.indexOf('var COVER_PH_L='), ix.indexOf('function coverPH'));
  check('22', '顶栏图标纯 SVG（无 emoji）+ 补封面入口是详情页按钮、占位图不带文字',
    !/[\u{1F3B2}\u{1F319}\u{1F310}\u{263A}\u{2600}\u{263E}\u{1F501}]/u.test(ix) && ix.includes('var IC_SUN=') &&
    ix.includes('⟳ 重拉封面') && !ix.includes('点「补封面」重新拉取') &&
    phBlock.length > 0 && !phBlock.includes('<text') && !ix.includes('打开详情页「重拉封面」'));
  check('23', '片单与进度一次性大扫除到位：标志守门+备份+全 sid 墓碑防复活+清空',
    ix.includes('at_purge_v2140e') && ix.includes('at_purge_backup') && ix.includes('tomb[String(s.sid)]=t') && ix.includes('shows=[]; wr(LS.shows,shows);'));
  check('25', '拖选标记到位：pointer 三件套+涂选预览样式+拖后 click 吞发',
    ix.includes('function _dmMark(') && ix.includes("document.addEventListener('pointerup'") &&
    ix.includes('.ep.drag,.eprow.drag{') && ix.includes('_dmSuppress'));

  /* v2.14.0j 局域网登录同源中转（免费替代付费跨域设置） */
  check('29', '前端同源中转补丁：SDK 加载前改写网关请求（fetch+XHR 双拦 + LAN 判定 + /cb-relay）',
    ix.includes("var lan=/^(192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/") &&
    ix.includes("function via(u){ return '/cb-relay?t='") &&
    ix.includes('XMLHttpRequest.prototype.open=function') &&
    ix.includes("hd.set('x-target'") &&
    ix.indexOf('cb-relay') < ix.indexOf('vendor/cloudbase.full.js'));
  const srvSrc = fs.readFileSync(path.join(ROOT, '服务器-空闲自退.py'), 'utf-8');
  check('30', '服务器 /cb-relay：仅放行 CloudBase 官方域名（防开放代理）+ 带白名单内 Origin 转发',
    srvSrc.includes("'/cb-relay'") && srvSrc.includes('.tcloudbasegateway.com') &&
    srvSrc.includes("'Origin', 'http://127.0.0.1:%d'") && /_relay_target[\s\S]*?return None/.test(srvSrc));

  /* v2.17.0：原来这条只 grep 字面量「cover:s.cover||''」判重复键，现在季度条里也有这个写法，
     改成直接数 addInternal 函数体内有几个 cover: 键（多写一个就是当年那个错图根因）。 */
  const addInternalSrc = (ix.match(/async function addInternal\(id\)\{[\s\S]*?\n\}/) || [''])[0];
  check('27', '封面纠偏链路：addInternal 只有一个 cover 键+自家 CDN https 封面不再自愈+标题搜索删松匹配+一次性纠偏在位',
    addInternalSrc.length > 100 && (addInternalSrc.match(/cover:/g) || []).length === 1 &&
    ix.includes("if(/^https:\\/\\//i.test(c)&&/\\.tcloudbaseapp\\.com\\//i.test(c)) return false;") &&
    !ix.includes('hit||loose') && ix.includes('at_cover_fix_v2140g'));

  /* ---- 浏览器级 ---- */
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let srvExit = 'still-running';
  srv.on('exit', (code) => { srvExit = 'exit ' + code; });
  const waitPort = async () => {
    /* 60 秒而不是 15 秒：几套 puppeteer 门禁并跑时，python 冷启动 + 逐文件 stat 抢不到 CPU，
       15 秒预算会误报「静态服务未起」直接 exit 1（单独跑 30/30）。放宽的是等待，不是断言本身。 */
    for (let i = 0; i < 120; i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true;
      await sleep(500);
    }
    return false;
  };
  if (!await waitPort()) { check('90', '静态服务 60 秒内没起来（:' + PORT + '，服务进程 ' + srvExit + '）', false, PORT); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let jsErrs = 0;
  try {
    const page = await browser.newPage();
    page.on('pageerror', () => jsErrs++);
    const URL = 'http://127.0.0.1:' + PORT + '/index.html';
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });

    /* 种 200 集演示数据（第 5 集预置重看，验证批量不覆盖） */
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('at_purge_v2140e', '1'); /* 大扫除守门：clear 后重写标志，防 reload 时把演示数据扫掉 */
      const eps = [];
      for (let i = 1; i <= 200; i++) eps.push({ s: i, t: '第' + i + '集' });
      localStorage.setItem('tr_shows', JSON.stringify([{
        sid: 't1', title: '测试长篇', nameJp: '', cover: '', year: 2020, total: 200, eps,
        statuses: { 5: 'rewatch' }, hist: [], status: 'watching', updAt: Date.now()
      }]));
    });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction('typeof epClick === "function"', { timeout: 10000 });

    /* 列表视图结构 */
    const listUi = await page.evaluate(() => {
      const row = document.querySelector('.show');
      const img = row && row.querySelector('img.cover, .show img');
      return {
        row: !!row,
        progline: !!(row && row.querySelector('.progline')),
        acts3: row ? row.querySelectorAll('.acts .abtn').length : 0,
        hoverCss: !![...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => /_svg|\.show \.acts\{/.test(r.cssText) || r.cssText.includes('opacity:0')); } catch (e) { return false; } })
      };
    });
    check('11', '主列表行：progline 合并进度 + 3 个操作按钮', listUi.row && listUi.progline && listUi.acts3 === 3, JSON.stringify(listUi));

    const grid = await page.evaluate(() => {
      toggleListView();
      const on = document.querySelector('.cards.grid') && localStorage.getItem('at_view') === 'grid';
      toggleListView();
      return { on, back: !!document.querySelector('.cards:not(.grid)') && localStorage.getItem('at_view') === 'list' };
    });
    check('12', '封面墙 ⇄ 行列表切换且 at_view 记忆', grid.on && grid.back, JSON.stringify(grid));

    /* 详情页 epbar（v2.17.0：来源角标默认常显，开关全删，只剩宫格） */
    const bar = await page.evaluate(() => {
      openDetail('t1');
      return {
        slider: !!document.getElementById('epBarR'), apply: !!document.querySelector('.epbar button[onclick*="markUpTo"]'),
        egrid: !!document.querySelector('.epbar button[onclick*="toggleEpGrid"]'),
        btns: Array.prototype.map.call(document.querySelectorAll('.epbar button'), b => b.textContent.trim()).join(','),
        tyRows: document.querySelectorAll('#dGroups .eprow .ty').length,
        rows: document.querySelectorAll('#dGroups .eprow').length
      };
    });
    check('13', '详情 epbar：只剩宫格一个开关，且每行角标默认就在',
      !bar.slider && !bar.apply && bar.egrid && bar.btns === '▦ 宫格' && bar.rows > 0 && bar.tyRows === bar.rows, JSON.stringify(bar));

    /* 批量核心：bulkWatchRange 直调（不覆盖已标记）。v2.14.0b 历史日志退役——批量不再写 hist */
    const bulk = await page.evaluate(() => {
      const s = bySid('t1');
      const cnt = bulkWatchRange(s, 1, 30);
      const watched = Object.values(s.statuses).filter(v => v === 'watched').length;
      return { cnt, watched, ep5: s.statuses[5], histLen: (s.hist || []).length };
    });
    check('14', 'bulkWatchRange 1–30：补 29 集空档、第 5 集重看不被覆盖、批量不再写历史（记录退役）',
      bulk.cnt === 29 && bulk.watched === 29 && bulk.ep5 === 'rewatch' && bulk.histLen === 0, JSON.stringify(bulk));

    /* 双击手势：400ms 内同集二次点击 = 已看到第 50 集 */
    const dbl = await page.evaluate(() => {
      _lastEpN = null; _lastEpT = 0;
      epClick({}, 50);            /* 第一次：cycleEp 标记 50 */
      epClick({}, 50);            /* 第二次（<400ms）：批量到 50 */
      const s = bySid('t1');
      let w = 0; for (let i = 1; i <= 50; i++) if (s.statuses[i] === 'watched') w++;
      return { w, ep50: s.statuses[50], ep5: s.statuses[5] };
    });
    check('15', '双击手势：1–50 全部已看(49+1重看不计)，第 50 集=已看',
      dbl.w === 49 && dbl.ep50 === 'watched' && dbl.ep5 === 'rewatch', JSON.stringify(dbl));

    /* Shift 连选 55→62 */
    const shf = await page.evaluate(() => {
      _lastEpN = 55; _lastEpT = Date.now();
      epClick({ shiftKey: true }, 62);
      const s = bySid('t1');
      let w = 0; for (let i = 55; i <= 62; i++) if (s.statuses[i] === 'watched') w++;
      return { w };
    });
    check('16', 'Shift 连选：55–62 整段 8 集标记', shf.w === 8, JSON.stringify(shf));

    /* 宫格模式：全量渲染且单元格点击走 epClick */
    const eg = await page.evaluate(() => {
      localStorage.setItem('at_epmode', 'grid'); renderGrid();
      const cells = document.querySelectorAll('.egrid .ep');
      const first = cells[0];
      const oc = first && first.getAttribute('onclick') || '';
      const watchedCells = document.querySelectorAll('.egrid .ep.w').length;
      localStorage.setItem('at_epmode', 'rows'); renderGrid();
      return { cells: cells.length, oc: oc.slice(0, 24), watchedCells };
    });
    check('17', '宫格模式：200 格全渲染、onclick=epClick、已看格计数正确',
      eg.cells === 200 && eg.oc.startsWith('epClick(event,') && eg.watchedCells === 57, JSON.stringify(eg));

    /* v2.14.0d 既有记录全清空：种入三类记录 → 重载 → 全部删除且进度保留（滑动条应用已随退役，原 V18 改此断言） */
    await page.evaluate(() => {
      localStorage.setItem('at_edit_log', JSON.stringify([{ at: 1, sid: 't1', kind: '测试', detail: '存量' }]));
      localStorage.setItem('at_search_hist', JSON.stringify(['存量关键词']));
      const s0 = bySid('t1'); s0.hist = [{ t: 1, act: 'watched', ep: 1 }]; save();
    });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction('typeof bySid === "function"', { timeout: 10000 });
    const purged = await page.evaluate(() => {
      const s = bySid('t1');
      return { editLog: localStorage.getItem('at_edit_log'), searchHist: localStorage.getItem('at_search_hist'),
        histLen: s ? (s.hist || []).length : -1, prog: s ? Object.keys(s.statuses || {}).length : -1 };
    });
    check('18', '重载清空全部既有记录：修改日志/搜索历史/观看 hist 全删，进度 statuses 保留',
      purged.editLog === null && purged.searchHist === null && purged.histLen === 0 && purged.prog > 0, JSON.stringify(purged));

    /* V20 片内搜索框（v2.14.0b）：命中/未命中空态/清空恢复；输入框为静态节点不被 renderFilter 重建 */
    const lq = await page.evaluate(() => {
      setListQ('测试');
      const hit = document.querySelectorAll('#list .show').length;
      setListQ('zzz不存在关键词');
      const miss = document.querySelectorAll('#list .show').length;
      const emptyMsg = /没有标题含/.test(document.getElementById('list').textContent);
      setListQ('');
      const back = document.querySelectorAll('#list .show').length;
      const inp = document.getElementById('listQ');
      return { hit, miss, emptyMsg, back, hasInput: !!inp, focusSafe: !!inp && !document.getElementById('filters').contains(inp) };
    });
    check('20', '片内搜索：命中过滤/未命中空态/清空恢复/静态输入框',
      lq.hit === 1 && lq.miss === 0 && lq.emptyMsg && lq.back === 1 && lq.hasInput && lq.focusSafe, JSON.stringify(lq));

    /* v2.14.0f 拖选标记：宫格 63→72 真鼠标按住拖动，区间补已看且不动重看 */
    const dg = await page.evaluate(() => {
      openDetail('t1'); localStorage.setItem('at_epmode', 'grid'); renderGrid();
      const c = document.querySelector('.egrid .ep[data-ep="63"]');
      c.scrollIntoView({ block: 'center' });
      const a = c.getBoundingClientRect();
      const b = document.querySelector('.egrid .ep[data-ep="72"]').getBoundingClientRect();
      return { x63: a.left + a.width / 2, y63: a.top + a.height / 2, x72: b.left + b.width / 2, y72: b.top + b.height / 2 };
    });
    await page.mouse.move(dg.x63, dg.y63);
    await page.mouse.down();
    await page.mouse.move(dg.x63 + 12, dg.y63, { steps: 3 });
    await page.mouse.move(dg.x72, dg.y72, { steps: 10 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => {
      const s = bySid('t1');
      let w = 0; for (let i = 63; i <= 72; i++) if (s.statuses[i] === 'watched') w++;
      localStorage.setItem('at_epmode', 'rows'); renderGrid();
      return { w, ep5: s.statuses[5], ep63: s.statuses[63] };
    });
    check('26', '拖选标记：宫格拖动 63–72 全补已看、重看不被覆盖、拖后不误触单击',
      dragged.w === 10 && dragged.ep5 === 'rewatch' && dragged.ep63 === 'watched', JSON.stringify(dragged));

    /* v2.14.0e 大扫除全链路：种关联→摘守门标志→重载→片单清空/备份在/墓碑立/关联草稿删/标志回写 */
    await page.evaluate(() => {
      localStorage.setItem('at_relations', JSON.stringify([{ a: 't1', b: 't2', type: 'series' }]));
      localStorage.removeItem('at_purge_v2140e');
    });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction('typeof bySid === "function"', { timeout: 10000 });
    const wiped = await page.evaluate(() => {
      let bk = null; try { bk = JSON.parse(localStorage.getItem('at_purge_backup') || 'null'); } catch (e) {}
      let tb = {}; try { tb = JSON.parse(localStorage.getItem('at_tomb') || '{}'); } catch (e) {}
      return { shows: (window.shows || []).length, t1: !!bySid('t1'),
        bkHas: !!(bk && bk.shows && bk.shows.some(s => s.sid === 't1')),
        bkNoCover: !!(bk && bk.shows && bk.shows.every(s => !s.cover)),
        tombT1: !!tb.t1, relGone: localStorage.getItem('at_relations') === null,
        flagged: localStorage.getItem('at_purge_v2140e') === '1' };
    });
    check('24', '大扫除全链路：片单清空+备份剥封面+t1 墓碑+关联删除+只跑一次标志回写',
      wiped.shows === 0 && !wiped.t1 && wiped.bkHas && wiped.bkNoCover && wiped.tombT1 && wiped.relGone && wiped.flagged, JSON.stringify(wiped));

    /* v2.14.0g 封面纠偏：内置库条目存了错 dataURL → 重载后按库换回已验证的 https 封面 */
    await page.evaluate(() => {
      const cur = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      cur.push({ sid: 'int-op', title: '海贼王', nameJp: '', cover: 'data:image/jpeg;base64,TVRPTkc=', year: '1999', total: 1168, eps: [], statuses: {}, status: 'watching', addedAt: 1, updAt: 1, source: '内置库 · TV' });
      localStorage.setItem('tr_shows', JSON.stringify(cur));
      localStorage.removeItem('at_cover_fix_v2140g');
    });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction("var s=(window.shows||[]).find(function(x){return x.sid==='int-op';}); !!(s&&/^https:/.test(s.cover))", { timeout: 8000 }).catch(() => {});
    const covfix = await page.evaluate(() => {
      const s = bySid('int-op');
      const c = s ? String(s.cover || '') : '';
      return { https: /^https:/.test(c), isLib: c.indexOf('/covers/') >= 0 && /\.jpg$/.test(c), flagged: localStorage.getItem('at_cover_fix_v2140g') === '1' };
    });
    check('28', '封面纠偏全链路：错 dataURL 换回内置库 https 封面且只跑一次标志回写',
      covfix.https && covfix.isLib && covfix.flagged, JSON.stringify(covfix));

    check('19', '全程无页面级 JS 错误', jsErrs === 0, 'pageErrors=' + jsErrs);
  } catch (e) {
    check('99', '浏览器段异常', false, e.message);
  } finally {
    await browser.close();
    try { srv.kill(); } catch (e) {}
  }
  const fails = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(__dirname, 'last-v2140.json'), JSON.stringify({ at: new Date().toISOString(), pass: results.length - fails.length, fail: fails.length, results }, null, 2));
  console.log('==================================================');
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS');
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  - V' + f.id + ' ' + f.name + (f.detail ? ' [' + f.detail + ']' : ''))); process.exit(1); }
})();
