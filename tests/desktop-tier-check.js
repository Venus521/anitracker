/* tests/desktop-tier-check.js —— 桌面档对照实验（npm run test:desktop-tier）
 *
 * v2.34.0 把低频工具收进「⋯ 更多工具」抽屉，并把豆瓣/封面来源/数据质量/AI 工具按端分档，
 * 判据全挂在输入能力上（hover/pointer）。这类改动最怕漏到桌面上，所以这份门禁专门跑**桌面档**，
 * 断言「桌面一像素没动」：工具条还在主路上、五颗都在、抽屉根本开不出来、账号面板两行管理入口照旧。
 * 与 phone-use.js 的「13 分档」互为对照：那边管手机上不许出现，这边管桌面上不许消失。
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8136;
const OUT = path.join(ROOT, 'tests', 'shots-desktop');
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PY = process.env.AT_PY || 'python';
let pass = 0, fail = 0;
const T = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  :: ' + detail : ''));
  ok ? pass++ : fail++;
};
function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
/* 漫改标注 + 观看时间：v2.35.0 的漫改进度行要靠这两样才量得到。
   前 6 集标 canon、后 18 集标 filler；**已看进度写在条目级 statuses 上，不是集对象里**
   （写在集对象里那份是无效字段，会让 statOf 全算成未看 → 读数变成 0/6）。
   集号 s 必须逐集递增：老模板里写死 s:1，24 集全是同一个集号，statuses 会被最后一条覆盖。 */
