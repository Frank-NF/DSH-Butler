# DSH 插件管家

> 独立运行的 DSH 插件管理工具，不依赖 Agent 本体。支持扫描、更新、启用、禁用、卸载插件，内置官方插件市场、行业组合包、MCP 服务管理与自动更新检测。

**简体中文 · [English](README.en.md)**

## 下载安装

- 官网下载（推荐）：**https://dsh.huilinsh.cn/download** —— 最新版 `v1.18.15`，提供 SHA256 校验值
- 应用内自更新：工具启动后自动检测新版本，一键升级（更新包 Ed25519 验签 + SHA256 校验）
- 功能总览见 [用户手册](https://dsh.huilinsh.cn/docs)

## 项目特性

- **独立运行**：不依赖 DSH Agent 本体进程，纯桌面工具
- **智能扫描**：自动识别插件目录下所有已安装插件和 Agent 本体
- **插件市场**：内置官方插件目录（2189+ 款），分类筛选、关键词搜索、Star/下载量/最新排序、一键安装
- **更新前先看日志**：点「更新」先弹本次更新说明；没有 Release 正文时自动取仓库 `CHANGELOG.md` 的最新版本段落；两者都没有会明确提示**「未发现更新日志」**
- **本体自修复**：「完成更新」会先隔离源码树里的非 HEAD 残留文件，再走官方全量重建，构建失败也能一键修好
- **一键更新 / 批量更新**：通过 npm registry 检测最新版本，更新前自动备份可回滚
- **启停管理**：轻松启用/禁用插件，无需删除文件
- **安全卸载**：卸载前自动备份，支持随时回滚
- **行业组合包**：插件 + MCP 模板 + Skill 一次装齐，带冲突预检与事务撤销
- **MCP 服务管理**：集中查看与管控本地 MCP 配置，密钥存系统凭据库（不落明文）
- **快照与离线打包**：导出/导入插件清单，支持无网络环境还原
- **修复中心**：DSH 运行环境体检 + 常见报错双语修复指南
- **双语界面**：中文/英文一键切换，本地记忆选择
- **跨平台**：Windows / Linux

## 项目结构

```
DSH-PluginUpdater/
├── src-tauri/              # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs         # 应用入口，Tauri 命令注册
│   │   ├── error.rs        # 错误类型与配置数据结构（默认值全空）
│   │   ├── security.rs     # 安全判定纯函数（回环地址判定等）
│   │   ├── manifest.rs     # 插件清单读写
│   │   ├── plugin_scan.rs  # 插件目录扫描
│   │   ├── github_proxy.rs # GitHub 请求客户端 + Release/CHANGELOG 抓取
│   │   ├── file_ops.rs     # 文件操作（更新/卸载/备份）
│   │   ├── catalog.rs      # 官方插件目录拉取与 Ed25519 验签
│   │   ├── bundle.rs       # 组合包协议（冲突预检、事务撤销）
│   │   ├── snapshot.rs     # 插件环境快照导出/导入/比对
│   │   ├── mcp.rs          # MCP Server 环境配置管理
│   │   ├── dsh_server.rs   # 本地 DSH Web 服务器启停
│   │   ├── dsh_core.rs     # DSH 本体更新与深度清理（quarantine）
│   │   ├── proc.rs         # 子进程统一入口（静默无黑窗）
│   │   └── version_probe.rs # 版本探测
│   ├── keys/               # Ed25519 密钥对（私钥 gitignore，仅公钥入库）
│   ├── icons/              # 应用图标（多尺寸）
│   ├── Cargo.toml
│   ├── tauri.conf.json     # 含 CSP 安全策略
│   └── build.rs
├── src-vue/                # Vue3 前端界面
│   ├── src/
│   │   ├── components/     # UI 组件（含 ServerPanel.vue / ReleaseNotesDialog.vue）
│   │   ├── stores/         # Pinia 状态管理
│   │   ├── api/            # Tauri 调用封装
│   │   ├── i18n/           # 中英文案
│   │   ├── types/          # TypeScript 类型定义
│   │   └── styles/         # 全局样式
│   └── package.json
├── website/                # Nuxt3 官方网站
│   ├── pages/              # 页面（首页/插件市场/组合包/下载/文档）
│   ├── components/         # 网站组件
│   ├── server/             # Nitro 服务端（API 路由 + Ed25519 签名）
│   └── nuxt.config.ts      # 含全站安全响应头
├── proxy-server/           # Go 代理服务器（GitHub/npm 加速）
├── scripts/                # 构建与部署脚本
├── docs/                   # 项目文档
├── 安装包/                 # NSIS 打包产物（归档历史版本）
├── version.json            # 自更新渠道清单（version/platforms/sha256/changelog）
└── README.md
```

## 技术栈

### 桌面客户端

- **Tauri 2.0**：Rust 后端 + Web 前端
- **Vue 3 + TypeScript**：Composition API
- **WeUI 2.6 + 自研 W\* 组件**：无重型 UI 库依赖
- **GSAP**：动效引擎
- **Pinia**：状态管理
- **Rust**：`reqwest` / `semver` / `zip` / `serde` / `walkdir` / `ed25519-dalek`

### 官方网站

- **Nuxt 3**（SSR）+ **Vue 3**
- **SQLite + jsonwebtoken + bcryptjs**：后台权限与认证

## 安全设计

### 传输与内容安全

- **Ed25519 签名链**：官网 `/api/plugins`、`/api/updater/latest` 对原始 body 字节签名；桌面端编译期嵌入公钥，验签失败即拒绝（市场降级磁盘缓存，自更新 fail-closed）
- **fail-closed 校验**：自更新响应**必须**带有效签名；更新包**必须**带 SHA256 校验值，缺失一律拒绝，不做「有就验、没有就放行」
- **强制 HTTPS**：全部外部请求走 https；自定义安装源若用明文 `http://`，仅允许本机回环（`127.0.0.1` / `localhost`），公网 http 源直接拒绝
- **客户端 CSP**：`tauri.conf.json` 内置 Content-Security-Policy，只允许加载本机与官方资源
- **密钥轮换**：私钥不入库、不随客户端分发，通过环境变量 `DSH_SIGNING_KEY_PATH` 部署到服务端

### 官网服务端

- **JWT fail-fast**：`NODE_ENV=production` 且缺失 `DSH_JWT_SECRET` 时服务启动即拒绝
- **Cookie**：`httpOnly` + `sameSite=lax` + 生产强制 `Secure`
- **限频**：登录/注册/反馈/下载/签名接口均按 IP 或账号限频
- **鉴权**：签名接口 `/api/manifest/sign` 与创作者结算账 `/api/creators/ledger` 均需登录且限本人/管理员
- **注入防护**：SQL 全部参数化；动态表名/列名仅来自代码内常量白名单
- **安全响应头**：`nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy` / `HSTS` / CSP

### 隐私

- 「服务器同步」的主机、端口、用户、私钥、远程目录、更新命令**全部默认为空**，不预填任何服务器地址
- 用户填写的服务器信息只保存在本机配置文件，不上传、不打包进发行版、不进日志

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Frank-NF/DSH-PluginUpdater.git
cd DSH-PluginUpdater
```

### 2. 开发桌面客户端

```bash
cd src-vue && npm install
cd ../src-tauri && cargo build
cd .. && npm run tauri dev
```

### 3. 构建生产版本

```bash
cd src-tauri
cargo tauri build
```

产物位于 `src-tauri/target/release/bundle/`。**发布时上传裸 exe（约 19MB），不是 NSIS 安装包。**

### 4. 启动官方网站

```bash
cd website
npm install
npm run dev
```

### 5. 密钥配置（仅服务端部署）

```bash
DSH_SIGNING_KEY_PATH=/var/www/dsh-updater/ed25519-private.pem
DSH_SIGNING_PUB_KEY=/var/www/dsh-updater/ed25519-public.pem
DSH_JWT_SECRET=<强随机 32+ 字节>
```

## 配置说明

在工具「设置」中可配置：

| 配置项 | 说明 | 默认值 |
|---|---|---|
| 代理地址 | GitHub 请求代理 | 空（直连） |
| 安装源 | npm registry 地址，只允许 https（明文 http 仅限本机回环） | 官方源 |
| 默认插件目录 | 启动时自动扫描的目录 | 空 |
| 扫描后自动检查更新 | 扫描完成后自动检测版本 | 开启 |
| 更新前自动备份 | 更新前先备份当前版本 | 开启 |
| 服务器主机 / 端口 / 用户 / 私钥 / 远程目录 / 更新命令 | 服务器同步（SSH） | **全部为空**，不预填任何地址 |

## 插件清单规范

每个插件目录下需要包含 `plugin.manifest.json`：

```json
{
  "id": "dsh-plugin-example",
  "name": "示例插件",
  "description": "插件功能介绍",
  "github_repo": "owner/repo",
  "current_version": "1.0.0",
  "enabled": true,
  "type": "plugin",
  "author": "作者名称",
  "homepage": "https://example.com"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 插件唯一标识符 |
| name | string | 是 | 插件显示名称 |
| description | string | 否 | 功能介绍 |
| github_repo | string | 否 | GitHub 仓库 (owner/repo) |
| current_version | string | 否 | 当前版本号 |
| enabled | boolean | 否 | 是否启用，默认 true |
| type | string | 否 | plugin 或 agent-core |
| author | string | 否 | 作者 |
| homepage | string | 否 | 主页地址 |

## 常见问题

### Q: 工具提示"检查更新失败"？

A: 检查网络连接。更新检测走 npm registry / GitHub，可在设置里配置代理或国内镜像。

### Q: 更新时提示"文件被占用"？

A: 请先关闭 DSH Agent 本体，再执行更新操作。

### Q: 点「更新」后弹窗说"未发现更新日志"？

A: 说明该插件的 Release 没有正文、仓库里也没有 CHANGELOG.md。这是如实提示，不是报错——你仍可继续更新（更新前会自动备份），也可以在弹窗里打开它的 Release 页面自行确认。

### Q: DSH 本体构建一直失败？

A: 用「完成更新」：它会先隔离源码树里的非 HEAD 残留文件（这是构建失败最常见的原因），再走官方全量构建入口。

### Q: 如何恢复误删的插件？

A: 工具在卸载和更新前都会自动备份，可在备份管理中恢复。

## 许可证

MIT License —— 详见 [LICENSE](LICENSE)

## 联系方式

- 官网：https://dsh.huilinsh.cn
- GitHub：https://github.com/Frank-NF/DSH-PluginUpdater

## 更新日志

详见 [CHANGELOG.md](CHANGELOG.md)
