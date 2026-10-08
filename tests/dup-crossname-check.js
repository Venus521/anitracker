/* tests/dup-crossname-check.js —— 「同一部剧，两个叫法」是不是同一条（v2.46.0）
   用户两次都一样的话：「为什么一样的剧还是重复了」。他不在电脑前，所以这次先自己量。

   审查下来的事实（全部取样自项目自带的 ani-tracker-lib.json，不是编的对子）：
     302 条内置库里 **301 条**（99.7%）在同一个 id 下挂着不止一个叫法——
     海贼王↔One Piece、火影忍者疾风传↔Naruto: Shippuden、名侦探柯南↔Detective Conan……
     也就是说「这部剧到底有几个名字」这件事，**本机本来就有一份人工校对过的答案**。
   可从 v2.19.1 起，sameShowPair 只比 title 归一化全等：内置库加一条《海贼王》、
   全网搜索加一条《One Piece》，就是两条各记一半进度——这正是他看到的样子。
   addShow（4989 行）那条拦截同样只比 title + bgmId，于是源头也不拦。

   本门禁守「加了桥之后既不多吃、也不少吃」：
     Q02 每一种跨叫法（中↔英 / 中文别名）都要被检出为同一组
     Q03 合并后账单要对得上：少一半、两边已看的集取并集一条都不丢
     Q04 对照（最严的一条）：不同作品的条目，**故意给同样的总集数**让那道集数闸失效，
        也不许被并 —— 桥接错了比不接更糟（《海贼王》被换成水墨错图那条老教训）
     Q05 源头：开着《海贼王》再加《One Piece》要被拦下来，不该长出第二条
     Q06 老保护不许被新桥吃掉：整部 vs 其中一季（1168 vs 24）这种不同粒度，仍然不许并
     E00 全程无页面级 JS 错误 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'tests', '_artifacts', 'dupcross');
const PORT = 8179;
const N = 40;                       /* 取样多少部（每部两行：中文名 / 另一个叫法） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (ok ? '' : '  :: ' + String(detail).slice(0, 360)));
  ok ? pass++ : fail++;
}
function probePort(port) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/index.html', timeout: 1500 },
      (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probePort(PORT)) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const PAGE = process.env.AT_PAGE || 'index.html';
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/^https?:\/\/127\.0\.0\.1/.test(u) || /^data:/.test(u)) return req.continue();
      return req.abort();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5200);

    const prepared = await page.evaluate((n) => {
      window.AT_NO_AUTODUR = true;
      const L = window.INTERNAL_SHOWS || [];
      /* 「同一部有几个名字」这份名单：把库自己挂的叫法摊开 */
      const wash = (t) => String(t || '').trim();
      const multi = L.filter((x) => {
        const alt = [x.nameJp].concat(x.aliases || []).map(wash).filter((t) => t && wash(t) !== wash(x.title));
        return alt.length > 0;
      });
      return { libN: L.length, multiN: multi.length };
    }, N);
    check('Q01', '量具前提：内置库已加载，「同一 id 下挂了多个叫法」的条目足够多（本机自带的校对答案）',
      prepared.libN >= 280 && prepared.multiN >= 280, JSON.stringify(prepared));
    console.log('INFO Q01 内置库 ' + prepared.libN + ' 条，其中 ' + prepared.multiN + ' 条有多于一个叫法');

    /* Q02/Q03：同一个 IsRecord 的两个叫法，各记一半进度 */
    const seeded = await page.evaluate((n) => {
      const wash = (t) => String(t || '').trim();
      const L = (window.INTERNAL_SHOWS || []).filter((x) => {
        const alt = [x.nameJp].concat(x.aliases || []).map(wash).filter((t) => t && wash(t) !== wash(x.title));
        return alt.length > 0;
      });
      const pick = L.slice(0, n);
      window.shows = [];
      pick.forEach(function (it, i) {
        const alt = [it.nameJp].concat(it.aliases || []).map(wash).filter((t) => t && wash(t) !== wash(it.title));
        const total = Number(it.total) || 24;
        const sidA = 'xa' + i, sidB = 'xb' + i;
        /* 两边各记一半 —— 用户截图里正是这个形状（一条在看 26 集、一条想看 25 集） */
        window.shows.push({ sid: sidA, title: wash(it.title), nameJp: '', aliases: [], total: total, eps: [],
          statuses: { 1: 'watched', 2: 'watched' }, status: 'watching', addedAt: Date.now() - 9000, updAt: Date.now() - 9000 });
        window.shows.push({ sid: sidB, title: alt[0], nameJp: '', aliases: [], total: total, eps: [],
          statuses: { 2: 'watched', 3: 'watched' }, status: 'want', addedAt: Date.now(), updAt: Date.now() });
      });
      try { window.save(); } catch (e) {}
      const groups = (typeof window.findDupGroups === 'function') ? window.findDupGroups() : [];
      return { pairs: pick.length, built: window.shows.length, groups: groups.length,
        totalNMiss: pick.map(function (it, i) { return { t: it.title }; }).slice(0, 0) };
    }, N);
    check('Q02', '跨叫法（《海贼王》vs《One Piece》这种）要被判成同一组：' +
      seeded.groups + '/' + seeded.pairs + ' 组',
      seeded.groups === seeded.pairs, JSON.stringify(seeded));

    const merged = await page.evaluate(() => {
      const before = (window.shows || []).length;
      let n = 0;
      if (typeof window.doMergeDups === 'function') n = window.doMergeDups(true);
      const after = (window.shows || []).length;
      const keepOne = (window.shows || []).filter((s) => String(s.sid).indexOf('xa') === 0 || String(s.sid).indexOf('xb') === 0)[0];
      return { before: before, after: after, merged: n, kept: keepOne ? keepOne.statuses : null };
    });
    check('Q03', '合并后应当是三十九库一半：' + merged.before + ' → ' + merged.after + ' 条，且两边已看过的集一条都不丢',
      merged.after === merged.before / 2 && merged.merged === N &&
      merged.kept && merged.kept['1'] === 'watched' && merged.kept['2'] === 'watched' && merged.kept['3'] === 'watched',
      JSON.stringify(merged));

    /* Q04 对照：不同作品，故意给同一 Early summary（让集数闸失效），不许被桥接误并 */
    const neg = await page.evaluate(() => {
      const wash = (t) => String(t || '').trim();
      const L = window.INTERNAL_SHOWS || [];
      const a = L[0], b = L[Math.floor(L.length / 2)], c = L[L.length - 1];
      const mk = (sid, title, total, marks) => ({ sid: sid, title: title, nameJp: '', aliases: [],
        total: total, eps: [], statuses: marks, status: 'watching', addedAt: Date.now(), updAt: Date.now() });
      window.shows = [mk('na', wash(a.title), 12, { 1: 'watched' }), mk('nb', wash(b.title), 12, { 2: 'watched' }),
        mk('nc', wash(c.title), 12, { 3: 'watched' })];
      const g = (typeof window.findDupGroups === 'function') ? window.findDupGroups() : [];
      let m = 0;
      if (typeof window.doMergeDups === 'function') m = window.doMergeDups(true);
      return { titles: [wash(a.title), wash(b.title), wash(c.title)], groups: g.length, merged: m, left: window.shows.length };
    });
    check('Q04', '对照：三部不相干的剧（还故意给成同一总集数 12）不许被并 —— 桥接错了比不接更糟',
      neg.groups === 0 && neg.merged === 0 && neg.left === 3, JSON.stringify(neg));

    /* Q05 源头：已经有一部《海贼王》，再加《One Piece》不许长出第二条 */
    const guard = await page.evaluate(() => {
      const wash = (t) => String(t || '').trim();
      const L = window.INTERNAL_SHOWS || [];
      const it = L.filter((x) => {
        const alt = [x.nameJp].concat(x.aliases || []).map(wash).filter((t) => t && wash(t) !== wash(x.title));
        return alt.length > 0;
      })[0];
      if (!it) return { skip: true };
      const alt = [it.nameJp].concat(it.aliases || []).map(wash).filter((t) => t && wash(t) !== wash(it.title))[0];
      window.shows = [{ sid: 'same-1', title: wash(it.title), nameJp: '', aliases: [], total: Number(it.total) || 24,
        eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now() }];
      const before = window.shows.length;
      try {
        window.addShow({ sid: 'same-2', title: alt, nameJp: '', cover: '', year: String(it.year || ''),
          total: Number(it.total) || 24, eps: [], statuses: {}, status: 'watching',
          addedAt: Date.now(), updAt: Date.now(), source: '手动添加' });
      } catch (e) {}
      return { skip: false, title: wash(it.title), alt: alt, before: before, after: window.shows.length };
    });
    check('Q05', '源头：已经有《' + (guard.title || '') + '》，再以《' + (guard.alt || '') + '》的名义添加时应当被拦住（不许多一条）',
      !guard.skip && guard.after === guard.before, JSON.stringify(guard));

    /* Q06 不许的热情：整部 vs 其中一季，不许因为「是同一部剧」就连粒度一起并掉 */
    const granu = await page.evaluate(() => {
      const mk = (sid, title, total) => ({ sid: sid, title: title, nameJp: '', aliases: [],
        total: total, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now() });
      window.shows = [mk('ga', '海贼王', 1168), mk('gb', 'One Piece', 24)];
      const g = (typeof window.findDupGroups === 'function') ? window.findDupGroups() : [];
      let m = 0;
      if (typeof window.doMergeDups === 'function') m = window.doMergeDups(true);
      return { groups: g.length, merged: m, left: window.shows.length };
    });
    check('Q06', '粒度保护仍然成立：整部（1168 集）与其一季（24 集）不许合并 —— 加了桥也不许的热情过头',
      granu.groups === 0 && granu.merged === 0 && granu.left === 2, JSON.stringify(granu));

    check('E00', '全程无页面级 JS 错误', errs.length === 0, errs.join(' | '));
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log('\nGATES ' + (fail ? 'RED' : 'ALL GREEN') + ' pass=' + pass + ' fail=' + fail + '  artifacts=' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH ' + String(e)); process.exit(2); });
