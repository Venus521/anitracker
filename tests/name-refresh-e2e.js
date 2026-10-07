/* tests/name-refresh-e2e.js —— 「不通过 AI 刷新片名与剧集名」门禁（v2.35.0）
   为什么单独一个门禁：这颗按钮的全部价值在于「自动改名字」这件事**安全**。
   一旦它覆盖了用户手填的名字，整份片单的信任就没了——用户从此不敢再让它跑。
   这里一个真实请求都不发，验四条不可退让的规矩：
     N01 片名按 TVMaze 号改成官方名
     N02 **手改过的片名绝不覆盖**（titleFrom='me'）
     N03 集名只补空：占位名被官方名替掉，已填的一律不动
     N04 **手改过的集名绝不覆盖**（nameFrom='me'）
     N05 官方有、本地没有的集按顺序追加，已看进度一条都不动
     N06 没 tvId 的条目不猜：一格都不改，也不发任何按剧名搜索
     N07 内置库优先：命中内置库时中文集名直接补上，一个请求都不发
     N08 按钮换人：「✧ 让 AI 补新集」退役 → 「⟳ 刷新片名与集名」，两端都可见
     N09 临时索引不留在条目上（否则会被 packAll 打进导出包与云同步）
     N10 手动点那颗：真的改了名，且回执说人话
     N11 无页面级 JS 错误

   量具纪律（两次踩坑换来的，别改回去）：
     ① **桩 _wget，不做网络拦截**。page.setRequestInterception 那条路上，页面自己的
        启动自愈、coverHealAll、addShow 里的后台刷新会同时在发请求，测量窗口量到的
        永远是它们的中间态——实测表现为「片名没被改」，看着像功能坏了。
        直接把 window._wget 换成同步可判的替身，请求归零、时序归零。
     ② **下种前先把启动期的后台活干完**（等 4 秒）。否则加片那轮自动校准
        会在断言中途改条目，量到半路状态。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (ok ? '' : '  :: ' + String(detail).slice(0, 320)));
  ok ? pass++ : fail++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function probe(port) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/index.html', timeout: 1500 },
      (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}
const OFFICIAL_NAME = '官方正名 · Calibrated';
/* 第 1 集的官方名与本地占位名不同（该被替掉），第 3 集本地已填（不许动），
   另给一条 S2E1 —— 本地没有，用来验追加。*/
const OFFICIAL_EPS = [
  { season: 1, number: 1, name: 'Official Ep One', runtime: 24, airdate: '2026-01-01' },
  { season: 1, number: 2, name: 'Official Ep Two', runtime: 24, airdate: '2026-01-08' },
  { season: 1, number: 3, name: 'Official Ep Three', runtime: 24, airdate: '2026-01-15' },
  { season: 2, number: 1, name: 'Official S2E1', runtime: 24, airdate: '2026-04-01' },
];

