# 官方有没有出桌面端？——调研报告

> 调研范围：官方仓库 github.com/deepseek-ai/deepseek-harness（线上）＋本机检出
> G:\DeepSeek_Harness（dsh-v0.1.7-rc.1，2026-09-23）。
> 每条结论都给出来源；查不到的地方明确写「没找到」，不做推测。

## 0. 一句话结论

**有。** DeepSeek 官方已经在官方仓库里做了桌面端（Electron 桌面应用），而且**已经公开分发可下载的
Windows 安装包**； 但它目前处在 **nightly（每夜构建）／开发者预览**
状态：**官网和官方文档都还没有正式的下载入口和安装说明**。

## 1. 官方到底有没有桌面端？——有，四条证据

| 证据                               | 说明                                                                                 | 出处                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 官方仓库有桌面端目录               | `apps/` 下有 `cli`、`web`、`desktop`、`desktop-host` 四个应用                        | https://github.com/deepseek-ai/deepseek-harness/tree/master/apps                      |
| 官方仓库有桌面端说明文档           | `apps/desktop/README.zh.md`，标题就是「DeepSeek Harness 桌面端」                     | https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md |
| 官方发版说明大量提到桌面端         | v0.1.7-rc.2 更新日志含「桌面端新增首次使用引导」「修复部分桌面安装包启动失败的问题」 | https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2          |
| 官方下载域上真有安装包（本次实测） | 见下                                                                                 | 见下                                                                                  |

实测（本次调研真实请求过，非引用）：

- 更新清单 https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml → **HTTP 200**，内容为
  `version: 0.1.7-rc.2`、`releaseDate: 2026-09-24`。
- 安装包 https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.2-win-x64.exe
  → **HTTP 200**，大小 288,245,480 字节（约 275 MB），类型
  `application/vnd.microsoft.portable-executable`。

### 必须区分的三样东西

1. **官方 CLI / Web**：`dsh` 命令行工具 + Web UI（浏览器里用）。
2. **官方桌面端**：`apps/desktop`，一层 Electron 壳，把 Web 应用装进窗口，自带运行时和自动更新。
3. **第三方外壳**：社区做了很多，例如
   `agent-earth/deepseek-harness-desktop`、`dataelement/dsh-desktop`、`RZX00/deepseek-harness-desktop`、`ChisaAlter/Deepseek-Harness-Desktop`、`Links2008/DeepSeek-Harness-Desktop`。**本机这个「DSH管家
   / DSH Butler」属于这一类。**

顺带提醒：`download.deepseek.com` 这个域名本身是 **DeepSeek App（聊天助手）** 的下载站（页面自述支持
iOS / Android）， 和 Harness 桌面端不是同一个产品，只是共用域名。

## 2. 如果有：叫什么、什么时候、怎么装、支持什么平台

| 项目               | 结论                                                                                                                                                                                                               | 出处                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 叫什么             | 文档名「DeepSeek Harness 桌面端」；安装包名 `deepseek-harness-<版本>-win-x64.exe`                                                                                                                                  | 上述 README / nightly.yml                                                                                    |
| 什么时候           | 代码 **2026-08-31** 首次进仓库（提交信息 `feat: electron 打包`）；当前公开安装包是 **2026-09-24** 的 0.1.7-rc.2                                                                                                    | 本机 `git log --diff-filter=A -- apps/desktop/package.json`；nightly.yml 的 releaseDate                      |
| 支持平台           | `win-x64`、`mac-arm64`、`mac-x64`；**不支持 Linux**                                                                                                                                                                | `apps/desktop/scripts/desktop-auto-update-environment.mjs` 的 `UPDATE_TARGETS`                               |
| macOS 是否已公开   | **没找到** macOS 的公开清单（`/feeds/mac-arm64/nightly.yml`、`/feeds/mac-x64/nightly.yml` 实测均 404）                                                                                                             | 本次实测                                                                                                     |
| 怎么装             | **没找到**官方下载页面（`https://www.deepseek.com/harness/download` 实测 404）；目前只能用上面的直链                                                                                                               | 本次实测                                                                                                     |
| 和 CLI 是什么关系  | 桌面端 = Electron 壳 + 打包好的完整 dsh Web 应用；默认端口 **19387**（Web/CLI 是 3080）；Electron 与 `@deepseek-ai/dsh` **始终同一版本**（壳不变、dsh 升级也要发新桌面版）；CLI 被禁止启动或修改 `desktop` profile | `apps/desktop/README.zh.md`；`apps/cli/README.zh.md` 第 20 行                                                |
| 有无自己的更新机制 | **有**。用 `electron-updater`（generic provider，渠道名 `nightly`），更新源 `https://download.deepseek.com`；发版时会同时上传 `nightly.yml` 和 `latest.yml`（`latest.yml` 实测 404 → 稳定通道尚未开启）            | `apps/desktop/package.json` 依赖 `electron-updater`；`apps/desktop/scripts/desktop-upload-plan.ts` 第 272 行 |

## 3. 官方推荐用户怎么用？有没有说「桌面端在路上」

- 官网 https://www.deepseek.com/harness 上「一键使用 /
  源码安装」只有两条：`npx @deepseek-ai/dsh web`， 以及 `git clone` + `pnpm install` +
  `pnpm run build`。页面上**没有**桌面端下载入口。
- 官方 README 同样只写 `npx @deepseek-ai/dsh web` 和源码运行：
  https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md
