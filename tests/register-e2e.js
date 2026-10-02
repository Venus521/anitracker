/* 注册/登录流程 —— 浏览器 E2E（v2.16.0 重写，对齐「单屏」版界面）
   为什么重写：v2.11 那 13 条是围着**双 Tab** 注册页写的，批次C 极简单屏时只同步更新了
   register-logic.js，这份从用例 03（找 cbTabLogin）就崩，等于门禁里挂着一套过期用例。
   现在界面是：默认只给登录表单，底部一行「还没有账号？注册」原地换成注册表单，可一键换回。

   沿用 skill「single-file-html-browser-testing」的骨架：
   - 复用项目自带服务器 服务器-空闲自退.py（不另起一套）
   - 轮询健康检查，不用固定 sleep 等服务器
   - 拦掉外部请求，测试不依赖网络
   - 断言读真实 DOM 与数据状态，pageerror 必须为 0

   一条实测命门：CloudBase 的认证**不走** tcb-api.tencentcloudapi.com，而是
   `https://cloud1-*.api.tcloudbasegateway.com/auth/v1/…`（发验证码 = POST /auth/v1/verification）。
   只掐 tcb-api 的话，发信请求会真的打到公网、悬在那里，「点击瞬间锁按钮」这种时序断言根本复现不了。
   所以这里对认证域名给两种模式：hang（既不响应也不 abort，让 await 悬着）/ abort（让它失败）。
   另外 vendor/cloudbase.full.js 与 cloudbase-sync.js 的路径里也含 "cloudbase"，
   拦截正则一律带 `tcloudbasegateway`，别把自家脚本掐了——那会让 SDK 没挂载，两边都测不到。
   还有半条命门：**CORS 预检（OPTIONS）必须自己用 204 答掉**。预检被挂起时浏览器根本不发 POST，
   于是「在途」测的是空气、请求数恒为 0（第一版就是这么假失败的）。

   端口 8120（避开项目里已用的 8092/8094/8096/8097/8099/8100/8101/8102/8133/8135） */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8120;
const PY = process.env.AT_PY || 'python';
const CHROME = process.env.AT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AUTH_RE = /tcloudbasegateway\.com\/auth\/v1\//;
const DATA_RE = /tcb-api\.tencentcloudapi\.com/;

