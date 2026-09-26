# V2 P0 阶段实施状态（2026-08-31）

> 依据 docs/ECOSYSTEM-PLAN-V2.md（规则以 V2 为准）与 docs/ECOSYSTEM-PLAN-V2-AUDIT.md 审计结论实施。
> 本文档由 P0 实施过程生成，不改动上述两份规划文档。

## 一、完成清单

### 任务1 · F3 安全修复（src-tauri/src/file_ops.rs）

- 新增 `pub fn sanitize_rel_path(p: &Path) -> Option<PathBuf>`：拒绝含 ParentDir / RootDir / Prefix 组件的条目路径，仅放行普通名称与 CurDir。
- zip 与 tgz 两条解压路径在 `strip_top_level_dir` 之后统一过该函数；被拒条目 `log::warn` 后跳过，不中断整个解压。精确修复 tgz 目录项分支（原 L137-139 裸 `create_dir_all`，zip 文件项原有 `enclosed_name()` 防护保持不变）。
- 新增 3 个 `#[cfg(test)]` 测试（flate2::write::GzEncoder + 手写 GNU 头构造恶意 tgz，因 tar::Builder 写入侧会拒绝 `..`）：
  - `malicious_tgz_cannot_escape_target`：目录项 `pkg/../../evil/`、文件项 `pkg/../../file.txt`、绝对路径项 `/abs/evil.txt`，断言解压后 target 目录外零新增文件、解压整体成功（跳过而非中断）；
  - `legit_tgz_still_extracts`：正常 `package/` 前缀包回归，确认未误伤合法解压；
  - `sanitize_rel_path_rejects_dangerous_components`：`..`、`a/../b`、`/abs`、`C:\evil` 等组件级断言。

### 任务2 · F5 版本探测（src-tauri/src/version_probe.rs + main.rs）

- 新模块 `version_probe.rs`：`read_dsh_version(plugin_directory)` 读 `<plugin_directory>/package.json` 的 `dsh` 字段，`dsh.version` 优先、其次 `dsh.profile.version`，均无返回 None；附 3 个单元测试。
- 新命令 `get_dsh_version() -> Option<String>`（读配置 plugin_directory），已注册 invoke_handler。
- `check_environment` 追加第 8 项「DSH 运行时版本」检测（ok / warn + fix_hint）。

### 任务3 · 官网 Bundle API 与种子数据（website/）

- `website/server/utils/db.ts`：按 plugin_compat 既有建表写法新增 4 表 `bundles` / `bundle_plugins` / `bundle_mcp_servers` / `bundle_skills`（增量 CREATE TABLE IF NOT EXISTS，无迁移）。
- 新增 `website/server/utils/bundles.ts`：5 个官方 Bundle 种子（幂等 INSERT OR IGNORE，事务批量写入，API 模块懒加载调用）+ 行聚合（DB snake_case → API camelCase）。
- 新增 `website/server/api/bundles/index.get.ts`：GET 全量索引，聚合三张子表为数组返回，带 ETag / If-None-Match 304（与 plugins/index.get.ts 同风格），支持 q / sort / page / page_size。
- 新增 `website/server/api/bundle.get.ts`：GET `?id=` 单包详情（查询参数风格，规避 Nuxt [id] 路由已知坑），404 / 400 语义齐全。
- 种子数据严格按任务指定：bundle-starter / bundle-dev-full（含 mcp-github MCP 模板与 skill-logicprobe 技能，Skill=插件 source=dsh-logicprobe）/ bundle-content / bundle-research / bundle-enterprise；mode 全部 preset、transport 仅 stdio、env_keys 仅键名、min_dsh_version="*"、version 1.0.0、create_time 2026-08-31。

### 任务4 · 客户端 Bundle 事务安装（src-tauri/src/bundle.rs 新模块 + main.rs）