- 官方文档站**没有**桌面端页面：https://deepseek-harness.github.io/deepseek-harness/en/guide/desktop
  实测 404。
- 官方 README 自称处于「**开发者预览**」阶段，「未来将出现破坏兼容性的变更」。
- 「桌面端在路上」的说法来自**媒体报道，不是官方公告**。例如
  http://www.c114.net.cn/ainews/123421.html 称：官方主分支已新增桌面端目录、将支持 macOS（Apple
  Silicon 与 Intel）及 Windows x64、暂不支持 Linux、正式上线后可在 download.deepseek.com
  下载。**该描述与本次实测一致，但它不是官方声明。**

## 4. 顺带查：DSH 本体怎么发版、怎么检查更新

| 问题                         | 结论                                                                                                                                               | 出处                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| npm 包名                     | `@deepseek-ai/dsh`                                                                                                                                 | https://www.npmjs.com/package/@deepseek-ai/dsh                  |
| 怎么运行                     | `npx @deepseek-ai/dsh web`（默认 http://127.0.0.1:3080）                                                                                           | 官方 README                                                     |
| 版本号从哪来                 | `dsh -V` 或 `dsh --version`                                                                                                                        | `apps/cli/src/args.ts`                                          |
| 有没有 update / upgrade 命令 | **没有**。入口模式只有 profile 启动（`dsh <name>`、`dsh web`、`dsh --profile headless/sdk/acp ...`）和 `dsh plugin --profile <name> <pnpm args>`   | `apps/cli/README.zh.md`「入口模式」表                           |
| 怎么知道有新版               | 看 npm dist-tags。**实测**：`latest=0.1.5-rc.3`、`next=0.1.7-rc.2`、`alpha=0.1.7-alpha.2`                                                          | https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags |
| GitHub Release               | tag 形如 `dsh-v0.1.7-rc.2`                                                                                                                         | https://github.com/deepseek-ai/deepseek-harness/releases        |
| 发版节奏                     | 极快。本机 git tag 记录：2026-08-17 首个 `dsh-v0.1.0-rc.7` → 2026-09-23 `dsh-v0.1.7-rc.1`，共 23 个 tag，约每 1–2 天一个，且全部是 alpha/rc 预发布 | 本机 `git tag --sort=creatordate`                               |

> 给自研外壳的提醒：npm 上 `latest` 这个 tag **落后于** `next`（latest=0.1.5-rc.3 比 next=0.1.7-rc.2
> 旧）。 如果只读 `latest` 来判断「本体有没有更新」，会误判——本机现在就是 0.1.7-rc.1，而 npm 的
> `latest` 反而是 0.1.5-rc.3。

## 5. 结论：对本项目意味着什么

1. **不是纯粹的重复造轮子，但重叠区已经出现。** 官方桌面端（Electron 壳 + Web 应用 + 内置运行时 +
   自动更新） 与本项目「把 DSH 装进一个窗口」这个核心卖点**功能重叠**。
2. **不过官方现在还没到「完成度压制」的程度。** 只有 nightly 通道、只有 Windows
   的公开安装包、官网与文档都没有下载入口、 macOS 清单实测
   404、官方自称仍是「开发者预览」。也就是说：**尚未正式上线**。
3. **本项目仍然有价值，差异化在这些地方：**
   - **「管家」定位**：官方桌面端是「一个壳」；本项目是安装/管理 DSH
     本体、管插件、托盘常驻、检测本体更新。 官方 CLI 甚至连 `update`
     命令都没有，这正好是外壳可以补的位置。
   - **本体版本管理与更新提示**：官方桌面端把壳和 dsh **锁死为同一版本、必须整体更新**；用户若想用
     `npx`/CLI 的滚动版本，外壳仍有空间。
   - **平台空白**：官方公开包无 Linux，macOS 尚未公开。
   - **面向非技术用户**：官方目前只给开发者路径（`npx`、`pnpm build`），且官网没有桌面下载入口。
4. **风险提示**：官方桌面端一旦正式上线（媒体与实测都指向 `download.deepseek.com` 会成为入口），
   本项目「装进窗口」那一部分会被官方直接覆盖。建议把重心放在**官方不做的部分**——本体版本管理、插件/技能管理、
   更新检查、托盘与多实例管理——并让外壳能**同时驱动官方 CLI/Web
   和官方桌面端**，而不是去和官方桌面端抢「窗口」这件事。
5. **顺手要修的**：更新检查逻辑应看 `next`/`alpha` 或 GitHub Releases，而不是 `latest`。

## 附：查不到 / 未确认的项

- 官方桌面端的**正式发布时间、正式下载页面、安装文档**：没找到（调研时官网与文档站均无）。
- macOS 公开安装包：没找到（feed 实测 404，但打包目标确实包含 mac-arm64 / mac-x64）。
- Linux 桌面端：官方打包目标里不存在，**明确不支持**。
- 官方是否公告过「桌面端即将推出」：**没找到官方原文**，只有媒体报道。

---

### 主要来源汇总

- https://github.com/deepseek-ai/deepseek-harness
- https://github.com/deepseek-ai/deepseek-harness/tree/master/apps
- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.zh.md
- https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2
- https://www.deepseek.com/harness
- https://deepseek-harness.github.io/deepseek-harness/
- https://www.npmjs.com/package/@deepseek-ai/dsh
- https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags
- https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml
- http://www.c114.net.cn/ainews/123421.html（媒体，非官方）
