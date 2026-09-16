# ani-tracker v2.7.0 工作设计（工作台版）

> 2026-09-16 · 目标：修复「误触空白丢内容」+ 重建「双语/别名/联想/来源分类」能力
> 版本：v2.6.1 → v2.7.0（build 20260916b）· SW anitracker-v11

## A. 根因（已复现取证）

| # | 问题 | 根因 |
|---|---|---|
| A1 | 注册中点空白退出丢内容 | syncMask 等全部弹层：`wrap.addEventListener('click', if(e.target===wrap) close)` + ESC 关闭；零草稿、零确认。实测：填邮箱+密码→点空白→mask 消失、`at_drafts` 无、内容丢失 |
| B1 | 集名/剧名单语混排 | 剧名=`title`(中)+`nameJp`(原文，302部全有但 UI 只在详情显示一处、不可编辑)；集名仅 `t` 单字段，库内中/日文混排（日语标题 182 条、无 t 8309 条），无第二语言字段 |
| B2 | 别名只存不显 | `aliases[]` 存在于内置库(278/302)，但列表/详情/搜索未充分使用；`ownedInList()` 不含 aliases；无编辑入口 |
| B3 | 联想缺失 | 全站无输入联想组件（grep 确认） |
| C1 | 分类「做不好」 | ①AFG 快照 57 部、`m`(半原创)全为空（One Piece f=92条/无混合）；②at_fg_cache 7 天缓存粘滞；③无 One Piece 115+43 新数据；④无强制刷新机制；⑤覆盖报告只给总量、无按番缺口排行；⑥判「待核」的集没有任何标签显示与编辑入口（`.ty` 仅在 by!=='none' 时渲染） |

## B. 数据规范（v2.7.0 落地）

- 剧集(series)：`title`(展示名·默认中文)、`nameJp`(原文名)、`aliases[]`(字符串；支持 `类型: 名称` 如 `台译: 航海王`)、`year`、`total`、`filler`/`mixed`(AFG区间压缩串)
- 分集(episode)：`s`(集号)、`t`(展示名)、`tOrig`(原文名·新)、`tCn`(中文名·新)、`src`/`srcNote`/`srcAt`(来源标注)
- 新增存储：`at_drafts`(草稿)、`at_relations`(关联 [ {a,b,type,at} ])、`at_edit_log`(修改台账)、`at_fg_snap`(Filler 数据版本)
- 显示规则：列表行显示 `t` + 第二语言行（t2 = 与 t 不同的那侧）；详情恒显 nameJp；别名以 chips 展示；检索归一化覆盖 title/nameJp/aliases/tOrig/tCn
- 去重：normTxt（大小写/全半角/标点/空白/繁简高频字）全站统一

## C. 分类修订

- 标签集合不变：`漫改(canon) / TV原创(filler) / 半原创(semi) / 剧场版(movie) / 待核(unknown)`
- AFG 映射：Manga Canon→漫改；Mixed Canon/Filler→半原创；Filler→TV原创；**Anime Canon→TV原创**（「动画原创」口径；记录在案，可调整）
- One Piece 数据更新（2026-09-16 抓取 animefillerlist.com）：f=115 条、m=43 条、全 1168 集覆盖（Manga 1010 / Mixed 43 / Anime Canon 21 / Filler 94）
- 快照版本 `20260916b`；启动时若版本变化→清 `at_fg_cache` →自动跑一次批量校准（旗标 `at_autocal`）
- 「版原创」候选定义（待确认）：剧场版/OVA/特别篇独占的原创内容——写入判定手册，暂不进入自动链。

## D. 模块（单脚本注入 `</body>` 前，零侵入 surgical）

1. **草稿系统**：白名单 mask（syncMask/at270AddMask/at270ProfMask/at270RelMask）→ 空白点击/ESC 关闭前自动存草稿 + toast；重开显示「恢复/丢弃」横幅；一键恢复。MutationObserver 挂横幅；内容全空自动删草稿。
2. **联想引擎**：文档级 input 委托；支持 #qKw(番剧池) / #qFilter(当前番集池) / #at270RelKw / #at270AddTitle / #libQ；↑↓/Enter/Esc；fixed 定位下拉。
3. **manualAdd 覆盖**：prompt 链 → 模态表单（中文名*/原文名/别名多行/年份/总集数），校验+去重+草稿；保存走 addShow 兼容路径。
4. **editSrc 覆盖**：原有来源标注 + 新增「集名（双语）」区（tOrig/tCn，单集作用）+ 台账。
5. **行级增强**：renderGrid 覆盖版（t2 行、集号点击编辑、q 支持 tOrig/tCn）；别名字段进检索（ownedInList 覆盖）。
6. **详情增强箱**：别名 chips + 编辑资料 + 关联条目（双向/解除）+ 修改历史 + 数据质量入口；内置库条目提供「加入片单并编辑」。
7. **台账**：at_edit_log（创建/资料/集名/来源/关联，cap 300）+ 详情最近 6 条 + 导出。
8. **数据质量面板**：全库指标（分类占比条、双语缺口、别名覆盖、关联/台账/草稿数）、待核 TOP5、双语缺口 TOP5、[重扫来源][导出审计 JSON][清空草稿]。
9. **srcBar 加 chip**：▦ 数据质量。

## E. 验证

- `tests/run-v270-tests.js`：T1 草稿链路 / T2 manualAdd+去重 / T3 别名检索 / T4 集名双语+行显示 / T5 联想 / T6 关联双向+解除 / T7 台账 / T8 质量面板 / T9 海贼王分类实测（54→TV原创、45→半原创、1→漫改）/ T10 无 JS 错误
- 复跑 `account-e2e`(10) + `run-regression`(19)（版本断言更新 2.7.0）
- 审计脚本：全库 302 部指标导出（双语完整率/别名覆盖/分类覆盖）≥200 条；盲测 30 条样本供第二人复核
- 回滚演练：文件级（backup_20260916_pre-v270）

## F. 交付

- `DELIVERY/anitracker-v2.7.0-double-lang-20260916/`：00 总览 HTML（preset 04 Fathom）+ 01 根因 + 02 字段规范 + 03 交互说明 + 04 分类判定手册 v2 + 05 验证记录 + 06 迁移回滚 + 07 交接FAQ + 09 数据来源更新说明 + assets
- 备份：`backup_20260916_pre-v270/`；版本三处一致；PROJECTS.md 登记
