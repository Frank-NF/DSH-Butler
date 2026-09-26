# DSH-PluginUpdater 图标命名与用途对照表

> **版本**: v2.0 玻璃拟态图标集
> **风格**: 24×24 矢量，2px 线宽，圆角端点，currentColor 描边
> **管理方式**: 内联 SVG path，统一在 `src-vue/src/components/WIcon.vue` 的 `ICONS` 对象中管理

---

## 一、品牌 Logo

| 图标名 | 用途 | 说明 |
|--------|------|------|
| `dsh-logo` | 顶部工具栏品牌 Logo | 插头+循环箭头组合，DSH 插件管家品牌标识 |

---

## 二、结构 / 插件

| 图标名 | 用途 | 说明 |
|--------|------|------|
| `plugin` | 插件图标 | 四宫格方块，插件市场/已安装列表的插件标识 |
| `grid` | 网格视图 | 同 plugin，用于视图切换 |
| `core` | 核心插件 | CPU 样式，标识核心/内置插件 |
| `layers` | 图层/快照 | 三层堆叠，用于快照功能入口 |
| `package` | 包裹/组合包 | 盒子样式，用于插件组合包卡片 |
| `server` | 服务器 | 两层机架，DSH Web 服务管理 |
| `folder` | 文件夹 | 打开插件本地目录 |

---

## 三、操作按钮

| 图标名 | 用途 | 说明 |
|--------|------|------|
| `refresh` | 刷新 | 环形箭头，刷新插件列表/检查更新 |
| `upload` | 上传 | 向上箭头，上传/导出 |
| `download` | 下载 | 向下箭头，下载/安装 |
| `install` | 安装 | 向下箭头+底线，插件市场安装按钮 |
| `update` | 更新 | 向上箭头+底线，插件更新按钮 |
| `uninstall` | 卸载 | 垃圾桶，带备份卸载 |
| `disable` | 禁用 | 电源符号，启用/禁用切换 |
| `trash` | 删除 | 垃圾桶，通用删除操作 |
| `power` | 电源 | 电源开关，服务启停 |
| `search` | 搜索 | 放大镜，搜索框 |
| `searchOff` | 搜索无结果 | 放大镜+横线，空状态 |
| `sort` | 排序 | 三条递减线，排序按钮 |
| `list` | 列表 | 列表符号，列表视图 |
| `copy` | 复制 | 重叠矩形，复制 URL/文本 |
| `zap` | 闪电 | MCP 服务管理入口 |
| `wand` | 魔法棒 | 自动扫描功能 |
| `rollback` | 回滚 | 逆时针箭头，备份回滚 |

---

## 四、状态 / 反馈

| 图标名 | 用途 | 说明 |
|--------|------|------|
| `check` | 成功/对勾 | 通用成功状态 |
| `close` | 关闭 | X 符号，对话框关闭按钮 |
| `info` | 信息 | 圆圈 i，信息提示 |
| `alert` | 警告 | 三角形感叹号，警告/错误提示 |
| `clock` | 时钟 | 最后扫描时间 |
| `inbox` | 收件箱/空状态 | 空列表占位图标 |
| `wifiOff` | 网络断开 | WiFi 关闭，网络异常状态 |
| `shield` | 盾牌 | 修复/安全功能 |
| `fileText` | 文本文件 | 发行说明/文档 |
| `star` | 收藏/星标 | GitHub Stars 数量（实心） |
| `more` | 更多菜单 | 三个圆点（实心），更多操作 |

---

## 五、状态徽章（圆圈+符号）

| 图标名 | 用途 | 颜色建议 |
|--------|------|----------|
| `status-latest` | 最新版本 | 绿色 #00B42A |
| `status-update` | 可更新 | 橙色 #FF7D00 |
| `status-failed` | 检查失败 | 红色 #F53F3F |
| `status-disabled` | 已禁用 | 灰色 #86909C |

---

## 六、MCP 服务管理

| 图标名 | 用途 | 说明 |
|--------|------|------|
| `mcp-connect` | MCP 连接状态 | 两个节点+连接线 |
| `mcp-radar` | 连通性预检 | 雷达波纹，探测服务可达性 |
| `mcp-token` | 密钥配置 | 挂锁，Token/环境变量管理 |

---

## 七、组合包 / 快照 / 离线包

| 图标名 | 用途 | 说明 |
|--------|------|------|
| `combo-package` | 插件组合包 | 三层堆叠，行业预制组合包 |
| `snapshot` | 快照导出 | 相机，导出插件配置快照 |
| `snapshot-import` | 快照导入 | 文件+向下箭头，导入快照 |
| `offline-package` | 离线打包 | 压缩包，离线安装包 |
| `zip` | 压缩包 | 同 offline-package，通用 ZIP |
| `registry` | 注册表/源 | 列表+圆点，插件源/注册表配置 |

---

## 八、外观 / 导航

| 图标名 | 用途 | 说明 |
|--------|------|------|
| `settings` | 设置 | 齿轮，设置对话框入口 |
| `globe` | 地球 | 官网链接 |
| `wrench` | 扳手 | 修复功能 |
| `sun` | 太阳 | 浅色主题切换 |
| `moon` | 月亮 | 深色主题切换 |
| `link` | 链接 | 链条，外部链接 |
| `external` | 外部跳转 | 方框+箭头，打开外部页面 |
| `arrowRight` | 右箭头 | 通用右箭头/跳转 |
| `chevronRight` | 右 Chevron | 展开/收起（右） |
| `chevronDown` | 下 Chevron | 展开/收起（下） |

---

## 九、使用方式

### Vue 组件中使用

```vue
<template>
  <!-- 基础用法 -->
  <WIcon name="refresh" :size="16" />

  <!-- 按钮中使用 -->
  <WButton icon="download">安装</WButton>

  <!-- 状态徽章 -->
  <WIcon name="status-latest" :size="14" class="text-success" />
</template>
```

### 图标属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | - | 图标名称（必填） |
| `size` | number/string | 16 | 图标尺寸（px） |
| `strokeWidth` | number | 2 | 线条粗细 |
| `spin` | boolean | false | 是否旋转动画 |

---

## 十、新增图标步骤

1. 打开 `src-vue/src/components/WIcon.vue`
2. 在 `ICONS` 对象中添加新条目：
   ```typescript
   'new-icon': '<path d="..."/>',
   ```
3. SVG 规范：24×24 viewBox，2px 线宽，`stroke-linecap="round"`，`stroke-linejoin="round"`
4. 在本文档中补充图标名和用途说明
