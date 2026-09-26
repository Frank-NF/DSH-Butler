# 项目记忆（Agent 必读）

> 本文件是持久项目记忆。会话开始时先读这里，避免重复劳动和回归错误。

## 品牌与命名（重要决策）

- **应用名称固定为「DSH插件管家」**（原名"DSH 插件升级管理工具"已废弃）。
  - 2026-09-11 曾发生回归：nuxt.config.ts 的 title/description/og:title 里残留旧名，已修复。
  - 任何新文案、meta、分享卡都必须用「DSH插件管家」。官网域名 dsh.huilinsh.cn。

## 主题系统 v4.1 橙红主色浅色默认（2026-09-12 定稿）

- **主色调**：从 `#6366F1`（靛蓝）改为 `#F46123`（橙红），与品牌盾牌渐变的暖色呼应。
- **默认主题**：从 dark 改为 light，更贴近用户日常使用场景。
- **设计系统版本**：v3 → v4，文件头注释已更新。
- **涉及文件**：
  - `src-vue/src/styles/main.css`：全量替换 CSS 变量
  - `src-vue/src/composables/useTheme.ts`：默认值改为 `'light'`
  - `src-vue/src/components/AutoUpdateFloat.vue`：渐变和颜色引用
  - `src-vue/src/components/ServerPanel.vue`：品牌色引用
  - `src-vue/src/components/PluginTable.vue`：选中态和核心插件边框
  - `src-vue/src/components/HeaderBar.vue`：品牌徽章边框
  - `website/assets/css/main.css`：官网主样式
  - `website/pages/*.vue`、`website/components/*.vue`：各页面硬编码颜色

## 图标系统 v4.0 蓝紫盾牌（2026-09-11 定稿）

- 图标包：根目录 `DSH-Icons-Full-v4.0-蓝紫盾牌/`（含 6 个设计方案源图，选用方案 6）。
- **设计**：深蓝→紫渐变底，白色插头 + 盾牌对勾 + 右下角循环箭头。语义：供电=装插件、盾牌=安全校验、箭头=更新。
- 已全量部署（commit 7ef981d）：
  - `src-tauri/icons/`：Windows 18 张 + icon.icns + Android 17 张 + iOS 18 张
  - `website/public/`：favicon 16/32/48/64/128/180/256/512 + apple-touch-icon + og.png
  - `src-vue/public/`：favicon.png(32) + favicon-16.png + apple-touch-icon.png
  - favicon 引用已从 SVG 切到 PNG 多尺寸（website/nuxt.config.ts + src-vue/index.html）
- `src-vue/src/components/WIcon.vue`：63 图标集 v2.0，含 `dsh-logo`（D 字+插头）、`status-*`、`mcp-*`、`combo-*`、`snapshot-*`。HeaderBar 品牌位用 `<WIcon name="dsh-logo">`。
- **更换图标用 `npx @tauri-apps/cli icon <1024源图>` 可重新生成全套**；源图在包内 `04-设计源文件/当前选用-方案6-蓝紫盾牌-1024.png`。

## 官网发布流程（2026-09-11 实战验证）

**服务器**：`root@<部署服务器>`（地址见本机 ~/.dsh/plugin-updater-config.json，不写入仓库；SSH 密钥 `~/.ssh/id_ed25519` 直连可用，无需 relay；relay 仅 git push 用）
**服务**：systemd `dsh-website`，WorkingDirectory=`/var/www/dsh-website`，执行 `.output/server/index.mjs`（端口 8072，nginx 反代 dsh.huilinsh.cn）
**分发目录**：`/var/www/dsh-updater/`（version.json、发布 exe、ed25519 私钥）

### 版本源（8 处，全部要同步）
`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/package.json`（**易漏！** 它不进产物，但
构建日志里的 `dsh-plugin-updater-tauri@x.y.z` 由它决定，不同步会造成"日志版本 ≠ 产物版本"的困惑）、
`src-vue/package.json`、`website/package.json`、`website/nuxt.config.ts`(runtimeConfig.public.appVersion)、
根 `package.json`，外加服务器 `/var/www/dsh-updater/version.json`（**本地这份常常落后于线上，
改 version.json 前务必先 `ssh` 拉服务器版本为准，别拿本地旧文件覆盖**）。
> 官网头部徽章读 `website/package.json`；下载页/首页读 `/api/updater/latest`（服务器 version.json）。两处不一致就会「网站显示的版本对不上」。

### 部署官网
```powershell
cd website; npx nuxt build
tar -czf "$env:TEMP\dsh-website-output.tar.gz" .output
scp -i "$env:USERPROFILE\.ssh\id_ed25519" "$env:TEMP\dsh-website-output.tar.gz" root@<部署服务器>:/tmp/
```
```bash
# 服务器上
cd /var/www/dsh-website
mv .output .output.prev-bak && tar xzf /tmp/dsh-website-output.tar.gz -C /var/www/dsh-website
chown -R www-data:www-data .output
systemctl restart dsh-website
```
> `.output` 之外的东西（`data/dsh.db`、`.jwt-secret`）不会被替换，安全。
> 只跑 `.output`，服务器上的源码副本是历史残留，不必同步。

