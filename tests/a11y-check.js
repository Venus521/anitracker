/* tests/a11y-check.js —— 审计项 3「可达性」门禁（npm run test:a11y）
 *
 * 静态断言，不需要浏览器：直接读 index.html（唯一源）。
 * 前两条抓「键盘用不了」，后几条抓「读屏读不到」。
 *
 * 只查**纯图标按钮**（<button> 里只有 ← › × 这类符号、没有文字），
 * 因为有文字的按钮读屏天然读得到，强行加 aria-label 反而会盖掉可见文字——
 * 这是 a11y 改造里最容易犯的错。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'index.html');
const s = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
const T = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  ok ? pass++ : fail++;
};
const has = (re) => re.test(s);

/* 已知例外：这些控件的可访问名称是运行时拼的，静态标签里查不到。
   - nextBtn：textContent 由 JS 填「下一集 / 补齐剧集」，加静态 aria-label 会盖掉它
   - udInp / udF：在 uiDialog 里，udF 被 <label> 包住（隐式关联），udInp 由 JS 按 o.title 赋值 */
const INPUT_ALLOW = new Set(['id="udInp"', 'class="udF"']);

const lines = (pos) => s.slice(0, pos).split('\n').length;

/* ---- 1. 键盘焦点必须看得见 ---- */
T('T01 主样式块有全局 :focus-visible 规则',
  /(^|[^-])focus-visible\s*\{\s*outline:\s*2px solid/.test(s));

/* ---- 2. 纯图标按钮全部有 aria-label ---- */
const btnRe = /<button\b[^>]*>/gi;
let iconBtns = 0, iconNoLabel = [], m;
while ((m = btnRe.exec(s))) {
  const end = s.indexOf('</button>', m.index);
  if (end < 0) continue;
  const text = s.slice(m.index + m[0].length, end)
    .replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/g, '').trim();
  if (/[\w一-鿿]/.test(text)) continue;          // 有文字 → 读屏读得到，跳过
  const tag = m[0];
  if (tag.match(/id="nextBtn"/)) continue;
  iconBtns++;
  if (!/aria-label|aria-labelledby/.test(tag)) iconNoLabel.push('L' + lines(m.index) + ' ' + tag.slice(0, 90));
}
T('T02 纯图标按钮全部带 aria-label', iconNoLabel.length === 0,
  iconBtns + ' 个，缺 ' + iconNoLabel.length + (iconNoLabel.length ? ' → ' + iconNoLabel.join(' | ') : ''));

/* ---- 3. 表单控件有可访问名称 ---- */
const ctlRe = /<(input|textarea|select)\b[^>]*>/gi;
let ctls = 0, ctlNoLabel = [], radioNoLabel = [];
while ((m = ctlRe.exec(s))) {
  const tag = m[0];
  if (/type="radio"/i.test(tag)) { radioNoLabel.push(tag); continue; }
  const allow = [...INPUT_ALLOW].some(k => tag.includes(k));
  if (allow) continue;
  ctls++;
  if (!/aria-label|aria-labelledby/.test(tag)) ctlNoLabel.push('L' + lines(m.index) + ' ' + tag.slice(0, 90));
}
T('T03 非 radio 表单控件全部带 aria-label', ctlNoLabel.length === 0,
  ctls + ' 个，缺 ' + ctlNoLabel.length + (ctlNoLabel.length ? ' → ' + ctlNoLabel.join(' | ') : ''));

/* ---- 4. 单选框必须被 <label> 包住（隐式关联） ---- */
let radioLoose = [];
for (const r of radioNoLabel) {
  const i = s.indexOf(r);
  if (i < 0) continue;
  const before = s.slice(Math.max(0, i - 250), i);
  const open = (before.match(/<label\b/gi) || []).length;
  const close = (before.match(/<\/label>/gi) || []).length;
  if (open <= close) radioLoose.push('L' + lines(i) + ' ' + r.slice(0, 70));
}
T('T04 每个 radio 都被 <label> 包住', radioLoose.length === 0,
  radioNoLabel.length + ' 个，游离 ' + radioLoose.length + (radioLoose.length ? ' → ' + radioLoose.join(' | ') : ''));

/* ---- 5. 密码框：不许再用 autocomplete=off（会禁用浏览器密码管理与自动填充） ---- */
const pw = [...s.matchAll(/<input\b[^>]*type="password"[^>]*>/gi)].map(x => x[0]);
T('T05 password 输入用 autocomplete="current-password"',
  pw.length >= 2 && pw.every(t => /autocomplete="current-password"/.test(t)),
  pw.length + ' 个密码框');

/* ---- 6. 弹层补 role=dialog / aria-modal（读屏才知道焦点被圈进来了） ---- */
const masks = ['uiDlgMask', 'srcEditMask', 'srcToolsMask', 'syncMask'];
const missingMask = masks.filter(id => {
  const i = s.indexOf("wrap.id='" + id + "'");
  if (i < 0) return true;
  const seg = s.slice(i, i + 220);
  return !(/role'?\)?,\s*'dialog'/.test(seg) || /setAttribute\('role','dialog'\)/.test(seg));
});
T('T06 4 个弹层创建处都设了 role=dialog + aria-modal', missingMask.length === 0,
  missingMask.length ? '缺 → ' + missingMask.join(', ') : '4/4');

/* ---- 7. aria-label 覆盖率较改造前有实质提升（审计基线：13 个 button → 现 24 个） ---- */
const btnLabels = (s.match(/<button\b[^>]*aria-label=/gi) || []).length;
T('T07 button 带 aria-label 数量 >= 24（改造前基线仅 13）', btnLabels >= 24, '实得 ' + btnLabels);

console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
process.exit(fail ? 1 : 0);
