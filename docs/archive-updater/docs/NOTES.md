# DSH插件管家 — 设计决策笔记

---

## 1. 品牌色变更（2026-09-14）

### 背景
原主色 `#6366F1`（靛蓝）是 AI/科技产品的默认色，缺乏差异化。
项目已选定「蓝紫盾牌」图标（深蓝→紫渐变），主色与之重复会丧失层次。

### 决策
改用 `#F46123`（橙红）作为品牌主色：
- 与蓝紫盾牌形成**冷暖对比**，视觉层次分明
- 在石墨底上比靛蓝更**醒目**
- 传递**活力、可靠、工具感**，而非"AI幻觉"的刻板印象
- 浅色主题下 **WCAG AA 通过**（靛蓝在浅底上对比度不足）

### 影响范围
- `src-vue/src/styles/main.css`：CSS 变量全量替换
- `website/assets/css/main.css`：官网变量 + 硬编码引用
- `src-vue/src/components/*.vue`：渐变、阴影、边框硬编码颜色
- `website/pages/*.vue`、`website/components/*.vue`：各页面引用

### 保留不变的
- 图标本身（蓝紫渐变）不动——它是图形资产，不是 CSS token
- 功能色（绿/橙/红/蓝）不动——它们是语义色，与品牌色无关
- 深色主题的背景色系不动——只换品牌强调色

---

## 2. 默认主题变更（2026-09-14）

### 背景
v1.18.6 及之前，默认主题为 dark。用户反馈："为什么打开就是黑的？"

### 决策
默认主题改为 light：
- 日常工具类软件，**浅色是更包容的默认**
- 深色可通过设置随时切换
- 符合操作系统默认行为（Windows 浅色模式占比更高）

### 技术实现
```ts
// src-vue/src/composables/useTheme.ts
// 之前
const theme = ref<ThemeMode>(loadTheme())  // loadTheme 默认 'dark'
// 之后
const theme = ref<ThemeMode>('light')
```

`loadTheme()` 保留逻辑不变——已保存的用户偏好不受影响，只有新用户首次打开看到浅色。

---

## 3. 官网 vs 客户端的视觉差异

| 维度 | 客户端（src-vue） | 官网（website） |
|------|-------------------|-----------------|
| 背景 | 深蓝黑 `#0B0F19` | 石墨黑 `#0E1013` |
| 卡片 | 玻璃拟态（blur+半透明） | 实底（无模糊） |
| 边框 | hairline 淡色 | hairline 实色 |
| 阴影 | 品牌色光晕 | 无/极淡 |
| 按钮 | 渐变（品牌→深端） | 纯色 |
| 默认主题 | light | dark（营销页惯例） |

**原则**：同一品牌，不同媒介不同表达。客户端是工具，追求可读性；官网是门面，追求质感。

---

## 4. 图标系统（v4.0 蓝紫盾牌）

### 决策
- 弃用旧版"D字+插头"简洁图标
- 选用方案6：深蓝→紫渐变底 + 白色插头 + 盾牌对勾 + 右下角循环箭头
- 语义：供电=装插件、盾牌=安全校验、箭头=更新

### 已部署位置
- `src-tauri/icons/`：Windows 18张 + icns + Android 17张 + iOS 18张
- `website/public/`：favicon 8档 + apple-touch-icon + og.png
- `src-vue/public/`：favicon.png + favicon-16.png + apple-touch-icon.png

### 更换方法
```bash
npx @tauri-apps/cli icon <1024源图>
```
源图位置：`DSH-Icons-Full-v4.0-蓝紫盾牌/04-设计源文件/当前选用-方案6-蓝紫盾牌-1024.png`

---

## 5. 版本同步机制（8处）

| 文件 | 用途 |
|------|------|
| `src-tauri/tauri.conf.json` | Tauri 构建版本号 |
| `src-tauri/Cargo.toml` | Rust crate 版本 |
| `src-tauri/package.json` | 构建日志显示 |
| `src-vue/package.json` | Vue 应用版本 |
| `website/package.json` | 官网头部徽章 |
| `website/nuxt.config.ts` | runtimeConfig.public.appVersion |
| 根 `package.json` | monorepo 根版本 |
| 服务器 `version.json` | 自更新通道权威源 |

**已踩过的坑**：`src-tauri/package.json` 漏同步导致"日志版本 ≠ 产物版本"；服务器 `version.json` 本地副本常落后需手动拉回。

---

## 6. 自更新发布流程

```
1. tauri build --bundles nsis  → 产出裸 exe + NSIS 安装包
2. scp exe → 服务器 /var/www/dsh-updater/
3. python3 publish-version.py --version X.Y.Z --sha256 ... --size ...
4. curl 自测 API
5. scp version.json 回仓库（保持副本同步）
```

**注意**：MSI 打包中文产品名会失败（codepage 1252 → 936），只用 NSIS。

---

## 7. 已踩过的坑（摘要）

详见 `AGENTS.md`，此处列出与本次改版相关的：

1. **主题切换不生效**：`useTheme.ts` 的 `loadTheme()` 默认值改了，但 `main.ts` 里 `applyTheme(theme.value)` 在 `onMounted` 之前调用，需在 import 后立即执行
2. **CSS 变量未覆盖 WeUI**：WeUI 的 `--weui-BRAND` 必须显式覆盖，否则原生按钮还是绿色
3. **硬编码颜色遗漏**：grep `rgba(99,102,241` 确认无残留，但需注意 SVG inline 颜色
4. **浅色主题 contrast**：部分组件的 fg-2/fg-3 在浅底上对比度不足，已在 v4 中加深
