# DSH 插件升级管理工具 — UI 视觉升级 v3 设计文档

> **版本**: v3.0.0  
> **日期**: 2026-08-30  
> **状态**: ✅ 已完成并交付

---

## 📋 变更背景

**用户反馈**: 「这也没做美化啊，比原来还难看」

**诊断分析**:
- 上一版 WeUI 重构虽然使用了原生组件，但配色停留在微信默认「白底 + 翠绿」风格
- 缺少品牌识别度，视觉上接近小程序模板，没有桌面软件的精致感
- 卡片、Tab、按钮层级太平，没有阴影和景深

**解决方案**:
在保留 WeUI 组件结构的前提下，覆盖一层「靛蓝深色玻璃拟态」品牌主题，回归现代极简 + 毛玻璃风格。

---

## 🎨 设计系统 (Design System)

### 品牌色体系

| Token | 色值 | 用途 |
|-------|------|------|
| `--brand` | `#6366F1` | 主品牌色（替换 WeUI 默认绿） |
| `--brand-2` | `#818CF8` | 品牌辅助色（悬停、次要强调） |
| `--brand-3` | `#4F46E5` | 品牌深色（渐变终点） |
| `--brand-soft` | `rgba(99,102,241,0.14)` | 品牌低饱和度背景 |
| `--brand-glow` | `rgba(99,102,241,0.35)` | 品牌光晕 |

### 功能色

| Token | 色值 | 语义 |
|-------|------|------|
| `--c-success` | `#22C55E` | 成功 / 可用 |
| `--c-warn` | `#F59E0B` | 警告 / 可更新 |
| `--c-danger` | `#EF4444` | 危险 / 错误 |
| `--c-info` | `#38BDF8` | 信息 |

### 深色主题

| Token | 色值 | 用途 |
|-------|------|------|
| `--bg-page` | `#0B0F19` | 页面背景（深蓝黑） |
| `--bg-card` | `rgba(30,41,59,0.72)` | 卡片背景（半透明） |
| `--bg-group` | `rgba(51,65,85,0.45)` | 分组/次要背景 |
| `--bg-hover` | `rgba(148,163,184,0.1)` | 悬停背景 |
| `--bg-input` | `rgba(15,23,42,0.6)` | 输入框背景 |
| `--fg` | `#F8FAFC` | 主文字 |
| `--fg-1` | `#E2E8F0` | 次要文字 |
| `--fg-2` | `#94A3B8` | 三级文字 |
| `--fg-3` | `#64748B` | 禁用/提示文字 |
| `--border` | `rgba(148,163,184,0.14)` | 边框色 |
| `--border-strong` | `rgba(148,163,184,0.24)` | 强边框（焦点） |

### 阴影系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.25)` | 微投影（选中态） |
| `--shadow` | `0 4px 24px rgba(0,0,0,0.35)` | 卡片投影 |
| `--shadow-lg` | `0 12px 40px rgba(0,0,0,0.45)` | 悬浮/弹出层投影 |

### 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--r-xs` | `4px` | 小元素 |
| `--r-sm` | `8px` | 按钮/标签 |
| `--r-md` | `12px` | 卡片/输入框 |
| `--r-lg` | `16px` | 大卡片/Dialog |
| `--r-xl` | `20px` | 全屏弹窗 |
| `--r-full` | `999px` | 药丸/Capsule |

### 特效

```css
--glass-blur: blur(20px) saturate(160%);
```

---

## 🔧 组件变更清单

### 1. 按钮系统 (WButton.vue)

| 变体 | 样式 |
|------|------|
| `primary` | 靛蓝渐变 + 柔和投影 (`rgba(99,102,241,0.35)`) |
| `default` | 半透明背景 + 边框 |
| `warn` | 红色半透明背景 + 红色边框 |
| `plain` | 透明背景 + 强边框 |

**交互状态**:
- 悬停：轻微抬升 (`translateY(-2px)`) + 阴影增强
- 按下：GSAP `pressIn` 动画（缩放 0.97）
- 加载：图标旋转 + 禁用态

### 2. 顶部导航 (HeaderBar.vue)

**布局调整**:
- Logo 改为渐变方块 + 内联图标
- 搜索框高度统一 40px，焦点时带靛蓝光晕
- 统计胶囊带边框和图标
- 图标按钮组聚合为容器（背景 + 圆角）
- 状态栏融入底部，带半透明背景

### 3. Tab 导航

**桌面端药丸 Tab**:
```css
background: var(--bg-group);
border-radius: var(--r-full);
padding: 4px;
display: inline-flex;
```

选中态：
```css
background: var(--bg-card);
box-shadow: var(--shadow-sm);
```

**移动端底栏**:
- 玻璃拟态背景 + 固定定位
- 激活态文字变品牌色

### 4. 卡片系统

```css
.w-card {
  background: var(--bg-card);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.w-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
  border-color: var(--border-strong);
}
```