**部署后必做的一项检查（否则可能整站交互全废）**：
```bash
curl -sI https://dsh.huilinsh.cn/ | grep -i content-security
# 必须看到 script-src 里含 'unsafe-inline'
```
原因见下方「已踩过的坑」第 7 条：nginx 的 CSP 一旦收紧到 `script-src 'self'`，
Nuxt 的内联引导脚本会被浏览器静默拦截，客户端 Vue 完全不挂载——
登录、筛选、收藏、评论全部失效，但页面看着"正常"（只是点什么都没反应）。

### 发布新版本 exe（自更新通道）
1. `tauri build --bundles nsis` 产出裸 exe 与安装包
2. scp 裸 exe → `/var/www/dsh-updater/dsh-plugin-updater-<ver>.exe`，安装包 → 同目录
3. 更新 `version.json`：`version`、`release_url`/`platforms.windows.url`（`https://dsh.huilinsh.cn/api/dl/dsh-plugin-updater-<ver>.exe`）、`sha256`、`size_bytes`、`published_at`，并把新变更摘要 **prepend** 进 `changelog`（保留历史），最后 `chown www-data:www-data`
   - ⚠️ **`size_bytes` 有顶层与 `platforms.windows.size_bytes` 两处，必须都写**：桌面端只读顶层字段算下载进度/剩余时间，只更新 platforms 那份会让进度条按旧包大小算（1.18.4 修过一次同类问题，1.18.5 发版时 `publish-version.py` 又漏了顶层，已补）。
   - 推荐直接用 `scripts/publish-version.py`（现已含顶层字段与自动备份），别手改 JSON。
   - 发完版把服务器那份 `version.json` 拉回仓库（`scp root@...:/var/www/dsh-updater/version.json .`）——仓库里那份是副本，常落后。
4. 下载文件名必须匹配 `/api/dl/[file]` 白名单正则 `^dsh-plugin-updater-\d+\.\d+\.\d+\.exe$`
5. 改完 `curl -s http://127.0.0.1:8072/api/updater/latest` 自测

### 对外分发版必须走 `scripts/build-release.ps1`

本应用要交给别人使用，发行版里**不能含构建机的私有信息**。用 `tauri build` 直接构建会把
`C:\Users\<用户名>\.cargo\registry\src\...` 这类绝对路径编译进 exe（实测 957 处），暴露
构建机用户名与目录结构。`scripts/build-release.ps1` 会用 `--remap-path-prefix`（Rust）
+ `/pathmap`（MSVC 的 C 依赖，如 lzma-sys）把这些前缀改写掉，并在构建后自检产物里是否
还有用户名。发布前务必用它构建，不要直接 `tauri build`。

> 前缀从 `$env:USERPROFILE` 与项目根推导，不写死任何用户名；换机器照样可用。
> 代价：RUSTFLAGS 变化会触发全量重建，首次约 6–7 分钟。

## 隐私红线（这是要分发的软件）

**绝不把下列内容写进源码、默认配置或会跟踪的文件**——发行版会把它带给每个使用者：

| 类别 | 说明 |
|---|---|
| 部署服务器地址 / IP / 用户名 | 含 `ssh://` 镜像地址、relay 中转地址、nginx `server_name` 里的 IP |
| 本机路径与用户名 | `C:\Users\<名>\…`、SSH 私钥路径、npm/缓存路径 |
| 管理员邮箱、token、密钥 | 含 `SUPER_ADMIN_EMAILS`、OAuth secret、Ed25519 私钥 |

已知处理方式：
- **DSH 本体镜像**：改为配置项 `dsh_mirror_url`（默认空 = 只用 GitHub origin），
  设置页「DSH 本体镜像」可填；用户本机的值存在 `~/.dsh/plugin-updater-config.json`（不跟踪）
- **relay 中转地址**：`scripts/push-via-relay.ps1` 不再内置默认值，必须用 `DSH_RELAY_HOST`
  环境变量或 `-Host` 传入（该问题在 `AUDIT-2026-09-03.md` 就记录过，2026-09-11 才落实）
- **服务器地址不再写进本文件**：见本机 `~/.dsh/plugin-updater-config.json`

> ⚠️ 历史遗留：上述信息曾出现在 10 个文件里并**已推送到公开 GitHub 仓库**
> （`origin/main`，含 AUDIT 报告、设计文档、i18n 占位符、installer.nsi）。
> 2026-09-11 已把这些文件的**当前版本**脱敏，但 **git 历史仍保留**——
> 如需彻底消除，得改写历史并强推，或（更稳妥）更换服务器地址/端口与密钥。
> 注意 GitHub 的 fork 与缓存无法被强推清除。

## 已踩过的坑

