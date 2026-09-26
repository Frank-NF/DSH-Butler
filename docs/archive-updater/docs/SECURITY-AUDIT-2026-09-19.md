# 安全审查报告（2026-09-19）

审查范围：桌面客户端（`src-tauri/` + `src-vue/`）与官方网站（`website/`，含 Nitro 服务端 API）。
审查维度：通信加密、敏感信息泄露、鉴权与越权、输入校验与注入、客户端运行时防护。

结论分级：**致命 / 高 / 中 / 低**。「状态」列中 ✅ 表示本次已修复，⚠️ 表示需人工决策或后续处理。

---

## 一、已修复（本次改动）

### 1. 自更新验签「失败也放行」——致命 → ✅ 已修

- **位置**：`src-tauri/src/main.rs`（`check_self_update` 与自动更新后台路径）
- **问题**：原判断 `if let Some(false) = verify_response_signature(...)` 只在**明确验签失败**时拦截。
  返回 `None`（响应没有签名头、签名格式解析失败、公钥不匹配等）会被当作「通过」继续安装。
  等于攻击者只要**删掉签名头**就能绕过整条 Ed25519 签名链。
- **修复**：改为必须 `Some(true)` 才放行（fail-closed）。

### 2. 自更新「没有 SHA256 就跳过校验」——致命 → ✅ 已修

- **位置**：`src-tauri/src/main.rs`（`self_update`）
- **问题**：`expected_sha256` 为 `None` 时直接跳过校验并下载安装。清单被篡改或字段缺失即可投毒。
- **修复**：`expected_sha256` 缺失即拒绝安装。

### 3. 自定义安装源允许明文 http（中间人可替换安装包）——高 → ✅ 已修

- **位置**：`src-tauri/src/main.rs`（安装源校验）+ 新增 `src-tauri/src/security.rs`
- **问题**：校验只要求「以 `http://` 或 `https://` 开头」，公网 http 源全程明文，
  链路上任何人都能替换返回的 tarball → 任意代码执行。
- **修复**：明文 http 仅允许本机回环（`127.0.0.1` / `localhost` / `[::1]`），其余一律要求 https。
- **防护细节**：新增 `is_loopback_url()`，对 host 做**整体匹配**而非前缀匹配——
  `127.0.0.1.evil.com`、`localhost.evil.com` 这类绕过域名必须挡住（已由单测钉住）。

### 4. 官网 `/api/manifest/sign` 无需登录即可用私钥签名——高 → ✅ 已修

- **位置**：`website/server/api/manifest/sign.post.ts`
- **问题**：任何人都能反复调用，把服务端的 Ed25519 **私钥**当成免费签名机使用
  （签名 oracle + CPU/IO 打满）；错误响应还会回显私钥文件路径等本机信息。
- **修复**：必须管理员登录（未登录 401 / 非管理员 403）+ 单 IP 每分钟 5 次限频；
  异常详情只写服务端日志，响应改为通用提示。

### 5. 官网 `/api/creators/ledger` 未鉴权，可越权读取他人收入——高 → ✅ 已修

- **位置**：`website/server/api/creators/ledger.get.ts`
- **问题**：传任意 `authorId` 即可拿到该创作者的订单总额、平台抽成、到手金额（收入数据泄露）。
- **修复**：需登录；普通用户只能查自己的账（`authorId` 必须等于自己的用户 id），管理员可查全部。

### 6. 客户端无 CSP——中 → ✅ 已修

- **位置**：`src-tauri/tauri.conf.json`
- **问题**：`csp: null`，webview 无任何内容安全策略约束。
- **修复**：按 Tauri v2 官方推荐配置启用 CSP（Tauri 在编译期会为内联脚本自动追加 nonce/hash，
  因此 `script-src 'self'` 即可，不需要 `'unsafe-inline'`）：

  ```json
  "csp": {
    "default-src": "'self' customprotocol: asset: ipc: http://ipc.localhost",
    "script-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' asset: http://asset.localhost blob: data: https:",
    "font-src": "'self' data:",
    "connect-src": "'self' ipc: http://ipc.localhost https: http://127.0.0.1:* http://localhost:*",
    "media-src": "'self' data: blob:",
    "object-src": "'none'", "base-uri": "'none'",
    "frame-ancestors": "'none'", "form-action": "'none'"
  }
  ```

### 7. 官网无安全响应头——中 → ✅ 已修