let pass = 0, fail = 0;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || '' });
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (detail ? '  :: ' + detail : ''));
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
  check('01', '项目自带服务器启动并可访问', up, up ? '' : '轮询 60s 未就绪（服务进程 ' + srvExit + '）');
  if (!up) { srv.kill(); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 950 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  let netMode = 'abort';      /* abort = 让请求失败；hang = 让它悬着（复现「在途」） */
  let authPosts = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (DATA_RE.test(u)) return req.abort();          /* 数据面（云合并/上传）一律断，绝不碰真库 */
    if (AUTH_RE.test(u)) {
      /* 预检必须自己答，否则浏览器压根不发 POST——挂起 OPTIONS 会连「在途」都测不到，
         只会得到一个恒为 0 的计数（第一版就栽在这，用例 15 假失败）。 */
      if (req.method() === 'OPTIONS') {
        return req.respond({ status: 204, headers: {
          'access-control-allow-origin': 'http://127.0.0.1:' + PORT,
          'access-control-allow-methods': 'POST, GET, OPTIONS',
          'access-control-allow-headers': '*',
          'access-control-allow-credentials': 'true', 'access-control-max-age': '0' } });
      }
      authPosts++;
      if (netMode === 'hang') return;                 /* 不 respond 也不 abort：await 永不回来 */
      return req.abort();
    }
    return req.continue();
  });

  const url = 'http://127.0.0.1:' + PORT + '/index.html';
  const openPanel = async () => {
    await page.evaluate(() => { window.__closeSync && window.__closeSync(); openAccount(); });
    await sleep(1500);
  };
  const fresh = async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2400);
  };
  const setVal = (id, v) => page.evaluate((i, val) => {
    const e = document.getElementById(i); if (!e) return false;
    e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); return true;
  }, id, v);
  const shot = (sel) => page.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
      vis: r.height > 0 && getComputedStyle(e).display !== 'none', text: (e.textContent || '').trim() };
  }, sel);

  netMode = 'abort';
  await fresh();
  await openPanel();

  /* —— 02 面板与表单挂载 —— */
  const mounted = await page.evaluate(() => ({
    area: !!document.getElementById('cbArea'),
    login: !!document.getElementById('cbUser'),
    sdk: !!window.CBSync,
  }));
  check('02', '账号面板能打开，登录表单由 cloudbase-sync.js 挂进 #cbArea',
    mounted.area && mounted.login && mounted.sdk, JSON.stringify(mounted));

  /* —— 03 单屏：没有 Tab 条（这一条就是旧用例崩在第 3 步的原因） —— */
  const single = await page.evaluate(() => {
    const pL = document.getElementById('cbPaneLogin'), pR = document.getElementById('cbPaneReg');
    return {
      noTabs: !document.getElementById('cbTabLogin') && !document.getElementById('cbTabReg'),
      noOldRegBox: !document.getElementById('cbRegBox'),
      loginVisible: !!pL && pL.offsetHeight > 0,
      regHidden: !!pR && pR.offsetHeight === 0,
      toReg: !!document.getElementById('cbToReg'),
    };
  });
  check('03', '单屏结构：默认登录屏可见、注册屏隐藏、双 Tab 条与旧 cbRegBox 都已退役',
    single.noTabs && single.noOldRegBox && single.loginVisible && single.regHidden && single.toReg,
    JSON.stringify(single));

  /* —— 04 点「注册」原地换屏，焦点给邮箱 —— */
  await page.evaluate(() => document.getElementById('cbToReg').click());
  await sleep(600);
  const swapped = await page.evaluate(() => ({
    regVisible: (() => { const p = document.getElementById('cbPaneReg'); return !!p && p.offsetHeight > 0; })(),
    loginHidden: (() => { const p = document.getElementById('cbPaneLogin'); return !!p && p.offsetHeight === 0; })(),
    focused: document.activeElement && document.activeElement.id,
  }));
  check('04', '点「注册」整屏换成注册表单（登录屏收起），焦点自动落在邮箱框',
    swapped.regVisible && swapped.loginHidden && swapped.focused === 'cbEmail', JSON.stringify(swapped));

  /* —— 05 注册屏要素齐，且没有用户名输入框（折叠项已按需求砍掉） —— */
  const fields = await page.evaluate(() => ({
    email: !!document.getElementById('cbEmail'), pass: !!document.getElementById('cbEmailPass'),
    code: !!document.getElementById('cbCode'), send: !!document.getElementById('cbSendCode'),
    finish: !!document.getElementById('cbFinish'), back: !!document.getElementById('cbToLogin'),
    noUserName: !document.getElementById('cbNewName'),
    noFinishBtnDup: document.querySelectorAll('#cbPaneReg .b1').length === 1,
  }));
  check('05', '注册屏要素齐（邮箱/密码/验证码/获取/完成/返回登录），且不再要用户名',
    fields.email && fields.pass && fields.code && fields.send && fields.finish && fields.back && fields.noUserName,
    JSON.stringify(fields));

  /* —— 06 验证码与「获取」同一行；文案是 4–8 位 —— */
  const codeRow = await page.evaluate(() => {
    const c = document.getElementById('cbCode'), s = document.getElementById('cbSendCode');
    if (!c || !s) return { sameRow: false };
    return { sameRow: Math.abs(c.getBoundingClientRect().top - s.getBoundingClientRect().top) < 12,
      ph: c.placeholder || '' };
  });
  check('06', '验证码输入框与「获取验证码」同一行，占位文案是 4–8 位',
    codeRow.sameRow && /4–8/.test(codeRow.ph), JSON.stringify(codeRow));

  /* —— 07 非法邮箱：前端拦住，一次云端请求都不该发出去 —— */
  authPosts = 0;
  await setVal('cbEmail', 'not-an-email');
  await setVal('cbEmailPass', 'Probe0Testx');
  await page.evaluate(() => document.getElementById('cbSendCode').click());
  await sleep(500);
  const badEmail = await page.evaluate(() => (document.getElementById('cbRegMsg') || {}).textContent || '');
  check('07', '非法邮箱被前端拦住，且不发任何认证请求（不拿用户的打字去敲云端）',
    /正确的邮箱/.test(badEmail) && authPosts === 0, JSON.stringify({ msg: badEmail, authPosts }));

  /* —— 08 短密码拦住；08b 纯数字/纯字母放行（v2.17.0 用户指令「可纯数字或者字母」）；
        08c 密码框能切明/暗（手机端看不见自己打的字，是这个页面最容易火的一件事） —— */
  authPosts = 0;
  await setVal('cbEmail', 'ok@example.com');
  await setVal('cbEmailPass', '123');
  await page.evaluate(() => document.getElementById('cbSendCode').click());
  await sleep(500);
  const weakPwd = await page.evaluate(() => (document.getElementById('cbRegMsg') || {}).textContent || '');
  check('08', '弱密码被拦住（提示 6–32 位，数字或字母都行），同样不发请求',
    /6–32 位/.test(weakPwd) && authPosts === 0, JSON.stringify({ msg: weakPwd, authPosts }));

  authPosts = 0;
  await setVal('cbEmailPass', '123456');
  await page.evaluate(() => document.getElementById('cbSendCode').click());
  await sleep(700);
  const pureDigits = await page.evaluate(() => ({
    msg: (document.getElementById('cbRegMsg') || {}).textContent || '',
    type: document.getElementById('cbEmailPass').type }));
  check('08b', '纯数字 6 位放行（真的把发信请求打出去了，不是被前端拦下）',
    authPosts >= 1 && !/6–32 位/.test(pureDigits.msg), JSON.stringify({ authPosts, pureDigits }));

  const eye = await page.evaluate(() => {
    const b = document.querySelector('.cb-eye[data-eye="cbEmailPass"]');
    if (!b) return { exists: false };
    const before = document.getElementById('cbEmailPass').type;
    b.click();
    const mid = { type: document.getElementById('cbEmailPass').type, label: (b.textContent || '').trim() };
    b.click();
    return { exists: true, before, mid, after: document.getElementById('cbEmailPass').type,
      label2: (b.textContent || '').trim() };
  });
  check('08c', '密码框带「显示/隐藏」，点一下真切成明文、再点切回',
    eye.exists && eye.before === 'password' && eye.mid.type === 'text' && /隐藏/.test(eye.mid.label) &&
    eye.after === 'password' && /显示/.test(eye.label2), JSON.stringify(eye));
  await setVal('cbEmailPass', 'Probe0Testx');

  /* —— 09【核心】发信在途的**那一瞬间**按钮就锁死 ——
     这是当初的真 bug：signUp 要 5~6 秒，旧版是 await 回来才禁用，中间真空期能狂点。
     复现办法：把认证请求挂起（netMode='hang'），于是 await 永不回来，「在途」变成可稳定观测的状态。 */
  await setVal('cbEmail', 'lock_' + Date.now() + '@example.com');
  await setVal('cbEmailPass', 'Probe0Testx');
  netMode = 'hang';
  authPosts = 0;
  await page.evaluate(() => document.getElementById('cbSendCode').click());
  await sleep(150);
  const during = await page.evaluate(() => {
    const b = document.getElementById('cbSendCode');
    return { disabled: b.disabled, text: (b.textContent || '').trim() };
  });
  check('09', '【核心】点击后立刻禁用按钮并显示「发送中…」（不等 await 回来）',
    during.disabled === true && /发送中/.test(during.text), JSON.stringify(during));

  /* —— 10 在途期间再点两下：防重入，不该再多发一次信 —— */
  /* 基线等首单真的落到拦截器之后再取：hang 模式永不返回，150ms 时计数常常还是 0，
     那样「第一单迟到」会被误判成「重复点击突破了 _sending」。 */
  for (let i = 0; i < 30 && authPosts === 0; i++) await sleep(100);
  const postsAfterFirst = authPosts;
  await page.evaluate(() => {
    const b = document.getElementById('cbSendCode'); b.click(); b.click();
  });
  await sleep(600);
  check('10', '发送期间重复点击被 _sending 拦住（认证请求数不增，不会二次发信）',
    authPosts === postsAfterFirst && postsAfterFirst > 0, '首次 ' + postsAfterFirst + ' → 连点后 ' + authPosts);
  netMode = 'abort';

  /* —— 11 发信真失败时按钮必须恢复，不能永久卡在「发送中」 ——
     上一步那次请求被 abort 后 await 永不返回（页面里那条 Promise 悬着），_sending 也就还挂着 true，
     所以换一次干净的重载再测失败分支。 */
  await fresh();
  await openPanel();
  await page.evaluate(() => document.getElementById('cbToReg').click());
  await sleep(500);
  await setVal('cbEmail', 'fail_' + Date.now() + '@example.com');
  await setVal('cbEmailPass', 'Probe0Testx');
  await page.evaluate(() => document.getElementById('cbSendCode').click());
  await sleep(2500);
  const recovered = await page.evaluate(() => {
    const b = document.getElementById('cbSendCode'), m = document.getElementById('cbRegMsg');
    return { disabled: b.disabled, text: (b.textContent || '').trim(), msg: (m.textContent || '').trim() };
  });
  check('11', '发信失败后按钮恢复可用、文案回「获取验证码」，并给出人话错误',
    recovered.disabled === false && /获取验证码/.test(recovered.text) && !!recovered.msg,
    JSON.stringify(recovered));

  /* —— 12 没获取验证码就想「完成注册」 —— */
  await page.evaluate(() => document.getElementById('cbFinish').click());
  await sleep(600);
  const noCode = await page.evaluate(() => ({
    msg: (document.getElementById('cbRegMsg') || {}).textContent || '',
    pend: localStorage.getItem('at_reg_pending'),
  }));
  check('12', '没点「获取验证码」就提交注册被拦下（且没有伪造出待验证凭证）',
    /请先点「获取验证码」/.test(noCode.msg) && !noCode.pend, JSON.stringify(noCode));

  /* —— 13【核心】刷新续注册：凭 messageId 回到注册屏并预填，顶部说明「还差一步」 —— */
  await page.evaluate(() => {
    localStorage.setItem('at_reg_pending', JSON.stringify({
      email: 'resume_test@example.com',
      messageId: 'eyJhbGciOiJSUzI1NiJ9.fake-payload-for-ui-test.sig',
      at: Date.now(),
    }));
  });
  await fresh();
  await openPanel();
  const resumed = await page.evaluate(() => {
    const pR = document.getElementById('cbPaneReg'), pe = document.getElementById('cbEmail');
    const pn = document.getElementById('cbRegNotice'), sc = document.getElementById('cbSendCode');
    return {
      regVisible: !!pR && pR.offsetHeight > 0,
      emailPrefilled: pe ? pe.value : '',
      notice: pn ? (pn.textContent || '').trim() : '',
      noticeVisible: !!pn && pn.offsetHeight > 0,
      sendText: sc ? (sc.textContent || '').trim() : '',
    };
  });
  check('13', '【核心】刷新后自动回到注册屏、预填邮箱、顶部提示「还差一步」、按钮改「重新获取」',
    resumed.regVisible && resumed.emailPrefilled === 'resume_test@example.com'
      && resumed.noticeVisible && /还差一步/.test(resumed.notice) && /重新获取/.test(resumed.sendText),
    JSON.stringify(resumed));

  /* —— 14 过期的待验证凭证要清掉（验证码 10 分钟有效，别让人对着死凭证白填） —— */
  await page.evaluate(() => {
    localStorage.setItem('at_reg_pending', JSON.stringify({
      email: 'stale@example.com', messageId: 'x', at: Date.now() - 11 * 60 * 1000,
    }));
  });
  await fresh();
  await openPanel();
  const stale = await page.evaluate(() => ({
    regVisible: (() => { const p = document.getElementById('cbPaneReg'); return !!p && p.offsetHeight > 0; })(),
    loginVisible: (() => { const p = document.getElementById('cbPaneLogin'); return !!p && p.offsetHeight > 0; })(),
    ls: localStorage.getItem('at_reg_pending'),
  }));
  check('14', '过期的注册凭证被清掉，回到默认登录屏',
    stale.regVisible === false && stale.loginVisible && stale.ls === null, JSON.stringify(stale));

  /* —— 15 回车即登录：键盘事件真的把表单提交了（旧版没有这条） —— */
  authPosts = 0;
  netMode = 'hang';
  await page.evaluate(() => {
    const u = document.getElementById('cbUser'), p = document.getElementById('cbPass');
    u.value = 'nobody@example.com'; p.value = 'Probe0Testx';
    u.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(450);
  const enter = await page.evaluate(() => {
    const b = document.getElementById('cbLogin');
    return { disabled: b.disabled, text: (b.textContent || '').trim() };
  });
  check('15', '登录框回车即提交（按钮进「登录中…」并禁用），且确实发出了认证请求',
    enter.disabled === true && /登录中/.test(enter.text) && authPosts > 0,
    JSON.stringify(Object.assign({ authPosts }, enter)));
  netMode = 'abort';

  /* —— 16 登录失败后按钮恢复（不永久禁用） —— */
  await fresh();
  await openPanel();
  await page.evaluate(() => {
    const u = document.getElementById('cbUser'), p = document.getElementById('cbPass');
    u.value = 'nobody@example.com'; p.value = 'Probe0Testx';
    document.getElementById('cbLogin').click();
  });
  await sleep(2500);
  const loginBack = await page.evaluate(() => {
    const b = document.getElementById('cbLogin'), m = document.getElementById('cbMsg');
    return { disabled: b.disabled, text: (b.textContent || '').trim(), msg: (m.textContent || '').trim() };
  });
  check('16', '登录失败后按钮恢复「登录」并可重试，错误写进 #cbMsg',
    loginBack.disabled === false && /登录/.test(loginBack.text) && !!loginBack.msg, JSON.stringify(loginBack));

  /* —— 17 「返回登录」换回默认屏 —— */
  const backToLogin = await page.evaluate(() => {
    document.getElementById('cbToReg').click();
    const pR = document.getElementById('cbPaneReg');
    const shown = !!pR && pR.offsetHeight > 0;
    document.getElementById('cbToLogin').click();
    return { shown };
  });
  await sleep(500);
  const afterBack = await page.evaluate(() => ({
    regHidden: (() => { const p = document.getElementById('cbPaneReg'); return !!p && p.offsetHeight === 0; })(),
    loginVisible: (() => { const p = document.getElementById('cbPaneLogin'); return !!p && p.offsetHeight > 0; })(),
  }));
  check('17', '「返回登录」一键换回默认屏',
    backToLogin.shown && afterBack.regHidden && afterBack.loginVisible,
    JSON.stringify({ backToLogin, afterBack }));

  /* —— 18 零页面级错误 —— */
  check('18', '全程无页面级 JS 错误', pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '');

  await browser.close();
  srv.kill();

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
  if (fail) {
    console.log('\n失败项：');
    results.filter(x => !x.ok).forEach(x => console.log('  ' + x.id + ' ' + x.name + ' :: ' + x.detail));
  }
  fs.writeFileSync(path.join(ROOT, 'tests', 'last-register-e2e.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: pass + fail, results }, null, 1));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('外层异常: ' + (e && e.stack || e)); process.exit(1); });
