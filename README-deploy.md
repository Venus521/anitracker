# 追迹 AniTracker

单文件追番进度管理 PWA（移动端优先排版）。

## 功能

- 番剧添加（Bangumi API 搜索，自动拉取剧集列表）
- 集数进度标记（已看/回看/未看）与状态筛选（在看/想看/看完/弃）
- 类型自动分类（漫改 / TV原创 / 半原创）
- 灌水校准：内置 Anime Filler List 离线数据集（212 部长篇快照），标记 Filler/Mixed 集，零网络依赖
- 删减信息标注
- 账号云同步（腾讯云开发 CloudBase，按 ownerId 隔离；可选登录/注册）
- 数据导出/导入 JSON
- PWA：可安装、离线可用

> v2.10.0 起已移除 Bangumi 观看进度双向同步与 WebDAV 文件同步（见 readme.md 版本史 / CHANGELOG.md）。
> Bangumi 仅保留**搜索 / 导入 / 关联**链路。

## 使用

- 在线版：`https://<用户名>.github.io/anitracker/`（入口 `index.html`）
- 本地：双击 `C:\Users\Venus\DeskBox\启动方式\AniTracker 追迹.lnk`（按需起服 8089，空闲 15 分钟自退），或直接用浏览器打开 `index.html`
  （旧的项目根 `AniTracker追迹-一键打开.bat` / `启动-本地服务器.bat` / `server.py` 已于 2026-09-26 退役到
  `_退役_启动入口_20260926_旧bat\`，含还原说明——启动入口统一放 hub，不再留第二份逻辑）
- **入口文件名**：`index.html` 为唯一源，`ani-tracker.html` 是它的同步副本（`python 同步双入口.py` 生成），两者字节一致

## 隐私

不收集任何数据，记录仅存本机 LocalStorage；登录后的片单按账号存于 CloudBase（详见 [privacy.html](privacy.html)）。

## 数据来源与致谢

- 番剧元数据：[Bangumi](https://bgm.tv)（api.bgm.tv）
- 灌水（Filler/Mixed）数据：[Anime Filler List](https://www.animefillerlist.com) 全量抓取快照（212 部；v2.8.0 起替代已停更的 animefillerguide.com）

## License

仅供学习与个人使用。
