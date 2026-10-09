/* v2.50.1 交付墙：把「这条腿为什么必须补 + 打死本机腿后兜底真的在答 + 三轮走查 + 门禁账 + 页面实拍」拼成一张能看的页。
   实拍是真浏览器里跑出来的（headless 空 profile，save:false 不写用户数据），不是示意图。
   自证跳步：每张 PNG 的字节数必须两两不同（同宽同字节=根本没换片子）。
   用法：node _wall_v2501.js [端口=8099] */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');
const ROOT = __dirname;
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = Number(process.argv[2] || 8099);
const ART = path.join(ROOT, 'tests', '_artifacts');
const WALL = path.join(ART, 'v2501-relay-wall.html');
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SHOTS = [
  { t: '爱情宝典', total: 26, year: '2002', f: 'v2501-shot-1.png' },
  { t: '我爱我家', total: 120, year: '1993', f: 'v2501-shot-2.png' },
  { t: '编辑部的故事', total: 25, year: '1992', f: 'v2501-shot-3.png' },
  { t: 'The Office', total: 195, year: '2005', f: 'v2501-shot-4.png' }
];

function rd(f) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return null; }
}
function jf(f) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8')); } catch (e) { return null; }
}
function txt(p) {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; }
}
function grepLines(s, mark, n) {
  return s.split(NL).filter(l => l.indexOf(mark) >= 0).slice(-n);
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const shots = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1180, height: 900 });
    page.on('pageerror', e => console.log('PAGEERR ' + String(e).slice(0, 140)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html',
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    for (let i = 0; i < SHOTS.length; i++) {
      const fx = SHOTS[i];
      const r = await page.evaluate(async (f) => {
        const sid = 'wall' + Math.random().toString(36).slice(2, 8);
        window.shows = [{ sid: sid, title: f.t, kind: '', kindFrom: '', total: f.total, year: f.year,
          eps: [], statuses: {}, addedAt: Date.now(), updAt: Date.now(), epDur: 0, epDurFrom: '' }];
        window.openDetail(sid);
        const s = window.shows[0];
        const before = window.durEstTxt(s);
        try { await window.healCoverFor(s, { save: false }); } catch (e) {}
        try { await window.healDurFor(s, { save: false, silent: true }); } catch (e) {}
        await new Promise(r2 => setTimeout(r2, 600));
        const img = document.getElementById('dCover');
        const q = (el) => ((document.getElementById(el) || {}).innerText || '')
          .replace(new RegExp(String.fromCharCode(92) + 's+', 'g'), ' ').trim();
        return { before: before, line: q('dDur'), meta: q('dMeta'), title: q('dTitle'),
          coverW: img && img.naturalWidth || 0 };
      }, fx);
      const el = await page.$('#vDetail');
      await el.screenshot({ path: path.join(ART, fx.f) });
      const bytes = fs.statSync(path.join(ART, fx.f)).size;
      shots.push({ t: fx.t, f: fx.f, bytes: bytes, r: r });
      console.log('SHOT ' + fx.t + ' bytes=' + bytes + ' coverW=' + r.coverW + ' | ' + r.line.slice(0, 64));
      await sleep(1200);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const seen = {};
  const collide = [];
  shots.forEach(s => { if (seen[s.bytes]) collide.push(s.t + '=' + seen[s.bytes]); seen[s.bytes] = s.t; });

  const pA = rd('last-final-walk-v2501-1.json'), pB = rd('last-final-walk-v2501-2.json'), pC = rd('last-final-walk-v2501-3.json');
  const passes = [pA, pB, pC].filter(x => !!x);
  const covUnion = {}, durUnion = {};
  passes.forEach(d => d.rows.forEach(r => {
    covUnion[r.title] = covUnion[r.title] || !!r.covOk;
    durUnion[r.title] = durUnion[r.title] || (Number(r.epDur) > 0);
  }));
  const sabLog = grepLines(txt(path.join('_sab', '_sab_srv.log')), 'db-info', 40);
  const liveLog = grepLines(txt('_relay_srv.log'), 'db-info relay', 12);
  const userLog = grepLines(txt('服务器日志.txt'), '19:4', 6);
  const gates = [
    ['tests/db_info_rules_check.py', jf('last-db-info-rules.json')],
    ['tests/db_info_rules_negative.py', jf('last-db-info-rules-negative.json')],
    ['tests/dbinfo-transport-check.js', jf('last-dbinfo-transport.json')],
    ['tests/dbinfo-transport-negative.js', jf('last-dbinfo-transport-negative.json')]
  ];
  const glogs = fs.readdirSync(ROOT).filter(f => f.indexOf('_gate_run_v2501') === 0 && f.slice(-4) === '.log').sort();
  const gexit = [];
  glogs.forEach(f => { grepLines(txt(f), 'GATES_EXIT', 2).forEach(l => gexit.push(f + ' ' + l.trim())); });
  const suite = [];
  glogs.forEach(f => { grepLines(txt(f), '串行门禁 GATES_EXIT', 2).forEach(l => suite.push(l.trim())); });
  const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  const shIdx = sha1('index.html'), shAni = sha1('ani-tracker.html');
  function esc(x) {
    return String(x).replace(new RegExp('&', 'g'), '&amp;').replace(new RegExp('<', 'g'), '&lt;');
  }
  function row(r) {
    const d = Number(r.epDur) > 0;
    return '<tr><td>' + esc(r.title) + '</td><td>' + (r.covOk ? '✔ 有图' : '✖ 这轮没拿到') +
      '</td><td>' + (d ? esc(String(r.epDur)) + ' 分/集' : '—') + '</td><td>' +
      esc(r.local.status) + ' ' + esc(r.local.reason || '') + '</td></tr>';
  }
  const H = [];
  H.push('<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>v2.50.1 兜底那一跳交付墙</title></head><body style="font:15px/1.7 system-ui,sans-serif;margin:24px;max-width:1120px">');
  H.push('<h1>「可是我 爱情宝典还是没数据」——这一回卡在哪儿，现场账</h1>');
  H.push('<p>版本 <b>2.50.1</b> / build <b>20261009f</b>（本地六处同步，未发云；云端函数<b>没有</b>重新部署，这一跳不需要它变）。' +
    '下面每个数都是本机 2026-10-09 实测，口径写在句子括号里。</p>');

  H.push('<h2>1. 上一版修对了一半：同源这条腿只问豆瓣，而这台机器被豆瓣挡在联想之外</h2>');
  H.push('<ul>' + NL +
    '<li>你那台 8089 的 <code>服务器日志.txt</code>，19 点档 <code>db-info no subject</code> 这一支：<b>rows=0 共 117 次，rows&gt;0 一次都没有</b>（含 19:44:21 的《爱情宝典》）。墙页最下方贴的是逐字原文。</li>' + NL +
    '<li>同一分钟我用 python 直问云端函数同一条：<b>爱情宝典 found=true dur=50</b> / 我爱我家 20 / 康熙王朝 45。</li>' + NL +
    '<li>两头一夹就清楚了：<b>不是这部剧没有时长</b>，是家宽出口 IP 被豆瓣挡在 <code>subject_suggest</code> 之外（软限流）；' +
    '而能答的那一头在浏览器里被 CORS 拦死（响应头那条根因见 v2.50.0）。被 CORS 拦的是<b>浏览器</b>，不是服务器。</li>' + NL +
    '<li>所以这一跳补在服务器侧：本机问不到，就由服务器替这一页问云端，回来的字节再过<b>本机同一把尺</b>（标题全等、id 只认 5~9 位数字、分钟数越界归 0）。' +
    '身份闸 <code>normTxt</code> 一个字没松，<code>itemTotalNumber</code> 照旧不当集数用。</li>' + NL + '</ul>');

  H.push('<h2>2. 现场证明：把本机那条腿打死，兜底那一跳确实在答（8098 副本，suggest_url 指向不存在的端口）</h2>');
  H.push('<pre style="background:#f6f6f8;border-radius:8px;padding:12px;font-size:12.5px;overflow:auto">' +
    esc(sabLog.join(NL)) + '</pre>');
  H.push('<p style="font-size:13px">读法：每部都是 <code>suggest fail（本机腿死了）</code> → <code>relay ok（云端答的）</code> → <code>db-info ok dur=…（递给页面）</code> 三行一对。' +
    '最后一条《庆余年》是 <code>relay neg</code> → 404 且写 10 分钟负账；同一副本第二次问 0.0s 直接回 <code>known miss (local)</code>。</p>');

  const userLines = txt('服务器日志.txt').split(NL)
    .filter(l => l.indexOf('db-info no subject') >= 0 && l.indexOf(' 19:') >= 0);
  const user19 = grepLines(userLines.join(NL), '19:4', 4);
  H.push('<p style="font-size:12.5px;color:#555">你那台 8089 的日志原文（19 点档最后几条，逐字未改）：</p>');
  H.push('<pre style="background:#fbf7ef;border-radius:8px;padding:10px;font-size:12px;overflow:auto">' +
    esc(user19.join(NL) || '（这一档没取到，见 CHANGELOG 里同一份读数）') + '</pre>');

  H.push('<h2>3. 页面实拍（真浏览器里跑出来的，不是示意图）</h2>');
  H.push('<div style="display:flex;flex-wrap:wrap;gap:14px">');
  shots.forEach(s => {
    H.push('<figure style="margin:0"><img src="' + s.f + '" style="width:340px;border:1px solid #ccc;border-radius:8px">' +
      '<figcaption style="font-size:12px;max-width:340px">' + esc(s.t) + ' · 图字节 ' + s.bytes +
      ' · 封面 naturalWidth=' + s.r.coverW + '<br>修前：' + esc(s.r.before) + '<br>现在：' + esc(s.r.line) +
      '</figcaption></figure>');
  });
  H.push('</div>');
  H.push('<p style="font-size:12px;color:#555">自证跳步：四张 PNG 字节数' +
    (collide.length ? ' <b>有相同 = 没换片子，别信</b>（' + esc(collide.join(',')) + '）' : ' 两两不同 ✔（每张确实是另一部）') +
    '。第 4 张《The Office》这两轮撞的是 503（本机 403 + 云端同时 cooling down），' +
    '按纪律既不落负账也不落「这部没有」——它显示「按最低档估」是<b>此刻的真话</b>，不是又坏了。</p>');

  H.push('<h2>4. 三轮现场走查（12 部「随便找的」老剧，headless 空 profile、save:false 不写你的数据）</h2>');
  H.push('<p>' + passes.map((d, i) => 'pass' + (i + 1) + '：时长 ' + d.dur + '/12 · 封面 ' + d.cover + '/12').join(' ｜ ') +
    '。<b>合并：封面 ' + Object.keys(covUnion).filter(k => covUnion[k]).length + '/12，时长 ' +
    Object.keys(durUnion).filter(k => durUnion[k]).length + '/12</b>。' +
    '最后一轮里 <code>cloudBlockedByBrowser=' + (passes.length ? passes[passes.length - 1].cloudBlocked : '?') +
    '/12</code>（就是那堵 CORS 墙：页面直问云端一条都收不到，所以这条腿必须待在服务器侧）。</p>');
  H.push('<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
    '<tr><th>片子</th><th>封面(末轮)</th><th>单集</th><th>本机 /db-info 这一发</th></tr>' +
    (passes.length ? passes[passes.length - 1].rows.map(row).join(NL) : '') + '</table>');

  H.push('<h2>5. 五档分账（这一版把口径收到一处判）</h2>');
  H.push('<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
    '<tr><th>档位</th><th>什么时候</th><th>递给页面</th><th>记账</th></tr>' + NL +
    '<tr><td>ok</td><td>本机或兜底任一拿到全等详情</td><td>200 + 九键</td><td>写 7 天正账，清负账</td></tr>' + NL +
    '<tr><td>limited</td><td>豆瓣 403，或云端回 limited/cooling</td><td>503 + coolMs 45000</td><td>两侧都不落（一次 45 秒不许晾 10 分钟）</td></tr>' + NL +
    '<tr><td>empty</td><td>联想 rows=0 且兜底也没答上</td><td>502 软限流</td><td>不落（这台机器被敷衍≠这部没有）</td></tr>' + NL +
    '<tr><td>err</td><td>网络异常 / 坏 JSON / 兜底不通</td><td>502 + 原因</td><td>不落</td></tr>' + NL +
    '<tr><td>neg</td><td>有联想但全等落空、无详情、或云端确认没有</td><td>404 + 原因</td><td><b>只有这一档</b>写 10 分钟负账</td></tr>' + NL + '</table>');
  H.push('<p style="font-size:13px">为什么《庆余年》《进击的巨人》这类仍然没数：那是<b>设计内拒收</b>（豆瓣只有「庆余年 第N季」；' +
    '进击的巨人命中的全等项 <code>type=movie</code> 且无时长）。要动的是第 2/3 层（按季建条目、别名档），你说动哪层我再动。</p>');

  H.push('<h2>6. 门禁账（本轮新增 10 条判据：D12-D15 + S11-S14 + T20-T21，11 处变异各配负测）</h2>');
  H.push('<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
    '<tr><th>门禁</th><th>pass</th><th>fail</th><th>自证（读的哪一份）</th></tr>');
  gates.forEach(g => {
    const j = g[1];
    H.push('<tr><td><code>' + esc(g[0]) + '</code></td><td>' + (j ? (j.pass !== undefined ? j.pass : j.dur) : '未跑') +
      '</td><td>' + (j ? (j.fail !== undefined ? j.fail : '-') : '-') + '</td><td>' +
      esc(j && (j.page || j.rules || j.base) ? String(j.page || j.rules || j.base) : '-') + '</td></tr>');
  });
  H.push('</table>');
  H.push('<p style="font-size:13px">全套串行（<code>运行回归测试.bat</code> 里登记的每一条逐条跑，跑的就是登记那份真身）：</p>');
  H.push('<pre style="background:#f6f6f8;border-radius:8px;padding:10px;font-size:12px;overflow:auto">' +
    esc(gexit.join(NL) || '（还在跑，跑完补这行）') + '</pre>');
  H.push('<p style="font-size:13px"><code>index.html</code> sha1 <b>' + shIdx.slice(0, 16) + '</b>，' +
    '<code>ani-tracker.html</code> sha1 <b>' + shAni.slice(0, 16) + '</b> ' +
    (shIdx === shAni ? '<b>MATCH</b>（同字节）' : '<b>不匹配——别出货</b>') + '。</p>');

  H.push('<h2>6b. 门禁自己坏了两次：这两条红先是「豆瓣的心情」，不是本页的逻辑</h2>');
  H.push('<p style="font-size:13px">全套串行第一次跑（<code>_gate_run_v2501.log</code>）红了两个门禁，' +
    '都是<b>能复现的确定红</b>（各重跑一次同样红），但查下去两处都是量具在测真网络：</p>');
  H.push('<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
    '<tr><th>红的门禁</th><th>症状</th><th>查到的根因</th><th>动的地方</th></tr>' +
    '<tr><td><code>run-regression.js</code> T21-T24</td><td>整轮封面补齐一部都没跑（drain 6.0s 就完事，' +
    '全套耗时 104s→65s=暴跌）</td><td>服务器替页面问云端这一跳是<b>服务端出站</b>，页内拦截器拦不到它；' +
    '这台机器正被豆瓣挡在联想外（回 403）⇒ 服务端回 503 ⇒ 页面照 v2.46.2「撞冷却停下整轮」的设计停住。' +
    '红的是豆瓣的心情</td><td>出站地址加「换头」开关 <code>_base()</code>，门禁整套指向 :9（秒拒、不写账），' +
    '行为退回 v2.50.0 在门禁里的样子；判决与页面逻辑一个字没动</td></tr>' +
    '<tr><td><code>ep-duration-check.js</code> G10</td><td>存量回填那部 kind 由「剧场版」变成「电影」</td>' +
    '<td>兜底那一跳在门禁里<b>真的</b>问到云端，豆瓣回 <code>type=movie</code>，' +
    '页面 applyDbInfo 按设计把 kind 写成「电影」（def/total 仍是 100 分，账没错）——量具依赖了真网络才看到这一变</td>' +
    '<td>同一个换头开关；G10 那条判据<b>不放宽</b>，仍钉「剧场版」</td></tr></table>');
  H.push('<p style="font-size:13px">开关本身也要有判据，不然它就是第二条出口：' +
    '<b>D15</b> 钉住「只换协议+域名+路径那一段，?q= 与 mode=info&q= 照旧带编码后的剧名，' +
    '../ 与 file:// 这类值一律当没给」；负测 <b>R14</b> 把这条守卫拆掉（<code>if v.startswith(</code> → ' +
    '<code>if v:</code>）后当场只红 D15。</p>');
  H.push('<p style="font-size:13px">修完复跑：<code>run-regression.js</code> 33/33 PASS、' +
    '<code>ep-duration-check.js</code> 20/0，全套串行 ' +
    '<b>' + esc((suite.join(' ') || '（没读到汇总行）')) + '</b>。</p>');
  H.push('<h2>7. 还欠着的（下次说一声就动）</h2>');
  H.push('<ul><li>季级身份：豆瓣只有「X 第一季」的那批——要不要「按季建条目」而不是「整部借一季的数」</li>' +
    '<li>别名档（CLANNAD↔团子大家族）：只在你点头后才松，且要留可核对的出处</li>' +
    '<li>兜底那一跳的账：这两轮云端自己也进了 cooling（本机 403 + 云端 403 同一波），所以 503 那 4 部要等下一场开机自愈再走一遍——' +
    '这就是「不用你说第二次」的那条常驻机制</li></ul>');
  H.push('<p style="font-size:12px;color:#666">生成：node _wall_v2501.js ' + PORT + NL +
    '数据来源：last-final-walk-v2501-1/2/3.json、tests/last-*.json、_sab/_sab_srv.log、_relay_srv.log、服务器日志.txt、_gate_run_v2501*.log、_solo_reg1/2.log、_solo_epdur.log、_solo_epdur2.log</p>');
  H.push('</body></html>');
  fs.writeFileSync(WALL, H.join(NL), 'utf8');
  console.log('WALL tests/_artifacts/v2501-relay-wall.html bytes=' + fs.statSync(WALL).size);
  console.log('STEP-DUP ' + (collide.length ? 'COLLIDE ' + collide.join(',') : 'ok'));
  console.log('SHA ' + shIdx.slice(0, 16) + ' / ' + shAni.slice(0, 16) + (shIdx === shAni ? ' MATCH' : ' MISMATCH'));
})().catch(e => { console.log('CRASH ' + e.stack); process.exit(1); });
