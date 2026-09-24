<img src="icons/128x128.png" width="88" alt="DSH管家">

# DSH管家

> 项目中文名：**DSH管家**　｜　软件产品名：**DSH Butler**　｜　**让 DSH 始终好用**

DSH Desktop（DeepSeek 桌面 AI 助手）的增强外壳。用一个本地桌面程序，把「装 DSH、修 DSH、管 DSH 插件、查 DSH 环境」这些事一次性做掉。

技术栈：**Deno 2 + `deno desktop`**（WebView2 后端）。界面是内嵌 HTML/CSS/JS，逻辑全在 Deno 侧。

---

## ⚠️ 命名铁律

**软件产品名必须是纯 ASCII，不许出现中文。**

这条不是审美偏好，是踩过坑的。旧项目用「DSH插件管家」做产品名时，WiX 因 en-US codepage 1252 写不进中文，直接报 `LGHT0311`，而 tauri 表层只显示 `failed to run light.exe`，查了很久才定位。

产品名会流进：打包元数据、安装包文件名、窗口标题、进程名、将来的自更新链路。中文在这些环节会安静地炸。

因此：

| 用途 | 取值 | 约束 |
|---|---|---|
| 软件产品名（`APP_NAME` / `desktop.app.name`） | `DSH Butler` | **纯 ASCII** |
| 项目中文名（沟通、文档） | `DSH管家` | 不进产物 |
| 应用标识（`APP_ID`） | `com.dsh.plugin-updater` | **绝不能改** —— 改了挪数据目录、丢用户配置、断自更新链 |
| 界面文案 | 中文 | 走 UTF-8 HTML，安全 |

守卫测试：`src/version_test.ts` 会在产品名含非 ASCII 字符时失败。

---

## 品牌资产

| 东西 | 位置 |
|---|---|
| 品牌源文件（VI 板） | `docs/DSH管家_品牌VI_assets/` |
| 抠好的透明标志 | `icons/build/mark-raw.png` |
| 应用 / 托盘图标 | `icons/icon.ico`、`icon.icns`、`tray.ico`、`tray.png` |
| 界面内用的标志 | `icons/mark-chip.png`（base64 内嵌进 `src/web/`） |
| 官网与静态资源 | `site/` |

调色：主橙红 `#F06A3D`、深橙红 `#E55A2E`、浅橙 `#F0894E`、墨黑 `#222122`、米白 `#FAF8F5`。
界面里的语义令牌与可访问性取舍见 `docs/UI-DESIGN-SYSTEM.md` §5.5。

**生产线**：`python tmp/extract-mark.py`（从 VI 板抠图）→ `python icons/build-icons.py`（出全部尺寸
+ 官网资产 + 内嵌 base64）。**换标志就换源文件重跑这两步，不要手改 PNG。**

---

## 常用命令

```bash
deno task dev          # 带热重载跑桌面窗口
deno task headless     # 只起本地服务（固定端口 8731），不开窗口
deno task check        # 类型检查
deno test -A src/      # 单元测试
deno task build        # 出压缩安装包
deno task build:plain  # 出普通产物（更快）
```

命令行方式（不起窗口）：

```bash
deno run -A src/main.ts core status
deno run -A src/main.ts env probe --json
```

## 产物

`deno task build:plain` 产出到 `dist/dsh-butler/`：

- `dsh-butler.exe` —— 启动器（约 300 KB）
- `dsh-butler.dll` —— 运行时 + 我们的全部代码（约 80 MB）

两个文件必须放在一起。界面 HTML/CSS/JS 是**内嵌进 dll 的字符串**，没有散落的 web 资源文件。

## 权限说明

构建命令带 `-A`。这**不是偷懒**：Deno 的权限在编译期烘焙进二进制，而这个工具的本质就是
读用户的 DSH 目录、起本地 HTTP 服务、跑 `git`/`node`/`pnpm`/PowerShell/tasklist。

因此 Deno 的权限模型对它不构成边界。安全性靠工具**自己**的措施保障：

- 路径围栏（只在自己该管的目录里动手）
- 危险命令不白名单化
- 改用户文件前先建备份/隔离区

详见 `src/jobs/` 与各领域模块的守卫逻辑。