const mkSeed = () => {
  const a = [];
  for (let i = 1; i <= 24; i++) a.push({ s: i, sn: 1, en: i, t: '第 ' + i + ' 集', dur: 24, src: i <= 6 ? 'canon' : 'filler' });
  return a;
};

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
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);

    const d = await page.evaluate(async (epsJson) => {
      try { localStorage.clear(); } catch (e) {}
      const vis = (el) => !!el && !!el.offsetParent;
      const R = (sel) => { const e = document.querySelector(sel); if (!e) return null;
        const r = e.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), h: Math.round(r.height) }; };
      addShow({ title: '桌面档测试片', nameJp: 'Desk Tier', total: 24, eps: JSON.parse(epsJson),
        statuses: { 1: 'watched', 2: 'watched', 3: 'rewatch' }, status: 'watching', year: '2024',
        source: '内置库', cover: '/tracker-icon-512.png',
        tStart: new Date(2026, 6, 5).getTime(), tStartFrom: 'me',
        tDone: new Date(2026, 7, 20).getTime(), tDoneFrom: 'me' });
      renderList();
      const s = (window.shows || [])[0]; if (!s) return null;
      /* 量具纪律：片单页的元素要在片单页还开着的时候量，切进详情再量必然全是 null */
      /* 把样式表里所有「display:none 且选择器命中那四条手机档选择器」的规则连媒体条件一起抓出来 */
      const WANTS = ['#vList>.srcbar', '#vList>.typerow', '#vDetail>.typerow', '#vDetail>.dtools'];
      const rules = [];
      const walk = (list, cond) => {
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          if (r.selectorText) {
            const sel = r.selectorText.replace(/\s+/g, '');
            /* 伪元素（::before/::after/::-webkit-scrollbar…）不是内容，
               它们上面的 display:none 不构成「把这一块功能藏起来」。
               v2.35.0 实测踩过：为了把类型行改成单行横滚，加了
               `#vDetail>.typerow::-webkit-scrollbar{display:none}`，结果这条门禁当场变红——
               量具把「藏起滚动条」读成了「藏起类型行」。选择器里有 :: 就不是内容元素。 */
            const isPseudo = sel.indexOf('::') >= 0;
            const isNone = !!(r.style && r.style.display === 'none');
            if (!isPseudo && isNone && WANTS.some(w => sel.indexOf(w) >= 0)) rules.push({ sel: sel, cond: cond == null ? '(无媒体条件)' : String(cond) });
          } else if (r.cssRules) {
            walk(r.cssRules, (r.media && r.media.mediaText) || r.conditionText || cond);
          }
        }
      };
      for (let i = 0; i < document.styleSheets.length; i++) {
        try { walk(document.styleSheets[i].cssRules, null); } catch (e) {}
      }
      const listView = { listShown: vis(document.getElementById('vList')), rules: rules };
      openDetail(s.sid);
      await new Promise((r) => setTimeout(r, 600));
      return {
        tools: [].slice.call(document.querySelectorAll('#dTools .ty')).filter(vis).map((b) => (b.textContent || '').trim()),
        toolBox: R('#dTools'), groups: R('#dGroups'), more: vis(document.getElementById('dMoreBtn')),
        statCard: R('#dStats .stat'), statgrid: R('#dStats'),
        listView: listView,
        dTypeRow: vis(document.getElementById('typeRow')), qual: vis(document.getElementById('at270QualBtn')),
        canonProg: vis(document.getElementById('dCanonProg')),
        canonProgText: ((document.getElementById('dCanonProg') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      };
    }, JSON.stringify(mkSeed()));
    if (!d) { T('D00 桌面档种子数据', false, 'addShow 没建出条目'); }
    else {
      T('D01 桌面详情页工具条五颗全在（名字刷新那颗不许被分档漏掉）', d.tools.length === 5, d.tools.join(' / '));
      T('D02 桌面抽屉入口不存在（#dMoreBtn 不渲染）', d.more === false, 'more=' + d.more);
      T('D03 桌面顺序照旧：工具条仍在剧集列表之前',
        !!(d.toolBox && d.groups && d.toolBox.top < d.groups.top),
        JSON.stringify({ tools: d.toolBox, groups: d.groups }));
      T('D04 桌面统计仍是卡片（不是被压扁的一行）', !!(d.statCard && d.statCard.h >= 44), JSON.stringify(d.statCard));
      T('D05a 量具前提：量片单页那两条时，片单页确实开着', d.listView.listShown === true, JSON.stringify(d.listView));
      /* v2.35.0：原来的 D05 反过来守——它当年守的是「这几条被手机档藏起来」，
         用户令「漫改这些恢复原来的」之后方向变了：现在要守的是**漫改这三条不许再被藏**。
         #vDetail>.dtools 不在列：它收进「⋯ 更多工具」抽屉是 v2.34.0 用户令认可的减负，
         抽屉里还是那批按钮本身，漫改相关的类型行/改来源标注都不在里面，照旧可见。
         量具仍是「扫规则文本」而不是「量元素可见性」——元素可见性受数据影响
         （#srcBar 空、#showTypeRow 空时被藏），拿它当判据会假红。 */
      const WANT = ['#vList>.srcbar', '#vList>.typerow', '#vDetail>.typerow'];
      const stillHidden = [];
      d.listView.rules.forEach(r => { WANT.forEach(w => { if (r.sel.indexOf(w) >= 0) stillHidden.push(r.sel + '@' + r.cond); }); });
      T('D05 漫改这三条没被手机档重新藏起来（恢复后不许再分档）',
        stillHidden.length === 0,
        '仍被藏 ' + JSON.stringify(stillHidden) +
        ' || 全表扫到的规则 ' + d.listView.rules.map(r => r.sel + '@' + r.cond).join(' ; '));
      T('D06 桌面详情页类型筛选条照旧可见', d.dTypeRow === true, 'typeRow=' + d.dTypeRow);
      T('D07 桌面详情管理箱照旧在（数据质量入口）', d.qual === true, 'qual=' + d.qual);
      /* 漫改进度行的判据锁「两笔账都在」：进度有分母、有百分比、有回看，全剧时间也在。
         不锁死「2/5」这个具体分母——入库时 autoCalibrateSrc 会重判某几集，
         桌面档读到 2/6、手机档读到 2/5 都是既有行为，不是这一行的回归。 */
      T('D07b 漫改进度行出现：进度（已看/共 N 集 + 百分比 + 回看）与全剧时间同时在',
        d.canonProg === true && /漫改 \d+ \/ \d+ 集/.test(d.canonProgText) &&
        /\d+%/.test(d.canonProgText) && /回看 1/.test(d.canonProgText) &&
        /全剧开始 2026-07-05/.test(d.canonProgText) && /全剧看完 2026-08-20/.test(d.canonProgText) &&
        /全剧用时 46 天/.test(d.canonProgText),
        'canonProg=' + d.canonProg + ' :: ' + d.canonProgText);
    }

    const ad = await page.evaluate(async () => {
      const vis = (el) => !!el && !!el.offsetParent;
      showAdd();
      await new Promise((r) => setTimeout(r, 400));
      return {
        addShown: vis(document.getElementById('vAdd')),
        addTools: vis(document.getElementById('addTools')),
        hint: ((document.getElementById('addHint') || {}).innerText || '').trim(),
        ph: (document.getElementById('qKw') || {}).placeholder || '',
      };
    });
    T('D08a 量具前提：量加片页时加片页确实开着', ad.addShown === true, JSON.stringify(ad).slice(0, 160));
    T('D08 桌面加片页备用行也按需出现（默认收起）', ad.addTools === false && !/搜索源/.test(ad.hint),
      JSON.stringify({ addTools: ad.addTools, hint: ad.hint.slice(0, 40) }));
    T('D08b 加片页文案：机制说明书两端都撤了（有意改动，不是桌面回归）',
      /搜索剧名/.test(ad.ph) && !/AniList/.test(ad.hint),
      JSON.stringify({ ph: ad.ph, hint: ad.hint.slice(0, 40) }));

    const a = await page.evaluate(async () => {
      openAccount();
      await new Promise((r) => setTimeout(r, 600));
      const p = document.querySelector('#syncMask .panel');
      const t = (p ? (p.innerText || '') : '(账号面板开不出来)').replace(/\s+/g, ' ');
      if (window.__closeSync) window.__closeSync();
      return { douban: /豆瓣/.test(t), cover: /封面来源|TMDB/.test(t), text: t.slice(0, 150) };
    });
    T('D09 桌面账号面板照旧有豆瓣这一行', a.douban === true, a.text);
    T('D10 桌面账号面板照旧有封面来源这一行', a.cover === true, '');

    const s = await page.evaluate(async () => {
      const s0 = (window.shows || [])[0];
      openDetail(s0.sid);
      openDTools();
      await new Promise((r) => setTimeout(r, 300));
      return { mask: !!document.getElementById('dToolsMask'),
        inFlow: !!document.querySelector('#vDetail > #dTools') };
    });
    T('D11 桌面调用 openDTools() 也开不出抽屉（判据是输入能力，不是屏幕宽度）',
      s.mask === false && s.inFlow === true, JSON.stringify(s));
    await page.screenshot({ path: path.join(OUT, 'desktop-detail.png') });

    const pe = errs.filter((e) => e.indexOf('pageerror:') === 0);
    T('D12 全程无页面级 JS 错误', pe.length === 0, pe.slice(0, 2).join(' || '));
    console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' PASS'));
    fs.writeFileSync(path.join(OUT, 'desktop-tier.json'), JSON.stringify({ d, a, s, errs }, null, 2));
    process.exitCode = fail ? 1 : 0;
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
