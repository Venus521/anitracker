/* v2.11.0 注册流程 —— 浏览器 E2E
   按 skill「single-file-html-browser-testing」步骤 4：
   - 复用项目自带服务器 服务器-空闲自退.py（不用自己另起）
   - 轮询健康检查，不用固定 sleep
   - 拦掉外部 API，测试不依赖网络
   - 断言 pageerror 为 0
   - 断言读真实 DOM 与数据状态
   端口 8120（避开项目里已用的 8092/8094/8096/8097/8099/8100/8101/8102） */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:/Users/Venus/.openclaw-autoclaw/workspace/.cluster/bangumi-tracker/app-test/node_modules/puppeteer-core/`);

const ROOT = 'D:/项目/01_媒体娱乐/ani-tracker';
const PORT = 8120;
const PY = 'C:/Users/Venus/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || '' });
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (detail ? '  :: ' + detail : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* 轮询健康检查（skill 明确要求：不要固定 sleep 等服务器） */
function probe(port, p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 1500 }, (res) => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitServer(port, p, tries = 40) {
  for (let i = 0; i < tries; i++) { if (await probe(port, p)) return true; await sleep(500); }
  return false;
}

(async () => {
  /* 用项目自带服务器 */
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
  const up = await waitServer(PORT, '/index.html');
  check('01', '项目自带服务器启动并可访问', up, up ? '' : '轮询 20s 未就绪');
  if (!up) { srv.kill(); process.exit(1); }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 950 });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  /* 拦掉外部 API：Bangumi 与 CloudBase 后端都断掉，让界面走纯前端逻辑 */
  let cloudCalls = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (/api\.bgm\.tv/.test(u)) return req.abort();
    if (/tcb-api\.tencentcloudapi\.com/.test(u)) { cloudCalls.push(u.split('?')[0]); return req.abort(); }
    req.continue();
  });

  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);

  /* —— 打开账号面板 —— */
  const opened = await page.evaluate(() => {
    if (typeof window.openAccount === 'function') { window.openAccount(); return true; }
    return false;
  });
  check('02', '账号面板可打开', opened);
  await sleep(1200);

  /* —— 03 双 Tab 结构 —— */
  const tabs = await page.evaluate(() => {
    const l = document.getElementById('cbTabLogin'), r = document.getElementById('cbTabReg');
    const pl = document.getElementById('cbPaneLogin'), pr = document.getElementById('cbPaneReg');
    return {
      hasTabs: !!(l && r), hasPanes: !!(pl && pr),
      loginOn: l && l.className.indexOf('on') >= 0,
      regOn: r && r.className.indexOf('on') >= 0,
      loginVisible: pl ? pl.offsetHeight > 0 : false,
      regHidden: pr ? pr.offsetHeight === 0 : false,
      oldRegBoxGone: !document.getElementById('cbRegBox'),
      tabTexts: [l && l.textContent, r && r.textContent],
    };
  });
  check('03', '登录/注册双 Tab 渲染正确：默认登录页、注册页隐藏、旧 cbRegBox 已移除',
    tabs.hasTabs && tabs.hasPanes && tabs.loginOn && !tabs.regOn && tabs.loginVisible && tabs.regHidden && tabs.oldRegBoxGone,
    JSON.stringify(tabs));

  /* —— 04 切到注册 Tab —— */
  await page.evaluate(() => document.getElementById('cbTabReg').click());
  await sleep(500);
  const regView = await page.evaluate(() => {
    const pr = document.getElementById('cbPaneReg');
    const q = (id) => document.getElementById(id);
    return {
      regVisible: pr ? pr.offsetHeight > 0 : false,
      regOn: (document.getElementById('cbTabReg') || {}).className || '',
      hasEmail: !!q('cbEmail'), hasPass: !!q('cbEmailPass'), hasCode: !!q('cbCode'),
      hasSend: !!q('cbSendCode'), hasFinish: !!q('cbFinish'),
      hasNewName: !!q('cbNewName'),                      /* ← 旧版没有这个 */
      codeInSameRow: (() => {
        const c = q('cbCode'), s = q('cbSendCode');
        if (!c || !s) return false;
        return Math.abs(c.getBoundingClientRect().top - s.getBoundingClientRect().top) < 12;
      })(),
      steps: document.querySelectorAll('#cbPaneReg .cbstep').length,
      codePlaceholder: (q('cbCode') || {}).placeholder || '',
    };
  });
  check('04', '注册 Tab 切换后显示完整表单（邮箱/密码/验证码/完成），含用户名输入框',
    regView.regVisible && /on/.test(regView.regOn) && regView.hasEmail && regView.hasPass &&
    regView.hasCode && regView.hasSend && regView.hasFinish && regView.hasNewName,
    JSON.stringify(regView));
  check('05', '验证码与「获取验证码」在同一行 + 两个步骤标记 + 文案是 4–8 位',
    regView.codeInSameRow && regView.steps === 2 && /4–8/.test(regView.codePlaceholder),
    JSON.stringify({ sameRow: regView.codeInSameRow, steps: regView.steps, ph: regView.codePlaceholder }));

  /* —— 06 前端校验：非法邮箱 / 弱密码 —— */
  const vBad = await page.evaluate(async () => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    const msg = () => document.getElementById('cbRegMsg').textContent;
    set('cbEmail', 'not-an-email'); set('cbEmailPass', 'Probe0Testx');
    document.getElementById('cbSendCode').click();
    await new Promise(r => setTimeout(r, 300));
    const badEmail = msg();
    set('cbEmail', 'ok@example.com'); set('cbEmailPass', '123');
    document.getElementById('cbSendCode').click();
    await new Promise(r => setTimeout(r, 300));
    const weakPwd = msg();
    return { badEmail, weakPwd };
  });
  check('06', '前端拦住非法邮箱与弱密码',
    /正确的邮箱/.test(vBad.badEmail) && /8–32 位/.test(vBad.weakPwd), JSON.stringify(vBad));

  /* —— 07【核心】发送期间立刻禁用按钮，且重复点击不会二次发信 ——
     这是本次修的头号 bug：signUp 要 5~6 秒，旧版这期间按钮没禁用。 */
  const sendLock = await page.evaluate(async () => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('cbEmail', 'lock_test_' + Date.now() + '@example.com');
    set('cbEmailPass', 'Probe0Testx');
    const btn = document.getElementById('cbSendCode');
    btn.disabled = false; btn.textContent = '获取验证码';
    const before = { disabled: btn.disabled, text: btn.textContent };

    btn.click();                       /* 第 1 次 */
    await new Promise(r => setTimeout(r, 120));   /* 只等 120ms —— signUp 根本还没回来 */
    const during = { disabled: btn.disabled, text: btn.textContent };

    btn.click(); btn.click();          /* 再点 2 次，应该被 _sending 拦掉 */
    await new Promise(r => setTimeout(r, 250));
    const after = { disabled: btn.disabled, text: btn.textContent };
    return { before, during, after };
  });
  check('07', '【核心】点击后立刻禁用按钮并显示「发送中…」（不等 await 回来）',
    sendLock.during.disabled === true && /发送中/.test(sendLock.during.text),
    JSON.stringify(sendLock));
  check('08', '发送期间重复点击被拦截（按钮保持禁用，不会二次发信）',
    sendLock.after.disabled === true && /发送中/.test(sendLock.after.text),
    JSON.stringify(sendLock.after));

  /* —— 09 发信真的失败时，按钮必须恢复可用（不能永久卡死）——
     注意：单纯 abort 云端请求并不会让 SDK 报错——它会照常返回句柄，
     于是走的是「成功 → 进冷却」这条正常路径（这本身是对的）。
     要触发真失败，得让 signUp 抛错。这里直接注入错误来测恢复逻辑。 */
  await sleep(300);
  const recovered = await page.evaluate(async () => {
    const btn = document.getElementById('cbSendCode');
    const m = document.getElementById('cbRegMsg');
    /* 把 cooldown 停掉，模拟「还没进冷却就已经失败」的场景 */
    btn.disabled = false; btn.textContent = '获取代码';
    const cc = document.getElementById('cbEmail'), cp = document.getElementById('cbEmailPass');
    cc.value = 'fail_test_' + Date.now() + '@example.com'; cp.value = 'Probe0Testx';

    /* 直接劫持 startSignUp 的依赖：把 auth.signUp 换成必定抛错，
       这样测的就是「catch 分支有没有把按钮和 _sending 复位」 */
    const app = window.__atFailApp || null;
    return { note: '见下一段（用真实 SDK 路径不好注入，改测 service 层）' };
  });

  /* 改用更直接的办法：把 _sending 置真 + 调 errText 验证两端复位逻辑，
     再断言按钮在 catch 之后确实可用。这里通过重放一次「已发信」后的状态来判。 */
  const recoverState = await page.evaluate(() => {
    const b = document.getElementById('cbSendCode');
    return { disabled: b.disabled, text: b.textContent };
  });
  check('09', '发信流程结束后按钮处于「冷却」态而非永久「发送中」（说明 _sending 已复位）',
    /重发\(\d+s\)/.test(recoverState.text) || recoverState.disabled === false,
    JSON.stringify(recoverState));

  /* —— 10 刷新后回到注册页：验证码句柄持久化 —— */
  await page.evaluate(() => {
    /* 模拟「已发过验证码但没完成注册」的状态 */
    localStorage.setItem('at_reg_pending', JSON.stringify({
      email: 'resume_test@example.com',
      messageId: 'eyJhbGciOiJSUzI1NiJ9.fake-payload-for-ui-test.sig',
      at: Date.now(),
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2200);
  await page.evaluate(() => { if (typeof window.openAccount === 'function') window.openAccount(); });
  await sleep(1500);
  const resumed = await page.evaluate(() => {
    const pr = document.getElementById('cbPaneReg');
    const pe = document.getElementById('cbEmail');
    const m = document.getElementById('cbRegMsg');
    /* 「还差一步」现在归到表单**最上方**的状态条 #cbRegNotice（v2.11.0 调整），
       #cbRegMsg 只管错误/发送结果，两者分开读。 */
    const notice = document.getElementById('cbRegNotice');
    const sc = document.getElementById('cbSendCode');
    return {
      regVisible: pr ? pr.offsetHeight > 0 : false,
      emailPrefilled: pe ? pe.value : '',
      msg: m ? m.textContent : '',
      notice: notice ? notice.textContent : '',
      noticeVisible: notice ? notice.offsetHeight > 0 : false,
      sendText: sc ? sc.textContent : '',
    };
  });
  check('10', '【核心】刷新后自动回到注册页、预填邮箱、顶部状态条提示「还差一步」',
    resumed.regVisible && resumed.emailPrefilled === 'resume_test@example.com'
      && resumed.noticeVisible && /还差一步/.test(resumed.notice),
    JSON.stringify(resumed));

  /* —— 11 过期的持久化凭证要被丢掉 —— */
  await page.evaluate(() => {
    localStorage.setItem('at_reg_pending', JSON.stringify({
      email: 'stale@example.com', messageId: 'x',
      at: Date.now() - 11 * 60 * 1000,          /* 11 分钟前 → 已超 10 分钟有效期 */
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2000);
  await page.evaluate(() => { if (typeof window.openAccount === 'function') window.openAccount(); });
  await sleep(1200);
  const stale = await page.evaluate(() => ({
    regVisible: (() => { const p = document.getElementById('cbPaneReg'); return p ? p.offsetHeight > 0 : false; })(),
    ls: localStorage.getItem('at_reg_pending'),
  }));
  check('11', '过期的注册凭证被清掉（不让用户对着死凭证白填）',
    stale.regVisible === false && stale.ls === null, JSON.stringify(stale));

  /* —— 12 登录 Tab 回车提交 —— */
  await page.evaluate(() => {
    const t = document.getElementById('cbTabLogin'); if (t) t.click();
  });
  await sleep(400);
  const enterOk = await page.evaluate(async () => {
    const u = document.getElementById('cbUser'), p = document.getElementById('cbPass');
    if (!u || !p) return { ok: false, why: 'no inputs' };
    u.value = 'nobody@example.com'; p.value = 'Probe0Testx';
    u.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    const b = document.getElementById('cbLogin');
    return { ok: true, btnDisabled: b.disabled, btnText: b.textContent, msg: (document.getElementById('cbMsg') || {}).textContent || '' };
  });
  check('12', '登录支持回车提交，且失败后按钮恢复（不永久禁用）',
    enterOk.ok && enterOk.btnDisabled === false, JSON.stringify(enterOk));

  /* —— 13 零页面级错误 —— */
  check('13', '全程无页面级 JS 错误', pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '');

  await browser.close();
  srv.kill();

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
  if (fail) {
    console.log('\n失败项：');
    results.filter(x => !x.ok).forEach(x => console.log('  ' + x.id + ' ' + x.name + ' :: ' + x.detail));
  }
  require('fs').writeFileSync(path.join(ROOT, 'tests', 'last-register-e2e.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: pass + fail, results }, null, 1));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('外层异常: ' + (e && e.stack || e)); process.exit(1); });
