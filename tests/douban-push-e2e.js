/* douban-push-e2e.js — 「推送（追迹 → 豆瓣）」门禁（v2.31.0）
   为什么单独一个门禁：v2.30.0 只做了「拉」，方向单一、判定好写；v2.31.0 加了「推」——
   同一张勾选清单要能反过来当写回清单用，于是多出一堆只属于写方向的语义：
     · 够不够格推（没豆瓣号 / 还没进片单 → 推不了，必须明说而不是静默跳过）
     · 推什么状态（片单状态 → 豆瓣口径；映射错一个字就写到别的意思上）
     · 没勾的一条都不许推（写回比入库更危险，误写会真的改掉豆瓣账号里的东西）
     · 失败必须报出来（半推成功要说清推了几条、没推几条）
   一个真实请求都不发：网关用 page.route 替身。替身刻意模拟「回读不通过」这一支，
   因为写回最大的坑就是「POST 没报错但没写进去」，这一支不测就等于没测。
   用法：node tests/douban-push-e2e.js  ·  自起静态服务 8139
   v2.34.0 修量具：豆瓣行显示名自 v2.33.0 起按剧名铁律拼成双语，凡按身份取数改用 subjectId；
   并加 P00 自检——某步勾中 0 条直接红，不再伪装成「推送坏了」。 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail).slice(0, 500) });
  console.log((ok ? 'PASS' : 'FAIL') + ' P' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 320)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
/* 替身侧的「豆瓣现状」：subjectId → 当前站内状态。
   9001 豆瓣在看、9002 豆瓣在看、9003 豆瓣看过、9004 豆瓣想看。
   片单侧则刻意跟豆瓣不一样（见 SEED），这样推的方向才真的存在，不是空跑。 */
let DB_NOW = { 9001: 'do', 9002: 'do', 9003: 'collect', 9004: 'wish' };
const FIX = [
  { subjectId: '9001', title: '测试剧·在看A', origTitle: 'TEST A', year: '2024', genres: ['动画'], isAnime: true, rating: null, markedAt: '2026-08-26', pic: PX, status: 'do', ep: 0 },
  { subjectId: '9002', title: '测试剧·在看B', origTitle: '', year: '2023', genres: ['剧情'], isAnime: false, rating: 8, markedAt: '2026-09-01', pic: '', status: 'do', ep: 5 },
  { subjectId: '9003', title: '测试剧·看过C', origTitle: '', year: '2022', genres: ['动画'], isAnime: true, rating: null, markedAt: '2026-07-15', pic: '', status: 'collect', ep: 0 },
  { subjectId: '9004', title: '测试剧·想看D', origTitle: '', year: '2025', genres: [], isAnime: false, rating: null, markedAt: '2026-06-05', pic: '', status: 'wish', ep: 0 },
  { subjectId: '9100', title: '没进片单的一部', origTitle: '', year: '2020', genres: [], isAnime: false, rating: null, markedAt: '2026-05-05', pic: '', status: 'wish', ep: 0 }
];
/* seed：片单里每条的状态都跟豆瓣那边**刻意不一致**，推的方向因此真实存在：
   9001 片单「看过」而豆瓣「在看」→ 推过去豆瓣应变看过
   9003 片单「在看」而豆瓣「看过」→ 反向差异，验双向都推得动
   9004 片单「在看」而豆瓣「想看」
   9002 两侧都是「在看」→ 推它是空操作，验「本来就是」不被算成改动 */
const SEED = [
  { sid: 'db9001', title: '测试剧·在看A', dbId: '9001', year: '2024', total: 0, eps: [], statuses: {}, status: 'done', source: '豆瓣·动画', addedAt: 1, updAt: 1 },
  { sid: 'db9002', title: '测试剧·在看B', dbId: '9002', year: '2023', total: 0, eps: [], statuses: {}, status: 'watching', source: '豆瓣·真人', addedAt: 1, updAt: 1 },
  { sid: 'db9003', title: '测试剧·看过C', dbId: '9003', year: '2022', total: 0, eps: [], statuses: {}, status: 'watching', source: '豆瓣·动画', addedAt: 1, updAt: 1 },
  { sid: 'db9004', title: '测试剧·想看D', dbId: '9004', year: '2025', total: 0, eps: [], statuses: {}, status: 'watching', source: '豆瓣·真人', addedAt: 1, updAt: 1 }
];

