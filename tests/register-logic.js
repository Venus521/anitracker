/* v2.11.0 注册链路 —— 纯逻辑单元测试（不开浏览器，毫秒级）
   按 skill「single-file-html-browser-testing」步骤 3：用起止标记 slice + eval。
   覆盖：正常 / 格式变体 / 边界 / 故意不合法输入。预期值独立写在用例里。 */

const fs = require('fs');
const path = require('path');

const ROOT = 'D:/项目/01_媒体娱乐/ani-tracker';
const src = fs.readFileSync(path.join(ROOT, 'cloudbase-sync.js'), 'utf8');

let pass = 0, fail = 0;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || '' });
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + name + (detail && !ok ? '  :: ' + detail : ''));
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ---------- 提取被测函数 ---------- */
/* isEmail / pwdOk / userOk / cleanMsg / errText 都在同一个 IIFE 里，
   用起止标记切出从 escH 到 isOn 之间的一段，eval 进隔离作用域。 */
const A = src.indexOf('  function escH(');
const B = src.indexOf('  async function sess()');
if (A < 0 || B < 0) { console.log('!! 切片标记未命中 A=' + A + ' B=' + B); process.exit(1); }
const sliceA = src.slice(A, B);

/* skill 踩坑表第 2 条：eval 里顶层 return 会报 Illegal return statement，
   必须包一层函数。 */
const util = (function () {
  const f = new Function(sliceA + '\n; return { isEmail: isEmail, pwdOk: pwdOk, userOk: userOk, cleanMsg: cleanMsg, errText: errText };');
  return f();
})();

/* ---------- 1. isEmail ---------- */
console.log('\n--- isEmail ---');
const emailCases = [
  ['a@b.co', true, '常规邮箱'],
  ['user.name+tag@example.com', true, '含点与 + 号'],
  ['not-an-email', false, '没有 @ —— 故意不合法'],
  ['a@b', false, '顶级域不足 2 位'],
  ['a@b.c', false, '顶级域 1 位'],
  ['  a@b.co  ', true, '首尾空格应被 trim'],
  ['@b.co', false, '缺本地部分'],
  ['a@.co', false, '缺域名'],
  ['', false, '空字符串'],
  ['a b@c.co', false, '本地部分含空格'],
];
emailCases.forEach(([v, want, why], i) => {
  const got = util.isEmail(v);
  check('E' + (i + 1), `isEmail(${JSON.stringify(v)}) → ${want}（${why}）`, got === want, `got=${got}`);
});

/* ---------- 2. pwdOk ---------- */
console.log('\n--- pwdOk ---');
const pwdCases = [
  ['Probe0Testx', true, '标准 11 位'],
  ['123', false, '太短（实测云端也不校验，靠前端拦）'],
  ['abcdefgh', false, '纯字母，无数字'],
  ['12345678', false, '纯数字，无字母'],
  ['a1'.repeat(16), true, '恰好 32 位'],
  ['a1'.repeat(17), false, '36 位，超上限'],
  ['abcdefg1', true, '恰好 8 位，边界'],
  ['abcdef1', false, '7 位，边界外'],
  ['', false, '空'],
];
pwdCases.forEach(([v, want, why], i) => {
  const got = util.pwdOk(v);
  check('P' + (i + 1), `pwdOk(${v.length > 20 ? v.length + '位' : JSON.stringify(v)}) → ${want}（${why}）`, got === want, `got=${got}`);
});

/* ---------- 3. userOk ---------- */
console.log('\n--- userOk ---');
const userCases = [
  ['abc123', true, '恰好 6 位，边界内'],
  ['abc12', false, '5 位，边界外'],
  ['abcde12345', true, '11 位'],
  ['user_name-1', true, '含下划线与短横线'],
  ['Abc123', false, '大写开头 —— 故意不合法'],
  ['1abcde', false, '数字开头'],
  ['用户名abc', false, '含中文 —— 故意不合法'],
  ['a'.repeat(25), true, '恰好 25 位'],
  ['a'.repeat(26), false, '26 位，超限'],
];
userCases.forEach(([v, want, why], i) => {
  const got = util.userOk(v);
  check('U' + (i + 1), `userOk(${v.length > 12 ? v.length + '位' : JSON.stringify(v)}) → ${want}（${why}）`, got === want, `got=${got}`);
});

/* ---------- 4. cleanMsg —— 剥 Go 格式化残渣 ---------- */
console.log('\n--- cleanMsg ---');
const cleanCases = [
  ['无效的验证码%!(EXTRA string=rpc error: code = InvalidArgument desc = verification code does not match the id)', '无效的验证码', '砍掉 %!(EXTRA 之后全部'],
  ['正常的一句话', '正常的一句话', '无残渣时原样返回'],
  ['类型错误%!s(MISSING)', '类型错误', '%!s(MISSING) 也要砍'],
  ['', '', '空串安全'],
];
cleanCases.forEach(([v, want, why], i) => {
  const got = util.cleanMsg(v);
  check('C' + (i + 1), `cleanMsg 剥残渣：${why}`, got === want, `want=${JSON.stringify(want)} got=${JSON.stringify(got)}`);
});

