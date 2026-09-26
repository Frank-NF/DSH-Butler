# DSH管家官网重设计 · 设计与落地说明

> 日期：2026-09-26 ｜ 原型：「site/redesign.html」（自包含单文件，可直接双击打开预览）
> 参照物：线上 https://dsh.huilinsh.cn/ 现有内容 ｜ 技能链：ui-ux-pro-max → design-taste-frontend → gpt-taste

## 0. 设计判读与拨杆

- **判读**：本地开发者工具「DSH管家」的产品官网（marketing landing），受众是 Windows 上的 DSH 用户；视觉走「墨黑暖底 + 品牌橙红」的 dark-tech 极简语言，与产品 VI 深色令牌同源；原生 CSS + GSAP ScrollTrigger 动效。
- **拨杆**：VARIANCE 7 / MOTION 8 / DENSITY 3（用户明确要求动效丰富 → 动效拨到 8）。
- **设计系统检索结论（ui-ux-pro-max）**：深色 OLED 基调 + 等宽字体点缀 + 高对比文本。品牌色不取其推荐绿，锁定 VI 主橙红 #F06A3D 家族（避免与鲸鱼标志冲突）。

## 1. 网站结构（单页 + 文档页）

| 顺序 | 区块 | 锚点 | 作用 |
| --- | --- | --- | --- |
| 1 | 固定导航 | .nav | 玻璃拟态、下滚隐藏上滚出现、当前区块高亮；移动端汉堡全屏菜单 |
| 2 | 首屏 Hero | #top | 一句话定位 + 双 CTA（下载/GitHub）+ 真实界面大图压底 |
| 3 | 能力跑马灯 | .ticker | 一行等宽字体关键词滚动，建立「工具感」节奏 |
| 4 | 核心能力 | #features | 无缝 bento 六格：部署/市场/体检/更新/回滚/守护，真实截图嵌入 |
| 5 | 真实界面 | #ui | 截图剧场：桌面端钉住横向擦除，移动端原生横滑 + 进度点 |
| 6 | 工作方式 | #how | 01-04 步骤卡片滚动堆叠（部署→体检→计划→回滚） |
| 7 | 优势亮点 | #why | 四条横向条目（安全/计划/回滚/免安装）+ 数据计数 + 斜置截图 |
| 8 | 常见问题 | #faq | 六问手风琴 |
| 9 | 下载 CTA | #download | 大字收尾 + 下载/版本清单/GitHub 三按钮 |
| 10 | 页脚 | footer | 品牌 + 站内导航 + 资源链接 + MIT |

导航层级保持单页锚点；docs.html 使用文档入口保留在移动菜单与页脚。

## 2. 页面文案（成稿）

| 区块 | 主文案 | 辅文案 / 按钮 |
| --- | --- | --- |
| 首屏 | 让 DSH **始终好用**（橙色渐变强调） | 部署、体检、插件、更新与回滚，一个本地窗口全搞定。每一步都先摊开计划，你确认了才动手。｜ 按钮：下载 Windows 版 / GitHub 仓库 |
| 核心能力 | 装、修、管、护，四件事一个窗口 | 从零安装到日常使用，覆盖 DSH 的完整生命周期；写操作先出计划，危险动作要确认。 |
| 一键部署 | 从零把 DSH 装起来 | 环境探测、生成计划、拉源码、装依赖、全量构建、起服务、三连验证。装完直接进 DSH 界面。 |
| 插件市场 | 2000+ 插件在线目录 | 分类、Star、下载量、中文简介一目了然。一键安装、批量更新，离线 tgz 也能装。 |
| 智能体检与一键修 | 每条问题写清「为什么、影响、怎么办」 | 环境体检覆盖 Deno、Node、Git、磁盘和网络 ／ 三层诊断：进程、服务、插件树 |
| 自动更新 | 有新版本先告诉你，真要动手先出计划 | 更新前自动留回滚点 ／ 步骤链全程可看、可取消 |
| 回滚时间线 | 每次写操作自动留还原点 | 回退前先给影响预览。更新失败或任务被杀，重启后回到操作前状态。 |
| 稳定守护 | 托盘常驻、悬浮条随叫随到 | 关窗收进托盘 ／ 右下角悬浮条随时回管家 ／ 僵尸写锁一键清理 |
| 真实界面 | 长什么样，一眼看到 | 下面全是管家跑在真实机器上的样子，不是设计稿。（六图：总览/插件市场/插件/体检报告/回滚点/运行状态） |
| 工作方式 | 每一步都先摊开给你看 | 动手前看得见后果，动手后回得了头。01 部署 → 02 体检 → 03 计划 → 04 回滚 |
| 优势亮点 | 为什么放心把 DSH 交给它 | 数据不出本机 ／ 动手前先摊牌 ／ 坏了能回头 ／ 免安装零残留 |
| 数据条 | 302 项测试 · 49 个动作 · 2000+ 插件 · 21 条错误翻译 | 进入视口数字滚动 |
| 常见问题 | 常见问题 | 免费 MIT 开源 ／ 与官方桌面端共存降级 ／ 回环+脱敏 ／ Win10/11 免安装 ／ 更新可回滚 ／ 插件翻车有专修 |
| 下载 CTA | 把 DSH 交给管家 | 解压即用，双击就能跑。不写注册表、不装服务，随时能删干净。｜ 下载 v2.0.0-rc.1 · zip · 32.3 MB ／ 版本清单与 SHA256 ／ GitHub 仓库 |
| 页脚 | DSH管家 · 让 DSH 始终好用 | MIT License © 2026 Frank-NF（昊天） |

