# DSH插件管家 — 产品落地页规范 v1

> 本文档定义官网（dsh.huilinsh.cn）的视觉语言、布局规范与交互标准。
> 与桌面客户端（src-vue）保持品牌一致，但官网采用独立的「工程克制」美学。

---

## 1. 设计定位

| 维度 | 值 |
|------|-----|
| 产品 | DSH插件管家 — DeepSeek Harness 插件管理工具 |
| 目标用户 | DSH 开发者、AI Agent 使用者、企业 IT 管理员 |
| 视觉风格 | 工程克制 · 石墨底 · 单色强调 · hairline 边框 |
| 去掉的元素 | 玻璃拟态模糊、渐变背景、emoji 图标、数字不等宽 |

**核心原则**：信息密度优先，装饰让步于功能。

---

## 2. 色彩系统

### 2.1 品牌色（橙红，v4.1）

```css
--brand: #F46123;       /* 主品牌色 */
--brand-light: #F78A5E;  /* 悬停/强调 */
--brand-dim: rgba(244, 97, 35, 0.14);  /* 背景填充 */
```

### 2.2 石墨底色调

```css
--bg-primary:   #0E1013;  /* 页面背景 */
--bg-secondary: #15181D;  /* 卡片/面板 */
--bg-tertiary:  #1B1F26;  /* 次要背景 */
```

### 2.3 文字灰阶（WCAG AA）

```css
--text-primary:   #E8EAED;  /* 标题/主文字  16.8:1 */
--text-secondary: #A8ADB5;  /* 正文       7.2:1 */
--text-muted:     #71777F;  /* 辅助说明   4.5:1 */
```

### 2.4 边框系统（hairline）

```css
--line:      #262B33;  /* 普通边框 */
--line-strong: #31363F; /* hover/focus */
```

### 2.5 语义色

| Token | 值 | 用途 |
|-------|-----|------|
| `--accent` | `#3FB27F` | 成功/在线 |
| `--warning` | `#D9A03C` | 警告/可更新 |
| `--danger` | `#D65F5F` | 错误/危险 |
| `--info` | `#58A6C9` | 信息提示 |

---

## 3. 排版系统

### 3.1 字体栈

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
  'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
```

等宽字体（数字/代码）：
```css
font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
```

### 3.2 字号阶梯

| 层级 | Desktop | Mobile | 用途 |
|------|---------|--------|------|
| H1 | 44px / -0.025em | 30px | Hero 主标题 |
| H2 | 26px / -0.02em | 22px | 区块标题 |
| Body | 15px / 1.6 | 15px / 1.65 | 正文 |
| Small | 13px | 12px | 辅助文字 |
| Caption | 11px | 10px | 标签/徽章 |

### 3.3 行高与字重

- 标题：`font-weight: 700`，`letter-spacing: -0.025em`
- 正文：`line-height: 1.6`，`text-wrap: pretty`
- 数字：`font-variant-numeric: tabular-nums`（一律等宽）

---

## 4. 布局规范

### 4.1 容器

```css
max-width: 1140px;
margin: 0 auto;
padding: 0 24px;
```

### 4.2 间距节奏

```css
--sp-xs:  4px;
--sp-sm:  8px;
--sp-md:  16px;
--sp-lg:  24px;
--sp-xl:  32px;
--sp-2xl: 48px;
--sp-3xl: 72px;
```

### 4.3 圆角系统

```css
--radius-sm:  6px;   /* 按钮、输入框 */
--radius-md:  8px;   /* 卡片内元素 */
--radius-lg:  10px;  /* 卡片、面板 */
--radius-xl:  12px;  /* 对话框 */
```

**规则**：全站统一使用这套圆角，不混用。

---

## 5. 组件规范

### 5.1 按钮

| 变体 | 背景 | 边框 | 文字 | hover |
|------|------|------|------|-------|
| `primary` | `--brand` | none | white | `#E85A1C` |
| `outline` | transparent | `--line-strong` | `--text-secondary` | border亮 + `--text-primary` |
| `ghost` | transparent | none | `--text-secondary` | `--bg-tertiary` |

**尺寸**：
- 默认：`padding: 11px 22px`，`font-size: 14px`
- 小型：`padding: 7px 14px`，`font-size: 13px`