**状态边框**:
- 可更新：`rgba(245,158,11,0.45)` (橙色)
- 核心插件：`rgba(99,102,241,0.45)` (靛蓝)
- 已安装：`rgba(34,197,94,0.4)` (绿色)

### 5. Dialog / Modal

```css
background: var(--bg-card);
backdrop-filter: var(--glass-blur);
border: 1px solid var(--border);
border-radius: var(--r-xl);
box-shadow: var(--shadow-lg);
```

关闭按钮改为圆形背景 + 悬停变浅。

### 6. Toast / 通知

- 玻璃拟态卡片
- 图标颜色语义化（成功绿/警告橙/信息蓝）
- 支持多条堆叠

### 7. 表单控件

**输入框**:
```css
background: var(--bg-input);
border: 1px solid var(--border);
border-radius: var(--r-md);
```

焦点态：
```css
border-color: var(--brand);
box-shadow: 0 0 0 3px var(--brand-soft);
```

**Switch**:
- 默认：半透明灰色
- 激活：靛蓝渐变

**Radio/Checkbox**:
- 激活图标颜色 → 品牌色

### 8. 空状态 (WEmpty)

- 图标圆圈改为半透明背景 + 细边框
- 标题加粗，颜色使用 `--fg`
- 描述颜色使用 `--fg-2`

### 9. 进度条

```css
background: linear-gradient(90deg, var(--brand) 0%, var(--brand-2) 100%);
border-radius: var(--r-full);
```

---

## 📁 文件变更明细

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/styles/main.css` | 重写 | 完整设计 token 系统 + WeUI 组件覆盖 |
| `src/composables/useTheme.ts` | 修改 | 默认主题从 `auto` → `dark` |
| `src/components/HeaderBar.vue` | 重写 | 新布局、新 Logo、玻璃拟态 |
| `src/components/WButton.vue` | 精简 | 移除与全局冲突的 scoped 样式 |
| `src/components/PluginTable.vue` | 重写 | 新卡片样式、新 Tab 样式 |
| `src/components/WDialog.vue` | 修改 | 玻璃拟态、新圆角、新颜色 |
| `src/components/WEmpty.vue` | 修改 | 新图标样式、新颜色 |
| `src/components/ReleaseNotesDialog.vue` | 修改 | 边框颜色统一 |
| `src/components/RepairDialog.vue` | 修改 | 边框颜色统一 |
| `src/App.vue` | 修改 | 错误提示条新样式 |

---

## ✅ 验证结果

### 类型检查
```bash
npx vue-tsc --noEmit
# 结果：✅ 零错误
```

### 构建
```bash
npx vite build --outDir dist-v3
# 结果：✅ 成功
# 产物：CSS 222KB / JS 261KB（gzip: 30KB / 96KB）
```

### 打包
```bash
tauri build
# 结果：✅ 成功
# 产物：
#   - DSH插件升级管理-v1.0.0-安装版.exe (4.06MB)
#   - DSH插件升级管理-v1.0.0.msi (5.82MB)
```

### 在线预览
- 地址：http://<部署服务器>:8071/
- 状态：✅ 已部署

---

## 🎯 设计决策记录

### Q: 为什么默认深色而非浅色？
**A**: 
1. 用户历史偏好支持深色/毛玻璃风格（之前的 v2 设计已验证）
2. 桌面工具类软件普遍采用深色主题
3. 深色更能突出品牌靛蓝色的发光效果
4. 节省屏幕电量（OLED 设备）

### Q: 为什么不继续使用 Element Plus？
**A**: 
1. WeUI 更轻量（~200KB vs ~400KB）
2. WeUI 组件更克制，适合作为基础框架
3. 项目已有 35 个内联 SVG 图标，不再依赖图标库
4. GSAP 已集成，可以精细控制动画

### Q: 如何保持与 WeUI 的兼容性？
**A**: 
1. 保留所有 WeUI 原生类名（`.weui-btn`, `.weui-dialog` 等）
2. 通过 CSS 变量覆盖实现主题切换
3. 自定义类名（`.w-*`）负责业务扩展
4. 完全向后兼容，WeUI 文档可直接参考

---

## 🔮 后续优化方向

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P0 | 浅色主题适配 | 当前浅色主题变量可能不完整 |
| P1 | 移动端体验优化 | 需要真机测试触摸反馈 |
| P1 | 无障碍审查 | 颜色对比度 WCAG AA 验证 |
| P2 | 动效增强 | 页面切换、列表加载的微动效 |
| P2 | 图标升级 | 当前 35 个图标可能不够用 |
| P3 | 主题切换器 | 在设置中提供主题选择 |

---

## 📎 相关资源

- [WeUI 官方文档](https://weui.io/)
- [GSAP 动画库](https://greensock.com/gsap/)
- [Tailwind CSS 设计系统参考](https://tailwindcss.com/docs)
- [WCAG 2.1 无障碍标准](https://www.w3.org/WAI/WCAG21/quickref/)

---

**UI Designer** — Pixel-perfect interfaces, accessible by default.
