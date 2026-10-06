/* AniTracker 账号云同步（腾讯云开发 CloudBase）— v2.6.1（2026-09-16 账号链路修复）
   面板 ② 区容器 #cbArea 由本文件渲染；登录后数据自动上云，换设备登录即恢复。

   平台现状与 v2.6.1 修复说明：
   - CloudBase 不允许「用户名+密码」直接注册（SDK 直接拒绝：You must provide either an email or phone number）；
     正确流程为先建邮箱账号，之后才能绑定用户名。
   - 注册：邮箱 + 密码 → 发邮箱验证码 → 验证通过建号（可顺手绑定一个用户名）。
   - 登录：邮箱 + 密码，或（绑定后）用户名 + 密码，两种均可。
   - 若云端尚未开启「邮箱登录」，界面会给出中文说明与控制台直达链接（新窗口打开）。
   策略：新账号先手动"立即上传/从云端恢复"一次，之后 save() 防抖自动上传。 */
(function(){
  var ENV  = 'cloud1-d7gsn5t0w6407b963';
  var REGION = 'ap-shanghai';
  var KEY  = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9.eyJpc3MiOiJodHRwczovL2Nsb3VkMS1kN2dzbjV0MHc2NDA3Yjk2My5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9uIiwiYXVkIjoiY2xvdWQxLWQ3Z3NuNXQwdzY0MDdiOTYzIiwiZXhwIjo0MDkyOTc0MDY1LCJpYXQiOjE3ODkyOTA4NjUsIm5vbmNlIjoia3JfOFZhbXNURkthUmFWejVlMVZCdyIsImF0X2hhc2giOiJrcl84VmFtc1RGS2FSYVZ6NWUxVkJ3IiwibmFtZSI6IkFub255bW91cyIsInNjb3BlIjoiYW5vbnltb3VzIiwicHJvamVjdF9pZCI6ImNsb3VkMS1kN2dzbjV0MHc2NDA3Yjk2MyIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0.WUfZMR3W2CD5KuFo3AWr4Gx5NsYKlD1rO7UGwdL7z9AlPWyfjz0sBLkO6HAiTjp2NpoeoLPCFJcROc6DFUutGfD8e3AW9i_5ILjY-pKkF9vdbO3-TKnZXoSuYtoHz2fKqR5JnJ63mDDv1eZ8D4yQo-ldLeMxX-ak6M4Mbl1sBkEi8mfmg8NH7Bd7RK6haYCatdksaBIBdHvx8_98oIj86LsW4hH-R8AXcPtEqRqrP0nu-5L_NQBymaYXGJvbflLsBGl5BYN-pfxR-hyknEHtgYD08dSzcTHLlTAAnXhd4rU-ALdc9TRCDJgpfyBdxvIOJCZLjv3booy1qcV8tmk4lw';
  var COLL = 'tracker_data';
  var LS_LAST = 'at_cb_last';
  var LOGK = 'at_sync_log';
  var LS_REG = 'at_reg_pending';   /* v2.11.0：注册中的「待验证」状态，持久化后可跨刷新续用 */
  var CONSOLE_URL = 'https://tcb.cloud.tencent.com/dev?envId=' + ENV + '#/identity/login-manage';
  var VERSION = ''; /* v2.13.0：版本单一源——运行期取主页面 AT_VERSION，本文件不再自立版本号 */

  function lg(kind, title, st){ try{ var all = JSON.parse(localStorage.getItem(LOGK) || '[]'); all.push({ id: 'LG' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), kind: kind, title: title, ok: st === 'ok' ? 1 : 0, fail: st === 'ok' ? 0 : 1, items: [], note: '', rolledBack: false }); localStorage.setItem(LOGK, JSON.stringify(all.slice(-80))); }catch(e){} }
  var app = null, auth = null, db = null, _timer = null;
  var _pendingVerify = null, _pendingEmail = '', _cooldown = null;
  var _sending = false;   /* v2.11.0：发信进行中（5~6 秒），用于真正锁住按钮 */

  function escH(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function boot(){
    if (app) return true;
    if (!window.cloudbase) return false;
    try {
      /* v2.42.0：persistence 显式写成 'local'。
         它是 CloudBase 的默认值，但「默认」这件事不该由 SDK 决定——
         一旦哪天默认改成 session，用户就会变成「关掉浏览器就要重登」，
         而这个 bug 从代码上完全看不出来。写死它，等于把「记住登录态」钉住。 */
      app = cloudbase.init({ env: ENV, region: REGION, accessKey: KEY, persistence: 'local', auth: { detectSessionInUrl: true } });
      auth = app.auth; db = app.database();
    } catch (e) { app = null; return false; }
    return true;
  }

  /* ===== v2.42.0 记住登录（用户令「登录之后记住登录状态和密码」）=====
     两件事得分开看，混在一起就会做错：
       ① **登录态**（token）：CloudBase 自己持久化（上面 persistence:'local'），
          但 token 有有效期，过期后 sess() 照样返回 null——这才是「隔一阵打开又要登录」
          的真正原因，跟有没有记住密码无关。
       ② **账号与密码**：只有本机记着，才能在 token 过期时**静默重新登录**，用户不被拦。

     密码怎么存：AES-GCM 加密，密钥是本机随机生成的 32 字节，跟密文一起放在
     `credentials_` 前缀下。这个前缀在 index.html 的 SECRET_KEY_RE 里被**导出与云同步
     双双剔除**——也就是说它不会进备份包、也不会被同步到云端，换设备拿不到。
     剩下的风险只有本机：能翻这台电脑 localStorage 的人可以解出密码。
     这与浏览器自带的「记住密码」防护级别相同，界面上如实写明，不夸大。

     退出登录 = 清除记住的凭据。否则「退出」只是把界面换成登录框，一刷新又自己登回去，
     那颗按钮就成了假的。 */
  var LS_REM = 'credentials_at_login';       /* { v, id, box:{salt,iv,data}, at } */
  var LS_REMK = 'credentials_at_login_key';  /* 本机设备密钥（同样被导出剔除） */

  function _remKeyBytes(){
    try {
      var s = localStorage.getItem(LS_REMK);
      if (s) { var a = unb64(s); if (a && a.length === 32) return a; }
      var k = crypto.getRandomValues(new Uint8Array(32));
      localStorage.setItem(LS_REMK, b64(k));
      return k;
    } catch (e) { return null; }
  }
  async function _remKey(){
    var raw = _remKeyBytes(); if (!raw) throw new Error('本机不支持安全存储');
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async function rememberSave(id, pass){
    try {
      if (!id || !pass) return false;
      var key = await _remKey();
      var iv = crypto.getRandomValues(new Uint8Array(12));
      /* 账号也一并加密，不在外层留明文。代价是 peek 只能回答「有没有」而答不出是哪个号
         —— 这个信息量足够（面板要显示账号时走 rememberLoad），没必要为它留一个明文洞。 */
      var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key,
        new TextEncoder().encode(JSON.stringify({ id: String(id), pass: String(pass) })));
      localStorage.setItem(LS_REM, JSON.stringify({ v: 1, iv: b64(iv), data: b64(ct), at: new Date().toISOString() }));
      return true;
    } catch (e) { return false; }
  }
  async function rememberLoad(){
    try {
      var raw = localStorage.getItem(LS_REM); if (!raw) return null;
      var o = JSON.parse(raw); if (!o || !o.data || !o.iv) return null;
      var key = await _remKey();
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.data));
      var j = JSON.parse(new TextDecoder().decode(pt));
      return (j && j.id && j.pass) ? { id: String(j.id), pass: String(j.pass) } : null;
    } catch (e) { return null; }
  }
  function rememberClear(){
    try { localStorage.removeItem(LS_REM); } catch (e) {}
  }
  /* 只回「有没有」和「什么时候记的」，不碰密码也不解账号（账号也在密文里）。
     要显示/预填就走 rememberLoad。 */
  function rememberPeek(){
    try {
      var raw = localStorage.getItem(LS_REM); if (!raw) return null;
      var o = JSON.parse(raw); return (o && o.data) ? { has: true, at: o.at || '' } : null;
    } catch (e) { return null; }
  }
  /* 自动登录：token 还在就直接返回；不在就用记住的凭据静默重登。
     失败一律静默——它跑在开机那条路上，没网、没组件都不该弹东西打扰人。
     但「密码不对」这类**永久**失败要清掉记住的凭据，否则每次开机都白试一遍。 */
  async function autoSignIn(){
    try {
      if (!boot()) return null;
      var u = await sess(); if (u) return u;
      var c = await rememberLoad(); if (!c) return null;
      var u2 = await signIn(c.id, c.pass);
      lg('auth', '按记住的账号自动登录：' + userName(u2), 'ok');
      return u2;
    } catch (e) {
      var t = ''; try { t = errText(e, 'login'); } catch (e2) { t = ''; }
      /* 只有「凭据本身不对」才清。网络不通、组件没加载、超时这些**一律不清**——
         断网时开一次 App 就把记住的密码抹掉，是最招人烦的那种自作聪明：
         用户什么都没做错，回来却发现又要重新输一遍。
         （这条是 e2e 逼出来的：测试里把网络掐掉，凭据当场被清，R06 直接红。） */
      var offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      var looksNet = offline || /网络|超时|未加载|连不上|断网|timeout|network|fetch|offline/i.test(t);
      var badCred = /密码|不存在|未注册|不正确|错误|失效/i.test(t);
      if (badCred && !looksNet) {
        rememberClear();
        lg('auth', '记住的登录已失效，已清除（' + t + '），下次手动登录可重新记住', 'warn');
      }
      return null;
    }
  }

  /* 错误翻译：把 CloudBase/SDK 报错翻成用户能看懂的中文；ctx: signup|login|generic
     ------------------------------------------------------------------
     v2.11.0 重写。旧版只把 message/status/helpMessage 拼成一串去正则匹配，
     实测有两个问题：
       ① 真实验证码错误的 message 是 Go 的格式化残留：
          "无效的验证码%!(EXTRA string=rpc error: code = InvalidArgument desc = ...)"
          旧版能命中，靠的是 helpMessage 里的中文「校验失败」——
          也就是说 message 本身压根没被认出来，腾讯一改文案就退化成吐乱码。
       ② 6 个不同的错误原文（缺 messageId / 验证码错 / 验证码过期 …）都会带上
          "[CloudBase Auth]" 前缀和一大段排错建议，正则很容易撞车。
     新策略：优先读结构化字段 category / status / errorCode（这些是稳定枚举），
             字段认不出来时才退回文本匹配；最后统一剥掉 %!(EXTRA ...) 残留。 */

  /* 剥掉 Go fmt 的 %!(EXTRA ...) / %!s(MISSING) 之类残渣，只留人话 */
  function cleanMsg(s){
    s = String(s || '');
    var i = s.indexOf('%!');
    if (i >= 0) s = s.slice(0, i);          /* 残渣都在尾部，砍掉即可 */
    return s.replace(/\s+/g, ' ').trim();
  }

  function errText(e, ctx){
    var s = '', c = '', d = '', h = '', cat = '', ec = '';
    try { s = String((e && (e.message || e.errMsg || e.msg)) || ''); } catch (x) {}
    try { c = String((e && (e.status || e.code || e.error_code)) || ''); } catch (x) {}
    try { d = String((e && (e.error_description || e.description)) || ''); } catch (x) {}
    try { h = String((e && e.helpMessage) || ''); } catch (x) {}
    try { cat = String((e && e.category) || ''); } catch (x) {}
    try { ec = String((e && e.errorCode) || ''); } catch (x) {}
    var all = s + ' ' + c + ' ' + d + ' ' + h + ' ' + cat;

    /* —— 第一优先：结构化字段（稳定，不受文案影响）—— */
    if (cat === 'VERIFICATION_FAILED') {
      /* 注意：细分「过期」还是「不对」只能看文本，但**不能拿 helpMessage 去判** ——
         实测的 helpMessage 是一份「常见原因清单」，里面同时列了
         「验证码已过期」「验证码输入不正确」两条，拿它匹配必然误判成「过期」。
         所以这里只认 message/status 这两处真正的结论性文本。 */
      var concl = s + ' ' + c + ' ' + d;
      if (/expire|过期|失效/i.test(concl)) return '验证码已过期，请重新获取';
      return '验证码不正确，请检查后重填';
    }
    if (cat === 'INVALID_CREDENTIALS' || c === 'invalid_username_or_password') return '邮箱/用户名或密码不正确';
    if (cat === 'USER_ALREADY_EXISTS' || c === 'user_already_exists') return '这个邮箱已经注册过了，可直接登录';
    if (cat === 'RATE_LIMITED' || ec === '429') return '操作太频繁，请等 1 分钟再试';

    /* —— 第二优先：注册上下文里「账号不存在」= 云端没开邮箱登录 —— */
    if (/provider email not found/i.test(all)) return 'PROVIDER_OFF';
    if (ctx === 'signup' && /not[_ ]?found|不存在|USER_NOT_FOUND/i.test(all)) return 'PROVIDER_OFF';

    /* —— 第三优先：其余按关键词兜底 —— */
    if (all.indexOf('You must provide either an email or phone number') >= 0) return '请填写有效邮箱（当前账号体系使用邮箱注册）';
    if (/messageId is required|token is required/i.test(all)) return '验证凭证已失效，请重新点「获取验证码」';
    if (/invalid_verification_code|验证码(错误|不正确|无效|校验失败)|verification code does not match/i.test(all)) return '验证码不正确，请检查后重填';
    if (/verification_?code.*(expired|过期)|expired/i.test(all)) return '验证码已过期，请重新获取';
    if (/too many|frequent|频繁|限流|exceeded|429/i.test(all)) return '操作太频繁，请等 1 分钟再试';
    if (/user_already_exists|already (been )?registered|已被注册|已注册|已存在/i.test(all)) return '这个邮箱已经注册过了，可直接登录';
    if (/you already have username/i.test(all)) return '这个账号已经绑定过用户名了（一个账号只能绑一次）';
    if (/does not match regex pattern|invalid.*EditProfileRequest.Username/i.test(all)) return '平台规则：登录用户名须 6–25 位、小写英文开头（不支持中文）';
    if (/invalid.*username|用户名(格式|不合规)|INVALID_USERNAME/i.test(all)) return '平台规则：登录用户名须 6–25 位、小写英文开头（不支持中文）';
    if (/password/i.test(all) && /invalid|格式|weak|至少|不符|too short/i.test(all)) return '云端不收这个密码（本机只要求 6–32 位，云端可能还要求含字母和数字）——加长或混入字母再试';
    if (/network|Failed to fetch|timeout|超时|NetworkError|ERR_/i.test(all)) return '网络不给力，请检查网络后重试';
    if (/not_found|不存在|USER_NOT_FOUND/i.test(all)) return ctx === 'login' ? '账号不存在或未注册——请先注册一个' : '找不到对应账号（可先注册）';

    /* —— 最后：把 message 洗干净再给用户，绝不吐 %!(EXTRA ...) —— */
    var clean = cleanMsg(s);
    if (clean && clean !== '[object Object]') return clean;
    try { var jx = JSON.stringify(e); if (jx && jx !== '{}' && jx !== 'null') return cleanMsg(jx).slice(0, 220); } catch (x) {}
    return '操作失败，请稍后重试';
  }

  function providerOffHtml(){
    return '云端还没开启「邮箱登录」，暂时无法发送验证码。<br/>开通方法（约 2 分钟）：云开发控制台 → <b>身份认证 → 登录方式</b> → 开启「邮箱登录」，并按提示配置发件邮箱（SMTP）。<br/>' +
      '<a href="' + CONSOLE_URL + '" target="_blank" rel="noopener" style="color:var(--accent)">在浏览器打开控制台去开启 →</a>';
  }

  function isEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()); }
  function pwdOk(p){ p = String(p || ''); return p.length >= 6 && p.length <= 32; }
  function userOk(u){
    /* CloudBase 后端正则（实测）：^$|^[a-z][0-9a-z:_-]{5,24}$ —— 小写字母开头，6–25 位 */
    return /^[a-z][0-9a-z:_-]{5,24}$/.test(String(u || '').trim());
  }

  var _userCache = null; /* v2.13.1 修复：acctStatus() 同步调 current()，而 sess() 是 async——返回的 Promise 恒为真值，状态条永远显示「已登录」。这里缓存最近一次 sess() 的真实结果供 current() 同步读取。 */
  async function sess(){
    if (!boot()) { _userCache = null; return null; }
    try {
      var r = await auth.getSession();
      try { window._cbSessionDump = JSON.stringify((r && r.data) || {}).slice(0, 2000); } catch (e0) {}
      var s = r && r.data && r.data.session;
      if (!s) { _userCache = null; return null; }
      var u = (r.data.user) || s.user || { uid: (s && (s.uid || s.sub)) || '' };
      _userCache = u;
      return u;
    } catch (e) { _userCache = null; return null; }
  }

  function uidOf(u){
    if (!u) return '';
    var cands = [u.uid, u.sub, u.userid, u.userId, u.identifier, u.customUserId];
    for (var i = 0; i < cands.length; i++) { if (cands[i]) return String(cands[i]); }
    try {
      for (var k in u) {
        if (!Object.prototype.hasOwnProperty.call(u, k)) continue;
        var v = u[k];
        if (typeof v === 'string' && /^\d{15,25}$/.test(v)) return v;
        if (v && typeof v === 'object') {
          var c2 = [v.uid, v.sub, v.userid, v.userId];
          for (var j = 0; j < c2.length; j++) { if (c2[j]) return String(c2[j]); }
        }
      }
    } catch (e) {}
    return '';
  }

  function userName(u){
    if (!u) return '';
    var n = u.username || u.nickname || u.nickName || u.name || '';
    if (n) return n;
    if (u.email) return u.email;
    var id = uidOf(u);
    return id ? ('用户' + id.slice(-4)) : '账号';
  }

  function docId(uid){ return 'u_' + uid; }

  /* ===== v2.32.0 豆瓣凭据跨设备（凭据云）=====
     问题：豆瓣 Cookie 现在只存在 PC 的网关里（:3000 的 douban-account.json），
     手机上的 127.0.0.1 是手机自己，够不到 PC ⇒ 每次都得在手机上再粘一遍。
     做法：Cookie 加密后单独存一份云文档，换设备登录同一账号后自动取回。

     为什么单独一份文档、而不是塞进 packAll 的 payload：
     packAll 是全量 localStorage 打包，片单/进度/设置都混在里面。凭据混进去的后果是
     ①导出备份会把 Cookie 一起带出去；②任何一次云端读取都会碰到它。分开存，边界才清楚。

     密钥从哪来：**从账号密码派生**（PBKDF2-SHA256，12万次迭代）。
     这样密文只有本人能解 —— 就算云数据库被别人读到，拿到的也是一堆乱码。
     代价：忘了密码就解不开 Cookie，只能重粘一次。这是刻意的取舍：
     把凭据安全寄托在「只有你知道的那串字符」上，而不是「云存储本身可靠」上。*/
  var CRED_COLL = 'tracker_creds';
  function credDocId(uid){ return 'c_' + uid; }
  var PBKDF2_ITERS = 120000;

  function b64(buf){
    var bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(str){
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* 从密码派生 AES-GCM 密钥。盐存在文档里 —— 盐不需要保密，它的用处是让同一密码
     在不同文档下算出不同密钥，避免一份密文的模式泄露到另一份。 */
  async function deriveKey(password, saltB64){
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    var salt = unb64(saltB64);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptCred(password, obj){
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveKey(password, b64(salt));
    var plain = new TextEncoder().encode(JSON.stringify(obj));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
    return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct), at: new Date().toISOString() };
  }
  async function decryptCred(password, box){
    var key = await deriveKey(password, box.salt);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function saveCred(secretObj, password){
    var u = await sess(); if (!u) throw new Error('未登录');
    var uid = uidOf(u); if (!uid) throw new Error('登录态缺少 uid');
    if (!password) throw new Error('需要账号密码来加密凭据');
    var box = await encryptCred(password, secretObj);
    var rec = { ownerId: uid, kind: 'douban', box: box, updatedAt: new Date().toISOString() };
    try { await db.collection(CRED_COLL).add(Object.assign({ _id: credDocId(uid) }, rec)); }
    catch (e1) {
      var r = await db.collection(CRED_COLL).doc(credDocId(uid)).update(rec);
      if (!(r && r.updated > 0)) throw new Error('凭据上传未生效');
    }
    try { localStorage.setItem('at_db_cred', JSON.stringify({ at: rec.updatedAt })); } catch (e) {}
    return true;
  }
  async function loadCred(password){
    var u = await sess(); if (!u) return null;
    var uid = uidOf(u); if (!uid) return null;
    var r;
    try { r = await db.collection(CRED_COLL).doc(credDocId(uid)).get(); }
    catch (e) { return null; }
    var doc = r && r.data;
    if (!doc || !doc.box) return null;
    if (!password) throw new Error('需要账号密码来解密凭据');
    try { return await decryptCred(password, doc.box); }
    catch (e) { throw new Error('解密失败 —— 密码不对，或这份凭据是别的账号存的'); }
  }
  /* 存过没有：只查存在性，不需要密码。用于面板上如实告诉用户「云端有一份，要不要取」。 */
  async function credExists(){
    var u = await sess(); if (!u) return null;
    var uid = uidOf(u); if (!uid) return null;
    try {
      var r = await db.collection(CRED_COLL).doc(credDocId(uid)).get();
      var d = r && r.data;
      return (d && d.box) ? { at: d.updatedAt, has: true } : { has: false };
    } catch (e) { return { has: false }; }
  }
  async function clearCred(){
    var u = await sess(); if (!u) return;
    var uid = uidOf(u); if (!uid) return;
    try { await db.collection(CRED_COLL).doc(credDocId(uid)).remove(); } catch (e) {}
    try { localStorage.removeItem('at_db_cred'); } catch (e) {}
  }

  /* ===== 导出给页面用的门面 ===== */
  window.AT_CRED = {
    save: saveCred, load: loadCred, exists: credExists, clear: clearCred,
    /* 页面用它把 Cookie 交上来加密。Cookie 只在这一刻出现在内存里，落盘落云的都是密文。 */
    async stashDouban(cookie, uid, password){
      return saveCred({ kind: 'douban', cookie: cookie, uid: uid, savedAt: Date.now() }, password);
    },
    async takeDouban(password){
      var o = await loadCred(password);
      if (!o || o.kind !== 'douban' || !o.cookie) return null;
      return o;
    }
  };

  async function peek(){
    var u = await sess(); if (!u) return null;
    var uid = uidOf(u); if (!uid) return null;
    try {
      var r = await db.collection(COLL).where({ ownerId: uid }).limit(2).get();
      return ((r && r.data) || [])[0] || null;
    } catch (e) { return null; }
  }

  /* v2.13.0：凭证/机器级 key 永不上云（复用主页面共享正则） */
  var SKIP_RE = (window.AT_BACKUP && window.AT_BACKUP.secretRe)
    ? window.AT_BACKUP.secretRe
    : /^credentials_|^user_info_|^at_bgm_token$|^at_net_relay$|^device_id$|^tr_dav$|^at_ai_cfg$/;
  function packAll(){
    var all = { app: 'anitracker-full', version: 3, exportedAt: new Date().toISOString(), data: {} };
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (SKIP_RE.test(k)) continue;
      all.data[k] = localStorage.getItem(k);
    }
    return JSON.stringify(all);
  }

  /* ===== v2.13.0 逐剧冲突合并 =====
     旧行为：download() 把云端 payload 全量盲写本机。
     新行为：片单(tr_shows)按剧粒度用 updAt 时钟三方合并（删除靠 at_tomb 墓碑传播），
     其余 key 只补本机没有的——设备级设置（主题/折叠/开关）不互踩。 */
  function applyCloudMerge(payloadStr){
    var res = { changedAny: false, onlyCloud: 0, merged: 0, dropped: 0 };
    var all; try { all = JSON.parse(payloadStr); } catch (e) { return res; }
    if (!all || all.app !== 'anitracker-full') return res;
    var rem = all.data || {};
    var M = window.AT_MERGE, B = window.AT_BACKUP;
    var TK = (M && M.tombKey) || 'at_tomb';
    try {
      var lShows = JSON.parse(localStorage.getItem('tr_shows') || '[]');
      var cShows = JSON.parse(rem['tr_shows'] || '[]');
      var tL = JSON.parse(localStorage.getItem(TK) || '{}');
      var tC = JSON.parse(rem[TK] || '{}');
      if (M && Array.isArray(lShows) && Array.isArray(cShows)) {
        var r = M.mergeShows(lShows, cShows, tL, tC);
        var after = JSON.stringify(r.list);
        res.onlyCloud = r.stats.onlyCloud; res.merged = r.stats.merged; res.dropped = r.stats.dropped;
        if (after !== JSON.stringify(lShows)) { localStorage.setItem('tr_shows', after); res.changedAny = true; }
        if (JSON.stringify(r.tomb) !== JSON.stringify(tL)) { localStorage.setItem(TK, JSON.stringify(r.tomb)); res.changedAny = true; }
      }
    } catch (e) { lg('cloud', '片单合并异常：' + ((e && e.message) || e), 'warn'); }
    try {
      var cleaned = B ? B.sanitize(rem).ok : rem;
      /* v2.35.0：豆瓣片单快照按「整份比时间，新的一方胜」合并，不进下面那条
         「别的 key 只补本机没有的」——不然电脑上刷新一百次，手机上还是第一次那份，
         用户看到的就是「同步没把豆瓣带过来」。 */
      var SN = (M && M.snapKeys) || [];
      res.snap = 0;
      for (var si = 0; si < SN.length; si++) {
        var sk = SN[si];
        if (!(sk in cleaned)) continue;
        var pick = (M && M.mergeSnap) ? M.mergeSnap(localStorage.getItem(sk), cleaned[sk]) : null;
        if (pick != null && pick !== localStorage.getItem(sk)) { localStorage.setItem(sk, pick); res.changedAny = true; res.snap++; }
      }
      for (var k in cleaned) {
        if (k === 'tr_shows' || k === TK || SN.indexOf(k) >= 0) continue;
        if (localStorage.getItem(k) === null) { localStorage.setItem(k, cleaned[k]); res.changedAny = true; }
      }
    } catch (e) { lg('cloud', '杂项合并异常：' + ((e && e.message) || e), 'warn'); }
    return res;
  }

  /* 云端是否领先本机（有本机未合并过的更新） */
  async function remoteAhead(){
    var last = lastInfo();
    if (!last || !last.at) return null;
    var doc = await peek();
    if (doc && doc.updatedAt && doc.payload && new Date(doc.updatedAt) > new Date(last.at)) return doc;
    return null;
  }

  async function upload(silent){
    var u = await sess();
    if (!u) throw new Error('未登录');
    var uid = uidOf(u);
    if (!uid) throw new Error('登录态缺少 uid');
    /* v2.13.0 先合后传：云端有本机没见过的更新 → 合并进本机并整页刷新，本次上传作废
       （刷新后数据已是双方并集，不会丢另一台设备的修改） */
    try {
      var ahead = await remoteAhead();
      if (ahead) {
        var st = applyCloudMerge(ahead.payload);
        try { localStorage.setItem(LS_LAST, JSON.stringify({ at: ahead.updatedAt })); } catch (e) {}
        lg('cloud', '上传前发现云端更新，已合并（+' + st.onlyCloud + ' 部自云端，' + st.merged + ' 部并集，-' + st.dropped + ' 部已删）' + (st.changedAny ? '，刷新页面' : ''), 'ok');
        if (st.changedAny) { location.reload(); return; }
      }
    } catch (e) { /* 检查失败不阻断上传，走原覆盖逻辑 */ }
    var payload = packAll();
    var rec = { ownerId: uid, payload: payload, app: 'anitracker-full', updatedAt: new Date().toISOString() };
    /* set 会被规则按 update 评估（新文档无 owner 可查 → 拒），所以先 add 建、已存在再 update */
    try {
      await db.collection(COLL).add(Object.assign({ _id: docId(uid) }, rec));
    } catch (e1) {
      var r = await db.collection(COLL).doc(docId(uid)).update(rec);
      if (!(r && r.updated > 0)) throw new Error('上传未生效（' + ((e1 && e1.message) || 'update 返回 0') + '）');
    }
    try { localStorage.setItem(LS_LAST, JSON.stringify({ at: rec.updatedAt })); } catch (e) {}
    lg('cloud', '云同步：上传成功', 'ok');
    if (!silent) toast('已上传到云端 ✔');
  }

  async function download(){
    var u = await sess();
    if (!u) throw new Error('未登录');
    var uid = uidOf(u);
    if (!uid) throw new Error('登录态缺少 uid');
    var r;
    try { r = await db.collection(COLL).where({ ownerId: uid }).limit(2).get(); } catch (e) { throw new Error('读取云端失败（网络或登录过期，请退出重登）'); }
    var doc = ((r && r.data) || [])[0];
    if (!doc || !doc.payload) throw new Error('云端还没有备份——先在本机点「立即上传」');
    /* v2.13.0：由「全量覆盖本机」改为「逐剧合并」——本机更新的修改不会被云端旧数据冲掉 */
    var st = applyCloudMerge(doc.payload);
    try { localStorage.setItem(LS_LAST, JSON.stringify({ at: doc.updatedAt || new Date().toISOString() })); } catch (e) {}
    lg('cloud', '云同步：合并完成（自云端 +' + st.onlyCloud + '、并集 ' + st.merged + '、删 ' + st.dropped + '）', 'ok');
    return { changed: !!st.changedAny, stats: st };
  }

  function lastInfo(){
    try { return JSON.parse(localStorage.getItem(LS_LAST) || 'null'); } catch (e) { return null; }
  }

  /* --- 注册状态持久化（v2.11.0 新增）---
     ------------------------------------------------------------------
     为什么要做：signUp() 只返回 { data: { verifyOtp: 函数 } } ——
     一个闭包，**没有任何明文凭证**，只能存在内存变量里。
     但正常注册流程是：点「获取验证码」→ 去邮箱收信（几十秒到几分钟）→ 回来填码。
     这中间只要刷新页面 / 切后台被系统回收 / 误触返回，闭包就没了，
     用户只能从头再来，而且完全不知道为什么会失败。

     解法：resend({email, type:'signup'}) 会返回一个可持久化的 messageId
     （实测是一个 JWT，payload = { e: 邮箱, exp: +10分钟, pj: 环境ID }）。
     auth.verifyOtp({ token, messageId }) 是独立方法，能拿它重建验证能力。
     所以：把 { email, messageId, at } 存进 localStorage，刷新后照样能验证。

     注意：仍然优先用内存里的闭包（少一次网络往返）；
     只有闭包不存在（比如刚刷新过）时才走 messageId 这条路。 */
  function saveRegPending(email, messageId){
    try {
      if (!email) { localStorage.removeItem(LS_REG); return; }
      localStorage.setItem(LS_REG, JSON.stringify({
        email: email, messageId: messageId || '', at: Date.now(),
      }));
    } catch (e) {}
  }
  function loadRegPending(){
    try {
      var p = JSON.parse(localStorage.getItem(LS_REG) || 'null');
      if (!p || !p.email || !p.at) return null;
      /* 验证码默认 10 分钟有效，留 30 秒余量；过期就丢掉，避免用户对着死凭证白填 */
      if (Date.now() - p.at > 9.5 * 60 * 1000) { localStorage.removeItem(LS_REG); return null; }
      return p;
    } catch (e) { return null; }
  }
  function clearRegPending(){
    try { localStorage.removeItem(LS_REG); } catch (e) {}
    _pendingVerify = null; _pendingEmail = '';
  }
  /* 从 persist 态恢复出「还能不能验证」的能力判断 */
  function regResumable(){
    if (_pendingVerify || _pendingEmail) return true;   /* 内存里有闭包 */
    var p = loadRegPending();
    return !!(p && p.messageId);                         /* 或者有可用的 messageId */
  }

  /* --- 注册（v2.6.1 新链路）：邮箱+密码 → 发验证码；返回 verifyOtp 句柄 --- */
  async function startSignUp(email, password){
    if (!boot()) throw new Error('云组件未加载（需联网）');
    var r = await auth.signUp({ email: email, password: password });
    if (r && r.error) throw r.error;
    if (!(r && r.data && typeof r.data.verifyOtp === 'function')) throw new Error('验证码发送失败，请稍后重试');

    /* 顺手取一个可持久化的 messageId，这样用户收信期间刷新也不会白填。
       拿不到不影响主流程（仍可用内存闭包验证），所以失败就静默降级。 */
    var mid = '';
    try {
      var rs = await auth.resend({ email: email, type: 'signup' });
      if (rs && rs.data && rs.data.messageId) mid = rs.data.messageId;
    } catch (eR) {}
    saveRegPending(email, mid);
    return r.data.verifyOtp;
  }

  /* 完成注册：验证码校验 → 建号（邮箱已注册时会直接登录）→ 可选绑定用户名 */
  async function finishSignUp(verifyFn, code, username, email){
    var r;
    if (verifyFn) {
      r = await verifyFn({ token: code });
    } else {
      /* 刷新过 → 内存闭包没了，改用 messageId 重建 */
      var p = loadRegPending();
      if (!p || !p.messageId) throw new Error('验证凭证已失效，请重新点「获取验证码」');
      r = await auth.verifyOtp({ token: code, messageId: p.messageId });
    }
    if (r && r.error) throw r.error;
    /* 注意：SDK 这一步失败时是「返回 error」而不是「抛异常」，上面已拦。
       成功时 data.user/data.session 可能仍然为 null（要看具体版本），
       所以用 sess() 复核一次真实登录态，别被 data 的空壳骗了。 */
    var u = await sess();
    if (!u) throw new Error('验证成功但登录态没建立起来，请用邮箱 + 密码登录一次');
    var bound = '';
    if (username) {
      bound = await bindUsername(username);
    }
    clearRegPending();
    return { user: u, bound: bound };
  }

  /* 绑定用户名（注册时可选、登录后也能补绑）—— 抽出来两处共用 */
  async function bindUsername(username){
    if (!userOk(username)) throw new Error('平台规则：登录用户名须 6–25 位、小写英文开头（不支持中文）');
    var cu = auth.currentUser || (await auth.getCurrentUser());
    var t = (cu && typeof cu.updateUsername === 'function') ? cu : (cu && cu.data && (cu.data.user || cu.data)) || cu;
    if (!t || typeof t.updateUsername !== 'function') throw new Error('登录态异常，请退出重登后再试');
    await t.updateUsername(username);
    return username;
  }

  /* --- 忘记密码（v2.17.0）：邮箱 → 云端发验证码，拿回一个改密句柄 ---
     SDK 的 resetPasswordForEmail 不返回布尔，而是返回 data.updateUser 闭包：
     拿它带 {nonce: 邮件里的验证码, password: 新密码} 调用，云端校验通过后顺带把这台设备登录上。 */
  async function startReset(email){
    if (!boot()) throw new Error('云组件未加载（需联网）');
    var r = await auth.resetPasswordForEmail(email);
    if (r && r.error) throw r.error;
    var fn = r && r.data && r.data.updateUser;
    if (typeof fn !== 'function') throw new Error('云端没吐出验证码（这个邮箱大概没注册过）');
    return fn;
  }
  async function finishReset(updateUser, code, password){
    var r = await updateUser({ nonce: code, password: password });
    if (r && r.error) throw r.error;
    var u = await sess();
    if (!u) throw new Error('密码已改但没自动登录上，请用新密码登录');
    return u;
  }

  /* --- 登录：邮箱或用户名 + 密码 --- */
  async function signIn(idOrEmail, password){
    if (!boot()) throw new Error('云组件未加载（需联网）');
    var org = String(idOrEmail || '').trim();
    var payload = isEmail(org) ? { email: org, password: password } : { username: org, password: password };
    var r = await auth.signInWithPassword(payload);
    if (r && r.error) throw r.error;
    var u = await sess();
    if (!u) throw new Error('登录态未生效，请重试');
    return u;
  }

  async function signOut(){ _userCache = null; if (auth) { try { await auth.signOut(); } catch (e) {} } }

  /* save() 时调用：同步过至少一次才自动上传，避免新设备空数据覆盖云端 */
  function autosync(){
    if (!lastInfo()) return;
    sess().then(function(u){
      if (!u) return;
      clearTimeout(_timer);
      _timer = setTimeout(function(){ upload(true).catch(function(){}); }, 5000);
    }).catch(function(){});
  }

  function fmtAt(iso){
    try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return iso || ''; }
  }

  function mount(box){
    var area = box.querySelector('#cbArea');
    if (!area) return;
    if (!boot()) { area.innerHTML = '<div class="mini" style="color:var(--muted)">云同步组件未加载（本次需联网加载一次，刷新重试）。</div>'; return; }
    /* v2.42.0：开面板时也走一遍自动登录——开机那次可能因为组件还没加载完而错过，
       用户点开账号却看到登录框，会以为「记住」没生效。这里补一次，代价只是一次 sess()。 */
    autoSignIn().then(function(u){ draw(area, u); })
      .catch(function(){ area.innerHTML = '<div class="mini" style="color:var(--danger)">云同步初始化失败，请刷新重试。</div>'; });
  }

  function startCooldown(btn){
    var left = 60; var ori = '获取验证码';
    if (_cooldown) { clearInterval(_cooldown); _cooldown = null; }
    btn.disabled = true;
    btn.textContent = '重发(' + left + 's)';
    _cooldown = setInterval(function(){
      left--;
      if (left <= 0) { clearInterval(_cooldown); _cooldown = null; btn.disabled = false; btn.textContent = ori; }
      else { btn.textContent = '重发(' + left + 's)'; }
    }, 1000);
  }

  function draw(area, u){
    if (u) {
      var last = lastInfo();
      area.innerHTML =
        '<div class="mini">已登录：<b style="color:var(--ink)">' + escH(userName(u)) + '</b>。改动会自动同步云端；换设备登录同一账号，点「从云端合并」即可。</div>' +
        '<div class="row2"><button class="b1" id="cbUp">立即上传</button><button class="b2" id="cbDown">从云端合并</button></div>' +
        '<div class="msg" id="cbMsg"></div>' +
        (last ? '<div class="tiny">上次上传：' + escH(fmtAt(last.at)) + '</div>' : '') +
        '<div class="row2" style="margin-top:8px"><button class="b3" id="cbOut">退出登录</button></div>';
      area.querySelector('#cbUp').onclick = async function(){
        var m = area.querySelector('#cbMsg'); m.textContent = '上传中…'; m.style.color = 'var(--muted)';
        try {
          /* v2.13.0：不再弹「覆盖云端」确认——upload 内部已先合后传，双方修改都保得住 */
          await upload(false); m.textContent = '';
        } catch (e) { m.textContent = '上传失败：' + errText(e); m.style.color = 'var(--danger)'; }
      };
      area.querySelector('#cbDown').onclick = async function(){
        var m = area.querySelector('#cbMsg');
        try {
          m.textContent = '合并中…'; m.style.color = 'var(--muted)';
          var res = await download();
          if (res && res.changed) {
            toast('已与云端合并（逐剧比对，不会丢另一台设备的修改），即将刷新');
            setTimeout(function(){ location.reload(); }, 800);
          } else {
            m.textContent = '云端没有需要合并的新数据'; m.style.color = 'var(--muted)';
          }
        } catch (e) { m.textContent = '合并失败：' + errText(e); m.style.color = 'var(--danger)'; }
      };
      area.querySelector('#cbOut').onclick = async function(){
        var cbu = await sess().catch(function(){ return null; });
        await signOut();
        /* v2.42.0：退出登录一并清掉记住的凭据。不清的话「退出」只是把界面换成登录框，
           刷新后自动登录又把他登回去 —— 那颗按钮就是假的。 */
        rememberClear();
        lg('auth', '退出登录' + (cbu ? '：' + userName(cbu) : '') + '（已清除本机的记住登录）', 'ok');
        draw(area, null);
      };
      return;
    }

    /* ================= v2.14.0：登录 / 注册 单屏（用户指令「还是太复杂」）=================
       v2.11 的双 Tab 版被否：Tab 条 + 「去注册」链接是同一功能的两个入口，纯冗余。
       新版：默认只给登录表单（邮箱+密码+按钮），注册只留底部一行小字入口；
       点「注册」原地换成注册表单（邮箱+密码+验证码），可一键换回。
       保留的实测修复：发信瞬间锁按钮（_sending + disabled）、验证码 4–8 位文案统一、
       刷新后凭 messageId 续注册。 */

    /* —— 密码框一律带「显示」切换（用户指令「加入登陆时的可视密码」）：
       手机端输入法在密码框里看不见自己打了什么，是这个页面上最容易火的一件事。 —— */
    function pwdRow(id, ph, ac){
      return '<div class="cbcode">' +
        '<input id="' + id + '" type="password" autocomplete="' + ac + '" placeholder="' + ph + '"/>' +
        '<button type="button" class="cbget cb-eye" data-eye="' + id + '">显示</button>' +
        '</div>';
    }

    /* —— 登录（默认屏） —— */
    var PANE_LOGIN =
      '<div id="cbPaneLogin" class="cbpane">' +
        '<label>邮箱</label>' +
        '<input id="cbUser" autocomplete="username" placeholder="you@example.com"/>' +
        '<label>密码</label>' +
        pwdRow('cbPass', '请输入密码', 'current-password') +
        /* v2.42.0「记住登录状态和密码」：默认勾上——用户要的就是「下次不用再敲」，
           再让他去勾一次等于没做。风险写在下面那行小字里，不藏在帮助文档里。 */
        '<label class="cbrem"><input type="checkbox" id="cbRemember" checked/> 记住登录状态和密码</label>' +
        '<div class="tiny cbnote">只存在这台设备，不进备份包、不上传云端；点「退出登录」即清除。</div>' +
        '<div class="msg" id="cbMsg"></div>' +
        '<div class="row2"><button class="b1" id="cbLogin" style="width:100%">登录</button></div>' +
        '<div class="tiny cbfoot">还没有账号？<a href="javascript:;" id="cbToReg">注册</a>' +
          '<span class="cbdot">·</span>忘了密码？<a href="javascript:;" id="cbToReset">重设</a></div>' +
      '</div>';

    /* —— 注册（点「注册」后整屏换成这个） —— */
    var PANE_REG =
      '<div id="cbPaneReg" class="cbpane" style="display:none">' +
        /* 顶部状态位：刷新续用时在这里说明「还差一步」，而不是把提示塞到表单底下 */
        '<div class="cbnotice" id="cbRegNotice" style="display:none"></div>' +
        '<label>邮箱</label>' +
        '<input id="cbEmail" type="email" autocomplete="email" placeholder="you@example.com"/>' +
        '<label>密码</label>' +
        pwdRow('cbEmailPass', '6–32 位，数字或字母都行', 'new-password') +
        '<label>验证码（点「获取」后去邮箱收，10 分钟内有效）</label>' +
        '<div class="cbcode">' +
          '<input id="cbCode" inputmode="numeric" autocomplete="one-time-code" placeholder="4–8 位验证码"/>' +
          '<button type="button" class="cbget" id="cbSendCode">获取验证码</button>' +
        '</div>' +
        '<div class="msg" id="cbRegMsg"></div>' +
        '<div class="row2"><button class="b1" id="cbFinish" style="width:100%">完成注册</button></div>' +
        '<div class="tiny cbfoot">已有账号？<a href="javascript:;" id="cbToLogin">返回登录</a></div>' +
      '</div>';

    /* —— 重设密码（点「重设」后整屏换成这个） —— */
    var PANE_RESET =
      '<div id="cbPaneReset" class="cbpane" style="display:none">' +
        '<label>注册邮箱</label>' +
        '<input id="cbRpEmail" type="email" autocomplete="email" placeholder="you@example.com"/>' +
        '<label>新密码</label>' +
        pwdRow('cbRpPass', '6–32 位，数字或字母都行', 'new-password') +
        '<label>验证码（点「获取」后去邮箱收）</label>' +
        '<div class="cbcode">' +
          '<input id="cbRpCode" inputmode="numeric" autocomplete="one-time-code" placeholder="4–8 位验证码"/>' +
          '<button type="button" class="cbget" id="cbRpSend">获取验证码</button>' +
        '</div>' +
        '<div class="msg" id="cbRpMsg"></div>' +
        '<div class="row2"><button class="b1" id="cbRpGo" style="width:100%">设新密码并登录</button></div>' +
        '<div class="tiny cbfoot">想起来了？<a href="javascript:;" id="cbRpBack">返回登录</a></div>' +
      '</div>';

    area.innerHTML = PANE_LOGIN + PANE_REG + PANE_RESET;

    /* v2.42.0：记住过就把账号和密码填回去。密码框仍是 password 类型——
       看不见但能直接点登录，这正是「记住密码」该有的样子（不是把明文打在屏幕上）。 */
    rememberLoad().then(function (c) {
      if (!c) return;
      var iu = area.querySelector('#cbUser'), ip = area.querySelector('#cbPass'), rm = area.querySelector('#cbRemember');
      if (iu && !iu.value) iu.value = c.id;
      if (ip && !ip.value) ip.value = c.pass;
      if (rm) rm.checked = true;
    }).catch(function () {});

    /* 密码明暗切换：整块面板重画后统一挂一遍，不必逐个输入框点名 */
    Array.prototype.forEach.call(area.querySelectorAll('.cb-eye'), function(b){
      b.onclick = function(){
        var i = area.querySelector('#' + b.getAttribute('data-eye'));
        if (!i) return;
        var show = i.type !== 'text';
        i.type = show ? 'text' : 'password';
        b.textContent = show ? '隐藏' : '显示';
      };
    });

    /* —— 单屏切换：只换三块面板的显隐，没有 Tab 条 —— */
    function showTab(which){
      var pL = area.querySelector('#cbPaneLogin'), pR = area.querySelector('#cbPaneReg'), pP = area.querySelector('#cbPaneReset');
      if (!pL || !pR || !pP) return;
      pL.style.display = which === 'login' ? '' : 'none';
      pR.style.display = which === 'reg' ? '' : 'none';
      pP.style.display = which === 'reset' ? '' : 'none';
      var f = area.querySelector(which === 'reg' ? '#cbEmail' : (which === 'reset' ? '#cbRpEmail' : '#cbUser'));
      if (f) setTimeout(function(){ try { f.focus(); } catch (e) {} }, 40);
    }
    var toReg = area.querySelector('#cbToReg');
    if (toReg) toReg.onclick = function(){ showTab('reg'); };
    var toLogin = area.querySelector('#cbToLogin');
    if (toLogin) toLogin.onclick = function(){ showTab('login'); };
    var toReset = area.querySelector('#cbToReset');
    if (toReset) toReset.onclick = function(){ showTab('reset'); };
    var rpBack = area.querySelector('#cbRpBack');
    if (rpBack) rpBack.onclick = function(){ showTab('login'); };

    /* —— 登录 —— */
    var doAuth = async function(){
      var idv = (area.querySelector('#cbUser').value || '').trim();
      var pass = area.querySelector('#cbPass').value;
      var m = area.querySelector('#cbMsg');
      if (!idv || !pass) { m.textContent = '请填写邮箱和密码'; m.style.color = 'var(--danger)'; return; }
      var btn = area.querySelector('#cbLogin');
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = '登录中…';
      m.textContent = ''; m.style.color = 'var(--muted)';
      try {
        var u2 = await signIn(idv, pass);
        lg('auth', '登录成功：' + userName(u2), 'ok');
        /* v2.42.0：勾了就记住（重写一遍，改密码后存的也是新的）；没勾就清掉，
           别让上一次的勾选在用户看不见的地方继续生效。 */
        var rm = area.querySelector('#cbRemember');
        if (rm && rm.checked) await rememberSave(idv, pass); else rememberClear();
        m.textContent = '';
        var doc = await peek().catch(function(){ return null; });
        draw(area, u2);
        if (!doc) { toast('登录成功——点「立即上传」把本机片单存上云'); }
        else { toast('欢迎回来——云端有你的备份，可点「从云端恢复」'); }
      } catch (e) {
        var t = errText(e, 'login');
        m.textContent = t;
        m.style.color = 'var(--danger)';
        btn.disabled = false; btn.textContent = '登录';
        lg('auth', '登录失败：' + t, 'fail');
      }
    };
    area.querySelector('#cbLogin').onclick = function(){ doAuth(); };
    /* 回车即登录/注册 —— 表单该有的行为，旧版没有 */
    ['#cbUser', '#cbPass'].forEach(function (sel) {
      var el = area.querySelector(sel);
      if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAuth(); });
    });

    /* —— 获取验证码 ——
       关键修复：发信要 5~6 秒，必须在「点击瞬间」就把按钮锁死。
       旧版是 await 之后才在 startCooldown 里禁用，中间这段真空期可以狂点。 */
    area.querySelector('#cbSendCode').onclick = async function(){
      var email = (area.querySelector('#cbEmail').value || '').trim();
      var pass = area.querySelector('#cbEmailPass').value;
      var m = area.querySelector('#cbRegMsg');
      var btn = area.querySelector('#cbSendCode');

      if (_sending) return;                                        /* 真·防重入 */
      if (!isEmail(email)) { m.textContent = '请先填写正确的邮箱地址'; m.style.color = 'var(--danger)'; return; }
      if (!pwdOk(pass)) { m.textContent = '密码设 6–32 位（纯数字或纯字母都行）'; m.style.color = 'var(--danger)'; return; }

      _sending = true;
      btn.disabled = true;                                          /* ← 立刻锁，不等 await */
      var _ori = btn.textContent;
      btn.textContent = '发送中…';
      m.textContent = '';
      m.style.color = 'var(--muted)';

      try {
        _pendingVerify = await startSignUp(email, pass);
        _pendingEmail = email;
        lg('auth', '注册：验证码已发送 ' + email, 'ok');
        m.innerHTML = '验证码已发到 <b>' + escH(email) + '</b>，去邮箱看看（可能在垃圾箱）。';
        m.style.color = 'var(--muted)';
        _sending = false;
        startCooldown(btn);                                         /* 交给冷却接管按钮文案 */
        var ic = area.querySelector('#cbCode');
        if (ic) ic.focus();
      } catch (e) {
        _sending = false;
        btn.disabled = false; btn.textContent = _ori;
        var t = errText(e, 'signup');
        if (t === 'PROVIDER_OFF') { m.innerHTML = providerOffHtml(); lg('auth', '注册失败：云端未开启邮箱登录', 'fail'); }
        else { m.textContent = t; lg('auth', '注册失败：' + t, 'fail'); }
        m.style.color = 'var(--danger)';
      }
    };

    /* —— 完成注册 ——
       刷新后 _pendingVerify 会丢，但 messageId 存在 localStorage 里，
       交给 finishSignUp(null, ...) 走重建路径，而不是干巴巴报「请先获取验证码」。 */
    area.querySelector('#cbFinish').onclick = async function(){
      var m = area.querySelector('#cbRegMsg');
      var btn = area.querySelector('#cbFinish');
      var code = (area.querySelector('#cbCode').value || '').trim();
      var email = (area.querySelector('#cbEmail').value || '').trim();

      if (!regResumable()) { m.textContent = '请先点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      /* 内存里有闭包时，邮箱必须一致（改了邮箱等于换了凭证）；
         走 messageId 重建时以持久化的邮箱为准，这里比对也能拦住误改。 */
      if (_pendingEmail && _pendingEmail !== email) { m.textContent = '邮箱已修改，请重新点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      if (!code) { m.textContent = '请填写邮件里的验证码'; m.style.color = 'var(--danger)'; return; }
      if (!/^\d{4,8}$/.test(code)) { m.textContent = '验证码是 4–8 位数字，请检查一下'; m.style.color = 'var(--danger)'; return; }
      if (btn.disabled) return;

      btn.disabled = true; btn.textContent = '验证中…';
      m.textContent = ''; m.style.color = 'var(--muted)';
      try {
        var res = await finishSignUp(_pendingVerify, code, '', email);
        lg('auth', '注册成功：' + (res.user ? userName(res.user) : email), 'ok');
        draw(area, res.user);
        toast('账号已创建——点「立即上传」把本机片单存上云');
      } catch (e) {
        var t = errText(e, 'signup');
        if (t === 'PROVIDER_OFF') { m.innerHTML = providerOffHtml(); }
        else { m.textContent = t; }
        m.style.color = 'var(--danger)';
        btn.disabled = false; btn.textContent = '完成注册';
        lg('auth', '注册失败：' + (t === 'PROVIDER_OFF' ? '云端未开启邮箱登录' : t), 'fail');
      }
    };

    /* —— 重设密码：先拿验证码（发信慢，点瞬间锁按钮，和注册同一套规矩）—— */
    var _rpUpdate = null, _rpMail = '';
    area.querySelector('#cbRpSend').onclick = async function(){
      var email = (area.querySelector('#cbRpEmail').value || '').trim();
      var m = area.querySelector('#cbRpMsg');
      var btn = area.querySelector('#cbRpSend');
      if (_sending) return;
      if (!isEmail(email)) { m.textContent = '请先填写正确的邮箱地址'; m.style.color = 'var(--danger)'; return; }
      _sending = true;
      btn.disabled = true;
      var _ori = btn.textContent;
      btn.textContent = '发送中…';
      m.textContent = ''; m.style.color = 'var(--muted)';
      try {
        _rpUpdate = await startReset(email);
        _rpMail = email;
        lg('auth', '重设密码：验证码已发送 ' + email, 'ok');
        m.innerHTML = '验证码已发到 <b>' + escH(email) + '</b>，去邮箱看看（可能在垃圾箱）。';
        m.style.color = 'var(--muted)';
        _sending = false;
        startCooldown(btn);
        var ic = area.querySelector('#cbRpCode');
        if (ic) ic.focus();
      } catch (e) {
        _sending = false;
        btn.disabled = false; btn.textContent = _ori;
        var t = errText(e, 'reset');
        if (t === 'PROVIDER_OFF') m.innerHTML = providerOffHtml();
        else m.textContent = t;
        m.style.color = 'var(--danger)';
        lg('auth', '重设密码失败：' + t, 'fail');
      }
    };
    area.querySelector('#cbRpGo').onclick = async function(){
      var m = area.querySelector('#cbRpMsg');
      var btn = area.querySelector('#cbRpGo');
      var email = (area.querySelector('#cbRpEmail').value || '').trim();
      var code = (area.querySelector('#cbRpCode').value || '').trim();
      var pass = area.querySelector('#cbRpPass').value;
      if (!_rpUpdate) { m.textContent = '先点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      if (_rpMail && _rpMail !== email) { m.textContent = '邮箱已修改，请重新点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      if (!/^\d{4,8}$/.test(code)) { m.textContent = '验证码是 4–8 位数字，请检查一下'; m.style.color = 'var(--danger)'; return; }
      if (!pwdOk(pass)) { m.textContent = '新密码设 6–32 位（纯数字或纯字母都行）'; m.style.color = 'var(--danger)'; return; }
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = '提交中…';
      m.textContent = ''; m.style.color = 'var(--muted)';
      try {
        var u = await finishReset(_rpUpdate, code, pass);
        _rpUpdate = null;
        lg('auth', '密码已重设：' + userName(u), 'ok');
        draw(area, u);
        toast('密码已重设，这台设备已经登录上了');
      } catch (e) {
        var t2 = errText(e, 'reset');
        m.textContent = t2; m.style.color = 'var(--danger)';
        btn.disabled = false; btn.textContent = '设新密码并登录';
        lg('auth', '重设密码失败：' + t2, 'fail');
      }
    };

    /* —— 开场定位 ——
       如果上次发过验证码还没完成注册（刷新过），直接把用户放回注册页并提示，
       而不是让他在「登录」tab 里对着空白发愣。 */
    var pend = loadRegPending();
    if (pend && pend.messageId) {
      showTab('reg');
      var pe = area.querySelector('#cbEmail');
      if (pe && pend.email) pe.value = pend.email;
      var pn = area.querySelector('#cbRegNotice');
      if (pn) {
        pn.style.display = '';
        pn.innerHTML = '<b>还差一步</b>：验证码已发到 ' + escH(pend.email) + '，填进下面第 2 步就能完成注册。';
      }
      var sc = area.querySelector('#cbSendCode');
      if (sc) { sc.textContent = '重新获取'; sc.disabled = false; }
    }
  }

  /* v2.10.0 新增：给 index.html 的「账号」面板用。
     isOn()    —— 是否「已登录且曾经同步过」（即自动上传会生效）。
                  注意：v2.9.x 的 index.html 曾在 try/catch 里调用 CBSync.isOn()，
                  但本文件当时并未导出它，导致状态条永远显示「云同步未开」。
                  这里补上导出，修掉那个静默失效。
     current() —— 同步取当前登录用户（可能为 null），供面板顶部显示「已登录：xxx」。 */
  function isOn(){ return !!lastInfo(); }
  function current(){ return _userCache; }

  /* v2.13.0 开机云合并：页面装载后查一次云端。
     另一台设备有更新 → 合并进本机并刷新（sessionStorage 守卫保证每会话只判一次，不会刷新循环）。 */
  async function startupMerge(){
    try {
      if (!boot()) return null;
      var u = await sess(); if (!u) return null;
      var doc = await remoteAhead(); if (!doc) return null;
      var st = applyCloudMerge(doc.payload);
      try { localStorage.setItem(LS_LAST, JSON.stringify({ at: doc.updatedAt })); } catch (e) {}
      if (st.changedAny) {
        lg('cloud', '开机合并云端更新：+' + st.onlyCloud + ' 部自云端、' + st.merged + ' 部并集、-' + st.dropped + ' 部已删，刷新生效', 'ok');
        location.reload();
      }
      return st;
    } catch (e) { lg('cloud', '开机云合并跳过（' + ((e && e.message) || '未知') + '）', 'warn'); return null; }
  }
  try {
    window.addEventListener('load', function(){
      if (sessionStorage.getItem('at_cb_boot_done')) return;
      sessionStorage.setItem('at_cb_boot_done', '1');
      /* v2.42.0：先自动登录，再跑开机云合并。
         顺序不能反——startupMerge 开头就是 `if (!u) return null`，
         没登录态它直接跳过，于是「记住登录」看着生效了，云端那份却永远合不进来。 */
      setTimeout(async function(){
        try { await autoSignIn(); } catch (e) {}
        try { await startupMerge(); } catch (e) {}
      }, 1200);
    });
  } catch (e) {}

  /* v2.42.0：导出记住登录的读写口。给门禁用（要能在不开面板的情况下验「存了能取回、
     退出会清掉」），也给将来可能的「换号」入口用。注意 peek 不碰密码，load 才解。 */
  window.AT_REMEMBER = { save: rememberSave, load: rememberLoad, clear: rememberClear, peek: rememberPeek };

  window.CBSync = { mount: mount, autosync: autosync, get version(){ return window.AT_VERSION || VERSION; }, isOn: isOn, current: current, startupMerge: startupMerge, applyCloudMerge: applyCloudMerge, autoSignIn: autoSignIn };
})();
