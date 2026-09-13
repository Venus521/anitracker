/* AniTracker 账号云同步（腾讯云开发 CloudBase）
   面板 ② 区容器 #cbArea 由本文件渲染；登录后数据自动上云，换设备登录即恢复。
   策略：新账号先手动"立即上传/从云端恢复"一次，之后 save() 防抖自动上传。 */
(function(){
  var ENV  = 'cloud1-d7gsn5t0w6407b963';
  var REGION = 'ap-shanghai';
  var KEY  = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9.eyJpc3MiOiJodHRwczovL2Nsb3VkMS1kN2dzbjV0MHc2NDA3Yjk2My5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9uIiwiYXVkIjoiY2xvdWQxLWQ3Z3NuNXQwdzY0MDdiOTYzIiwiZXhwIjo0MDkyOTc0MDY1LCJpYXQiOjE3ODkyOTA4NjUsIm5vbmNlIjoia3JfOFZhbXNURkthUmFWejVlMVZCdyIsImF0X2hhc2giOiJrcl84VmFtc1RGS2FSYVZ6NWUxVkJ3IiwibmFtZSI6IkFub255bW91cyIsInNjb3BlIjoiYW5vbnltb3VzIiwicHJvamVjdF9pZCI6ImNsb3VkMS1kN2dzbjV0MHc2NDA3Yjk2MyIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0.WUfZMR3W2CD5KuFo3AWr4Gx5NsYKlD1rO7UGwdL7z9AlPWyfjz0sBLkO6HAiTjp2NpoeoLPCFJcROc6DFUutGfD8e3AW9i_5ILjY-pKkF9vdbO3-TKnZXoSuYtoHz2fKqR5JnJ63mDDv1eZ8D4yQo-ldLeMxX-ak6M4Mbl1sBkEi8mfmg8NH7Bd7RK6haYCatdksaBIBdHvx8_98oIj86LsW4hH-R8AXcPtEqRqrP0nu-5L_NQBymaYXGJvbflLsBGl5BYN-pfxR-hyknEHtgYD08dSzcTHLlTAAnXhd4rU-ALdc9TRCDJgpfyBdxvIOJCZLjv3booy1qcV8tmk4lw';
  var COLL = 'tracker_data';
  var LS_LAST = 'at_cb_last';
  var LOGK = 'at_sync_log';
  function lg(kind, title, st){ try{ var all = JSON.parse(localStorage.getItem(LOGK) || '[]'); all.push({ id: 'LG' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), kind: kind, title: title, ok: st === 'ok' ? 1 : 0, fail: st === 'ok' ? 0 : 1, items: [], note: '', rolledBack: false }); localStorage.setItem(LOGK, JSON.stringify(all.slice(-80))); }catch(e){} }
  var app = null, auth = null, db = null, _timer = null;

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

  function errText(e){
    var m = (e && (e.message || e.errMsg || e.msg)) || e;
    var s = String(m || '未知错误');
    if (s.indexOf('invalid') >= 0 && s.toLowerCase().indexOf('password') >= 0) return '密码不对或格式不符（至少 8 位）';
    if (s.indexOf('not found') >= 0 || s.indexOf('不存在') >= 0) return '账号不存在——先点「创建一个」';
    if (s.indexOf('already') >= 0 || s.indexOf('已存在') >= 0 || s.indexOf('exist') >= 0) return '用户名已被注册——直接登录即可';
    return s;
  }

  async function sess(){
    if (!boot()) return null;
    try {
      var r = await auth.getSession();
      try { window._cbSessionDump = JSON.stringify(r && r.data || {}).slice(0, 2000); } catch (e0) {}
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
    var n = u.username || u.nickname || u.nickName || u.name || u.email || '';
    if (n) return n;
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

  async function signUp(username, password){
    if (!boot()) throw new Error('云组件未加载（需联网）');
    var r = await auth.signUp({ username: username, password: password });
    if (r && r.error) throw r.error;
    return r.data;
  }

  async function signIn(username, password){
    if (!boot()) throw new Error('云组件未加载（需联网）');
    var r = await auth.signInWithPassword({ username: username, password: password });
    if (r && r.error) throw r.error;
    return r.data;
  }

  async function signOut(){
    if (auth) { try { await auth.signOut(); } catch (e) {} }
  }

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

  function draw(area, u){
    if (u) {
      var last = lastInfo();
      area.innerHTML =
        '<div class="mini">已登录：<b style="color:var(--ink)">' + escH(userName(u)) + '</b>。改动会自动同步云端；换设备登录同一账号，点「从云端恢复」即可。</div>' +
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
      area.querySelector('#cbOut').onclick = async function(){
        await signOut(); draw(area, null);
      };
    } else {
      area.innerHTML =
        '<div class="mini" style="color:var(--muted)">登录后片单自动存云端；换设备登录同一账号即可恢复。</div>' +
        '<label>用户名</label><input id="cbUser" autocomplete="username" placeholder="字母或数字组合"/>' +
        '<label>密码（至少 8 位）</label><input id="cbPass" type="password" autocomplete="current-password"/>' +
        '<div class="msg" id="cbMsg"></div>' +
        '<div class="row2"><button class="b1" id="cbLogin">登录</button></div>' +
        '<div class="tiny" style="margin-top:8px"><a href="javascript:;" id="cbRegLink" style="color:var(--accent)">还没有账号？点此创建一个 →</a>（创建一次，手机电脑通用）</div>' +
        '<div id="cbRegBox" style="display:none;margin-top:8px">' +
          '<label>要创建的用户名</label><input id="cbNewUser" placeholder="字母或数字组合"/>' +
          '<label>设置密码（至少 8 位）</label><input id="cbNewPass" type="password"/>' +
          '<div class="row2"><button class="b3" id="cbRegGo">注册并登录</button></div>' +
        '</div>';
      var doAuth = async function(){
        var user = area.querySelector('#cbUser').value.trim();
        var pass = area.querySelector('#cbPass').value;
        var m = area.querySelector('#cbMsg');
        if (!user || !pass) { m.textContent = '先填用户名和密码'; m.style.color = 'var(--danger)'; return; }
        m.textContent = '登录中…'; m.style.color = 'var(--muted)';
        try {
          await signIn(user, pass);
          var u2 = await sess();
          if (!u2) throw new Error('登录态未生效，请重试');
          m.textContent = '';
          var doc = await peek().catch(function(){ return null; });
          draw(area, u2);
          if (!doc) { toast('登录成功——点「立即上传」把本机片单存上云'); }
          else { toast('欢迎回来——云端有你的备份，可点「从云端恢复」'); }
        } catch (e) {
          m.textContent = '登录失败：' + errText(e);
          m.style.color = 'var(--danger)';
        }
      };
      area.querySelector('#cbLogin').onclick = function(){ doAuth(); };
      var rl = area.querySelector('#cbRegLink');
      if (rl) { rl.onclick = function(){ var rb = area.querySelector('#cbRegBox'); if (rb) rb.style.display = (rb.style.display === 'none' ? '' : 'none'); }; }
      var rg = area.querySelector('#cbRegGo');
      if (rg) { rg.onclick = async function(){
        var m = area.querySelector('#cbMsg');
        var u = area.querySelector('#cbNewUser').value.trim();
        var p = area.querySelector('#cbNewPass').value;
        if (!u || !p || p.length < 8) { m.textContent = '用户名必填、密码至少 8 位'; m.style.color = 'var(--danger)'; return; }
        m.textContent = '注册中…'; m.style.color = 'var(--muted)';
        try {
          await signUp(u, p);
          await signIn(u, p);
          var u2 = await sess();
          if (!u2) throw new Error('注册成功但登录态未生效，请手动登录');
          draw(area, u2);
          toast('账号已创建——点「立即上传」把本机片单存上云');
        } catch (e) { m.textContent = '注册失败：' + errText(e); m.style.color = 'var(--danger)'; }
      }; }
    }
  }

  window.CBSync = { mount: mount, autosync: autosync };
})();
