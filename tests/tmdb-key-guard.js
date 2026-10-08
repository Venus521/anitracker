/* tests/tmdb-key-guard.js —— TMDB 密钥两道护栏门禁（v2.46.1）
   起因是他本人的一次实测：TMDB 申请页一次给两串东西——
     短的 API Key (v3 auth)      a1b2c3d4…（32 位十六进制）   ← 追迹要这个
     长的 Read Access Token(v4)  eyJhbGciOi….eyJhdWQi….xxxx   ← 他贴了这个
   贴长的那串，TMDB 回 {"status_code":7,"status_message":"Invalid API key…"}，
   而旧版 tmdbCoverFor 里 catch 到就 continue、最后 return null——**全程悄无声息**：
   他不配不知道配错了，配了也看不出坏在哪，只会觉得「怎么这个 key 没用」。

   本门禁守两道护栏不许走形：
     G01 明显的 v4 令牌（eyJ 开头）→ 拦下不写盘，并把话说明白
     G02 正经 v3 的 32 位 Key → 正常保存
     G03 形状可疑（不是 32 位十六进制）→ 让存，但要提醒（不替他做决定）
     G04 清除 → 真的清空
     G05 拉封面撞 401 → 提示一次、置停这一环、第二次连请求都不发（不许一遍遍白跑）
     G06 换了 Key 保存 → 这一环复活（真能再拉到海报）
     E00 全程无页面级 JS 错误

   量具：_wget 换成同步可判的替身（返回 401 / 返回带图的结果），toast 换成计数器；
   外部请求一律 abort——门禁不依赖公网，也不许被网络抖动带着走。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const OUT = path.join(ROOT, 'tests', '_artifacts', 'tmdbkey');
const PORT = 8191;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const V3 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const V3B = '00112233445566778899aabbccddeeff';
const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJhMWIyYzNkNGU1ZjZhN2I4YzlkMGUxZjJhM2I0YzVkNiIsInN1YiI6IjgxZDM5ZTAwIn0.7Xk2mQ9pQ2mZ8tL5nR3vB6cY1wS4dF0gH9jK8lM2nP4q';

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
    await page.evaluate(() => { window.__mark = 'M1'; });

    /* 面板入口不在 window 上：openCoverSrc 是 openAccount 里的内嵌函数（v2.25.0 就这么写的），
       只能走真人那条路——开「账号」→ 点「封面来源」那颗钮。别为了量具去改产品结构。 */
    /* 本门禁里「账号」面板要开关好几轮，而 headless 下 openAccount 连着开会出现
       「这次开不出来、下次又开得出来」的交替（单独探针复现不出：探针每次都开得出来，
       也不影响真人——真人一次只开一个）。与其在量具里假装知道原因，不如认下这条：
       最多试三次，开出来就走；三次都开不出来才让断言红。红的是断言，不是量具的脾气。 */
    const openPanel = async () => {
      let diag = { acc: false, btn: false, key: false };
      for (let attempt = 1; attempt <= 3; attempt++) {
        const err = await page.evaluate(async () => {
          try { if (typeof window.__closeSync === 'function') window.__closeSync(); } catch (e) {}
          if (typeof window.openAccount !== 'function') return 'NO openAccount';
          try { await window.openAccount(); return ''; } catch (e) { return String((e && e.message) || e); }
        });
        if (err) console.log('INFO openAccount 抛错：' + err);
        await sleep(600);
        await page.evaluate(() => { const b = document.getElementById('cvSrcOpen'); if (b) b.click(); });
        await sleep(300);
        diag = await page.evaluate(() => ({
          acc: !!document.getElementById('syncMask'),
          btn: !!document.getElementById('cvSrcOpen'),
          key: !!document.getElementById('cvSrcKey')
        }));
        if (diag.key) return diag;
        console.log('INFO 第 ' + attempt + ' 次没开出面板：' + JSON.stringify(diag));
      }
      return diag;
    };
    const save = async (v) => {
      await openPanel();
      return page.evaluate((val) => {
      const k = document.getElementById('cvSrcKey');
      if (!k) return { miss: true };
      k.value = val;
      const b = document.getElementById('cvSrcSave');
      if (b) b.click();
      const m = document.getElementById('cvSrcMsg');
      const out = {
        stored: (typeof window.rd === 'function') ? String(window.rd('at_tmdb_key', '') || '') : 'NORd',
        msg: m ? String(m.textContent || '') : '', color: m ? String(m.style.color || '') : ''
      };
      const x = document.getElementById('cvSrcX'); if (x) x.click();
      return out;
      }, v);
    };
    const clearKey = async () => {
      await openPanel();
      return page.evaluate(() => {
      const b = document.getElementById('cvSrcClear'); if (b) b.click();
      const out = { stored: (typeof window.rd === 'function') ? String(window.rd('at_tmdb_key', '') || '') : 'NORd' };
      const x = document.getElementById('cvSrcX'); if (x) x.click();
      return out;
      });
    };

    const has = await page.evaluate(() => ({
      warn: typeof window.tmdbKeyWarn, block: typeof window.tmdbKeyBlocked,
      cover: typeof window.tmdbCoverFor, panel: typeof window.openAccount
    }));
    check('G00', '护栏与账号面板挂在 window 上（量具能装、负测时才可能压根没有——那就该红不该崩）',
      has.warn === 'function' && has.block === 'function' && has.cover === 'function' && has.panel === 'function',
      JSON.stringify(has));

    /* G01 · 他到底踩在哪：eyJ 开头的 v4 长令牌，不许写盘 */
    const g1 = await save(V4);
    check('G01', 'v4 长令牌（eyJ 开头）被拦下：不写盘 + 明说要 v3 的 32 位 Key',
      g1.stored === '' && g1.msg.indexOf('没保存') >= 0 && g1.msg.indexOf('v3') >= 0 &&
      g1.color.indexOf('danger') >= 0, JSON.stringify(g1));
    console.log('INFO G01 面板上写的是：' + String(g1.msg).slice(0, 160));

    /* G02 · 正经 v3 Key 照常保存 */
    const g2 = await save(V3);
    check('G02', 'v3 的 32 位 Key 正常保存（msg 说「已保存」+ 本机/导出剔除）',
      g2.stored === V3 && g2.msg.indexOf('已保存') >= 0 && g2.msg.indexOf('可能不对') < 0,
      JSON.stringify(g2));

    /* G03 · 形状可疑：让存，但要提醒（不替他做决定） */
    const g3 = await save('abc123');
    check('G03', '不像 v3 Key 的短串：允许保存但给警告（不静默，也不一刀切拦死）',
      g3.stored === 'abc123' && g3.msg.indexOf('可能不对') >= 0 && g3.color.indexOf('warn') >= 0,
      JSON.stringify(g3));

    /* G04 · 清除 */
    const g4 = await clearKey();
    check('G04', '清除后真的空了', g4.stored === '', JSON.stringify(g4));

    /* G05 · 拉封面撞 401：提示一次、置停、第二次连请求都不发 */
    const g5 = await page.evaluate(async (v3) => {
      if (typeof window.wr === 'function') window.wr('at_tmdb_key', v3);
      if (typeof window.tmdbCoverFor !== 'function') return { miss: true };
      const toasts = []; window.toast = function (t) { toasts.push(String(t || '')); };
      let wgets = 0;
      window._wget = async function () { wgets++; throw new Error('HTTP 401'); };
      const s = { sid: 'g5-fight', title: 'Fight Club', total: 1, eps: [] };
      let r1 = 'X', r2 = 'X';
      try { r1 = await window.tmdbCoverFor(s); } catch (e) { r1 = 'THROW'; }
      const n1 = toasts.length, w1 = wgets;
      try { r2 = await window.tmdbCoverFor(s); } catch (e) { r2 = 'THROW'; }
      return { r1: r1, r2: r2, n1: n1, n2: toasts.length, w1: w1, w2: wgets,
        first: toasts[0] || '', bad: (typeof window._tmdbBadKey === 'boolean') ? window._tmdbBadKey : 'n/a' };
    }, V3);
    check('G05', '撞 401 时：这一环返回空、弹一次提示、置停（_tmdbBadKey=true）',
      g5.r1 === null && g5.r2 === null && g5.n1 === 1 && g5.bad === true &&
      g5.first.indexOf('TMDB') >= 0, JSON.stringify(g5));
    check('G05b', '置停后第二次连请求都不发（不许一遍遍白跑同一个坏 key）',
      g5.w1 === 1 && g5.w2 === 1 && g5.n2 === 1, JSON.stringify(g5));
    console.log('INFO G05 提示原文：' + String(g5.first).slice(0, 200));

    /* G06 · 换 Key 保存后复活：能再拉到海报 */
    const g6 = await save(V3B);
    const g6b = await page.evaluate(async () => {
      if (typeof window.tmdbCoverFor !== 'function') return { miss: true };
      const bad = (typeof window._tmdbBadKey === 'boolean') ? window._tmdbBadKey : 'n/a';
      window._wget = async function () {
        return { results: [{ title: 'Fight Club', poster_path: '/pFightClub.jpg' }] };
      };
      let url = 'X';
      try { url = await window.tmdbCoverFor({ sid: 'g6', title: 'Fight Club', total: 1, eps: [] }); } catch (e) { url = 'THROW'; }
      return { bad: bad, url: url };
    });
    check('G06', '换了 Key 保存：停用标记复位，这一环真能再拉到海报',
      g6.stored === V3B && g6b.bad === false && String(g6b.url).indexOf('image.tmdb.org') >= 0,
      JSON.stringify({ g6: g6, g6b: g6b }));

    check('E00', '全程无页面级 JS 错误', errs.length === 0, errs.join(' | '));
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log('\nGATES ' + (fail ? 'RED' : 'ALL GREEN') + ' pass=' + pass + ' fail=' + fail + '  artifacts=' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH ' + String(e)); process.exit(2); });
