/* 手机模拟走查：在电脑 Chrome 上按手机的视口/触屏/WebView UA 跑一遍，截图 + 量数据。
   为什么能信：App 那个壳就是用系统 WebView 打开同源页面，这里同源同 CSS，只有内核版本可能不同。
   桩 window.AndroidShell 是为了让账号面板里「安装包 / 网页内容」两行按壳里的样子画出来；
   6b 那一屏再把桩摘掉开一次，量的是手机浏览器里看到的「下载 APK」那行（两种模式互斥，缺一屏就漏一行）。
   用法：node tests/phone-look.js [--w 393 --h 851] */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const FX = require('./ai-add-fixture.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8133;
const OUT = path.join(ROOT, 'tests', 'shots-phone');
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/* v2.20.0 搜索三区走查必须确定性：AniList / TVMaze 不 mock 的话，走查结果跟着当天网络走
   （通了三区有货、断了只剩文案），墙没法前后对比。数据全虚构且故意避开种子片单与内置库的
   归一化键——撞上任何一边，跨源去重会把 AniList 行整行滤掉，三区就演示不出来了。 */
const TV_MOCK = [
  { show: { id: 9001, name: 'Walkthrough Drama', language: 'English', premiered: '2024-04-01',
    genres: ['Drama'], image: { original: '/tracker-icon-512.png' } } },
  { show: { id: 9002, name: 'Walkthrough Anime', language: 'Japanese', premiered: '2026-01-01',
    genres: ['Animation', 'Anime'], image: { original: '/tracker-icon-512.png' } } },
];
const EP_MOCK = {
  9001: [{ season: 1, number: 1, name: 'Pilot', runtime: 45, airdate: '2024-04-01' },
         { season: 1, number: 2, name: 'Two', runtime: 45, airdate: '2024-04-08' }],
  9002: [{ season: 1, number: 1, name: '第一话', runtime: 24, airdate: '2026-01-01' }],
};
const AL_MOCK = { data: { Media: { id: 9003,
  title: { english: 'Walkthrough Anime AL', romaji: 'Sousa Shoujo', native: '走查少女' },
  synonyms: ['走查少女'], episodes: 12, duration: 24, format: 'TV', status: 'RELEASING',
  startDate: { year: 2026 }, coverImage: { large: '/tracker-icon-512.png' } } } };
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TP1A.220624.014) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
}
const VW = arg('--w', 393);
const VH = arg('--h', 851);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/* 种几部状态各异的片：在看/完成/想看看/长宫格，封面走同源图，别靠外网 */
const SEED = () => {
  try { localStorage.removeItem('tr_shows'); } catch (e) {}
  window.shows = [];
  addShow({ sid: 'p-op', title: '海贼王', year: '1999', total: 1100,
    cover: '/tracker-icon-512.png', eps: [] });
  addShow({ sid: 'p-fr', title: '葬送的芙莉莲', year: '2023', total: 28,
    cover: '/tracker-icon-512.png', eps: [] });
  addShow({ sid: 'p-sk', title: '孤独摇滚！', year: '2022', total: 12,
    cover: '/tracker-icon-512.png', eps: [] });
  addShow({ sid: 'p-mp', title: '我的青春恋爱物语果然有问题', year: '2013', total: 13,
    cover: '', eps: [] });
  const s = window.shows.filter((x) => x.sid === 'p-fr')[0];
  s.eps = Array.from({ length: 28 }, (_, i) => ({ s: i + 1, t: '第 ' + (i + 1) + ' 话' }));
  s.eps.slice(0, 16).forEach((e) => { e.w = 'watched'; });
  s.watching = 'watching';
  window.shows.filter((x) => x.sid === 'p-sk')[0].watching = 'completed';
  window.shows.filter((x) => x.sid === 'p-mp')[0].watching = 'wish';
  renderList();
};