- **位置**：`website/nuxt.config.ts`（`routeRules`）
- **修复**：全站下发 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、
  `Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`、
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`、CSP。
  站点为纯自托管资源（无 CDN / 外链脚本），因此 CSP 可收紧到 `'self'`。
  ⚠️ Nuxt 的水合载荷是内联 `<script>`，暂保留 `'unsafe-inline'`；后续可换 nonce 进一步收紧。

### 8. 设置里「服务器同步」预填了真实服务器地址——高（隐私）→ ✅ 已修

- **位置**：`src-tauri/src/error.rs`（默认值）+ 本机配置 `~/.dsh/plugin-updater-config.json`
- **问题**：配置里填着部署方的真实服务器地址、账号、私钥路径、远程目录与更新命令。
  这些值会随配置备份/截图/日志流出；历史上也曾被提交进 git。
- **修复**：
  1. 默认配置全部字段为空（新增两条单测钉住：`default_config_leaks_no_server_info`、
     `config_deserializes_without_inventing_server_info`）；
  2. 已清空本机配置文件中的实际值；
  3. 备份文件 `tmp/server-config-backup-*.json` 中的服务器字段也已 scrub；
  4. 发布脚本 `tmp/publish.js` 的服务器地址改为运行时环境变量 `DSH_PUBLISH_HOST`，不再写死在文件里。
- **已核验**：发布出去的 exe 内 utf8 / utf16le 全量扫描，不含该地址。

---

## 二、需要处理但需人工决策（⚠️）

### 9. Ed25519 私钥曾泄露到公开仓库——致命 ⚠️

- **问题**：签名私钥（以及 git 历史中的服务器地址）曾进入公开 GitHub 仓库。
  私钥一旦公开，验签就不再是安全保证——任何人都能签出合法的目录与自更新清单。
- **建议**：**轮换密钥对**（生成新私钥 → 更新服务端 `DSH_SIGNING_KEY_PATH` →
  重新编译客户端嵌入新公钥 → 旧公钥保留一个版本的兼容期）。
  在此之前，Ed25519 验签只能算「防误传」，不能算「防攻击」。

### 10. git 历史含真实服务器地址——高 ⚠️

- **问题**：历史提交中 16 处包含 `REMOVED-SERVER-HOST` 与 `ssh://root@REMOVED-SERVER-HOST/...` 远端地址。
- **建议**：推送公开仓库前用 `git filter-repo` 清洗历史（替换该字符串），再强制推送。
  注意：强推会改写所有历史 commit id，若有他人协作需先协调。

### 11. `/api/bundles/items/install` 未鉴权——低 ⚠️

- **问题**：无需登录即可调用，但接口本身只返回「安装计划」、不落库、不写文件，实际风险很低。
- **建议**：后续统一要求登录（或加 IP 限频），避免被刷。

### 12. 密码策略偏弱——低 ⚠️

- **问题**：`register.post.ts` 只校验 `length >= 8`，无复杂度要求、无长度上限。
- **建议**：加上限（如 200，避免超长输入消耗 bcrypt 算力）与常见弱密码黑名单。

---

## 三、已核查确认**无问题**的项

| 项 | 结论 |
|---|---|
| 传输加密 | 客户端全部外部请求均为 `https://`（GitHub / npm / 官网），未发现 `danger_accept_invalid_certs` 之类的关闭校验 |
| SQL 注入 | `website/server` 共 91 处 `prepare(` 全部参数化；两处 `${}` 模板（`feedback/index.ts` 的 `where`、`stats/overview.get.ts` 的表名/列名）拼接的内容**只来自代码内常量白名单**，非用户输入 |
| JWT | `NODE_ENV=production` 且缺 `DSH_JWT_SECRET` 时服务 fail-fast 拒绝启动 |
| Cookie | `httpOnly` + `sameSite=lax` + 生产 `Secure` |
| 密码存储 | `bcryptjs`，cost 10 |
| 登录/注册限频 | 有（IP + 邮箱双维度，注册 1 小时 5 次，并拦截一次性邮箱域名） |
| MCP 密钥 | 走系统凭据库（`mcp.rs` 的 `set_password` / `get_password`），不落明文 |
| 下载接口目录遍历 | `/api/dl/[file]` 用正则白名单 `^dsh-plugin-updater-\d+\.\d+\.\d+\.exe$`，并有 IP 限频 |
| 前端 XSS | 仅 `WIcon.vue` 使用 `v-html`，内容来自组件内常量图标表，不含外部输入 |
| 子进程弹窗 | 统一走 `proc.rs`，无 `DETACHED_PROCESS`（顺带避免命令回显） |

---

## 四、修复优先级建议

1. **立刻**：轮换 Ed25519 密钥（第 9 项）——在此之前其他签名相关防护都打折。
2. **推送前**：`git filter-repo` 清洗历史（第 10 项）。
3. **后续迭代**：nonce 化官网 CSP、install 接口鉴权、密码策略加强。
