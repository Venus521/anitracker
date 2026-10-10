# AniTracker 追迹

追番进度 PWA：单文件应用（index.html ≈9100 行，唯一源）+ 手机 APK 壳 + 云端热更三路发布。
版本史与事故复盘全在 [CHANGELOG.md](CHANGELOG.md)（最新版本段在**文件顶部**，v2.51.0=2026-10-11 审计修复轮）。

> 本文件 2026-10-11 随审计修复轮重写。旧版（v2.1 交付报告，2026-08-29）已严重过时，
> 被 `_backup_审计修复_20261011/readme.md` 留档。

## 一、代码结构（谁是真的）

| 文件 | 角色 |
|---|---|
| `index.html` | 唯一源。内联 CSS+JS（主块 + at270 块），版本号在 `var AT_VERSION` / `AT_BUILD` |
| `ani-tracker.html` | index.html 的字节级同步副本（旧单文件分发场景）。`同步双入口.py` 校验，pre-commit 钩子自动同步 |
| `ani-tracker-lib.json` | 内置 302 部收藏库（v2.13.0 起外置懒加载，约 649KB） |
| `tracker-filler-data.js` | 动画归档/漫改数据（212+ 部） |
| `tracker-sw.js` / `tracker-manifest.webmanifest` / `tracker-*.png` | PWA 三件套：SW 分层缓存（缓存名钉 build 号）、manifest、图标 |
| `cloudbase-sync.js` | 账号云同步前端模块（登录注册/整包上传下载合并/5 秒防抖/凭据 PBKDF2+AES-GCM） |
| `vendor/cloudbase.full.js` | CloudBase JS SDK 全量包（v3.7.0） |
| `服务器-空闲自退.py` | 本机 :8089 静态托管 + 同源中转端点（`/cb-relay` `/cover-relay` `/iq-relay` `/iq-img` `/db-info`），空闲自退。LAN 暴露模式只服务 APK 与页面白名单，中转端点同源校验（v2.51.0） |
| `db_info_rules.py` / `iq_relay_rules.py` | 豆瓣/爱奇艺的出站 URL 拼装与判决规则（五档 ok/limited/empty/err/neg，只有 neg 许写负缓存） |
| `cloud-functions/douban-relay-node/` | 云函数（Nodejs20.19，HTTP /douban-relay）：封面+详情，14s 预算制、负缓存、403 全局冷却、CORS 来源白名单、每 IP 限流（v2.51.0） |
| `mobile-shell/` | Android 壳：`build-apk.py` 打包、`发布到云端.py` 三路上云、`手机安装入口.py` 壳号+LAN 直链 |
| `发版.py` | 版本六处同步一条命令（原子化写盘，失败自动回滚） |
| `tests/` | 门禁全套（见下）+ 截图走查墙；一次性产物进 `tests/_artifacts/`（不入库） |
| `_archive/` / `DELIVERY/` | 本地备份与交付快照（gitignore 排除） |

## 二、跑起来

- 电脑端：`DeskBox\启动方式\追迹.lnk`（拉起 8089 本机服务器 + 页面）。
- 手机浏览器：固定入口 `https://cloud1-d7gsn5t0w6407b963-1460816419.tcloudbaseapp.com/`（薄页运行时查最新内容包，记这一个网址永远最新）。
- 手机 App：APK 壳（剪贴板/微信传输安装），App 内「账号 → 安装包 → 检查更新」换壳，「内容更新」热更界面。
- 双击 `index.html`（file://）也能用：云同步走不通（网关 CORS 名单），其余功能完整，豆瓣封面/联想走云函数。

## 三、发布流水线（顺序不可换）

```
1. 改 index.html（唯一源；ani-tracker.html 由钩子/同步脚本跟上）
2. python 发版.py X.Y.Z --note "…"        # 六处一次改齐：页面版本号/SW缓存名/tracker-version.json/package.json/APK壳号/双入口
3. node tests/phone-look.js               # 15 屏版式走查 + 走查墙重生成
4. node tests/run-regression.js           # 34 项页面回归（或直接跑 运行回归测试.bat 全套 26 条）
5. python mobile-shell/build-apk.py       # 打 APK（必须先于发布：check_shell_fresh 强制对账）
6. python mobile-shell/发布到云端.py "说明"  # 三路一次发：APK+清单 / 内容包 code 自增 / 固定入口
7. 收口 commit（中文消息用 UTF-8 文件 + git commit -F，别用 -m）
8. push（直连不稳，失败走本机 7897 代理；节奏由用户主导）
```