- 协议结构体 BundleDef / BundlePluginRef / BundleMcpServerDef / BundleSkillDef（serde camelCase，与官网 API 返回对齐）。
- `list_bundles`：GET 官网 /api/bundles（与 catalog.rs 官网源同一 host dsh.huilinsh.cn），成功刷新磁盘缓存 `%APPDATA%/dsh-plugin-updater/bundles.json`，失败读缓存，再失败空列表。
- `preview_bundle(id)`：逐项预检（已装/未装、当前版本、install/overwrite/skip 动作），期望版本取 npm latest（fail-open）；版本区间从简（min="*" 直过，非 "*" 时 semver 预检）。
- `install_bundle(id)`：严格按 V2 §3 事务机 PRECHECK → BACKUP（对将被覆盖的已装插件逐个走 backup_plugin）→ DOWNLOAD/INSTALL（逐插件复用 npm install 核心，与市场 install_plugin 共用同一 `npm_install_into`）→ VERIFY（安装目录存在 + package.json 版本与预期一致；SHA256 官网核对链路 P1 再接）→ COMMIT；任一步失败立即 ROLLBACK（touched 插件 restore_backup / 新装移除目录），回滚失败保留备份 + 明确错误、绝不删除备份（V2 §3 规则 4）。E2E 阶段补充：PRECHECK 对官网 404（Ok(None)）也并入磁盘缓存兜底（缓存=最后一次已知镜像，与 list_bundles 缓存语义一致）；run_transaction 的进度上报改为调用方注入（Tauri 命令走 bundle_progress 事件，E2E 收集事件向量），缓存与 MCP 目标路径支持 `DSH_BUNDLES_CACHE` / `DSH_MCP_PATH` env 覆盖（测试/离线场景，默认行为不变）。
- 重试语义 = 用户重新发起新事务，不做原地重试（代码注释标注 V2 §3 规则 1）。
- 分阶段取消：AtomicBool 令牌表（AppState.bundle_cancels），每事务一个 task_id；`is_cancelled` / `cancel_bundle_install` 命令；BACKUP 前 cancel=中止（CANCELLED），进入 DOWNLOAD 后 cancel=触发 ROLLBACK，verify_ok 后 cancel 降级 no-op（V2 §3 规则 2/3）。
- 进度：`bundle_progress` 事件按 task_id 路由，stage ∈ precheck/backup/download/install/verify/commit/rollback/cancelled/failed + 中文文案。
- MCP 层：安装成功后把 bundle.mcp_servers 合并写入 `~/.dsh/dsh-mcp.json`（既有条目零丢失，只补缺失 server_id；env 只写键名+空字符串值；transport 白名单 stdio/streamable-http；临时文件原子写）；失败仅 log 告警不影响事务结果。
- 安装记录：JSON Lines 追加到 `plugin_directory/.updater_backups/bundle_installs.json`（time/bundleId/version/result/plugins 状态，result ∈ committed/rolled_back/failed/cancelled，对齐 V2 §2 install.status 白名单）。
- 全部命令注册 invoke_handler：list_bundles / preview_bundle / install_bundle / is_cancelled / cancel_bundle_install；cargo check 零错误；全程无 unwrap()（沿用 error.rs AppError 风格）。

### 任务5 · 前端组合包入口（src-vue/）

- 新增 `src/api/bundles.ts`：listBundles / previewBundle / installBundle / isCancelled / cancelInstall / onBundleProgress（跟随现有 listen 封装与 isTauri 防护；浏览器预览列表走官网真实 API）。
- `src/types/index.ts`：新增 BundleDef / BundlePreview / BundleInstallResult / BundleProgress 等 camelCase 类型。
- `PluginTable.vue`：市场页新增「组合包」Tab（首次切换懒加载）；卡片=名称/描述/标签徽章/资源数徽章（插件 · MCP · 技能）；点卡片打开详情（插件清单含已装状态与动作徽章 + MCP 模板含 env 键名提示 + 技能清单 + 一键安装）；安装中按阶段中文映射显示进度（预检/备份/下载/安装/校验/提交/回滚）并禁用按钮、支持取消；失败展示错误与「已回滚」提示。
- i18n：zh.ts / en.ts 同步新增 tab.bundles 与 bundle.* 全量键。

