/* account-e2e.js — 「忘了密码」专项 E2E（v2.17.0 重写）
   为什么重写：这一套原来围着 v2.6 的界面写（syncOpen()、cbRegBox、写死版本 2.7.0），
   那些符号早就随「单屏化 + 密码可见化」退役了，跑起来第 1 步就 ReferenceError。
   注册/登录本身的时序（锁按钮、防重入、刷新续注册）已由 register-e2e.js 覆盖，
   这份只盯用户这次点名要的东西：**忘记密码有没有一条走得通的自助路**。
     · 入口在登录屏上（不是藏在设置深处）
     · 非法邮箱 / 没拿验证码都在前端拦住，一次云端请求都不发
     · 发码在途锁按钮、失败必须恢复（和注册同一套规矩）
     · 新密码框同样能切明文（手机端看不见自己打的字是最容易火的事）
     · 每一步落一条 kind='auth' 台账
   端口 8121（避开 8095/8120 等同族门禁）；认证域只给 hang/abort 两种模式，绝不碰真云。
   顺带管账号面板里「手机版 App · 下载 APK」那一行（v2.19.0）：它是浏览器模式的装机路，
   /app/ 下的清单与安装包全部由本地假数据喂，不去碰真云。 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8121;
const PY = process.env.AT_PY || 'python';
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AUTH_RE = /tcloudbasegateway\.com\/auth\/v1\//;
const DATA_RE = /tcb-api\.tencentcloudapi\.com/;
/* 账号面板「下载 APK」用的假公网：清单里故意塞一条指往别处的 url，
   看代码是不是真的只认 versionCode 自己拼路径（照抄清单 url 就是 SSRF 口子）。 */
const apkFake = { mode: 'ok', code: '7', hit: [], bytes: Buffer.alloc(200000, 7) };

