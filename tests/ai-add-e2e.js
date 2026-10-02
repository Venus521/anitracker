/* ai-add-e2e.js — 「问 AI 加片 / 让 AI 补新集」门禁（v2.18.0）
   为什么单独一个门禁：这条功能是「全网库搜不到中文老剧」的替代路（老友记在 TVMaze
   的条目库里 0 结果），它必须**完全离线**也能建出整条条目，所以这里一个真实请求都不发。
   喂进去的文本一律来自 tests/ai-add-fixture.js——提问模板（页面里给用户复制的那段）
   和解析器认同一套写法，夹具独立成文件是为了让两者对不上时测试先红。
   覆盖：解析器单元用例 → 建档落库（分季/双语集名/来源角标）→ 去重转并入 →
        增量补集的非破坏性（statuses 一个字节不许变）→ 面板真实点击回路
   用法：node tests/ai-add-e2e.js  ·  自起静态服务 8137 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const FX = require('./ai-add-fixture.js');
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 500) });
  console.log((ok ? 'PASS' : 'FAIL') + ' B' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 320)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const PORT = 8137;
  const PY = process.env.AT_PY || (function () {
    try { require('child_process').execSync('python -c ""', { stdio: 'ignore' }); return 'python'; } catch (e) {
      return String.raw`C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe`;
    }
  })();
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
  if (!(await waitPort(PORT, '/index.html', 30))) { console.log('FATAL: 静态服务未就绪'); process.exit(1); }

  let browser;
  const pageErrors = [];
  const netHits = [];
  /* 建档本身一律离线；唯一允许的出网是「加片后后台补封面」那条既有路（healCoverFor）。 */
  const NET_ALLOWED = /api\.tvmaze\.com|static\.tvmaze\.com|images\.tvmaze\.com|pics\.imdb\.com|via\.placeholder/;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      /* 离线用 DNS 层掐断（比 puppeteer 的请求拦截可靠：封面那条走 Service Worker，
         拦截器会抛 "Request Interception is not enabled"）。本地 127.0.0.1 除外。 */
      args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1000, deviceScaleFactor: 2 });
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));
    page.on('dialog', d => d.accept());
    page.on('request', req => {
      const u = req.url();
      if (u.startsWith('http://127.0.0.1:' + PORT) || u.startsWith('data:') || u.startsWith('blob:')) return;
      netHits.push(u.slice(0, 120));
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.AT270 && window.AT270.aiStdParse, { timeout: 15000 });

    /* ---------- B1 解析器：头部键值 + 两种集号写法 + 客套句 ---------- */
    const parsed = await page.evaluate(f => {
      const fP = window.AT270.aiStdParse(f.FRIENDS), aP = window.AT270.aiStdParse(f.ANIME);
      const pick = p => ({
        title: p.title, nameJp: p.nameJp, aliases: p.aliases, year: p.year, kind: p.kind,
        total: p.total, n: p.eps.length, seasons: p.seasons, ok: p.ok, note: p.note,
        first: p.eps[0], s3e1: p.eps.filter(e => e.sn === 3 && e.en === 1)[0],
        f: p.f, m: p.m, c: p.c, catHit: p.catHit
      });
      return { friends: pick(fP), anime: pick(aP) };
    }, { FRIENDS: FX.FRIENDS, ANIME: FX.ANIME });
    const fr = parsed.friends, an = parsed.anime;
    check('1', '老友记（真人剧/多季/中英双名）解析：头部全对、三季齐全、集号连编',
      fr.title === '老友记' && fr.nameJp === 'Friends' && fr.aliases.join('/') === '六人行/朋友' &&
      fr.year === '1994' && fr.kind === '真人剧' && fr.total === 73 && fr.n === 7 &&
      fr.seasons.join(',') === '1,2,3' && fr.first.s === 1 && fr.first.sn === 1 && fr.first.en === 1 &&
      fr.s3e1.s === 6 && fr.ok, JSON.stringify(fr));
    check('2', '双语集名分开落位（中文 tCn / 原文 tOrig），客套句与括号说明不入库',
      fr.first.tCn === '初来乍到' && /^The One Where Monica/.test(fr.first.tOrig) && !/以上为前三季/.test(JSON.stringify(fr)),
      JSON.stringify(fr.first));
    check('3', '动画（裸数字集号 + 区间分类段）：S01E0x 与「第N集」两种写法都认，分类段换算成整部连号',
      an.title === '迷宫饭' && an.kind === '动画' && an.n === 9 && an.total === 9 && an.catHit &&
      an.f.join(',') === '3,8,9' && an.m.join(',') === '5,6' && an.c.join(',') === '1,2,4,7' &&
      an.first.tCn === '吃莱欧斯还是吃法琳' && an.first.tOrig === "Who Made This? No. It's Not Us.",
      JSON.stringify({ f: an.f, m: an.m, c: an.c, first: an.first }));

    /* ---------- B3b 提问模板与解析器必须是同一套写法（格式契约） ---------- */
    const tpl = await page.evaluate(body => {
      const ask = window.AT270.aiAskAdd('老友记');
      const p = window.AT270.aiStdParse(ask);
      const upd = window.AT270.aiAskUpd({ title: '老友记', nameJp: 'Friends', eps: [{ s: 7, sn: 3, en: 2 }] });
      return {
        sameTail: ask === '请为《老友记》输出条目信息。\n\n' + body,
        selfParse: p.title === '中文名' && p.eps.length >= 2 && p.ok,
        updHasCtx: /我已经收录了 1 集，最后一集是 S03E02/.test(upd) && /还没收录的集/.test(upd) && /S01E01 中文标题/.test(upd),
        updSameTail: upd.indexOf(body) > 0
      };
    }, FX.ASK_FMT);
    check('3b', '格式契约：页面模板与夹具逐字一致，且模板自己就能被解析器认成条目',
      tpl.sameTail && tpl.selfParse && tpl.updHasCtx && tpl.updSameTail, JSON.stringify(tpl));

    /* ---------- B4 建档：面板点到底 → 条目真的落地 ---------- */
    await page.evaluate(() => showAdd());
    await sleep(300);
    const hasBtn = await page.evaluate(() => {
      const bs = Array.from(document.querySelectorAll('#vAdd .srcbar button'));
      return bs.some(b => /问 AI 加片/.test(b.textContent));
    });
    check('4', '添加视图的 srcbar 上有「问 AI 加片」入口', hasBtn);
    await page.evaluate(() => window.aiAdd());
    await page.waitForFunction(() => !!document.getElementById('at270StdMask'), { timeout: 6000 });
    await page.evaluate(fx => {
      const ta = document.getElementById('at270StdText');
      ta.value = fx;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, FX.FRIENDS);
    await page.waitForFunction(() => {
      const el = document.getElementById('at270StdPrev');
      return el && /老友记/.test(el.textContent) && !document.getElementById('at270StdGo').disabled;
    }, { timeout: 8000, polling: 100 });
    const prevCards = await page.evaluate(() => ({
      flds: Array.from(document.querySelectorAll('#at270StdPrev .fld')).map(f => f.textContent),
      tot: (document.querySelector('#at270StdPrev .aitot') || {}).textContent || '',
      note: (document.querySelector('#at270StdPrev .aiok') || {}).textContent || ''
    }));
    check('5', '粘贴即预览：字段色卡齐全 + 明说「只给了一部分集，还差 66 集」',
      /名称老友记/.test(prevCards.flds.join('|')) && /原文Friends/.test(prevCards.flds.join('|')) &&
      /总集数73/.test(prevCards.flds.join('|')) && /识别到 7 集 · 3 季/.test(prevCards.tot) &&
      /还差 66 集/.test(prevCards.tot) && /7 \/ 73 集/.test(prevCards.note), JSON.stringify(prevCards));
    await page.evaluate(() => document.getElementById('at270StdGo').click());
    await sleep(700);
    const built = await page.evaluate(() => {
      const s = (window.shows || []).filter(x => /老友记/.test(x.title))[0];
      if (!s) return null;
      return {
        sid: s.sid, title: s.title, nameJp: s.nameJp, aliases: s.aliases, year: s.year, kind: s.kind,
        total: s.total, eps: s.eps.length, parts: (s.parts || []).map(p => p.key + ':' + p.eps),
        srcOn: s.eps.filter(e => e.src).length, inDetail: document.getElementById('vDetail').style.display !== 'none',
        maskGone: !document.getElementById('at270StdMask')
      };
    });
    check('6', '入库建成整条条目：多季自动切分、集表 7 集、真人剧不被安上来源角标',
      !!built && built.total === 73 && built.eps === 7 && built.parts.join(',') === 'S1:3,S2:2,S3:2' &&
      built.srcOn === 0 && built.inDetail && built.maskGone, JSON.stringify(built));

    /* ---------- B7 详情页的「让 AI 补新集」入口 ---------- */
    const updBtn = await page.evaluate(() => {
      const b = document.getElementById('btnAiUpd');
      return !!b && b.offsetParent !== null && /补新集/.test(b.textContent);
    });
    check('7', '详情页有「让 AI 补新集」入口（就在 AI 结果导入旁边）', updBtn);

    /* ---------- B8 先记已看进度，再增量贴同一批 + 新集 ---------- */
    const before = await page.evaluate(() => {
      const s = (window.shows || []).filter(x => /老友记/.test(x.title))[0];
      s.statuses = { 1: 'watched', 2: 'watched', 3: 'rewatch' };
      s.eps[1].src = 'filler'; s.eps[1].srcNote = '我自己核对的';   /* 人工标注：补集不许覆盖 */
      save();
      return { n: s.eps.length, st: JSON.stringify(s.statuses), e2: s.eps[1].src + '/' + s.eps[1].srcNote };
    });
    const MORE = [
      '名称: 老友记',
      '原文: Friends',
      '年份: 1994',
      '类型: 真人剧',
      '总集数: 73',
      'S01E01 初来乍到 | The One Where Monica Gets a Roommate',   /* 已有：应跳过 */
      'S01E02 办公室约会',                                        /* 已有：集名不补（原文已存在） */
      'S02E03 抱抱狼 | The One with the Bullies',                 /* 新增 */
      'S03E05 卡普金姆的课 | The One with the Ultimate Fighting Champion',  /* 新增 */
      'S04E01 拉斯维加斯（上） | The One at Monica\'s Birthday'    /* 新季 */
    ].join('\n');
    await page.evaluate(() => window.aiUpd());
    await page.waitForFunction(() => !!document.getElementById('at270StdMask'), { timeout: 6000 });
    await page.evaluate(t => {
      const ta = document.getElementById('at270StdText');
      ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, MORE);
    await page.waitForFunction(() => {
      const el = document.getElementById('at270StdPrev');
      return el && /新增/.test(el.textContent);
    }, { timeout: 8000, polling: 100 });
    const dryTxt = await page.evaluate(() => (document.querySelector('#at270StdPrev .aitot') || {}).textContent || '');
    await page.evaluate(() => document.getElementById('at270StdGo').click());
    await sleep(700);
    const after = await page.evaluate(() => {
      const s = (window.shows || []).filter(x => /老友记/.test(x.title))[0];
      return {
        n: s.eps.length, st: JSON.stringify(s.statuses), e2: s.eps[1].src + '/' + s.eps[1].srcNote,
        parts: (s.parts || []).map(p => p.key + ':' + p.eps), total: s.total,
        newEps: s.eps.slice(7).map(e => e.s + '|S' + e.sn + 'E' + e.en + '|' + e.t),
        maskGone: !document.getElementById('at270StdMask')
      };
    });
    check('8', '预览先报账：新增 3 · 补名 0 · 已有跳过（点之前就知道会发生什么）',
      /新增\s*3/.test(dryTxt) && /跳过\s*2/.test(dryTxt), dryTxt);
    check('9', '增量补集非破坏：只追加缺的集号，已看进度与人工标注一个字节没动',
      after.n === 10 && after.st === before.st && after.e2 === before.e2 && after.total === 73 &&
      after.newEps.join(' / ') === '8|S2E3|抱抱狼 / 9|S3E5|卡普金姆的课 / 10|S4E1|拉斯维加斯（上）' &&
      after.parts.join(',') === 'S1:3,S2:3,S3:3,S4:1' && after.maskGone,
      JSON.stringify({ before: before, after: after }));

    /* ---------- B10 同名再来一次 → 转「并入」而不是静默丢弃 ---------- */
    await page.evaluate(() => { try { backList(); } catch (e) {} });
    await sleep(200);
    const AGAIN = [
      '名称: 老友记',
      '原文: Friends',
      '别名: 六人行 / 朋友 / 老友记 第六季',
      '总集数: 73',
      'S01E01 初来乍到 | The One Where Monica Gets a Roommate',
      'S05E23 拉斯维加斯（下） | The One at Monica\'s Birthday',
      '原创: 1'   /* 真人剧不该有这一段：出现了也只当参考，且不能覆盖人工标注 */
    ].join('\n');
    await page.evaluate(() => window.aiAdd());
    await page.waitForFunction(() => !!document.getElementById('at270StdMask'), { timeout: 6000 });
    await page.evaluate(t => {
      const ta = document.getElementById('at270StdText');
      ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, AGAIN);
    await page.waitForFunction(() => {
      const el = document.getElementById('at270StdPrev');
      return el && /还差 71 集/.test(el.textContent) && !document.getElementById('at270StdGo').disabled;
    }, { timeout: 8000, polling: 100 });
    await page.evaluate(() => document.getElementById('at270StdGo').click());
    await page.waitForFunction(() => !!document.getElementById('udYes'), { timeout: 6000 });
    const asked = await page.evaluate(() => {
      const m = document.querySelector('#uiDlgMask .mini');
      return (m || {}).textContent || '';
    });
    await page.evaluate(() => document.getElementById('udYes').click());
    await sleep(900);
    const merged = await page.evaluate(() => {
      const hit = (window.shows || []).filter(x => /老友记/.test(x.title));
      const s = hit[0] || {};
      return {
        count: hit.length, n: (s.eps || []).length, st: JSON.stringify(s.statuses),
        e2: ((s.eps || [])[1] || {}).src + '/' + ((s.eps || [])[1] || {}).srcNote,
        last: (s.eps || []).slice(-1).map(e => e.s + '|S' + e.sn + 'E' + e.en + '|' + e.t)[0],
        aliases: s.aliases || [], inDetail: document.getElementById('vDetail').style.display !== 'none'
      };
    });
    check('10', '重复粘贴不静默丢弃：弹确认后并进同一条（新增 1 集，进度与人工标注不动）',
      /片单里已有/.test(asked) && merged.count === 1 && merged.n === 11 &&
      merged.st === '{"1":"watched","2":"watched","3":"rewatch"}' && merged.e2 === 'filler/我自己核对的' &&
      merged.last === '11|S5E23|拉斯维加斯（下）' && /老友记 第六季/.test(merged.aliases.join('/')) && merged.inDetail,
      JSON.stringify({ asked: asked.slice(0, 30), after: merged }));

    /* ---------- B11 建档时带来的分类段要落成角标 ---------- */
    const animeBuilt = await page.evaluate(fx => {
      const t = fx.ANIME.replace('名称: 迷宫饭', '名称: 迷宫饭测试');
      window.aiAdd();
      return new Promise(res => setTimeout(() => {
        const ta = document.getElementById('at270StdText');
        ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          document.getElementById('at270StdGo').click();
          setTimeout(() => {
            const s = (window.shows || []).filter(x => /迷宫饭测试/.test(x.title))[0];
            if (!s) return res(null);
            res({
              kind: s.kind, n: s.eps.length,
              flags: s.eps.map(e => e.s + ':' + (e.src || '-') + ':' + (e.srcNote || '')),
              axis: s.filler + '/' + s.mixed
            });
          }, 900);
        }, 600);
      }, 400));
    }, { ANIME: FX.ANIME });
    check('11', '动画建档：来源角标随条目落地（3/8/9 原创、5/6 半原创、其余漫改，依据写 AI 导入）',
      !!animeBuilt && animeBuilt.kind === '动画' && animeBuilt.n === 9 &&
      animeBuilt.flags.join(' ') === '1:canon:AI 导入 2:canon:AI 导入 3:filler:AI 导入 4:canon:AI 导入 5:semi:AI 导入 6:semi:AI 导入 7:canon:AI 导入 8:filler:AI 导入 9:filler:AI 导入' &&
      animeBuilt.axis === '3,8-9/5-6', JSON.stringify(animeBuilt));

    /* ---------- B12 贴错了不放行 ---------- */
    await page.evaluate(() => { try { backList(); } catch (e) {} });
    await sleep(200);
    await page.evaluate(() => window.aiAdd());
    await page.waitForFunction(() => !!document.getElementById('at270StdText'), { timeout: 6000 });
    await page.evaluate(() => {
      const ta = document.getElementById('at270StdText');
      ta.value = '随便一句 unrelated 话';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('at270StdPrev');
      return el && /什么都没认出来/.test(el.textContent);
    }, { timeout: 8000, polling: 100 });
    const emptyGuard = await page.evaluate(() => {
      const r = {
        disabled: document.getElementById('at270StdGo').disabled,
        txt: document.getElementById('at270StdPrev').textContent,
        hasAskBtn: !!document.getElementById('at270StdAsk'),
        fmtShown: document.getElementById('at270StdFmtBox').style.display
      };
      document.getElementById('at270StdAsk').click();      /* 没填剧名也不该崩，给个提示 */
      r.askMsg = document.getElementById('at270StdMsg').textContent;
      document.getElementById('at270StdFmt').click();
      r.fmtOpen = document.getElementById('at270StdFmtBox').style.display;
      document.getElementById('at270StdX').click();
      r.gone = !document.getElementById('at270StdMask');
      return r;
    });
    check('12', '贴错了不放行：禁用入库 + 说明原因；「看格式」可展开；× 能关',
      emptyGuard.disabled && /什么都没认出来/.test(emptyGuard.txt) && emptyGuard.hasAskBtn &&
      emptyGuard.fmtShown === 'none' && emptyGuard.fmtOpen !== 'none' && emptyGuard.gone,
      JSON.stringify(emptyGuard));
    /* ---------- B13 集名语言规则（v2.23.0，用户指令「中国的给中国集名，外国的要双语」） ---------- */
    const lang = await page.evaluate(f => {
      const cn = window.AT270.aiStdParse(f.CN);
      const half = window.AT270.aiStdParse(f.HALF);
      return {
        region: cn.region, isCn: cn.isCn, cnNote: cn.langNote || '',
        cnNames: cn.eps.map(e => (e.tCn || '') + '/' + (e.tOrig || '')).join(' '),
        halfIsCn: half.isCn, halfNote: half.langNote || ''
      };
    }, { CN: FX.ANIME_CN, HALF: FX.FRIENDS_NO_ORIG });
    check('13', '产地中国 → 集名只留中文（AI 顺手给的英文被剥掉）；外国条目缺原文 → 当场提醒补双语',
      lang.region === '中国' && lang.isCn === true && /产地中国/.test(lang.cnNote) &&
      lang.cnNames === '拜师/ 下山/ 夺宝/ 结丹/' && lang.halfIsCn === false && /双语集名/.test(lang.halfNote),
      JSON.stringify(lang));

    /* ---------- B14 粘贴内容用完即清（v2.23.0，用户指令「粘贴完自动删掉，下次别再删一遍」） ---------- */
    await page.evaluate(() => { try { backList(); } catch (e) {} });
    await sleep(200);
    await page.evaluate(() => window.aiAdd());
    await page.waitForFunction(() => !!document.getElementById('at270StdText'), { timeout: 6000 });
    await page.evaluate(t => {
      const ta = document.getElementById('at270StdText');
      ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, FX.ANIME_CN.replace('名称: 凡人修仙传', '名称: 凡人修仙传测试'));
    await page.waitForFunction(() => {
      const el = document.getElementById('at270StdPrev');
      return el && /凡人修仙传测试/.test(el.textContent) && !document.getElementById('at270StdGo').disabled;
    }, { timeout: 8000, polling: 100 });
    await page.evaluate(() => document.getElementById('at270StdGo').click());
    await sleep(900);
    const cleared = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('at_ai_std_draft') || '{}');
      return {
        draftKeys: Object.keys(d).join(','),
        built: !!(window.shows || []).filter(x => /凡人修仙传测试/.test(x.title))[0]
      };
    });
    await page.evaluate(() => window.aiAdd());
    await page.waitForFunction(() => !!document.getElementById('at270StdText'), { timeout: 6000 });
    const reopened = await page.evaluate(() => {
      const ta = document.getElementById('at270StdText');
      const reopenVal = ta.value;
      ta.value = '名称: 临时';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('at270StdClr').click();
      const afterClr = ta.value;
      document.getElementById('at270StdX').click();
      return { reopenVal: reopenVal, afterClr: afterClr };
    });
    check('14', '入库即清：草稿不再残留，重开面板输入框是空的；「清空」按钮也能手动抹掉',
      cleared.built && cleared.draftKeys === '' && reopened.reopenVal === '' && reopened.afterClr === '',
      JSON.stringify({ cleared: cleared, reopened: reopened }));

    /* ---------- B15 封面直链（v2.24.0，用户反馈「上错花轿嫁对郎这类中文剧怎么都没封面」） ---------- */
    const cov = await page.evaluate(f => {
      const p = window.AT270.aiStdParse(f.C);
      const item = window.AT270.aiStdBuild(p);
      return {
        coverUrl: p.coverUrl, itemCover: item.cover, isCn: p.isCn, region: p.region, n: p.eps.length,
        names: p.eps.map(e => (e.tCn || '') + '/' + (e.tOrig || '')).join(' ')
      };
    }, { C: FX.DRAMA_CN_COVER });
    check('15', '中文剧的封面直链能落进条目（全网库查不到的剧不再注定没封面）',
      /^https:\/\//.test(cov.coverUrl) && cov.itemCover === cov.coverUrl && cov.isCn === true &&
      cov.region === '中国' && cov.n === 2 && cov.names === '抛绣球/ 错嫁/', JSON.stringify(cov));

    const off = netHits.filter(u => !NET_ALLOWED.test(u));
    check('16', '识别/建档/补集不出网（唯一允许的出网是后台补封面）', off.length === 0, off.slice(0, 4).join(' | '));
    check('17', '全程无页面级 JS 错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  } catch (e) {
    console.log('FATAL: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }

  const fails = results.filter(r => !r.ok);
  console.log('SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS' +
    (fails.length ? ' :: FAILED: ' + fails.map(r => 'B' + r.id).join(',') : ''));
  fs.writeFileSync(path.join(__dirname, 'last-ai-add.json'), JSON.stringify({ at: new Date().toISOString(), results: results }, null, 2));
  process.exitCode = fails.length ? 1 : 0;
})();
