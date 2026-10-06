/* contrast-check.js — v2.40.0 起的常驻对比度门禁（OB UI 铁律 16：不许肉眼判，脚本实测）。
   断言追迹全部主题（浅/深）× 关键前景/背景组合：正文小字 ≥4.5，大字/图标 ≥3.0。
   改配色时改 PAIRS 数组加行，别绕过这个门禁。跑法：node tests/contrast-check.js */
const assert = require('assert');

function lum(hex) {
  const c = hex.replace('#', '');
  const lin = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/* [说明, 前景, 背景, 门槛]（门槛 4.5=正文小字 / 3.0=大字粗体·图标·装饰字标） */
const PAIRS = [
  ['浅色 正文 ink/bg', '#17150f', '#faf8f4', 4.5],
  ['浅色 正文 ink/card', '#17150f', '#ffffff', 4.5],
  ['浅色 次要 muted/bg', '#6f695c', '#faf8f4', 4.5],
  ['浅色 次要 muted/card', '#6f695c', '#ffffff', 4.5],
  ['浅色 强调文字 accent-ink/bg', '#7a5c28', '#faf8f4', 4.5],
  ['浅色 强调文字 accent-ink/card', '#7a5c28', '#ffffff', 4.5],
  ['浅色 强调文字 accent-ink/accent-soft', '#7a5c28', '#f2e9d8', 4.5],
  ['浅色 装饰 accent/bg（非文字）', '#a67f45', '#faf8f4', 3.0],
  ['浅色 装饰 accent/card（非文字）', '#a67f45', '#ffffff', 3.0],
  ['深色 正文 ink/bg', '#ece4d4', '#12100d', 4.5],
  ['深色 正文 ink/card', '#ece4d4', '#1d1a15', 4.5],
  ['深色 次要 muted/bg', '#9c9280', '#12100d', 4.5],
  ['深色 次要 muted/card', '#9c9280', '#1d1a15', 4.5],
  ['深色 强调文字 accent/bg', '#d9a94b', '#12100d', 4.5],
  ['深色 强调文字 accent/card', '#d9a94b', '#1d1a15', 4.5],
  ['深色 强调文字 accent/accent-soft', '#d9a94b', '#2b2418', 4.5],
];
let fail = 0;
for (const [name, fg, bg, min] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name.padEnd(28) + r.toFixed(2) + '（需 ≥' + min + '）');
}
console.log('SUMMARY: ' + (PAIRS.length - fail) + '/' + PAIRS.length + ' PASS');
process.exit(fail ? 1 : 0);
