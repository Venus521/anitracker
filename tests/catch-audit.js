// catch-audit —— 空 catch 常驻门禁（2026-10-11 审计修复轮新增）
//
// 背景：审计发现 338 处 catch 里 69% 是空 catch，统一错误网关 atErr 只有 7 处接线，
// 网络与数据错误大面积静默，线上排障几乎盲区。本轮已把 19 个数据关键链路函数
// （开机自愈/合并去重/封面时长自愈/网络补集/刷名/版本探测/SW 注册）的 75 处空 catch
// 全部接进 atErr；纯 UI 降级路径的空 catch 是刻意设计（失败当没发生），保留。
//
// 三条判据：
//   C1 关键函数空 catch 必须为 0 —— 防止将来改这些函数时又写出静默吞错
//   C2 空 catch 总量不得回潮超过本轮基线 —— 新代码要用 atErr
//   C3 atErr 接线数不得低于本轮基线 —— 防止有人批量把 atErr 调用删掉
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ix = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lines = ix.split('\n');

// 空 catch：catch(e){} / catch(err) {} / .catch(function(){}) 三种形态
const EMPTY_FN = /catch\s*\(\s*(?:e|err|x|ex|_)\s*\)\s*\{\s*\}/;
const EMPTY_CB = /\.catch\(function\s*\(\s*\)\s*\{\s*\}\)/;
const ATERR = /\batErr\s*\(/g;

const KEY_FNS = ['bootHeal', 'boot', 'bootSeasonReslice', 'purgeAllOnce', 'purgeRecordStores',
  'dedupeShowsOnce', 'doMergeDups', 'mergeShowArrays', 'healDurFor', 'coverHealAll',
  'healCoverFor', '_autoDurFor', 'coverFixFromLib', 'markCoverDead', 'webFillEpisodes',
  'fillEpisodesNow', 'refreshNamesFor', 'refreshNamesAll', 'atVerCheck'];

// 基线：2026-10-11 接线后实测（重扫命令见 tests/_artifacts/_scan_empty_catch.js）
const BASELINE_TOTAL = 153;
const BASELINE_ATERR = 82;

let fails = 0;
function check(id, name, ok, detail) {
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + id + ' ' + name + (detail ? ' —— ' + detail : ''));
  if (!ok) fails++;
}

// C1：关键函数作用域内不得再出现空 catch
const fnDef = /function\s+([A-Za-z_$][\w$]*)\s*\(/;
let cur = '(top)';
const leaks = {};
lines.forEach((l) => {
  const m = l.match(fnDef);
  if (m) cur = m[1];
  if (KEY_FNS.indexOf(cur) >= 0 && (EMPTY_FN.test(l) || EMPTY_CB.test(l))) {
    leaks[cur] = (leaks[cur] || 0) + 1;
  }
});
check('C1', '关键链路 19 函数空 catch = 0', Object.keys(leaks).length === 0,
  Object.keys(leaks).length ? JSON.stringify(leaks) : '');

// C2：空 catch 总量基线
let total = 0;
lines.forEach((l) => { if (EMPTY_FN.test(l) || EMPTY_CB.test(l)) total++; });
check('C2', '空 catch 总量 ≤ ' + BASELINE_TOTAL, total <= BASELINE_TOTAL, '实测 ' + total);

// C3：atErr 接线基线
const aterrN = (ix.match(ATERR) || []).length;
check('C3', 'atErr 接线 ≥ ' + BASELINE_ATERR, aterrN >= BASELINE_ATERR, '实测 ' + aterrN);

// 关键链路两处实锤接线仍在（审计点名样本）
check('C4', 'SW 注册失败已接线', /serviceWorker\.register\('tracker-sw\.js'\)\.catch\(function\(e\)\{ atErr\('sw-register'/.test(ix));
check('C5', '网络补集 webFillEpisodes 已接线', /atErr\("webFillEpisodes\.catch"/.test(ix));

console.log(fails ? 'catch-audit: ' + fails + ' 项红' : 'catch-audit: 全绿（5 项）');
process.exit(fails ? 1 : 0);
