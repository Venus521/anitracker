/* tests/dedupe-merge-e2e.js —— 「豆瓣和追迹都有的要合并」门禁（v2.43.0）
   用户令：「豆瓣和追迹都有的要合并」。

   守两件事：
     A. **别再长新的重复**——豆瓣一行与片单条目其实是同一部时，必须判得出「已在片单」。
        老逻辑只拿「豆瓣中文段」比「片单正名」，于是三种最常见组合全部漏判：
          M01 片单存英文原名（Cowboy Bebop）／豆瓣给中文名（星际牛仔）
          M02 片单存中文名／豆瓣给双语（星际牛仔 Cowboy Bebop）
          M03 片单的名字挂在别名里（AniList 加的条目）
        ——漏判的结果就是导入后多一条，两条各记一半进度。
     B. **已经长出来的能合掉**——v2.19.1 那次同名去重是只跑一次的存量清理，
        之后新长的重复一条都收不掉，所以要有能随时点的合并：
          M04 检出重复组；M05 合并后条数变少、进度取并集、封面取有的
          M06 工具条：没重复时不显示这颗钮，有重复时才冒出来
     M07 不相干的两部不许被误判成重复（误合并比不合并糟得多）
     M08 无页面级 JS 错误 */
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

(async () => {
  const PORT = 8159;
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
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (/^https?:\/\/127\.0\.0\.1/.test(u) || /^data:/.test(u)) return req.continue();
      return req.abort();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);
    await sleep(4000);

    /* ---------- M01~M03：豆瓣行 ↔ 片单条目 的匹配 ---------- */
    const match = await page.evaluate(() => {
      window.shows = [];
      /* 片单三条：分别用 英文原名 / 纯中文名 / 别名 存同一类情况 */
      window.shows.push({ sid: 'm1', title: 'Cowboy Bebop', nameJp: 'カウボーイビバップ', aliases: [], total: 26, eps: [], statuses: {} });
      window.shows.push({ sid: 'm2', title: '海贼王', nameJp: '', aliases: ['One Piece'], total: 1168, eps: [], statuses: {} });
      window.shows.push({ sid: 'm3', title: '进击的巨人', nameJp: '', aliases: ['Attack on Titan', '進撃の巨人'], total: 25, eps: [], statuses: {} });
      /* 豆瓣三行：中文名 / 双语名 / 只有原名 */
      var d1 = { subjectId: '1001', title: '星际牛仔', origTitle: 'Cowboy Bebop', cnTitle: '星际牛仔' };
      var d2 = { subjectId: '1002', title: '海贼王 One Piece', origTitle: 'One Piece', cnTitle: '海贼王' };
      var d3 = { subjectId: '1003', title: 'Attack on Titan', origTitle: '', cnTitle: '' };
      var t1 = window.dbTargetOf(d1), t2 = window.dbTargetOf(d2), t3 = window.dbTargetOf(d3);
      /* 对照：一部片单里没有的 */
      var dx = { subjectId: '9999', title: '不存在的剧XYZ', origTitle: '', cnTitle: '' };
      return {
        m1: t1 ? t1.sid : '', m2: t2 ? t2.sid : '', m3: t3 ? t3.sid : '',
        miss: window.dbTargetOf(dx) ? 'HIT' : ''
      };
    });
    check('M01', '片单存英文原名 + 豆瓣给中文名 → 判得出「已在片单」', match.m1 === 'm1', JSON.stringify(match));
    check('M02', '片单存中文名 + 豆瓣给双语名 → 判得出「已在片单」', match.m2 === 'm2', JSON.stringify(match));
    check('M03', '片单的名字挂在别名里 + 豆瓣给那个叫法 → 判得出「已在片单」', match.m3 === 'm3', JSON.stringify(match));

    /* ---------- M03b：季数不能剥错（v2.44.3）----------
       旧口径是无条件`.replace(/[0-9]+$/,'')`，本意是把「第一季/第二季」并成同一部，
       但它把「灌篮高手 2」也削成「灌篮高手」—— 两部不同的电影被并成一条，进度全丢；
       同时「咒术回战（第二季）」括号里是中文数字「第二季」，旧正则只认阿拉伯数字，剥不掉。
       实测这两条正是「同一份片单在豆瓣和追迹对不上」的常见形态。
       量具只验归一化后的可比性（dbNormTitle 是判据的地基），不验 dbTargetOf：
       后者要拿全局 shows 摆样本，容易在「哪条该命中」上写反。 */
    const season = await page.evaluate(() => {
      const n = window.dbNormTitle;
      return {
        s1: n('漫长的季节 第二季') === n('漫长的季节'),      /* 中文数字季数该被剥掉 → 同一部 */
        s2: n('咒术回战（第二季）') === n('咒术回战'),        /* 全角括号里的中文季数 */
        s3: n('漫长的季节 第2季') === n('漫长的季节'),       /* 阿拉伯数字 */
        s4: n('Battle Spirits S2') === n('Battle Spirits'),  /* S1/S2 缩写 */
        bad1: n('灌篮高手 2') !== n('灌篮高手'),              /* 裸数字是续作编号，必须不同 */
        bad2: n('浪客行') !== n('浪客行者和狗')                /* 前缀相同但不同剧 */
      };
    });
    check('M03b', '季数只认「第N季/部/卷/篇」与S1/S2：同剧不同季归一化后并成一条，全角括号版也对得上',
      season.s1 && season.s2 && season.s3 && season.s4, JSON.stringify(season));
    check('M03c', '裸数字不再被当季数剥掉：续作编号与不同剧绝不归一化到同一键（错并比漏并更糟）',
      season.bad1 && season.bad2, JSON.stringify(season));

    /* ---------- M03d：内置库当译名桥（v2.44.3）----------
       前两道（按 dbId、按名字集合比）只在两边叫法重合时有效。剩下那类两边都没错、
       纯靠字符串永远对不上：豆瓣叫 Cowboy Bebop、追迹存的是「星际牛仔」。
       内置库 301 条人工校对了中英对照，于是「豆瓣那个叫法在库里是哪部、
       那部在片单里叫什么」这条链接上了。判据仍然是归一化全等，没有模糊匹配。 */
    const bridge = await page.evaluate(() => {
      const lib = window.INTERNAL_SHOWS || [];
      /* 拿库里真实条目当素材：豆瓣侧给 nameJp（外文），片单侧存 title（中文） */
      const items = lib.filter(x => x.nameJp && x.nameJp !== x.title);
      let hit = 0; const miss = [];
      items.forEach(L => {
        window.shows = [{ sid: 'b_' + L.id, title: L.title, nameJp: '', aliases: [], total: 0, eps: [], statuses: {} }];
        const d = { subjectId: '', title: L.nameJp, origTitle: L.nameJp, cnTitle: '', year: L.year };
        if (window.dbTargetOf(d)) hit++; else miss.push(L.title);
      });
      /* 反向：剧场版是另一部作品，绝不该被当成同一部并掉 */
      window.shows = [{ sid: 'b_to', title: '海贼王 剧场版', nameJp: '', aliases: [], total: 0, eps: [], statuses: {} }];
      const theatre = window.dbTargetOf({ subjectId: '', title: 'One Piece', origTitle: 'One Piece', cnTitle: '' });
      return { n: items.length, hit, miss: miss.slice(0, 5), theatre: theatre ? theatre.sid : '' };
    });
    check('M03d', '内置库译名桥：豆瓣给外文名 + 片单存中文名，靠库里中英对照认出来（≥95%）',
      bridge.n > 0 && bridge.hit / bridge.n >= 0.95,
      JSON.stringify(bridge));
    check('M03e', '剧场版绝不并进正篇（它是另一部作品，并了进度就废了）',
      bridge.theatre === '', 'theatre=' + bridge.theatre);

    /* ---------- M04 / M05：合并重复 ---------- */
    const merge = await page.evaluate(async () => {
      window.shows = [];
      var eps = n => Array.from({ length: n }, (_, i) => ({ s: i + 1, t: '第 ' + (i + 1) + ' 集' }));
      /* 两条《海贼王》：一条有封面+看到 26 集，一条集表更全+看到 25 集（不同集号有交叉） */
      window.shows.push({ sid: 'd1', title: '海贼王', cover: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', total: 1168, rating: 9,
        eps: eps(30), statuses: { 1: 'watched', 2: 'watched', 3: 'watched', 4: 'watched', 5: 'rewatch' }, status: 'watching', addedAt: 1000, updAt: 2000 });
      window.shows.push({ sid: 'd2', title: '海贼王', cover: '', total: 1168,
        eps: eps(50), statuses: { 3: 'watched', 6: 'watched', 7: 'watched' }, status: 'want', addedAt: 500, updAt: 3000 });
      window.shows.push({ sid: 'x1', title: '另一部不相干的剧', total: 12, eps: eps(12), statuses: { 1: 'watched' } });
      var groups = window.findDupGroups();
      var extra = window.dupExtraCount();
      var before = window.shows.length;
      var merged = window.doMergeDups(true);
      var after = window.shows.length;
      var s = window.shows.filter(function (x) { return x.title === '海贼王'; })[0] || {};
      /* 进度并集：d1 的 1,2,3,4 + 5(回看) 与 d2 的 3,6,7 —— 3 应保留优先级高的 rewatched? 不，3 都是 watched */
      var keys = Object.keys(s.statuses || {}).sort(function (a, b) { return (+a) - (+b); });
      var tomb = {}; try { tomb = JSON.parse(localStorage.getItem('at_tomb') || '{}'); } catch (e) {}
      return {
        groupsN: groups.length, extra: extra, before: before, after: after, merged: merged,
        keys: keys, keep5: s.statuses ? s.statuses['5'] : '', cover: !!s.cover, rating: s.rating || 0,
        epsN: (s.eps || []).length, tombHas: !!tomb['d1'] || !!tomb['d2'],
        other: window.shows.filter(function (x) { return x.title === '另一部不相干的剧'; }).length
      };
    });
    check('M04', '检出重复组（两条《海贼王》算一组，可并掉 1 条）',
      merge.groupsN === 1 && merge.extra === 1, JSON.stringify(merge));
    check('M05', '合并后：条数少 1、进度取并集不丢、封面取有的、落败者立墓碑',
      merge.after === merge.before - 1 && merge.merged === 1 &&
      merge.keys.indexOf('1') >= 0 && merge.keys.indexOf('6') >= 0 && merge.keys.indexOf('7') >= 0 &&
      merge.cover === true && merge.tombHas === true, JSON.stringify(merge));
    check('M07', '不相干的剧没被误并（仍独立一条）', merge.other === 1, JSON.stringify(merge));

    /* ---------- M06：工具条按钮按需出现 ---------- */
    const bar = await page.evaluate(() => {
      window.shows = [{ sid: 'z1', title: '只有一部', total: 10, eps: [], statuses: {} }];
      window._dupCache = { at: 0, groups: null };
      window.renderSrcBar();
      var a = document.getElementById('srcBar').textContent || '';
      window.shows = [
        { sid: 'z2', title: '重名剧', total: 10, eps: [], statuses: {} },
        { sid: 'z3', title: '重名剧', total: 10, eps: [], statuses: {} }
      ];
      window._dupCache = { at: 0, groups: null };
      window.renderSrcBar();
      var b = document.getElementById('srcBar').textContent || '';
      var btn = document.getElementById('srcBar').querySelector('button[onclick*="mergeDupsNow"]');
      window.shows = [];
      window._dupCache = { at: 0, groups: null };
      return { noDup: a.indexOf('合并重复') < 0, hasDup: b.indexOf('合并重复') >= 0, wired: !!btn };
    });
    check('M06', '工具条：没重复时不显示「合并重复」，有重复时才冒出来且接得上',
      bar.noDup === true && bar.hasDup === true && bar.wired === true, JSON.stringify(bar));

    check('M08', '无页面级 JS 错误', errs.length === 0, errs.join(' | '));

    console.log('SUMMARY ' + pass + '/' + (pass + fail));
    fs.writeFileSync(path.join(__dirname, 'last-dedupe-merge.json'), JSON.stringify({ pass, fail, ts: Date.now() }, null, 2));
    if (fail) process.exitCode = 1;
  } finally {
    try { await browser.close(); } catch (e) {}
    srv.kill();
  }
})();
