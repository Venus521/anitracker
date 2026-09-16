/* account-e2e.js — 追迹账号注册/登录链路专项测试（v2.6.1）
   用法：node tests\account-e2e.js · 自起静态服务 8095
   覆盖：注册/登录 UI、本地校验、云端未开启邮箱登录时的指引+外链、台账记录、版本一致性 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const ROOT = path.resolve(__dirname, '..');
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 8095;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 320) });
  console.log((ok ? 'PASS' : 'FAIL') + ' T' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 240)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const pySrv = spawn('python', [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  await sleep(1800);
  let browser;
  const pageErrors = [];
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html?acct', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1300);

    const ver = await page.evaluate(() => ({ a: (typeof AT_VERSION !== 'undefined') ? AT_VERSION : null, cb: (window.CBSync && CBSync.version) || null }));
    check('01', '版本一致（页面 2.7.0；CBSync 模块已加载）', ver.a === '2.7.0' && /^2\./.test(ver.cb || ''), JSON.stringify(ver));

    await page.evaluate(() => { syncOpen(); });
    await sleep(2400);

    const t02 = await page.evaluate(() => ({
      hasArea: !!document.getElementById('cbArea'),
      hasUser: !!document.getElementById('cbUser'),
      hasLogin: !!document.getElementById('cbLogin'),
      hasToReg: !!document.getElementById('cbToReg')
    }));
    check('02', '账号面板渲染（登录视图 + 注册入口）', t02.hasArea && t02.hasUser && t02.hasLogin && t02.hasToReg, JSON.stringify(t02));

    await page.evaluate(() => { document.getElementById('cbToReg').click(); });
    await sleep(350);
    const t03 = await page.evaluate(() => ({
      regVisible: document.getElementById('cbRegBox') && document.getElementById('cbRegBox').style.display !== 'none',
      hasEmail: !!document.getElementById('cbEmail'),
      hasCode: !!document.getElementById('cbCode'),
      hasSend: !!document.getElementById('cbSendCode'),
      hasFinish: !!document.getElementById('cbFinish')
    }));
    check('03', '注册视图展开（邮箱/验证码/完成按钮）', t03.regVisible && t03.hasEmail && t03.hasCode && t03.hasSend && t03.hasFinish, JSON.stringify(t03));

    await page.evaluate(() => { document.getElementById('cbEmail').value = 'not-an-email'; document.getElementById('cbEmailPass').value = 'Diag0916pass'; document.getElementById('cbSendCode').click(); });
    await sleep(350);
    const t04 = await page.evaluate(() => document.getElementById('cbRegMsg').textContent);
    check('04', '非法邮箱被本地拦截', t04.indexOf('邮箱') >= 0, t04);

    await page.evaluate(() => { document.getElementById('cbEmail').value = 'acct-e2e-0916@uberip.com'; document.getElementById('cbEmailPass').value = '12345678'; document.getElementById('cbSendCode').click(); });
    await sleep(350);
    const t05 = await page.evaluate(() => document.getElementById('cbRegMsg').textContent);
    check('05', '弱密码被本地拦截（需字母+数字）', t05.indexOf('8–32') >= 0 || t05.indexOf('字母') >= 0, t05);

    await page.evaluate(() => { document.getElementById('cbEmailPass').value = 'Diag0916pass'; document.getElementById('cbSendCode').click(); });
    await sleep(8000);
    const t06 = await page.evaluate(() => {
      const m = document.getElementById('cbRegMsg');
      const a = m ? m.querySelector('a') : null;
      return { text: m ? m.textContent : '', href: a ? a.getAttribute('href') : '', target: a ? a.getAttribute('target') : '' };
    });
    const offOk = t06.text.indexOf('邮箱登录') >= 0 && t06.href && t06.href.indexOf('tcb.cloud.tencent.com') >= 0;
    const onOk = t06.text.indexOf('验证码已发送') >= 0;
    check('06', '发送验证码 → 未开启态给中文指引+控制台外链（或已开启态发码）', offOk || onOk, JSON.stringify({ state: offOk ? 'provider-off' : (onOk ? 'enabled' : 'unknown'), text: t06.text.slice(0, 140), href: t06.href, target: t06.target }));
    try { await page.screenshot({ path: path.join(ROOT, 'docs', 'shots', 'acct-reg-off.png') }); } catch (e) {}

    const t07 = await page.evaluate(() => {
      try { const all = JSON.parse(localStorage.getItem('at_sync_log') || '[]'); const auths = all.filter(x => x.kind === 'auth'); return { total: all.length, auths: auths.slice(-3).map(x => ({ t: x.title, ok: x.ok })) }; } catch (e) { return { err: String(e) }; }
    });
    check('07', '注册尝试写入同步台账（kind=auth）', t07.auths && t07.auths.length >= 1, JSON.stringify(t07.auths || t07));

    await page.evaluate(() => {
      document.getElementById('cbUser').value = 'nobody-0916@uberip.com';
      document.getElementById('cbPass').value = 'Diag0916pass';
      document.getElementById('cbLogin').click();
    });
    await sleep(6000);
    const t08 = await page.evaluate(() => (document.getElementById('cbMsg') ? document.getElementById('cbMsg').textContent : ''));
    check('08', '不存在账号登录 → 中文错误提示', /不正确|不存在|未注册/.test(t08), t08);

    const t09 = await page.evaluate(() => ({
      ledger: !!document.getElementById('syLedger'),
      local: document.getElementById('syncMask').textContent.indexOf('本地备份') >= 0
    }));
    check('09', '同步中心其他区块完好', t09.ledger && t09.local, JSON.stringify(t09));
    check('10', '无页面 JS 错误', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
  } catch (e) {
    check('99', '测试执行异常', false, String(e));
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { pySrv.kill(); } catch (e) {}
  }
  fs.writeFileSync(path.join(ROOT, 'tests', 'last-account-test.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1), 'utf-8');
  const okN = results.filter(r => r.ok).length;
  console.log('SUMMARY: ' + okN + '/' + results.length + ' passed');
  process.exit(okN === results.length ? 0 : 1);
})();