## 3. 动效与交互方案（GSAP 3.13 CDN）

| 场景 | 效果 | 实现 |
| --- | --- | --- |
| 首屏入场 | 时间轴：辉光绽放 → 标题逐字翻转进场（SplitText）→ 副标题 → 双 CTA → 界面大图从 rotateX(14°) 升起压平，约 1.4s | gsap.timeline + expo.out |
| 滚动驱动 | 首屏大图反向视差缩放、辉光淡出；跑马灯无限横移（hover 暂停）；bento 逐格上浮显现；界面剧场钉住 + 横向擦除（scrub + 进度点）；步骤卡片滚动堆叠时被盖卡片后退变暗；数字计数 | ScrollTrigger（pin/scrub/batch），无 window scroll 监听 |
| 卡片悬停 | 上浮 4px + 边框转品牌橙 + 内嵌截图 scale 1.035（700ms 弹性） | CSS transition |
| 按钮反馈 | 主按钮光泽扫过（sheen）+ 上浮 + 按下 0.97 缩放 | CSS |
| 页面转场 | 单页锚点平滑滚动（expo.inOut）；导航下滚隐藏上滚出现 + 当前区块高亮 | ScrollToPlugin + ScrollTrigger |
| 降级 | prefers-reduced-motion 全部动效关闭；GSAP 加载失败时内容默认全部可见（from 模式）；移动端/触屏关掉 pin、视差、逐字动画，剧场改原生横滑 | matchMedia 分支 + CSS 兜底 |

## 4. 视觉风格

- **配色（锁品牌 VI）**：底 #12100E（暖墨黑）→ 卡片 #1E1B17；正文 #EDEBE6 / 次要 #BDBAB2 / 弱化 #918E85（对底 ≥ 5.5:1，AA 达标）；唯一强调色 = 品牌橙 #F06A3D（渐变至 #FF8A5B），主按钮实底 #C94A20 白字 4.7:1（VI 规范值）。全页单一主题 + 单一强调色。
- **字体**：标题 Space Grotesk + Noto Sans SC 900；正文 Noto Sans SC 400/500（离线回退 Segoe UI Variable / 微软雅黑）；数字与关键词 JetBrains Mono（tabular-nums）。Google Fonts CDN + display=swap。
- **间距与布局**：区块纵向 128px（移动 88px）；容器 1160px；bento 4 列 250px 行高、14px 缝隙、dense 流；圆角体系 9 / 14 / 20px 三档。
- **响应式**：断点 1023px（bento 两列）、860px（汉堡菜单/单列/统计两列）、560px（bento 单列、CTA 通栏）。触控目标 ≥ 44px；focus-visible 品牌橙焦点环。

## 5. 真实界面素材（本机实拍，全部在 site/assets/）

headless 模式（deno task headless，127.0.0.1:8731，仅本机）+ Playwright 截取，只读浏览未触发任何写操作：

| 文件 | 页面 | 用途 |
| --- | --- | --- |
| ui-overview.png | 总览（重拍，含插件市场/统计/数据搬家新侧栏） | 首屏 + 剧场 |
| ui-market.png | 插件市场（2192 个插件、分类与安装按钮） | bento + 剧场 |
| ui-plugins.png | 插件（依赖/生效双名单对照） | 剧场 |
| ui-report.png | 体检报告（结论先行 + 四要素问题卡） | bento + 剧场 + 优势 |
| ui-backups.png | 回滚点（36 个已验证还原点时间线） | bento + 剧场 |
| ui-runtime.png | 运行状态（重拍） | 剧场 |
| ui-deploy.png | 一键部署（沿用原图） | bento |
| ui-jobs.png / ui-env.png / ui-stats.png | 任务 / 环境与配置 / 统计 | 备用素材 |

## 6. 约束核对

