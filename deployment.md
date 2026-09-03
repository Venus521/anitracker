# AniTracker 部署与使用指南

## 一、快速开始

### 1.1 本地使用

1. 下载 `ani-tracker.html`
2. 用浏览器直接打开
3. 开始使用！

**注意**: 由于浏览器安全限制，部分功能需要本地服务器环境：
- WebDAV 同步需要 HTTPS 或本地服务器
- Service Worker 需要 HTTPS

### 1.2 推荐部署方式

#### 方式一：本地服务器（推荐）
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .

# PHP
php -S localhost:8080
```

#### 方式二：GitHub Pages
1. 上传 `ani-tracker.html` 到 GitHub 仓库
2. 启用 Pages 功能
3. 访问 `https://username.github.io/repository/ani-tracker.html`

#### 方式三：NAS/WebDAV
配合 Alist 或其他 WebDAV 服务部署：
```
http://your-server:5244/dav/animhub/ani-tracker.html
```

## 二、功能说明

### 2.1 核心功能

#### 添加番剧
1. 点击右上角 ＋
2. 输入番剧名称
3. 点击搜索
4. 选择结果点击"添加"
5. 系统自动拉取剧集列表

#### 标记进度
- 点击集数按钮：已看 → 回看 → 未看
- 显示颜色：绿色=已看，红色=回看

#### 筛选功能
- 状态筛选：全部/追中/想看/已看/弃番
- 类型筛选：漫改/TV原创/半原创
- 灌水类型：全部/正篇/灌水/半原创

### 2.2 高级功能

#### Bangumi 同步
1. 设置 → 同步
2. 粘贴 Bangumi access_token
3. 验证成功后自动同步

#### WebDAV 同步
1. 设置 → 同步
2. 填写 WebDAV 地址
3. 测试连接
4. 保存配置

#### 灌水池校准
1. 进入番剧详情
2. 点击"校准灌水池"
3. 系统查询 Anime Filler Guide
4. 自动标注灌水集数

#### 删减信息
- 系统内置部分知名删减番剧信息
- 显示 ⚠ 删减标记
- 可查看删减说明

## 三、数据管理

### 3.1 本地存储
- 所有数据保存在浏览器 LocalStorage
- 支持导出/导入 JSON 备份
- 多设备需手动同步或配置 WebDAV

### 3.2 同步机制
- WebDAV 每 6 分钟自动同步
- 冲突时保留本地版本
- 支持多设备协作

## 四、问题排查

### 4.1 常见问题

**Q: 搜索无结果？**
- 检查网络连接
- 尝试英文或日文名称
- 使用内置库浏览

**Q: 灌水池校准失败？**
- 该番剧可能未被收录
- 检查网络连接
- 稍后重试

**Q: 同步失败？**
- 检查 WebDAV 地址是否正确
- 验证账号密码
- 确认网络可达

**Q: 页面空白？**
- 清除浏览器缓存
- 检查浏览器兼容性
- 尝试其他浏览器

### 4.2 浏览器兼容性

| 功能 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| 核心功能 | ✅ | ✅ | ✅ | ✅ |
| WebDAV 同步 | ✅ | ✅ | ✅ | ✅ |
| Bangumi 同步 | ✅ | ✅ | ✅ | ✅ |
| Service Worker | ✅ | ✅ | ✅* | ✅ |

*Safari 部分版本支持有限

## 五、开发说明

### 5.1 文件结构
```
ani-tracker.html  # 主程序（单文件）
research/
  authority-sources.md  # 权威网站报告
README.md  # 本说明
```

### 5.2 自定义配置

编辑 `ani-tracker.html` 可修改：
- `INTERNAL_SHOWS`：内置番剧库
- `CENSOR_INFO`：删减信息
- `TYPE_ORDER`：类型筛选顺序
- CSS 变量：主题颜色

### 5.3 添加新番剧

在 `INTERNAL_SHOWS` 数组中添加：
```javascript
{
  id: "unique-id",
  title: "番剧名称",
  nameJp: "日文名",
  year: "2024",
  total: 24,
  type: "manga-adapt",
  eps: [...]
}
```

## 六、性能建议

### 6.1 优化清单
- ✅ 单文件部署，减少 HTTP 请求
- ✅ 图片懒加载
- ✅ LocalStorage 缓存
- ✅ Service Worker 支持

### 6.2 已知限制
- 内置库 300+ 部，首屏加载约 2 秒
- 灌水池校准依赖外部 API
- 大量集数时渲染可能卡顿

## 七、版本历史

### v2.1 (2026-08-29)
- 修复类型分类 BUG
- 添加删减信息标注
- 优化筛选顺序
- 完善权威网站报告

### v2.0
- 重构数据存储
- 添加灌水池校准
- 优化 UI 设计

---

**技术支持**: 查看源码注释或联系开发者
**更新日志**: 见 Git 提交记录