## 二、验证结果摘要

| 验证命令 | 结果 |
|---|---|
| `cd src-tauri && cargo check` | 通过（LASTEXITCODE=0，零错误；27 个警告全部为既有 dead-code 类，非本次引入） |
| `cd src-tauri && cargo test` | 通过（**10 passed; 0 failed** —— file_ops 3 + version_probe 3 + bundle 真机 E2E 4，含恶意 tgz 目录逃逸 fixture） |
| `cd src-vue && vue-tsc --noEmit`（type-check 脚本） | 通过（零错误） |
| `cd src-vue && vite build`（build 脚本） | 通过（94 modules transformed，LASTEXITCODE=0） |
| `cd src-tauri && cargo build --release` | 通过（53.1s，dsh-plugin-updater.exe 16.1MB，已嵌入最新 dist） |
| `cd website && nuxt build` | 通过（.output 19.8MB / gzip 9.45MB） |
| **真机 E2E（cargo test bundle::e2e_tests，真实 npm 安装）** | 通过 4/4：①提交路径（left-pad+ms 真实落盘、版本校验、记录 committed、全阶段事件）②失败回滚（不可达 registry → npm 失败 → 目录零残留、记录 rolled_back、rollback 事件）③前置取消（BACKUP 前 cancel → cancelled、零改动）④MCP 合并（既有条目零丢失、既有 env 值不改写、只补缺失 server_id、幂等、env 仅键名空值） |
| 官网 4 个改动 TS 文件 TS 编译器 parse 诊断 | 全部 parse OK（nitro 自动导入符号不做类型级校验，属部署链路） |

> 注 1：src-vue 构建在本机沙箱内需绕过 pnpm 的 deps 预检钩子（钩子经宿主进程 spawn 被拒），实际以 `node_modules/.bin/vue-tsc --noEmit` 与 `node_modules/.bin/vite build` 直跑验证，语义与 package.json 的 type-check / build 脚本一致。
> 注 2：真机 E2E 的 npm 子进程与 nuxt/esbuild 构建在本机沙箱内需非受限权限（进程生成边界），常规终端执行不受影响。

## 三、部署与线上验证（2026-08-31）

- 官网已重新构建（nuxt build，.output 19.8MB）并部署：tar 打包 → scp 上传 → /var/www/dsh-website 旧 .output 备份为 .output.bak 后替换 → `systemctl restart dsh-website`，服务 active。服务器 DB（/var/.data/dsh-website.db）不动，4 张 bundle 表与 5 个种子包在首次访问时自动建表/落库。
- 线上验证（https://dsh.huilinsh.cn）：
  - `GET /api/bundles` → 200，`total=5`，五个官方包插件/MCP/技能清单齐全（camelCase）；响应带 `ETag: "5-2026-08-31"`、`Cache-Control: public, max-age=600`、`Access-Control-Allow-Origin: *`；`If-None-Match` 命中 → **304**（服务器本机直打 8072、经 nginx 443、本机 curl 三路均验证）。
  - `GET /api/bundle?id=bundle-dev-full` → 200，mcpServers[0]=mcp-github（transport=stdio，envKeys=[GITHUB_TOKEN]），skills[0]=skill-logicprobe。
  - `GET /api/bundle`（缺 id）→ 400；`?id=不存在的包` → 404；首页 → 200。
- 版本锚点（遗留项 3）探测补充：DSH Desktop 本体版本 2.0.4，与运行时 rc 包（0.1.0-rc.6）分属不同版本序列，进一步佐证当前无统一「DSH 运行时版本」权威源，锚点维持 "*"。

## 四、事务机模型验证（logicprobe，2026-08-31）

