/* tests/phone-canon-check.js —— 手机档漫改对照（npm run test:phone-canon）
 *
 * v2.35.0（用户令「漫改这些恢复原来的」＋「除了整部进度，有漫改的还要显示漫改进度和时间」
 * ＋「不通过 AI 刷新片单的名字和剧集名」）三条需求的手机档验收。
 * 与 desktop-tier-check.js 互为对照：那边管桌面上不许变，这边管手机上必须恢复。
 *
 * 判据全用「触屏视口 + hover:none 媒体条件」真实命中，不用桌面档那套 width 近似——
 * AT_TOUCH() 判的是输入能力，用窄视口冒充触屏会得到假绿。
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8147;
const OUT = path.join(ROOT, 'tests', 'shots-phone');
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PY = process.env.AT_PY || 'python';
let pass = 0, fail = 0;
const T = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  :: ' + detail : ''));
  ok ? pass++ : fail++;
};
function probe() {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 },
      (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probe()) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    /* 触屏档：hover:none + pointer:coarse 由 emulate 强制命中，才算真手机档 */
    await page.emulate({
      viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 180)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);

    const d = await page.evaluate(async () => {
      try { localStorage.clear(); } catch (e) {}
      const vis = (el) => !!el && !!el.offsetParent;
      /* 量具前提：AT_TOUCH() 必须为真，否则这份门禁测的是桌面档，全部判据都假 */
      const touch = (function () { try { return matchMedia('(hover: none) and (pointer: coarse)').matches; } catch (e) { return false; } })();
      const eps = [];
      for (let i = 1; i <= 24; i++) eps.push({ s: i, sn: 1, en: i, t: '第 ' + i + ' 集', dur: 24, src: i < 6 ? 'canon' : 'filler' });
      addShow({ title: '手机档漫改测试片', nameJp: 'Phone Canon', total: 24, eps,
        statuses: { 1: 'watched', 2: 'watched', 3: 'rewatch' }, status: 'watching', year: '2024',
        source: '内置库', cover: '/tracker-icon-512.png',
        tStart: new Date(2026, 6, 5).getTime(), tStartFrom: 'me',
        tDone: new Date(2026, 7, 20).getTime(), tDoneFrom: 'me' });
      const s = (window.shows || [])[0]; if (!s) return { touch: touch, noSeed: true };
      renderList();
      /* 片单页那两条：v2.14.0「工具全砍」就把它们退役了（桌面同样不可见，renderSrcBar 是空实现），
         不是手机档问题。所以判据不能是「可见」——那会把v2.14 的决定也算成这轮的回归。
         正确判据是「样式表里不再有命中它们 display:none 的手机档规则」，即手机档没再额外藏一遍。
         扫规则文本而不是量可见性：可见性本来就受 v2.14 的空实现影响。 */
      const WANT = ['#vList>.srcbar', '#vList>.typerow'];
      const rules = [];
      const walk = (list, cond) => {
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          if (r.selectorText) {
            const sel = r.selectorText.replace(/\s+/g, '');
            if (r.style && r.style.display === 'none' && WANT.some((w) => sel.indexOf(w) >= 0)) {
              rules.push({ sel: sel, cond: cond == null ? '(无媒体条件)' : String(cond) });
            }
          } else if (r.cssRules) walk(r.cssRules, (r.media && r.media.mediaText) || r.conditionText || cond);
        }
      };
      for (let i = 0; i < document.styleSheets.length; i++) { try { walk(document.styleSheets[i].cssRules, null); } catch (e) {} }
      openDetail(s.sid);
      await new Promise((r) => setTimeout(r, 800));
      /* 长按菜单里的「改来源标注」——手机上的手动标注入口，v2.34.0 撤了，v2.35.0 要回来 */
      const ctxHas = (function () {
        const row = document.querySelector('#dGroups .eprow[data-ep]');
        if (!row) return { found: false };
        window.openEpCtx(0, 0, row.getAttribute('data-ep'));
        const m = document.querySelector('.ctxmenu');
        const txt = m ? (m.innerText || '') : '';
        if (window.closeCtx) window.closeCtx();
        return { found: true, txt: txt.replace(/\s+/g, ' ').trim() };
      })();
      /* 管理箱（资料/别名 · 关联条目 · 数据质量）：恢复后必须在，且排在「从片单移除」之后 */
      const boxInfo = (function () {
        const b = document.getElementById('at270Box');
        const del = document.querySelector('#vDetail button[onclick="delShow()"]');
        if (!b) return { present: false };
        const bt = b.getBoundingClientRect().top + window.scrollY;
        const dt = del ? del.getBoundingClientRect().top + window.scrollY : null;
        return { present: true, qual: !!document.getElementById('at270QualBtn'), afterDel: (dt == null) ? null : (bt > dt) };
      })();
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return {
        touch: touch,
        listRules: rules,
        typeRow: vis(document.getElementById('typeRow')),
        typeRowText: ((document.getElementById('typeRow') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
        canonProg: vis(document.getElementById('dCanonProg')),
        canonProgText: ((document.getElementById('dCanonProg') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
        ctxHas: ctxHas,
        boxInfo: boxInfo,
        refreshBtn: (function () { const b = document.getElementById('btnRefreshNames'); return !!b && /刷新片名与集名/.test(b.textContent); })(),
        aiUpdGone: !document.getElementById('btnAiUpd'),
        overflow: overflow,
      };
    });

    if (d.noSeed) { T('P00 量具前提：种子条目建成', false, JSON.stringify(d)); }
    else {
      T('P00 量具前提：AT_TOUCH() 为真（这份门禁真跑的是手机档）', d.touch === true, 'touch=' + d.touch);
      /* 这两条的可见性由 v2.14.0「工具全砍」决定（桌面同样不可见），不是这轮要翻的案。
         这里守的是「手机档没有再额外藏一遍」——藏回去了才算回归。 */
      T('P01 片单页来源筛选条/类型行没被手机档额外藏（v2.14 退役状态维持不变）',
        d.listRules.length === 0, JSON.stringify(d.listRules));
      T('P03 详情页类型筛选行可见（含漫改/TV原创/半原创/待核）',
        d.typeRow === true && /漫改/.test(d.typeRowText) && /TV原创/.test(d.typeRowText),
        'typeRow=' + d.typeRow + ' :: ' + d.typeRowText);
      T('P04 漫改进度行出现，进度+时间都在（2/5 集 · 40% · 全剧看完 2026-08-20）',
        d.canonProg === true && /漫改 2 \/ 5 集/.test(d.canonProgText) &&
        /40%/.test(d.canonProgText) && /全剧看完 2026-08-20/.test(d.canonProgText),
        'canonProg=' + d.canonProg + ' :: ' + d.canonProgText);
      T('P05 集级长按菜单恢复「改来源标注」', d.ctxHas.found === true && /改来源标注/.test(d.ctxHas.txt), d.ctxHas.txt || '(菜单没开出来)');
      T('P06 管理箱恢复在手机上，且排在「从片单移除」之后',
        d.boxInfo.present === true && d.boxInfo.afterDel === true, JSON.stringify(d.boxInfo));
      T('P07 名字刷新那颗在，且「✧ 让 AI 补新集」已退役', d.refreshBtn === true && d.aiUpdGone === true,
        'refreshBtn=' + d.refreshBtn + ' aiUpdGone=' + d.aiUpdGone);
      T('P08 390 宽无横向溢出', d.overflow <= 0, 'overflow=' + d.overflow);
    }
    await page.screenshot({ path: path.join(OUT, 'phone-canon-detail.png') });
    const pe = errs.filter((e) => e.indexOf('pageerror:') === 0);
    T('P09 全程无页面级 JS 错误', pe.length === 0, pe.slice(0, 2).join(' || '));
    console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' PASS'));
    fs.writeFileSync(path.join(OUT, 'phone-canon.json'), JSON.stringify({ d, errs }, null, 2));
    process.exitCode = fail ? 1 : 0;
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });