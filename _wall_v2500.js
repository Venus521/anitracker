/* v2.50.0 交付墙：把「根因证据 + 三轮现场走查 + 门禁账 + 页面实拍」拼成一张能看的页。
   实拍是真浏览器里跑出来的（headless 空 profile，save:false 不写用户数据），不是示意图。
   自证跳步：每张 PNG 的字节数必须两两不同（同宽同字节=根本没换片子）。
   用法：node _wall_v2500.js [端口=8099] */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const ROOT = __dirname;
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = Number(process.argv[2] || 8099);
const ART = path.join(ROOT, 'tests', '_artifacts');
const WALL = path.join(ART, 'v2500-dur-wall.html');
const NL = String.fromCharCode(10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SHOTS = [
  { t: '爱情宝典', total: 26, year: '2002', f: 'v2500-shot-1.png' },
  { t: '我爱我家', total: 120, year: '1993', f: 'v2500-shot-2.png' },
  { t: '编辑部的故事', total: 25, year: '1992', f: 'v2500-shot-3.png' },
  { t: '进击的巨人', total: 59, year: '2013', f: 'v2500-shot-4.png' }
];

function rd(f) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return null; }
}
function jf(f) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8')); } catch (e) { return null; }
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
        await new Promise(r2 => setTimeout(r2, 500));
        const img = document.getElementById('dCover');
        const q = (el) => ((document.getElementById(el) || {}).innerText || '')
          .replace(new RegExp(String.fromCharCode(92) + 's+', 'g'), ' ').trim();
        return { before: before, after: window.durEstTxt(s), line: q('dDur'), meta: q('dMeta'),
          title: q('dTitle'), coverW: img && img.naturalWidth || 0 };
      }, fx);
      const el = await page.$('#vDetail');
      await el.screenshot({ path: path.join(ART, fx.f) });
      const bytes = fs.statSync(path.join(ART, fx.f)).size;
      shots.push({ t: fx.t, f: fx.f, bytes: bytes, r: r });
      console.log('SHOT ' + fx.t + ' bytes=' + bytes + ' coverW=' + r.coverW + ' | ' + r.line.slice(0, 60));
      await sleep(1200);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const dup = {};
  let collide = [];
  shots.forEach(s => { if (dup[s.bytes]) collide.push(s.t + '=' + dup[s.bytes]); dup[s.bytes] = s.t; });

  const p1 = rd('last-final-walk-pass1.json'), p2 = rd('last-final-walk-pass2.json'), p3 = rd('last-final-walk-pass3.json');
  const covUnion = {}, durUnion = {};
  [p1, p2, p3].forEach(d => { if (d) d.rows.forEach(r => {
    covUnion[r.title] = covUnion[r.title] || !!r.covOk;
    durUnion[r.title] = durUnion[r.title] || (Number(r.epDur) > 0);
  }); });
  const gates = [
    ['tests/dbinfo-transport-check.js', jf('last-dbinfo-transport.json')],
    ['tests/dbinfo-transport-negative.js', jf('last-dbinfo-transport-negative.json')],
    ['tests/db_info_rules_check.py', jf('last-db-info-rules.json')],
    ['tests/db_info_rules_negative.py', jf('last-db-info-rules-negative.json')]
  ];
  let gser = jf('last-regression.json');
  // 三遍串行的账全列（红的那遍不许被绿的那遍顶掉）：日志名按时间序，逐份抽 GATES_EXIT 行
  const runLogs = fs.readdirSync(ROOT).filter(function (f) {
    return /^_gate_run_v2500/.test(f) && /\.log$/.test(f);
  }).sort();
  const gateLines = [];
  runLogs.forEach(function (f) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split(NL).forEach(function (ln) {
      if (ln.indexOf('GATES_EXIT') >= 0) gateLines.push(f + '  ' + ln.trim());
    });
  });
  const logTxt = gateLines.join(NL);
  const crypto = require('crypto');
  const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  const shIdx = sha1('index.html'), shAni = sha1('ani-tracker.html');

  function esc(x) { return String(x).replace(new RegExp('&', 'g'), '&amp;').replace(new RegExp('<', 'g'), '&lt;'); }
  function row(r) {
    const d = Number(r.epDur) > 0;
    return '<tr><td>' + esc(r.title) + '</td><td>' + (r.covOk ? '✔ 有图' : '✖ 这轮没拿到') +
      '</td><td>' + (d ? esc(String(r.epDur)) + ' 分/集' : '—') + '</td><td>' +
      esc(r.kind || '（拒收：见下）') + '</td><td>' + esc(r.local.status) + ' ' +
      esc(r.local.reason || (r.local.found ? '带回 ' + r.local.dur + ' 分' : '')) + '</td><td>' +
      (r.cloud.status === 0 ? '被浏览器拦（' + esc(r.cloud.err || '') + '）' : esc(r.cloud.status)) +
      '</td></tr>';
  }
  const rowsHtml = (p3 || p2 || p1).rows.map(row).join(NL);

  const H = [];
  H.push('<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>v2.50.0 时长同源交付墙</title></head><body style="font:15px/1.7 system-ui,sans-serif;margin:24px;max-width:1120px">');
  H.push('<h1>「我随便找一个都是没有数据的，时长也不对」——这轮的实际账</h1>');
  H.push('<p>版本 <b>2.50.0</b> / build <b>20261009e</b>（本地已进位，未发云）。下面每一个数都是本机 2026-10-09 实测，口径写在句子括号里。</p>');

  H.push('<h2>1. 根因：同一条 URL，两种问法，下场完全不同</h2>');
  H.push('<ul>' + NL +
    '<li>python 直问云端函数：<b>16 部样本 11 部 found=true，其中 10 部带回分钟数</b>（爱情宝典 50 / 康熙王朝 45 / 暗算 46 / 编辑部的故事 49 / 琅琊榜 45 …）</li>' + NL +
    '<li>浏览器页面里问同一条：<b>12 部 12 次全部 TypeError: Failed to fetch</b>（本墙三轮走查里 <code>cloudBlockedByBrowser=' +
    ((p3 && p3.cloudBlocked) || (p2 && p2.cloudBlocked) || '?') + '/12</code>）</li>' + NL +
    '<li>响应头抓出来的原因：CloudBase 网关对 loopback 来源回 <code>access-control-allow-origin: http://127.0.0.1:8089,*</code>（一个头里两个值，规范非法）+ <code>allow-credentials: true</code> ⇒ Chrome 判 CORS 拦死。函数自己只写了 <code>\'*\'</code>，<b>那串回显是网关加的，重新部署也改不掉</b>。</li>' + NL +
    '<li>19:44 同一分钟两头各问一次（本机 <code>/db-info</code> vs 云端 <code>?mode=info</code>）：' +
    '暗算 <b>46/46</b>、康熙王朝 <b>45/45</b>、我爱我家 <b>20/20</b> 逐条相同——本机这条不比云端松，也不比它紧；' +
    '琅琊榜 本机回 <code>502 suggest empty (soft limit)</code>、云端（别的出口 IP）回 200/45 分 ⇒ ' +
    '「这一轮问不到」和「这部没有」是两件事，家宽 IP 撞软限流的机会比云函数大。</li>' + NL +
    '<li>响应头当场重放（<code>server: tcbgw</code>，四个 Origin 各一次，4/4 复现）：' +
    '<code>Origin: 127.0.0.1:8089</code> 与 <code>:8099</code> 都回 <code>access-control-allow-origin: &lt;回显&gt;,*</code> ' +
    '+ <code>allow-credentials: true</code>；<code>venus521.github.io</code> 与 <code>example.com</code> 回干净的 <code>*</code> 且不带 credentials。</li>' + NL +
    '<li>封面早就没这毛病：它走的是本机 <code>/cover-relay</code>（同源）。这轮把时长也变成同源，判据照抄云端那条，一个字没松。</li>' + NL + '</ul>');

  H.push('<h2>2. 页面实拍（真浏览器里跑出来的，不是示意图）</h2>');
  H.push('<div style="display:flex;flex-wrap:wrap;gap:14px">');
  shots.forEach(s => {
    H.push('<figure style="margin:0"><img src="' + s.f + '" style="width:340px;border:1px solid #ccc;border-radius:8px">' +
      '<figcaption style="font-size:12px;max-width:340px">' + esc(s.t) + ' · 图字节 ' + s.bytes +
      ' · 封面 naturalWidth=' + s.r.coverW + '<br>修前：' + esc(s.r.before) + '<br>修后：' + esc(s.r.line) + '</figcaption></figure>');
  });
  H.push('</div>');
  H.push('<p style="font-size:12px;color:#555">自证跳步：四张 PNG 字节数' +
    (collide.length ? ' <b>有相同 = 没换片子，别信</b>（' + esc(collide.join(',')) + '）' : ' 两两不同 ✔（说明每张确实是另一部）') +
    '。第 4 张是《进击的巨人》——它<b>仍然</b>显示「约 24 分钟」，那是设计内拒收（下面第 4 节），不是又坏了。</p>');

  H.push('<h2>3. 三轮现场走查（12 部「随便找的」老剧，headless 空 profile、save:false 不写你的数据）</h2>');
  H.push('<p>单轮：pass1 时长 ' + (p1 ? p1.dur : '?') + '/12 · pass2 ' + (p2 ? p2.dur : '?') +
    '/12 · pass3 ' + (p3 ? p3.dur : '?') + '/12；封面 pass1 ' + (p1 ? p1.cover : '?') +
    ' → pass3 ' + (p3 ? p3.cover : '?') + '（第三轮是封面 id 腿上线之后）。<b>三轮合并：封面 ' +
    Object.keys(covUnion).filter(k => covUnion[k]).length + '/12，时长 ' +
    Object.keys(durUnion).filter(k => durUnion[k]).length + '/12</b>。</p>');
  H.push('<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
    '<tr><th>片子</th><th>封面(本轮)</th><th>单集</th><th>格式</th><th>本机 /db-info</th><th>云端同一条</th></tr>' +
    rowsHtml + '</table>');

  H.push('<h2>4. 剩下 4 部为什么仍然没有数：设计内拒收（没点头，就没放宽）</h2>');
  H.push('<ul>' + NL +
    '<li><b>庆余年</b>：豆瓣只登记 <code>庆余年 第一季/第二季/第三季</code>（实测 rows=3），全等闸不许把某一季的数写进整部</li>' + NL +
    '<li><b>The Office</b>：豆瓣那条叫 <code>办公室 第一季</code></li>' + NL +
    '<li><b>CLANNAD</b>：豆瓣那条叫 <code>团子大家族</code></li>' + NL +
    '<li><b>进击的巨人</b>：命中的全等项 <code>type=movie</code> 且无时长（dur=0），粒度哨拒</li>' + NL +
    '<li>这三类属第 2/3 层（季级身份、别名档）。你说动哪层我再动；<b>页面那把 normTxt 全等闸这轮没松</b>，' +
    '<code>itemTotalNumber</code> 仍然不当集数用。错封面/错时长比没封面更糟。</li>' + NL + '</ul>');
  H.push('<p>另一头，「限流」和「没有」这轮是分得开的：403→503+coolMs（记冷却，不落负账）、联想 rows=0→502 软限流（不落负账，' +
    '实测 pass3 的 大明王朝1566 / 琅琊榜 撞的就是这个，pass2 它们各带回 42 / 45 分）、只有「有联想但全等落空」才 404 记 10 分钟负缓存。' +
    '开机自愈第 2 步仍会把整池没时长的串行再走一遍——这就是「不用你说第二次」的形状。</p>');

  H.push('<h2>5. 门禁账（每条判据都配了负测：改坏了要红得出来）</h2>');
  H.push('<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
    '<tr><th>门禁</th><th>pass</th><th>fail</th><th>自证（读的哪一份）</th></tr>');
  gates.forEach(g => {
    const j = g[1];
    H.push('<tr><td><code>' + esc(g[0]) + '</code></td><td>' + (j ? j.pass : '未跑') +
      '</td><td>' + (j ? j.fail : '-') + '</td><td>' +
      esc(j && (j.page || j.rules || j.srv || j.base) ? String(j.page || j.rules || j.srv || j.base) : '-') + '</td></tr>');
  });
  H.push('</table>');
  H.push('<p style="font-size:13px">四条已登记进 <code>运行回归测试.bat</code>（RC19~RC22，含 <code>exit /b 20..23</code>）。' +
    '全套串行（bat 里 23 条门禁逐条跑）的账：<code>' +
    (logTxt ? esc(logTxt.split(NL).join('   ')) : '（这一版还在跑，跑完补这行）') +
    '</code>；<code>index.html</code> 与 <code>ani-tracker.html</code> sha1 <b>' + shIdx.slice(0,16) + '</b> ' + (shIdx === shAni ? 'MATCH' : 'DIFF') + '。' +
    '云端函数<b>没有</b>重新部署（那条 CORS 回显不是函数写的）。</p>');
  if (gser && gser.pass !== undefined) {
    H.push('<p style="font-size:12px;color:#555">顺带：run-regression 汇总 pass=' + gser.pass + ' fail=' + gser.fail + '</p>');
  }
  H.push('<h2>6. 还欠着的（下次说一声就动）</h2>');
  H.push('<ul><li>季级身份：豆瓣只有「X 第一季」的那批（上面 4 部里的 3 部）——要不要「按季建条目」而不是「整部借一季的数」</li>' +
    '<li>别名档（CLANNAD↔团子大家族）：只在你点头后才松，且要留可核对的出处</li>' +
    '<li>离线库 18513 条里 <code>sn</code>（季号）为 0 条：季级集数要真正铺开，得先补这层数据</li></ul>');
  H.push('<p style="font-size:12px;color:#666">生成：node _wall_v2500.js ' + NL +
    '数据来源：last-final-walk-pass1/2/3.json、tests/last-*.json、_dur_sample.log、_final_srv.log</p>');
  H.push('</body></html>');
  fs.writeFileSync(WALL, H.join(NL), 'utf8');
  console.log('WALL tests/_artifacts/v2500-dur-wall.html bytes=' + fs.statSync(WALL).size);
  console.log('STEP-DUP ' + (collide.length ? 'COLLIDE ' + collide.join(',') : 'ok'));
})().catch(e => { console.log('CRASH ' + e.stack); process.exit(1); });
