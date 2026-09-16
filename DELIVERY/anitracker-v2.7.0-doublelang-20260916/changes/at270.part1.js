/* =====================================================================
   AniTracker v2.7.0 模块（一）：防丢草稿 · 联想引擎 · 手动添加
   —— 由修复会话注入；不改动主脚本既有代码，全部以运行时增强实现。
   ===================================================================== */
(function () {
  'use strict';
  var AT270 = window.AT270 = window.AT270 || {};
  AT270.V = '2.7.0';

  /* ---------- 小工具 ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function makeEl(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function pad(n) { return n < 10 ? ('0' + n) : ('' + n); }
  function fmt(t) { try { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); } catch (e) { return ''; } }
  function logEdit(sid, kind, detail) {
    try {
      var L = lsGet('at_edit_log', []);
      L.push({ at: Date.now(), sid: String(sid || ''), kind: kind, detail: String(detail || '').slice(0, 300), by: '本机' });
      if (L.length > 300) L = L.slice(-300);
      lsSet('at_edit_log', L);
    } catch (e) {}
  }
  AT270.logEdit = logEdit;

  /* =====================================================================
     一、防丢草稿系统
     - 白名单弹层在「点空白关闭 / ESC 关闭」前自动保存已填内容
     - 重新打开时显示「恢复草稿 / 丢弃」横幅
     ===================================================================== */
  var DRAFT_MASKS = ['syncMask', 'at270AddMask', 'at270ProfMask', 'at270RelMask'];
  function collectDraft(mask) {
    var fields = {}, els = mask.querySelectorAll('input,textarea,select');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (!e.id) continue;
      var v = (e.type === 'checkbox' || e.type === 'radio') ? (e.checked ? '1' : '') : String(e.value == null ? '' : e.value);
      if (!v || !v.trim()) continue;
      fields[e.id] = { v: v, t: e.type || 'text' };
    }
    return fields;
  }
  function saveMaskDraft(mask) {
    if (!mask || !mask.id || DRAFT_MASKS.indexOf(mask.id) < 0) return false;
    var fields = collectDraft(mask);
    var D = lsGet('at_drafts', {});
    if (!Object.keys(fields).length) {
      if (D[mask.id]) { delete D[mask.id]; lsSet('at_drafts', D); }
      return false;
    }
    D[mask.id] = { at: Date.now(), fields: fields };
    lsSet('at_drafts', D);
    try { toast('已自动保存草稿（' + Object.keys(fields).length + ' 项），重新打开可一键恢复'); } catch (e) {}
    return true;
  }
  function clearDraftFor(id) { var D = lsGet('at_drafts', {}); if (D[id]) { delete D[id]; lsSet('at_drafts', D); } }
  AT270.clearDraftFor = clearDraftFor;
  function restoreDraft(mask, draft) {
    var n = 0, ks = Object.keys(draft.fields || {});
    for (var i = 0; i < ks.length; i++) {
      var id = ks[i], f = draft.fields[id];
      var e = mask.querySelector('[id="' + id + '"]');
      if (!e) continue;
      try {
        if (e.type === 'checkbox') e.checked = (f.v === '1');
        else { e.value = f.v; e.dispatchEvent(new Event('input', { bubbles: true })); }
        n++;
      } catch (x) {}
    }
    return n;
  }
  function removeBanner(mask) { var b = mask.querySelector('.at270band'); if (b) b.remove(); }
  function showDraftBanner(mask) {
    if (!mask || !mask.id || DRAFT_MASKS.indexOf(mask.id) < 0) return;
    var D = lsGet('at_drafts', {}), d = D[mask.id];
    if (!d) return;
    var ks = Object.keys(d.fields || {}), has = false;
    for (var i = 0; i < ks.length; i++) { if (mask.querySelector('[id="' + ks[i] + '"]')) { has = true; break; } }
    if (!has) { delete D[mask.id]; lsSet('at_drafts', D); return; }
    removeBanner(mask);
    var b = makeEl('<div class="at270band"><span>发现 ' + fmt(d.at) + ' 未完成的草稿（' + ks.length + ' 项已保存）</span><span class="sp"></span><button type="button" class="pri">恢复草稿</button><button type="button">丢弃</button></div>');
    var bs = b.querySelectorAll('button');
    bs[0].addEventListener('click', function () {
      var n = restoreDraft(mask, d);
      removeBanner(mask);
      try { toast('已恢复 ' + n + ' 项草稿内容'); } catch (e) {}
    });
    bs[1].addEventListener('click', function () {
      var DD = lsGet('at_drafts', {}); delete DD[mask.id]; lsSet('at_drafts', DD);
      removeBanner(mask);
      try { toast('草稿已丢弃'); } catch (e) {}
    });
    var panel = mask.querySelector('.panel') || mask;
    panel.insertBefore(b, panel.firstChild);
  }
  /* 捕获阶段：点空白（mask 背板）→ 先存草稿，再让原关闭逻辑执行 */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('mask')) saveMaskDraft(t);
  }, true);
  /* ESC 关闭 → 先存草稿 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var ms = document.querySelectorAll('.mask');
    for (var i = 0; i < ms.length; i++) saveMaskDraft(ms[i]);
  }, true);
  /* 弹层出现 → 检查草稿横幅 */
  try {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var nodes = m.addedNodes || [];
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n && n.nodeType === 1 && n.classList && n.classList.contains('mask')) {
            (function (mask) { setTimeout(function () { try { showDraftBanner(mask); } catch (e) {} }, 320); })(n);
          }
        }
      });
    }).observe(document.body, { childList: true });
  } catch (e) {}

  /* =====================================================================
     二、联想引擎（输入候选，一键填入）
     支持：#qKw（番剧池）、#libQ（番剧池）、#qFilter（当前番集池）、
           #at270RelKw、#at270AddTitle（后可预填原文名/年份/集数）
     ===================================================================== */
  function seriesPool() {
    var out = [];
    try {
      (window.shows || []).forEach(function (s) {
        out.push({ k: 'own', sid: String(s.sid), t: s.title || '', jp: s.nameJp || '', al: (s.aliases || []).join(' / '), y: s.year || '', n: s.total || 0 });
      });
    } catch (e) {}
    try {
      (window.INTERNAL_SHOWS || []).forEach(function (s) {
        out.push({ k: 'lib', id: s.id, t: s.title || '', jp: s.nameJp || '', al: (s.aliases || []).join(' / '), y: s.year || '', n: s.total || 0 });
      });
    } catch (e) {}
    return out;
  }
  function epPool() {
    var out = [];
    try {
      if (typeof bySid === 'function' && typeof curSid !== 'undefined') {
        var s = bySid(curSid);
        if (!s) return out;
        (s.eps || []).forEach(function (e) {
          out.push({ k: 'ep', s: e.s, t: e.t || ('第 ' + e.s + ' 集'), jp: e.tOrig || e.tCn || '' });
        });
      }
    } catch (e) {}
    return out;
  }
  var SUG_FOR = {
    qKw: seriesPool, libQ: seriesPool, at270RelKw: seriesPool, at270AddTitle: seriesPool, qFilter: epPool
  };
  var _sugBox = null, _sugInput = null, _sugItems = [], _sugSel = -1, _sugT = null;
  function ensureSugBox() { if (!_sugBox) { _sugBox = makeEl('<div class="at270sug"></div>'); document.body.appendChild(_sugBox); } return _sugBox; }
  function hideSug() { if (_sugBox) _sugBox.style.display = 'none'; _sugInput = null; _sugItems = []; _sugSel = -1; }
  function showSug(inp) {
    var provider = SUG_FOR[inp.id];
    if (!provider) return;
    var q = normTxt(inp.value);
    if (!q) { hideSug(); return; }
    var pool = provider(), hits = [];
    for (var i = 0; i < pool.length && hits.length < 8; i++) {
      var it = pool[i];
      var hay = (it.t || '') + ' ' + (it.jp || '') + ' ' + (it.al || '') + ' ' + (it.k === 'ep' ? (' ' + it.s) : ('+ ' + (it.y || '')));
      if (normTxt(hay).indexOf(q) >= 0) hits.push(it);
    }
    if (!hits.length) { hideSug(); return; }
    _sugInput = inp; _sugItems = hits; _sugSel = -1;
    var box = ensureSugBox();
    var html = '';
    for (var j = 0; j < hits.length; j++) {
      var h = hits[j];
      if (h.k === 'ep') {
        html += '<div class="it" data-i="' + j + '"><span>第 ' + esc(String(h.s)) + ' 集' + (h.jp ? (' · ' + esc(h.jp)) : '') + '</span><span class="m">' + esc(String(h.t).slice(0, 36)) + '</span></div>';
      } else {
        html += '<div class="it" data-i="' + j + '"><span>' + esc(h.t) + (h.jp ? (' <span class="m">' + esc(h.jp) + '</span>') : '') + '</span><span class="m">' + (h.k === 'own' ? '片单' : '内置库') + (h.y ? (' · ' + esc(h.y)) : '') + '</span></div>';
      }
    }
    box.innerHTML = html;
    var items = box.querySelectorAll('.it');
    for (var k = 0; k < items.length; k++) {
      (function (node) {
        node.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        node.addEventListener('click', function (ev) { ev.preventDefault(); pickSug(+node.getAttribute('data-i')); });
      })(items[k]);
    }
    var r = inp.getBoundingClientRect();
    box.style.left = Math.max(8, r.left) + 'px';
    box.style.top = (r.bottom + 6) + 'px';
    box.style.width = Math.min(Math.max(r.width, 280), window.innerWidth - 24) + 'px';
    box.style.display = 'block';
  }
  function moveSug(dir) {
    if (!_sugBox || !_sugItems.length) return;
    _sugSel += dir;
    if (_sugSel < 0) _sugSel = 0;
    if (_sugSel >= _sugItems.length) _sugSel = _sugItems.length - 1;
    var items = _sugBox.querySelectorAll('.it');
    for (var i = 0; i < items.length; i++) items[i].classList[_sugSel === i ? 'add' : 'remove']('on');
  }
  function pickSug(idx) {
    var it = _sugItems[idx], inp = _sugInput;
    if (!it || !inp) return;
    if (it.k === 'ep') {
      inp.value = String(it.s);
      try { if (typeof renderGrid === 'function') renderGrid(); } catch (e) {}
      hideSug(); try { inp.focus(); } catch (e) {}
      return;
    }
    inp.value = it.t;
    if (inp.id === 'at270AddTitle') {
      var jp = $('at270AddJp'); if (jp && !jp.value) jp.value = it.jp || '';
      var yr = $('at270AddYear'); if (yr && !yr.value) yr.value = it.y || '';
      var tt = $('at270AddTotal'); if (tt && !tt.value) tt.value = it.n || '';
    }
    if (inp.id === 'at270RelKw') {
      AT270._relPick = { k: it.k, sid: it.sid || '', id: it.id || '', t: it.t };
      try { toast('已选：《' + it.t + '》'); } catch (e) {}
    }
    if (inp.id === 'qKw') { try { doBgmSearch(); } catch (e) {} }
    if (inp.id === 'libQ') { try { if (typeof filterInternal === 'function') filterInternal(window.libType || 'all'); } catch (e) {} }
    hideSug();
  }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.id && SUG_FOR[t.id]) {
      clearTimeout(_sugT);
      _sugT = setTimeout(function () { try { showSug(t); } catch (x) {} }, 140);
    } else if (_sugInput && t !== _sugInput) { hideSug(); }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!_sugBox || _sugBox.style.display === 'none' || !_sugInput) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); moveSug(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); moveSug(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pickSug(_sugSel >= 0 ? _sugSel : 0); }
    else if (e.key === 'Escape') { e.stopPropagation(); hideSug(); }
  }, true);
  document.addEventListener('click', function (e) {
    if (_sugBox && _sugBox.style.display !== 'none' && !_sugBox.contains(e.target) && e.target !== _sugInput) hideSug();
  }, true);
  window.addEventListener('scroll', function () {
    if (_sugBox && _sugBox.style.display !== 'none' && _sugInput) {
      try { var r = _sugInput.getBoundingClientRect(); _sugBox.style.top = (r.bottom + 6) + 'px'; _sugBox.style.left = Math.max(8, r.left) + 'px'; } catch (e) {}
    }
  }, true);

  /* =====================================================================
     三、手动添加（覆盖旧 prompt 链，改为模态表单：双语剧名 + 别名 + 草稿保护）
     ===================================================================== */
  function closeMask(id) { var m = $(id); if (m) m.remove(); }
  function openAddModal() {
    var old = $('at270AddMask'); if (old) old.remove();
    var wrap = makeEl(
      '<div id="at270AddMask" class="mask"><div class="panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">手动添加番剧</h3><button type="button" id="at270AddX" style="background:none;border:none;font-size:20px;color:var(--muted)">×</button></div>' +
      '<div class="mini">本地添加，无需网络。建议同时填写「原文名」；别名支持一行一条，可写「台译: 航海王」这样的类型前缀。</div>' +
      '<label>中文名（必填）</label><input id="at270AddTitle" placeholder="如：海贼王" style="caret-color:var(--accent)"/>' +
      '<label>原文名（可选）</label><input id="at270AddJp" placeholder="如：ONE PIECE / ワンピース" />' +
      '<label>别名（可选，每行一条）</label><textarea id="at270AddAlias" rows="3" placeholder="台译: 航海王\n罗马字: ONE PIECE\n简称: 海贼"></textarea>' +
      '<div style="display:flex;gap:10px"><div style="flex:1"><label>年份（可选）</label><input id="at270AddYear" placeholder="1999"/></div>' +
      '<div style="flex:1"><label>总集数（可留空，之后可改）</label><input id="at270AddTotal" inputmode="numeric" placeholder="1168"/></div></div>' +
      '<div class="msg" id="at270AddMsg"></div>' +
      '<div class="row2"><button type="button" class="b2" id="at270AddCancel">取消</button><button type="button" class="b1" id="at270AddSave">保存并加入片单</button></div>' +
      '</div></div>');
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    $('at270AddX').addEventListener('click', function () { wrap.remove(); });
    $('at270AddCancel').addEventListener('click', function () { wrap.remove(); });
    $('at270AddSave').addEventListener('click', function () {
      var msg = $('at270AddMsg');
      function fail(s) { msg.textContent = s; msg.style.color = 'var(--danger)'; }
      var title = $('at270AddTitle').value.trim();
      if (!title) { fail('请填写中文名'); return; }
      var nt = normTxt(title);
      var dup = (window.shows || []).filter(function (x) { return normTxt(x.title) === nt; })[0];
      if (dup) { fail('已在片单：《' + dup.title + '》（未重复添加）'); return; }
      var jp = $('at270AddJp').value.trim();
      var alRaw = ($('at270AddAlias').value || '').split('\n');
      var aliases = [];
      alRaw.forEach(function (a) { a = a.trim(); if (a && aliases.indexOf(a) < 0) aliases.push(a); });
      var year = ($('at270AddYear').value || '').trim().slice(0, 4);
      var total = parseInt($('at270AddTotal').value, 10); if (isNaN(total) || total < 0) total = 0; if (total > 20000) total = 20000;
      var eps = [];
      for (var i = 1; i <= total; i++) eps.push({ s: i, t: '第 ' + i + ' 集' });
      var item = {
        sid: 'man-' + Date.now(), title: title, nameJp: jp, aliases: aliases, cover: '',
        year: year, total: total, eps: eps, statuses: {}, status: 'watching',
        addedAt: Date.now(), updAt: Date.now(), source: '手动添加', manual: 1
      };
      try {
        shows.push(item); save();
        logEdit(item.sid, '创建条目', '手动添加《' + title + '》' + (jp ? (' / ' + jp) : '') + (aliases.length ? ('；别名 ' + aliases.length + ' 条') : ''));
        clearDraftFor('at270AddMask');
        wrap.remove();
        try { var sr = $('srMsg'); if (sr) sr.textContent = ''; var sl = $('srList'); if (sl) sl.innerHTML = ''; var qk = $('qKw'); if (qk) qk.value = ''; } catch (e) {}
        try { backList(); } catch (e) { try { renderList(); } catch (e2) {} }
        toast('《' + title + '》已加入片单（共 ' + total + ' 集' + (total ? '' : '，之后可在详情页改集数') + '）');
      } catch (e) { fail('保存失败：' + (e && e.message ? e.message : e)); }
    });
    setTimeout(function () { try { $('at270AddTitle').focus(); } catch (e) {} }, 80);
  }
  window.manualAdd = openAddModal;

})();
