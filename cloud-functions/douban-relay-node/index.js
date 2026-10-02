// 豆瓣封面中转（Node.js 事件函数）——仅用于可行性实测：腾讯云出口能否抓到豆瓣国剧封面
// 真正上线版本会改成 HTTP 函数或经 SDK 调用，此处先验证连通性。
const https = require('https');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15';
const REF = 'https://m.douban.com/';

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, timeout: 12000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), ctype: res.headers['content-type'] || 'image/jpeg' }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

async function doubanCover(name) {
  const surl = 'https://m.douban.com/rexxar/api/v2/search?q=' + encodeURIComponent(name) + '&type=tv&loc_id=108288';
  const sh = { 'User-Agent': UA, Referer: REF, Accept: 'application/json' };
  let body = null, lastErr = null;
  for (let i = 0; i < 2; i++) {
    try { const r = await get(surl, sh); body = r.body; break; }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 700)); }
  }
  if (!body) throw lastErr || new Error('douban search failed');
  let sd;
  try { sd = JSON.parse(body.toString('utf-8')); } catch (e) { throw new Error('bad search json'); }
  const items = ((sd.subjects || {}).items) || [];
  let cover = null;
  for (const it of items.slice(0, 5)) {
    const t = it.target || {};
    const c = t.cover_url || t.cover;
    if (c) { cover = c; break; }
  }
  if (!cover) throw new Error('no cover for ' + name);
  const img = await get(cover, { 'User-Agent': UA, Referer: REF });
  return { bytes: img.body, ctype: img.ctype };
}

exports.main = async (event, context) => {
  const ev = event || {};
  let name = ev.q || (ev.queryString && ev.queryString.q) || '';
  if (!name && ev.body) {
    try { const b = typeof ev.body === 'string' ? JSON.parse(ev.body) : ev.body; name = b.q || ''; } catch (e) {}
  }
  name = (name || '').toString().trim();
  if (!name) return { statusCode: 400, error: 'need q', _test: 'ok' };
  try {
    const { bytes, ctype } = await doubanCover(name);
    return { statusCode: 200, contentType: ctype, size: bytes.length, magic: bytes.slice(0, 4).toString('hex'), _test: 'ok' };
  } catch (e) {
    return { statusCode: 502, error: 'douban fail: ' + e.message, _test: 'ok' };
  }
};