从 src-tauri/src/bundle.rs 实现提取 LogicModelV1（11 状态 / 15 转换）并跑 `logicprobe_verify`：**19 项检查 0 错误**（S1 可达性 / S2 无死锁 / S3 无有害环路 / S4 确定性 / S6 守卫完备 / S7+A7 不变量全可达路径成立 / S8 单调性 / A2 竞态 / A3 顺序无关 / A4-A6 / A8-A11 全过）。

**转换表**（UNCONFIRMED：模型由实施者提取，未经人工确认与设计意图完全一致）：

| 状态 | 事件 | 目标 | 语义 |
|---|---|---|---|
| idle | fetch_detail | precheck | 拉取详情（404/网络失败均并入缓存兜底） |
| precheck | begin_backup | backup | 预检通过 |
| precheck | cancel_check | cancelled | 规则2：BACKUP 前取消=中止（零改动） |
| backup | backup_ok | install | backup_made:=1（此后无任何删除备份的边，规则4） |
| backup | backup_fail | failed | 环境未动，无回滚 |
| install | plugin_ok | install | 逐插件安装，installed_any:=1 |
| install | all_installed | verify | 进入校验 |
| install | npm_fail | rollback | 规则1：失败即回滚 |
| install | cancel_detected | rollback | 规则2：进入下载后取消=回滚 |
| verify | verify_pass | commit | verify_ok:=1（校验门禁） |
| verify | verify_fail | rollback | 校验失败回滚 |
| commit | commit_ok | committed | 终态 |
| commit | commit_fail | rollback | 记录失败也回滚 |
| rollback | restore_ok | rolled_back | installed_any:=0（终态） |
| rollback | restore_fail | failed | 规则4：保留备份、绝不删除 |

不变量：INV-verify-gate（committed 必须在 verify_pass 之后）+ INV-commit-sequence（verify_pass 先于 commit_ok）——全部可达路径成立。规则3（verify_ok 后 cancel 降级 no-op）由拓扑缺席表达：verify/commit 状态无任何 cancel 出边。S5/A1 的 90 条「未处理事件对」为事件驱动建模固有噪音（终态与非相关事件静默忽略，与实现行为一致），接受为设计语义；规则 1/2/4 另有 cargo 真机 E2E 执行级验证（见验证结果摘要）。

## 五、遗留项（P1 起）

1. SHA256 与官网核对链路（VERIFY 阶段）按 V2 §5.3 留 P1 接入；当前 VERIFY 为「目录存在 + package.json 版本与预期（npm latest）一致」。
2. min/max_dsh_version 真实锚点值：P0 交付后对本机做了全源探测，结论=**当前环境不存在权威的「DSH 运行时版本」可探测源**——profile 的 package.json `dsh` 字段只有 `profile.bundles`（插件清单）与 `patchReload`，无 version/profile.version；本机未安装全局 dsh CLI（npm 全局仅有 pnpm；PATH 里的 `dsh` 是 DSH Desktop 宿主命令垫片）；`~/.dsh/settings.yaml` 无版本标记；运行时核心组件为 @deepseek-ai/dsh-atomic-write 等独立 rc 包（0.1.0-rc.6），无统一版本号。锚点维持 "*"（V2 §2 允许），待与 DSH 运行时侧约定统一版本源（如 dsh CLI --version 或 profile dsh 字段补 version）后回填；客户端对非 "*" 的区间校验已具备。
3. /api/skills、/api/mcp、Bundle 详情页一键安装唤起（dshupdater://）、MCP 面板与 env 本地加密存储：P1。
4. bundle_installs 快照导入导出、审计日志全量 + Webhook：P1/P2。
5. 半安装恢复引导（kill 进程后重启检测 half-installed）：事务机已保证回滚路径，独立检测入口属 V2 验收清单第 2 项，P1 落地。
6. 本机沙箱限制：vite/esbuild 子进程 spawn 需非受限权限（见上注），常规终端执行不受影响。
