/* tests/cover-v2410-e2e.js —— 「封面全都要」门禁（v2.41.0）
   用户令：「封面全都要，比如一键拉取，目前我的在看为什么那么多没」。
   这个门禁守的是四条根因各修到了没有，任何一条回退都会让「一片灰」回来：
     C01 内置库成了封面源（302 部里 278 张自家 CDN 图，离线、人工校对）
     C02 AniList 成了封面源（动画覆盖最全、CORS 全开、免 key）
     C03 裂过的远程图重新进补封面池（coverBy='net' 那行豁免不再把死图永久豁免掉）
     C04 __coverFail 真的记账（以前只换占位图，条目自己不知道封面死了）
     C05 一键拉取前的死图体检能分辨「活着」和「挂了」
     C06 一键拉取走 coverOnly：不再顺带拉集表（提速，否则补 20 部要几分钟）
     C07 占位升级成首字票券，且浅/深两套都出得来
     C08 入口按钮在（「⟳ 一键拉封面」）
     C09 无页面级 JS 错误

   量具纪律（沿用 name-refresh-e2e 那两条，别改回去）：
     ① 下种前先把启动期后台活等完（4 秒），否则启动自愈会在断言中途改条目；
     ② 需要「离线可判」的断言一律桩掉网络源，只用纯函数与本地 http 服务，
        不依赖外网——外网只留给 C02 这一条本身就是要验 AniList 的用例。 */
const path = require('path');
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
/* 一张真实可达的图（内置库 CDN），用来验「活着的封面不该被判死」 */
const LIVE_IMG = 'https://cloud1-d7gsn5t0w6407b963-1460816419.tcloudbaseapp.com/covers/a8c0923b62b2.jpg';