发版失败自动回滚六处；发布公网验证失败自动回传旧清单。改云函数后部署：
`cmd /c tcb fn deploy douban-relay-node --force --httpFn --path /douban-relay --dir cloud-functions\douban-relay-node --runtime Nodejs20.19 -e cloud1-d7gsn5t0w6407b963`
（末尾报 Path '/douban-relay' is used 无害，代码已传；验证直接 curl 三模式。）

## 四、门禁（运行回归测试.bat = 唯一真相源，26 条串行）

门禁一律不出网（`AT_DB_SUGGEST_BASE`/`AT_DB_RELAY_BASE` 摘到 :9）。npm scripts 是 bat 的机器映射（`npm run test:regression` 等），一致性由 `npm run test:parity` 把关。核心几条：

| 门禁 | 管什么 |
|---|---|
| run-regression | 34 项页面回归（真无头 Chrome + mock API；`AT_CHROME`/`AT_PY` 环境变量可换机） |
| phone-look / phone-use | 393×851 十五屏版式走查（出界/34px 触点/11px 字地板）+ 12 个真人任务行为走查 |
| catch-audit | 空 catch 常驻门禁：数据关键链路 19 函数必须接线 atErr，总量不回潮 |
| gates-parity | bat 与 npm 门禁清单对账 |
| a11y / contrast / csp / syntax | 静态断言（可访问性 7 项 / 浅深对比度 16 组合 / CSP / 语法） |
| douban-sync-e2e / douban-push-e2e / name-refresh-e2e / ep-duration / phone-canon / desktop-tier | 豆瓣同步/推送/刷名/时长账/漫改/桌面档 e2e |
| *_negative.py / *-negative.js | 各判据的负测（变异真身确认量具会咬人） |

走查墙按 PNG mtime vs index.html 判「过期」：改了页面就必须重跑 phone-look。

## 五、工程规矩（踩过的坑的沉淀）

1. **改 index.html 前先 `git status` + grep `AT_VERSION`**——工作区不干净且版本号不是自己发的就是有并发会话，停手汇报（历史上撞过三次）。
2. **cmd 会话 `git commit -m "中文"` 会存成 GBK 乱码**——Write UTF-8 消息文件 + `git commit -F`，消息文件放仓库外。
3. **带写入语义的凭据端点（POST /hub/api/db/cookie）绝不发测试请求**——假 Cookie 也会覆盖真凭据（2026-10-06 事故）。调试只打 GET status。
4. **剧名铁律**：外语剧=中文+原文、中文剧=中文名、**已在片单的条目永不改名**；现名含 CJK 一律不动（TVMaze 对中文剧 name 是外文原名，akas 才有中文名）。
5. **只认「确认没有」写负缓存**——限流绝不是「这部剧没有」（五档里只有 neg 许写 10 分钟负账）。
6. 手机详情页「重拉封面/本地封面/AI 导入」工具条固定在「标记下一集」正下方一屏可见，不许沉底（v2.28.0 用户令）。
7. mock 外网必须带 CORS 头 + 处理 OPTIONS，否则页面判「网络不可用」污染走查。
8. 回归页 shows 会跨用例累积——批量计数断言一律用 `≥` 别用 `===`。
9. 发布凭据=本机 tcb CLI 登录态；keystore 留 mobile-shell/keystore/（换签名=手机拒装），gitignore 排除。

## 六、已知边界（不是 bug，是现实）

- 豆瓣推送方向写不进（subject 页反爬+假成功，v2.31.0 定论，UI 置灰诚实报错）。
- 豆瓣匿名搜索官方锁死（rexxar 403）：中文剧靠 suggest+爱奇艺补位+云端 IP+服务端中转四层绕。
- CloudBase 网关对 loopback 回显非法多值 ACAO 头（官方行为改不掉）：浏览器直连云端那条腿永久不可用，全部走服务端中转。
- CloudBase 测试域名首次访问有「页面访问提示」墙（免费方案不绑备案域名，过一次即可）。
- 固定入口无 frame-ancestors（托管平台配不了响应头；本机服务器已配）。
- 中文条目源头缺口约 60/77（内置库 302 部 + AniList 只覆盖番剧），「待指认层」在需求池（v2.49.0 §七）。
- 忘了追迹密码=云端豆瓣 Cookie 解不开只能重粘（v2.32.0 刻意取舍）。