const METRICS = () => {
  const iw = window.innerWidth;
  const over = [];
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > iw + 1 || r.left < -1)) {
      over.push((el.id ? '#' + el.id : el.className || el.tagName) + ' →' + Math.round(r.right) + '/' + Math.round(r.left));
    }
  });
  const small = [];
  document.querySelectorAll('button,a,.lnk,.chip,[onclick]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (getComputedStyle(el).display === 'none') return;
    if (Math.min(r.width, r.height) < 34) {
      small.push({ t: (el.textContent || el.title || el.id || el.className).trim().slice(0, 16),
        w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  const tiny = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!el.textContent || !el.textContent.trim()) return;
    if (el.children.length) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 11) tiny.push({ t: el.textContent.trim().slice(0, 14), px: px });
  });
  /* 筛选条：搜索框若还和标签抢同一行，右侧标签会被永久挤到屏外（滚动也救不回来） */
  const fl = document.getElementById('filters');
  const lq = document.getElementById('listQ');
  const fr = fl && lq && fl.clientWidth ? { sw: fl.scrollWidth, cw: fl.clientWidth,
    lqBelow: lq.getBoundingClientRect().top >= fl.getBoundingClientRect().bottom - 1 } : null;
  /* 安全区只能从样式表里核：桌面 Chrome 的 env() 恒为 0，量不出真机效果 */
  let saTop = false, saBottom = false;
  try {
    for (const sh of document.styleSheets) {
      const t = Array.from(sh.cssRules || []).map((r) => r.cssText).join('\n');
      if (/safe-area-inset-top/.test(t)) saTop = true;
      if (/safe-area-inset-bottom/.test(t)) saBottom = true;
    }
  } catch (e) {}
  return {
    scrollW: document.documentElement.scrollWidth, innerW: iw,
    mq: { hoverNone: matchMedia('(hover:none)').matches, coarse: matchMedia('(pointer:coarse)').matches,
      narrow: matchMedia('(max-width:520px)').matches },
    overflow: over.slice(0, 10), overflowCount: over.length,
    smallCount: small.length, small: small.slice(0, 12),
    tinyCount: tiny.length, tiny: tiny.slice(0, 8),
    filterRow: fr, safeArea: { top: saTop, bottom: saBottom },
    dvh: Math.round(window.innerHeight), visual: Math.round(window.visualViewport ? window.visualViewport.height : 0),
    css: { has: !!(CSS.supports && CSS.supports('selector(:has(*))')),
      seg: !!(CSS.supports && CSS.supports('text-decoration-skip-ink:auto')),
      dvh: !!(CSS.supports && CSS.supports('height:100dvh')) },
  };
};

/* 走查每停一屏就量一次：整份跑完只量一次的话，数字全是最后一屏的，主列表的问题会被漏掉 */
const OK_TINY = ['ANITRACKER'];   /* 字标是 6px 字距的装饰性小字，故意小，不算违规 */
const REPORT = (all) => {
  const out = [];
  Object.keys(all).forEach((k) => {
    const m = all[k];
    out.push('\n【' + k + '】' + VW + '×' + VH);
    out.push('  横向溢出：scrollWidth ' + m.scrollW + ' vs innerWidth ' + m.innerW +
      (m.scrollW > m.innerW + 1 ? ' → 溢出 ' + m.overflowCount + ' 个元素' : ' → 无'));
    if (m.overflow.length) out.push('    ' + m.overflow.join(' | '));
    out.push('  可点区 < 34px：' + m.smallCount + ' 个' +
      (m.small.length ? '\n    ' + m.small.map((x) => x.t + ' ' + x.w + '×' + x.h).join(' | ') : ''));
    out.push('  字号 < 11px：' + m.tinyCount + ' 个' +
      (m.tiny.length ? '\n    ' + m.tiny.map((x) => x.t + ' ' + x.px + 'px').join(' | ') : ''));
    if (m.filterRow) out.push('  筛选条：可滚 ' + m.filterRow.sw + '/' + m.filterRow.cw +
      ' · 搜索框' + (m.filterRow.lqBelow ? '已另起一行' : '仍与标签抢同一行'));
  });
  return out.join('\n');
};

