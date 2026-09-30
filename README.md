<img src="icons/128x128.png" width="96" alt="DSH Butler">

# DSH 管家 · DSH Butler

[简体中文](README.md) ｜ [English](README.en.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-302%20passed-brightgreen.svg)](src)
[![Deno](https://img.shields.io/badge/Deno-2.x-black.svg)](https://deno.com)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey.svg)](https://dsh.huilinsh.cn)
[![Release](https://img.shields.io/badge/release-v2.0.0--rc.2-orange.svg)](https://dsh.huilinsh.cn)

> **让 DSH 始终好用。** 一个本地桌面运维台，把「装 DSH、修 DSH、管插件、护数据」收进一个窗口。

单文件可执行程序，**只监听本机回环地址**，不写注册表、不装系统服务；所有写操作**先出计划、确认后才动手**，并且大多会留回滚点。

## 特性

| 能力 | 说明 |
| --- | --- |
| 一键部署 DSH | 环境探测 → 计划 → 安装/修复，失败可回滚；只读诊断支持 `--json` |
| 插件市场 | 线上目录 2000+ 插件（分类 / Star / 下载量 / 中文简介），一键装、批量更新、离线 tgz 安装、依赖与锁文件修复 |
| 体检与一键修 | 每条问题给出「为什么 / 影响 / 怎么办」，多数带一键修 |
| 回滚时间线 | 每次写操作留还原点，回退前先出「影响预览」 |
| 数据搬家 | 导出 / 校验 / 还原搬移包（配置 / 含技能 / 全量） |
| 定时守护 | 定时体检、备份、查更新；问题进「管家提醒」卡片与托盘提示 |
| 诊断包 | 体检 / 环境 / 依赖 / 日志错误行脱敏打成一包，落盘后**回读自检**，有残留即拒绝导出 |
| 写操作审计 | 按时间倒序列出每次写操作（谁触发 / 改了什么 / 结果 / 回滚点），可导出 Markdown + CSV |
| 技能与配置 Git 化 | 技能目录本地 Git 快照，可看差异、可回退（回退前自动 stash） |
| 多 profile 与镜像源 | 多 profile 管理台、npm 源下拉 + 并发测速、离线与内网场景 |
| 与官方桌面端共存 | 检测到官方桌面端在跑时自动退成运维模式，不抢窗口与托盘（可强制完整模式） |

## 快速开始

**下载即用（推荐）**：到 <https://dsh.huilinsh.cn> 下载 `DSH-Butler-v2.0.0-rc.4-win-x64.zip`（约 32 MB）→ 解压 → 双击 `dsh-butler.exe`。

校验完整性（SHA256 公布在 <https://dsh.huilinsh.cn/butler/version.json>）：

```powershell
Get-FileHash .\DSH-Butler-v2.0.0-rc.4-win-x64.zip -Algorithm SHA256
```

**从源码构建**（需要 Deno 2.x，Windows 10/11 + WebView2 运行时）：

```bash
deno task dev       # 开发模式（HMR）
deno task headless  # 无界面模式（只跑服务，便于脚本与诊断）
deno task test      # 全量测试
deno task lint      # 静态检查
deno task build     # 产出 dist/dsh-butler/dsh-butler.exe
```

## 架构

```
src/
├─ main.ts        入口：窗口、托盘、悬浮条、故障恢复、定时调度
├─ jobs/          任务引擎：动作注册表、步骤流水、进度、历史落盘
├─ api/           本地 HTTP 接口（设置、任务、市场、提醒、帮助）
├─ web/           内嵌界面（单模板注入）与页面守卫测试
├─ host/          平台层：进程、端口、窗口、托盘、文件系统
├─ util/          路径、结果模型、错误翻译（21 条规则，含修复建议）
└─ domains/       11 个领域、49 个动作：bootstrap / core / plugin / runtime /
                  backup / data / net / diag / env / profile / state
```

## 动作清单（49）

| 领域 | 动作 |
| --- | --- |
| 部署引导 | `bootstrap.plan` `bootstrap.apply` `bootstrap.verify` `bootstrap.discard` |
| DSH 本体 | `core.status` `core.update` `core.finishUpdate` `core.verify` `core.rollback` |
| 插件 | `plugin.scan` `plugin.install` `plugin.uninstall` `plugin.repair` `plugin.diagnose` `plugin.batchUpdate` `plugin.installOffline` `plugin.deps` `plugin.syncLock` `plugin.cleanResidue` `plugin.cleanBackups` |
| 运行 | `runtime.status` `runtime.logs` `runtime.diagnose` `runtime.start` `runtime.stop` `runtime.restart` `runtime.repair` |
| 回滚点 | `backup.create` `backup.list` `backup.verify` `backup.preview` `backup.apply` `backup.delete` |
| 数据 | `data.export` `data.inspect` `data.restore` `data.backup` `data.backups` `data.diagnose` `data.audit` `data.auditExport` `data.snapshot` `data.snapshots` `data.snapshotRestore` |
| 网络 | `network.testSources` `network.setRegistry` |
| 环境 | `env.probe` |
| 多 profile | `profile.list` `profile.switch` |

## 设计原则

1. **写前必有计划**：写操作实现 `preflight()`，摊开「为什么 / 影响 / 怎么办」等用户确认。
2. **回滚优先**：写操作尽量先建还原点，回退前给影响预览；跨进程用 `~/.dsh/write.lock` 防并发。
3. **脱敏与自检**：对外文件统一深度脱敏，落盘后回读复扫，发现残留即判失败。

## 安全与隐私

- **只监听回环**：服务绑定 `127.0.0.1`，接口带一次性令牌，不对外开放端口。
- **可回退**：写操作留还原点并提供影响预览，跨进程写锁防并发损坏。
- **不外传**：不采集、不上报任何使用数据；诊断包等对外内容全部深度脱敏（家目录 / 用户名 / 令牌 / 邮箱）并回读复扫。

## 质量

- **302 个测试全通过**（66 个测试文件），含注入脚本语法守卫、界面不可达路径守卫、历史缺陷复现测试。
- 每个功能都在真实 Windows 环境跑通（批量更新后重启体检、离线包安装、镜像源实测延时对比等）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用帮助](docs/使用帮助.md) | 上手与日常维护（软件内「帮助」页同源） |
| [更新策略](docs/UPDATE-STRATEGY.md) | 版本清单、校验、自更新流程 |
| [UI 设计系统](docs/UI-DESIGN-SYSTEM.md) | 色彩、字体、间距、组件规范 |
| [功能路线图](docs/FEATURE-ROADMAP-2026-09-25.md) | 已完成与规划中的能力 |

## 发布

- 发布物是**免安装 zip**（不是安装包），解压即用，数据都在用户目录。
- 版本清单：<https://dsh.huilinsh.cn/butler/version.json>（含 `version` / `url` / `sha256` / `sizeBytes` / `changelog`，管家据此检查更新并校验下载）。
- 市场目录数据源：<https://dsh.huilinsh.cn/plugins.json>。

## 许可

[MIT](LICENSE) © 2026 Frank-NF（昊天）。
