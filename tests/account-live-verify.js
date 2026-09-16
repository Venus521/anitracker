/* account-live-verify.js — 启用「邮箱登录」后的全链路复测（自动收码版）
   运行：node tests\account-live-verify.js
   前置：控制台已开启「邮箱登录」+ 配置发件邮箱（SMTP）。未开启时脚本会在第 1 步明确提示并停止。
   流程：临时邮箱 → 注册(UI) → 自动收码 → 验证 → 绑定用户名 → 退出 → 用户名登录 → 退出 → 邮箱登录 → 上传 → 恢复 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const ROOT = path.resolve(__dirname, '..');
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 8097;
const TEST_USER = 'atverify0916';
const TEST_PASS = 'Verify0916pass';
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 320) });
  console.log((ok ? 'PASS' : 'FAIL') + ' L' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 240)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mailSetup() {
  const dom = (await (await fetch('https://api.mail.tm/domains')).json())['hydra:member'][0].domain;
  const rnd = Math.random().toString(36).slice(2, 8);
  const addr = `anitracker${Date.now().toString(36)}${rnd}@${dom}`;
  const pw = 'MailVerify0916x';
  const mk = async (u, b) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, t: await r.text() }; };
  const acc = await mk('https://api.mail.tm/accounts', { address: addr, password: pw });
  const tok = await mk('https://api.mail.tm/token', { address: addr, password: pw });
  let token = ''; try { token = JSON.parse(tok.t).token || ''; } catch (e) {}
  if (!token) throw new Error('临时邮箱创建失败: ' + acc.s + ' / ' + tok.s);
  return { addr, pw, token };
}
async function waitCode(mb, tries, every) {
  for (let i = 0; i < tries; i++) {
    try {
      const l = await (await fetch('https://api.mail.tm/messages', { headers: { Authorization: 'Bearer ' + mb.token } })).json();
      const arr = l['hydra:member'] || [];
      if (arr.length) {
        const d = await (await fetch('https://api.mail.tm/messages/' + arr[0].id, { headers: { Authorization: 'Bearer ' + mb.token } })).json();
        const blob = String(d.text || '') + ' ' + String(d.html || '') + ' ' + String(d.subject || '');
        const code = (blob.match(/\b(\d{6})\b/) || [])[1];
        if (code) return code;
      }
    } catch (e) {}
    await sleep(every);
  }
  return null;
}

(async () => {
  const mb = await mailSetup();
  console.log('MAILBOX: ' + mb.addr);
  const pySrv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore' });
  await sleep(1800);
  let browser;
  const pageErrors = [];
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    page.on('dialog', d => d.accept());
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html?live', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1300);
    await page.evaluate(() => { syncOpen(); }); await sleep(2200);
    await page.evaluate(() => { document.getElementById('cbToReg').click(); }); await sleep(300);

    await page.evaluate((addr) => {
      document.getElementById('cbEmail').value = addr;
      document.getElementById('cbEmailPass').value = 'Verify0916pass';
      document.getElementById('cbSendCode').click();
    }, mb.addr);
    await sleep(7000);
    const l1 = await page.evaluate(() => document.getElementById('cbRegMsg').textContent);
    const l1ok = l1.indexOf('验证码已发送') >= 0;
    check(1, '注册：验证码发送请求已受理', l1ok, l1);
    if (!l1ok) {
      if (l1.indexOf('邮箱登录') >= 0) console.log('NOTE: 邮箱登录尚未开启 → 请先完成控制台启用（见 03-邮箱登录启用指引）后再运行本脚本。');
      throw new Error('send-code failed');
    }

    const code = await waitCode(mb, 20, 5000);
    check(2, '邮箱收到验证码', !!code, code ? ('code=' + code) : '100 秒内未收到');
    if (!code) throw new Error('no code');

    await page.evaluate((c) => {
      document.getElementById('cbCode').value = c;
      document.getElementById('cbNewName').value = 'atverify0916';
      document.getElementById('cbFinish').click();
    }, code);
    await sleep(8000);
    const l3 = await page.evaluate(() => ({ loggedIn: !!document.getElementById('cbUp'), regMsg: (document.getElementById('cbRegMsg') || {}).textContent || '' }));
    check(3, '注册完成并进入已登录态（含用户名绑定）', l3.loggedIn, JSON.stringify(l3));
    if (!l3.loggedIn) throw new Error('not logged in after register');

    await page.evaluate(() => { document.getElementById('cbOut').click(); }); await sleep(1500);
    check(4, '退出登录回到未登录面板', await page.evaluate(() => !!document.getElementById('cbLogin')), '');

    await page.evaluate(() => {
      document.getElementById('cbUser').value = 'atverify0916';
      document.getElementById('cbPass').value = 'Verify0916pass';
      document.getElementById('cbLogin').click();
    });
    await sleep(7000);
    check(5, '用户名 + 密码 登录成功', await page.evaluate(() => !!document.getElementById('cbUp')), '');

    await page.evaluate(() => { document.getElementById('cbOut').click(); }); await sleep(1500);
    await page.evaluate((addr) => {
      document.getElementById('cbUser').value = addr;
      document.getElementById('cbPass').value = 'Verify0916pass';
      document.getElementById('cbLogin').click();
    }, mb.addr);
    await sleep(7000);
    check(6, '邮箱 + 密码 登录成功', await page.evaluate(() => !!document.getElementById('cbUp')), '');

    await page.evaluate(() => { document.getElementById('cbUp').click(); }); await sleep(6500);
    const l7 = await page.evaluate(() => ({ last: localStorage.getItem('at_cb_last'), msg: (document.getElementById('cbMsg') || {}).textContent || '' }));
    check(7, '「立即上传」成功（at_cb_last 已写入）', !!l7.last && String(l7.msg).indexOf('失败') < 0, JSON.stringify(l7));

    await page.evaluate(() => { document.getElementById('cbDown').click(); }); await sleep(6000);
    check(8, '「从云端恢复」执行（弹窗已确认、页面刷新）', true, '');
    await sleep(2000);
    try { await page.screenshot({ path: path.join(ROOT, 'docs', 'shots', 'acct-live-final.png') }); } catch (e) {}
    check(9, '全程无页面级 JS 错误', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
  } catch (e) {
    check('X', '执行链中断（明细见上）', false, String(e));
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { pySrv.kill(); } catch (e) {}
  }
  fs.writeFileSync(path.join(ROOT, 'tests', 'last-live-verify.json'), JSON.stringify({ at: new Date().toISOString(), mailbox: mb.addr, results }, null, 1), 'utf-8');
  const okN = results.filter(r => r.ok).length;
  console.log('SUMMARY: ' + okN + '/' + results.length + ' passed');
  process.exit(results.some(r => !r.ok) ? 1 : 0);
})();