/* 走查墙：走查不能只吐 PNG——一叠没人天天去翻的图等于没走查。
   这页把每张真机尺寸的截图和它各自的实测数字摆一起，双击即看，也是启动入口的目标。
   屏数从 shots 现场取，别写死——加一屏就漏一处「九屏」这种旧文案。 */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 行为走查（phone-use）的产物落在 shots-phone/use/：它是另一条命令跑的，
   这里只负责把结论摊到同一面墙上——两份走查分家摆着，就又变成「没人翻的文件夹」。 */
const USE_DIR = path.join(OUT, 'use');
function loadUse() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(USE_DIR, 'use-findings.json'), 'utf-8'));
    if (!Array.isArray(j.findings)) return null;
    return { findings: j.findings, shots: (j.shots || []).filter((f) => fs.existsSync(path.join(USE_DIR, f))),
      at: fs.statSync(path.join(USE_DIR, 'use-findings.json')).mtime };
  } catch (e) { return null; }
}
/* 「行为走查这批结果比页面旧」的判据：拿 index.html 的 mtime 和 use-findings.json 对 */
const useMtime = () => { try { return fs.statSync(path.join(ROOT, 'index.html')).mtime; } catch (e) { return 0; } };

const chip = (txt, ok) => '<span class="chip ' + (ok ? 'ok' : 'no') + '">' + esc(txt) + '</span>';

const useHtml = (u, pageMtime) => {  if (!u) return '<h2>用起来走查（行为）</h2><p class="sub">还没跑过：' +
    '<code>node tests/phone-use.js</code>（12 个真人任务，量的是行为不是像素）</p>';
  const n = (lv) => u.findings.filter((f) => f.level === lv).length;
  const bad = n('bad'), mid = n('mid');
  const stale = pageMtime && u.at < pageMtime;
  const rows = u.findings.map((f) => '<div class="fnd ' + esc(f.level) + '"><span class="lv">' +
    ({ bad: '要改', mid: '可改', note: '实测' }[f.level] || f.level) + '</span><span class="tk">' +
    esc(f.task) + '</span><span class="wt">' + esc(f.what) +
    (f.detail ? '<em>' + esc(f.detail) + '</em>' : '') + '</span></div>').join('\n');
  const figs = u.shots.map((f, i) => '<figure><figcaption><i>' + (i + 1) + '</i><span>' +
    esc(f.replace(/\.png$/, '')) + '</span></figcaption><a href="use/' + encodeURI(f) +
    '" target="_blank" title="点开看原图"><img src="use/' + encodeURI(f) + '" alt="' +
    esc(f) + '" loading="lazy"></a></figure>').join('\n');
  return '<h2>用起来走查（行为）· ' + esc(u.at.toLocaleString('zh-CN', { hour12: false })) +
    (stale ? ' <span class="chip no">这批结果比现在的页面旧，重跑才算数</span>' : '') + '</h2>' +
    '<div class="verdict ' + (bad ? 'fail' : 'pass') + '">' +
    (bad ? 'BAD ' + bad + ' 项 · MID ' + mid + ' 项' : '12 个真人任务跑完，没发现影响使用的问题（MID ' + mid + '）') +
    '</div><div class="chips">' +
    chip('要改 ' + bad, !bad) + chip('可改 ' + mid, !mid) + chip('实测记录 ' + n('note'), true) +
    chip('截图 ' + u.shots.length + ' 张', true) + '</div>' +
    '<div class="fnds">' + rows + '</div>' +
    '<div class="grid">' + figs + '</div>';
};

