/* csp-check.js — 安全头门禁（审计项 2 · CSP 方案 A「最小暴露」）
   用法：node tests\csp-check.js     （自起静态服务 8141，用本机 Chrome 实测）

   为什么要有这道门禁：CSP 的两条坑都是「写错不报错、只是功能坏」——
   ① connect-src 写域名白名单 → 「问 AI 加片」直连被拦死（AI base 是用户自填的，白名单永远列不全）；
   ② script-src 少 'wasm-unsafe-eval' → vendor/cloudbase.full.js 的 WebAssembly 编译被静默拦掉。
   两者都不会变成 pageerror，靠 T18「无 JS 错误」和走查墙都查不出来，只能靠 CSP 违规事件抓。
   静态断言查「头怎么写」，运行期断言查「真跑起来违不违规」，缺一不可。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 8141;   /* 避开同族已用：8092/8093/8094/8096/8097/8120/8121/8124/8131/8133/8134/8135/8137 */
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' T' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 220)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PY = process.env.AT_PY || (function () {
  try { require('child_process').execSync('python -c ""', { stdio: 'ignore', timeout: 3000 }); return 'python'; } catch (e) {
    const fb = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
    console.warn('[tests] PATH 中未找到 python，回退旧写死路径：' + fb + '（可用环境变量 AT_PY 覆盖）');
    return fb;
  }
})();
(async () => {
  /* ---- ① 源码级：头怎么写 ---- */
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const copy = fs.readFileSync(path.join(ROOT, 'ani-tracker.html'), 'utf8');
  const grab = s => { const m = s.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/); return m ? m[1] : ''; };
  const csp = grab(idx);
  check('01', 'CSP meta 存在（index.html）', !!csp, csp ? csp.slice(0, 60) + '…' : '没有 CSP meta');
  check('02', 'CSP meta 存在（ani-tracker.html，双入口不落队）', !!grab(copy), '');
  check('03', 'connect-src 是 *（不是域名白名单——白名单会拦死自填 AI 端点）', /(^|;)\s*connect-src \*(;|$)/.test(csp), csp.match(/connect-src [^;]*/) || '缺 connect-src');
  check('04', "script-src 含 'wasm-unsafe-eval'（CloudBase SDK 要编译 wasm）", /script-src[^;]*'wasm-unsafe-eval'/.test(csp), csp.match(/script-src [^;]*/) || '缺 script-src');
  check('05', 'meta 里没有 frame-ancestors（该指令只在 HTTP 响应头生效，写 meta 是假保护）', !/frame-ancestors/.test(csp), csp.match(/frame-ancestors[^;]*/) || '');
  check('06', "object-src 'none' / base-uri 'self' / form-action 'self' 三件套在", /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /form-action 'self'/.test(csp), '');
  check('07', 'Referrer-Policy + X-Content-Type-Options 在', /name="referrer"/.test(idx) && /X-Content-Type-Options/.test(idx), '');

  /* ---- ② 运行期：真跑起来违不违规 ---- */
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '180'], { stdio: 'ignore' });
  const ping = () => new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); res(true); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await ping()) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); check('08', '本机静态服务起来（:' + PORT + '）', false, '服务未就绪'); summary(); process.exit(1); }
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const pageErrors = [];
    const cspConsole = [];
    page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
    page.on('console', m => { const t = m.type() + ': ' + m.text(); if (/Content Security Policy/i.test(t)) cspConsole.push(t); });

    /* 违规监听必须在页面脚本之前挂上，否则开机那批违规抓不到 */
    await page.evaluateOnNewDocument(() => {
      window.__cspv = [];
      document.addEventListener('securitypolicyviolation', function (e) {
        window.__cspv.push(e.violatedDirective + ' :: ' + e.blockedURI);
      });
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
    await sleep(1500);

    const live = await page.evaluate(async () => {
      const withTimeout = (url, opts) => {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 6000);
        return fetch(url, Object.assign({ cache: 'no-store', signal: c.signal }, opts || {}))
          .then(r => 'HTTP ' + r.status, e => (e && e.name) + '')
          .then(v => { clearTimeout(t); return v; });
      };
      const out = { v0: (window.__cspv || []).slice(0, 10) };
      /* 用户自填端点的两种典型形态：https 预设 + 本地 http（Ollama） */
      out.deepseek = await withTimeout('https://api.deepseek.com/chat/completions',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      out.ollama = await withTimeout('http://127.0.0.1:11434/api/tags');
      /* 探测之后再读一次：连不上的原因是「CSP 拦」还是「网络不通」只有这一步分得清。
         违规事件是异步派发的，得等一拍再读，否则刚被拦的那条还没进数组。 */
      await new Promise(r => setTimeout(r, 600));
      out.v1 = (window.__cspv || []).slice(0, 10);
      return out;
    });

    check('08', '页面加载零 CSP 违规（含开机批次）', live.v0.length === 0, live.v0.join(' | '));
    check('09', '自填 AI 端点没被 CSP 拦（违规事件 + 控制台双证）', !live.v1.some(s => /connect-src/.test(s)) && !cspConsole.some(s => /connect-src/.test(s)), live.v1.join(' | ') + ' || ' + cspConsole.slice(0, 1).join(' '));
    check('10', 'CSP 违规里没有 wasm-eval（CloudBase SDK 没被静默拦）', !live.v1.some(s => /wasm/.test(s)), live.v1.join(' | '));
    check('11', '控制台无 CSP 告警（指令都认得）', cspConsole.length === 0, cspConsole.slice(0, 2).join(' | '));
    check('12', '页面级 JS 错误 0 条', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    console.log('  探测（只看「是否被 CSP 拦」，不看网络通不通）：deepseek=' + live.deepseek + ' · 本地 ollama=' + live.ollama);
    fs.writeFileSync(path.join(__dirname, 'last-csp.json'),
      JSON.stringify({ t: new Date().toISOString(), results, live }, null, 1));
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  summary();
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();

function summary() {
  const bad = results.filter(r => !r.ok);
  console.log('SUMMARY: ' + (results.length - bad.length) + '/' + results.length + ' PASS');
}
