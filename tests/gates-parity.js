// gates-parity —— 门禁清单一致性门禁（2026-10-11 审计修复轮新增）
//
// 背景：审计发现同一份门禁清单有三个真相源——运行回归测试.bat（23 条）、package.json
// scripts（21 条）、_run_gates.py（解析 bat 重跑），互相漂移：bat 里的 season-scope/
// iq-source/reslice/dbinfo/db-rules 系列不在 npm 里，bat 也漏了 a11y/contrast。
// 现在约定：**运行回归测试.bat 是唯一真相源（串行全集），npm scripts 是它的机器可跑映射**。
// 本门禁对账两边：bat 每条都能用 npm 等价跑，npm test:* 指向的文件都存在。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const bat = fs.readFileSync(path.join(ROOT, '运行回归测试.bat'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let fails = 0;
function check(id, name, ok, detail) {
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + id + ' ' + name + (detail ? ' —— ' + detail : ''));
  if (!ok) fails++;
}

// bat 里登记的测试文件（node tests\X.js / python -X utf8 tests\Y.py）
const batFiles = [];
bat.replace(/\\/g, '/').split('\n').forEach((l) => {
  let m = l.match(/(?:node|python(?:\s+-X\s+utf8)?)\s+tests\/([\w.-]+\.js|[\w.-]+\.py)/);
  if (m) batFiles.push(m[1]);
});

// npm scripts 里的测试文件
const npmFiles = {};
Object.keys(pkg.scripts).forEach((k) => {
  const m = pkg.scripts[k].match(/tests\/([\w.-]+\.js|[\w.-]+\.py)/);
  if (m) npmFiles[m[1]] = k;
});

check('P1', 'bat 解析出门禁 ≥ 26 条', batFiles.length >= 26, '实测 ' + batFiles.length);
const missing = batFiles.filter((f) => !npmFiles[f]);
check('P2', 'bat 每条门禁在 npm 有映射', missing.length === 0, missing.length ? missing.join(', ') : '');
const ghosts = Object.keys(npmFiles).filter((f) => !fs.existsSync(path.join(ROOT, 'tests', f)));
check('P3', 'npm test:* 指向的文件都存在', ghosts.length === 0, ghosts.length ? ghosts.join(', ') : '');
// 常驻门禁必须两边都登记（历史上 a11y/contrast 只在 npm、回归核心只在 bat，就是这里漂的）
const MUST = ['catch-audit.js', 'a11y-check.js', 'contrast-check.js', 'run-regression.js', 'phone-look.js'];
const batMiss = MUST.filter((f) => batFiles.indexOf(f) < 0);
check('P4', '五条常驻门禁在 bat 登记', batMiss.length === 0, batMiss.length ? batMiss.join(', ') : '');
const npmMiss = MUST.filter((f) => !npmFiles[f]);
check('P5', '五条常驻门禁在 npm 登记', npmMiss.length === 0, npmMiss.length ? npmMiss.join(', ') : '');

console.log(fails ? 'gates-parity: ' + fails + ' 项红' : 'gates-parity: 全绿（5 项）');
process.exit(fails ? 1 : 0);
