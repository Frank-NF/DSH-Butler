# DSH 插件管家 — 全量功能文档

> 对应版本：v1.18.2 | 最后更新：2026-09-11

---

## 目录

1. [产品概述](#1-产品概述)
2. [技术架构](#2-技术架构)
3. [核心功能](#3-核心功能)
   - 3.1 [插件扫描与管理](#31-插件扫描与管理)
   - 3.2 [插件市场](#32-插件市场)
   - 3.3 [行业组合包](#33-行业组合包)
   - 3.4 [MCP 服务管理](#34-mcp-服务管理)
   - 3.5 [快照与离线打包](#35-快照与离线打包)
   - 3.6 [DSH 服务器管理](#36-dsh-服务器管理)
   - 3.7 [DSH 本体版本管理](#37-dsh-本体版本管理)
   - 3.8 [自更新系统](#38-自更新系统)
4. [安全体系](#4-安全体系)
5. [官网功能](#5-官网功能)
6. [设置与配置](#6-设置与配置)
7. [Tauri 命令一览](#7-tauri-命令一览)
8. [API 接口一览](#8-api-接口一览)

---

## 1. 产品概述

**DSH 插件管家**（原名 DSH 插件升级管理工具）是一款独立运行的桌面应用，用于管理 DeepSeek Harness（DSH）生态下的插件、组合包、MCP 服务和本体版本。不依赖 DSH Agent 本体进程，可单独安装使用。

### 核心价值

| 价值点 | 说明 |
|--------|------|
| 独立运行 | 纯桌面工具，无需启动 DSH Agent |
| 一键管理 | 扫描/更新/启停/卸载/安装全流程 GUI |
| 行业方案 | 94 个预制组合包覆盖 13+ 行业 |
| 安全验签 | Ed25519 签名链，签名失败拒绝消费 |
| 离线可用 | 快照导出/离线包导入，支持无网环境部署 |
| 双语界面 | 中文/英文一键切换 |

---

## 2. 技术架构

```
DSH-PluginUpdater/
├── src-tauri/          # Rust 后端（Tauri 2.0）
│   ├── src/
│   │   ├── main.rs            # 入口 + 命令注册（39 个 Tauri command）
│   │   ├── plugin_scan.rs     # 插件目录扫描引擎
│   │   ├── catalog.rs         # 官方目录拉取 + Ed25519 验签
│   │   ├── bundle.rs          # 组合包协议（冲突预检/事务撤销）
│   │   ├── mcp.rs             # MCP Server 配置管理
│   │   ├── snapshot.rs        # 快照导出/导入/比对
│   │   ├── dsh_server.rs      # DSH Web 服务器启停
│   │   ├── dsh_core.rs        # DSH 本体版本管理
│   │   ├── file_ops.rs        # 文件操作（更新/卸载/备份）
│   │   ├── github_proxy.rs    # GitHub 代理客户端
│   │   ├── manifest.rs        # 插件清单读写
│   │   ├── version_probe.rs   # 版本探测
│   │   └── error.rs           # 错误类型定义
│   ├── keys/                # Ed25519 公钥（编译时嵌入）
│   ├── capabilities/        # Tauri 权限声明
│   └── tauri.conf.json      # 应用配置
├── src-vue/              # Vue 3 前端
│   └── src/
│       ├── components/          # UI 组件（22 个）
│       ├── stores/pluginStore.ts # Pinia 状态管理
│       ├── api/                 # Tauri invoke 封装（4 个模块）
│       ├── composables/         # 组合式函数（5 个）
│       ├── i18n/                # 双语（zh/en）
│       └── App.vue
├── website/              # 官网（Nuxt 3）
│   ├── pages/              # 8 个页面
│   ├── components/         # 站点组件
│   ├── server/api/         # 服务端 API（34 个端点）
│   └── composables/        # SEO/数据组合函数
└── docs/                 # 项目文档
```

**技术栈：** Vue 3 + TypeScript + Element Plus（WeUI 封装层）| Rust（Tauri 2.0）| Nuxt 3 + Nitro | SQLite（better-sqlite3）| JWT 鉴权

---

## 3. 核心功能

### 3.1 插件扫描与管理

**功能描述：** 自动识别指定目录下的所有已安装 DSH 插件，展示状态并支持管理操作。

**扫描逻辑：**
- 启动时自动扫描配置的插件目录
- 支持多 profile 候选目录（`profiles/*/node_modules`）
- 跳过 `@deepseek-ai/*` scope（本体组件非插件）
- 跳过 `dsh-profile-*` 根目录
- 支持 pnpm workspace 根 node_modules 下钻

**插件信息：** 名称、版本、描述、是否启用、是否有可用更新、来源类型（用户/内置/系统）

**管理操作：**
- 启用/禁用（不删除文件，仅切换状态）
- 更新到最新版本
- 卸载（自动备份，支持回滚）
- 打开所在文件夹

### 3.2 插件市场

**功能描述：** 内置官方插件目录，实时同步自官网 API，支持浏览、搜索、安装。

**数据规模：** 2189+ 款插件

**筛选与排序：**
- 分类筛选：通用/医疗/法律/金融/教育/电商/制造/房地产/媒体/政务/IT/农业/物流/旅游/殡葬等
- 关键词搜索：插件名、描述、分类关键词
- 排序：默认排序 / Star 数 / 下载量 / 最新

**视图：** 网格视图 / 列表视图（记忆用户偏好）

**卡片信息：** 名称、描述（最多两行）、分类标签、Star 数、下载量、状态标签（已安装/可更新/内置）

**安装方式：** 一键安装到指定 profile 目录

### 3.3 行业组合包

**功能描述：** 94 个行业预制组合包，一键部署整套解决方案（插件 + MCP 服务模板 + Skill）。

**组合包结构：**
- 一组相关插件（含版本约束）
- MCP 服务模板（含环境变量键名说明）
- 技能（Skill）定义

**类型：**
| 类型 | 说明 |
|------|------|
| 通用基础 | 基础能力组合，适合所有用户 |
| 行业预制 | 针对特定行业的完整解决方案 |
| 预设模式 | 不写入全局配置，生成会话预设建议文件 |

**安装流程：**
1. 浏览组合包详情
2. 自动预检：比对当前已安装插件，标注冲突项
3. 确认清单：查看即将安装/覆盖/跳过的插件
4. 一键安装：事务保障（失败自动回滚）
5. 完成：自动合并 MCP 服务模板到本地配置

**事务保障：**
- 自动备份将被覆盖的插件
- 任一步骤失败自动恢复到安装前状态
- 中断后重启自动检测并恢复半装状态
- 安装前标注已知冲突插件

### 3.4 MCP 服务管理

**功能描述：** 集中查看与管控本地 MCP（Model Context Protocol）服务配置。

**管理功能：**
- 服务列表：查看所有已配置和已禁用的 MCP 服务
- 连通性预检：一键测试服务可达性
  - stdio 模式：启动探活
  - streamable-http 模式：发送探测请求
- 环境变量配置：填写 Token/密钥等敏感信息
  - 加密存储于系统凭据库（Windows 凭据管理器）
  - 面板中掩码显示
- 启用/禁用：安全移除或恢复服务配置
- 写入配置：将修改应用到运行配置

### 3.5 快照与离线打包

**快照（Snapshot）：**
- **导出：** 生成 JSON 文件，包含所有插件名称、版本、npm 包名
- **导入：** 预览与当前目录差异，标注缺失插件和版本不一致项，一键在线安装缺失插件
- **用途：** 备份、迁移、版本回退

**离线打包（Offline Pack）：**
- **导出：** 将全部插件目录打包为 ZIP 文件（含所有依赖）
- **导入：** 导入 ZIP 文件，按快照记录版本精确还原，同名文件覆盖
- **用途：** 无网络环境部署、跨机器迁移、系统重装后快速恢复

### 3.6 DSH 服务器管理

**功能描述：** 管理本地 DSH Web 服务（`lib/bin.js --profile web`）的启停。

**操作：**
- 查看服务状态（运行中/已停止）
- 启动服务（自动探测 DSH 安装路径）
- 停止服务
- 重启服务
- 路径自动探测：环境变量 `DSH_WEB_DIR` > `~/.dsh/web-dir` 缓存 > 候选路径

### 3.7 DSH 本体版本管理

**功能描述：** 查看和管理 DeepSeek Harness 本体的版本状态。

**功能：**
- 查看当前安装的 DSH 本体版本
- 检查是否有新版本可用
- 查看版本历史（含预发布版标注）
- 执行本体更新

**安全提示：** 预发布版（alpha/rc）明确不建议升级

### 3.8 自更新系统

**功能描述：** 应用启动时自动检测新版本，支持一键升级。

**流程：**
1. 启动时后台检查更新（可配置关闭）
2. 发现新版本后弹窗提示
3. 下载增量包或完整安装包
4. 下载完成后自动安装并重启

**状态展示：** 检查中 / 下载中（进度条）/ 已完成 / 错误

---

## 4. 安全体系

### V3 签名验证（Ed25519）

| 环节 | 机制 |
|------|------|
| 目录拉取 | 官网对原始 body 字节签名，桌面端编译时嵌入公钥验证 |
| 签名缺失 | fail-open（允许继续，仅告警） |
| 签名失败 | fail-closed（拒绝消费数据） |
| 密钥轮换 | 第三次轮换，旧密钥已从仓库清除 |

### 其他安全措施

- **SHA256 校验：** 安装包下载后校验哈希值
- **JWT fail-fast：** 生产环境缺失 `DSH_JWT_SECRET` 时服务启动即抛出异常
- **Cookie Secure：** 登录/注册/GitHub 回调/登出全部 cookie 启用 Secure flag
- **IP 优先级：** 优先读 Nginx `X-Real-IP`（不可伪造），fallback `X-Forwarded-For`
- **预提交钩子：** 阻止私钥文件被意外提交或推送
- **插件名校验：** 拒绝含 `#`、斜杠、空格、反斜杠的伪 npm 包名（防 git 依赖注入）

---

## 5. 官网功能

官网地址：https://dsh.huilinsh.cn

### 页面

| 页面 | 路由 | 功能 |
|------|------|------|
| 首页 | `/` | Hero 区、统计数字、核心能力 8 项、双端形态卡片 |
| 插件市场 | `/plugins` | 全量插件浏览、搜索、分类筛选、排序 |
| 行业组合包 | `/bundles` | 94 个组合包浏览、标签筛选、详情查看 |
| 文档中心 | `/docs` | 产品简介、快速开始、组合包说明、快照与离线、安全设计、FAQ |
| 下载中心 | `/download` | Windows 客户端下载、SHA256 校验值、系统要求 |
| 离线部署 | `/offline` | 离线包导出/导入操作指引 |
| 反馈 | `/feedback` | 用户反馈提交 |
| 统计 | `/stats` | 公开统计数据（匿名聚合） |
| 管理后台 | `/admin/*` | Admin JWT 鉴权，插件/组合包/评论/分享管理 |

### 服务端 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/stats` | GET | 站点统计 |
| `/api/track` | POST | 匿名使用追踪 |
| `/api/auth/login` | POST | 管理员登录 |
| `/api/auth/logout` | POST | 登出 |
| `/api/auth/me` | GET | 当前用户信息 |
| `/api/auth/register` | POST | 注册（白名单制） |
| `/api/plugins` | GET | 插件目录（分页，Ed25519 签名） |
| `/api/plugins/[id]` | GET | 单个插件详情 |
| `/api/plugins/stats` | GET | 插件统计 |
| `/api/bundles` | GET | 组合包列表（ETag/304 支持） |
| `/api/bundle.get` | GET | 单组合包详情 |
| `/api/updater/latest` | GET | 最新版本信息（签名） |
| `/api/updater/batch-check` | POST | 批量检查更新 |
| `/api/plugin/download` | GET | 插件下载代理 |
| `/api/dl/[file]` | GET | 安装包下载（计数+302） |
| `/api/manifest/sign` | POST | 生成 Ed25519 签名 |
| `/api/manifest/verify` | GET | 验证签名 |
| `/api/compat/check` | GET/POST | 客户端兼容性检测 |
| `/api/compat/rules` | GET | 兼容性规则 |
| `/api/feedback` | POST | 提交反馈 |
| `/api/comments` | POST | 提交评论 |
| `/api/favorites` | POST | 收藏插件 |
| `/api/shares` | POST | 分享组合包 |
| `/api/skills` | GET | Skill 列表 |
| `/api/mcp` | GET | MCP 服务列表 |
| `/api/dsh/releases` | GET | DSH 本体版本历史 |
| `/api/stats/overview` | GET | 统计概览（admin） |

### 官网功能特性

- **全域 SEO：** 7 个页面统一 `useSiteSeo`（description/OG/Twitter Card/canonical）
- **动态 sitemap.xml：** 自动生成
- **OG 分享图：** 1200×630
- **结构化数据：** 下载页 `SoftwareApplication` schema
- **零第三方统计：** 页面浏览/安装包下载/匿名活跃安装三类日聚合
- **App 启动 ping：** 仅上报随机安装 id + 版本号（无任何个人数据，设置页可关）
- **管理端看板：** `/admin/stats`（admin JWT 鉴权）

---

## 6. 设置与配置

### 6.1 网络设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| GitHub 代理地址 | 请求 GitHub 时使用的代理 | 空（直连） |
| npm 安装源 | 插件安装时的 registry | 官方源 |
| 默认插件目录 | 启动时自动扫描的目录 | 空 |

### 6.2 更新设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 扫描后自动检查更新 | 扫描完成后自动检测版本 | 开启 |
| 更新前自动备份 | 更新前先备份当前版本 | 开启 |

### 6.3 服务器同步设置

用于将安装包、目录、更新元数据同步到远程服务器。

| 配置项 | 说明 |
|--------|------|
| 服务器主机 | SSH 主机地址 |
| 服务器端口 | SSH 端口（默认 22） |
| 服务器用户 | SSH 用户名 |
| SSH 私钥 | 私钥文件路径 |
| 远程目录 | 同步目标目录 |
| DSH 目录 | DSH 安装目录 |
| 更新命令 | 服务器端更新命令 |

### 6.4 使用追踪

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 启用匿名统计 | 启动时上报安装 id + 版本号 | 开启 |

---

## 7. Tauri 命令一览

共 39 个 Tauri command，分为 8 组：

### 插件管理
| 命令 | 功能 |
|------|------|
| `scan_plugins` | 扫描已安装插件 |
| `auto_scan_plugins` | 自动扫描（后台） |
| `check_updates` | 检查所有插件更新 |
| `check_single_update` | 检查单个插件更新 |
| `update_plugin` | 更新指定插件 |
| `uninstall_plugin` | 卸载指定插件 |
| `set_plugin_enabled` | 启用/禁用插件 |
| `open_plugin_folder` | 打开插件文件夹 |
| `install_plugin` | 从市场安装插件 |
| `list_catalog_plugins` | 列出目录中的插件 |
| `validate_directory` | 验证插件目录 |
| `list_install_targets` | 列出可安装到的目标目录 |

### 文件操作
| 命令 | 功能 |
|------|------|
| `pick_directory` | 选择目录 |
| `pick_file` | 选择文件 |
| `pick_save_file` | 选择保存位置 |
| `open_external` | 在外部程序中打开 |

### 快照与离线
| 命令 | 功能 |
|------|------|
| `snapshot_export` | 导出快照 |
| `snapshot_preview` | 预览快照内容 |
| `snapshot_apply` | 应用快照 |
| `offline_pack` | 导出离线包 |
| `offline_apply` | 导入离线包 |
| `list_backups` | 列出历史备份 |
| `restore_backup` | 恢复备份 |

### MCP 管理
| 命令 | 功能 |
|------|------|
| `mcp_list` | 列出 MCP 服务 |
| `mcp_save_env` | 保存 MCP 环境变量 |
| `mcp_apply_config` | 应用 MCP 配置 |
| `mcp_probe` | 探测 MCP 服务连通性 |
| `mcp_toggle` | 启用/禁用 MCP 服务 |

### DSH 服务器
| 命令 | 功能 |
|------|------|
| `server_status` | 查询 DSH 服务器状态 |
| `server_start` | 启动 DSH 服务器 |
| `server_stop` | 停止 DSH 服务器 |
| `server_restart` | 重启 DSH 服务器 |

### DSH 本体
| 命令 | 功能 |
|------|------|
| `dsh_core_status` | 查询 DSH 本体状态 |
| `dsh_core_check_update` | 检查 DSH 本体更新 |
| `dsh_core_update` | 更新 DSH 本体 |
| `dsh_core_releases` | 获取 DSH 版本历史 |
| `get_dsh_version` | 获取当前 DSH 版本 |

### DSH 进程
| 命令 | 功能 |
|------|------|
| `is_dsh_running` | 检查 DSH 是否在运行 |
| `list_dsh_processes` | 列出 DSH 进程 |
| `kill_dsh_processes` | 终止 DSH 进程 |
| `kill_dsh_processes_elevated` | 提权终止 DSH 进程 |

### 自更新
| 命令 | 功能 |
|------|------|
| `check_self_update` | 检查应用自身更新 |
| `self_update` | 执行自更新 |
| `launch_auto_update` | 启动后台自动更新 |
| `get_auto_update_state` | 获取自动更新状态 |

### 配置
| 命令 | 功能 |
|------|------|
| `get_config` | 获取应用配置 |
| `update_config` | 更新应用配置 |
| `check_environment` | 环境体检 |

### 目录安全
| 命令 | 功能 |
|------|------|
| `get_catalog_trust` | 获取目录信任状态 |

### 服务器同步
| 命令 | 功能 |
|------|------|
| `test_server_connection` | 测试服务器连接 |
| `sync_to_server` | 同步到服务器 |

### 统计
| 命令 | 功能 |
|------|------|
| `report_app_ping` | 上报应用启动 ping |

---

## 8. API 接口一览

官网服务端提供 34 个 API 端点，详见 [第 5 节](#5-官网功能)。

### 数据库 schema（SQLite）

| 表 | 说明 |
|----|------|
| `plugins` | 插件目录（2189+ 条） |
| `bundles` | 组合包（94 条） |
| `comments` | 用户评论 |
| `favorites` | 用户收藏 |
| `shares` | 组合包分享 |
| `downloads` | 下载安装统计 |
| `page_views` | 页面浏览统计 |
| `app_pings` | 应用启动 ping |

---

*本文档版本：1.0 | 最后更新：2026-09-11*