**交互**：按下时 `translateY(1px)`

### 5.2 卡片

```css
background: var(--bg-secondary);
border: 1px solid var(--line);
border-radius: var(--radius-lg);
transition: border-color var(--dur) var(--ease);
```

hover 时只亮边框，不变背景。

### 5.3 徽章（Badge）

方角，无 pill 化：
```css
border-radius: 4px;
font-size: 12px;
padding: 2px 8px;
```

### 5.4 数据展示

- 所有数字用等宽字体（`.num` class）
- 无发光效果，无渐变背景
- 统计行用 `border-top` 分隔，不用卡片包裹

### 5.5 骨架屏

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #1a1e24 25%, #22262e 50%, #1a1e24 75%);
  animation: shimmer 1.5s infinite;
}
```

---

## 6. 动效规范

### 6.1 全局参数

```css
--ease: cubic-bezier(0.2, 0, 0, 1);  /* power2.out */
--dur: 0.18s;
```

### 6.2 动效原则

- 只动画 `transform` 和 `opacity`
- hover 反馈 ≤ 0.2s
- 入场动画 ≤ 0.3s
- 尊重 `prefers-reduced-motion`

### 6.3 标准动效

| 场景 | 时长 | 缓动 | 效果 |
|------|------|------|------|
| 卡片 hover | 0.18s | ease-out | border 变色 |
| 按钮按下 | 0.1s | ease | translateY(1px) |
| 列表入场 | 0.3s | ease-out | opacity 0→1 + translateY(8px) |
| 弹窗出现 | 0.25s | ease-out | scale(0.96→1) + fade |

---

## 7. 首页结构

```
┌─────────────────────────────────────────┐
│  Header (固定，石墨底，hairline 底边)      │
├─────────────────────────────────────────┤
│                                         │
│  HERO                                   │
│  - 左对齐，no鲸鱼图                      │
│  - Eyebrow: 版本 + MIT                   │
│  - H1: 主标题 (≤2行)                     │
│  - Desc: 副标题 (≤20词)                  │
│  - CTAs: 下载 + 浏览市场                  │
│  - Stats line: 4项数据 (等宽)             │
│                                         │
├─────────────────────────────────────────┤
│  SECTION: 社区热门                        │
│  - 左对齐标题                            │
│  - 6卡片 grid (3列)                      │
│  - 含排名数字 + star 数                  │
│                                         │
├─────────────────────────────────────────┤
│  SECTION: 桌面客户端                      │
│  - 两栏非对称 (能力 + 安全)               │
│  - 功能列表 + CTA                        │
│                                         │
├─────────────────────────────────────────┤
│  Footer                                 │
└─────────────────────────────────────────┘
```

### Hero 约束

- 最大高度：viewport 内可见，CTA 不需要滚动
- H1：max 2 行，44px desktop / 30px mobile
- 副标题：max 20 词，4 行以内
- 数据行：border-top 分隔，不用卡片

---

## 8. 响应式断点

| 断点 | 宽度 | 变化 |
|------|------|------|
| sm | 640px | 单列布局 |
| md | 768px | 导航折叠 |
| lg | 1024px | 内容区全宽 |
| xl | 1280px | 容器 max-width |

### 移动端适配规则

- Hero padding: `64px 0 48px`
- H1: `30px`
- Stats line: gap 缩小，分隔符隐藏
- Grid: 单列
- Section padding: `48px 0`

---

## 9. 禁止事项（Anti-Patterns）

- ❌ 玻璃拟态模糊（backdrop-filter blur）
- ❌ 渐变背景（mesh gradient / aurora）
- ❌ emoji 作为图标
- ❌ 不等宽数字混排
- ❌ 紫色/蓝色 AI 默认调
- ❌ 居中 Hero + 大鲸鱼图
- ❌ 三段等宽功能卡片
- ❌ 无限循环微动效
- ❌ Inter + slate-900 默认组合
- ❌ 按钮文字换行（desktop）
- ❌ 同页面多处相同意图 CTA

---

## 10. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-12 | 初始定义，石墨底 + 单色强调 |
| v1.1 | 2026-09-14 | 品牌色从靛蓝 #6366F1 改为橙红 #F46123 |
