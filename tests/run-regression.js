/* run-regression.js — AniTracker 回归门禁（v2.17.0：在线源换成 TVMaze 全网库）
   用法：node tests\run-regression.js
   自起：静态服务 8094 + 模拟全网库 8093（tests/mock-tvmaze-api.js）
   为什么不再连真站：免费公共 API 会限流会改数据，门禁要断言的是「本页拿到这份
   数据后的行为」，所以响应固定在替身上；请求改写只做一件事——
   https://api.tvmaze.com → http://127.0.0.1:8093（和旧版换 api.bgm.tv 同一手法）。
   2026-09-27 用户指令：「老友记等真人剧也要能搜出来…不要再BANGUMI拉取」，
   原来那批靠 api.bgm.tv 的用例（分季分组/chip 加入/预览模式）随之整体作废，
   季度改为「整部剧按季切分」，用例一并换成新语义。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' T' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 220)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, obj) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: 8093, path: p, method: 'POST', headers: { 'Content-Type': 'application/json' } }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res(b)); }); r.on('error', rej); r.end(JSON.stringify(obj || {})); });

(async () => {
  /* ---- 文件级 ---- */
  const ib = fs.readFileSync(path.join(ROOT, 'index.html'));
  const ab = fs.readFileSync(path.join(ROOT, 'ani-tracker.html'));
  check('00', '双入口字节一致', ib.equals(ab), ib.length + 'B vs ' + ab.length + 'B');
  const ix = ib.toString('utf-8');
  const vm = ix.match(/AT_VERSION='([^']+)'/);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'tracker-version.json'), 'utf-8'));
  check('01', '版本一致（页面 === JSON）', vm && vm[1] === vj.version && /^\d+\.\d+\.\d+$/.test(vj.version), 'page=' + (vm && vm[1]) + ' json=' + vj.version);

  /* T02 Bangumi 拉取通道彻底断掉（源码级：不是藏起来，是没有了） */
  const bgmGone = ['api.bgm.tv', 'BAPI', 'function _bget', 'function bgmSid', 'function bgmFetch',
    'function bgmQueue', 'function bgmPullEpisodeList', 'function bgmFillEpisodes',
    'function bgmAttach', 'function assocUi', 'doBgmSearch']
    .filter(s => ix.includes(s));
  check('02', 'v2.17.0 源码里已无 Bangumi 拉取通道（11 处标识全清零）', bgmGone.length === 0, '残留：' + bgmGone.join(','));

  const PY = process.env.AT_PY || (function () {
    try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
      const fb = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
      console.warn('[tests] PATH 中未找到 python，回退旧写死路径：' + fb + '（可用环境变量 AT_PY 覆盖）');
      return fb;
    }
  })();
  const NODE = process.env.AT_NODE || process.execPath;
  const pySrv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', '8094', '--host', '127.0.0.1', '--dir', ROOT, '--idle', '900'], { stdio: 'ignore' });
  const mock = spawn(NODE, [path.join(__dirname, 'mock-tvmaze-api.js')], { stdio: 'ignore' });
  const waitPort = async (port, pathName, tries) => {
    for (let i = 0; i < (tries || 30); i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port, path: pathName, timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false));
        req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true;
      await sleep(500);
    }
    return false;
  };
  const srvUp = await waitPort(8094, '/index.html', 30);
  await waitPort(8093, '/__state', 20);
  if (!srvUp) console.log('WARN: 8094 静态服务未就绪，浏览器类用例可能失败');
  await sleep(400);
  let pageErrors = 0; let webReqs = 0; let wdReqs = 0;
  /* v2.35.0：光记次数不记是谁，加片那轮后台刷名（v2.14.0b 起就有、v2.35.0 又扩了名与集名）
     一旦落进 T15 的测量窗口，只会看到「webReqs=1」猜不出是谁发的。留个尾巴列表，失败时直接读。 */
  let webReqTail = [];
  const noteWebReq = (u) => { webReqs++; webReqTail.push(String(u).replace('http://127.0.0.1:8093', 'api.tvmaze.com').slice(-96)); if (webReqTail.length > 8) webReqTail.shift(); };
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    page.on('pageerror', () => { pageErrors++; });
    page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    /* 规矩：整页只能有一个 request 监听器，两个监听器会把同一个请求 handle 两次而报错 */
    page.on('request', req => {
      const u = req.url();
      if (u.includes('api.tvmaze.com')) { noteWebReq(u); return req.continue({ url: u.replace('https://api.tvmaze.com', 'http://127.0.0.1:8093') }); }
      /* v2.29.0：豆瓣联想（云函数）不出网——本地直接应答，带 CORS 头（v2.20.0 教训：少头=页面判网络不可用） */
      /* v2.30.0：Wikidata / Commons 兜底源不许出网。本机代理对 wikidata 每次要 19.6s 才
         ConnectionReset（实测 3/3 次），六个待补条目就是 6×19.6s，直接把「等自愈跑完」的 90s 撑爆——
         于是 T22 读到的永远是「heal-fail 还没轮到」，看着像本页的 bug，其实是量具在测代理。
         这里空结果秒答（照 v2.20.0 教训带 CORS 头），断言的仍是本页自己那条退避登记。 */
      if (u.includes('wikidata.org') || u.includes('commons.wikimedia.org')) {
        wdReqs++;
        return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ search: [] }) });
      }
      if (u.includes('service.tcloudbase.com')) {
        noteWebReq(u);
        return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ items: [{ title: 'Mock 国产剧 (豆瓣)', img: '', episode: '12', year: '2026', url: 'https://movie.douban.com/subject/99000001/' }] }) });
      }
      req.continue();
    });

    await post('/__ctl', { mode: 'ok', target: 'all' });
    await page.goto('http://127.0.0.1:8094/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1100);

    /* 开机自检：index.html 的脚本是一整块，里面任何一处语法错都会让整块失效，
       于是后面的用例全以「xxx is not defined」炸掉、看不出根因（v2.17.0 实测踩过）。
       所以先把「关键函数在不在」单独列一条，缺谁点名谁。 */
    const BOOT_FN = ['renderList', 'renderDetail', 'doSearch', 'webSearchShows', 'webRowHtml', 'webAddShow',
      'fillEpisodesNow', 'visEps', 'seasonKeyOf', 'ensureSeasons', 'autoCalibrateSrc', 'addShow', 'coverPH',
      'doubanSuggest', 'dbAddShow',
      /* v2.30.0 豆瓣勾选同步 + 观看时间账（细节用例在 tests/douban-sync-e2e.js，这里只保「函数还在」） */
      'openDoubanSync', 'dbnPull', 'dbnImport', 'dbApplyOne', 'timeLineHtml', 'editWatchTime', 'fmtDay', 'parseDay',
      /* v2.31.0 推送（追迹 → 豆瓣）：写回走本机 :3000 网关的 /hub/api/db/mark，
         面板加方向切换后，拉方向的老用例一根都不能少。 */
      'dbnPush', 'dbnPushable', 'dbnWantStatus', 'dbnPushDiff', 'dbnDirNote',
      /* v2.32.0 凭据跨设备：Cookie 加密存自己的 CloudBase 账号，换设备取回。 */
      'dbnPutCred', 'dbnTakeCred', 'dbnCredRow', 'dbnAskPassword',
      /* v2.35.0 漫改进度行 + 非 AI 刷名：这两块是新入口，一处语法错就整页哑掉。 */
      'canonProgOf', 'canonProgHtml', 'refreshNamesFor', 'refreshNamesNow'];
    const boot = await page.evaluate((names) => ({
      missing: names.filter(n => typeof window[n] !== 'function')
    }), BOOT_FN);
    check('03', '开机自检：主脚本 ' + BOOT_FN.length + ' 个关键函数全部就位', boot.missing.length === 0, '缺失：' + boot.missing.join(','));

    // ===== T19 默认浅色（用户指令「默认浅色系统」）：必须在任何切换动作之前量 =====
    // 占位图联动只看「浅色档取 L、深色档取 D，且两档不同」——不钉具体色值，v2.21.0 占位改灰阶骨架后不必回来改测试
    const th1 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('at_theme'), phLight: coverPH() === COVER_PH_L && COVER_PH_L !== COVER_PH_D }));
    await page.evaluate(() => cycleTheme()); await sleep(300);
    const th2 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('at_theme'), phDark: coverPH() === COVER_PH_D }));
    await page.evaluate(() => { localStorage.removeItem('at_theme'); });
    check('19', '主题：默认浅色 + 可切深色影院 + 占位图联动', th1.attr === 'light' && th1.phLight && th2.attr === 'dark' && th2.ls === 'dark' && th2.phDark, JSON.stringify({ th1, th2 }).slice(0, 200));

    // ===== 账号面板（结构未变，保留断言）=====
    await page.evaluate(() => openAccount()); await sleep(1300);
    const acctPanel = await page.evaluate(() => {
      const panel = document.querySelector('#syncMask .panel');
      const btns = panel ? Array.from(panel.querySelectorAll('button')).map(b => b.textContent.trim()) : [];
      return {
        title: panel && panel.querySelector('h3') ? panel.querySelector('h3').textContent.trim() : '',
        hasCbArea: !!document.getElementById('cbArea'),
        hasExport: !!document.getElementById('syExport'),
        hasImport: !!document.getElementById('syImport'),
        noChrome: !document.querySelector('.systatus') && !document.querySelector('.sycard') &&
          !document.querySelector('details.syfold') && btns.indexOf('完成') < 0,
        noTabs: !document.getElementById('cbTabLogin') && !document.getElementById('cbTabReg') &&
          !!document.getElementById('cbToReg') && !!document.getElementById('cbLogin'),
        topLabel: (document.querySelector('[aria-label="账号"]') || {}).textContent || ''
      };
    });
    check('10', '账号面板极简单屏：标题+cbArea+备份行，无状态条/卡片/折叠/完成按钮，登录无Tab',
      acctPanel.title === '账号' && acctPanel.hasCbArea && acctPanel.hasExport && acctPanel.hasImport &&
      acctPanel.noChrome && acctPanel.noTabs && /账号/.test(acctPanel.topLabel),
      JSON.stringify(acctPanel).slice(0, 340));

    const advGone = await page.evaluate(() => ({
      dom: !!(document.getElementById('optRelay') || document.getElementById('optNoSync') ||
        document.getElementById('advUnmapped') || document.getElementById('optDupScan') || document.getElementById('optDupResult')),
      srcBar: (function () { const b = document.getElementById('srcBar'); return !b || b.innerHTML.trim() !== '' || !!b.querySelector('button'); })(),
      fns: ['bindAdv', 'acctFoldPref', 'SEARCH_NOSYNC', 'setFlag', 'netRelaySet', 'findAllDupGroups', 'renderDupReport', 'dupSeverity', 'sortBySid',
        'acctStatus', 'saveHide', '_at270ToolToggle']
        .filter(n => typeof window[n] === 'function')
    }));
    check('10a', '高级设置/片单整理/工具真删干净：面板无相关节点、srcBar 空、全局无相关函数',
      !advGone.dom && !advGone.srcBar && advGone.fns.length === 0, JSON.stringify(advGone));

    const syncGone = await page.evaluate(() => {
      const names = ['syncRun', 'bgmPullProgress', 'bgmPushOneShow', 'bgmPullAll', 'bgmPushAll',
        'bgmRollback', 'bgmRetry', 'renderLedger', 'syncLogAll', 'bgmBoundHtml', 'bgmUnboundHtml',
        'syncHealth', 'syncFoldPref', 'playInPortal',
        /* v2.17.0 追加：连「导入/关联」那批也不再存在 */
        'bgmSid', 'bgmQueue', 'bgmFetch', 'bgmTok', 'bgmPullEpisodeList', 'bgmFillEpisodes', 'bgmAttach', 'assocUi'];
      return {
        alive: names.filter(n => typeof window[n] === 'function'),
        hasSsCard: !!document.getElementById('syCardBgm'),
        hasLedger: !!document.getElementById('syLedger'),
        oldFlag: localStorage.getItem('at_sync_off'),
        topHasSync: /同步/.test((document.querySelector('.topbtn.wide') || {}).textContent || '')
      };
    });
    check('10b', '同步与 Bangumi 拉取全下线：22 个函数都不在窗口上、无卡片/台账、顶栏无「同步」',
      syncGone.alive.length === 0 && !syncGone.hasSsCard && !syncGone.hasLedger &&
      !syncGone.topHasSync && syncGone.oldFlag === null,
      JSON.stringify(syncGone).slice(0, 300));

    /* T26 登录三件事：可视密码 / 忘了密码入口 / 密码规则放宽（用户指令）
       登录面板整个在 cloudbase-sync.js 里（独立文件），规则断言要读那个文件。 */
    const csSrc = fs.readFileSync(path.join(ROOT, 'cloudbase-sync.js'), 'utf-8');
    const pwdUI = await page.evaluate(() => {
      const eye = document.querySelectorAll('#cbArea .cb-eye');
      const inp = document.getElementById('cbPass');
      const before = inp ? inp.type : '';
      if (eye[0]) eye[0].click();
      const after = inp ? inp.type : '';
      if (eye[0]) eye[0].click();
      return {
        eyeN: eye.length, before, after, back: inp ? inp.type : '',
        hasResetLink: !!document.getElementById('cbToReset'),
        resetHint: /忘了密码/.test((document.getElementById('cbPaneLogin') || {}).textContent || ''),
        resetShown: (function () { const b = document.getElementById('cbToReset'); if (b) b.click(); return !!document.getElementById('cbRpEmail') && document.getElementById('cbPaneReset').style.display !== 'none'; })()
      };
    });
    await sleep(200);
    const pwdRule = (csSrc.match(/function pwdOk\(p\)\{[^}]*\}/) || [''])[0];
    /* 「可纯数字或者字母」= 规则里只看长度，不许再有用例校验字符类别的正则 */
    const ruleOk = /p\.length >= 6/.test(pwdRule) && /p\.length <= 32/.test(pwdRule) && !/test\(|RegExp|\{(?=.*\\[dDa-z])/.test(pwdRule);
    check('26', '登录：可视密码切换 + 忘了密码→重设面板 + 规则放宽到 6–32 位',
      pwdUI.eyeN >= 3 && pwdUI.before === 'password' && pwdUI.after === 'text' && pwdUI.back === 'password' &&
      pwdUI.hasResetLink && pwdUI.resetHint && pwdUI.resetShown && ruleOk &&
      /数字或字母都行/.test(csSrc),
      JSON.stringify(pwdUI).slice(0, 220) + ' rule=' + (pwdRule || 'none').slice(0, 80));
    await page.evaluate(() => window.__closeSync()); await sleep(300);

    // ===== T11 「老友记」这类真人剧要搜得出来（别名表 → 全网库英文名） =====
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = '老友记'; doSearch(); });
    await page.waitForFunction(() => /全网（TVMaze）/.test(document.getElementById('srList').textContent), { timeout: 20000 }).catch(() => { });
    await sleep(600);
    const sr = await page.evaluate(() => {
      const row = document.querySelector('#srList .sr[data-tv="900003"]');
      return {
        sec: /全网（TVMaze）/.test(document.getElementById('srList').textContent),
        hasRow: !!row,
        rowText: row ? row.textContent : '',
        kind: row ? (/真人剧/.test(row.textContent) ? '真人剧' : '其他') : '',
        alias: row ? /老友记/.test(row.textContent) : false,
        msg: document.getElementById('srMsg').textContent,
        rows: document.querySelectorAll('#srList .sr[data-tv]').length
      };
    });
    check('11', '搜「老友记」出真人剧 Friends（别名命中 + 中文俗称回显 + 标「真人剧」）',
      sr.sec && sr.hasRow && sr.kind === '真人剧' && sr.alias && sr.rows >= 1, JSON.stringify(sr).slice(0, 260));


    /* T12 点「添加」立刻回执，单集在后台补（主路径不联网——缺点5 的不变量） */
    const beforeCnt = await page.evaluate(() => JSON.parse(localStorage.getItem('tr_shows') || '[]').length);
    webReqs = 0; webReqTail = [];
    const tAdd = Date.now();
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#srList .sr[data-tv="900003"] button')).find(x => /添加/.test(x.textContent));
      window.__addClickedAt = Date.now();
      b.click();
    });
    await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && /已加入片单/.test(t.textContent); }, { timeout: 8000 });
    const toastMs = await page.evaluate(() => Date.now() - window.__addClickedAt);
    await page.waitForFunction(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = a.filter(x => x.sid === 'tv900003')[0];
      return s && (s.eps || []).length === 15;
    }, { timeout: 20000 }).catch(() => { });
    const added = await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = a.filter(x => x.sid === 'tv900003')[0] || {};
      return { n: a.length, sid: s.sid, total: s.total, eps: (s.eps || []).length, seasons: (s.parts || []).length, src: s.source || '', coverIsUrl: String(s.cover || '').indexOf('http') === 0 };
    });
    check('12', '点「添加」立刻入库（回执 ' + toastMs + 'ms）+ 后台补齐 15 集并自动分 3 季',
      added.n === beforeCnt + 1 && added.eps === 15 && added.total === 15 && added.seasons === 3 &&
      /全网/.test(added.src) && toastMs < 600,
      JSON.stringify(added).slice(0, 220) + ' toast=' + toastMs + 'ms');

    /* ===== T30 豆瓣联想（v2.29.0）：中文剧搜索出第四区 + 一键建档 =====
       搜「mock」时豆瓣 suggest 替身固定回一条国产剧（img 留空走占位，防测试真下豆瓣图）。
       放在 T12 之后：addShow 成功会清空搜索区并返回列表，别拆了 T11/T12 共用的搜索现场。
       断言后把 db-99000001 移出片单还原现场，免得污染后面的计数类用例。 */
    await page.evaluate(() => { showAdd(); document.getElementById('qKw').value = 'mock'; doSearch(); });
    await page.waitForFunction(() => !!document.getElementById('srDbBox'), { timeout: 15000 }).catch(() => { });
    await sleep(300);
    const db = await page.evaluate(() => {
      const box = document.getElementById('srDbBox');
      return {
        sec: !!box,
        rows: box ? box.querySelectorAll('.sr').length : 0,
        hasAddBtn: box ? !!Array.from(box.querySelectorAll('button')).find(b => b.textContent === '添加') : false
      };
    });
    await page.evaluate(() => dbAddShow(0)); await sleep(400);
    const dbAdded = await page.evaluate(() => {
      const s = bySid('db-99000001') || {};
      return { inList: !!s.sid, title: s.title || '', total: s.total || 0, eps: (s.eps || []).length, src: s.source || '' };
    });
    await page.evaluate(() => {
      const i = shows.findIndex(s => s.sid === 'db-99000001');
      if (i >= 0) { shows.splice(i, 1); try { save(); } catch (e) {} }
    });
    check('30', '豆瓣联想：第四区渲染 + 一键建档（豆瓣 sid / 集数落库 / 标准名）',
      db.sec && db.rows >= 1 && db.hasAddBtn && dbAdded.inList && dbAdded.total === 12 && dbAdded.eps === 12 && /豆瓣/.test(dbAdded.src),
      JSON.stringify({ db, dbAdded }).slice(0, 220));

    await page.evaluate(() => openDetail('tv900003')); await sleep(700);
    const grid0 = await page.evaluate(() => ({
      parts: document.querySelectorAll('#dParts .part').length,
      head: (document.querySelector('#dParts .parthead') || {}).textContent || '',
      rows: document.querySelectorAll('#dGroups .eprow').length,
      allS1: Array.from(document.querySelectorAll('#dGroups .eprow')).every(r => /S01E/.test(r.textContent))
    }));
    check('13a', '季度条由本地单集算出：3 季 + 默认只看第 1 季（5 集全为 S01）',
      grid0.parts === 3 && /季度切换/.test(grid0.head) && grid0.rows === 5 && grid0.allS1, JSON.stringify(grid0).slice(0, 200));

    /* T13 切季：纯本地、零请求、秒开 */
    webReqs = 0; webReqTail = [];
    const t0 = Date.now();
    await page.evaluate(() => { const ps = document.querySelectorAll('#dParts .part'); ps[1] && ps[1].click(); });
    await sleep(350);
    const swMs = Date.now() - t0;
    const grid1 = await page.evaluate(() => ({
      rows: document.querySelectorAll('#dGroups .eprow').length,
      allS2: Array.from(document.querySelectorAll('#dGroups .eprow')).every(r => /S02E/.test(r.textContent)),
      onN: document.querySelectorAll('#dParts .part.on').length,
      toast: (document.getElementById('toast') || {}).textContent || '',
      cur: (JSON.parse(localStorage.getItem('tr_shows')).filter(x => x.sid === 'tv900003')[0] || {}).curPart
    }));
    check('13', '切季零网络秒开（' + swMs + 'ms / 0 请求）：卡片全为 S02 且选中态与落库一致',
      swMs < 1500 && webReqs === 0 && grid1.rows === 5 && grid1.allS2 && grid1.onN === 1 && grid1.cur === 'S2' && /第 2 季/.test(grid1.toast),
      swMs + 'ms webReqs=' + webReqs + ' ' + JSON.stringify(grid1).slice(0, 160));

    /* T14 标记按全剧连续集号：跨季不串台、统计算整部 */
    await page.evaluate(() => { const els = document.querySelectorAll('#dGroups .eprow'); els[0] && els[0].click(); });
    await sleep(400);
    await page.evaluate(() => { const ps = document.querySelectorAll('#dParts .part'); ps[0] && ps[0].click(); });
    await sleep(300);
    const st14 = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('tr_shows')).filter(x => x.sid === 'tv900003')[0];
      return { keys: Object.keys(s.statuses || {}), rows: document.querySelectorAll('#dGroups .eprow').length, allS1: Array.from(document.querySelectorAll('#dGroups .eprow')).every(r => /S01E/.test(r.textContent)), stats: document.getElementById('dStats').textContent };
    });
    check('14', '跨季标记互不影响（第 6 集=S02E01）且统计按整部 15 集算',
      st14.keys.length === 1 && st14.keys[0] === '6' && st14.allS1 &&
      /14未看/.test(st14.stats) && /7%进度/.test(st14.stats),   /* 1 已看 / 15 全集 = 7% */
      JSON.stringify(st14).slice(0, 220));

    /* T16 单季作品不出季度条（别让界面凭空多一条没用的横条） */
    await page.evaluate(() => {
      const now = Date.now();
      addShow({ sid: 'tv900004', title: 'Single Season Show (Test)', nameJp: '', cover: '', year: '2026', total: 12, eps: [1, 2, 3].map(i => ({ s: i, sn: 1, en: i, t: 'S01E0' + i })), statuses: {}, status: 'watching', addedAt: now, updAt: now, source: '全网 · 动画', tvId: 900004 });
    });
    await page.evaluate(() => openDetail('tv900004')); await sleep(600);
    const single = await page.evaluate(() => ({ parts: document.querySelectorAll('#dParts .part').length, html: document.getElementById('dParts').innerHTML.length }));
    check('16', '单季作品不出季度条（#dParts 留空）', single.parts === 0 && single.html === 0, JSON.stringify(single));

    /* T15 标记已看：本地生效且不发出任何写请求 */
    /* 计量前先让后台安静：开机小批量补封面 / 上一条 addShow 的请求尾巴正好可能落进这 1.2s 窗口，
       那测的就不是「标记这一击发不发请求」了（v2.30.0 把 Wikidata 桩进门禁后补齐变快，就是这个窗口先撞红）。
       判据一个字没松——仍然是窗口内 webReqs 必须为 0，只是先把不属于本击的流量排除在外。 */
    const quietThenZero = async () => {
      for (let q = 0; q < 24; q++) {
        const a = webReqs; await sleep(500); const b = webReqs;
        if (a === b) { webReqs = 0; webReqTail = []; return 'settled(前置后台流量 ' + b + ' 次)'; }
      }
      webReqs = 0; webReqTail = []; return 'NOT-QUIET';
    };
    await page.evaluate(() => openDetail('tv900003')); await sleep(500);
    const t15quiet = await quietThenZero();
    await page.evaluate(() => { const els = document.querySelectorAll('#dGroups .eprow'); els[1] && els[1].click(); });
    await sleep(1200);
    const markedLocal = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('tr_shows')).filter(x => x.sid === 'tv900003')[0];
      return Object.keys(s.statuses || {}).length;
    });
    check('15', '标记已看：本地记录生效，且不发任何外部写请求', webReqs === 0 && markedLocal >= 2,
      t15quiet + ' webReqs=' + webReqs + ' localMarked=' + markedLocal + ' tail=' + JSON.stringify(webReqTail));

    /* T28 来源角标：动画每一集一律带角标（没有开关可关），真人剧不套这条轴（用户指令） */
    const badge = await page.evaluate(() => {
      const now = Date.now();
      const eps = []; for (let i = 1; i <= 3; i++) eps.push({ s: i, sn: 1, en: i, t: 'S01E0' + i });
      addShow({ sid: 'badge-anime', title: 'Badge Anime (Test)', cover: '', year: '2026', total: 3, eps: eps, statuses: {}, status: 'watching', addedAt: now, updAt: now, source: '全网 · 动画', kind: '动画' });
      return 1;
    });
    await page.evaluate(() => openDetail('badge-anime')); await sleep(500);
    const bAnime = await page.evaluate(() => ({
      rows: document.querySelectorAll('#dGroups .eprow').length,
      tyN: document.querySelectorAll('#dGroups .eprow .ty').length,
      tyText: Array.from(document.querySelectorAll('#dGroups .eprow .ty')).map(x => x.textContent).join('|'),
      barBtns: Array.from(document.querySelectorAll('.epbar button')).map(b => b.textContent.trim()),
      toggleBtn: document.querySelectorAll('[onclick*="toggleEpTy"],[onclick*="at270TyShow"]').length
    }));
    await page.evaluate(() => openDetail('tv900003')); await sleep(500);
    const bLive = await page.evaluate(() => ({
      rows: document.querySelectorAll('#dGroups .eprow').length,
      tyN: document.querySelectorAll('#dGroups .eprow .ty').length
    }));
    check('28', '来源角标默认全带（动画 3/3 行有角标）、无开关；真人剧不挂「待核」',
      bAnime.rows === 3 && bAnime.tyN === 3 && /待核|原创|漫改/.test(bAnime.tyText) &&
      bAnime.toggleBtn === 0 && bAnime.barBtns.join(',') === '▦ 宫格' &&
      bLive.rows === 5 && bLive.tyN === 0,
      JSON.stringify({ badge, bAnime, bLive }).slice(0, 260));

    /* T27 返回手势层栈：详情/弹层各占一格历史，回退只关一层（壳把返回交给 WebView 历史） */
    const lay = await page.evaluate(async () => {
      openDetail('tv900003');
      const afterOpen = AT_LAYERS.length;
      return { afterOpen, view: AT_VIEW };
    });
    await sleep(400);
    await page.goBack(); /* 等价于手机全面屏返回手势 */
    await sleep(500);
    const lay2 = await page.evaluate(() => ({
      layers: AT_LAYERS.length, view: AT_VIEW,
      detailShown: document.getElementById('vDetail').style.display !== 'none',
      listShown: document.getElementById('vList').style.display !== 'none'
    }));
    /* 弹层：开→× 自关，历史那一格要跟着补掉，不能留「空回退」 */
    const lay3 = await page.evaluate(async () => {
      showAdd();
      const n1 = AT_LAYERS.length;
      document.getElementById('addHint').innerHTML += '<span></span>';
      return { n1 };
    });
    await sleep(200);
    await page.goBack();
    await sleep(500);
    const lay4 = await page.evaluate(() => ({
      layers: AT_LAYERS.length, view: AT_VIEW,
      addShown: document.getElementById('vAdd').style.display !== 'none',
      listShown: document.getElementById('vList').style.display !== 'none'
    }));
    check('27', '返回＝回上一层：详情→列表、添加→列表各吃掉一层（不再一步退出）',
      lay.afterOpen === 1 && lay2.layers === 0 && !lay2.detailShown && lay2.listShown &&
      lay3.n1 === 1 && !lay4.addShown && lay4.listShown && lay4.layers === 0,
      JSON.stringify({ lay, lay2, lay3, lay4 }).slice(0, 300));

    /* T15b 详情页按钮：无「关联Bangumi」，「补齐剧集」只在缺单集时露出 */
    await page.evaluate(() => {
      const now = Date.now();
      addShow({ sid: 'man-' + now, title: '本地测试番' + now, nameJp: '', cover: '', year: '2026', total: 3, eps: [{ s: 1, t: '第1集' }], statuses: {}, status: 'watching', addedAt: now, updAt: now, source: '手动添加', manual: 1 });
      openDetail('man-' + now);
    });
    await sleep(600);
    const dbtn = await page.evaluate(() => ({
      assoc: !!document.getElementById('btnAssoc'),
      fillShown: (document.getElementById('btnFillEps') || { style: { display: 'gone' } }).style.display !== 'none',
      nextText: (document.getElementById('nextBtn') || {}).textContent || '',
      oldSyncText: /拉取Bangumi进度|推送Bangumi|关联 Bangumi/.test(document.getElementById('vDetail').textContent)
    }));
    await page.evaluate(() => {
      const s = shows.filter(x => x.sid === curSid)[0];
      s.eps = []; s.total = 0; save(); renderDetail();
    });
    await sleep(400);
    const dbtn2 = await page.evaluate(() => ({
      fillShown: (document.getElementById('btnFillEps') || { style: { display: 'gone' } }).style.display !== 'none',
      nextText: (document.getElementById('nextBtn') || {}).textContent || ''
    }));
    check('15b', '详情页：无「关联Bangumi」；缺单集时「补齐剧集」+主按钮都指向补齐入口',
      !dbtn.assoc && !dbtn.oldSyncText && dbtn.fillShown === false && /标记下一集/.test(dbtn.nextText) &&
      dbtn2.fillShown === true && /补齐/.test(dbtn2.nextText),
      JSON.stringify({ dbtn, dbtn2 }).slice(0, 300));

    /* T17 断网点「补齐剧集」：不进联网查询（一次 4 秒超时×三个叫法＝12 秒干等），
       立刻落到本地方案并说清原因 */
    await page.setOfflineMode(true);
    const tOff = Date.now();
    await page.evaluate(() => document.getElementById('nextBtn').click());
    await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && /网络不通/.test(t.textContent); }, { timeout: 12000 }).catch(() => { });
    const offMs = Date.now() - tOff;
    const offToast = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
    await page.setOfflineMode(false);
    check('17', '断网补齐：' + offMs + 'ms 内回执并说明「网络不通→本地方案」',
      offMs < 6000 && /网络不通/.test(offToast) && /本地|编辑集数/.test(offToast), offMs + 'ms toast=' + offToast.slice(0, 120));

    /* T25 无剧集条目：主按钮就是补齐入口，绝不误报「全部标记过了」 */
    await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      a.push({ sid: 'needs-eps', title: '手动添加的番', cover: '', total: 24, eps: [], statuses: {}, status: 'watching', source: '手动添加' });
      localStorage.setItem('tr_shows', JSON.stringify(a));
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(900);
    await page.evaluate(() => openDetail('needs-eps')); await sleep(900);
    const nbState = await page.evaluate(() => {
      const nb = document.getElementById('nextBtn');
      return { nbTxt: nb ? nb.textContent : '', nbHidden: !nb || nb.style.display === 'none' };
    });
    check('25', '无剧集条目：主按钮给出补齐入口且不误报「全部标记过了」',
      !nbState.nbHidden && /补齐/.test(nbState.nbTxt) && !/全部标记过了/.test(nbState.nbTxt),
      JSON.stringify(nbState).slice(0, 160));

    /* T20-T23 封面自愈改走全网库（外链转存 dataURL / 失败退避 / 刷新持久） */
    await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      a.push({ sid: 'heal-tv', title: 'Mock Anime (Test)', nameJp: '', cover: '', total: 24, eps: [], statuses: {}, status: 'watching', tvId: 900001, source: '测试' });
      a.push({ sid: 'heal-remote', title: 'Friends', nameJp: '', cover: 'https://static.tvmaze.com/fake-should-be-replaced.jpg', total: 15, eps: [], statuses: {}, status: 'watching', tvId: 0, source: '测试' });
      a.push({ sid: 'heal-fail', title: '找不到的剧名 XYZ', nameJp: '', cover: '', total: 1, eps: [], statuses: {}, status: 'watching', source: '测试' });
      localStorage.setItem('tr_shows', JSON.stringify(a));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(7000);
    /* 自愈队列排空：超时不再装作没事——把「ok/超时 + 耗时」记下来贴进用例明细，
       下次再撑爆一眼就能看出是时间不够，而不是本页逻辑错。 */
    const healDrain = [];
    const drainHeal = (label) => {
      const t0 = Date.now();
      return page.waitForFunction(() => window._coverHealRunning === false, { timeout: 120000, polling: 400 })
        .then(() => { healDrain.push(label + '=ok ' + (Date.now() - t0) + 'ms'); })
        .catch(() => { healDrain.push(label + '=TIMEOUT ' + (Date.now() - t0) + 'ms'); });
    };
    await drainHeal('boot');
    /* 手动补齐只有在闸门空了才会真跑（_coverHealRunning 时 coverHealAll 直接 return）——
       没空就再排空一次，别把「压根没跑起来」当成「跑错了」。 */
    for (let g = 0; g < 3; g++) { if (await page.evaluate(() => !window._coverHealRunning)) break; await drainHeal('boot' + g); }
    const gateOpen = await page.evaluate(() => !window._coverHealRunning);
    await page.evaluate(() => { coverHealAll(true); return true; });
    await sleep(800);
    await drainHeal('manual');
    await sleep(800);
    const heal1 = await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const find = id => a.filter(s => s.sid === id)[0] || {};
      const tryMap = JSON.parse(localStorage.getItem('at_cover_try') || '{}');
      return {
        t: String(find('heal-tv').cover || '').slice(0, 22),
        r: String(find('heal-remote').cover || '').slice(0, 22),
        f: String(find('heal-fail').cover || ''),
        tryT: tryMap['heal-tv'] && tryMap['heal-tv'].ok,
        tryF: tryMap['heal-fail'] && tryMap['heal-fail'].ok
      };
    });
    check('21', '封面自愈：tvId 直拉 + 按剧名命中，外链一律转存为本地 dataURL',
      heal1.t.indexOf('data:image') === 0 && heal1.r.indexOf('data:image') === 0, 'drain ' + healDrain.join(',') + ' wd=' + wdReqs + ' ' + JSON.stringify(heal1).slice(0, 150));
    check('22', '封面自愈：查不到的条目登记退避且不误报',
      heal1.f === '' && heal1.tryT === true && heal1.tryF === false, 'drain ' + healDrain.join(',') + ' gateOpen=' + gateOpen + ' wd=' + wdReqs + ' ' + JSON.stringify(heal1).slice(0, 150));

    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(900);
    const persist = await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const s = a.filter(x => x.sid === 'heal-tv')[0] || {};
      return { ok: String(s.cover || '').indexOf('data:image') === 0 };
    });
    check('23', '刷新后封面持久（localStorage dataURL 读回）', persist.ok, JSON.stringify(persist));

    await page.evaluate(() => { const a = JSON.parse(localStorage.getItem('tr_shows') || '[]'); a.push({ sid: 'heal-off', title: '离线测试剧', cover: '', total: 1, eps: [], statuses: {}, status: 'watching', source: '测试' }); localStorage.setItem('tr_shows', JSON.stringify(a)); });
    await page.setOfflineMode(true);
    const tOff2 = Date.now();
    await page.evaluate(() => { coverHealAll(true); return true; });
    await sleep(1800);
    const off2 = await page.evaluate(() => ({ running: !!window._coverHealRunning, cover: (JSON.parse(localStorage.getItem('tr_shows')).filter(s => s.sid === 'heal-off')[0] || {}).cover }));
    await page.setOfflineMode(false);
    check('24', '离线补封面：快速跳过不卡死，占位保持', off2.cover === '' && !off2.running && (Date.now() - tOff2) < 20000, JSON.stringify(off2));

    const entry = await page.evaluate(() => ({
      btn: !!document.querySelector('button[onclick="healThisCover()"]'),
      rp: (function () { const im = document.querySelector('#list .show img'); return im ? im.getAttribute('referrerpolicy') : null; })(),
      fn: typeof coverHealAll === 'function' && typeof healCoverFor === 'function' && typeof webMatchShow === 'function',
      offlineCopy: /全网|免注册/.test(document.getElementById('addHint') ? document.getElementById('addHint').textContent : '')
    }));
    check('20', '封面自愈入口就绪（重拉按钮/防裂图属性/全网函数）', entry.btn && entry.rp === 'no-referrer' && entry.fn, JSON.stringify(entry).slice(0, 220));

    /* T29 来源自动校准：只吃离线快照、零网络、不抬 updAt、一部只试一次
       （用户指令「默认自动校准好来源」；直接喂对象，绕开加片带来的后台请求） */
    await sleep(1500);
    webReqs = 0; webReqTail = [];
    const calib = await page.evaluate(() => {
      const ds = window.AFG_FILLER || {};   /* tracker-filler-data.js 同步注入，无异步 */
      const now = Date.now();
      const eps = []; for (let i = 1; i <= 24; i++) eps.push({ s: i, sn: 1, en: i, t: 'S01E' + i });
      const s = { sid: 'calib-op', title: '海贼王', nameJp: '', cover: '', year: '1999', total: 24, eps: eps, statuses: {}, status: 'watching', addedAt: now, updAt: now, source: '测试' };
      const hit = autoCalibrateSrc(s);
      const again = autoCalibrateSrc(s);
      return { dsN: Object.keys(ds).length, hit: !!hit, again: !!again, filler: String(s.filler || ''), fgUrl: String(s.fgUrl || ''), tried: s.fgTried, clockKept: s.updAt === now };
    });
    check('29', '来源自动校准离线命中（海贼王 → AFG 原创集区间）：零网络、不动时钟、不重复查',
      calib.dsN > 100 && calib.hit && !calib.again && /^[\d][\d,.-]*$/.test(calib.filler) &&
      calib.tried === 1 && calib.clockKept && webReqs === 0,
      JSON.stringify(calib).slice(0, 220) + ' webReqs=' + webReqs);

    /* T31 v2.36.0 刷名剧名铁律：中文剧（language=Chinese）现名纯外文 → 按 akas 的
       CN+CJK 别名找回中文名（拼音不算）；现名含 CJK 一律不动（v2.33.0 用户令）。 */
    const iron = await page.evaluate(async () => {
      const now = Date.now();
      const a = { sid: 'tv900005', title: 'Mock Cn Show (Test)', year: '2016', total: 0, cover: '/tracker-icon-512.png', eps: [], statuses: {}, status: 'watching', addedAt: now, updAt: now };
      window.shows.push(a);
      const r1 = await refreshNamesFor(a, { save: false });
      const b = { sid: 'tv900005b', title: '气泡公主（测试）', year: '2016', total: 0, cover: '/tracker-icon-512.png', eps: [], statuses: {}, status: 'watching', addedAt: now, updAt: now };
      const before = b.title;
      const r2 = await refreshNamesFor(b, { save: false });
      window.shows = window.shows.filter((x) => x !== a && x !== b);
      return { t1: a.title, ren1: r1.renamed, from1: r1.from, t2: b.title, before2: before, ren2: r2.renamed };
    });
    check('31', 'v2.36.0 刷名剧名铁律：中文剧英文名按 akas 找回中文名（拼音不认）；CJK 现名永不覆盖',
      iron.t1 === '气泡公主（测试）' && iron.ren1 === 1 && iron.from1 === '中文名' && iron.t2 === iron.before2 && iron.ren2 === 0,
      JSON.stringify(iron));

    /* T32 v2.36.0 单集标记时间戳：单标/批量都记 epT，取消/清除即删 */
    const ept = await page.evaluate(() => {
      const s = { sid: 'ept-t', title: 'x', statuses: {}, eps: [] };
      for (let i = 1; i <= 5; i++) s.eps.push({ s: i, sn: 1, en: i, t: '第' + i + '集' });
      const t0 = Date.now();
      setEpStat(s, 3, 'watched');
      const t3 = (s.epT || {})[3] || 0;
      bulkWatchRange(s, 1, 5);
      const bulkN = Object.keys(s.epT || {}).length;
      setEpStat(s, 3, null);
      const cleared = (s.epT || {})[3] === undefined;
      return { stamped: t3 > 0 && Math.abs(t3 - t0) < 60000, bulkN: bulkN, cleared: cleared };
    });
    check('32', 'v2.36.0 单集时间戳：单标与批量标记都记 epT，取消即清',
      ept.stamped && ept.bulkN >= 4 && ept.cleared, JSON.stringify(ept));

    /* T33 v2.36.0 漫改行两档时间：有 epT → 漫改自己的开始~看完+用时；老数据无 epT → 退回全剧口径；无漫改集整行为空 */
    const cnp = await page.evaluate(() => {
      const mk = (withT) => {
        const eps = []; for (let i = 1; i <= 4; i++) eps.push({ s: i, t: '第' + i + '集', src: i <= 3 ? 'canon' : 'filler' });
        const s = { sid: 'cnp-t', title: 'x', kind: '动画', eps: eps, statuses: { 1: 'watched', 2: 'watched', 3: 'watched' } };
        if (withT) { s.epT = { 1: Date.now() - 4 * 86400000, 2: Date.now() - 2 * 86400000, 3: Date.now() }; }
        s.tStart = Date.now() - 9 * 86400000; s.tDone = Date.now();
        return s;
      };
      const withT = canonProgHtml(mk(true)), noT = canonProgHtml(mk(false));
      const noCn = canonProgHtml({ sid: 'cnp-n', title: 'x', kind: '动画', eps: [{ s: 1, t: 'e1', src: 'filler' }], statuses: { 1: 'watched' } });
      return { withT: withT, noT: noT, noCn: noCn === '' };
    });
    check('33', 'v2.36.0 漫改行时间两档：有 epT 给漫改账（看完含用时）；老数据退回全剧口径；无漫改整行为空',
      /漫改 <b>3<\/b> \/ 3 集/.test(cnp.withT) && /漫改用时/.test(cnp.withT) && /全剧开始/.test(cnp.noT) && !/漫改开始/.test(cnp.noT) && cnp.noCn,
      JSON.stringify(cnp).slice(0, 300));

    // T18 无页面级 JS 错误
    check('18', '全程无页面级 JS 错误', pageErrors === 0, 'pageErrors=' + pageErrors);
  } catch (e) {
    check('99', '测试执行异常', false, String(e && e.stack || e).slice(0, 400));
  }
  /* 收尾必须有硬超时：browser.close() 一旦卡住（Chrome 残留、驱动无响应），
     后面写结果文件和打 SUMMARY 都到不了 —— 症状是断言全 PASS、进程却一直不退出、
     最后被外层超时 SIGTERM 砍掉，连「29/29」这行都看不到。判据一个字没松，
     只是不让「关浏览器」这件事有资格否决全部结果。 */
  if (browser) { try { await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]); } catch (e) { } }
  try { mock.kill(); } catch (e) { }
  try { pySrv.kill(); } catch (e) { }
  fs.writeFileSync(path.join(__dirname, 'last-regression.json'), JSON.stringify({ t: new Date().toISOString(), results }, null, 1));
  const fails = results.filter(r => !r.ok);
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS' + (fails.length ? ' :: FAILED: ' + fails.map(r => 'T' + r.id + r.name).join(' | ') : ''));
  process.exit(fails.length ? 1 : 0);
})();
