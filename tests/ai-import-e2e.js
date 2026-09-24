/* ai-import-e2e.js — 「AI 结果导入」端到端测试
   v2.10.1：面板重做 —— 粘贴即自动识别（不再需要「预览识别」按钮），
   结果改为分类色卡；断言同步更新。
   覆盖：解析器单元用例 + 详情页真实交互（打开面板 → 粘贴 → 预览 → 写入 → 集级生效）
   用法：node tests\ai-import-e2e.js  ·  自起静态服务 8094 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require(String.raw`C:\Users\Venus\.openclaw-autoclaw\workspace\.cluster\bangumi-tracker\app-test\node_modules\puppeteer-core`);
const ROOT = path.resolve(__dirname, '..');
const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 400) });
  console.log((ok ? 'PASS' : 'FAIL') + ' A' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const PORT = 8096;
  const PY = String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '600'], { stdio: 'ignore', detached: false });
  const waitPort = async (port, file, tries) => {
    for (let i = 0; i < (tries || 30); i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port, path: file, timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false));
        req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true;
      await sleep(500);
    }
    return false;
  };
  const up = await waitPort(PORT, '/index.html', 30);
  if (!up) { console.log('FATAL: 静态服务未就绪'); process.exit(1); }

  let browser, pageErrors = 0;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    page.on('pageerror', e => { pageErrors++; console.log('  [pageerror]', String(e.message || e).slice(0, 160)); });
    page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (u.includes('api.bgm.tv')) { req.abort(); return; }          /* 本测试不依赖网络 */
      req.continue();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1200);

    /* ---------- A1 解析器单元用例（直接调 AT270.aiParse） ---------- */
    const unit = await page.evaluate(() => {
      const cases = [
        ['1-10集为漫改，11-15集是TV原创，16集半原创', [11,12,13,14,15], [16], [1,2,3,4,5,6,7,8,9,10]],
        ['TV原创：11-15, 23, 45-47', [11,12,13,14,15,23,45,46,47], [], []],
        ['1,2,3集是原创', [1,2,3], [], []],
        ['ep1-5 manga canon, ep6 filler', [6], [], [1,2,3,4,5]],
        ['第12集：TV原创\n第13集：漫改\n第20-22集：半原创', [12], [20,21,22], [13]],
        ['原创：45-47 半原创：50', [45,46,47], [50], []],
        ['第 1、2、3 集是原创；第4集漫改', [1,2,3], [], [4]],
        ['1~5集漫改', [], [], [1,2,3,4,5]]
      ];
      const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      const bad = [];
      cases.forEach(([txt, F, M, C]) => {
        const r = window.AT270.aiParse(txt);
        if (!eq(r.filler, F) || !eq(r.mixed, M) || !eq(r.canon, C)) {
          bad.push(txt + ' → F' + JSON.stringify(r.filler) + ' M' + JSON.stringify(r.mixed) + ' C' + JSON.stringify(r.canon));
        }
      });
      return { total: cases.length, bad: bad };
    });
    check('1', '解析器单元用例全通过（' + unit.total + ' 例）', unit.bad.length === 0, unit.bad.join(' | '));

    /* ---------- A2 混乱输入：能认几条认几条 + 回报没懂 ---------- */
    const mixed = await page.evaluate(() => {
      const r = window.AT270.aiParse('柯南的TV原创集有11-15集。\nTV原创的其他几集我记不清了。\n画质很好，推荐观看。');
      return { f: r.filler, unk: r.unknownLines, hits: r.hitCount };
    });
    check('2', '含糊输入：认得部分 + 列出没懂的（纯叙述不误报）',
      mixed.f.length === 5 && mixed.unk.length === 1 && /记不清/.test(mixed.unk[0]), JSON.stringify(mixed));

    /* ---------- A3 建条目 → 打开面板 → 粘贴 → 预览 → 写入 ---------- */
    await page.evaluate(() => {
      /* 造一条 26 集的本地条目并进入详情页 */
      const s = { sid: 'ai-test-1', title: 'AI导入测试番', nameJp: 'AIテスト', cover: '', year: '2026',
        total: 26, eps: [], statuses: {}, status: 'watching', addedAt: Date.now(), updAt: Date.now(), source: '手动添加', manual: 1 };
      for (let i = 1; i <= 26; i++) s.eps.push({ s: i, t: '第 ' + i + ' 集' });
      window.shows.push(s);
      save();
      openDetail('ai-test-1');
    });
    await sleep(600);
    const btnExists = await page.evaluate(() => !!document.getElementById('btnAiPaste'));
    check('3', '详情页出现「AI 结果导入」入口', btnExists);

    await page.evaluate(() => document.getElementById('btnAiPaste').click());
    await sleep(400);
    const maskOpen = await page.evaluate(() => !!document.getElementById('at270AiMask'));
    check('4', '粘贴面板可打开', maskOpen);

    /* v2.10.1：填内容后【不需要点任何按钮】，防抖自动识别 */
    await page.evaluate(() => {
      const ta = document.getElementById('at270AiText');
      ta.value = '1-10集为漫改，11-15集是TV原创，16集半原创，17-26集漫改。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('at270AiPrev');
      return el && /TV原创/.test(el.textContent);
    }, { timeout: 6000, polling: 100 }).catch(() => {});
    await sleep(200);
    const prevTxt = await page.evaluate(() => document.getElementById('at270AiPrev').textContent);
    const applyEnabled = await page.evaluate(() => { const b = document.getElementById('at270AiApply'); return b && !b.disabled; });
    const prevBtns = await page.evaluate(() => !!document.getElementById('at270AiPrevBtn'));
    /* 用卡片结构断言，别依赖 textContent 的拼接细节（"半原创161 集" 这种） */
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('#at270AiPrev .aicat')).map(c => ({
      label: (c.querySelector('.lbl') || {}).textContent || '',
      range: (c.querySelector('.range') || {}).textContent || '',
      cnt: (c.querySelector('.cnt') || {}).textContent || ''
    })));
    const byLabel = {};
    cards.forEach(c => { byLabel[c.label] = c; });
    check('5', '粘贴即自动识别（无需点按钮）：三类色卡齐全、集号与集数正确，写入按钮自动启用',
      prevBtns === false && applyEnabled &&
      !!byLabel['TV原创'] && byLabel['TV原创'].range === '11-15' && byLabel['TV原创'].cnt === '5 集' &&
      !!byLabel['半原创'] && byLabel['半原创'].range === '16' && byLabel['半原创'].cnt === '1 集' &&
      !!byLabel['漫改'] && byLabel['漫改'].range === '1-10,17-26' && byLabel['漫改'].cnt === '20 集',
      JSON.stringify(cards) + ' | applyEnabled=' + applyEnabled);

    /* 写入 */
    await page.evaluate(() => document.getElementById('at270AiApply').click());
    await sleep(700);
    const after = await page.evaluate(() => {
      const s = bySid('ai-test-1');
      const q = n => { const e = s.eps.filter(x => x.s === n)[0]; return { src: e.src, note: e.srcNote }; };
      return { ep5: q(5), ep12: q(12), ep16: q(16), ep20: q(20), maskGone: !document.getElementById('at270AiMask'),
               filler: s.filler, mixed: s.mixed, stored: !!window.AT270.aiPasteFor(s) };
    });
    check('6', '写入成功：11-15→TV原创、16→半原创、其余→漫改',
      after.ep5.src === 'canon' && after.ep12.src === 'filler' && after.ep16.src === 'semi' && after.ep20.src === 'canon' && after.maskGone,
      JSON.stringify(after));
    check('7', '汇总串与 AI 库已落盘', after.filler === '11-15' && after.mixed === '16' && after.stored, 'filler=' + after.filler + ' mixed=' + after.mixed + ' stored=' + after.stored);

    /* ---------- A4 集级来源显示为「AI 导入」 ---------- */
    const basis = await page.evaluate(() => {
      const s = bySid('ai-test-1');
      const e = s.eps.filter(x => x.s === 12)[0];
      return { info: srcInfoOf(s, e), text: srcBasisText(s, e), byText: srcByText('ai') };
    });
    check('8', '集级来源显示「AI 导入」依据', basis.info.by === 'ai' && basis.byText === 'AI 导入' && /AI 导入/.test(basis.text), JSON.stringify(basis).slice(0, 200));

    /* ---------- A5 尊重人工手改：先手标再用 AI 导入，手标不被覆盖 ---------- */
    const manual = await page.evaluate(() => {
      const s = bySid('ai-test-1');
      const e = s.eps.filter(x => x.s === 20)[0];
      e.src = 'filler'; e.srcNote = '我自己核对的'; e.srcAt = Date.now() + 999999;  /* 时间戳在未来 → 明确是后手改的 */
      save();
      /* 再跑一次 AI 导入（内容把 20 判为漫改） */
      window.AT270.aiPaste(s);
      return null;
    });
    await sleep(400);
    await page.evaluate(() => {
      const ta = document.getElementById('at270AiText');
      ta.value = '11-15集TV原创，16集半原创，其余漫改。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('at270AiPrev');
      return el && /TV原创/.test(el.textContent);
    }, { timeout: 6000, polling: 100 }).catch(() => {});
    await sleep(200);
    await page.evaluate(() => document.getElementById('at270AiApply').click());
    await sleep(700);
    const kept = await page.evaluate(() => {
      const s = bySid('ai-test-1');
      const e = s.eps.filter(x => x.s === 20)[0];
      return { src: e.src, note: e.srcNote };
    });
    check('9', '不覆盖真正的「人工标注」（第20集保持 TV原创）', kept.src === 'filler' && kept.note === '我自己核对的', JSON.stringify(kept));

    /* ---------- A6 超范围集号不写入 ---------- */
    const oob = await page.evaluate(() => {
      const s = bySid('ai-test-1');
      window.AT270.aiPaste(s);
      return null;
    });
    await sleep(400);
    await page.evaluate(() => {
      const ta = document.getElementById('at270AiText');
      ta.value = '1-5集TV原创，900-905集TV原创。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('at270AiPrev');
      return el && /超出本作范围/.test(el.textContent);
    }, { timeout: 6000, polling: 100 }).catch(() => {});
    await sleep(200);
    const warn = await page.evaluate(() => document.getElementById('at270AiPrev').textContent);
    /* v2.10.1：文案由「超出本作集数」改为「超出本作范围」 */
    check('10', '超范围集号给出提示且不写入', /超出本作范围/.test(warn), warn.slice(0, 200));
    await page.evaluate(() => { const x = document.getElementById('at270AiX'); if (x) x.click(); });
    await sleep(200);

    /* ---------- A7 清除已存 AI 结果 ---------- */
    const cleared = await page.evaluate(() => {
      const s = bySid('ai-test-1');
      const had = !!window.AT270.aiPasteFor(s);
      window.AT270.aiPasteClear(s);
      return { had: had, now: !!window.AT270.aiPasteFor(s) };
    });
    check('11', '可清除已存 AI 结果', cleared.had && !cleared.now, JSON.stringify(cleared));

    check('12', '全程无页面级 JS 错误', pageErrors === 0, 'pageErrors=' + pageErrors);

  } catch (e) {
    console.log('FATAL: ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }

  const fails = results.filter(r => !r.ok);
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS' + (fails.length ? ' :: FAILED: ' + fails.map(r => 'A' + r.id).join(',') : ''));
  fs.writeFileSync(path.join(__dirname, 'last-ai-import.json'), JSON.stringify({ at: new Date().toISOString(), results: results }, null, 2));
  process.exitCode = fails.length ? 1 : 0;
})();
