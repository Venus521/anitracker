const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');

const PY = 'C:/Users/Venus/.workbuddy/binaries/python/versions/3.13.12/python.exe';
const WORK = 'D:/项目/01_媒体娱乐/ani-tracker';

function probe() {
  return new Promise(res => {
    const req = http.get('http://127.0.0.1:8089/index.html', r => { r.resume(); res(true); });
    req.on('error', () => res(false));
    req.setTimeout(2000, () => { req.destroy(); res(false); });
  });
}

(async () => {
  let server = null;
  if (!(await probe())) {
    server = spawn(PY, ['-m', 'http.server', '8089', '--bind', '127.0.0.1', '--directory', WORK], { stdio: 'ignore' });
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 500)); if (await probe()) break; }
  }
  if (!(await probe())) { console.error('服务无法启动'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  const results = [];
  const ok = (n, c, extra) => results.push(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);

  const resp = await page.goto('http://127.0.0.1:8089/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  ok('页面返回 200', resp.status() === 200, 'HTTP ' + resp.status());
  await page.waitForTimeout(1500);

  const bodyLen = await page.evaluate(() => document.body.innerText.trim().length);
  ok('页面非空白', bodyLen > 150, '正文 ' + bodyLen + ' 字');

  const fatal = errors.filter(e => !/favicon|cloudbase|ERR_|net::|CORS/i.test(e));
  ok('无致命 JS 报错', fatal.length === 0, fatal.slice(0, 2).join(' | ') || '干净');

  const env = await page.evaluate(() => ({
    ver: window.AT_VERSION, bgm: window.BGMSYNC,
    dsCount: Object.keys(window.AFG_FILLER || {}).length,
    hasLoose: typeof fgLooseMatch === 'function',
    hasAfl: typeof fgFetchSlug === 'function'
  }));
  ok('BGMSYNC 已恢复', env.bgm === true, String(env.bgm));
  ok('数据集已加载(212部)', env.dsCount === 212, env.dsCount + ' 部');
  ok('松散匹配函数存在', env.hasLoose === true, '');
  ok('联网抓取函数存在', env.hasAfl === true, '');

  // 数据质量：柯南应能匹配到
  const conan = await page.evaluate(() => {
    try {
      const hit = fgLookupLocal({ title: '名侦探柯南', nameJp: 'Detective Conan' });
      return hit ? { slug: hit.slug, f: (hit.data.f || []).length, m: (hit.data.m || []).length } : null;
    } catch (e) { return { err: e.message }; }
  });
  ok('柯南能匹配到 TV原创', conan && conan.f > 500, conan ? `${conan.slug} 原创${conan.f}集` : '未匹配');

  // 打开同步中心
  const syncBtn = page.locator('button:has-text("同步")').first();
  if (await syncBtn.count()) {
    await syncBtn.click();
    await page.waitForTimeout(1000);
    const panelTxt = await page.evaluate(() => {
      const p = document.querySelector('.panel'); return p ? p.innerText : '';
    });
    ok('同步中心可打开', panelTxt.includes('同步中心'), '');
    ok('Bangumi 卡片已显示', /Bangumi/i.test(panelTxt), '');
    ok('代理指引文案存在', /代理没开|需要代理/.test(panelTxt), '');
  } else { ok('找到同步入口', false, ''); }

  // 来源校准 UI
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const srcUi = await page.evaluate(() => {
    return document.body.innerText.includes('隐藏') || document.body.innerText.includes('来源');
  });
  ok('来源筛选/校准入口存在', srcUi, '');

  // 诊断文案测试（模拟超时）
  const diag = await page.evaluate(() => {
    const e1 = { name: 'AbortError' };
    const e2 = { name: 'TypeError' };
    return {
      t1: netDiag(e1, '/subjects/253'),
      t2: netDiag(e2, 'https://api.bgm.tv/v0/subjects/253')
    };
  });
  ok('超时诊断可读', /代理/.test(diag.t1), diag.t1.slice(0, 40) + '…');
  ok('连不上诊断可读', /代理/.test(diag.t2), diag.t2.slice(0, 40) + '…');

  console.log('\n===== 实测结果 =====');
  results.forEach(r => console.log(r));
  console.log(`\n通过 ${results.filter(r => r.startsWith('✓')).length}/${results.length}`);
  if (errors.length) { console.log('\n--- 页面错误 ---'); errors.slice(0, 5).forEach(e => console.log(e)); }

  await browser.close();
  if (server) server.kill();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
