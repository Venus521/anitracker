/* tests/ep-duration-check.js —— 「自定义集数和时长对不上」门禁（v2.44.5）
   用户报：「自定义集数和时长对不上呢」。根因在 rebaseEps：改集数时给每一集硬写 dur:24，
   于是真人剧（该 45 分/集）和剧场版（该 100 分/集）整本时长账被按 24 分重算，
   连已有的真值时长也被覆盖掉；而 e.dur>0 又让账目自认「有真值」，估算值不再标「约」。

   量具走**真实入口**（点「✎ 编辑集数」→ 主题弹窗填数 → 确认），不直接调 rebaseEps：
   v2.44.4 刚踩过「直接调 API 的门禁全绿、用户那条路一次都没成」，这条不许复发。

   守的事：
     G01 美剧改集数后全剧 = 45 × 新集数
     G02 改集数不许抹掉已有单集真值（41 分钟原样保住）
     G03 剧场版改集数后 = 100 分（旧代码把一部电影报成 24 分钟）
     G05 混合账（一部分有真值）仍标「约」，并把话写明「部分缺单集时长 · 缺的按类型估」
     G06 对照组：动画改集数后仍是 24 × N（修法不许把本来对的那类改坏）
     G07 每条都有真值时不许出现「约」（反向谎报也挡）
     G08 时长账自洽：逐条单集分钟汇总 == 全剧分钟、各季汇总 == 全剧、详情页那行渲染得出字
     G09 内置库「＋ 添加到片单」那条路同样不许编造时长（同一缺陷的第二处，走的是另一扇门）
     G11 豆瓣联想那条路（接口压根没格式信号）不许闷声按动画估：话要写明档位，并给一颗点得动的钮
     G12 真实手指走一遍弹窗：预设 chip 填数→改成 46→存，账当场转成实测、落进存档
     G13 对照组：内置库预览复用同一函数，说档位但不许长出编辑钮
     E00 全程无页面级 JS 错误 · E01 真实入口可达且集数确实改成输入值 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'tests', '_artifacts', 'epdur');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (ok ? '' : '  :: ' + String(detail).slice(0, 320)));
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

/* epsDur = 每条单集带的真值分钟（null = 只有总集数、没有单集数据）
   expAfter = 改完集数后「全剧」那格该有的分钟数；needApprox = 这行该不该带「约」 */
