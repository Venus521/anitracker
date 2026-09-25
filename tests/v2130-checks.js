/* v2130-checks.js — v2.13.0 大修专项断言（安全收口 / 冲突合并 / 数据外置 / 主题弹窗 / SW 分层）
   用法：npm run test:v2130（自起静态服务 8096 + Chrome 无头） */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8096;
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' V' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 240)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ---- 文件级 ---- */
  const ib = fs.readFileSync(path.join(ROOT, 'index.html'));
  const ab = fs.readFileSync(path.join(ROOT, 'ani-tracker.html'));
  check('01', '双入口字节一致', ib.equals(ab), ib.length + 'B vs ' + ab.length + 'B');
  const ix = ib.toString('utf-8');
  check('02', 'esc() 已转义单引号', ix.includes(".replace(/'/g,'&#39;')"));
  check('03', '备份导出走 SECRET_KEY_RE 剔除', /function exportAllJSON\(\)\{[\s\S]{0,400}SECRET_KEY_RE\.test\(k\)/.test(ix));
  check('04', '导入走 backupSanitize 白名单', ix.includes('var s=backupSanitize(j.data||{})'));
  check('05', '删除路径落墓碑', ix.includes('tombPut(sidSnap)') && ix.includes('tombPut(sid);'));
  check('06', '全文无原生 confirm()/prompt() 调用残留',
    !/(^|[^.\w])(confirm|prompt)\(/.test(ix.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    (ix.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[^.\w])(confirm|prompt)\(/g) || []).slice(0, 3).join('|'));
  check('07', 'toast 挂 aria-live', ix.includes('<div id="toast" role="status" aria-live="polite">'));
  check('08', '数据集已外置（HTML 内无 649KB 单行）', ix.length < 500000 && /fetch\((['"])ani-tracker-lib\.json\1\)/.test(ix), 'size=' + ix.length);
  const sw = fs.readFileSync(path.join(ROOT, 'tracker-sw.js'), 'utf-8');
  check('09', 'SW v12：tracker-version.json 走 network-first、数据集预缓存',
    sw.includes('anitracker-v12') && /NETWORK_FIRST[^;]*tracker-version/.test(sw.replace(/\n/g, '')) && sw.includes('ani-tracker-lib.json'));
  const cs = fs.readFileSync(path.join(ROOT, 'cloudbase-sync.js'), 'utf-8');
  check('10', '云同步：packAll 共享凭证正则 + upload 先合后传', cs.includes('window.AT_BACKUP.secretRe') && cs.includes('await remoteAhead()'));
  check('11', '开机云合并已挂 load（sessionStorage 防循环）', cs.includes("at_cb_boot_done"));
  check('12', 'cloudbase SDK 本地兜底 + CDN onerror', ix.includes('vendor/cloudbase.full.js') && ix.includes('onerror'));

  /* ---- 浏览器级 ---- */
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  const waitPort = async () => {
    for (let i = 0; i < 30; i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true;
      await sleep(500);
    }
    return false;
  };
  if (!await waitPort()) { check('90', '静态服务未起', false, PORT); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let jsErrs = 0;
  try {
    const page = await browser.newPage();
    page.on('pageerror', () => jsErrs++);
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction('typeof AT_MERGE !== "undefined" && typeof backupSanitize !== "undefined"', { timeout: 10000 });

    /* 数据集懒加载 */
    const lib = await page.evaluate(async () => {
      await window.ANITRACKER_LIB_PROMISE;
      return { lib: window.ANITRACKER_LIB.length, internal: INTERNAL_SHOWS.length };
    });
    check('20', '懒加载数据集到达（302 部回填 INTERNAL_SHOWS）', lib.lib === 302 && lib.internal === 302, JSON.stringify(lib));

    /* 合并引擎单元断言（页面内直调） */
    const m = await page.evaluate(() => {
      const t0 = 1000;
      const A = { sid: 's1', title: '甲', updAt: t0, statuses: { 1: 'watched' }, hist: [{ t: t0, act: 'watched', ep: 1 }] };
      const Bx = { sid: 's2', title: '乙', updAt: t0, statuses: {} };
      const A2 = JSON.parse(JSON.stringify(A)); A2.statuses = { 1: 'watched', 2: 'watched' }; A2.updAt = t0 + 500;
      A2.hist = [{ t: t0, act: 'watched', ep: 1 }, { t: t0 + 400, act: 'watched', ep: 2 }];
      const B2 = JSON.parse(JSON.stringify(Bx)); B2.statuses = { 5: 'want' }; B2.updAt = t0 + 300;
      /* 双端各改各的：都保留 */
      const r1 = AT_MERGE.mergeShows([A2], [B2], {}, {});
      /* 同剧：新者赢 + hist 并集 */
      const r2 = AT_MERGE.mergeShows([A], [A2], {}, {});
      /* 墓碑：删除晚于修改 → 双端皆删 */
      const r3 = AT_MERGE.mergeShows([A], [A2], { s1: t0 + 900 }, {});
      /* 墓碑早于修改（删后重加）→ 存活 */
      const r4 = AT_MERGE.mergeShows([A], [A2], { s1: t0 - 10 }, {});
      const g = (r, sid) => r.list.find(x => x.sid === sid);
      return {
        both: r1.stats.onlyLocal === 1 && r1.stats.onlyCloud === 1,
        newerWins: !!g(r2, 's1') && Object.keys(g(r2, 's1').statuses).length === 2,
        histUnion: !!g(r2, 's1') && g(r2, 's1').hist.length === 2,
        tombDel: r3.stats.dropped === 1 && !g(r3, 's1'),
        readdSurvives: !!g(r4, 's1') && r4.stats.dropped === 0
      };
    });
    check('21', '合并：双端各改各的全保留', m.both);
    check('22', '合并：同剧 updAt 新者赢', m.newerWins);
    check('23', '合并：观看历史取并集', m.histUnion);
    check('24', '合并：删除墓碑传播生效', m.tombDel);
    check('25', '合并：删后重新添加存活', m.readdSurvives);

    /* sanitizer 拒收凭证 + sid 规整 */
    const s = await page.evaluate(() => {
      const r = backupSanitize({
        tr_shows: JSON.stringify([{ sid: "bad'><script>alert(1)</script>", title: 'x' }]),
        at_bgm_token: 'tok', at_net_relay: 'http://evil', credentials_x: 'c', device_id: 'd', tr_dav: '{}',
        at_theme: '"dark"', 'bad;k': 'x', 'at_ok': '1'
      });
      return { skipped: r.skipped.sort(), okKeys: Object.keys(r.ok).sort(), sid: JSON.parse(r.ok.tr_shows)[0].sid };
    });
    check('26', '导入拒收凭证/非法 key', ['at_bgm_token', 'at_net_relay', 'credentials_x', 'device_id', 'tr_dav'].every(k => s.skipped.includes(k)), JSON.stringify(s.skipped));
    check('27', '恶意 sid 被 safeSid 规整', !/[<>'"]/.test(s.sid), s.sid);
    check('28', '正常数据不误杀', s.okKeys.includes('at_theme') && s.okKeys.includes('at_ok') && s.okKeys.includes('tr_shows'));

    /* 搜索卡 id 校验（srItemHtml 注入口） */
    const xss = await page.evaluate(() => {
      const h = srItemHtml({ id: "1' onclick=alert(1) x='", name: 't', type: 2 });
      return { html: h.slice(0, 400), digitsOnly: /data-bgm="\d+"/.test(h) && !h.includes('x=') && !/<script/.test(h) };
    });
    check('29', 'srItemHtml 对畸形 id 做数字规整', xss.digitsOnly, xss.html.slice(0, 120));

    /* uiDialog：confirm 流 */
    const dlg = await page.evaluate(() => new Promise(res => {
      uiConfirm('测试确认', () => res('yes'));
      const b = document.querySelector('#uiDlgMask #udYes');
      res({ appeared: !!b, role: document.querySelector('#uiDlgMask .panel').getAttribute('role'), txt: document.querySelector('#uiDlgMask h3').textContent });
    }));
    check('30', 'uiConfirm 弹出主题弹窗（role=dialog）', dlg.appeared && dlg.role === 'dialog', JSON.stringify(dlg));
    await page.evaluate(() => { const b = document.querySelector('#uiDlgMask #udYes'); if (b) b.click(); });
    const gone = await page.evaluate(() => !document.getElementById('uiDlgMask'));
    check('31', '点确定后弹窗关闭并回调', gone);

    /* 错误留痕：手动 atErr */
    const el = await page.evaluate(() => { atErr('专项测试', new Error('boom')); return (JSON.parse(localStorage.getItem('at_errlog') || '[]') || []).slice(-1)[0]; });
    check('32', 'atErr 写入环形错误日志', el && el.w === '专项测试' && /boom/.test(el.m), JSON.stringify(el));

    check('33', '全程无页面级 JS 错误', jsErrs === 0, 'pageErrors=' + jsErrs);
  } catch (e) {
    check('99', '浏览器段异常', false, e.message);
  } finally {
    await browser.close();
    try { srv.kill(); } catch (e) {}
  }
  const fails = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(__dirname, 'last-v2130.json'), JSON.stringify({ at: new Date().toISOString(), pass: results.length - fails.length, fail: fails.length, results }, null, 2));
  console.log('==================================================');
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS');
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  - V' + f.id + ' ' + f.name + (f.detail ? ' [' + f.detail + ']' : ''))); process.exit(1); }
})();
