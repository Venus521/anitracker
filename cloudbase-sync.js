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
  var CONSOLE_URL = 'https://tcb.cloud.tencent.com/dev?envId=' + ENV + '#/identity/login-manage';
  var VERSION = '2.7.0';

  function lg(kind, title, st){ try{ var all = JSON.parse(localStorage.getItem(LOGK) || '[]'); all.push({ id: 'LG' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), kind: kind, title: title, ok: st === 'ok' ? 1 : 0, fail: st === 'ok' ? 0 : 1, items: [], note: '', rolledBack: false }); localStorage.setItem(LOGK, JSON.stringify(all.slice(-80))); }catch(e){} }
  var app = null, auth = null, db = null, _timer = null;
  var _pendingVerify = null, _pendingEmail = '', _cooldown = null;

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

  /* 错误翻译：把 CloudBase/SDK 报错翻成用户能看懂的中文；ctx: signup|login|generic */
  function errText(e, ctx){
    var s = '', c = '', d = '', h = '';
    try { s = String((e && (e.message || e.errMsg || e.msg)) || ''); } catch (x) {}
    try { c = String((e && (e.status || e.code || e.error_code)) || ''); } catch (x) {}
    try { d = String((e && (e.error_description || e.description)) || ''); } catch (x) {}
    try { h = String((e && e.helpMessage) || ''); } catch (x) {}
    var all = s + ' ' + c + ' ' + d + ' ' + h;
    if (/provider email not found/i.test(all)) return 'PROVIDER_OFF';
    if (ctx === 'signup' && /not[_ ]?found|不存在|USER_NOT_FOUND/i.test(all)) return 'PROVIDER_OFF';
    if (all.indexOf('You must provide either an email or phone number') >= 0) return '请填写有效邮箱（当前账号体系使用邮箱注册）';
    if (/invalid_verification_code|验证码(错误|不正确|无效|校验失败)/i.test(all)) return '验证码不对，请检查后重试';
    if (/verification_?code.*(expired|过期)|expired/i.test(all)) return '验证码已过期，请重新获取';
    if (/too many|frequent|频繁|限流|exceeded|429/i.test(all)) return '尝试太频繁，请等 1 分钟再试';
    if (/you already have username/i.test(all)) return '这个账号已经绑定过用户名了（一个账号只能绑一次）';
    if (/does not match regex pattern|invalid.*EditProfileRequest.Username/i.test(all)) return '用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线（暂不支持中文与大写）';
    if (/invalid_username_or_password|用户名或密码不正确|INVALID_CREDENTIALS/i.test(all)) return '邮箱/用户名或密码不正确';
    if (/already|已存在|已注册|已被使用|已被注册|占用/i.test(all)) return '这个邮箱或用户名已被使用，可直接登录或换一个';
    if (/invalid.*username|用户名(格式|不合规)|INVALID_USERNAME/i.test(all)) return '用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线（暂不支持中文与大写）';
    if (/password/i.test(all) && /invalid|格式|weak|至少|不符/i.test(all)) return '密码需 8–32 位，且同时包含字母和数字';
    if (/network|Failed to fetch|timeout|超时|NetworkError|ERR_/i.test(all)) return '网络不给力，请检查网络后重试';
    if (/not_found|不存在|USER_NOT_FOUND/i.test(all)) return ctx === 'login' ? '账号不存在或未注册——请先「注册一个」' : '找不到对应账号（可先注册）';
    if (s && s !== '[object Object]') return s;
    try { var jx = JSON.stringify(e); if (jx && jx !== '{}' && jx !== 'null') return jx.slice(0, 220); } catch (x) {}
    return '未知错误，请稍后重试';
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

  /* --- 注册（v2.6.1 新链路）：邮箱+密码 → 发验证码；返回 verifyOtp 句柄 --- */
  async function startSignUp(email, password){
    if (!boot()) throw new Error('云组件未加载（需联网）');
    var r = await auth.signUp({ email: email, password: password });
    if (r && r.error) throw r.error;
    if (r && r.data && typeof r.data.verifyOtp === 'function') return r.data.verifyOtp;
    throw new Error('验证码发送失败，请稍后重试');
  }

  /* 完成注册：验证码校验 → 建号（邮箱已注册时会直接登录）→ 可选绑定用户名 */
  async function finishSignUp(verifyFn, code, username){
    var r = await verifyFn({ token: code });
    if (r && r.error) throw r.error;
    var u = await sess();
    if (!u) throw new Error('验证成功但登录态未生效，请稍后在登录区用邮箱登录');
    var bound = '';
    if (username) {
      try {
        var cu = auth.currentUser || (await auth.getCurrentUser());
        var t = (cu && typeof cu.updateUsername === 'function') ? cu : (cu && cu.data && (cu.data.user || cu.data)) || cu;
        if (t && typeof t.updateUsername === 'function') { await t.updateUsername(username); bound = username; }
      } catch (eB) { bound = ''; }
    }
    return { user: await sess(), bound: bound };
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

    /* 未登录：注册 / 登录 两个视图 */
    area.innerHTML =
      '<div class="mini" style="color:var(--muted)">登录后片单自动存云端；换设备登录同一账号即可恢复。</div>' +
      '<label>邮箱 或 用户名</label><input id="cbUser" autocomplete="username" placeholder="邮箱 / 用户名"/>' +
      '<label>密码</label><input id="cbPass" type="password" autocomplete="current-password"/>' +
      '<div class="msg" id="cbMsg"></div>' +
      '<div class="row2"><button class="b1" id="cbLogin">登录</button></div>' +
      '<div class="tiny" style="margin-top:8px"><a href="javascript:;" id="cbToReg" style="color:var(--accent)">还没有账号？注册一个 →</a></div>' +
      '<div id="cbRegBox" style="display:none;margin-top:10px;border-top:1px dashed var(--line,#ccc);padding-top:10px">' +
        '<div class="mini" style="color:var(--muted)">填邮箱 + 密码，收一个验证码就完成。换设备登录同一邮箱即可恢复片单。</div>' +
        '<label>邮箱</label><input id="cbEmail" type="email" autocomplete="email" placeholder="you@example.com"/>' +
        '<label>密码（8–32 位，需含字母和数字）</label><input id="cbEmailPass" type="password" autocomplete="new-password"/>' +
        '<label>邮箱验证码</label><input id="cbCode" inputmode="numeric" placeholder="6 位验证码"/>' +
        '<div class="row2"><button class="b2" id="cbSendCode" style="width:100%">获取验证码</button></div>' +
        
        '<div class="msg" id="cbRegMsg"></div>' +
        '<div class="row2"><button class="b1" id="cbFinish">完成注册</button></div>' +
      '</div>';

    var doAuth = async function(){
      var idv = area.querySelector('#cbUser').value.trim();
      var pass = area.querySelector('#cbPass').value;
      var m = area.querySelector('#cbMsg');
      if (!idv || !pass) { m.textContent = '请填写邮箱（或用户名）和密码'; m.style.color = 'var(--danger)'; return; }
      m.textContent = '登录中…'; m.style.color = 'var(--muted)';
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
        m.textContent = '登录失败：' + t;
        m.style.color = 'var(--danger)';
        lg('auth', '登录失败：' + t, 'fail');
      }
    };
    area.querySelector('#cbLogin').onclick = function(){ doAuth(); };
    var rl = area.querySelector('#cbToReg');
    if (rl) { rl.onclick = function(){ var rb = area.querySelector('#cbRegBox'); if (rb) rb.style.display = (rb.style.display === 'none' ? '' : 'none'); }; }

    area.querySelector('#cbSendCode').onclick = async function(){
      var email = area.querySelector('#cbEmail').value.trim();
      var pass = area.querySelector('#cbEmailPass').value;
      var m = area.querySelector('#cbRegMsg');
      if (!isEmail(email)) { m.textContent = '请先填写正确的邮箱地址'; m.style.color = 'var(--danger)'; return; }
      if (!pwdOk(pass)) { m.textContent = '密码需 8–32 位，且同时包含字母和数字'; m.style.color = 'var(--danger)'; return; }
      var btn = area.querySelector('#cbSendCode');
      if (btn.disabled) return;
      m.textContent = '正在发送验证码…'; m.style.color = 'var(--muted)';
      try {
        _pendingVerify = await startSignUp(email, pass);
        _pendingEmail = email;
        lg('auth', '注册：验证码已发送 ' + email, 'ok');
        m.innerHTML = '验证码已发送到 <b>' + escH(email) + '</b>（10 分钟内有效；没收到可看垃圾箱，或 60 秒后重发）。';
        m.style.color = 'var(--muted)';
        startCooldown(btn);
      } catch (e) {
        var t = errText(e, 'signup');
        if (t === 'PROVIDER_OFF') { m.innerHTML = providerOffHtml(); lg('auth', '注册失败：云端未开启邮箱登录', 'fail'); }
        else { m.textContent = '发送失败：' + t; lg('auth', '注册失败：' + t, 'fail'); }
        m.style.color = 'var(--danger)';
      }
    };

    area.querySelector('#cbFinish').onclick = async function(){
      var m = area.querySelector('#cbRegMsg');
      var code = (area.querySelector('#cbCode').value || '').trim();
      var uname = ''; var _nn = area.querySelector('#cbNewName'); if (_nn) uname = (_nn.value || '').trim();
      var email = area.querySelector('#cbEmail').value.trim();
      if (!_pendingVerify || !_pendingEmail) { m.textContent = '请先点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      if (_pendingEmail !== email) { m.textContent = '邮箱已修改，请重新点「获取验证码」'; m.style.color = 'var(--danger)'; return; }
      if (!/^\d{4,8}$/.test(code)) { m.textContent = '请输入邮件里的验证码'; m.style.color = 'var(--danger)'; return; }
      if (uname && !userOk(uname)) { m.textContent = '用户名需 6–25 位：小写字母开头，只能用小写字母 / 数字 / 下划线 / 短横线（暂不支持中文与大写）'; m.style.color = 'var(--danger)'; return; }
      m.textContent = '验证中…'; m.style.color = 'var(--muted)';
      try {
        var res = await finishSignUp(_pendingVerify, code, uname);
        _pendingVerify = null; _pendingEmail = '';
        lg('auth', '注册成功：' + (res.user ? userName(res.user) : email) + (res.bound ? '（已绑定用户名 ' + res.bound + '）' : ''), 'ok');
        draw(area, res.user);
        toast(res.bound ? ('账号已创建，用户名 ' + res.bound + ' 已绑定 ✔') : (uname ? '账号已创建（用户名绑定未完成，可稍后在账号区绑定）' : '账号已创建——点「立即上传」把本机片单存上云'));
      } catch (e) {
        var t = errText(e, 'signup');
        if (t === 'PROVIDER_OFF') { m.innerHTML = providerOffHtml(); } else { m.textContent = '注册失败：' + t; }
        m.style.color = 'var(--danger)';
        lg('auth', '注册失败：' + (t === 'PROVIDER_OFF' ? '云端未开启邮箱登录' : t), 'fail');
      }
    };
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
