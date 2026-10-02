/* 云端固定入口（hosting-root.html）本地端到端验证 —— node tests/cloud-entry-check.js 
   临时拼一棵和托管根同构的目录树 → 起静态服务 → 手机模拟打开「/」，
   断言它自己找到 app/web.json 里的 code、跳到那一份页面并且真的渲染出追迹。
   顺带验失败分支：清单取不到时必须停在能看懂的一屏（重试按钮），不许白屏也不许死循环。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8131;
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'at-cloudroot-'));
fs.copyFileSync(path.join(ROOT, 'mobile-shell', 'hosting-root.html'), path.join(TMP, 'index.html'));
fs.cpSync(path.join(ROOT, 'mobile-shell', 'dist', 'app'), path.join(TMP, 'app'), { recursive: true });
/* code 和版本一律从现场读，不写死字面量：写死的话每发一版都得回来改断言，
   忘改就是「内容没问题、门禁先红」（上一批发完 code 104 这里就是莫名其妙红了两条）。 */
const CODE = fs.readFileSync(path.join(TMP, 'app', 'web-code.txt'), 'utf-8').trim();
const PAGE_VER = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8').match(/AT_VERSION='([^']+)'/)[1];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json' };

let hits = 0;
const srv = http.createServer((req, res) => {
  hits++;
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(TMP, p === '/' ? '/index.html' : p);
  if (!f.startsWith(TMP)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
});

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  :: ' + detail : ''));
  if (ok) pass++; else fail++;
}

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--disable-dev-shm-usage', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true });
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setEmulatedMedia', { features: [
    { name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  /* —— 正常路：打开固定网址 —— */
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const landed = page.url();
  check('E1 从「/」自动换到最新 code（' + CODE + '）那一份页面',
    landed.indexOf('/app/web/') >= 0 && new RegExp('/app/web/' + CODE + '/index\\.html$').test(landed), landed);
  const app = await page.evaluate(() => ({
    ver: window.AT_VERSION || '',
    title: (document.title || '').trim(),
    hasList: !!document.getElementById('vList'),
    fab: !!document.getElementById('fabAdd'),
    coarse: matchMedia('(hover:none)').matches && matchMedia('(pointer:coarse)').matches,
  }));
  check('E2 落地的是能用的追迹（版本 v' + PAGE_VER + ' 对、DOM 在、手机样式命中）',
    app.ver === PAGE_VER && app.hasList && app.fab && app.coarse, JSON.stringify(app));

  /* 三段的拦截规则挂**同一个**监听器（mode 切换）。
     每段各挂一个的写法会双响：上一个监听器已经把请求处理掉了，
     这一个再 respond/continue 就是 puppeteer 那句 «Request is already handled!»。 */
  let mode = 'off';
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const isManifest = /app\/web\.json/.test(req.url());
    if (mode === 'off') return req.continue();
    if (mode === 'dead') return isManifest ? req.abort() : req.continue();
    if (mode === 'evil') {
      if (isManifest) return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '../../evil' }) });
      return req.continue();
    }
    return req.continue();
  });

  /* —— 失败路：清单坏了/取不到 —— */
  mode = 'dead';
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  const bad = await page.evaluate(() => ({
    url: location.pathname,
    tip: (document.getElementById('tip') || {}).textContent || '',
    retry: !![...document.querySelectorAll('button')].find((b) => /重试/.test(b.textContent || '')),
    link: !!document.querySelector('#tip a'),
  }));
  check('E3 清单取不到时停在能看懂的一屏（有说明、有重试、没跳走）',
    bad.url === '/' && bad.retry && bad.link && /取不到/.test(bad.tip), JSON.stringify(bad));

  /* —— 清单被改坏：code 不是纯数字，不能拼进 URL —— */
  mode = 'evil';
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  const evil = await page.evaluate(() => ({ url: location.pathname,
    tip: (document.getElementById('tip') || {}).textContent || '' }));
  check('E4 清单里的 code 不合法时拒绝跳转（防被指到别处）',
    evil.url === '/' && /不合法/.test(evil.tip), JSON.stringify(evil));

  check('E5 全程无页面级 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log('  云端那棵树被请求了 ' + hits + ' 次');

  await browser.close();
  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('异常: ' + (e && e.stack || e));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) {}
  process.exit(1); });