(async () => {
  const PORT = 8155;
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
    await sleep(4000);   /* 等启动自愈那一轮跑完再下种 */

    /* ---------- C01 / C07：纯函数，不需要网络 ---------- */
    const lib = await page.evaluate(() => {
      const s = { sid: 'c-test-1', title: '海贼王', nameJp: 'One Piece', aliases: ['One Piece'] };
      const miss = window.coverFromLib({ sid: 'c-test-2', title: '不存在的剧名XYZ', aliases: [] });
      return { hit: String(window.coverFromLib(s) || ''), miss: String(miss || '') };
    });
    check('C01', '内置库成了封面源：命中《海贼王》返回 CDN 图，乱写的名字返回空',
      /^https?:\/\/.+\.(jpg|jpeg|png|webp)/i.test(lib.hit) && lib.miss === '', JSON.stringify(lib));

    const ph = await page.evaluate(() => {
      const el = document.documentElement;
      const old = el.getAttribute('data-theme');
      el.setAttribute('data-theme', 'light');
      const l = String(window.coverPHChar('海贼王'));
      el.setAttribute('data-theme', 'dark');
      const d = String(window.coverPHChar('海贼王'));
      el.setAttribute('data-theme', old || 'dark');
      const raw = decodeURIComponent(l.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
      return { l: l.slice(0, 30), d: d.slice(0, 30), hasChar: raw.indexOf('>海<') >= 0, differ: l !== d };
    });
    check('C07', '占位升级为首字票券：SVG 里写着「海」，且浅/深两套不同',
      ph.l.indexOf('data:image/svg+xml') === 0 && ph.hasChar && ph.differ, JSON.stringify(ph));

    /* ---------- C02：AniList 封面源（真联网，这条本来就在验外网可达性） ---------- */
    const al = await page.evaluate(async () => {
      try {
        const a = await window.coverFromAniList({ sid: 'c-test-3', title: '鬼灭之刃', aliases: [] });
        const b = await window.coverFromAniList({ sid: 'c-test-4', title: '不存在的动画XYZQQQ', aliases: [] });
        return { hit: String(a || ''), miss: String(b || '') };
      } catch (e) { return { err: String(e) }; }
    });
    check('C02', 'AniList 成了封面源：命中《鬼灭之刃》，查不到的名字不硬塞图',
      /^https?:\/\//.test(al.hit || '') && (al.miss || '') === '', JSON.stringify(al));

    /* ---------- C03 / C04：死封面复活 + 裂图记账 ---------- */
    const dead = await page.evaluate(() => {
      const s = { sid: 'c-dead-1', title: '某部剧', cover: 'https://example.invalid/nope.jpg', coverBy: 'net' };
      const before = window.coverNeedsHeal(s);
      window.markCoverDead('c-dead-1') ;           /* sid 不在片单里：应静默不动 */
      s.__inList = true;
      return { before };
    });
    /* 上面那条只验「未裂时被豁免」，真正的记账要在真实片单条目上验 */
    const dead2 = await page.evaluate(() => {
      try {
        window.shows = window.shows || [];
        const s = { sid: 'c-dead-2', title: '死封面剧', cover: 'https://example.invalid/nope.jpg', coverBy: 'net', total: 12, eps: [], statuses: {} };
        window.shows.push(s);
        const before = window.coverNeedsHeal(s);
        window.markCoverDead('c-dead-2');
        const after = window.coverNeedsHeal(s);
        const stamped = !!s.coverDead;
        /* 补成功后该撤销 */
        window.clearCoverDead(s);
        const cleared = window.coverNeedsHeal(s);
        return { before, after, stamped, cleared };
      } catch (e) { return { err: String(e) }; }
    });
    check('C03', '死封面复活：coverBy=net 原本被豁免 → 记一笔 coverDead 后重新进池 → 补成后撤销',
      dead.before === false && dead2.before === false && dead2.after === true && dead2.stamped === true && dead2.cleared === false,
      JSON.stringify({ d1: dead, d2: dead2 }));

    const failHook = await page.evaluate(async () => {
      try {
        window.shows = window.shows || [];
        const s = { sid: 'c-fail-1', title: '记账剧', cover: 'https://example.invalid/nope.jpg', coverBy: 'net', total: 5, eps: [], statuses: {} };
        window.shows.push(s);
        const img = document.createElement('img');
        img.setAttribute('data-sid', 'c-fail-1');
        img.setAttribute('data-ph', '记账剧');
        document.body.appendChild(img);
        img.onerror = null;
        window.__coverFail(img);
        await new Promise(r => setTimeout(r, 200));
        const got = !!s.coverDead;
        const src = String(img.src).slice(0, 24);
        img.remove();
        return { got, src };
      } catch (e) { return { err: String(e) }; }
    });
    check('C04', '__coverFail 会记账：裂图命中 sid → 打 coverDead，并把 src 换成占位',
      failHook.got === true && String(failHook.src).indexOf('data:image/svg') === 0, JSON.stringify(failHook));

    /* ---------- C05：死图体检能分辨活/死 ---------- */
    const scan = await page.evaluate(async (live) => {
      try {
        const good = { sid: 'c-live-1', title: '活图', cover: live };
        const bad = { sid: 'c-bad-1', title: '死图', cover: 'http://127.0.0.1:8155/definitely-not-here.jpg' };
        const dead = await window.coverScanDead([good, bad]);
        return { n: dead.length, sids: dead.map(x => x.sid) };
      } catch (e) { return { err: String(e) }; }
    }, LIVE_IMG);
    check('C05', '死图体检：只报真正挂掉的那张，活着的封面不误伤',
      scan.n === 1 && scan.sids && scan.sids[0] === 'c-bad-1', JSON.stringify(scan));

    /* ---------- C06：coverOnly 不拉集表 ----------
       断言的是「集表一个都不拉」，不是「零请求」——封面源自己当然要发请求
       （/shows/{id} 取海报、/search/shows 按名找条目），那正是这一轮要干的事。
       集表（/shows/{id}/episodes）才是纯浪费：一部几百集，20 部就是 20 次大请求。 */
    const only = await page.evaluate(async () => {
      try {
        window.shows = window.shows || [];
        const s = { sid: 'tv779', title: '带号的剧', tvId: 779, cover: '', total: 3, eps: [], statuses: {} };
        window.shows.push(s);
        const calls = [];
        const orig = window._wget;
        window._wget = function (u) { calls.push(String(u)); return Promise.resolve(null); };
        await window.refreshNamesFor(s, { save: false, coverOnly: true });
        /* 对照组：不走 coverOnly 时，同一条目一定去拉集表 */
        const calls2 = [];
        window._wget = function (u) { calls2.push(String(u)); return Promise.resolve(null); };
        await window.refreshNamesFor(s, { save: false });
        window._wget = orig;
        const ep1 = calls.filter(u => /\/episodes/.test(u)).length;
        const ep2 = calls2.filter(u => /\/episodes/.test(u)).length;
        return { ep1, ep2, n1: calls.length, n2: calls2.length };
      } catch (e) { return { err: String(e) }; }
    });
    check('C06', '一键拉取走 coverOnly：集表一次都不拉（对照组确实会拉）',
      only.ep1 === 0 && only.ep2 >= 1, JSON.stringify(only));

    /* ---------- C08：入口按钮 ----------
       这条专门守「入口不许再被简化掉」：上一轮把 renderSrcBar 覆写成清空+隐藏，
       补封面按钮从界面上消失了整整一个版本，而底层功能一直好好的。 */
    const btn = await page.evaluate(() => {
      window.renderSrcBar();
      const el = document.getElementById('srcBar');
      const t = el ? el.textContent : '';
      const b = el ? el.querySelector('button[onclick*="coverHealAll"]') : null;
      return { txt: t, has: t.indexOf('一键拉封面') >= 0, shown: el ? el.style.display !== 'none' : false, wired: !!b };
    });
    check('C08', '界面上有可点的「⟳ 一键拉封面」入口（可见且接到 coverHealAll）',
      btn.has === true && btn.shown === true && btn.wired === true, JSON.stringify(btn));

    /* ---------- C09：无页面级 JS 错误 ---------- */
    check('C09', '无页面级 JS 错误', errs.length === 0, errs.join(' | '));

    console.log('SUMMARY ' + pass + '/' + (pass + fail));
    const out = path.join(__dirname, 'last-cover-v2410.json');
    require('fs').writeFileSync(out, JSON.stringify({ pass, fail, ts: Date.now() }, null, 2));
    if (fail) process.exitCode = 1;
  } finally {
    try { await browser.close(); } catch (e) {}
    srv.kill();
  }
})();
