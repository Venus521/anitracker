/* E2E-1: 标注/筛选/编辑器/批量补齐/回归 —— 无头 Chrome */
const path = require('path');
const fs = require('fs');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const BASE = 'http://127.0.0.1:8091/index.html';
const SHOTS = String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.openclaw\tmp\build\shots`;
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (extra ? ('  ' + extra) : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=460,1000']
  });
  let failed = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    const consoleErrors = [], pageErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.evaluate(() => {
      const now = Date.now();
      const plain = n => { const a = []; for (let i = 1; i <= n; i++) a.push({ s: i, t: '第' + i + '集' }); return a; };
      const shows = [
        { sid: '901', bgmId: '901', title: '测试混合番', nameJp: 'TestMix', year: '2020', total: 12, status: 'watching',
          type: 'manga-adapt', statuses: { 1: 'watched', 2: 'watched' },
          hist: [{ t: now - 9000, act: 'watched', ep: 1 }, { t: now - 5000, act: 'watched', ep: 2 }],
          filler: '3,6-8', mixed: '4', fgAt: now, fgUrl: 'https://example.com/',
          eps: [
            { s: 1, t: '第1集' }, { s: 2, t: '第2集', type: 'canon' }, { s: 3, t: '原创特别篇 【动画原创】' },
            { s: 4, t: '半原创过渡集', type: 'semi' }, { s: 5, t: '第5集' }, { s: 6, t: '第6集' }, { s: 7, t: '第7集' },
            { s: 8, t: '第8集' }, { s: 9, t: '第9集' }, { s: 10, t: '第10集' }, { s: 11, t: '第11集' }, { s: 12, t: '第12集' }
          ] },
        { sid: '902', bgmId: '902', title: '测试未校准番', total: 12, status: 'watching', type: 'manga-adapt', statuses: {}, eps: plain(12) },
        { sid: '903', title: '测试纯原创番', total: 6, status: 'watching', type: 'tv-original', statuses: { 1: 'watched' }, eps: plain(6) },
        { sid: '904', title: '死神', total: 20, status: 'watching', type: 'manga-adapt', statuses: {}, eps: plain(20) }
      ];
      localStorage.setItem('tr_shows', JSON.stringify(shows));
      localStorage.removeItem('at_srcmig3');
      localStorage.removeItem('at_hide_src');
      localStorage.removeItem('at_sync_log');
      localStorage.setItem('tr_seeded', '1');
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(400);

    // 1. 迁移
    const mig = await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const A = shows.find(s => s.sid === '901');
      return {
        hasCanonType: A.eps.some(e => e.type === 'canon'),
        ep2type: (A.eps.find(e => e.s === 2) || {}).type || null,
        semiKept: (A.eps.find(e => e.s === 4) || {}).type
      };
    });
    ok('迁移：canon 默认值被清除', mig.hasCanonType === false && mig.ep2type === null, JSON.stringify(mig));
    ok('迁移：semi 显式值保留', mig.semiKept === 'semi');

    // 2. 筛选条
    const barText = await page.$eval('#srcBar', el => el.textContent);
    ok('来源筛选条存在', barText.includes('隐藏 TV原创') && barText.includes('批量补齐来源'));

    // 3. 列表覆盖信息
    const listText = await page.$eval('#list', el => el.textContent);
    ok('列表含覆盖信息', /原作/.test(listText) && /未判定/.test(listText));
    await page.screenshot({ path: path.join(SHOTS, 'e2e-01-list.png') });

    // 4. 打开混合番详情
    const openShow = async (title) => {
      await page.evaluate((t) => {
        const rows = [...document.querySelectorAll('#list .show')];
        const r = rows.find(x => x.textContent.includes(t));
        r.querySelector('.info').click();
      }, title);
      await sleep(300);
    };
    const back = async () => { await page.evaluate(() => document.querySelector('#vDetail .back').click()); await sleep(180); };

    await openShow('测试混合番');
    const det1 = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('#dGroups .eprow .ty')].map(x => x.textContent),
      cov: document.querySelector('#dSrcCov').textContent,
      next: document.querySelector('#nextBtn').textContent
    }));
    ok('详情标签混用可见', det1.chips.includes('原作改编') && det1.chips.includes('TV原创') && det1.chips.includes('半原创'), JSON.stringify(det1.chips.slice(0, 8)));
    ok('来源覆盖行正确', det1.cov.includes('原作 7') && det1.cov.includes('TV原创 4') && det1.cov.includes('半原创 1'), det1.cov);
    ok('下一集默认=第3集', det1.next.includes('第 3 集'), det1.next);
    await page.screenshot({ path: path.join(SHOTS, 'e2e-02-detail.png') });

    // 5. 编辑器：ep9 改为 TV原创
    const clickChip = async (n) => {
      await page.evaluate((n2) => {
        const rows = [...document.querySelectorAll('#dGroups .eprow')];
        const r = rows.find(x => x.querySelector('.no').textContent.trim() === String(n2));
        r.querySelector('.ty').click();
      }, n);
      await sleep(300);
    };
    await clickChip(9);
    ok('标注编辑器打开', !!(await page.$('#srcEditMask')));
    await page.screenshot({ path: path.join(SHOTS, 'e2e-03-editor.png') });
    await page.evaluate(() => {
      [...document.querySelectorAll('#seOps .srcopt')].find(b => b.textContent === 'TV原创').click();
      document.querySelector('#seSave').click();
    });
    await sleep(250);
    const afterEdit = await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const A = shows.find(s => s.sid === '901');
      const e9 = A.eps.find(e => e.s === 9);
      const rows = [...document.querySelectorAll('#dGroups .eprow')];
      const r9 = rows.find(x => x.querySelector('.no').textContent.trim() === '9');
      return { src: e9.src, chip9: r9.querySelector('.ty').textContent };
    });
    ok('手动标注写入 e.src', afterEdit.src === 'filler', JSON.stringify(afterEdit));
    ok('标签即时更新为 TV原创', afterEdit.chip9 === 'TV原创');
    // 恢复自动
    await clickChip(9);
    await page.evaluate(() => {
      [...document.querySelectorAll('#seOps .srcopt')].find(b => b.textContent === '未判定').click();
      document.querySelector('#seSave').click();
    });
    await sleep(250);
    const afterClr = await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const A = shows.find(s => s.sid === '901');
      return { src: A.eps.find(e => e.s === 9).src || null };
    });
    ok('编辑器恢复自动（清除人工标注）', afterClr.src === null);

    // 6. 隐藏 TV原创（列表操作），再查详情
    await back();
    await page.evaluate(() => { [...document.querySelectorAll('#srcBar .srcchip')].find(c => c.textContent.includes('隐藏 TV原创')).click(); });
    await sleep(180);
    await openShow('测试混合番');
    const hid1 = await page.evaluate(() => ({
      note: (document.querySelector('#dGroups .srchint') || {}).textContent || '',
      next: document.querySelector('#nextBtn').textContent,
      cov: document.querySelector('#dSrcCov').textContent
    }));
    ok('隐藏TV原创：提示行=已隐藏4集', hid1.note.includes('已隐藏 4 集'), hid1.note);
    ok('隐藏TV原创：下一集=第4集', hid1.next.includes('第 4 集'), hid1.next);

    // 7. 再隐藏半原创 → 持久化 → 双重断言
    await back();
    await page.evaluate(() => { [...document.querySelectorAll('#srcBar .srcchip')].find(c => c.textContent.includes('隐藏 半原创')).click(); });
    await sleep(180);
    await page.reload({ waitUntil: 'networkidle2' });
    const hidPersist = await page.evaluate(() => [...document.querySelectorAll('#srcBar .srcchip')].filter(c => c.classList.contains('on')).map(c => c.textContent.trim()));
    ok('筛选状态刷新后保留', hidPersist.length === 2, JSON.stringify(hidPersist));
    await openShow('测试混合番');
    const hid2 = await page.evaluate(() => ({
      note: (document.querySelector('#dGroups .srchint') || {}).textContent || '',
      next: document.querySelector('#nextBtn').textContent,
      stats: [...document.querySelectorAll('#dStats .stat')].map(s => s.textContent.replace(/\s+/g, ' ')),
      status3: (() => { const A = JSON.parse(localStorage.getItem('tr_shows') || '[]').find(s => s.sid === '901'); return A.statuses['3'] || null; })()
    }));
    ok('双重隐藏：已隐藏5集', hid2.note.includes('已隐藏 5 集'), hid2.note);
    ok('双重隐藏：下一集=第5集', hid2.next.includes('第 5 集'), hid2.next);
    ok('统计按可见集（已看2/未看5）', hid2.stats[0].includes('2') && hid2.stats[2].includes('5'), JSON.stringify(hid2.stats));
    ok('被隐藏≠已看（第3集保持未标记）', hid2.status3 === null);
    await page.screenshot({ path: path.join(SHOTS, 'e2e-04-detail-hidden.png') });

    // 8. 一键恢复
    await back();
    await page.evaluate(() => { [...document.querySelectorAll('#srcBar .srcchip')].find(c => c.textContent.includes('恢复全部显示')).click(); });
    await sleep(180);
    const restored = await page.evaluate(() => [...document.querySelectorAll('#srcBar .srcchip')].filter(c => c.classList.contains('on')).length);
    ok('一键恢复显示全部', restored === 0);

    // 9. 未校准番 & 纯原创番标签
    await openShow('测试未校准番');
    const bChips = await page.evaluate(() => [...new Set([...document.querySelectorAll('#dGroups .eprow .ty')].map(x => x.textContent))]);
    ok('未校准番：全部未判定', bChips.length === 1 && bChips[0] === '未判定', JSON.stringify(bChips));
    await back();
    await openShow('测试纯原创番');
    const cChips = await page.evaluate(() => [...new Set([...document.querySelectorAll('#dGroups .eprow .ty')].map(x => x.textContent))]);
    ok('纯原创番：全部TV原创', cChips.length === 1 && cChips[0] === 'TV原创', JSON.stringify(cChips));
    await back();

    // 10. 批量补齐（死神 → AFG 命中）
    await page.evaluate(() => { batchCalibrateAll(); });
    await sleep(1600);
    const cal = await page.evaluate(() => {
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const D = shows.find(s => s.sid === '904');
      return { filler: D.filler || '', report: !!localStorage.getItem('at_src_report'), modal: !!document.getElementById('srcRepMask') };
    });
    ok('批量补齐：AFG 命中写入', cal.filler.includes('32'), cal.filler.slice(0, 40));
    ok('批量补齐：报告已生成', cal.report === true);
    ok('批量补齐：报告弹窗展示', cal.modal === true);
    await page.screenshot({ path: path.join(SHOTS, 'e2e-05-report.png') });
    await page.evaluate(() => { if (window.__closeSrcRep) __closeSrcRep(); });

    // 11. 回归：搜索视图/返回/历史保留
    const reg = await page.evaluate(() => {
      showAdd();
      const addVisible = document.getElementById('vAdd').style.display !== 'none';
      backList();
      const shows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      const A = shows.find(s => s.sid === '901');
      return { addVisible, histLen: (A.hist || []).length, listVisible: document.getElementById('vList').style.display !== 'none' };
    });
    ok('回归：添加页可打开/返回', reg.addVisible === true && reg.listVisible === true);
    ok('回归：历史记录保留(2条)', reg.histLen === 2, JSON.stringify(reg));

    // console 错误汇总（favicon 404 忽略）
    const realErr = consoleErrors.filter(t => !/favicon|net::ERR_FAILED.*cloudbase|static\.cloudbase/.test(t));
    console.log('\nconsole errors:', JSON.stringify(consoleErrors.slice(0, 10)));
    console.log('page errors:', JSON.stringify(pageErrors.slice(0, 10)));
    ok('无页面级 JS 错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
  } catch (e) {
    console.log('E2E-1 EXCEPTION:', e && (e.stack || e.message || e));
    results.push({ name: 'exception', pass: false, extra: String(e && (e.message || e)) });
  } finally {
    await browser.close();
  }
  failed = results.filter(r => !r.pass).length;
  fs.writeFileSync(path.join(SHOTS, 'e2e1-results.json'), JSON.stringify(results, null, 1));
  console.log('\n==== E2E-1 SUMMARY: ' + (results.length - failed) + '/' + results.length + ' passed ====');
  process.exit(failed ? 1 : 0);
})();
