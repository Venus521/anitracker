/* =====================================================================
   AniTracker v2.7.0 模块（二）：双语集名编辑 · 网格增强 · 详情增强箱
   · 资料/别名编辑 · 关联条目 · 修改台账 · 数据质量面板 · 启动迁移
   ===================================================================== */
(function () {
  'use strict';
  var AT270 = window.AT270 = window.AT270 || {};
  var SNAP = '20260916b';

  /* ---------- 小工具 ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function makeEl(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function pad(n) { return n < 10 ? ('0' + n) : ('' + n); }
  function fmt(t) { try { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); } catch (e) { return ''; } }
  function logEdit(sid, kind, detail) { try { AT270.logEdit(sid, kind, detail); } catch (e) {} }
  function closeM(id) { var m = $(id); if (m) m.remove(); }
  function isIntSid(sid) { return String(sid || '').indexOf('int:') === 0; }

  /* =====================================================================
     四、集名双语：覆盖 editSrc（来源标注 + 集名双语 + 台账）
     ===================================================================== */
  window.editSrc = function (epNum) {
    var s = bySid(curSid); if (!s) return;
    var e = (s.eps || []).filter(function (x) { return x.s === epNum; })[0];
    if (!e) { toast('找不到该集'); return; }
    var inf = srcInfoOf(s, e);
    var old = $('srcEditMask'); if (old) old.remove();
    var wrap = makeEl('<div id="srcEditMask" class="mask"></div>');
    var box = makeEl('<div class="panel"></div>');
    var opts = [['canon', '漫改'], ['filler', 'TV原创'], ['semi', '半原创'], ['unknown', '待核']];
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">第 ' + e.s + ' 集 · 编辑</h3>' +
      '<button type="button" onclick="__closeSrcEdit()" style="background:none;border:none;font-size:20px;color:var(--muted)">×</button></div>' +
      '<div class="mini">当前：<b style="color:var(--ink)">' + esc(srcDisplayName(inf.src)) + '</b> · 依据：' + esc(srcByText(inf.by)) + (inf.note ? (' · ' + esc(inf.note)) : '') + (e.src ? ' · <span style="color:var(--accent)">人工标注</span>' : '') + '</div>' +
      '<div class="srcopts" id="seOps">' + opts.map(function (o) {
        var on = ((e.src && e.src === o[0]) || (!e.src && inf.src === o[0] && o[0] !== 'unknown') || (!e.src && inf.src === 'unknown' && o[0] === 'unknown'));
        return '<button type="button" class="srcopt' + (on ? ' on' : '') + '" onclick="__pickSe(this,\'' + o[0] + '\')">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="rangeline">应用范围：<label><input type="radio" name="seSc" value="one" checked/> 仅此集</label>' +
      '<label><input type="radio" name="seSc" value="range"/> 第 <input id="seA" type="number" min="1" value="' + e.s + '"/> 至 <input id="seB" type="number" min="1" value="' + e.s + '"/> 集</label></div>' +
      '<label>备注（可选）</label><input id="seNote" placeholder="如：对照原作第X话 / 官方标注" value="' + esc(e.srcNote || '') + '"/>' +
      '<div class="divi"></div>' +
      '<div class="mini"><b style="color:var(--ink)">集名（双语）</b>：左原文、右中文；只作用于本集，列表会同时显示两种写法。</div>' +
      '<label>原文名</label><input id="seTO" placeholder="如：麦わらの一味！" value="' + esc(e.tOrig || '') + '"/>' +
      '<label>中文名</label><input id="seTC" placeholder="如：草帽一伙！" value="' + esc(e.tCn || '') + '"/>' +
      '<div class="msg" id="seMsg"></div>' +
      '<div class="row2"><button type="button" class="b2" onclick="__closeSrcEdit()">取消</button><button type="button" class="b1" id="seSave">保存</button></div>';
    wrap.appendChild(box); document.body.appendChild(wrap);
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) wrap.remove(); });
    var choice = e.src || inf.src;
    window.__pickSe = function (btn, k) {
      choice = k;
      var ops = box.querySelectorAll('#seOps .srcopt');
      for (var i = 0; i < ops.length; i++) ops[i].classList.remove('on');
      if (btn) btn.classList.add('on');
    };
    box.querySelector('#seSave').onclick = function () {
      var m = box.querySelector('#seMsg');
      if (!choice) { m.textContent = '先选一个标签'; m.style.color = 'var(--danger)'; return; }
      var sc = 'one', rr = box.querySelectorAll('input[name=seSc]');
      for (var i = 0; i < rr.length; i++) { if (rr[i].checked) sc = rr[i].value; }
      var a = parseInt(box.querySelector('#seA').value, 10) || e.s, b = parseInt(box.querySelector('#seB').value, 10) || e.s;
      if (a > b) { var t2 = a; a = b; b = t2; }
      var note = box.querySelector('#seNote').value.trim();
      var cnt = 0;
      (s.eps || []).forEach(function (x) {
        var hit = (sc === 'one') ? (x.s === e.s) : (x.s >= a && x.s <= b);
        if (!hit) return;
        if (choice === 'unknown') { if (x.src || x.srcNote) { delete x.src; delete x.srcNote; } }
        else { x.src = choice; if (note) x.srcNote = note; else delete x.srcNote; x.srcAt = Date.now(); }
        cnt++;
      });
      /* 集名双语（仅本集） */
      var tO = box.querySelector('#seTO').value.trim();
      var tC = box.querySelector('#seTC').value.trim();
      var nameChanged = false;
      if (tO !== (e.tOrig || '') || tC !== (e.tCn || '')) {
        if (tO) e.tOrig = tO; else delete e.tOrig;
        if (tC) e.tCn = tC; else delete e.tCn;
        e.t = e.tCn || e.tOrig || e.t;
        nameChanged = true;
        logEdit(s.sid, '集名双语', '第 ' + e.s + ' 集：' + (tO || '—') + ' / ' + (tC || '—'));
      }
      s.updAt = Date.now(); try { statInvalidate(s.sid); } catch (x) {}
      save(); renderDetail(); __closeSrcEdit();
      var label = (choice === 'unknown' ? '恢复自动判定' : TYPE_NAME[choice] || choice);
      logEdit(s.sid, '来源标注', '第 ' + e.s + ' 集 → ' + label + (sc === 'range' ? ('（批量 ' + a + '-' + b + '，共 ' + cnt + ' 集）') : ''));
      toast('已保存：' + label + (sc === 'range' ? (' × ' + cnt + ' 集') : '') + (nameChanged ? ' · 集名已更新' : ''));
    };
  };

  /* =====================================================================
     五、网格渲染增强（集名第二语言行、集号点击编辑、筛选支持双语）
     ===================================================================== */
  window.renderGrid = function () {
    var s = bySid(curSid); if (!s) return;
    var q = ($('qFilter').value || '').trim().toLowerCase();
    var qn = q ? normTxt(q) : '';
    var seq = (s.eps || []).slice();
    var hidN = 0;
    var items = seq.filter(function (e) {
      var tk = epTypeOf(s, e);
      if (isHiddenSrc(tk)) { hidN++; return false; }
      if (dType !== 'all' && tk !== dType) return false;
      if (q) {
        var numHit = String(e.s).indexOf(q) >= 0;
        var nameHit = normTxt((e.t || '') + ' ' + (e.tOrig || '') + ' ' + (e.tCn || '')).indexOf(qn) >= 0;
        if (!numHit && !nameHit) return false;
      }
      return true;
    });
    var total = items.length;
    var pages = Math.max(1, Math.ceil(total / EG_PZ));
    var key = String(curSid);
    var cur = pageBySid[key] || 1;
    if (cur > pages) cur = pages;
    pageBySid[key] = cur;
    var slice = items.slice((cur - 1) * EG_PZ, cur * EG_PZ);
    var html = '';
    if (hidN > 0) html = '<div class="srchint" style="padding:2px 0 6px">已隐藏 ' + hidN + ' 集（TV原创/半原创） · <span style="color:var(--accent);cursor:pointer" onclick="clearHide()">恢复全部显示</span></div>';
    slice.forEach(function (e) {
      var st = epStat(s, e.s);
      var cls = st === 'watched' ? ' w' : st === 'rewatch' ? ' r' : '';
      var inf = srcInfoOf(s, e); var tk = inf.src; var tn = TYPE_NAME[tk] || '';
      var nm = (String(e.t || '') || ('第 ' + e.s + ' 集')).replace(/【动画原创】/g, '').trim();
      var sec = '';
      if (e.tOrig && e.tOrig !== e.t) sec = e.tOrig;
      else if (e.tCn && e.tCn !== e.t) sec = e.tCn;
      var noTxt = e.s + (st === 'rewatch' ? ' <span class="rw">🔁</span>' : '');
      html += '<button class="eprow' + cls + '" onclick="cycleEp(\'' + esc(String(e.s)) + '\')">' +
        '<span class="no" onclick="event.stopPropagation();editSrc(' + e.s + ')" title="点集号可编辑：集名双语 / 来源标注" style="cursor:pointer">' + noTxt + '</span>' +
        '<span class="nm' + (sec ? ' at2' : '') + '">' + esc(nm) + (sec ? ('<span class="at270t2">' + esc(sec) + '</span>') : '') + '</span>' +
        (tn ? '<span class="ty ty-' + tk + '" onclick="event.stopPropagation();editSrc(' + e.s + ')" title="' + esc(srcBasisText(s, e)) + '">' + tn + '</span>' : '') +
        '</button>';
    });
    if (!total) html = '<div class="tiny" style="padding:10px 0">' + ((s.eps || []).length ? '没有匹配的集（换筛选/关键词试试；支持原文/中文两种集名）' : '暂无剧集数据——点上方横幅一键拉取（需关联 Bangumi），或用「✎ 编辑集数」手动补齐') + '</div>';
    if (pages > 1) {
      var pis = [];
      if (pages <= 12) { for (var i2 = 1; i2 <= pages; i2++) pis.push(i2); }
      else {
        for (var i = 1; i <= pages; i++) {
          if (i <= 3 || i > pages - 3 || Math.abs(i - cur) <= 1) pis.push(i);
          else if (pis[pis.length - 1] !== '…') pis.push('…');
        }
      }
      var pgHtml = '<div class="pager">' + pis.map(function (pg) {
        if (pg === '…') return '<span class="pgdots">…</span>';
        return '<button class="pg' + (pg === cur ? ' on' : '') + '" onclick="setPage(' + pg + ')">' + pg + '</button>';
      }).join('') + '</div>';
      html = pgHtml + html + pgHtml;
    }
    $('dGroups').innerHTML = html;
    $('typeRow').innerHTML = ['all', 'canon', 'filler', 'semi', 'unknown'].map(function (t) {
      return '<button class="ty' + (dType === t ? ' on' : '') + '" onclick="setType(\'' + t + '\')">' + (t === 'all' ? '全部类型' : TYPE_NAME[t]) + '</button>';
    }).join('');
  };

  /* =====================================================================
     六、检索扩展：片单检索纳入别名/原文名
     ===================================================================== */
  window.ownedInList = function (kw) {
    var q = normTxt(kw); if (!q) return [];
    return (window.shows || []).filter(function (s) {
      if (normTxt(s.title).indexOf(q) >= 0) return true;
      if (normTxt(s.nameJp || '').indexOf(q) >= 0) return true;
      var al = s.aliases || [];
      for (var i = 0; i < al.length; i++) { if (normTxt(al[i]).indexOf(q) >= 0) return true; }
      return false;
    }).slice(0, 6);
  };

  /* =====================================================================
     七、详情增强箱（资料/别名 · 关联条目 · 修改历史 · 数据质量入口）
     ===================================================================== */
  function renderBox() {
    try {
      var vd = $('vDetail'); if (!vd || vd.style.display === 'none') return;
      var old = $('at270Box'); if (old) old.remove();
      if (String(curSid).indexOf('int:') === 0) {
        var li = (window.INTERNAL_SHOWS || []).filter(function (x) { return x.id === curSid.slice(4); })[0];
        var boxI = makeEl('<div class="at270box" id="at270Box"><div class="sec"><div class="sech">双语与资料</div>' +
          '<div class="mini">本条目来自内置库预览' + (li ? '（原文名：' + esc(li.nameJp || '—') + '）' : '') + '。加入片单后，可编辑双语剧名、登记别名并逐集补全集名双语。</div>' +
          '<div class="syrow"><button type="button" class="sybtn pri" id="at270AddFirst">＋ 加入片单并编辑</button></div></div></div>');
        var anchorI = vd.querySelector('button[onclick="delShow()"]');
        if (anchorI && anchorI.parentNode) anchorI.parentNode.insertBefore(boxI, anchorI); else vd.appendChild(boxI);
        var btn = $('at270AddFirst');
        if (btn && li) btn.addEventListener('click', function () {
          try {
            addInternal(li.id).then(function () {
              setTimeout(function () {
                var hit = (window.shows || []).filter(function (x) { return normTxt(x.title) === normTxt(li.title); })[0];
                if (hit) openDetail(hit.sid);
              }, 600);
            }).catch(function (e2) { try { toast('加入失败：' + (e2 && e2.message ? e2.message : e2)); } catch (x) {} });
          } catch (e) { toast('加入失败：' + (e && e.message ? e.message : e)); }
        });
        return;
      }
      var s = bySid(curSid); if (!s) return;
      var aliases = s.aliases || [];
      var box = makeEl('<div class="at270box" id="at270Box"></div>');
      /* 资料 */
      var secA = makeEl('<div class="sec"><div class="sech">资料 · 双语与别名</div></div>');
      var chips = '<span class="at270chip">中文：' + esc(s.title || '—') + '</span><span class="at270chip">原文：' + esc(s.nameJp || '（待补）') + '</span>';
      aliases.forEach(function (a) { chips += '<span class="at270chip">' + esc(a) + '</span>'; });
      if (!aliases.length) chips += '<span class="at270chip" style="border-style:dashed">别名：暂无（点右侧添加）</span>';
      secA.appendChild(makeEl('<div>' + chips + '</div>'));
      var rowA = makeEl('<div class="syrow"><button type="button" class="sybtn" id="at270EditProf">✎ 编辑资料 / 别名</button></div>');
      secA.appendChild(rowA);
      box.appendChild(secA);
      /* 关联 */
      var relsAll = lsGet('at_relations', []);
      var mine = relsAll.filter(function (r) { return String(r.a) === String(curSid) || String(r.b) === String(curSid); });
      var secB = makeEl('<div class="sec"><div class="sech">关联条目</div></div>');
      if (!mine.length) secB.appendChild(makeEl('<div class="mini">暂无关联。可建立「原作 / 续作 / 同系列 / 联动」等双向关联。</div>'));
      mine.forEach(function (r) {
        var otherSid = String(r.a) === String(curSid) ? r.b : r.a;
        var os = bySid(otherSid);
        var row = makeEl('<div class="at270row"><span class="l">' + esc(os ? os.title : ('（已移除 #' + String(otherSid).slice(-6) + '）')) + '</span><span class="r"><span>' + esc(r.type || '关联') + '</span><button type="button" class="at270btn" style="padding:4px 9px;min-height:28px">解除</button></span></div>');
        row.querySelector('button').addEventListener('click', function () {
          if (!confirm('解除与《' + (os ? os.title : otherSid) + '》的关联？')) return;
          var L = lsGet('at_relations', []).filter(function (x) { return !(String(x.a) === String(r.a) && String(x.b) === String(r.b) && x.type === r.type); });
          lsSet('at_relations', L);
          logEdit(curSid, '关联解除', '解除 → ' + (os ? os.title : otherSid) + '（' + (r.type || '') + '）');
          renderBox(); toast('已解除关联');
        });
        secB.appendChild(row);
      });
      var rowB = makeEl('<div class="syrow"><button type="button" class="sybtn" id="at270AddRel">＋ 添加关联</button></div>');
      secB.appendChild(rowB);
      box.appendChild(secB);
      /* 历史 */
      var logs = lsGet('at_edit_log', []).filter(function (x) { return String(x.sid) === String(curSid); }).slice(-6).reverse();
      var secC = makeEl('<div class="sec"><div class="sech">修改历史（最近）</div></div>');
      if (!logs.length) secC.appendChild(makeEl('<div class="mini">暂无修改记录。</div>'));
      logs.forEach(function (l) {
        secC.appendChild(makeEl('<div class="at270row"><span class="l">' + esc(l.kind + ' · ' + (l.detail || '')) + '</span><span class="r">' + fmt(l.at) + '</span></div>'));
      });
      var rowC = makeEl('<div class="syrow"><button type="button" class="sybtn" id="at270HistAll">全部历史</button><button type="button" class="sybtn" id="at270QualBtn">▦ 数据质量</button></div>');
      secC.appendChild(rowC);
      box.appendChild(secC);
      /* 挂载 */
      var anchor = vd.querySelector('button[onclick="delShow()"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor);
      else (($('dGroups') || vd).parentNode || vd).appendChild(box);
      /* 绑定 */
      var bp = $('at270EditProf'); if (bp) bp.addEventListener('click', function () { openProf(); });
      var br = $('at270AddRel'); if (br) br.addEventListener('click', function () { openRel(); });
      var bh = $('at270HistAll'); if (bh) bh.addEventListener('click', function () { openHist(); });
      var bq = $('at270QualBtn'); if (bq) bq.addEventListener('click', function () { AT270.quality(); });
    } catch (e) {}
  }
  window.renderDetail = (function () { var orig = window.renderDetail; return function () { var r = orig.apply(this, arguments); renderBox(); return r; }; })();
  window.showInternalDetail = (function () { var orig = window.showInternalDetail; return function () { var r = orig.apply(this, arguments); renderBox(); return r; }; })();

  /* =====================================================================
     八、编辑资料（双语剧名 + 别名，支持「类型: 名称」写法）
     ===================================================================== */
  function openProf() {
    var s = bySid(curSid); if (!s) return;
    if (s.pv) { toast('预览模式：先加入片单再编辑'); return; }
    closeM('at270ProfMask');
    var wrap = makeEl('<div id="at270ProfMask" class="mask"><div class="panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">编辑资料</h3><button type="button" id="at270ProfX" style="background:none;border:none;font-size:20px;color:var(--muted)">×</button></div>' +
      '<div class="mini">剧名建议：中文名 + 原文名各一栏；别名一行一条，可写「台译: 航海王」「罗马字: ONE PIECE」。</div>' +
      '<label>中文名</label><input id="at270ProfTitle" value="' + esc(s.title || '') + '"/>' +
      '<label>原文名</label><input id="at270ProfJp" value="' + esc(s.nameJp || '') + '"/>' +
      '<label>别名（每行一条）</label><textarea id="at270ProfAlias" rows="4">' + esc((s.aliases || []).join('\n')) + '</textarea>' +
      '<label>年份</label><input id="at270ProfYear" value="' + esc(s.year || '') + '"/>' +
      '<div class="msg" id="at270ProfMsg"></div>' +
      '<div class="row2"><button type="button" class="b2" id="at270ProfCancel">取消</button><button type="button" class="b1" id="at270ProfSave">保存</button></div>' +
      '</div></div>');
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    $('at270ProfX').addEventListener('click', function () { wrap.remove(); });
    $('at270ProfCancel').addEventListener('click', function () { wrap.remove(); });
    $('at270ProfSave').addEventListener('click', function () {
      var msg = $('at270ProfMsg');
      var nt = $('at270ProfTitle').value.trim();
      if (!nt) { msg.textContent = '中文名不能为空'; msg.style.color = 'var(--danger)'; return; }
      var njp = $('at270ProfJp').value.trim();
      var nRaw = ($('at270ProfAlias').value || '').split('\n');
      var nAliases = [];
      nRaw.forEach(function (a) { a = a.trim(); if (a && nAliases.indexOf(a) < 0) nAliases.push(a); });
      var ny = $('at270ProfYear').value.trim().slice(0, 4);
      var changes = [];
      if (nt !== s.title) { changes.push('中文名：' + s.title + ' → ' + nt); s.title = nt; }
      if (njp !== (s.nameJp || '')) { changes.push('原文名：' + (s.nameJp || '—') + ' → ' + (njp || '—')); s.nameJp = njp; }
      if (nAliases.join('|') !== (s.aliases || []).join('|')) { changes.push('别名：' + ((s.aliases || []).length) + ' 条 → ' + nAliases.length + ' 条'); s.aliases = nAliases; }
      if (ny !== (s.year || '')) { changes.push('年份：' + (s.year || '—') + ' → ' + (ny || '—')); s.year = ny; }
      if (!changes.length) { msg.textContent = '没有变化'; msg.style.color = 'var(--muted)'; return; }
      s.updAt = Date.now(); save();
      logEdit(s.sid, '资料编辑', changes.join('；'));
      wrap.remove();
      renderDetail(); renderList();
      toast('已保存 ' + changes.length + ' 项修改');
    });
  }
  AT270.openProf = openProf;

  /* =====================================================================
     九、关联条目（双向可见 / 可解除）
     ===================================================================== */
  function openRel() {
    var s = bySid(curSid); if (!s) return;
    if (s.pv) { toast('预览模式：先加入片单再操作'); return; }
    AT270._relPick = null;
    closeM('at270RelMask');
    var wrap = makeEl('<div id="at270RelMask" class="mask"><div class="panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">添加关联条目</h3><button type="button" id="at270RelX" style="background:none;border:none;font-size:20px;color:var(--muted)">×</button></div>' +
      '<div class="mini">为《' + esc(s.title) + '》建立双向关联：原作 / 续作 / 同系列 / 联动。在输入框里从联想列表选择目标条目。</div>' +
      '<label>关联类型</label><div class="rangeline" id="at270RelTypes">' +
      ['原作', '续作', '同系列', '联动', '其他'].map(function (t, i) {
        return '<label><input type="radio" name="at270RelT" value="' + t + '"' + (i === 0 ? ' checked' : '') + '/> ' + t + '</label>';
      }).join('') + '</div>' +
      '<label>目标条目（从联想中选择）</label><input id="at270RelKw" placeholder="输入名称，出现候选后点选" style="caret-color:var(--accent)"/>' +
      '<div class="msg" id="at270RelMsg"></div>' +
      '<div class="row2"><button type="button" class="b2" id="at270RelCancel">取消</button><button type="button" class="b1" id="at270RelSave">建立关联</button></div>' +
      '</div></div>');
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    $('at270RelX').addEventListener('click', function () { wrap.remove(); });
    $('at270RelCancel').addEventListener('click', function () { wrap.remove(); });
    $('at270RelSave').addEventListener('click', function () {
      var msg = $('at270RelMsg');
      var pick = AT270._relPick;
      var typed = $('at270RelKw').value.trim();
      if (!pick || (typed && normTxt(typed) !== normTxt(pick.t))) {
        var hit = (window.shows || []).filter(function (x) { return normTxt(x.title) === normTxt(typed); })[0];
        if (hit) pick = { k: 'own', sid: String(hit.sid), t: hit.title };
      }
      if (!pick || pick.k !== 'own' || !pick.sid) { msg.textContent = '请从联想列表中点选一个「片单」内的条目（内置库条目请先加入片单）'; msg.style.color = 'var(--danger)'; return; }
      if (String(pick.sid) === String(curSid)) { msg.textContent = '不能关联自己'; msg.style.color = 'var(--danger)'; return; }
      var type = '原作';
      var tr = wrap.querySelectorAll('input[name=at270RelT]');
      for (var i = 0; i < tr.length; i++) { if (tr[i].checked) type = tr[i].value; }
      var L = lsGet('at_relations', []);
      var dup = L.filter(function (x) {
        return (String(x.a) === String(curSid) && String(x.b) === String(pick.sid)) || (String(x.a) === String(pick.sid) && String(x.b) === String(curSid));
      })[0];
      if (dup) { msg.textContent = '已存在该关联（' + (dup.type || '') + '）'; msg.style.color = 'var(--danger)'; return; }
      L.push({ a: String(curSid), b: String(pick.sid), type: type, at: Date.now() });
      lsSet('at_relations', L);
      logEdit(curSid, '关联添加', '→ ' + pick.t + '（' + type + '）');
      wrap.remove(); renderBox();
      toast('已建立关联：' + type + '《' + pick.t + '》');
    });
  }
  AT270.openRel = openRel;

  /* =====================================================================
     十、修改历史（本条目 + 导出）
     ===================================================================== */
  function openHist() {
    closeM('at270HistMask');
    var s = bySid(curSid);
    var all = lsGet('at_edit_log', []);
    var mine = all.filter(function (x) { return String(x.sid) === String(curSid); }).slice(-60).reverse();
    var wrap = makeEl('<div id="at270HistMask" class="mask"><div class="panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">修改历史 · ' + esc(s ? s.title : '') + '</h3><button type="button" id="at270HistX" style="background:none;border:none;font-size:20px;color:var(--muted)">×</button></div>' +
      '<div class="mini">共 ' + all.length + ' 条全库记录 · 本条目显示最近 ' + mine.length + ' 条</div>' +
      '<div id="at270HistList"></div>' +
      '<div class="row2"><button type="button" class="b2" id="at270HistExp">导出全部日志</button><button type="button" class="b1" id="at270HistClose">关闭</button></div>' +
      '</div></div>');
    var listEl = wrap.querySelector('#at270HistList');
    if (!mine.length) listEl.appendChild(makeEl('<div class="mini">暂无记录</div>'));
    mine.forEach(function (l) {
      listEl.appendChild(makeEl('<div class="at270row"><span class="l">' + esc(l.kind + ' · ' + (l.detail || '')) + '</span><span class="r">' + fmt(l.at) + '</span></div>'));
    });
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    $('at270HistX').addEventListener('click', function () { wrap.remove(); });
    $('at270HistClose').addEventListener('click', function () { wrap.remove(); });
    $('at270HistExp').addEventListener('click', function () {
      downloadJSON('anitracker-editlog-' + tsName() + '.json', { at: new Date().toISOString(), version: AT270.V, log: all });
    });
  }
  function tsName() { var d = new Date(); return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()); }
  function downloadJSON(name, obj) {
    try {
      var blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 600);
      toast('已导出：' + name);
    } catch (e) { toast('导出失败：' + (e && e.message ? e.message : e)); }
  }

  /* =====================================================================
     十一、数据质量面板（覆盖率 + 双语缺口 + 别名/关联统计 + 审计导出）
     ===================================================================== */
  function computeAudit() {
    var out = {
      series: 0, eps: 0, withEps: 0, calibrated: 0,
      cov: { canon: 0, filler: 0, semi: 0, movie: 0, unknown: 0 },
      missingOrig: 0, missingCn: 0, aliasSeries: 0,
      relations: 0, logs: 0, drafts: 0, bySeries: []
    };
    out.relations = lsGet('at_relations', []).length;
    out.logs = lsGet('at_edit_log', []).length;
    out.drafts = Object.keys(lsGet('at_drafts', {})).length;
    (window.shows || []).forEach(function (s) {
      out.series++;
      if ((s.aliases || []).length) out.aliasSeries++;
      if (s.filler || s.mixed) out.calibrated++;
      var cov = null; try { cov = statOf(s).cov; } catch (e) {}
      var eps = s.eps || [];
      out.eps += eps.length;
      if (cov && cov.total) out.withEps++;
      var mo = 0, mc = 0;
      eps.forEach(function (e2) { if (!e2.tOrig) mo++; if (!e2.tCn) mc++; });
      out.missingOrig += mo; out.missingCn += mc;
      if (cov) {
        out.cov.canon += cov.canon || 0; out.cov.filler += cov.filler || 0;
        out.cov.semi += cov.semi || 0; out.cov.movie += cov.movie || 0; out.cov.unknown += cov.unknown || 0;
      }
      out.bySeries.push({
        sid: String(s.sid), title: s.title || '', eps: eps.length || s.total || 0,
        cov: cov ? { canon: cov.canon, filler: cov.filler, semi: cov.semi, movie: cov.movie, unknown: cov.unknown } : null,
        missingOrig: mo, missingCn: mc, aliases: (s.aliases || []).length, calibrated: !!(s.filler || s.mixed),
        nameJp: s.nameJp || ''
      });
    });
    return out;
  }
  AT270.audit = computeAudit;
  function pct(n, t) { return t ? (Math.round(n / t * 1000) / 10 + '%') : '0%'; }
  function openQuality() {
    closeM('at270QualMask');
    var a = computeAudit();
    var tot = a.cov.canon + a.cov.filler + a.cov.semi + a.cov.movie + a.cov.unknown;
    function seg(n, cls) { return '<i style="width:' + (tot ? (n / tot * 100) : 0) + '%;background:' + cls + '"></i>'; }
    var topUnknown = a.bySeries.slice().sort(function (x, y) { return (y.cov ? y.cov.unknown : 0) - (x.cov ? x.cov.unknown : 0); }).slice(0, 5);
    var topTrans = a.bySeries.slice().sort(function (x, y) { return (y.missingOrig + y.missingCn) - (x.missingOrig + x.missingCn); }).slice(0, 5);
    var wrap = makeEl('<div id="at270QualMask" class="mask"><div class="panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">数据质量</h3><button type="button" id="at270QX" style="background:none;border:none;font-size:20px;color:var(--muted)">×</button></div>' +
      '<div class="mini">片单 ' + a.series + ' 部 · 剧集 ' + a.eps + ' 条（含剧集数据 ' + a.withEps + ' 部）· Filler 数据版本 ' + SNAP + '</div>' +
      '<div class="statgrid" style="margin-top:10px">' +
      '<div class="stat"><b>' + a.cov.canon + '</b><span>漫改</span></div>' +
      '<div class="stat"><b>' + a.cov.filler + '</b><span>TV原创</span></div>' +
      '<div class="stat"><b>' + a.cov.semi + '</b><span>半原创</span></div>' +
      '<div class="stat"><b>' + a.cov.unknown + '</b><span>待核</span></div></div>' +
      '<div class="at270bar">' + seg(a.cov.canon, '#2d6a9f') + seg(a.cov.filler, '#a8552f') + seg(a.cov.semi, '#c07b2d') + seg(Math.max(0, tot - a.cov.canon - a.cov.filler - a.cov.semi), '#8a8a8a') + '</div>' +
      '<div class="at270legend"><span><span class="at270dot" style="background:#2d6a9f"></span>漫改 ' + pct(a.cov.canon, tot) + '</span><span><span class="at270dot" style="background:#a8552f"></span>TV原创 ' + pct(a.cov.filler, tot) + '</span><span><span class="at270dot" style="background:#c07b2d"></span>半原创 ' + pct(a.cov.semi, tot) + '</span><span><span class="at270dot" style="background:#8a8a8a"></span>待核 ' + pct(a.cov.unknown, tot) + '</span></div>' +
      '<div class="divi"></div>' +
      '<div class="at270kv">双语缺口：缺原文名 <b>' + a.missingOrig + '</b> 集 · 缺中文名 <b>' + a.missingCn + '</b> 集 · 已校准来源 <b>' + a.calibrated + '/' + a.series + '</b> 部<br/>别名：<b>' + a.aliasSeries + '</b> 部已登记 · 关联 <b>' + a.relations + '</b> 组 · 修改台账 <b>' + a.logs + '</b> 条 · 草稿 <b>' + a.drafts + '</b> 份</div>' +
      '<div id="at270QList1"></div><div id="at270QList2"></div>' +
      '<div class="syrow" style="margin-top:12px">' +
      '<button type="button" class="sybtn" id="at270QRecal">⟳ 重扫来源（清缓存）</button>' +
      '<button type="button" class="sybtn" id="at270QExport">⇩ 导出审计 JSON</button>' +
      '<button type="button" class="sybtn" id="at270QClear">✕ 清空全部草稿</button>' +
      '</div>' +
      '<div class="row2"><button type="button" class="b2" id="at270QClose">关闭</button></div>' +
      '</div></div>');
    document.body.appendChild(wrap);
    var l1 = wrap.querySelector('#at270QList1'), l2 = wrap.querySelector('#at270QList2');
    if (topUnknown.length && topUnknown[0].cov) {
      l1.appendChild(makeEl('<div class="sech" style="font-size:11px;letter-spacing:2px;color:var(--muted);margin:12px 0 6px">待核最多</div>'));
      topUnknown.forEach(function (x) {
        if (!x.cov || !x.cov.unknown) return;
        var row = makeEl('<div class="at270row"><span class="l">' + esc(x.title) + '</span><span class="r"><span>待核 ' + x.cov.unknown + ' / ' + (x.eps || '—') + '</span><button type="button" class="at270btn" style="padding:4px 9px;min-height:28px">打开</button></span></div>');
        row.querySelector('button').addEventListener('click', function () { wrap.remove(); openDetail(x.sid); });
        l1.appendChild(row);
      });
    }
    if (topTrans.length && (topTrans[0].missingOrig + topTrans[0].missingCn)) {
      l2.appendChild(makeEl('<div class="sech" style="font-size:11px;letter-spacing:2px;color:var(--muted);margin:12px 0 6px">双语缺口最多</div>'));
      topTrans.forEach(function (x) {
        if (!x.missingOrig && !x.missingCn) return;
        var row = makeEl('<div class="at270row"><span class="l">' + esc(x.title) + '</span><span class="r"><span>缺原文 ' + x.missingOrig + ' · 缺中文 ' + x.missingCn + '</span><button type="button" class="at270btn" style="padding:4px 9px;min-height:28px">打开</button></span></div>');
        row.querySelector('button').addEventListener('click', function () { wrap.remove(); openDetail(x.sid); });
        l2.appendChild(row);
      });
    }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    $('at270QX').addEventListener('click', function () { wrap.remove(); });
    $('at270QClose').addEventListener('click', function () { wrap.remove(); });
    $('at270QRecal').addEventListener('click', function () {
      try { localStorage.removeItem('at_fg_cache'); } catch (e) {}
      lsSet('at_fg_snap', SNAP);
      wrap.remove();
      try { batchCalibrateAll(); } catch (e) { toast('校准启动失败'); }
    });
    $('at270QExport').addEventListener('click', function () {
      var aa = computeAudit();
      downloadJSON('anitracker-audit-' + tsName() + '.json', {
        meta: { app: 'anitracker', version: AT270.V, generatedAt: new Date().toISOString(), fillerSnapshot: SNAP },
        stats: { series: aa.series, eps: aa.eps, cov: aa.cov, calibrated: aa.calibrated, missingOrig: aa.missingOrig, missingCn: aa.missingCn, aliasSeries: aa.aliasSeries, relations: aa.relations, logs: aa.logs },
        series: aa.bySeries
      });
    });
    $('at270QClear').addEventListener('click', function () {
      if (!confirm('清空全部未恢复的草稿？')) return;
      lsSet('at_drafts', {});
      toast('草稿已清空');
    });
  }
  AT270.quality = openQuality;

  /* =====================================================================
     十二、列表页 srcbar 增加「数据质量」入口
     ===================================================================== */
  window.renderSrcBar = (function () {
    var orig = window.renderSrcBar;
    return function () {
      var r = orig.apply(this, arguments);
      try {
        var b = $('srcBar');
        if (b) {
          var btn = document.createElement('button');
          btn.className = 'srcchip tool';
          btn.textContent = '▦ 数据质量';
          btn.title = '双语缺口 / 别名 / 分类覆盖与审计导出';
          btn.addEventListener('click', function () { openQuality(); });
          b.appendChild(btn);
        }
      } catch (e) {}
      return r;
    };
  })();

  /* =====================================================================
     十三、启动：迁移 + 数据版本 + 一次性自动校准
     ===================================================================== */
  function boot() {
    try {
      if (!lsGet('at_v270', false)) {
        lsSet('at_v270', true);
      }
      var snap = lsGet('at_fg_snap', '');
      if (snap !== SNAP) {
        try { localStorage.removeItem('at_fg_cache'); } catch (e) {}
        lsSet('at_fg_snap', SNAP);
        setTimeout(function () {
          try {
            if (window.shows && shows.length) {
              toast('正在用新版来源数据校准（含海贼王等）…');
              Promise.resolve(fgAllShows()).then(function (r) {
                if (r && r.total) toast('来源校准完成：匹配 ' + r.ok + '/' + r.total + ' 部');
              }).catch(function () {});
            }
          } catch (e) {}
        }, 2600);
      }
      setTimeout(function () { try { renderSrcBar(); } catch (e) {} }, 900);
    } catch (e) {}
  }
  boot();
  /* 草稿清扫（v2.7.0 复核修复）：登录/注册成功后表单消失 → 自动清理对应草稿 */
  setInterval(function () {
    try {
      var D = JSON.parse(localStorage.getItem('at_drafts') || '{}');
      var changed = false;
      var keys = Object.keys(D);
      for (var i = 0; i < keys.length; i++) {
        var mask = document.getElementById(keys[i]);
        if (!mask) continue;
        var ks = Object.keys(D[keys[i]].fields || {});
        var gone = ks.length > 0;
        for (var j = 0; j < ks.length; j++) {
          if (mask.querySelector('[id="' + ks[j] + '"]')) { gone = false; break; }
        }
        if (gone) { delete D[keys[i]]; changed = true; }
      }
      if (changed) localStorage.setItem('at_drafts', JSON.stringify(D));
    } catch (e) {}
  }, 6000);

})();