/* ---------- 5. errText —— 结构化字段优先 ---------- */
console.log('\n--- errText（用真实错误对象形状）---');
/* 以下是实测从 CloudBase 抓到的真实错误对象，字段名与值都照抄 */
const realVerifErr = {
  __isAuthError: true, name: 'AuthError', status: 'invalid_argument', code: 'invalid_argument',
  errorCode: 3, category: 'VERIFICATION_FAILED',
  message: '无效的验证码%!(EXTRA string=rpc error: code = InvalidArgument desc = verification code does not match the id)',
  helpMessage: '[CloudBase Auth] 验证码校验失败\n\n  验证码验证未通过，常见原因：\n  - 验证码已过期',
};
const realCredErr = {
  __isAuthError: true, name: 'AuthError', status: 'invalid_username_or_password', code: 'invalid_username_or_password',
  errorCode: 4043, category: 'INVALID_CREDENTIALS',
  message: '用户名或密码不正确。',
  helpMessage: '[CloudBase Auth] 凭据验证失败',
};
const fakeMidErr = {
  status: 'invalid_argument', code: 'invalid_argument', category: 'VERIFICATION_FAILED',
  message: "无效的验证码%!(EXTRA string=rpc error: code = InvalidArgument desc = oidc: malformed jwt: invalid character '¶')",
};
const needMidErr = { message: 'messageId is required' };
const netErr = { message: 'Failed to fetch' };

const errCases = [
  [realVerifErr, 'signup', '验证码不正确，请检查后重填', '验证码错 → 结构化 category 判定'],
  [realCredErr, 'login', '邮箱/用户名或密码不正确', '凭据错 → INVALID_CREDENTIALS'],
  [{ status: 'invalid_argument', category: 'VERIFICATION_FAILED', message: '验证码已过期%!(EXTRA x)' }, 'signup', '验证码已过期，请重新获取', '同类里按「过期」细分'],
  [fakeMidErr, 'signup', '验证码不正确，请检查后重填', '伪造 messageId 也归为验证码类'],
  [needMidErr, 'signup', '验证凭证已失效，请重新点「获取验证码」', '缺 messageId → 引导重新获取'],
  [netErr, 'signup', '网络不给力，请检查网络后重试', '网络错'],
  [{ category: 'RATE_LIMITED' }, 'signup', '操作太频繁，请等 1 分钟再试', '限流 → 结构化判定'],
  [{ category: 'USER_ALREADY_EXISTS' }, 'signup', '这个邮箱已经注册过了，可直接登录', '已注册 → 结构化判定'],
];
errCases.forEach(([e, ctx, want, why], i) => {
  const got = util.errText(e, ctx);
  check('X' + (i + 1), `errText：${why}`, got === want, `want=${JSON.stringify(want)} got=${JSON.stringify(got)}`);
});

/* 最关键的一条：任何情况下都不能把 %!(EXTRA 泄漏给用户 */
console.log('\n--- 兜底不泄漏脏串 ---');
const leakCases = [
  { message: '某个没见过的错误%!(EXTRA string=xyz)' },
  { message: '未知状况' },
  { message: 'foo%!(EXTRA bar)' },
];
leakCases.forEach((e, i) => {
  const got = util.errText(e, 'generic');
  const leaked = /%!/.test(got) || /EXTRA/.test(got);
  check('L' + (i + 1), `兜底不吐 %!(EXTRA 残渣（输入含残渣也要洗干净）`, !leaked, `got=${JSON.stringify(got)}`);
});

/* ---------- 6. 结构性检查：句柄持久化与发送锁 ---------- */
console.log('\n--- 结构性断言（读源码，确认关键修复在位）---');
const r = [];
function s(id, name, ok, detail) { check(id, name, ok, detail); }

s('S1', '发送期间立刻禁用按钮（不等 await）',
  /_sending = true;[\s\S]{0,200}btn\.disabled = true;/.test(src));
s('S2', '有 _sending 重入锁',
  /if \(_sending\) return;/.test(src));
s('S3', '_sending 在成功与失败两条路径都复位',
  (src.match(/_sending = false;/g) || []).length >= 2,
  '出现次数=' + (src.match(/_sending = false;/g) || []).length);
s('S4', '注册状态持久化到 localStorage（跨刷新不丢）',
  /localStorage\.setItem\(LS_REG/.test(src) && /loadRegPending/.test(src));
s('S5', 'finishSignUp 支持无闭包时用 messageId 重建',
  /auth\.verifyOtp\(\{ token: code, messageId: p\.messageId \}\)/.test(src));
s('S6', 'startSignUp 里调了 resend 取 messageId',
  /auth\.resend\(\{ email: email, type: 'signup' \}\)/.test(src));
s('S7', '注册表单真的渲染了 #cbNewName（旧版只读不写）',
  /id="cbNewName"/.test(src));
s('S8', '双 Tab 结构存在且注册面板默认隐藏',
  /id="cbTabLogin"/.test(src) && /id="cbTabReg"/.test(src) && /id="cbPaneReg" class="cbpane" style="display:none"/.test(src));
s('S9', '验证码文案与校验一致（不再写死「6 位」）',
  /* 只看「给用户看的字符串」，注释里提到旧 bug 不算。 */
  !/placeholder="6 位验证码"|'6 位验证码'|6 位验证码（/.test(src.replace(/^\s*(\/\*|\*|\/\/).*$/gm, '')),
  'strip 注释后仍匹配到「6 位验证码」即失败');
s('S10', '旧的 cbRegBox 隐藏式注册已彻底移除',
  !/cbRegBox/.test(src));
s('S11', '刷新后回到注册页并预填邮箱',
  /if \(pend && pend\.messageId\)/.test(src) && /showTab\('reg'\)/.test(src));
s('S12', '旧的「写死正则」错误翻译已换成结构化优先',
  /cat === 'VERIFICATION_FAILED'/.test(src) && /cleanMsg/.test(src));

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(50));
console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS');
if (fail) {
  console.log('\n失败项：');
  results.filter(x => !x.ok).forEach(x => console.log('  ' + x.id + ' ' + x.name + ' :: ' + x.detail));
}
fs.writeFileSync(path.join(ROOT, 'tests', 'last-register-logic.json'),
  JSON.stringify({ at: new Date().toISOString(), pass, total: pass + fail, results }, null, 1));
process.exit(fail ? 1 : 0);
