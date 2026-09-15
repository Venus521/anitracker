# 01 · Bangumi 功能全量盘点清单（2026-09-15）

> 真身：`D:\项目\01_媒体娱乐\ani-tracker`（index.html 为唯一源，ani-tracker.html 为同步副本）
> 口径：v2.4.3（整改前）基线盘点；本清单可逐条核对，无模糊地带。

## 1. 文件与代码位置

| 文件 | Bangumi 触点 | 说明 |
|---|---|---|
| index.html（2464 行，807KB） | 251 行命中；28 个 bgm* 函数 | 全部 Bangumi 逻辑都在此单文件 |
| ani-tracker.html | 同上（整改前为 v2.4.0 旧版，已漂移） | PWA 旧入口，已同步（见 D1） |
| cloudbase-sync.js | 0 命中 | 账号云同步（腾讯 CloudBase），与 Bangumi 无关，不属本次范围 |
| ani-tracker-enhanced.js | MAL 补丁草稿，未被引用 | 死文件 → 已归档 `_archive/` |
| tracker-sw.js / tracker-version.json / manifest | 版本与缓存，间接相关 | 已随 v2.4.4 更新 |
| server.py / 服务器-空闲自退.py / *.bat | 0 命中 | 纯静态服务，无 Bangumi 逻辑 |

## 2. 核心函数（整改前行号，index.html）

- 请求层：`_bget` L952（直连 8s + 代理兜底链）、`bgmQueue` L1471（写 1100ms/读 350ms 节流）、`bgmFetch` L1490（429/5xx/NET 重试）、`bgmErrText` L1479
- 账号：`bgmTok` L1436、`bgmAuth` L1437、`bgmSid` L1438、绑定 UI `bgmUnboundHtml`/`bgmBoundHtml`/`bindBgmCard` L2229-2286
- 搜索/添加：`doBgmSearch` L1060（免绑定双源）、`bgmAttach` L1898、`bgmPullEpisodeList` L1855、`cacheCover` L1833、`addShow` L1914（跨源判重）
- 关联/补齐：`assocUi` L1129、`recoverEmptyEps` L1879、`bgmFillEpisodes` L1883
- 同步：`bgmPullShow` L1568、`bgmPushShow` L1630、`bgmPullAll` L1695、`bgmPushAll` L1717、`bgmPushEp` L1535（单集自动）、`bgmPushStatus` L1547、`bgmPatchEps` L1512
- 台账：`syncLogNew/Commit/Update` L1446-1460、`renderLedger` L1802、`bgmRetry` L1772、`bgmRollback` L1740
- 系列：`switchPart` L1982、整合面板 L2028-2117（按 Bangumi 条目找齐同系列）
- 死代码：`bgmGet` L1524（无引用）→ v2.4.4 删除

## 3. 页面入口（用户操作路径）

1. 顶栏「⇅ 同步」→ 同步中心：Bangumi 账号绑定/更换、拉取全部、推送全部、完全对齐开关、同步记录（重试/回滚）、高级设置
2. 搜索页：关键词搜索（本地库 + Bangumi 在线免绑定）、在线结果「添加」、「＋ 手动添加」（零依赖）、关联入口
3. 详情页：「⟳ 拉取Bangumi进度」「↑ 推送Bangumi」「⌁ 关联Bangumi」（未关联时显示）、「✎ 编辑集数」（显示 Bangumi 原始集数）、「整合季度」、评分编辑（推送时携带）、空剧集横幅一键拉取、「关联 Bangumi 补齐剧集 ›」
4. 集标记：点击集条目 → 本地状态流转 +（有 token 时）单集自动同步
5. PWA：manifest（整改前 start_url 指向旧文件 ani-tracker.html，v2.4.4 起指向 index.html）

## 4. 外部接口调用

| 端点 | 用途 | 鉴权 |
|---|---|---|
| POST /v0/search/subjects | 搜索（type 2/6） | 免绑定可用 |
| GET /v0/subjects/{id} | 条目详情/封面 | 免绑定 |
| GET /v0/episodes?subject_id= | 剧集列表（分页 100） | 免绑定 |
| GET/POST /v0/users/-/collections/{sid} | 收藏读取/建改（状态+评分） | token |
| GET/PATCH /v0/users/-/collections/{sid}/episodes | 远端进度读取/批量写 | token |
| PUT /v0/users/-/collections/-/episodes/{eid} | 单集标记看过 | token |
| GET /v0/me | token 校验/身份 | token |
| 图片：lain.bgm.tv（封面，直连优先 + cors.sh 兜底） | 封面下载缩略 | 无 |
| 兜底代理：proxy.cors.sh、api.codetabs.com | 网络失败时的超时兜底 | 无（本机已不可达，v2.4.4 降为 5s/跳） |

## 5. 定时任务

- 唯一周期任务：L2461 `setInterval(..., 6*60*1000)` —— WebDAV 自动同步（tr_dav 配置存在且有片单时），与 Bangumi 无关。
- Bangumi 无任何后台轮询；所有请求由用户操作触发。

## 6. 数据存储（localStorage，按浏览器/来源隔离）

| 键 | 内容 |
|---|---|
| tr_shows | 片单主体（含 bgmId、eps[].bid 章节映射、statuses、rating、bgmTotal） |
| at_bgm_token / at_bgm_un | Bangumi access_token（明文本机）/ 用户名缓存 |
| at_sync_log | 同步台账（上限 80 条，含 undo 回滚数据） |
| at_flags | searchNoSync 等开关 |
| tr_dav / tr_meta / at_cb_last / at_fg_cache / at_hide_src / at_src_report | WebDAV 配置/元数据/云同步时间/灌水池缓存/来源筛选/来源报告 |

## 7. 外部密钥与凭据

- `at_bgm_token`：用户自建个人令牌（bgm.tv/settings/services → API 访问令牌），仅存本机浏览器。
- cloudbase-sync.js 内置 CloudBase accessKey（云同步用，非 Bangumi；建议后续轮换，见交接风险）。
- 代理服务无密钥。

## 8. 整改前的已知问题（详见 02 号文档证据）

双入口漂移（PWA 装的是旧版）/ 未开播条目添加失败无提示且文案误导 / 黑洞网络报错 63.5s / 404 文案歧义 / 绑定卡文案与免绑定搜索矛盾 / bgmGet 死代码 / enhanced.js 死文件 / 启动服务器.py 日志路径遗留。
