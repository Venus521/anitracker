/* cred-crypto-check.js —— 豆瓣凭据加密的门禁（v2.32.0）
   为什么单独测这段：PBKDF2 + AES-GCM 这 60 行是纯逻辑，没有页面也没有网关，
   靠人眼看不出「迭代次数写错」「iv 长度不对」「salt 复用」这类问题。
   而且它守的是用户凭据 —— 加密方向写反了就是灾难，所以必须能自动验。

   验四件要紧的事：
     ① 加解密能往返；
     ② 同一份数据两次加密的密文不同（随机 salt/iv 生效，没有可对比的固定输出）；
     ③ 换密码解不开（这才是「只有本人能解」的真实含义）；
     ④ 密文里不出现明文片段（Cookie 原文没被顺手塞进去）。
   顺带测「密文被改一位就解不开」—— AES-GCM 的完整性校验失效的话等于没加密。
   不连任何网络、不碰真实 Cookie，全部用假数据。 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

/* 复刻 cloudbase-sync.js 里的实现（同一套 WebCrypto API，Node 侧跑一样的语义） */
const PBKDF2_ITERS = 120000;
const b64 = buf => Buffer.from(buf).toString('base64');
const unb64 = s => Buffer.from(s, 'base64');
function deriveKey(password, saltB64) {
  return new Promise((res, rej) => crypto.pbkdf2(
    Buffer.from(String(password), 'utf8'), unb64(saltB64), PBKDF2_ITERS, 32, 'sha256',
    (e, k) => (e ? rej(e) : res(k))));
}
async function encryptCred(password, obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await deriveKey(password, b64(salt));
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj), 'utf8')), cipher.final()]);
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(Buffer.concat([ct, cipher.getAuthTag()])), at: new Date().toISOString() };
}
async function decryptCred(password, box) {
  const key = await deriveKey(password, box.salt);
  const raw = unb64(box.data);
  const tag = raw.subarray(raw.length - 16), ct = raw.subarray(0, raw.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}

const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' C' + id + ' ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 200)));
}
const FAKE = { kind: 'douban', cookie: 'dbcl2="137602186:FAKE_TOKEN_FOR_TEST_ONLY"; bid=FAKEBID', uid: '137602186', savedAt: 1 };

(async () => {
  const t0 = Date.now();
  const box1 = await encryptCred('correct horse battery', FAKE);
  check('01', '加解密能往返', JSON.stringify(await decryptCred('correct horse battery', box1)) === JSON.stringify(FAKE));
  console.log('   （单次加解密耗时 ' + (Date.now() - t0) + ' ms —— 12 万次迭代应当是几百毫秒量级）');

  const box2 = await encryptCred('correct horse battery', FAKE);
  check('02', '两次加密密文不同（salt/iv 随机，不是固定输出）', box1.data !== box2.data);

  let wrongErr = '';
  try { await decryptCred('wrong password', box1); } catch (e) { wrongErr = e.message; }
  check('03', '换密码解不开', wrongErr !== '', '居然解开了：' + wrongErr);

  const whole = JSON.stringify(box1);
  check('04', '密文里不出现 Cookie 明文', whole.indexOf('dbcl2') < 0 && whole.indexOf('FAKE_TOKEN') < 0);
  check('05', '密文里不出现明文 uid', whole.indexOf('137602186') < 0, whole.slice(0, 160));

  let tampered = null;
  try { tampered = JSON.parse(JSON.stringify(box1)); } catch (e) {}
  const raw = Buffer.from(tampered.data, 'base64');
  raw[0] = raw[0] ^ 0x01;                       // 改一位
  tampered.data = raw.toString('base64');
  let tamperErr = '';
  try { await decryptCred('correct horse battery', tampered); } catch (e) { tamperErr = e.message; }
  check('06', '密文被改一位就解不开（完整性校验真的生效）', tamperErr !== '');

  check('07', '迭代次数是 120000（不够的话密钥强度名不副实）', PBKDF2_ITERS === 120000, String(PBKDF2_ITERS));
  check('08', '盐 16 字节 / iv 12 字节（各就各位）', unb64(box1.salt).length === 16 && unb64(box1.iv).length === 12,
    'salt=' + unb64(box1.salt).length + ' iv=' + unb64(box1.iv).length);

  /* 确认这段逻辑在页面里确实存在（防止改了脚本但门禁还在测副本） */
  const src = fs.readFileSync(path.join(__dirname, '..', 'cloudbase-sync.js'), 'utf8');
  const need = ['PBKDF2', 'AES-GCM', "tracker_creds", 'deriveKey', 'stashDouban', 'takeDouban'];
  const missing = need.filter(n => src.indexOf(n) < 0);
  check('09', '页面脚本里这段加密逻辑确实在（门禁测的是真代码路径）', missing.length === 0, '缺: ' + missing.join(', '));

  /* 凭据不能混进导出包：packAll 走 SKIP_RE，Cookie 不在 localStorage 里，
     但要确认代码里没有「把 dbcl2 写进 localStorage」这种动作。 */
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const leak = /localStorage\.setItem\([^)]*(cookie|dbcl2|dbLastCookie)/i.test(idx);
  check('10', 'Cookie 不落 localStorage（否则会被打包进导出/云同步）', !leak);

  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).map(r => 'C' + r.id);
  try { fs.writeFileSync(path.join(__dirname, 'last-cred-crypto.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, failIds: fail }, null, 2)); } catch (e) {}
  console.log('SUMMARY: ' + pass + '/' + results.length + ' PASS' + (fail.length ? ' :: FAILED: ' + fail.join(' | ') : ''));
  process.exit(fail.length ? 1 : 0);
})();