const FX = [
  { sid: 'g1-usdrama', kind: '美剧', total: 24, newTotal: 20, epsDur: null, gate: 'G01',
    expAfter: 45 * 20, needApprox: true,
    note: '美剧改集数后时长按 45 分/集算（旧代码按 24 算，整本账少一半）' },
  { sid: 'g2-realdur', kind: '美剧', total: 10, newTotal: 12, epsDur: 41, gate: 'G02',
    expAfter: 41 * 10 + 45 * 2, needApprox: true,
    note: '改集数保住真值 41 分、新加的 2 集按类型估（旧代码把 41 抹成 24）' },
  { sid: 'g3-anime', kind: '动画', total: 25, newTotal: 20, epsDur: null, gate: 'G06',
    expAfter: 24 * 20, needApprox: true,
    note: '对照组：动画本来就该是 24 分/集，数值不许被这次修法改动' },
  { sid: 'g4-film', kind: '剧场版', total: 2, newTotal: 1, epsDur: null, gate: 'G03',
    expAfter: 100, needApprox: true,
    note: '剧场版改集数后按 100 分算（旧代码把一部电影报成 24 分钟）' },
  { sid: 'g5-allreal', kind: '美剧', total: 10, newTotal: 8, epsDur: 41, gate: 'G07',
    expAfter: 41 * 8, needApprox: false,
    note: '每条都有真值时不许带「约」（一律标约同样是谎报）' }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PORT = 8171;
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probePort(PORT)) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  /* 负测用：AT_PAGE 指到一份改回旧行为的副本，真身一个字不动 */
  const PAGE = process.env.AT_PAGE || 'index.html';
  /* 负测跑的是 HEAD 副本：图另存一个后缀，墙上正好是「修前 vs 修后」两栏 */
  const TAG = process.env.AT_SHOT_TAG || (process.env.AT_PAGE ? '-before' : '');
  const rows = [];
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

      /* 只截时长那一行：墙上要看的就是这行字，不是整页 */
      const shot = async (name) => {
        try { const el = await page.$('#dDur'); if (el) await el.screenshot({ path: path.join(OUT, name + '.png') }); } catch (e) {}
      };
      const read = () => page.evaluate(() => {
        const s = window.shows[0], d = window.durOf(s), el = document.getElementById('dDur');
        return { total: d.total, epMin: d.epMin, known: d.known, partial: !!d.partial,
          def: window.defDurMin(s), eps: (s.eps || []).length,
          durs: (s.eps || []).slice(0, 3).map((e) => (typeof e.dur === 'number' ? e.dur : null)),
          sum: (s.eps || []).reduce((a, e) => a + (Number(e.dur) > 0 ? Number(e.dur) : window.defDurMin(s)), 0),
          seasSum: Object.keys(d.seasons).reduce((a, k) => a + d.seasons[k].total, 0),
          text: ((el && el.innerText) || '').replace(/\s+/g, ' ').trim(),
          visible: !!(el && el.offsetParent !== null) };
      });

    for (const fx of FX) {
      await page.evaluate((f) => {
        const eps = [];
        if (f.epsDur) for (let i = 1; i <= f.total; i++) eps.push({ s: i, t: 'E' + i, dur: f.epsDur });
        window.shows = [{ sid: f.sid, title: f.sid, kind: f.kind, total: f.total,
          eps: eps, statuses: {}, addedAt: Date.now(), updAt: Date.now() }];
        window.openDetail(f.sid);
      }, fx);
      await sleep(400);

      const before = await read();
      const clicked = await page.evaluate(() => {
        const b = [].slice.call(document.querySelectorAll('.ty'))
          .filter((x) => x.offsetParent !== null && /editTotal\(\)/.test(x.getAttribute('onclick') || ''))[0];
        if (!b) return false;
        b.click(); return true;
      });
      await sleep(300);
      const dlg = await page.evaluate(() => !!document.getElementById('udInp'));
      if (dlg) {
        await page.evaluate(() => { const i = document.getElementById('udInp'); if (i) i.value = ''; });
        await page.type('#udInp', String(fx.newTotal), { delay: 12 });
        await page.evaluate(() => { const y = document.getElementById('udYes'); if (y) y.click(); });
        await sleep(500);
      }
      const after = await read();
      if (after.visible && after.text) {
        try { const el = await page.$('#dDur'); if (el) await el.screenshot({ path: path.join(OUT, fx.sid + '.png') }); } catch (e) {}
      }
      rows.push({ fx, clicked, dlg, before, after });
    }

    /* G09：内置库「＋ 添加到片单」这条路（addInternal）——它以前也硬写 dur:24。
       用库里真实那类条目当样本（type 为「剧场版」的 25 部之一），断言这次修的四件事：
       新建的集不许带编造时长、整行必须标「约」、账要自洽、剧场版的格式要走到时长账。
       v2.44.5b 之后：addInternal 把内置库的「剧场版」带到 kind 上（G09b），
       存量条目另走一次性回填（G10，种进 localStorage 后刷新页面，让迁移自己跑）。 */
    const g9 = await page.evaluate(async () => {
      const L = window.INTERNAL_SHOWS;
      if (!L || !L.length) return { skip: '内置库没加载（INTERNAL_SHOWS 空）' };
      const lib = L.filter((x) => /剧场版|电影/.test(String(x.type || '')))[0] || L[0];
      window.shows = [];
      await window.addInternal(lib.id);
      const s = window.shows.filter((x) => x.title === lib.title)[0];
      if (!s) return { skip: 'addInternal 没建出条目' };
      window.openDetail(s.sid);
      const d = window.durOf(s);
      return { libId: lib.id, libType: lib.type, libN: (lib.eps || []).length,
        kind: s.kind || '', libIsFilm: String(lib.type) === '剧场版',
        eps: (s.eps || []).length, fake: (s.eps || []).filter((e) => typeof e.dur === 'number').length,
        total: d.total, def: window.defDurMin(s), known: d.known,
        sum: (s.eps || []).reduce((a, e) => a + (Number(e.dur) > 0 ? Number(e.dur) : window.defDurMin(s)), 0) };
    });
    await sleep(400);
    if (g9.skip) {
      check('G09', '内置库添加路径新建的集不带编造时长', false, g9.skip);
    } else {
      const a9 = await read();
      check('G09', '内置库「＋ 添加到片单」：新建的集不写编造时长、整行标「约」、账自洽（样本 ' +
        g9.libId + ' type=' + g9.libType + '，' + g9.eps + ' 集）',
        g9.fake === 0 && g9.eps === g9.libN && a9.known === false && a9.text.indexOf('约') >= 0 &&
        Math.abs(g9.sum - g9.total) <= 1,
        JSON.stringify({ fake: g9.fake, eps: g9.eps, libN: g9.libN, known: a9.known, text: a9.text.slice(0, 150) }));
      /* v2.44.5b：格式信号必须一路走到时长账。内置库标「剧场版」的条目入片单后
         按整片 100 分估，不许再退回动画 24 分/集（一部电影报 24 分钟＝用户说的对不上）。 */
      check('G09b', '内置库「剧场版」入片单后按整片 100 分估（kind 带到条目、defDurMin 不再退回 24）',
        !!g9.libIsFilm && g9.kind === '剧场版' && g9.def === 100 && g9.total === 100 &&
        a9.text.indexOf('1 小时 40 分') >= 0,
        JSON.stringify({ libType: g9.libType, kind: g9.kind, def: g9.def, total: g9.total, text: a9.text.slice(0, 160) }));
      console.log('INFO G09 样本 ' + g9.libId + ' type=' + g9.libType + ' → kind=' +
        (g9.kind || '（空）') + ' · 按 ' + g9.def + ' 分/集估 · 全片 ' + g9.total + ' 分');
    }

    /* G10：存量条目的回填（v2.44.5b）。这条只能走真路径——回填挂在内置库数据集到达之后，
       所以种进 localStorage 再刷新页面，让迁移自己跑；直接调函数会绕过「同名但 24 集」
       那类护栏。对照组三件：该回填的、库里没这名的、与库里剧场版同名但 24 集的。 */
    const g10seed = await page.evaluate(() => {
      const L = window.INTERNAL_SHOWS || [];
      const film = L.filter((x) => String(x.type) === '剧场版')[0];
      if (!film) return { skip: '内置库没有剧场版样本' };
      const mk = (sid, title, total) => ({ sid: sid, title: title, total: total, eps: [],
        statuses: {}, addedAt: Date.now(), updAt: Date.now(), source: 'gate' });
      const seed = [mk('bk-film', film.title, 1), mk('bk-unknown', film.title + 'Z', 1),
        mk('bk-tv', film.title, 24)];
      localStorage.setItem('tr_shows', JSON.stringify(seed));
      localStorage.removeItem('at_filmkind_v2445');
      return { filmTitle: film.title };
    });
    if (g10seed.skip) {
      check('G10', '存量剧场版回填', false, g10seed.skip);
    } else {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(7000);
      const g10 = await page.evaluate(() => {
        const all = window.shows || [];
        const pick = (sid) => {
          const s = all.filter((x) => x.sid === sid)[0];
          if (!s) return null;
          const d = window.durOf(s);
          return { kind: s.kind || '', def: window.defDurMin(s), total: d.total };
        };
        return { film: pick('bk-film'), unknown: pick('bk-unknown'), tv: pick('bk-tv'),
          flag: localStorage.getItem('at_filmkind_v2445') };
      });
      check('G10', '片单里旧版建好的「剧场版」条目（无 kind、片单级 type 已被 v2.4.2 迁移删掉）' +
        '刷新后回填成整片 100 分，且同名 24 集的与库里没名的都不动',
        !!g10.film && g10.film.kind === '剧场版' && g10.film.total === 100 &&
        !!g10.unknown && g10.unknown.kind === '' && !!g10.tv && g10.tv.kind === '' && g10.flag === '1',
        JSON.stringify(g10));
    }
    /* ===== G11/G12/G13（v2.44.6，用户令「时长还是对不上」）：豆瓣联想这条路 =====
       suggest 接口只回标题/封面/集数（type 一律 'movie'，没有格式信号），条目建出来 kind 是空的
       ⇒ 整本账退回动画 24 分/集，而旧版页面既没说要事是什么档、也没给任何能改的地方。
       这次修的是两件：话写明「按哪一档估、多少分/集」，并当场给一颗点得动的钮。
       G13 反向对照：内置库预览复用同一个函数，但不许长出编辑钮（库条目不是片单条目）。 */
    const g11 = await page.evaluate(() => {
      const eps = [];
      for (let i = 1; i <= 52; i++) eps.push({ s: i, t: '第 ' + i + ' 集' });
      window.shows = [{ sid: 'db-1299664', title: '大宋提刑官', kind: '', nameJp: '', year: '2005',
        total: 52, eps: eps, statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(),
        source: '豆瓣联想', manual: 1 }];
      window.openDetail('db-1299664');
      const s = window.shows[0], d = window.durOf(s), el = document.getElementById('dDur');
      /* v2.44.6c：出口不是独立按钮，是这一行本身（行尾挂「✎ 改时长」标记）。
         可点区量的就是这一行的矩形——比任何小钮都好点，且不多占一行高。 */
      const b = el.classList.contains('dedit') ? el : null;
      const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 };
      const mark = [].slice.call(el.querySelectorAll('.durfix'))
        .filter((x) => /改时长/.test(x.textContent || ''))[0];
      const dlRow = Math.round((el ? el.getBoundingClientRect().height : 0));
      return { def: window.defDurMin(s), total: d.total, known: d.known,
        est: (typeof window.durEstTxt === 'function')
          ? window.durEstTxt(s) : '（页面没有 durEstTxt＝估档那句话没有单一出口）',
        text: ((el && el.innerText) || '').replace(/\s+/g, ' ').trim(),
        btn: !!b, btnVisible: !!b && b.offsetParent !== null,
        btnW: Math.round(r.width), btnH: Math.round(r.height),
        marker: !!mark, durH: dlRow,
        /* 首屏铁律（phone-use 抓到过 875>851）量的是 393×851 下第一行集整行可见，
           那条判据归 phone-use（本门禁是桌面视口，量不到）；这里锁住「行是入口」这件事本身。 */
        hasEditor: typeof window.editDur === 'function',
        hasTap: typeof window.durLineTap === 'function' };
    });
    await sleep(400);
    await shot('g11' + TAG);
    /* 一部 52 集的国产剧不许被叫成动画（kind 空 ⇒ 只报档位）；那颗钮还得是真能点的：
       手机走查抓到过 73×23，34px 是这项目的地板（phone-look 同源判据） */
    check('G11', '豆瓣联想条目（无格式信号）：写明「没标类型，按最低档估 24 分/集」＋时长行本身是可点区 ≥34px 的入口（旧版只说「按类型估」、无处可改）',
      g11.def === 24 && g11.total === 24 * 52 && g11.known === false && g11.hasEditor && g11.hasTap &&
      g11.est === '没标类型，按最低档估 24 分/集' && g11.text.indexOf(g11.est) >= 0 && g11.marker &&
      g11.btn && g11.btnVisible && g11.btnW >= 34 && g11.btnH >= 34,
      JSON.stringify(g11));

    const g12 = await page.evaluate(() => {
      const el = document.getElementById('dDur');
      if (!el.classList.contains('dedit')) return { skip: '时长行不是触点（没挂 dedit）' };
      /* 真实手指：点行尾「✎ 改时长」那一下（事件从标记冒泡到行） */
      const mk = [].slice.call(el.querySelectorAll('.durfix'))[0] || el;
      mk.click();
      const box = document.getElementById('uiDlgMask');
      return { dlg: !!box, chips: [].slice.call((box || document).querySelectorAll('.udChip')).map((c) => c.textContent),
        inp: !!document.getElementById('udInp'),
        msg: (((box || {}).querySelector ? box.querySelector('.mini') : null) || {}).textContent || '' };
    });
    if (g12.skip) {
      check('G12', '设定单集时长弹窗', false, g12.skip);
    } else {
      /* 真实手指顺序：点「真人剧 45」chip → 框里落 45 → 用户再改成 46 → 存 */
      const chipOk = await page.evaluate(() => {
        const c = document.querySelectorAll('.udChip')[1];
        if (!c) return false;
        c.click();
        const i = document.getElementById('udInp');
        return !!i && i.value === '45';
      });
      await page.evaluate(() => { document.getElementById('udInp').value = ''; });
      await page.type('#udInp', '46', { delay: 12 });
      await page.evaluate(() => { document.getElementById('udYes').click(); });
      await sleep(500);
      const after = await read();
      await shot('g12' + TAG);
      const persisted = await page.evaluate(() => {
        const s = (JSON.parse(localStorage.getItem('tr_shows') || '[]')).filter((x) => x.sid === 'db-1299664')[0] || {};
        const el = document.getElementById('dDur');
        return { epDur: Number(s.epDur) || 0, kind: s.kind || '',
          btns: el.classList.contains('dedit') ? 1 : 0,
          marker: [].slice.call(el.querySelectorAll('.durfix')).filter((x) => /改时长/.test(x.textContent || '')).length };
      });
      check('G12', '弹窗有预设 chip（动画/真人剧/剧场版）；点 chip 填数、手改成 46 存下后 52 集 = 2392 分、「约」当场消失、' +
        '写进存档，且那颗钮留在原处（设完还得能改）',
        g12.dlg && g12.inp && g12.chips.length === 3 && chipOk &&
        after.total === 46 * 52 && after.known === true && after.def === 46 &&
        after.text.indexOf('约') < 0 && after.text.indexOf('分/集') < 0 &&
        after.text.indexOf('单集 46 分钟') >= 0 &&
        persisted.epDur === 46 && persisted.kind === '电视剧' &&
        persisted.btns === 1 && persisted.marker === 1,
        JSON.stringify({ dlg: g12.dlg, chips: g12.chips, chipOk, total: after.total,
          known: after.known, def: after.def, text: after.text.slice(0, 170), persisted }));
    }

    /* G12b：同一件事的数据源那条路——AniList 同步把 duration 写成 s.epDur（不是用户手填）。
       旧版只认逐集 e.dur，这类条目一直挂着「约 46 分钟」，其实 46 就是量出来的。 */
    const g12b = await page.evaluate(() => {
      const eps = [];
      for (let i = 1; i <= 12; i++) eps.push({ s: i, t: 'E' + i });
      window.shows = [{ sid: 'al-declared', title: 'al-declared', kind: '美剧', total: 12, epDur: 46,
        eps: eps, statuses: { 1: 'watched', 2: 'watched', 3: 'watched' }, addedAt: Date.now(), updAt: Date.now() }];
      window.openDetail('al-declared');
      const s = window.shows[0], d = window.durOf(s), el = document.getElementById('dDur');
      return { total: d.total, known: d.known, partial: !!d.partial, watched: d.watched,
        text: ((el || {}).innerText || '').replace(/\s+/g, ' ').trim() };
    });
    await sleep(300);
    await shot('g12b' + TAG);
    check('G12b', '数据源给的整部级时长（AniList duration → s.epDur）算实测：全剧 552 分、已看 138 分、整行不带「约」',
      g12b.total === 46 * 12 && g12b.watched === 138 && g12b.known === true && g12b.partial === false &&
      g12b.text.indexOf('约') < 0 && g12b.text.indexOf('分/集') < 0 && g12b.text.indexOf('单集 46 分钟') >= 0,
      JSON.stringify(g12b));

    const g13 = await page.evaluate(() => {
      const L = window.INTERNAL_SHOWS || [];
      let lib = null;
      for (const x of L) { const d = window.durOf(x); if (!d.known && !d.film && d.total) { lib = x; break; } }
      if (!lib) return { skip: '内置库没有「按类型估」的样本' };
      window.showInternalDetail(lib.id);
      const el = document.getElementById('dDur');
      const txt = ((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
      el.click();
      const dlgAfter = !!document.getElementById('udInp');
      if (dlgAfter) { const x = document.getElementById('udNo'); if (x) x.click(); }
      return { id: lib.id, text: txt, saysKind: /估 \d+ 分\/集/.test(txt) && txt.indexOf('约') >= 0,
        isTap: el.classList.contains('dedit'), marker: [].slice.call(el.querySelectorAll('.durfix')).length,
        editBtns: [].slice.call(el.querySelectorAll('button'))
          .filter((x) => /editDur\(\)/.test(x.getAttribute('onclick') || '')).length,
        openedDialog: dlgAfter };
    });
    await sleep(300);
    await shot('g13' + TAG);
    if (g13.skip) {
      check('G13', '内置库预览', false, g13.skip);
    } else {
      check('G13', '对照组：内置库预览同一行也说清按哪档估，但这一行不许是入口（无标记、点不开弹窗——库条目不是片单条目）',
        g13.saysKind && g13.editBtns === 0 && g13.isTap === false && g13.marker === 0 &&
        g13.openedDialog === false && g13.text.indexOf('约') >= 0, JSON.stringify(g13));
    }

    check('E00', '全程无页面级 JS 错误', errs.length === 0, errs.join(' | '));
    check('E01', '真实入口可达：点「✎ 编辑集数」弹主题窗、填数确认后集数确实变成输入值',
      rows.every((r) => r.clicked && r.dlg && r.after.eps === r.fx.newTotal),
      JSON.stringify(rows.map((r) => [r.fx.sid, r.clicked, r.dlg, r.after.eps])));

    for (const r of rows) {
      const f = r.fx, a = r.after;
      const approxOk = f.needApprox
        ? (a.known === false && a.text.indexOf('约') >= 0)
        : (a.known === true && a.text.indexOf('约') < 0);
      check(f.gate, f.note + '（期望 ' + f.expAfter + ' 分钟，实量 ' + a.total + '；' +
        (f.needApprox ? '应带约' : '不应带约') + '）',
        Math.abs(a.total - f.expAfter) <= 1 && approxOk && r.before.text.length > 0,
        JSON.stringify({ before: r.before.total, after: a.total, known: a.known, text: a.text.slice(0, 180) }));
      if (f.sid === 'g2-realdur') {
        check('G05', '混合账（10 条真值 + 2 条估）整行仍标「约」，且把话写明：部分缺单集时长 · 缺的按类型估',
          a.known === false && a.partial === true && a.text.indexOf('部分缺单集时长') >= 0, a.text);
      }
      check('G08-' + f.sid, '时长账自洽：逐条汇总 == 全剧、各季汇总 == 全剧、详情页这行渲染得出字',
        Math.abs(a.sum - a.total) <= 1 && Math.abs(a.seasSum - a.total) <= 1 && a.text.length > 0,
        JSON.stringify({ sum: a.sum, total: a.total, seasSum: a.seasSum, text: a.text.slice(0, 100) }));
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(rows.map((r) => ({
      sid: r.fx.sid, kind: r.fx.kind, expAfter: r.fx.expAfter, needApprox: r.fx.needApprox,
      total: r.fx.total, newTotal: r.fx.newTotal, epsDur: r.fx.epsDur, gate: r.fx.gate,
      clicked: r.clicked, before: r.before, after: r.after })), null, 1), 'utf8');
    await browser.close();
    srv.kill();
  }

  console.log('\nsid        kind    before  expect  after   known  partial  durs-first3');
  rows.forEach((r) => {
    console.log([r.fx.sid.padEnd(11), r.fx.kind, String(r.before.total).padStart(6),
      String(r.fx.expAfter).padStart(7), String(r.after.total).padStart(6),
      String(r.after.known).padStart(6), String(r.after.partial).padStart(7),
      JSON.stringify(r.after.durs)].join('  '));
  });
  console.log('\nGATES ' + (fail ? 'RED' : 'ALL GREEN') + ' pass=' + pass + ' fail=' + fail + '  artifacts=' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH ' + String(e)); process.exit(2); });
