/* v2.50.0 现场复测：真网络 + 真浏览器，量「随便找一部」在页面里到底能不能拿到时长。
   每件都记三条：① 封面 heals 没有 ② 时长落进 s.epDur/kind 没有（明细行原文）
   ③ 同一次问题：本机 /db-info 的状态码+原因，云端那条同源不通的老路现在什么下场（对照证据）
   只读：headless 空 profile，save:false 不写用户数据。用法：node _final_walk.js [端口=8099] */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const ROOT = __dirname;
const CHROME = process.env.AT_CHROME || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = Number(process.argv[2] || 8099);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUTJSON = path.join(ROOT, 'last-final-walk.json');

const PREV = fs.existsSync(OUTJSON) ? JSON.parse(fs.readFileSync(OUTJSON, 'utf8')) : null;
const NAMES = (process.argv[3] === 'retry' && PREV) ? PREV.rows
  .filter(r => !r.covOk || !(Number(r.epDur) > 0))
  .map(r => ({ t: r.title, total: r.total, year: r.year || '' })) : [
  { t: '爱情宝典', total: 26, year: '2002' },
  { t: '我爱我家', total: 120, year: '1993' },
  { t: '康熙王朝', total: 46, year: '2001' },
  { t: '暗算', total: 34, year: '2006' },
  { t: '编辑部的故事', total: 25, year: '1992' },
  { t: '大明王朝1566', total: 46, year: '2007' },
  { t: '北平无战事', total: 53, year: '2014' },
  { t: '庆余年', total: 46, year: '2019' },
  { t: 'The Office', total: 195, year: '2005' },
  { t: 'CLANNAD', total: 23, year: '2007' },
  { t: '进击的巨人', total: 59, year: '2013' },
  { t: '琅琊榜', total: 54, year: '2015' }
];

function probePort(p) {
  return new Promise(r => {
    const sk = require('net').connect(p, '127.0.0.1');
    sk.on('connect', () => { sk.destroy(); r(true); });
    sk.on('error', () => r(false));
    sk.setTimeout(2000, () => { sk.destroy(); r(false); });
  });
}

(async () => {
  if (!await probePort(PORT)) { console.error('FAIL 本机服务没在 :' + PORT); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const rows = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => console.log('PAGEERR ' + String(e).slice(0, 140)));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html',
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    const build = await page.evaluate(() => String(window.AT_VERSION || '') + '/' + String(window.AT_BUILD || ''));
    console.log('BUILD=' + build + ' PORT=' + PORT + ' n=' + NAMES.length);

    for (let i = 0; i < NAMES.length; i++) {
      const fx = NAMES[i];
      const r = await page.evaluate(async (f) => {
        const sid = 'fin' + Math.random().toString(36).slice(2, 8);
        window.shows = [{ sid: sid, title: f.t, kind: '', kindFrom: '', total: f.total, year: f.year,
          eps: [], statuses: {}, addedAt: Date.now(), updAt: Date.now(), epDur: 0, epDurFrom: '' }];
        window.openDetail(sid);
        const s = window.shows[0];
        const q = (el) => ((document.getElementById(el) || {}).innerText || '')
          .replace(new RegExp(String.fromCharCode(92) + 's+', 'g'), ' ').trim();
        const before = { est: window.durEstTxt(s), line: q('dDur') };
        const t0 = Date.now();
        let covOk = false, durOk = false, err = '';
        try { covOk = await window.healCoverFor(s, { save: false }); } catch (e) { err += ' cover:' + e.message; }
        const tCover = Date.now() - t0;
        try { durOk = await window.healDurFor(s, { save: false, silent: true }); } catch (e) { err += ' dur:' + e.message; }
        const tDur = Date.now() - t0 - tCover;
        const d = window.durOf(s);
        let img = null;
        if (s.cover && String(s.cover).indexOf('data:') !== 0) {
          img = await new Promise(res => {
            const it = new Image();
            it.onload = () => res({ ok: true, w: it.naturalWidth, h: it.naturalHeight });
            it.onerror = () => res({ ok: false });
            it.src = String(s.cover);
            setTimeout(() => res({ ok: false, timeout: true }), 20000);
          });
        }
        /* 同一次问，两条路各是什么下场：本机那条 vs 云端那条（对照证据，不是猜） */
        const enc = encodeURIComponent(f.t);
        let loc = {};
        try {
          const rr = await fetch('/db-info?q=' + enc);
          const jj = await rr.json().catch(() => null);
          loc = { status: rr.status, found: !!(jj && jj.found), dur: jj ? jj.dur : null,
                  reason: jj && jj.reason ? String(jj.reason).slice(0, 60) : '',
                  limited: !!(jj && jj.limited) };
        } catch (e) { loc = { status: 0, err: String(e.message).slice(0, 60) }; }
        let cld = {};
        try {
          const rc = await fetch(String(window.DOUBAN_RELAY_CLOUD) + '?mode=info&q=' + enc);
          cld = { status: rc.status };
        } catch (e) { cld = { status: 0, err: String(e.name || e.message).slice(0, 60) }; }
        return { title: f.t, total: f.total, year: f.year, before: before, err: err,
          covOk: !!covOk, coverIsData: String(s.cover || '').indexOf('data:') === 0,
          img: img, durOk: !!durOk, kind: String(s.kind || ''), kindFrom: String(s.kindFrom || ''),
          epDur: Number(s.epDur) || 0, est: window.durEstTxt(s), line: q('dDur'),
          dTotal: d.total, known: d.known, dbId: String(s.dbSubId || ''),
          tCover: tCover, tDur: tDur, local: loc, cloud: cld };
      }, fx);
      rows.push(r);
      console.log(JSON.stringify({ t: r.title, cov: r.covOk, dur: r.epDur, kind: r.kind,
        loc: r.local.status + '/' + (r.local.dur || r.local.reason || ''),
        cld: r.cloud.status + (r.cloud.err ? ':' + r.cloud.err : '') }));
      await sleep(1500);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const cover = rows.filter(r => r.covOk).length;
  const dur = rows.filter(r => r.epDur > 0).length;
  const kind = rows.filter(r => r.kind !== '').length;
  const cloudBlocked = rows.filter(r => r.cloud.status === 0).length;
  const rep = { at: new Date().toISOString(), port: PORT, n: rows.length,
    cover: cover, dur: dur, kind: kind, cloudBlocked: cloudBlocked, rows: rows };
  fs.writeFileSync(OUTJSON, JSON.stringify(rep, null, 1), 'utf8');
  console.log('SUMMARY n=' + rows.length + ' cover=' + cover + ' durReal=' + dur +
    ' kindSet=' + kind + ' cloudBlockedByBrowser=' + cloudBlocked);
  console.log('WROTE ' + OUTJSON);
})().catch(e => { console.log('CRASH ' + e.stack); process.exit(1); });
