/* tests/dbinfo-dur-check.js —— 「自动拉的时长不对，要看豆瓣」门禁（v2.45.0）
   用户令：「很多剧和番你自动拉的时长不对啊，都说了要看豆瓣，封面也没有」。

   v2.44.6 那一版把「按类型估」说清楚了、也给了手填出口，但它留了个结论：
   「豆瓣联想这条路压根没有格式信号，免费源补不上」。那次只探到 suggest 那一层。
   再往下走一步，豆瓣详情页（rexxar /v2/tv/{id}）里就写着答案（2026-10-08 实测）：
     大宋提刑官 durations=["45分钟"] type=tv        漫长的季节 ["60分钟"]
     武林外传   ["48分钟"]  genre=喜剧 武侠 古装    肖申克的救赎(movie) ["142分钟"]
   于是本版改成：**详情一笔带两样东西**——单集分钟数（真值）+ 它到底是什么（格式信号），
   顺手把封面的词条号也记下来（下回补封面按号直达，不用再跑 suggest + 四级搜索）。

   本门禁守「不许走偏」，每条都对着一个已经踩过或差点踩到的坑：
     N01 带回真值后账转实测：不带「约」、全剧 = 真值 × 集数
     N02 名字对不上（《怪奇物语》搜出《怪奇物语 第五季》）一个字都不许写
     N03 他手填过的（epDurFrom='me'）不许被自动覆盖
     N04 同年卫兵：年份差 >1 不认（翻拍/重制）
     N05 只有类型信号没有分钟数时，把 24 的最低档抬起来（电视剧→45）
     N06 电影的 142 分钟不许乘进 12 集的剧里
     N07 详情带回的 id 要让补封面按号直达（请求里带 &id=）
     E00 全程无页面级 JS 错误

   dbInfo 用离线替身（函数也是 window 上的普通属性，能给的路径与前几轮 ward 同）——
   这里要量的是「拿到这份记录之后怎么落」，不是豆瓣那边现在答什么（那条由 _probe_dbinfo.py 实测）。
   所有外部请求一律 abort：门禁不许依赖公网，也不许横生嵌套的网络抖动。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'tests', '_artifacts', 'dbinfodur');
const PORT = 8177;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (ok ? '' : '  :: ' + String(detail).slice(0, 340)));
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

/* 离线替身：豆瓣那边的真实应答形状（真源_tests/_probe_dbinfo.py 实测过才敢抄） */
const STUB = {
  '大宋提刑官': { found: true, title: '大宋提刑官', id: '2239292', type: 'tv', dur: 45, eps: 52,
    genres: ['剧情', '悬疑', '历史'], year: '2005', cover: 'https://example.invalid/a.jpg' },
  '漫长的季节': { found: true, title: '漫长的季节', id: '35588177', type: 'tv', dur: 60, eps: 12,
    genres: ['剧情', '家庭', '犯罪'], year: '2023', cover: 'https://example.invalid/b.jpg' },
  '无时长有类型': { found: true, title: '无时长有类型', id: '9000001', type: 'tv', dur: 0, eps: 30,
    genres: ['剧情'], year: '2019', cover: '' },
  '怪奇物语': { found: true, title: '怪奇物语 第五季', id: '35774681', type: 'tv', dur: 78, eps: 8,
    genres: ['剧情', '科幻'], year: '2025', cover: '' },
  '大宋提刑官翻拍': { found: true, title: '大宋提刑官翻拍', id: '7000002', type: 'tv', dur: 46, eps: 40,
    genres: ['剧情'], year: '2005', cover: '' },
  '某部电影': { found: true, title: '某部电影', id: '1292052', type: 'movie', dur: 142, eps: 0,
    genres: ['剧情', '犯罪'], year: '1994', cover: '' },
  '查不到': { found: false, reason: 'no subject for 查不到' }
};

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
    await sleep(5000);

    /* 装上替身：dbInfo 是 window 上的普通属性（顶层 async function 声明），能被替；
      能不能替上本身就是一条断言：替不上说明这条口子不是给探针留的，离线门禁无从谈起。 */
    const stubbed = await page.evaluate((stub) => {
      window.AT_NO_AUTODUR = true;
      const before = typeof window.dbInfo;
      window.dbInfo = async function (t) { return stub[String(t || '').trim()] || null; };
      return { before: before, after: typeof window.dbInfo, same: window.dbInfo !== undefined };
    }, STUB);
    check('N00', 'dbInfo 可被替身接走（离线量具能装上去，门禁才不靠公网）',
      stubbed.before === 'function' && stubbed.after === 'function', JSON.stringify(stubbed));

    const seed = (fx) => page.evaluate((f) => {
      window.shows = [{ sid: f.sid, title: f.title, kind: f.kind || '', total: f.total,
        year: f.year || '', eps: [], statuses: {}, addedAt: Date.now(), updAt: Date.now(),
        epDur: f.epDur || 0, epDurFrom: f.epDurFrom || '' }];
      window.openDetail(f.sid);
      return true;
    }, fx);
    /* 负测（AT_PAGE 指到改动前那份）时这几个入口压根不存在：不许崩成 CRASH，
       要一条条判红——红得出来才叫「真身坏了才红」，崩溃只是把症状咽了。 */
    const run = () => page.evaluate(async () => {
      const s = window.shows[0];
      if (typeof window.healDurFor !== 'function') return false;
      try { await window.healDurFor(s, { save: false, silent: true }); } catch (e) {}
      return true;
    });
    const read = () => page.evaluate(() => {
      const s = window.shows[0], d = window.durOf(s), el = document.getElementById('dDur');
      return { epDur: Number(s.epDur) || 0, from: String(s.epDurFrom || ''), kind: String(s.kind || ''),
        kindFrom: String(s.kindFrom || ''), subId: String(s.dbSubId || ''),
        total: d.total, known: d.known, def: window.defDurMin(s), est: window.durEstTxt(s),
        text: ((el && el.innerText) || '').replace(/\s+/g, ' ').trim() };
    });

    /* N01 · 豆瓣带回真值：大宋提刑官 52 集 × 45 分（v2.44.6 那张截图上是 24 分 → 20 小时 48 分） */
    await seed({ sid: 'n1-cndrama', title: '大宋提刑官', total: 52 });
    await run();
    let a = await read();
    let shot = true;
    try { const el = await page.$('#dDur'); if (el) await el.screenshot({ path: path.join(OUT, 'n1.png') }); } catch (e) { shot = false; }
    check('N01', '豆瓣带回单集真值后：整本账转实测（45×52=2340 分），「约」与「无时长数据」都不许出现',
      a.epDur === 45 && a.from === 'db' && a.total === 2340 && a.known === true &&
      a.text.indexOf('约') < 0 && a.text.indexOf('没有时长数据') < 0,
      JSON.stringify({ ...a, shot }));
    console.log('INFO N01 那一行现在写的是：' + String(a.text).slice(0, 120));

    /* N02 · 名字对不上：不能把第五季的 78 分钟写进整部 */
    await seed({ sid: 'n2-season', title: '怪奇物语', total: 34 });
    await run();
    a = await read();
    check('N02', '标题对不上（《怪奇物语》配到《怪奇物语 第五季》）一律不许落账',
      a.epDur === 0 && a.kind === '' && a.total === 34 * 24 && a.known === false, JSON.stringify(a));

    /* N05 · 只有类型信号没分钟数：至少把 24 这一档抬到 45（这是「还是对不上」里最便宜的一半） */
    await seed({ sid: 'n5-kindonly', title: '无时长有类型', total: 30 });
    await run();
    a = await read();
    check('N05', '没有分钟数但有类型信号时：kind 立起来、估算档从 24 抬到 45',
      a.kind === '电视剧' && a.kindFrom === 'db' && a.def === 45 && a.total === 30 * 45 && a.epDur === 0,
      JSON.stringify(a));
    check('N05b', '抬档之后这句仍然是「估」的口径说的（按真人剧估 45 分/集），不许冒充实测',
      a.known === false && a.text.indexOf('约') >= 0 && a.est.indexOf('45 分/集') >= 0, JSON.stringify(a));

    /* N03 · 他手填过的不许被自动覆盖（含手填数字后又被抓到新数据的场景） */
    await seed({ sid: 'n3-mine', title: '大宋提刑官', total: 52, epDur: 46, epDurFrom: 'me' });
    await run();
    a = await read();
    check('N03', '他手填过的单集时长（46 分 / epDurFrom=me）不许被豆瓣那个 45 盖掉',
      a.epDur === 46 && a.from === 'me' && a.total === 52 * 46, JSON.stringify(a));

    /* N04 · 同年卫兵：年份差超过 1 年就不认（同名翻拍/重制） */
    await seed({ sid: 'n4-year', title: '大宋提刑官翻拍', total: 40, year: '2019' });
    await run();
    a = await read();
    check('N04', '两边年份差 >1（2005 对 2019）不认这部：不写时长、不认类型',
      a.epDur === 0 && a.kind === '' && a.total === 40 * 24, JSON.stringify(a));

    /* N06 · 电影的 142 分钟不许乘进多集剧里 */
    await seed({ sid: 'n6-movietv', title: '某部电影', total: 12 });
    await run();
    a = await read();
    check('N06', 'type=movie 的真值不许落进多集条目（12 集 × 142 分＝凭空造账）',
      a.epDur === 0 && a.total === 12 * 24, JSON.stringify(a));

    /* N07 · 详情带回的词条号要让补封面按号直达（cover URL 里带 &id=） */
    await seed({ sid: 'n7-id', title: '大宋提刑官', total: 52 });
    await page.evaluate(async () => {
      if (typeof window.healDurFor !== 'function') return;
      try { await window.healDurFor(window.shows[0], { save: false, silent: true }); } catch (e) {}
    });
    const cap = await page.evaluate(async () => {
      const seen = [];
      if (typeof window.healCoverFor !== 'function') return { seen: seen, subId: '', missing: true };
      window.doubanRelayCover = async function (name, id) { seen.push({ name: name, id: String(id || '') }); return ''; };
      try { await window.healCoverFor(window.shows[0], { save: false, relay: true }); } catch (e) {}
      return { seen: seen, subId: String(window.shows[0].dbSubId || '') };
    });
    check('N07', '补封面时用详情那一次核对过的词条号直达（请求里带 &id=2239292）',
      cap.subId === '2239292' && cap.seen.length > 0 && cap.seen.every((x) => x.id === '2239292'),
      JSON.stringify(cap));

    check('E00', '全程无页面级 JS 错误', errs.length === 0, errs.join(' | '));
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log('\nGATES ' + (fail ? 'RED' : 'ALL GREEN') + ' pass=' + pass + ' fail=' + fail + '  artifacts=' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH ' + String(e)); process.exit(2); });
