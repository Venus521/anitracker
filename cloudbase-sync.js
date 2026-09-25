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
  var VERSION = '2.8.0';

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
      app = cloudbase.init({ env: ENV, region: REGION, accessKey: KEY, auth: { detectSessionInUrl: true } });
      auth = app.auth; db = app.database();
    } catch (e) { app = null; return false; }
    return true;
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
    if (/does not match regex pattern|invalid.*EditProfileRequest.Username/i.test(all)) return '用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线（暂不支持中文与大写）';
    if (/invalid.*username|用户名(格式|不合规)|INVALID_USERNAME/i.test(all)) return '用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线（暂不支持中文与大写）';
    if (/password/i.test(all) && /invalid|格式|weak|至少|不符|too short/i.test(all)) return '密码需 8–32 位，且同时包含字母和数字';
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
  function pwdOk(p){ p = String(p || ''); return p.length >= 8 && p.length <= 32 && /[A-Za-z]/.test(p) && /\d/.test(p); }
  function userOk(u){
    /* CloudBase 后端正则（实测）：^$|^[a-z][0-9a-z:_-]{5,24}$ —— 小写字母开头，6–25 位 */
    return /^[a-z][0-9a-z:_-]{5,24}$/.test(String(u || '').trim());
  }

  async function sess(){
    if (!boot()) return null;
    try {
      var r = await auth.getSession();
      try { window._cbSessionDump = JSON.stringify((r && r.data) || {}).slice(0, 2000); } catch (e0) {}
      var s = r && r.data && r.data.session;
      if (!s) return null;
      return (r.data.user) || s.user || { uid: (s && (s.uid || s.sub)) || '' };
    } catch (e) { return null; }
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

  async function peek(){
    var u = await sess(); if (!u) return null;
    var uid = uidOf(u); if (!uid) return null;
    try {
      var r = await db.collection(COLL).where({ ownerId: uid }).limit(2).get();
      return ((r && r.data) || [])[0] || null;
    } catch (e) { return null; }
  }

  var SKIP_RE = /^credentials_|^user_info_/;
  function packAll(){
    var all = { app: 'anitracker-full', version: 2, exportedAt: new Date().toISOString(), data: {} };
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (SKIP_RE.test(k) || k === 'device_id') continue;
      all.data[k] = localStorage.getItem(k);
    }
    return JSON.stringify(all);
  }

  async function upload(silent){
    var u = await sess();
    if (!u) throw new Error('未登录');
    var uid = uidOf(u);
    if (!uid) throw new Error('登录态缺少 uid');
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
    var all = JSON.parse(doc.payload);
    if (all.app !== 'anitracker-full') throw new Error('云端数据不是追迹备份');
    var n = 0;
    for (var k in all.data) { localStorage.setItem(k, all.data[k]); n++; }
    lg('cloud', '云同步：恢复 ' + n + ' 项', 'ok');
    return n;
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
    if (!userOk(username)) throw new Error('用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线（暂不支持中文与大写）');
    var cu = auth.currentUser || (await auth.getCurrentUser());
    var t = (cu && typeof cu.updateUsername === 'function') ? cu : (cu && cu.data && (cu.data.user || cu.data)) || cu;
    if (!t || typeof t.updateUsername !== 'function') throw new Error('登录态异常，请退出重登后再试');
    await t.updateUsername(username);
    return username;
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

  async function signOut(){ if (auth) { try { await auth.signOut(); } catch (e) {} } }

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
    sess().then(function(u){ draw(area, u); }).catch(function(){ area.innerHTML = '<div class="mini" style="color:var(--danger)">云同步初始化失败，请刷新重试。</div>'; });
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
      var uname = u.username || '';
      area.innerHTML =
        '<div class="mini">已登录：<b style="color:var(--ink)">' + escH(userName(u)) + '</b>' + (u.email && uname ? '（' + escH(u.email) + '）' : '') + '。改动会自动同步云端；换设备登录同一账号，点「从云端恢复」即可。</div>' +
        (!uname ? '<div class="mini">用户名（可选，一个账号只能设一次）：<button type="button" id="cbBindGen" style="background:none;border:none;color:var(--accent);cursor:pointer;padding:0;font-size:12px">帮我生成一个</button></div><input id="cbBindName" placeholder="点「帮我生成」或自行填写"/><div class="msg" id="cbBindMsg"></div><div class="row2"><button class="b3" id="cbBind" style="width:100%">绑定用户名</button></div>' : '') +
        '<div class="row2"><button class="b1" id="cbUp">立即上传</button><button class="b2" id="cbDown">从云端恢复</button></div>' +
        '<div class="msg" id="cbMsg"></div>' +
        (last ? '<div class="tiny">上次上传：' + escH(fmtAt(last.at)) + '</div>' : '') +
        '<div class="row2" style="margin-top:8px"><button class="b3" id="cbOut">退出登录</button></div>';
      area.querySelector('#cbUp').onclick = async function(){
        var m = area.querySelector('#cbMsg'); m.textContent = '上传中…'; m.style.color = 'var(--muted)';
        try {
          var doc = await peek();
          if (doc && doc.updatedAt && lastInfo() && new Date(doc.updatedAt) > new Date(lastInfo().at || 0)) {
            if (!confirm('云端备份较新（' + fmtAt(doc.updatedAt) + '），确定用本机数据覆盖云端吗？')) { m.textContent = ''; return; }
          }
          await upload(false); m.textContent = '';
        } catch (e) { m.textContent = '上传失败：' + errText(e); m.style.color = 'var(--danger)'; }
      };
      area.querySelector('#cbDown').onclick = async function(){
        var m = area.querySelector('#cbMsg');
        try {
          var doc = await peek();
          if (!doc || !doc.payload) throw new Error('云端还没有备份——先点「立即上传」');
          if (!confirm('将用云端备份（' + fmtAt(doc.updatedAt) + '）覆盖本机数据，继续吗？')) return;
          m.textContent = '恢复中…'; m.style.color = 'var(--muted)';
          var n = await download();
          toast('已恢复 ' + n + ' 项，即将刷新');
          setTimeout(function(){ location.reload(); }, 700);
        } catch (e) { m.textContent = '恢复失败：' + errText(e); m.style.color = 'var(--danger)'; }
      };
      var genBtn = area.querySelector('#cbBindGen');
      if (genBtn) {
        genBtn.onclick = function () {
          var base = String(u.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!base || /^[^a-z]/.test(base)) base = 'at' + base;
          base = base.slice(0, 14);
          while (base.length < 6) base += String(Math.floor(Math.random() * 10));
          base += String(Math.floor(Math.random() * 90) + 10);
          var inp = area.querySelector('#cbBindName');
          if (inp) inp.value = base;
          var mb = area.querySelector('#cbBindMsg');
          if (mb) { mb.textContent = '已生成，点「绑定用户名」确认即可'; mb.style.color = 'var(--muted)'; }
        };
      }
      var bindBtn = area.querySelector('#cbBind');
      if (bindBtn) {
        bindBtn.onclick = async function(){
          var m = area.querySelector('#cbBindMsg');
          var name = (area.querySelector('#cbBindName').value || '').trim();
          if (!userOk(name)) { m.textContent = '用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线（暂不支持中文与大写）'; m.style.color = 'var(--danger)'; return; }
          m.textContent = '绑定中…'; m.style.color = 'var(--muted)';
          try {
            var cu = auth.currentUser || (await auth.getCurrentUser());
            var t = (cu && typeof cu.updateUsername === 'function') ? cu : (cu && cu.data && (cu.data.user || cu.data)) || cu;
            if (!t || typeof t.updateUsername !== 'function') throw new Error('登录态异常，请退出重登后再试');
            await t.updateUsername(name);
            lg('auth', '绑定用户名成功：' + name, 'ok');
            toast('用户名 ' + name + ' 绑定成功 ✔');
            draw(area, await sess());
          } catch (e) { m.textContent = '绑定失败：' + errText(e); m.style.color = 'var(--danger)'; lg('auth', '绑定用户名失败', 'fail'); }
        };
      }
      area.querySelector('#cbOut').onclick = async function(){
        var cbu = await sess().catch(function(){ return null; });
        await signOut();
        lg('auth', '退出登录' + (cbu ? '：' + userName(cbu) : ''), 'ok');
        draw(area, null);
      };
      return;
    }

    /* ================= v2.11.0：登录 / 注册 双 Tab（参考 B 站）=================
       旧版的毛病（都是实测出来的）：
       ① 注册藏在「还没有账号？注册一个 →」一行小字后面，默认 display:none，
          用户根本不知道这里有注册；
       ② 展开后是一整坨表单，登录和注册的字段混在同一屏，分不清现在是哪个流程；
       ③ 「获取验证码」发信要 5~6 秒（实测 5237~5802ms），
          但 btn.disabled 在 await 期间**从来没被置 true**（守卫形同虚设），
          用户看界面不动就狂点，点几次就真发几封邮件；
       ④ 提示写死「6 位验证码」，校验却是 /^\d{4,8}$/，自相矛盾。

       新版：两个 Tab 明确切换、当前 Tab 高亮；发信期间真锁按钮 + 转圈态；
             验证码一行内联「获取验证码」；文案统一为「4–8 位」。 */

    var TABS =
      '<div class="cbtabs" role="tablist">' +
        '<button type="button" class="cbtab on" id="cbTabLogin" role="tab" aria-selected="true">登录</button>' +
        '<button type="button" class="cbtab" id="cbTabReg" role="tab" aria-selected="false">注册</button>' +
      '</div>';

    /* —— 登录面板 —— */
    var PANE_LOGIN =
      '<div id="cbPaneLogin" class="cbpane">' +
        '<div class="mini" style="color:var(--muted);margin-bottom:10px">用注册时的<b style="color:var(--ink)">邮箱</b>登录；绑过用户名的也可以用用户名。</div>' +
        '<label>邮箱 / 用户名</label>' +
        '<input id="cbUser" autocomplete="username" placeholder="you@example.com"/>' +
        '<label>密码</label>' +
        '<input id="cbPass" type="password" autocomplete="current-password" placeholder="请输入密码"/>' +
        '<div class="msg" id="cbMsg"></div>' +
        '<div class="row2"><button class="b1" id="cbLogin" style="width:100%">登录</button></div>' +
        '<div class="tiny" style="margin-top:10px;text-align:center;color:var(--muted)">还没有账号？' +
          '<a href="javascript:;" id="cbToReg" style="color:var(--accent)">去注册 →</a></div>' +
      '</div>';

    /* —— 注册面板 —— */
    var PANE_REG =
      '<div id="cbPaneReg" class="cbpane" style="display:none">' +
        /* 顶部状态位：刷新续用时在这里说明「还差一步」，而不是把提示塞到表单底下 */
        '<div class="cbnotice" id="cbRegNotice" style="display:none"></div>' +
        '<div class="cbstep"><span class="n">1</span>填邮箱和密码</div>' +
        '<label>邮箱</label>' +
        '<input id="cbEmail" type="email" autocomplete="email" placeholder="you@example.com"/>' +
        '<label>密码</label>' +
        '<input id="cbEmailPass" type="password" autocomplete="new-password" placeholder="8–32 位，需含字母和数字"/>' +
        '<div class="cbstep"><span class="n">2</span>去邮箱收验证码（10 分钟内有效）</div>' +
        '<div class="cbcode">' +
          '<input id="cbCode" inputmode="numeric" autocomplete="one-time-code" placeholder="4–8 位验证码"/>' +
          '<button type="button" class="cbget" id="cbSendCode">获取验证码</button>' +
        '</div>' +
        '<div class="msg" id="cbRegMsg"></div>' +
        '<details class="cbopt" id="cbNameFold">' +
          '<summary>顺便设个用户名（可选）</summary>' +
          '<div class="tiny" style="color:var(--muted);margin:6px 0">6–25 位，小写字母开头，只能用 a-z / 0-9 / _ / -。设了以后就能用它登录。' +
            '<button type="button" id="cbNameGen" style="background:none;border:none;color:var(--accent);cursor:pointer;padding:0;font-size:inherit">帮我生成一个</button></div>' +
          '<input id="cbNewName" placeholder="留空则不设" autocomplete="off"/>' +
        '</details>' +
        '<div class="row2"><button class="b1" id="cbFinish" style="width:100%">完成注册</button></div>' +
        '<div class="tiny" style="margin-top:10px;text-align:center;color:var(--muted)">已有账号？' +
          '<a href="javascript:;" id="cbToLogin" style="color:var(--accent)">去登录 →</a></div>' +
      '</div>';

    area.innerHTML = TABS + PANE_LOGIN + PANE_REG;

    /* —— Tab 切换 —— */
    function showTab(which){
      var isReg = which === 'reg';
      var tL = area.querySelector('#cbTabLogin'), tR = area.querySelector('#cbTabReg');
      var pL = area.querySelector('#cbPaneLogin'), pR = area.querySelector('#cbPaneReg');
      if (!tL || !tR || !pL || !pR) return;
      tL.className = 'cbtab' + (isReg ? '' : ' on');
      tR.className = 'cbtab' + (isReg ? ' on' : '');
      tL.setAttribute('aria-selected', isReg ? 'false' : 'true');
      tR.setAttribute('aria-selected', isReg ? 'true' : 'false');
      pL.style.display = isReg ? 'none' : '';
      pR.style.display = isReg ? '' : 'none';
      var f = area.querySelector(isReg ? '#cbEmail' : '#cbUser');
      if (f) setTimeout(function(){ try { f.focus(); } catch (e) {} }, 40);
    }
    area.querySelector('#cbTabLogin').onclick = function(){ showTab('login'); };
    area.querySelector('#cbTabReg').onclick = function(){ showTab('reg'); };
    var toReg = area.querySelector('#cbToReg');
    if (toReg) toReg.onclick = function(){ showTab('reg'); };
    var toLogin = area.querySelector('#cbToLogin');
    if (toLogin) toLogin.onclick = function(){ showTab('login'); };

    /* —— 用户名生成（注册时那个可选项）—— */
    var nameGen = area.querySelector('#cbNameGen');
    if (nameGen) {
      nameGen.onclick = function () {
        var em = (area.querySelector('#cbEmail') || {}).value || '';
        var base = String(em).split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!base || /^[^a-z]/.test(base)) base = 'at' + base;
        base = base.slice(0, 12);
        while (base.length < 6) base += String(Math.floor(Math.random() * 10));
        base += String(Math.floor(Math.random() * 90) + 10);
        var inp = area.querySelector('#cbNewName');
        if (inp) { inp.value = base; inp.focus(); }
      };
    }

    /* —— 登录 —— */
    var doAuth = async function(){
      var idv = (area.querySelector('#cbUser').value || '').trim();
      var pass = area.querySelector('#cbPass').value;
      var m = area.querySelector('#cbMsg');
      if (!idv || !pass) { m.textContent = '请填写邮箱（或用户名）和密码'; m.style.color = 'var(--danger)'; return; }
      var btn = area.querySelector('#cbLogin');
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = '登录中…';
      m.textContent = ''; m.style.color = 'var(--muted)';
      try {
        var u2 = await signIn(idv, pass);
        lg('auth', '登录成功：' + userName(u2), 'ok');
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
      if (!pwdOk(pass)) { m.textContent = '密码需 8–32 位，且同时包含字母和数字'; m.style.color = 'var(--danger)'; return; }

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
      var nn = area.querySelector('#cbNewName');
      var uname = nn ? (nn.value || '').trim() : '';
      var email = (area.querySelector('#cbEmail').value || '').trim();

      if (!regResumable()) { m.textContent = '请先点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      /* 内存里有闭包时，邮箱必须一致（改了邮箱等于换了凭证）；
         走 messageId 重建时以持久化的邮箱为准，这里比对也能拦住误改。 */
      if (_pendingEmail && _pendingEmail !== email) { m.textContent = '邮箱已修改，请重新点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      if (!code) { m.textContent = '请填写邮件里的验证码'; m.style.color = 'var(--danger)'; return; }
      if (!/^\d{4,8}$/.test(code)) { m.textContent = '验证码是 4–8 位数字，请检查一下'; m.style.color = 'var(--danger)'; return; }
      if (uname && !userOk(uname)) { m.textContent = '用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线'; m.style.color = 'var(--danger)'; return; }
      if (btn.disabled) return;

      btn.disabled = true; btn.textContent = '验证中…';
      m.textContent = ''; m.style.color = 'var(--muted)';
      try {
        var res = await finishSignUp(_pendingVerify, code, uname, email);
        lg('auth', '注册成功：' + (res.user ? userName(res.user) : email), 'ok');
        draw(area, res.user);
        toast(res.bound ? ('账号已创建，用户名 ' + res.bound + ' 已绑定 ✔') : '账号已创建——点「立即上传」把本机片单存上云');
      } catch (e) {
        var t = errText(e, 'signup');
        if (t === 'PROVIDER_OFF') { m.innerHTML = providerOffHtml(); }
        else { m.textContent = t; }
        m.style.color = 'var(--danger)';
        btn.disabled = false; btn.textContent = '完成注册';
        lg('auth', '注册失败：' + (t === 'PROVIDER_OFF' ? '云端未开启邮箱登录' : t), 'fail');
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
  function current(){ return sess().catch(function(){ return null; }); }

  window.CBSync = { mount: mount, autosync: autosync, version: VERSION, isOn: isOn, current: current };
})();