(async () => {
  const PORT = 8149;
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probe(PORT)) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 180)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);

    /* 先等启动期的后台活（校准/自愈/渲染）全部落定，再装桩 */
    await sleep(4000);

    /* 装桩：所有出网请求归零，只按 URL 形状应答我们关心的两个 */
    await page.evaluate((name, eps) => {
      try { localStorage.clear(); } catch (e) {}
      window.__calls = [];
      window._wget = function (u) {
        const path = String(u).split('?')[0];
        window.__calls.push(String(u));
        if (/\/shows\/\d+\/episodes$/.test(path)) return Promise.resolve(eps);
        if (/\/shows\/\d+$/.test(path)) return Promise.resolve({ id: 777, name: name, language: 'Japanese', premiered: '2026-01-01', genres: ['Anime'] });
        return Promise.resolve(null);   /* 封面源 / 搜索：全空，别让补封面拖时间 */
      };
    }, OFFICIAL_NAME, OFFICIAL_EPS);

    /* ---------- 建条目 ---------- */
    /* 三条种子都有假封面（data:image 开头）：让 coverNeedsHeal 直接返回 false，
       把封面自愈从名��这条测量里摘出去——不然 healCoverFor 会按剧名去 search/shows，
       请求数就不再是「名字刷新发了几个」这个量了（第一版就栽在这：N06 数到 3 个请求，
       其实全是封面补齐顺手发的搜索，跟按号取名没关系）。 */
    const PIX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    await page.evaluate((pix) => {
      const mk = () => ([
        { s: 1, sn: 1, en: 1, t: '第 1 集', dur: 24 },
        { s: 2, sn: 1, en: 2, t: '第 2 集', dur: 24 },
        { s: 3, sn: 1, en: 3, t: '第三集', tOrig: '我自己查的原文名', dur: 24, nameFrom: 'me' },
      ]);
      window.shows = [];
      addShow({ sid: 'tv777', tvId: 777, title: '原来的片名', nameJp: '', total: 3, cover: pix, coverBy: 'user',
        eps: mk(), statuses: { 1: 'watched' }, status: 'watching', source: '全网', updAt: Date.now() });
      addShow({ sid: 'tv778', tvId: 778, title: '我自己改的名字', nameJp: '', total: 3, cover: pix, coverBy: 'user',
        eps: mk(), statuses: {}, status: 'watching', source: '全网', titleFrom: 'me', updAt: Date.now() });
      /* 无号那条的 sid **不能**以 tv+数字开头：tvIdOf() 认 /^tv\d+$/，
         sid 叫 tv779 会被当成 tvId=779，第一版就是这么把「没号的剧」测成了有号（还顺手发了三个请求）。 */
      addShow({ sid: 'nopid-779', title: '没号的剧', nameJp: '', total: 3, cover: pix, coverBy: 'user',
        eps: mk(), statuses: {}, status: 'watching', source: '手动添加', updAt: Date.now() });
      renderList();
    }, PIX);
    await sleep(2000);   /* 等加片那轮自动校准落定 */

    /* ---------- N01/N03/N04/N05/N09 ---------- */
    const r1 = await page.evaluate(async (name) => {
      const s = bySid('tv777');
      /* 拨回「刷新前」：加片那轮已经自动校准过，不拨回去量到的是上一轮成果。
         v2.44.0 修 N01：种子必须是**纯外文现名**。原来写的是「原来的片名」——含 CJK，
         按 v2.33.0/v2.36.0 剧名铁律第①档（现名含 CJK → 外文官方名没资格覆盖）压根不该被改，
         于是 refreshNamesFor 正确地什么都没做，量具却判它「没改名」。这道门禁要验的是
         官方名校准那一档（现名纯外文），种子得给对前提。中文剧那一档由 T31/T34 守着。 */
      s.title = 'Original Placeholder Name'; delete s.titleFrom;
      s.eps = [
        { s: 1, sn: 1, en: 1, t: '第 1 集', dur: 24 },
        { s: 2, sn: 1, en: 2, t: '第 2 集', dur: 24 },
        { s: 3, sn: 1, en: 3, t: '第三集', tOrig: '我自己查的原文名', dur: 24, nameFrom: 'me' },
      ];
      s.total = 3; s.statuses = { 1: 'watched' };
      window.__calls = [];
      const out = await refreshNamesFor(s);
      return {
        out: out, title: s.title,
        eps: s.eps.map((e) => ({ s: e.s, t: e.t, tOrig: e.tOrig || '', tCn: e.tCn || '' })),
        statuses: JSON.stringify(s.statuses), total: s.total,
        webLeak: ('__webEps' in s),
        calls: (window.__calls || []).slice(),
      };
    }, OFFICIAL_NAME);
    check('N01', '片名按 TVMaze 号改成官方名（' + OFFICIAL_NAME + '）',
      r1.title === OFFICIAL_NAME, 'title=' + r1.title + ' calls=' + JSON.stringify(r1.calls));
    check('N03', '集名只补空：占位名（第1、2 集）被官方名替掉',
      r1.eps[0].tOrig === 'Official Ep One' && r1.eps[1].tOrig === 'Official Ep Two' &&
      r1.eps[0].t === 'Official Ep One' && r1.eps[1].t === 'Official Ep Two',
      JSON.stringify(r1.eps));
    check('N04', '手改过的集名绝不覆盖（第 3 集 tOrig 仍是我自己查的原文名，主名也不变）',
      r1.eps[2].tOrig === '我自己查的原文名' && r1.eps[2].t === '第三集', JSON.stringify(r1.eps[2]));
    check('N05', '缺集按官方集表追加（S2E1 变第 4 集），已看进度一条不动',
      r1.eps.length === 4 && r1.eps[3].tOrig === 'Official S2E1' &&
      r1.statuses === '{"1":"watched"}' && r1.total === 4,
      JSON.stringify({ epsN: r1.eps.length, last: r1.eps[3], statuses: r1.statuses, total: r1.total }));
    check('N09', '临时索引 __webEps 不留在条目上（否则会被 packAll 打进导出包与云同步）',
      r1.webLeak === false, '__webEps 泄漏=' + r1.webLeak);

    /* ---------- N02：手动改过的片名不许动 ---------- */
    const r2 = await page.evaluate(async () => {
      const s = bySid('tv778');
      s.eps[0].t = '第 1 集'; delete s.eps[0].tOrig;
      await refreshNamesFor(s);
      return { title: s.title, from: s.titleFrom, ep0: s.eps[0].tOrig || '' };
    });
    check('N02', '手改过的片名绝不覆盖（titleFrom=me 的那条仍叫「我自己改的名字」）',
      r2.title === '我自己改的名字' && r2.from === 'me', JSON.stringify(r2));

    /* ---------- N06：没号不猜 ---------- */
    const r3 = await page.evaluate(async () => {
      const s = bySid('nopid-779');
      const snap = JSON.stringify(s);
      window.__calls = [];
      const out = await refreshNamesFor(s);
      return { out: out, same: JSON.stringify(s) === snap, title: s.title, calls: (window.__calls || []).slice() };
    });
    check('N06', '没 tvId 的条目不猜：整条一格不动，也不发任何请求',
      r3.same === true && r3.calls.length === 0 && r3.title === '没号的剧',
      JSON.stringify({ same: r3.same, calls: r3.calls, title: r3.title }));

    /* ---------- N07：内置库优先且零请求 ---------- */
    const r4 = await page.evaluate(async () => {
      const lib = (window.INTERNAL_SHOWS || []).filter((x) => x.eps && x.eps.length && x.eps[0].t && x.eps[0].t !== '第 1 集')[0];
      if (!lib) return { noLib: true };
      /* sid 用纯字母数字+短横，别用「int:xxx」——safeSid() 会把冒号换成下划线，
         拼完的 sid 与查的 sid 对不上，bySid 就返回 undefined（第一版就这么栽的）。 */
      const sid = 'intlib-' + String(lib.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const n = Math.min(3, lib.eps.length);
      const fresh = () => { const a = []; for (let i = 1; i <= n; i++) a.push({ s: i, t: '第 ' + i + ' 集' }); return a; };
      addShow({ sid: sid, title: lib.title, nameJp: lib.nameJp || '', total: n, cover: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', coverBy: 'user',
        eps: fresh(), statuses: {}, status: 'watching', source: '内置库', updAt: Date.now() });
      const s = bySid(sid);
      if (!s) return { noSid: true, sid: sid, lib: lib.id };
      /* 还原成「全新的一批占位名对象」——不是把旧数组再赋回去。
         坑：加片那轮 refreshNamesFor 是就地改 tCn/tOrig 的，把旧数组重新赋回去等于没还原，
         量到的 named 恒为 0。还原必须连对象一起换新的；还要等那轮异步落定再还原第二次。 */
      s.eps = fresh();
      await new Promise((r) => setTimeout(r, 600));
      s.eps = fresh();
      await new Promise((r) => setTimeout(r, 200));
      window.__calls = [];
      const out = await refreshNamesFor(s);
      return { title: lib.title, out: out, calls: (window.__calls || []).length,
        eps: s.eps.map((e) => ({ s: e.s, t: e.t, tCn: e.tCn || '' })) };
    });
    if (r4.noLib) check('N07', '内置库优先且零请求', false, '内置库一条带中文集名的都没有（量具失效）');
    else if (r4.noSid) check('N07', '内置库优先且零请求', false, 'bySid(' + r4.sid + ') 返回 undefined（量具失效）');
    else check('N07', '内置库优先且零请求：《' + r4.title + '》中文集名直接补上，一个请求都不发',
      r4.out.named >= 3 && r4.calls === 0 && r4.eps[0].tCn !== '' && r4.out.from === '内置库',
      JSON.stringify({ out: r4.out, calls: r4.calls, eps: r4.eps.slice(0, 2) }));

    /* ---------- N08：按钮换人 ----------
       按钮在详情页的工具条里，详情页没打开时它整体 display:none，
       offsetParent 恒为 null——必须先 openDetail 再量，否则测的是「详情页关着」不是「按钮在不在」。 */
    await page.evaluate(() => { backList(); openDetail('tv777'); });
    await sleep(900);
    const r5 = await page.evaluate(() => {
      const b = document.getElementById('btnRefreshNames');
      return { txt: b ? (b.textContent || '').trim() : '(按钮不在)',
        vis: !!b && !!b.offsetParent,
        onclick: b ? String(b.getAttribute('onclick') || '') : '',
        aiUpdGone: !document.getElementById('btnAiUpd'),
        fnExists: typeof window.refreshNamesNow === 'function' };
    });
    check('N08', '「✧ 让 AI 补新集」退役，换成「⟳ 刷新片名与集名」且两端都可见',
      /刷新片名与集名/.test(r5.txt) && r5.vis === true && /refreshNamesNow/.test(r5.onclick) &&
      r5.aiUpdGone === true && r5.fnExists === true, JSON.stringify(r5));

    /* ---------- N10：手动点那颗 ---------- */
    const r6 = await page.evaluate(async () => {
      const s = bySid('tv777');
      /* v2.44.0 修 N10：同一个前提问题——「被改回去的名字」含 CJK，铁律下不动它，
         回执也说「都是最新的」。改用纯外文现名，才能真正走到「手动点那颗会改名并给回执」这条路。 */
      s.title = 'Some Manual Name'; delete s.titleFrom;
      renderList(); openDetail('tv777');
      await new Promise((r) => setTimeout(r, 600));
      const before = s.title;
      window.refreshNamesNow('tv777');
      await new Promise((r) => setTimeout(r, 1500));
      const toast = ((document.getElementById('toast') || {}).innerText || '').trim();
      return { before: before, after: bySid('tv777').title, toast: toast };
    });
    check('N10', '手动点那颗：片名真的被改回官方名，并给出说人话的��执',
      r6.after === OFFICIAL_NAME && /片名/.test(r6.toast), JSON.stringify(r6));

    const pe = errs.filter((e) => e.indexOf('pageerror:') === 0);
    check('N11', '全程无页面级 JS 错误', pe.length === 0, pe.slice(0, 2).join(' || '));
    console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' PASS'));
    fs.writeFileSync(path.join(ROOT, 'tests', 'last-name-refresh.json'), JSON.stringify({ pass, fail, errs }, null, 2));
    process.exitCode = fail ? 1 : 0;
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });