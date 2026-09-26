# DSH 插件升级管理工具 — UI 设计系统 v2

> 版本：v2.0.0  
> 日期：2026-08-28  
> 设计理念：现代极简 + 玻璃拟态 + 深色主题 + Three.js 3D 效果

---

## 设计哲学

### 核心风格
- **玻璃拟态**：半透明背景 + backdrop-filter blur，营造层次感和现代感
- **深色主题优先**：#0F172A 深蓝黑背景，减少视觉疲劳
- **极简主义**：去除多余装饰，内容优先
- **微渐变**： subtle 渐变作为视觉点缀

### 目标体验
- 专业感：像专业开发工具应有的气质
- 沉浸感：深色主题让用户专注于内容
- 流畅感：自然的动效和过渡
- 科技感：Three.js 粒子效果增加未来感

---

## 色彩系统

### 主色板

| Token | 色值 | 用途 |
|-------|------|------|
| `primary` | `#6366F1` | 主色调（靛蓝） |
| `primary-light` | `#818CF8` | 主色亮版 |
| `primary-dark` | `#4F46E5` | 主色暗版 |
| `accent` | `#10B981` | 强调色（翠绿） |
| `warning` | `#F59E0B` | 警告色（琥珀） |
| `danger` | `#EF4444` | 危险色（红色） |

### 背景色系（深色主题）

| Token | 色值 | 用途 |
|-------|------|------|
| `bg-primary` | `#0F172A` | 页面背景 |
| `bg-secondary` | `#1E293B` | 卡片背景 |
| `bg-tertiary` | `#334155` | 悬浮背景 |
| `bg-glass` | `rgba(30, 41, 59, 0.7)` | 玻璃效果 |

### 文字色系

| Token | 色值 | 用途 |
|-------|------|------|
| `text-primary` | `#F8FAFC` | 主要文字 |
| `text-secondary` | `#CBD5E1` | 次要文字 |
| `text-muted` | `#94A3B8` | 辅助文字 |
| `text-accent` | `#6366F1` | 强调文字 |

---

## 玻璃拟态效果

```css
.glass {
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
```

---

## 字体系统

- **主字体**: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif
- **代码字体**: 'JetBrains Mono', monospace
- **字号层级**: 12px / 14px / 16px / 18px / 24px / 32px / 48px

---

## 组件清单

### 已完成组件

| 组件 | 文件路径 | 状态 |
|------|----------|------|
| 桌面客户端原型 | `/desktop-client.html` | ✅ |
| 官网首页 | `/website-index.html` | ✅ |
| 插件市场 | `/website-plugins.html` | ✅ |
| 下载中心 | `/website-download.html` | ✅ |
| 文档中心 | `/website-docs.html` | ✅ |
| Three.js 粒子背景 | `/threejs/hero-3d.html` | ✅ |
| Three.js 星座连线 | `/threejs/constellation.html` | ✅ |
| 3D 几何展示 | `/threejs/3d-showcase.html` | ✅ |
| 设置对话框 | `/components/settings-dialog.html` | ✅ |
| 更新进度对话框 | `/components/update-progress.html` | ✅ |
| 发布说明对话框 | `/components/release-notes.html` | ✅ |
| Toast 通知 | `/components/toast.html` | ✅ |
| 空状态/错误状态 | `/components/empty-states.html` | ✅ |
| 确认对话框 | `/components/confirm-dialog.html` | ✅ |
| 骨架屏 Loading | `/components/skeleton.html` | ✅ |
| 移动端导航 | `/components/mobile-nav.html` | ✅ |

### 待实现组件

| 组件 | 优先级 |
|------|--------|
| 插件详情页 | 中 |
| 更新历史时间线 | 低 |
| 批量操作面板 | 中 |
| 键盘快捷键提示 | 低 |

---

## 设计规范

### 卡片组件
- 背景: 玻璃效果
- 圆角: 16px
- 阴影: 0 8px 32px rgba(0,0,0,0.3)
- Hover: 上浮 4px + 阴影增强

### 按钮组件
- 主按钮: 渐变背景 `#6366F1 → #818CF8`
- 圆角: 12px
- Hover: 亮度提升 10%
- 点击: 缩放 0.95

### 表格组件
- 行背景: 半透明深色
- Hover: 高亮行背景
- 分割线: 1px solid rgba(255,255,255,0.05)

---

## 页面结构

### 桌面客户端
```
┌─────────────────────────────────────────┐
│  [Logo]     [搜索框]          [设置] [用户] │  ← 玻璃导航栏
├─────────────────────────────────────────┤
│  统计面板（可更新数、总插件数）            │  ← 玻璃卡片
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐   │
│  │  插件表格（玻璃背景）             │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 官网
```
┌─────────────────────────────────────────┐
│  [Logo]  导航链接              [下载]    │  ← 透明玻璃导航
├─────────────────────────────────────────┤
│                                         │
│     Hero 区域（Three.js 粒子背景）      │
│     主标题 + CTA 按钮                    │
│                                         │
├─────────────────────────────────────────┤
│  功能特性网格（玻璃卡片）                │
├─────────────────────────────────────────┤
│  下载区域（平台卡片）                    │
├─────────────────────────────────────────┤
│  Footer（深色）                         │
└─────────────────────────────────────────┘
```

---

## Three.js 效果规范

### 粒子系统
- 粒子数量: 800-1500
- 大小: 0.03-0.08
- 颜色: 靛蓝色调 (#6366F1)
- 混合模式: AdditiveBlending

### 交互
- 鼠标跟随旋转
- 自动旋转（可选）
- 星座连线（可选开关）

### 性能
- 限制 pixelRatio: Math.min(window.devicePixelRatio, 2)
- 使用 requestAnimationFrame
- pointer-events: none 避免阻挡交互

---

**文档结束**