const wallHtml = (shots, all, m, bad, errs, ts, use) => {
  const cards = shots.map((s, i) => {
    const x = s.key ? all[s.key] : null;
    let nums = '<span class="chip">未单独量</span>';
    if (x) {
      const tiny = x.tiny.filter((t) => OK_TINY.indexOf(t.t) < 0);
      nums = [
        chip('出界 ' + x.overflowCount, !x.overflowCount),
        chip('触点<34 ' + x.smallCount, !x.smallCount),
        chip('小字<11 ' + tiny.length, !tiny.length),
        x.filterRow ? chip('搜索框' + (x.filterRow.lqBelow ? '已另起一行' : '仍抢同一行'),
          !!x.filterRow.lqBelow) : '',
      ].join('');
    }
    return '<figure><figcaption><i>' + (i + 1) + '</i><span>' + esc(s.note || s.file) +
      '</span></figcaption><a href="' + encodeURI(s.file) + '" target="_blank" title="点开看原图（393×851）">' +
      '<img src="' + encodeURI(s.file) + '" alt="' + esc(s.note || s.file) + '" loading="lazy"></a>' +
      '<div class="nums">' + nums + '</div></figure>';
  }).join('\n');
  const head = [
    chip('(hover:none) 命中', m.mq.hoverNone), chip('(pointer:coarse) 命中', m.mq.coarse),
    chip('(max-width:520px) 命中', m.mq.narrow),
    chip('安全区 顶部' + (m.safeArea.top ? '已补' : '缺'), !!m.safeArea.top),
    chip('安全区 底部' + (m.safeArea.bottom ? '已补' : '缺'), !!m.safeArea.bottom),
    chip('视口 ' + m.innerW + '×' + m.dvh, true),
    chip('DPR 2.75', true), chip('UA Android WebView', true),
  ].join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>追迹 · 手机端 ' + shots.length + ' 屏走查墙</title><style>' +
    ':root{color-scheme:light}' +
    '*{box-sizing:border-box}' +
    'body{margin:0;padding:26px 24px 44px;background:#f4f1ea;color:#20242b;' +
    'font-family:"Microsoft YaHei","Segoe UI",system-ui,sans-serif}' +
    'h1{margin:0 0 4px;font-size:21px;letter-spacing:.5px}' +
    '.sub{margin:0 0 16px;color:#6b7280;font-size:13px}' +
    '.verdict{display:inline-block;padding:9px 16px;border-radius:14px;font-weight:700;font-size:14px;margin-bottom:14px}' +
    '.verdict.pass{background:#dff3e4;color:#15692f}.verdict.fail{background:#fbe1e1;color:#9b1c1c}' +
    '.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}' +
    '.chip{display:inline-block;padding:4px 11px;border-radius:999px;font-size:12px;background:#e6e2d8;color:#4b5563;border:1px solid #d8d3c7}' +
    '.chip.ok{background:#e3f2e6;color:#1c6b33;border-color:#bfe0c6}' +
    '.chip.no{background:#fbe3e3;color:#9b2222;border-color:#eec3c3}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(292px,1fr));gap:22px}' +
    'figure{margin:0;background:#fff;border:1px solid #e2ddd2;border-radius:20px;padding:14px 14px 12px;' +
    'box-shadow:0 2px 14px rgba(32,36,43,.07)}' +
    'figcaption{display:flex;align-items:center;gap:9px;margin-bottom:10px;font-size:13px;font-weight:600}' +
    'figcaption i{flex:0 0 auto;width:21px;height:21px;border-radius:50%;background:#20242b;color:#f4f1ea;' +
    'font-style:normal;font-size:12px;display:flex;align-items:center;justify-content:center}' +
    'img{display:block;width:100%;border-radius:14px;border:1px solid #ded9cd;background:#ded9cd}' +
    '.nums{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}' +
    'h2{margin:34px 0 10px;font-size:16px;letter-spacing:.4px;border-top:1px solid #ddd7c9;padding-top:22px}' +
    '.fnds{border:1px solid #e2ddd2;border-radius:16px;background:#fff;overflow:hidden;margin:0 0 20px}' +
    '.fnd{display:flex;gap:10px;align-items:baseline;padding:9px 14px;border-top:1px solid #efeae0;font-size:13px}' +
    '.fnd:first-child{border-top:none}' +
    '.fnd .lv{flex:0 0 46px;font-size:11px;font-weight:700;letter-spacing:.5px;color:#6b7280}' +
    '.fnd.bad .lv{color:#9b1c1c}.fnd.mid .lv{color:#8a5a00}' +
    '.fnd.bad{background:#fdf3f3}.fnd.mid{background:#fdf8ee}' +
    '.fnd .tk{flex:0 0 118px;color:#20242b;font-weight:600}' +
    '.fnd .wt{flex:1 1 auto;color:#3f4650;word-break:break-all}' +
    '.fnd .wt em{display:block;font-style:normal;color:#8a8272;font-size:12px;margin-top:3px}' +
    'details{margin-top:26px;font-size:13px;color:#4b5563}' +
    'pre{white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #e2ddd2;border-radius:14px;padding:12px;font-size:12px}' +
    '.foot{margin-top:26px;font-size:12.5px;color:#6b7280;line-height:1.75}' +
    '</style></head><body>' +
    '<h1>追迹 · 手机端走查墙</h1>' +
    '<p class="sub">上半：电脑 Chrome 按手机参数（393×851 / DPR 2.75 / 触屏 / Android WebView UA）渲染的 ' +
    shots.length + ' 屏，量版式；' +
    '下半：拿 12 个真人任务过一遍，量行为。生成于 ' + esc(ts) + '</p>' +
    '<div class="verdict ' + (bad.length ? 'fail' : 'pass') + '">' +
    (bad.length ? '门禁 FAIL · ' + bad.length + ' 项' : '门禁 PASS · 无出界 / 触点全部 ≥34px / 正文无 <11px') + '</div>' +
    (bad.length ? '<pre>' + esc(bad.join('\n')) + '</pre>' : '') +
    '<div class="chips">' + head + '</div>' +
    '<div class="grid">' + cards + '</div>' +
    useHtml(use, useMtime()) +
    '<details><summary>页面报错 / 控制台（' + errs.length + ' 条，走查时外网请求被主动掐掉，故含 ERR_FAILED）</summary>' +
    '<pre>' + esc(errs.join('\n') || '无') + '</pre></details>' +
    '<p class="foot">重跑：<code>node tests/phone-look.js</code>（' + shots.length + ' 屏与本页一起刷新）· ' +
    '<code>node tests/phone-use.js</code>（12 个真人任务，结论与截图并入本页）<br>' +
    '仍未验证：真机上的系统 WebView 内核版本、真实安全区数值、手势手感——这三样只有插上线才算数。</p>' +
    '</body></html>';
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probe()) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const shots = [];
  const errs = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2.75,
      isMobile: true, hasTouch: true });
    /* 真手机的主输入设备就是手指：不显式声明 hover/pointer，桌面 Chrome 会一直按 (hover:hover) 渲染，
       手机端那批样式（@media(hover:none)）根本不会命中，改了也「看不出效果」。
       走 CDP 而不是 page.emulateMediaFeatures：puppeteer 的白名单里没有 hover/pointer。 */
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [
      { name: 'hover', value: 'none' },
      { name: 'pointer', value: 'coarse' },
    ] });
    await page.evaluateOnNewDocument(() => {
      window.AndroidShell = {
        checkUpdate() { window.__atUpd && window.__atUpd('已是最新版 v1.4（5）', true); },
        checkContent() { window.__atWeb && window.__atWeb('网页内容已是最新（code 102）', true); },
        appVersion() { return '1.4（5）'; },
        contentCode() { return '102'; },
        toast(m) { console.log('shell toast: ' + m); },
      };
    });
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 120)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
    await page.setRequestInterception(true);
    /* mock 应答必须带 Access-Control-Allow-Origin：没有它浏览器在 preflight/读响应阶段直接拒，
       页面端表现成「网络不可用」——比断网还迷惑（请求明明"应答"了）。更阴的连锁：三路全挂
       会命中 v2.19.1 的「搜不到直接转 AI」，autoAiAdd 的 60ms 定时器自动弹 AI 面板，
       和 5b 屏手动开的 aiAdd 打架（closeM 把两个面板来回拆，ta 拿到 null）。 */
    const CORS = { 'access-control-allow-origin': '*' };
    const jsonResp = (req, body, extra) => req.respond(Object.assign({
      status: 200, contentType: 'application/json; charset=utf-8', headers: CORS, body: body }, extra || {}));
    /* alGate 是「AniList 闸门」：5d 要截两段渲染——TVMaze 先落地、AniList 还没回来的
       第一段，和第三区补上后的最终态。mock 响应几乎是即时的，不把回包挂起就永远
       截不到第一段。闸门开着时 AniList 请求被扣下，拍完第一段手动放行；
       页面侧有 4s AbortController 兜底，就算放行漏了也不会死锁。 */
    let alGate = null;
    const alResp = (req) => jsonResp(req, JSON.stringify(AL_MOCK));
    page.on('request', (req) => {
      const u = req.url();
      if (/tcb-api\.tencentcloudapi|api\.bgm\.tv/.test(u)) return req.abort();
      if (/^https:\/\/api\.tvmaze\.com\/search\/shows/.test(u)) {
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
        return jsonResp(req, JSON.stringify(TV_MOCK));
      }
      const ep = u.match(/^https:\/\/api\.tvmaze\.com\/shows\/(\d+)\/episodes/);
      if (ep) return jsonResp(req, JSON.stringify(EP_MOCK[Number(ep[1])] || []));
      if (/^https:\/\/graphql\.anilist\.co/.test(u)) {
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers:
          { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type',
            'access-control-allow-methods': 'POST, OPTIONS' } });
        if (alGate) { alGate.req = req; return; }   /* 扣下，等 5d 拍完第一段再放行 */
        return alResp(req);
      }
      req.continue();
    });

    await page.goto('http://127.0.0.1:' + PORT + '/index.html',
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2000);
    await page.evaluate(SEED);
    await sleep(800);

    const shoot = async (name, note) => {
      await page.screenshot({ path: path.join(OUT, name) });
      shots.push({ file: name, note: note || '' });
    };
    const M = {};
    /* 量到的那组数字挂到刚截的那张图上，走查墙才知道每张照片对应的实测值 */
    const meas = async (k) => {
      M[k] = await page.evaluate(METRICS);
      if (shots.length) shots[shots.length - 1].key = k;
    };
    /* toast 是底部浮层，2.2 秒自己走；不等它退就截图，会把「它压住了什么」误当成版面问题 */
    const settled = async () => {
      await page.evaluate(() => { var t = document.getElementById('toast'); if (t) { t.classList.remove('on'); t.textContent = ''; } });
      await sleep(400);
    };

    await settled();
    await shoot('1-列表-深色.png', '主列表（深色，壳里默认也是这个）');
    await meas('主列表');
    await page.evaluate(() => { if (listViewMode() !== 'grid') toggleListView(); });
    await sleep(500);
    await settled();
    await shoot('2-封面墙.png', '封面墙视图');
    await meas('封面墙');
    await page.evaluate(() => { if (listViewMode() === 'grid') toggleListView(); });
    await sleep(300);

    await page.evaluate(() => openDetail('p-fr'));
    await sleep(900);
    await settled();
    await shoot('3-详情-列表.png', '详情页：28 话，16 已看');
    await meas('详情页');
    await page.evaluate(() => { if (!epGridMode()) toggleEpGrid(); });
    await sleep(600);
    await shoot('4-详情-宫格.png', '详情页：宫格模式');
    await meas('剧集宫格');
    await page.evaluate(() => { if (epGridMode()) toggleEpGrid(); backList(); });
    await sleep(600);

    await page.evaluate(() => showAdd());
    await sleep(900);
    await settled();
    await shoot('5-添加搜索.png', '添加/搜索面板');
    await meas('添加搜索');

    /* v2.20.0 补屏：搜索三区（本地 + TVMaze + AniList）的两段渲染在手机上从来没进过墙。
       doSearch 先把「本地 + TVMaze」落地、文案写着「正在试 AniList」，AniList 回包才补第三区。
       关键词用虚构的「走查少女」：本地片单/内置库都没有，保证三区各自独立成区不触发去重。 */
    alGate = { req: null };
    /* doSearch 必须 setTimeout 异步触发：evaluate 若同步调它，会把 promise 挂到 AniList
       6.5s 超时走完才返回——拍"第一段"时搜索早就收口了。解耦后 TVMaze 即时落地、
       AniList 被闸门扣着，第一段才是真正的「正在试 AniList」态。 */
    await page.evaluate(() => {
      var el = document.getElementById('qKw'); el.value = '走查少女';
      setTimeout(function () { if (doSearch) doSearch(); }, 0);
    });
    await page.waitForFunction(() => !!document.querySelector('.sr[data-tv]'), { timeout: 8000 }).catch(() => {});
    await sleep(500);
    await settled();
    await shoot('5d-搜索-第一段.png', '两段渲染前段：TVMaze 已落地，AniList 回包被扣下');
    await meas('搜索-第一段');
    if (alGate && alGate.req) { const r = alGate.req; alGate = null; await alResp(r); }
    else alGate = null;
    await page.waitForFunction(() => !!document.querySelector('#srAlBox .sr'), { timeout: 8000 }).catch(() => {});
    await sleep(500);
    await settled();
    await shoot('5d-搜索-三区.png', '三区齐活：本地 + TVMaze + AniList（中文标题行）');
    await meas('搜索-三区');
    await page.evaluate(() => { document.getElementById('qKw').value = ''; });
    await sleep(300);

    /* v2.18.0 新加的两种浮层必须进墙：新面板最容易在手机上横向出界 / 触点做小 */
    await page.evaluate(() => window.aiAdd());
    await sleep(600);
    await page.evaluate(t => {
      var ta = document.getElementById('at270StdText');
      ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, FX.FRIENDS);
    await sleep(900);
    await settled();
    await shoot('5b-问AI建档.png', '「问 AI 加片」：粘贴后的字段色卡与增量提示');
    await meas('问AI建档');
    await page.evaluate(() => { var b = document.getElementById('at270StdX'); if (b) b.click(); });
    await sleep(400);
    await page.evaluate(() => { backList(); openDetail('p-fr'); });
    await sleep(900);
    await page.evaluate(() => window.aiUpd());
    await sleep(600);
    await page.evaluate(t => {
      var ta = document.getElementById('at270StdText');
      ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, FX.FRIENDS);
    await sleep(900);
    await settled();
    await shoot('5c-让AI补新集.png', '「让 AI 补新集」：点之前先把「新增/补名/跳过」报出来');
    await meas('让AI补新集');
    await page.evaluate(() => { var b = document.getElementById('at270StdX'); if (b) b.click(); backList(); });
    await sleep(400);

    /* v2.20.0 补屏：已配 LLM key 的分支——配置 details 默认收起、按钮行多出「⚡ 自动问」。
       未配 key 的展开态 5b 已经覆盖（没配 key 时 details 默认 open）。
       走的是临时 profile，key 是假的，但收工还是清掉，别让后续屏读到一个半真半假的配置。 */
    await page.evaluate(() => {
      localStorage.setItem('at_ai_cfg', JSON.stringify({ base: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-chat', key: 'sk-at270-walkthrough', provider: 'deepseek' }));
      window.aiAdd();
    });
    await sleep(900);
    await settled();
    await shoot('5e-问AI建档-已配key.png', '已配 LLM key：配置面板收起，多出「⚡ 自动问」');
    await meas('问AI建档-已配key');
    await page.evaluate(() => {
      localStorage.removeItem('at_ai_cfg');
      var b = document.getElementById('at270StdX'); if (b) b.click();
    });
    await sleep(400);

    await page.evaluate(() => { window.__closeSync && window.__closeSync(); openAccount && openAccount(); });
    await sleep(1400);
    await shoot('6-账号面板.png', '账号面板：含壳里才有的两行更新入口');
    await meas('账号面板');
    await page.evaluate(() => { var b = document.getElementById('updBtn'); if (b) b.click(); });
    await sleep(600);
    await page.evaluate(() => { var b = document.getElementById('webBtn'); if (b) b.click(); });
    await sleep(800);
    await shoot('7-账号-更新结果.png', '点过两个「检查更新」之后的收尾状态');
    await meas('账号-更新结果');

    /* 6b：把壳的桩摘掉再开一次账号面板——手机浏览器里开固定入口看到的是这一份，
       「手机版 App · 下载 APK」那行只在没有壳时才画，不补这一屏就等于没量过它的可点区。 */
    await page.evaluate(() => { window.__closeSync && window.__closeSync();
      window.__shellStub = window.AndroidShell; delete window.AndroidShell;
      openAccount && openAccount(); });
    await sleep(1400);
    await shoot('6b-账号面板-浏览器.png', '账号面板（浏览器模式）：装机走「下载 APK」这条 fetch 路');
    await meas('账号面板-浏览器');
    await page.evaluate(() => { window.__closeSync && window.__closeSync();
      window.AndroidShell = window.__shellStub; });
    await sleep(400);

    await page.evaluate(() => { window.__closeSync && window.__closeSync();
      backList();
      document.documentElement.setAttribute('data-theme', 'light'); });
    await sleep(700);
    await settled();
    await shoot('8-列表-浅色.png', '主列表（浅色）');
    await meas('主列表-浅色');
    await page.evaluate(() => { if (listViewMode() !== 'grid') toggleListView(); });
    await sleep(500);
    await settled();
    await shoot('9-封面墙-浅色.png', '封面墙（浅色）');
    await meas('封面墙-浅色');

    const m = M['主列表'];
    console.log('截图：\n  ' + shots.map((s) => s.file + (s.note ? '  ' + s.note : '')).join('\n  '));
    console.log(REPORT(M));
    console.log('\n视口：innerHeight ' + m.dvh + ' · visualViewport ' + m.visual +
      '（差值>0 说明地址栏占了高度）');
    console.log('输入设备：(hover:none) ' + (m.mq.hoverNone ? '命中' : '未命中') +
      ' · (pointer:coarse) ' + (m.mq.coarse ? '命中' : '未命中') +
      ' · (max-width:520px) ' + (m.mq.narrow ? '命中' : '未命中'));
    console.log('内核能力：:has() ' + (m.css.has ? '支持' : '不支持') + ' · 100dvh ' + (m.css.dvh ? '支持' : '不支持') +
      ' · 安全区（样式表核对）顶部 ' + (m.safeArea.top ? '已补' : '缺') +
      ' · 底部 ' + (m.safeArea.bottom ? '已补' : '缺'));
    console.log('页面报错：' + (errs.length ? errs.slice(0, 6).join(' || ') : '无'));
    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(M, null, 2));

    /* ---- 收口成门禁：走查不能只出图，出图没人天天看；这几个数字一退就红 ---- */
    const bad = [];
    /* 桌面 Chrome 若不认 hover/pointer 模拟，下面所有「手机端」断言全是空跑，先钉这一颗 */
    if (!m.mq.hoverNone || !m.mq.coarse) bad.push('输入设备未模拟成触屏，@media(hover:none) 没命中');
    if (!m.safeArea.top || !m.safeArea.bottom) bad.push('安全区缺 ' +
      (!m.safeArea.top ? 'top ' : '') + (!m.safeArea.bottom ? 'bottom' : ''));
    Object.keys(M).forEach((k) => {
      const x = M[k];
      if (x.overflowCount) bad.push(k + '：' + x.overflowCount + ' 个元素横向出界');
      if (x.smallCount) bad.push(k + '：' + x.smallCount + ' 个可点区 < 34px（' +
        x.small.map((i) => i.t + ' ' + i.w + '×' + i.h).join('、') + '）');
      const t = x.tiny.filter((i) => OK_TINY.indexOf(i.t) < 0);
      if (t.length) bad.push(k + '：' + t.length + ' 处文字 < 11px（' +
        t.map((i) => i.t + ' ' + i.px + 'px').join('、') + '）');
    });
    const perr = errs.filter((e) => e.indexOf('pageerror:') === 0);
    if (perr.length) bad.push('页面抛错 ' + perr.length + ' 条：' + perr[0]);
    console.log('\n' + (bad.length ? 'SUMMARY: FAIL ' + bad.length + ' 项' : 'SUMMARY: PASS 手机 ' + shots.length + ' 屏无出界、可点区全部 ≥34px、正文无 <11px'));
    bad.forEach((b) => console.log('  - ' + b));
    const wall = path.join(OUT, '手机预览.html');
    fs.writeFileSync(wall, wallHtml(shots, M, m, bad, errs,
      new Date().toLocaleString('zh-CN', { hour12: false }), loadUse()), 'utf-8');
    console.log(shots.length + ' 屏走查墙（双击即看）：' + wall);
    process.exitCode = bad.length ? 1 : 0;
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL ' + (e && e.stack || e)); process.exit(1); });