(async () => {
  const PORT = 8139;
  const PY = process.env.AT_PY || 'python';
  const srv = spawn(PY, [path.join(ROOT, '服务器-空闲自退.py'), '--port', String(PORT), '--host', '127.0.0.1', '--dir', ROOT, '--idle', '300'], { stdio: 'ignore' });
  const waitPort = async () => {
    for (let i = 0; i < 40; i++) {
      const up = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 1500 }, x => { x.resume(); res(true); });
        req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (up) return true;
      await sleep(400);
    }
    return false;
  };
  if (!(await waitPort())) { console.log('FATAL: 静态服务未就绪'); process.exit(1); }

  let browser;
  const pageErrors = [], netOut = [], markCalls = [], dbData = [];
  const H = { 'Access-Control-Allow-Origin': '*' };
  /* 让某一类 subjectId 回读不通过：模拟「POST 成功但没写进去」，这是写回最典型的失败 */
  let failVerifyFor = null;
  /* 切到 true 就模拟「豆瓣把写通道整个封了」——2026-10-06 实测就是这个局面 */
  let WRITE_BLOCKED = false;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 980, height: 1180, deviceScaleFactor: 1 });
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (u.indexOf('localhost:3000') >= 0) {
        /* 带 JSON body 的 POST 会先发 CORS 预检（OPTIONS）。替身不接预检的话，
           浏览器把响应判成跨域失败 → 页面只看到一句「Failed to fetch」，
           推送看起来像坏了，其实是量具少接了这一次握手。 */
        if (req.method() === 'OPTIONS') {
          return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
        }
        if (/\/hub\/api\/db\/cap/.test(u)) {
          /* 能力探针：真豆瓣此刻是「写得进去」，替身也这么演。
             「写通道被拦」那一支由 WRITE_BLOCKED 单独演，两条分支都要覆盖。 */
          return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify(WRITE_BLOCKED ? { ok: true, writable: false, reason: '豆瓣对条目页做了反爬，写入通道被挡（拉取不受影响）' } : { ok: true, writable: true, reason: '' }) });
        }
        if (/\/hub\/api\/db\/status/.test(u)) return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: true, logged: true, uid: '137602186' }) });
        if (/\/hub\/api\/db\/pull/.test(u)) {
          /* 拉回来的永远是「豆瓣现状」，这样推送完成后重拉，差异提示才对得上真实结果 */
          const items = FIX.map(d => Object.assign({}, d, { status: DB_NOW[String(d.subjectId)] || d.status }));
          return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: true, items, count: items.length, truncated: false }) });
        }
        if (/\/hub\/api\/db\/mark/.test(u)) {
          if (WRITE_BLOCKED) {
            /* 被封时网关不该发出写请求，替身把这种调用记成违规，供 P21 断言 */
            markCalls.push(Object.assign({}, { blocked: true }));
            return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: false, kind: 'write-blocked', wrote: false, msg: '豆瓣对条目页做了反爬，写入通道被挡（拉取不受影响）' }) });
          }
          let body = {};
          try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
          markCalls.push(body);
          const sid = String(body.subjectId || '');
          if (sid === failVerifyFor) {
            /* 模拟：POST 收下了，但回读状态没变 ⇒ 真豆瓣上就是「没写成」 */
            return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: false, msg: '已提交但豆瓣那边仍是「在看」，没写成', wrote: false }) });
          }
          DB_NOW[sid] = body.status;
          return req.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: H, body: JSON.stringify({ ok: true, changed: true, status: body.status }) });
        }
      }
      if (u.indexOf('http://127.0.0.1:' + PORT + '/') === 0 || u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return req.continue();
      if (!/127\.0\.0\.1|localhost/.test(u)) {
        if (/^https?:\/\/([a-z0-9-]+\.)*(douban\.com|doubanio\.com)([:\/]|$)/i.test(u) && req.resourceType() !== 'image') dbData.push(u);
        netOut.push(req.method() + ' ' + req.resourceType() + ' ' + u);
        return req.respond({ status: 200, contentType: 'application/json', headers: H, body: '{}' });
      }
      return req.continue();
    });

    /* 种子必须在页面脚本跑起来之前种（evaluateOnNewDocument，与 douban-sync 同一法）。
       原来「先加载、再写 localStorage、再刷新」会被一次晚到的 save() 冲掉：
       内置库数据集异步到达后，index.html:1680 那条一次性封面纠偏调用 save()，
       落盘的是页面内存里的片单（此刻还是空），种子就这么没了 —— 症状是十几条断言
       一起报「还没进片单」，看起来像产品匹配坏了。
       at_cover_q_v22 一并种上：它是那条晚到 save() 的守门标记，种了就不会再触发。 */
    await page.evaluateOnNewDocument((seedStr) => {
      if (localStorage.getItem('at_e2e_seeded')) return;
      localStorage.setItem('tr_shows', seedStr);
      localStorage.setItem('at_purge_v2140e', '1');
      localStorage.setItem('at_dedup_v2191', '1');
      localStorage.setItem('at_cover_q_v22', 'v2');
      localStorage.setItem('at_e2e_seeded', '1');
    }, JSON.stringify(SEED));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
    await sleep(900);
    /* 种子是否真的进了片单，这一步就该说：后面 11 条断言全依赖它，
       不在这里拦住的话，量具失配又要伪装成「推送坏了」。 */
    const seeded = await page.evaluate(() => ({ n: (typeof shows !== 'undefined' ? shows.length : -1), ids: (typeof shows !== 'undefined' ? shows.map(x => String(x.dbId || '')).join(',') : '') }));
    check('00b', '量具前提：片单种子确实进了页面（后面十几条都靠它）', seeded.n === SEED.length, JSON.stringify(seeded) + '（应为 ' + SEED.length + ' 条）');

    /* —— 打开面板，切到推送方向 —— */
    await page.evaluate(() => openDoubanSync());
    await sleep(1800);
    /* 先自检一次量具前提：面板提示栏必须显示「拉到了」而不是「连不上网关」，
       否则后面所有断言都会以「dbnItems 为空」的形式集体变红 —— 看着像推送坏了，其实是拉取没进来。
       这条不算门禁项，是给后来的人留的一盏灯。 */
    const pre = await page.evaluate(() => ({
      msg: (document.getElementById('dbnMsg') || {}).textContent || '',
      n: (typeof dbnItems !== 'undefined' ? dbnItems.length : -1),
      shows: (typeof shows !== 'undefined' ? shows.length : -1),
      ids: (typeof shows !== 'undefined' ? shows.map(s => String(s.dbId || '')).join(',') : ''),
      ls: localStorage.getItem('tr_shows') || ''
    }));
    if (pre.n <= 0) console.log('  [量具前提] 面板未拉到数据：' + JSON.stringify(pre) + ' —— 后续断言会集体红，先看这里');
    /* 现场一律打出来：这次 11 条一起红的方向是「片单里没有」，
       不说清种进去几条、localStorage 里躺着什么，下一轮还是猜。 */
    console.log('  [现场] ' + JSON.stringify(pre) + ' · ls=' + String(pre.ls || '').slice(0, 160));
    const dirBtns = await page.$$eval('#dbnDir .dbn-q', ns => ns.map(n => n.textContent.trim()));
    check('01', '面板有拉/推两个方向按钮', dirBtns.length === 2, dirBtns.join(' | '));

    await page.evaluate(() => {
      const b = document.querySelector('#dbnDir .dbn-q[data-dir="push"]');
      if (b) b.click();
    });
    await sleep(900);   /* 等能力探针回来 */
    const dirState = await page.evaluate(() => ({ dir: window.dbnDir, note: (document.getElementById('dbnDirNote') || {}).textContent || '' }));
    check('02', '切到 push 后方向状态与说明都换过来', dirState.dir === 'push' && dirState.note.indexOf('写回豆瓣') >= 0, JSON.stringify(dirState).slice(0, 200));

    /* —— 差异提示：每行都写清「推成什么 + 豆瓣现在什么」—— */
    const rows = await page.$$eval('.dbn-row', ns => ns.map(n => n.textContent.replace(/\s+/g, ' ').trim()));
    const r9001 = rows.find(t => t.indexOf('测试剧·在看A') >= 0) || '';
    check('03', '推方向下每行写明推成什么', /推成/.test(r9001), r9001.slice(0, 220));
    check('04', '差异行带豆瓣现状（在看 → 看过）', /在看.*看过/.test(r9001) && /豆瓣现在是/.test(r9001), r9001.slice(0, 260));

    const r9002 = rows.find(t => t.indexOf('测试剧·在看B') >= 0) || '';
    check('05', '两侧一致的行明说「已是这个状态」而不是谎报有改动', /已是这个状态/.test(r9002), r9002.slice(0, 220));

    const r9100 = rows.find(t => t.indexOf('没进片单') >= 0) || '';
    check('06', '没进片单的条目明说「推不了：还没进片单」', /推不了.*还没进片单/.test(r9100), r9100.slice(0, 220));

    /* —— 够格推的判定 —— */
    const pushable = await page.evaluate(() => dbnItems.map(d => ({ t: d.title, ok: dbnPushable(d), want: dbnWantStatus(d) })));
    const a1 = pushable.find(x => x.t.indexOf('在看A') >= 0) || { ok: null };
    const n1 = pushable.find(x => x.t.indexOf('没进片单') >= 0) || { ok: null };
    check('07', 'dbnPushable 对已入库带号条目为真、没入库为假', a1.ok === true && n1.ok === false, JSON.stringify(pushable).slice(0, 300));

    /* —— 状态映射：片单 watching/done/want → 豆瓣 do/collect/wish —— */
    const maps = await page.evaluate(() => {
      const byId = {}; dbnItems.forEach(d => { byId[String(d.subjectId)] = d; });
      return {
        done: dbnWantStatus(byId['9001']),      // 片单 done ⇒ 豆瓣 collect
        watching: dbnWantStatus(byId['9004'])   // 片单 watching ⇒ 豆瓣 do
      };
    });
    check('08', '状态映射：片单看完→豆瓣 collect、片单在看→豆瓣 do', maps.done === 'collect' && maps.watching === 'do', JSON.stringify(maps));

    /* —— 只推勾上的那一条，其余豆瓣现状一个字都不许变 —— */
    const picked1 = await page.evaluate(() => {
      dbnItems.forEach(d => { d.pick = (String(d.subjectId) === '9001') ? 1 : 0; });
      dbnRender();
      return dbnItems.filter(d => d.pick).length;
    });
    const before = Object.assign({}, DB_NOW);
    await page.evaluate(() => dbnPush());
    await sleep(2500);
    const afterOne = Object.assign({}, DB_NOW);
    const callsOne = markCalls.length;
    /* 页面里看到的状态才作数：dbnPush 末尾会重拉一次，页面上的 dbnBySid 就是「豆瓣现状」的官方读数 */
    const seen1 = await page.evaluate(() => Object.assign({}, dbnBySid));
    check('09', '只推勾上的那条：9001 变 collect，另外三条豆瓣现状没动',
      seen1['9001'] === 'collect' && seen1['9002'] === before['9002'] && seen1['9003'] === before['9003'] && seen1['9004'] === before['9004'],
      '豆瓣现状=' + JSON.stringify(seen1));
    check('10', '没勾的一条都不许推：只发出 1 次写请求', callsOne === 1, 'mark 调用 ' + callsOne + ' 次: ' + JSON.stringify(markCalls).slice(0, 240));

    /* —— 写回后差异提示要跟着真实结果更新（不能停在旧值上）—— */
    const rowsAfter = await page.$$eval('.dbn-row', ns => ns.map(n => n.textContent.replace(/\s+/g, ' ').trim()));
    const a9001 = rowsAfter.find(t => t.indexOf('测试剧·在看A') >= 0) || '';
    check('11', '推完重拉后该行显示「已是这个状态」（豆瓣现状已对齐）', /已是这个状态/.test(a9001), a9001.slice(0, 240));

    /* —— 一次性推多条：串行、逐条计数 —— */
    const picked2 = await page.evaluate(() => {
      dbnItems.forEach(d => { d.pick = (String(d.subjectId) === '9004' || String(d.subjectId) === '9003') ? 1 : 0; });
      dbnRender();
      return dbnItems.filter(d => d.pick).length;
    });
    markCalls.length = 0;
    await page.evaluate(() => dbnPush());
    await sleep(3200);
    const seen2 = await page.evaluate(() => Object.assign({}, dbnBySid));
    check('12', '一次推两条：双向差异都写成（9003 看过→在看、9004 想看→在看）',
      seen2['9003'] === 'do' && seen2['9004'] === 'do',
      '豆瓣现状=' + JSON.stringify(seen2));
    check('13', '每条各发一次写请求（串行不合并）', markCalls.length === 2, 'mark 调用 ' + markCalls.length + ' 次');

    /* —— 回读不通过必须报出来，不能算成功 —— */
    failVerifyFor = '9004';
    const picked3 = await page.evaluate(() => {
      dbnItems.forEach(d => { d.pick = (String(d.subjectId) === '9004') ? 1 : 0; });
      dbnRender();
      return dbnItems.filter(d => d.pick).length;
    });
    await page.evaluate(() => dbnPush());
    await sleep(2200);
    const msg = await page.evaluate(() => (document.getElementById('dbnMsg') || {}).textContent || '');
    check('14', '回读不通过时明说没推成，且不谎报改动数', /没推成/.test(msg) && /没写成/.test(msg), msg.slice(0, 260));
    failVerifyFor = null;

    /* —— 全都推不了时要拦下来并解释，而不是发一堆注定失败的请求 —— */
    const picked4 = await page.evaluate(() => {
      dbnItems.forEach(d => { d.pick = (String(d.subjectId) === '9100') ? 1 : 0; });
      dbnRender();
      return dbnItems.filter(d => d.pick).length;
    });
    markCalls.length = 0;
    await page.evaluate(() => dbnPush());
    await sleep(600);
    const msg2 = await page.evaluate(() => (document.getElementById('dbnMsg') || {}).textContent || '');
    check('15', '勾的全推不了时拦下并说明原因，一个请求都不发', /推不了|没有豆瓣号/.test(msg2) && markCalls.length === 0, msg2.slice(0, 240) + ' | calls=' + markCalls.length);

    /* —— 零直连：写回也必须走本机网关，页面不得直连豆瓣站点 —— */
    check('16', '写回链路零直连豆瓣站点（只经本机 :3000 网关）', dbData.length === 0, dbData.slice(0, 3).join(' | '));

    /* —— 无 JS 错误 —— */
    check('17', '全程无页面级 JS 错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    /* —— 小屏可读性：面板 393 宽不横向溢出、触点 ≥34px、正文不小于 11px —— */
    await page.setViewport({ width: 393, height: 850, deviceScaleFactor: 1 });
    await sleep(900);
    const mob = await page.evaluate(() => {
      const p = document.querySelector('#dbnMask .panel');
      /* 只量真正能被点到的东西：display:none 的 input（离线导入那个 file input 被 input{display:none} 藏了）
         量它等于量一个高度为 0 的隐形元素，判据会被量具自己带偏。 */
      const rows = Array.prototype.slice.call(document.querySelectorAll('#dbnMask .dbn-row, #dbnMask .dbn-q, #dbnMask .b1, #dbnMask .dbn-file'))
        .filter(r => r.getBoundingClientRect().height > 0);
      let small = 0, touch = 0, over = p ? (p.scrollWidth - p.clientWidth) : 0, list = [];
      rows.forEach(r => {
        const rc = r.getBoundingClientRect();
        if (rc.height < 34) { touch++; list.push((r.className || r.tagName) + ' h=' + Math.round(rc.height)); }
        if (parseFloat(getComputedStyle(r).fontSize || '12') < 11) small++;
      });
      return { over, small, touch, n: rows.length, list: list.join(' ; ') };
    });
    check('18', '393 宽下面板不横向溢出', mob.over <= 1, 'overflow=' + mob.over);
    check('19', '推送面板触点均 ≥34px', mob.touch === 0, '过小 ' + mob.touch + '/' + mob.n + ' ⇒ ' + mob.list);
    check('20', '推送面板无 11px 以下正文', mob.small === 0, '过小 ' + mob.small + '/' + mob.n);

    /* —— 写通道被封这一支（2026-10-06 真实局面）——
       面板必须在动手前就说清，并把按钮置灰；真去点也不该发出写请求。 */
    WRITE_BLOCKED = true;
    await page.evaluate(() => document.querySelector('#dbnDir .dbn-q[data-dir="pull"]').click());
    await sleep(400);
    await page.evaluate(() => document.querySelector('#dbnDir .dbn-q[data-dir="push"]').click());
    await sleep(1100);
    const blocked = await page.evaluate(() => {
      const b = document.getElementById('dbnGo');
      return { disabled: !!b && b.disabled, text: b ? b.textContent : '', note: (document.getElementById('dbnDirNote') || {}).textContent || '' };
    });
    check('21', '写通道被封时推送按钮置灰并明说原因', blocked.disabled === true && /不让.*写|拦/.test(blocked.note), JSON.stringify(blocked).slice(0, 260));
    const picked5 = await page.evaluate(() => { dbnItems.forEach(d => { d.pick = 1; }); dbnRender(); return dbnItems.filter(d => d.pick).length; });
    markCalls.length = 0;
    await page.evaluate(() => dbnPush());
    await sleep(900);
    const m3 = await page.evaluate(() => (document.getElementById('dbnMsg') || {}).textContent || '');
    check('22', '被封时点推送：明说走不通，一条写请求都不发', /走不通/.test(m3) && markCalls.length === 0, m3.slice(0, 200) + ' | calls=' + markCalls.length);
    /* 拉取方向必须不受影响 —— 这才是这套设计要保的底线 */
    await page.evaluate(() => document.querySelector('#dbnDir .dbn-q[data-dir="pull"]').click());
    await sleep(700);
    const stillPull = await page.evaluate(() => ({ n: dbnItems.length, msg: (document.getElementById('dbnMsg') || {}).textContent || '' }));
    check('23', '写通道被封不影响拉取（拉方向照常能列条目）', stillPull.n > 0, JSON.stringify(stillPull).slice(0, 200));
    const pickCounts = [picked1, picked2, picked3, picked4, picked5];
    check('00', '量具前提：每一步都真的勾上了条目（勾中数 ' + pickCounts.join('/') + '，全应为正数）',
      pickCounts.every(c => c > 0), pickCounts.join('/'));
  } catch (e) {
    check('99', '测试执行异常', false, (e && e.stack ? e.stack : String(e)).slice(0, 600));
  } finally {
    if (browser) { try { await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]); } catch (e) {} }
    try { process.kill(srv.pid); } catch (e) {}
  }

  const pass = results.filter(r => r.ok).length;
  const failIds = results.filter(r => !r.ok).map(r => 'P' + r.id);
  try { fs.writeFileSync(path.join(__dirname, 'last-douban-push.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, failIds, results }, null, 2)); } catch (e) {}
  console.log('SUMMARY: ' + pass + '/' + results.length + ' PASS' + (failIds.length ? ' :: FAILED: ' + failIds.join(' | ') : ''));
  process.exit(failIds.length ? 1 : 0);
})();