- ✅ **源码下载入口全部删除**：无任何指向 DSH-Butler-*-source.zip 的按钮/链接；源码获取仅保留 GitHub 仓库地址（导航、首屏、下载区、页脚四处均可直达仓库）。
- ✅ 沿用现有技术栈与目录结构：仍是 site/ 下静态 HTML + CSS + JS，无框架、无构建步骤；docs.html、robots.txt、sitemap.xml、/butler/* 下载路径全部不变。
- ✅ 未改 src/ 任何业务代码；deno check / lint / test 范围不受影响（site/ 与 docs/ 不在检查范围）。
- ⏳ 落地替换时：把 redesign.html 拆回 index.html + styles.css + app.js 三件套（或维持单文件部署也可，nginx 无感知），更新 sitemap.xml 的 lastmod。

## 7. 上线前检查清单（design-taste pre-flight 摘要）

- [x] 全页单一暗色主题、单一强调色、圆角三档体系统一
- [x] 零 em-dash；零 emoji 图标（Lucide 内联 SVG）；无「SECTION 01」式元标签（步骤 01-04 为语义序号）
- [x] 主标题 ≤ 2 行、副文案 ≤ 2 行、CTA 不换行、首屏不塞数据条
- [x] eyebrow ≤ 3 处；跑马灯仅一处；无滚动提示箭头
- [x] bento 六格无缝无空格（grid-flow-dense，跨度精确咬合）
- [x] 真实截图 6 张入页，无假截图 div；所有 img 带 alt + width/height（CLS 达标）
- [x] 按钮对比度 AA（主按钮 4.7:1）；焦点环可见；跳转链接 #main
- [x] reduced-motion 降级 + GSAP 加载失败兜底 + 移动端关 pin
- [x] 375 / 768 / 1024 / 1440 四档宽度可用，无横向滚动（Playwright 1440 + 390 实测截图通过）


## 8. 增补（2026-09-26 第二轮反馈 · 已实装并实测）

原型更新为 v2（56.8KB），四项增补全部完成，Playwright 双主题实测通过、零 JS 报错：

### 8.1 浅色主题
- 全量颜色令牌化：所有写死的 rgba 全部收编为 CSS 变量（导航底、遮罩、网格线、跑马灯底、阴影、辉光、渐隐遮罩等），新增 `[data-theme="light"]` 整套覆写。
- 浅色盘与产品 VI 浅色令牌同源：底 #FAF8F5（米白）/ 卡片 #FFFFFF / 文字 #232220 / 品牌文字 #C24A1E（浅底 4.6:1）/ 主按钮仍 #C94A20 白字。
- 导航栏新增太阳/月亮切换按钮（移动端也可见）；首屏内联脚本防闪烁；偏好存 localStorage（键 site-theme）；theme-color meta 同步更新；color-scheme 跟随。
- 实测：dark→light→dark 切换、刷新后保持、两主题下截屏均正常。

### 8.2 友情链接
- 页脚新增「友情链接」列：DSH 官网（https://www.deepseek.com/harness，取自 docs/research-official-desktop.md 的官方地址）+ DeepSeek 官网；附「想交换友链？GitHub Issue 找我」入口。

### 8.3 自媒体占位
- 页脚新增「自媒体」列：B站 / 抖音 / 小红书 / 公众号 四个占位条目，通用图标 + 「即将上线」徽标。上线时把 span 换成真实链接、删掉徽标即可。

### 8.4 打赏占位
- 页脚品牌列新增「请作者喝杯咖啡」按钮 → 弹窗（遮罩/Esc/右上角关闭，焦点管理）内放微信赞赏码 + 支付宝收款码两个虚线占位框（标注「占位 · 待替换，建议 300×300」）。
- 替换方式：把 .tip-qr 占位 div 换成 <img src="assets/tip-wechat.png"> 即可。

## 9. 落地记录（同日）

- 已按现有目录结构拆分为三件套：site/index.html（28.9KB）+ site/styles.css（20.5KB）+ site/app.js（7.4KB），GSAP 走 CDN 四件套保留在页面底部。
- 旧版 styles.css 另存为 site/docs.css 供 docs.html 专用（文档页样式隔离）；顺手修复 docs.html 里 PowerShell 转义残留（28 处反引号 n 变成真实换行）。
- **修复一处真 bug**：首屏渐变标题与 SplitText 逐字拆分冲突（拆分后渐变失效、文字不可见），改为整行揭示动画，并移除 SplitText 依赖。
- 原型 redesign.html 完成使命后删除；上线前本地 HTTP 服务 + Playwright 全量回归通过（主题切换/弹窗/剧场/文档页/零 JS 报错）。

## 10. 线上缺陷修复（同日第三轮）

- **截图变形修复**：全局图片规则缺 height:auto，而 HTML 带 height="1350" 属性，宽度被压到 100% 时高度仍按属性钉死，导致所有真实界面截图纵向拉伸（首屏 2 倍、Bento 卡片 4 倍以上）。修复为 img{display:block;max-width:100%;height:auto}，本地与线上各实测 11 张图，渲染高宽比全部与原图一致（9 张逐像素匹配 + 2 张为懒加载/旋转测量假象）。
- 线上 version.json 清除 sourceUrl / sourceSha256 / sourceSizeBytes 三个字段，源码包文件与引用全部下线。