const results = [];
let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || '' });
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (detail ? '  :: ' + String(detail).slice(0, 220) : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, (res) => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitServer(tries = 120) {
  for (let i = 0; i < tries; i++) { if (await probe()) return true; await sleep(500); }
  return false;
}

(async () => {
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
  let srvExit = 'still-running';
  srv.on('exit', (c) => { srvExit = 'exit ' + c; });
  const up = await waitServer();
  check('01', '静态服务就绪', up, up ? '' : '轮询 60s 未起来（服务进程 ' + srvExit + '）');
  if (!up) { srv.kill(); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pageErrors = [];
  let netMode = 'abort', authPosts = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 430, height: 950 });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    /* SW 的 fetch 在它自己的上下文里发，CDP 的请求拦截看不见（实测喂给 /app/ 的假清单被 SW 直接
       透传给真服务器，一律 404）。这里从源头掐掉注册：本门禁测的是账号面板与登录链路，不是缓存策略。 */
    await page.evaluateOnNewDocument(() => {
      try {
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
          register: function () { return Promise.reject(new Error('gate: service worker disabled')); },
          getRegistration: function () { return Promise.resolve(undefined); },
          getRegistrations: function () { return Promise.resolve([]); },
          addEventListener: function () {}, removeEventListener: function () {},
          ready: new Promise(function () {}), controller: null } });
      } catch (e) {}
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (DATA_RE.test(u)) return req.abort();
      if (AUTH_RE.test(u)) {
        /* 预检必须答掉，否则浏览器不发 POST，计数会恒为 0（register-e2e 踩过同一颗坑） */
        if (req.method() === 'OPTIONS') {
          return req.respond({ status: 204, headers: {
            'access-control-allow-origin': 'http://127.0.0.1:' + PORT,
            'access-control-allow-methods': 'POST, GET, OPTIONS',
            'access-control-allow-headers': '*',
            'access-control-allow-credentials': 'true', 'access-control-max-age': '0' } });
        }
        authPosts++;
        if (netMode === 'hang') return;
        return req.abort();
      }
      const ap = /^https?:\/\/[^/]+\/app\/([^?#]+)/.exec(u);
      if (ap) {
        apkFake.hit.push(u.replace(/^https?:\/\/[^/]+/, ''));
        if (ap[1] === 'version.json') {
          const man = apkFake.mode === 'badver'
            ? { versionCode: '../../evil', versionName: 'x', url: 'http://198.51.100.9/z.apk' }
            : { versionCode: apkFake.code, versionName: '1.6', url: 'http://198.51.100.9/z.apk' };
          return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(man) });
        }
        if (/^AniTracker-\d+\.apk$/.test(ap[1])) {
          return req.respond({ status: 200, contentType: 'application/vnd.android.package-archive',
            body: apkFake.bytes });
        }
        return req.respond({ status: 404, contentType: 'text/plain', body: 'nope' });
      }
      return req.continue();
    });

    const url = 'http://127.0.0.1:' + PORT + '/index.html';
    const openPanel = async () => {
      await page.evaluate(() => { window.__closeSync && window.__closeSync(); openAccount(); });
      await sleep(1600);
    };
    const setVal = (id, v) => page.evaluate((i, val) => {
      const e = document.getElementById(i); if (!e) return false;
      e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); return true;
    }, id, v);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2400);
    await openPanel();

    /* —— 02 版本一致 + 登录屏就是默认屏，且「重设」入口就在这一屏 —— */
    const gate = await page.evaluate(() => ({
      a: (typeof AT_VERSION !== 'undefined') ? AT_VERSION : null,
      cb: (window.CBSync && CBSync.version) || null,
      login: !!document.getElementById('cbUser'),
      toReset: !!document.getElementById('cbToReset'),
      resetHidden: (() => { const p = document.getElementById('cbPaneReset'); return !!p && p.offsetHeight === 0; })(),
    }));
    check('02', '版本一致（页面 v' + gate.a + ' = 模块 v' + gate.cb + '），CBSync 已挂载',
      !!gate.a && gate.a === gate.cb && /^2\./.test(String(gate.cb || '')), JSON.stringify(gate));

    /* —— 03 点「重设」换屏，焦点直接落在邮箱框（用户不用先点一下） —— */
    await page.evaluate(() => document.getElementById('cbToReset').click());
    await sleep(500);
    const pane = await page.evaluate(() => ({
      reset: (() => { const p = document.getElementById('cbPaneReset'); return !!p && p.offsetHeight > 0; })(),
      loginGone: (() => { const l = document.getElementById('cbPaneLogin'); return !l || l.offsetHeight === 0; })(),
      email: !!document.getElementById('cbRpEmail'),
      pass: !!document.getElementById('cbRpPass'),
      code: !!document.getElementById('cbRpCode'),
      send: !!document.getElementById('cbRpSend'),
      go: !!document.getElementById('cbRpGo'),
      back: !!document.getElementById('cbRpBack'),
      focus: document.activeElement && document.activeElement.id,
    }));
    check('03', '重设屏要素齐（邮箱/新密码/验证码/获取/提交/返回），登录屏收起',
      pane.reset && pane.loginGone && pane.email && pane.pass && pane.code && pane.send && pane.go && pane.back,
      JSON.stringify(pane));
    check('04', '进重设屏焦点自动在邮箱框', pane.focus === 'cbRpEmail', JSON.stringify({ focus: pane.focus }));

    /* —— 05 非法邮箱：前端拦住且一发请求都不发 —— */
    authPosts = 0;
    await setVal('cbRpEmail', 'not-an-email');
    await page.evaluate(() => document.getElementById('cbRpSend').click());
    await sleep(450);
    const badMail = await page.evaluate(() => (document.getElementById('cbRpMsg') || {}).textContent || '');
    check('05', '非法邮箱被拦住且不敲云端', /正确的邮箱/.test(badMail) && authPosts === 0,
      JSON.stringify({ msg: badMail, authPosts }));

    /* —— 06 没拿验证码就提交：拦住，也不发请求 —— */
    authPosts = 0;
    await setVal('cbRpEmail', 'rp@example.com');
    await setVal('cbRpPass', 'Newpass1');
    await setVal('cbRpCode', '123456');
    await page.evaluate(() => document.getElementById('cbRpGo').click());
    await sleep(450);
    const noTicket = await page.evaluate(() => ({
      msg: (document.getElementById('cbRpMsg') || {}).textContent || '',
      btn: (document.getElementById('cbRpGo') || {}).textContent || '',
    }));
    check('06', '没点「获取验证码」就提交被拦下（提示先取码，按钮没卡死）',
      /先点/.test(noTicket.msg) && authPosts === 0 && /设新密码/.test(noTicket.btn), JSON.stringify({ noTicket, authPosts }));

    /* —— 07 发码在途瞬间锁死（这是注册那边验过的同一颗雷：真空期能狂点就会重复发信） —— */
    netMode = 'hang';
    authPosts = 0;
    await page.evaluate(() => document.getElementById('cbRpSend').click());
    await sleep(200);
    for (let i = 0; i < 30 && authPosts === 0; i++) await sleep(100);
    const inFlight = await page.evaluate(() => {
      const b = document.getElementById('cbRpSend');
      return { disabled: b.disabled, text: (b.textContent || '').trim() };
    });
    const postsDuring = authPosts;
    check('07', '点「获取验证码」立刻禁用并显示「发送中…」（不等 await 回来）',
      inFlight.disabled === true && /发送中/.test(inFlight.text) && postsDuring > 0,
      JSON.stringify({ inFlight, postsDuring }));

    /* —— 08 在途期间连点两下：防重入 —— */
    await page.evaluate(() => { const b = document.getElementById('cbRpSend'); b.click(); b.click(); });
    await sleep(600);
    check('08', '发送期间重复点击不再多发一封信', authPosts === postsDuring,
      '在途 ' + postsDuring + ' → 连点后 ' + authPosts);

    /* —— 09 换一次干净页面测失败分支：按钮必须恢复，错误得是人话 —— */
    netMode = 'abort';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2400);
    await openPanel();
    await page.evaluate(() => document.getElementById('cbToReset').click());
    await sleep(400);
    await setVal('cbRpEmail', 'rp_' + Date.now() + '@example.com');
    authPosts = 0;
    await page.evaluate(() => document.getElementById('cbRpSend').click());
    await sleep(2600);
    const failed = await page.evaluate(() => {
      const b = document.getElementById('cbRpSend');
      return { disabled: b.disabled, text: (b.textContent || '').trim(),
        msg: (document.getElementById('cbRpMsg') || {}).textContent || '',
        log: (JSON.parse(localStorage.getItem('at_sync_log') || '[]') || [])
          .filter((x) => x.kind === 'auth').slice(-3) };
    });
    check('09', '发码失败后按钮恢复可用、文案回「获取验证码」，错误是人话（不泄漏 %!(EXTRA）',
      failed.disabled === false && /获取验证码/.test(failed.text) && failed.msg.length > 0 &&
      !/%!|EXTRA|\[object/.test(failed.msg), JSON.stringify(failed));
    check('10', '重设链路的每一步都落台账（kind=auth）',
      failed.log.length >= 1 && /重设密码/.test(failed.log.map((x) => x.title).join(' ')),
      JSON.stringify(failed.log));

    /* —— 11 新密码框也带明/暗切换（用户指令「加入登陆时的可视密码」，重设屏同一套 pwdRow） —— */
    const eye = await page.evaluate(() => {
      const b = document.querySelector('.cb-eye[data-eye="cbRpPass"]');
      if (!b) return { exists: false };
      const before = document.getElementById('cbRpPass').type;
      b.click();
      const mid = { type: document.getElementById('cbRpPass').type, label: (b.textContent || '').trim() };
      b.click();
      return { exists: true, before, mid, after: document.getElementById('cbRpPass').type };
    });
    check('11', '重设屏新密码框能切明文再切回',
      eye.exists && eye.before === 'password' && eye.mid.type === 'text' && /隐藏/.test(eye.mid.label) &&
      eye.after === 'password', JSON.stringify(eye));

    /* —— 12 「返回登录」一键回默认屏 —— */
    await page.evaluate(() => document.getElementById('cbRpBack').click());
    await sleep(450);
    const back = await page.evaluate(() => ({
      login: (() => { const l = document.getElementById('cbPaneLogin'); return !!l && l.offsetHeight > 0; })(),
      resetGone: (() => { const p = document.getElementById('cbPaneReset'); return !p || p.offsetHeight === 0; })(),
    }));
    check('12', '「返回登录」一键换回默认屏', back.login && back.resetGone, JSON.stringify(back));

    /* —— 13 浏览器模式（没有壳）账号面板给的是「下载 APK」那一行，而不是壳里的「检查更新」 ——
       可点区尺寸不在这里量：这一档视口没模拟触屏，@media(hover:none) 那批手机端样式不命中，
       量到的 20px 是桌面样式的小链接。触屏下的真实尺寸由 phone-look 的「账号面板·浏览器模式」那屏管。 */
    const apkRow = await page.evaluate(() => ({
      shell: typeof window.AndroidShell !== 'undefined' && !!window.AndroidShell,
      apkBtn: !!document.getElementById('apkBtn'),
      updBtn: !!document.getElementById('updBtn'),
      webBtn: !!document.getElementById('webBtn'),
      inPanel: (() => { const b = document.getElementById('apkBtn');
        return !!b && !!(b.closest && b.closest('.panel')); })(),
      // 这一趟必须没有 SW 接管，否则下面两条取到的是真服务器的 404，而不是喂的假包
      swControlled: !!navigator.serviceWorker.controller,
      msg: (document.getElementById('apkMsg') || {}).textContent || '',
    }));
    check('13', '浏览器模式账号面板有「手机版 App · 下载 APK」一行，壳里那两行不在，且无 SW 接管',
      !apkRow.shell && !apkRow.swControlled && apkRow.apkBtn && apkRow.inPanel &&
      !apkRow.updBtn && !apkRow.webBtn && /离线/.test(apkRow.msg), JSON.stringify(apkRow));

    /* —— 14 点它：清单里那条 url 一概不信，只拿 versionCode 拼纯数字直链，拿到字节再交给浏览器 ——
       为什么非要走 fetch 而不是给人一颗直链：CloudBase 测试域名的「页面访问提示」按文档请求拦，
       每换一条直链都要重过一次；fetch 实测不受拦（200 + 完整字节）。 */
    apkFake.mode = 'ok'; apkFake.code = '7'; apkFake.hit = [];
    await page.evaluate(() => document.getElementById('apkBtn').click());
    let dl = null;
    for (let i = 0; i < 40; i++) {
      dl = await page.evaluate(() => ({ text: (document.getElementById('apkMsg') || {}).textContent || '',
        disabled: (document.getElementById('apkBtn') || {}).disabled }));
      if (/交给浏览器下载/.test(dl.text)) break;
      await sleep(200);
    }
    check('14', '「下载 APK」只请求清单+拼出的数字直链（清单里那条 url 一次都没碰），成功后回执带体积',
      /交给浏览器下载/.test(dl.text) && /KB/.test(dl.text) && dl.disabled === false &&
      apkFake.hit.length === 2 && /^\/app\/version\.json\?_=\d+$/.test(apkFake.hit[0]) &&
      apkFake.hit[1] === '/app/AniTracker-7.apk', JSON.stringify({ dl, hit: apkFake.hit }));

    /* —— 15 清单被改坏（versionCode 不是纯数字）：一步都不许多走，不请求任何安装包 —— */
    apkFake.mode = 'badver'; apkFake.hit = [];
    await page.evaluate(() => document.getElementById('apkBtn').click());
    let rej = null;
    for (let i = 0; i < 30; i++) {
      rej = await page.evaluate(() => (document.getElementById('apkMsg') || {}).textContent || '');
      if (/不合法|没拿到/.test(rej)) break;
      await sleep(200);
    }
    check('15', '清单版本号不合法时直接作罢，绝不照着它去取文件',
      /不合法/.test(rej) && apkFake.hit.length === 1 &&
      /^\/app\/version\.json\?_=\d+$/.test(apkFake.hit[0]), JSON.stringify({ rej, hit: apkFake.hit }));

    /* —— 16 全程无页面级 JS 错误 —— */
    check('16', '全程无页面级 JS 错误', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

    fs.writeFileSync(path.join(__dirname, 'last-account-test.json'),
      JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 2));
    console.log('\n' + '='.repeat(48));
    console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    check('99', '测试执行异常', false, String(e && e.stack || e));
    fs.writeFileSync(path.join(__dirname, 'last-account-test.json'),
      JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 2));
    console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + ' PASS（异常中止）');
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
  }
})();
