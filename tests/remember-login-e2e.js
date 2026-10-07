/* tests/remember-login-e2e.js —— 「记住登录状态和密码」门禁（v2.42.0）
   用户令：「登录之后记住登录状态和密码」。

   这个功能出事的方式很特别：**它不出错，只是悄悄失效**。
   密码存下来了但没被导出剔除 → 备份包里躺着明文；退出了但没清 → 「退出登录」变成假按钮；
   自动登录跑在开机合并之后 → 登录态补上了，云端那份却永远合不进来。
   所以这里一条条钉死：
     R01 存了能取回（id 与密码原样）
     R02 落盘的是密文：localStorage 里搜不到密码原文
     R03 用的 key 在 SECRET_KEY_RE 里：不进备份包、不上云（这条最要紧）
     R04 清除后 load/peek 都是 null
     R05 登录面板有「记住登录状态和密码」，且默认勾上
     R06 记住过再开面板：邮箱和密码都被填回去（密码框仍是 password 类型）
     R07 退出登录那条路上真的调了 rememberClear（静态断言：登出不清 = 刷新又登回去）
     R08 无页面级 JS 错误

   量具纪律：出网一律拦掉。CloudBase 的 getSession / signIn 在本机测试环境里连不通，
   不拦的话每次都要等超时，且失败文案会飘；拦掉后失败是确定的、瞬时的。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (ok ? '' : '  :: ' + String(detail).slice(0, 320)));
  ok ? pass++ : fail++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function probe(port) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/index.html', timeout: 1500 },
      (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}
const ID = 'someone@example.com';
const PWD = 'Zq7-vault-door-9931';

(async () => {
  const PORT = 8157;
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT),
    '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) { if (await probe(PORT)) { up = true; break; } await sleep(500); }
  if (!up) { srv.kill(); console.error('FAIL 本机服务没起来（:' + PORT + '）'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 180)));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (/^https?:\/\/127\.0\.0\.1/.test(u) || /^data:/.test(u)) return req.continue();
      return req.abort();   /* 不让 CloudBase 真出网：失败要确定且瞬时 */
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);
    await sleep(4000);   /* 等启动自愈那一轮跑完 */

    /* ---------- R01 / R02 / R03 / R04：存储层 ---------- */
    const st = await page.evaluate(async (id, pwd) => {
      const R = window.AT_REMEMBER;
      if (!R) return { err: 'AT_REMEMBER 没导出' };
      R.clear();
      const okSave = await R.save(id, pwd);
      const back = await R.load();
      /* 落盘密文里不许出现密码原文（也不许出现邮箱原文） */
      const dumps = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^credentials_/.test(k)) dumps.push(k + '=' + localStorage.getItem(k));
      }
      const plain = dumps.join('|');
      const peek = R.peek();
      /* 导出剔除：index.html 的 SECRET_KEY_RE 必须认这两个 key */
      const reOk = ['credentials_at_login', 'credentials_at_login_key'].every(k => window.SECRET_KEY_RE.test(k));
      R.clear();
      const afterLoad = await R.load();
      const afterPeek = R.peek();
      return {
        okSave, idOk: !!(back && back.id === id), pwdOk: !!(back && back.pass === pwd),
        noPlain: plain.indexOf(pwd) < 0 && plain.indexOf(id) < 0,
        reOk, peekOk: !!(peek && peek.has === true),
        cleared: afterLoad === null && afterPeek === null
      };
    }, ID, PWD);
    check('R01', '存了能取回：id 与密码原样回来', st.okSave === true && st.idOk === true && st.pwdOk === true, JSON.stringify(st));
    check('R02', '落盘是密文：localStorage 里搜不到密码原文', st.noPlain === true, JSON.stringify(st));
    check('R03', 'key 命中 SECRET_KEY_RE：不进备份包、不上云', st.reOk === true, JSON.stringify(st));
    check('R04', '清除后 load/peek 都是 null', st.cleared === true, JSON.stringify(st));

    /* ---------- R05：面板上有勾选框且默认勾上 ---------- */
    const box = await page.evaluate(() => {
      try { if (window.AT_REMEMBER) window.AT_REMEMBER.clear(); } catch (e) {}
      openAccount();
      const el = document.getElementById('cbRemember');
      return el ? { exists: true, checked: el.checked, label: (el.closest('label') || {}).textContent || '' } : { exists: false };
    });
    await sleep(1200);
    const box2 = await page.evaluate(() => {
      const el = document.getElementById('cbRemember');
      return el ? { exists: true, checked: el.checked, label: (el.closest('label') || {}).textContent || '' } : { exists: false };
    });
    check('R05', '登录面板有「记住登录状态和密码」，且默认勾上',
      box2.exists === true && box2.checked === true && /记住登录状态和密码/.test(box2.label), JSON.stringify(box2));

    /* 关掉 R05 那块面板。**必须单独一步、并留出时间**：
       弹层是受返回键对账管着的（index.html 的 AT_LAYERS），「关闭」会补一次 history 回退；
       若在同一拍里关掉又立刻开新的，那次异步回退落地时关的是**新开的**那一层
       ——实测新面板会在 2 秒内自己消失，看着像功能坏了，其实是量具把两个动作挤在了一起。
       真实用户不会同一毫秒内关了又开，所以这是量具的用法问题，不是产品 bug。 */
    await page.evaluate(() => { try { window.__closeSync && window.__closeSync(); } catch (e) {} });
    await sleep(900);

    /* ---------- R06：记住过 → 开面板自动填回 ---------- */
    const fill = await page.evaluate(async (id, pwd) => {
      await window.AT_REMEMBER.save(id, pwd);
      let errOpen = '';
      try { openAccount(); } catch (e) { errOpen = String(e && e.message || e); }
      const immediate = !!document.getElementById('syncMask');
      await new Promise(r => setTimeout(r, 2500));
      const iu = document.getElementById('cbUser'), ip = document.getElementById('cbPass');
      const rm = document.getElementById('cbRemember');
      const area = document.getElementById('cbArea');
      return {
        id: iu ? iu.value : '', pwd: ip ? ip.value : '', type: ip ? ip.type : '', checked: rm ? rm.checked : null,
        hasMask: !!document.getElementById('syncMask'),
        area: area ? String(area.innerHTML).slice(0, 220) : '(no cbArea)',
        peek: window.AT_REMEMBER.peek(),
        errOpen: errOpen, immediate: immediate
      };
    }, ID, PWD);
    check('R06', '记住过再开面板：邮箱/密码被填回，且密码框仍是 password 类型',
      fill.id === ID && fill.pwd === PWD && fill.type === 'password' && fill.checked === true, JSON.stringify(fill));

    /* ---------- R09：真正走一次「点登录按钮」（v2.44.4）----------
       R01~R06 全都直接调 AT_REMEMBER.save() 这个 API —— 也就是**绕过真实入口**。
       真实用户是「填表单→ 点登录按钮」，而 doAuth 里存凭据那一步是有条件的：
       `if (rm && rm.checked) await rememberSave(...)`。
       一旦那条路上的条件/时序有问题（v2.44.4 查到的正是：登录失败就不存），
       R01~R06 全绿而用户就是「每次都要重填」。
       这条断言从**清空状态**起步、点真实的登录按钮、看密文有没有落盘——
       **登录成功或失败都算数**（失败也该存，见 doAuth 的 v2.44.4 改动）。 */
    await page.evaluate(() => { try { window.AT_REMEMBER && window.AT_REMEMBER.clear(); } catch (e) {} });
    await sleep(500);
    await page.evaluate(() => { try { window.__closeSync && window.__closeSync(); } catch (e) {} });
    await sleep(700);
    const viaBtn = await page.evaluate(async (id, pwd) => {
      try { openAccount(); } catch (e) {}
      await new Promise(r => setTimeout(r, 1500));
      const iu = document.getElementById('cbUser'), ip = document.getElementById('cbPass');
      const btn = document.getElementById('cbLogin'), rm = document.getElementById('cbRemember');
      if (!iu || !ip || !btn) return { err: '登录控件缺失' };
      iu.value = id; ip.value = pwd;
      if (rm) rm.checked = true;
      btn.click();                       /* 真实点击，走 doAuth 那条路 */
      await new Promise(r => setTimeout(r, 2500));
      const peek = window.AT_REMEMBER.peek();
      const back = await window.AT_REMEMBER.load();
      return {
        存上了: !!localStorage.getItem('credentials_at_login'),
        peekHas: !!(peek && peek.has),
        读回账号: back ? back.id : '',
        读回密码对: back ? back.pass === pwd : false
      };
    }, ID, PWD);
    check('R09', '从清空起步、真点「登录」按钮，凭据真的落盘（不再只测 API那条路）',
      viaBtn.存上了 && viaBtn.peekHas && viaBtn.读回账号 === ID && viaBtn.读回密码对,
      JSON.stringify(viaBtn));

    /* ---------- R10：清完之后状态自洽（别存成半截）---------- */
    const after = await page.evaluate(async () => {
      window.AT_REMEMBER.clear();
      const p = window.AT_REMEMBER.peek();
      const l = await window.AT_REMEMBER.load();
      return { peek: p, load: l, 密文: !!localStorage.getItem('credentials_at_login'), 密钥: !!localStorage.getItem('credentials_at_login_key') };
    });
    check('R10', 'clear 之后 peek/load 皆 null（不留半截凭据）',
      after.peek === null && after.load === null && !after.密文 && !after.密钥, JSON.stringify(after));

    /* ---------- R07：退出登录真的清掉（静态断言）---------- */
    const src = fs.readFileSync(path.join(ROOT, 'cloudbase-sync.js'), 'utf8');
    const iOut = src.indexOf("#cbOut'");
    const seg = iOut >= 0 ? src.slice(iOut, iOut + 420) : '';
    check('R07', '退出登录那条路上调了 rememberClear（不清 = 刷新又自动登回去）',
      /rememberClear\(\)/.test(seg), seg.slice(0, 200));

    /* ---------- R08：无页面级 JS 错误 ---------- */
    check('R08', '无页面级 JS 错误', errs.length === 0, errs.join(' | '));

    console.log('SUMMARY ' + pass + '/' + (pass + fail));
    require('fs').writeFileSync(path.join(__dirname, 'last-remember-login.json'),
      JSON.stringify({ pass, fail, ts: Date.now() }, null, 2));
    if (fail) process.exitCode = 1;
  } finally {
    try { await browser.close(); } catch (e) {}
    srv.kill();
  }
})();
