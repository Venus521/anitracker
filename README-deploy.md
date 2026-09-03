# 追迹 AniTracker

单文件追番进度管理 PWA（移动端优先排版）。

## 功能

- 番剧添加（Bangumi API 搜索，自动拉取剧集列表）
- 集数进度标记（已看/回看/未看）与状态筛选（在看/想看/看完/弃）
- 类型自动分类（漫改 / TV原创 / 半原创）
- 灌水校准：内置 Anime Filler Guide 离线数据集（268 部长篇快照），标记 Filler/Mixed 集，零网络依赖
- 删减信息标注
- WebDAV 云同步（自建地址，6 分钟自动同步）
- Bangumi 账号收藏同步（可选）
- 数据导出/导入 JSON
- PWA：可安装、离线可用

## 使用

- 在线版：`https://<用户名>.github.io/anitracker/ani-tracker.html`
- 本地：直接用浏览器打开 `ani-tracker.html`

## 隐私

不收集任何数据，记录仅存本机 LocalStorage（详见 [privacy.html](privacy.html)）。

## 数据来源与致谢

- 番剧元数据：[Bangumi](https://bgm.tv)（api.bgm.tv）
- 灌水（Filler/Mixed）数据：[Anime Filler Guide](https://www.animefillerguide.com) 离线快照（2026-09-03 抓取，共 268 部）

## License

仅供学习与个人使用。
