# 开发指南

## 环境准备

### 必需工具

- **Node.js** >= 18.0.0
- **Rust** >= 1.70.0 (通过 rustup 安装)
- **Go** >= 1.21.0 (代理服务)
- **Docker** (可选，用于代理服务部署)
- **Git**

### Windows 额外依赖

```powershell
# 安装 Visual Studio Build Tools (C++ 编译环境)
# 下载地址: https://visualstudio.microsoft.com/visual-cpp-build-tools/
# 选择 "Desktop development with C++" 工作负载

# 安装 WebView2 (Windows 10/11 通常已内置)
# 下载地址: https://developer.microsoft.com/microsoft-edge/webview2/
```

### Linux 额外依赖

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y libwebkit2gtk-4.0-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

## 项目初始化

```bash
# 克隆项目
git clone https://github.com/Frank-NF/DSH-PluginUpdater.git
cd DSH-PluginUpdater

# 安装前端依赖
cd src-vue
npm install

# 安装网站依赖
cd ../website
npm install

# 下载 Go 依赖
cd ../proxy-server
go mod download
```

## 开发模式

### 桌面客户端开发

```bash
cd src-vue

# 启动 Tauri 开发模式（热重载）
npm run tauri dev

# 或仅启动前端开发服务器（浏览器调试）
npm run dev
```

### 代理服务开发

```bash
cd proxy-server

# 复制配置
cp .env.example .env
# 编辑 .env

# 启动开发模式
go run main.go

# 或使用 Docker
docker-compose up --build
```

### 官方网站开发

```bash
cd website
npm run dev
# 访问 http://localhost:3000
```

## 构建生产版本

### 桌面客户端

```bash
cd src-tauri

# Windows
cargo tauri build

# Linux
cargo tauri build

# 构建产物位置
# Windows: src-tauri/target/release/bundle/msi/
# Linux: src-tauri/target/release/bundle/appimage/
```

### 代理服务

```bash
cd proxy-server

# 本地构建
go build -o dsh-proxy .

# Docker 构建
docker build -t dsh-plugin-proxy .
```

### 官方网站

```bash
cd website

# SSR 构建
npm run build
node .output/server/index.mjs

# 静态站点生成
npm run generate
# 产物在 .output/public/
```

## 代码规范

### Rust 代码规范

```bash
# 格式化
cargo fmt

# 代码检查
cargo clippy --all-targets --all-features

# 运行测试
cargo test
```

### TypeScript/Vue 代码规范

```bash
# 类型检查
cd src-vue
npx vue-tsc --noEmit

# 代码格式化（如配置了 prettier）
npx prettier --write "src/**/*.{vue,ts,css}"
```

### Go 代码规范

```bash
cd proxy-server

# 格式化
gofmt -w .

# 代码检查
go vet ./...

# 运行测试
go test ./...
```

## 架构说明

### 数据流

```
用户操作 → Vue3 UI → Tauri invoke → Rust 后端
                                         ↓
                          ┌──────────────┼──────────────┐
                          ↓              ↓              ↓
                     文件系统操作    代理API      状态管理
                     (扫描/更新/     (GitHub访问)    (Pinia)
                      卸载/备份)
                          ↓
                     本地插件目录
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `main.rs` | Tauri 命令注册，应用入口 |
| `error.rs` | 错误类型、数据结构定义 |
| `manifest.rs` | 插件清单文件读写 |
| `plugin_scan.rs` | 插件目录扫描、验证 |
| `github_proxy.rs` | GitHub 代理 API 客户端 |
| `file_ops.rs` | 文件操作（更新/卸载/备份/解压） |

### Tauri 命令列表

| 命令 | 功能 |
|------|------|
| `scan_plugins` | 扫描插件目录 |
| `check_updates` | 检查所有插件更新 |
| `check_single_update` | 检查单个插件更新 |
| `update_plugin` | 更新指定插件 |
| `uninstall_plugin` | 卸载插件 |
| `set_plugin_enabled` | 启用/禁用插件 |
| `open_plugin_folder` | 打开插件目录 |
| `get_config` | 获取配置 |
| `update_config` | 更新配置 |
| `list_backups` | 列出备份 |
| `restore_backup` | 恢复备份 |
| `validate_directory` | 验证目录 |

## 调试技巧

### Rust 后端调试

```bash
# 启用日志
RUST_LOG=debug cargo tauri dev

# 查看 panic 信息
RUST_BACKTRACE=1 cargo tauri dev
```

### 前端调试

- Tauri 开发模式下按 `F12` 打开 DevTools
- 使用 Vue DevTools 浏览器扩展
- 在 `invoke` 调用处添加断点

### 代理服务调试

```bash
# 查看 Redis 缓存
redis-cli
> KEYS release:*
> GET release:latest:Frank-NF/DSH-Agent

# 查看服务日志
docker-compose logs -f proxy
```

## 常见开发问题

### Q: `cargo tauri dev` 报错 "WebView2 not found"
A: 安装 Microsoft Edge WebView2 Runtime。

### Q: 前端热重载不生效
A: 检查 `vite.config.ts` 中的端口配置，确保与 `tauri.conf.json` 中的 `devUrl` 一致。

### Q: Go 编译报错 "missing go.sum entry"
A: 运行 `go mod tidy` 重新生成依赖。

### Q: Docker 构建失败
A: 确保 Docker 守护进程正在运行，检查网络连接是否能访问 Go 模块代理。

## 发布流程

1. 更新版本号
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
   - `src-vue/package.json`
   - `website/package.json`

2. 更新 CHANGELOG.md

3. 提交代码并打 tag

```bash
git add .
git commit -m "release: v1.0.0"
git tag v1.0.0
git push origin main --tags
```

4. CI/CD 自动构建并发布到 GitHub Releases

5. 更新官网下载页面