1. **图标名兼容**：WIcon 图标名保持不变（`plugin`/`package`/`refresh`…），新增不删旧。代码里同时存在 `arrowRight` 和 `arrow-right`、`check` 和 `check-circle` 两种写法，都有定义，勿"清理"其中一种。
2. **GitHub 直连被重置**：本机访问 GitHub 要走 `https://ghproxy.net/https://github.com/...` 镜像前缀（git clone / raw 文件都适用）。
3. **CMD 黑框抢焦点**：根因是 dsh-better-sidebar 插件 `bottomPanelAutoTerminal` 默认 true（编译产物在 `~/.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/client.js`），已改 false；DSH 源码 `packages/subprocess/subprocess-local/src/index.ts` 的 spawnTerminal 加了 `windowsHide: true`。
4. **「保存失败，请重试」弹窗**：来自 dsh-cost-meter 插件 `sidebarSimple` 设置保存失败，不在 DSH 核心仓库里。
5. **tauri build 必须从项目根目录跑**：`npx tauri` 在 src-vue/ 下会报"Couldn't recognize the current folder as a Tauri project"（CLI 只向下找 tauri.conf.json）；在 src-tauri/ 下 npx 又找不到 CLI。正确姿势：`cd G:\DSH\DSH-PluginUpdater; .\src-vue\node_modules\.bin\tauri.cmd build`。
6. **中文产品名打不出 MSI（2026-09-11 已破）**：WiX 报 LGHT0311——「DSH插件管家」写不进 en-US codepage 1252 数据库，tauri 表层只显示 "failed to run light.exe"。修法：`tauri build --bundles nsis` 出 NSIS 包；MSI 需手动改 `target/release/wix/x64/` 下 locale.wxl（Culture=zh-cn、Codepage=936、TauriLanguage=2052、TauriCodepage=936）和 main.wxs（Codepage 1252→936、Language 1033→2052），然后 candle + light 手动链接。成品：`DSH插件管家_1.18.2_x64_zh-CN.msi`。
7. **nginx 的 CSP 把整站交互打死（2026-09-12 修，排查过程值得记）**：`/etc/nginx/dsh-security-headers.conf` 里 `script-src 'self'` 缺 `'unsafe-inline'`，而 Nuxt 3 的 SSR 输出含**可执行的内联脚本**（`window.__NUXT__` 引导）——被浏览器静默拦截后客户端 Vue 从不挂载，登录/筛选/收藏/评论全部无反应，但页面渲染完全正常，且**控制台之外没有任何提示**（`Page.addScriptToEvaluateOnNewDocument` 挂 error 监听也抓不到，CSP 违规走 `securitypolicyviolation` 事件）。
   - 判别手法：`document.getElementById('__nuxt').__vue_app__` 是否为真 + `typeof window.__NUXT__` 是否为 `object`。二者缺失即"未挂载"。
   - 光看"页面能打开"会误判为正常；必须验证交互（点一个 Vue 绑定的按钮看 DOM 有无变化）。
   - 该文件已写明"必须保留 'unsafe-inline'"的注释，**不要**在安全审计时把它改回 `'self'`——除非改用 nonce 方案。
8. **限流 + fail2ban 会连坐整机所有站点（2026-09-12 事故，务必知道怎么救）**：
   - 现象：官网打不开，**同一台服务器上其它项目也全打不开**；但 SSH、以及各项目独占端口（如 3001/8072）正常。`ss -tlnp` 与 `systemctl`、磁盘内存全部正常。
   - 根因链：`sites-enabled/dsh-updater.conf` 的 `limit_req_zone dsh_general rate=5r/s` 挂在 `location /` 上 → 一次页面加载并发拉 15~30 个 `/_nuxt/` 资源，正常浏览即触发 503 → fail2ban 的 `nginx-limit-req`（原 maxretry=5 / bantime=3600）**在 iptables INPUT 链上封该 IP** → 封禁是全局的，该 IP 访问**本机所有站点**全部被 REJECT。
   - 快速判别：`iptables -L f2b-nginx-limit-req -n` 看有没有 REJECT 条目；`fail2ban-client status nginx-limit-req` 看 Banned IP list。
   - 救火（立即解封）：`fail2ban-client set nginx-limit-req unbanip <IP>`
   - 已做根治：
     1. 新增 `location /_nuxt/` 由 nginx 从 `.output/public/_nuxt/` **静态直发并免限流**（顺带不再压 Node）
     2. `jail.local` 的 `[nginx-limit-req]` 放宽为 `maxretry=15 / findtime=300 / bantime=600`，并把常用出口 IP 加进 `ignoreip`（sshd 的 5/600/3600 未动）
   - ⚠️ 改 nginx 配置时**备份不要放在 `sites-enabled/` 或 `conf.d/`**：nginx 会一并加载，导致 `limit_req_zone ... is already bound` 之类的 `nginx -t` 失败。备份放 `/root/nginx-backups/`（本次已归档）。

## 用户偏好

- 中文交流；给方案先要设计稿确认再全量铺开。
- 讨厌俗套设计（拼图块+循环箭头被评为"没啥艺术感"）；否决过"蓝块落槽"和"DSH 芯片字母"两个方案，最终选定蓝紫盾牌。
- 不喜欢临时文件残留：任务结束要清理 tmp/、日志文件。
