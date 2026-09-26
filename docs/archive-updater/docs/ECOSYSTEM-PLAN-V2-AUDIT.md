# 三层生态升级规划（Plugin+MCP+Skill）审计报告

> 审计对象：《DSH-PluginUpdater 商用级全面升级规划文档（含插件/MCP/Skill/官网/客户端全链路）》
> 审计日期：2026-08-30 ｜ 方法：logicprobe ESCALATED 全流程（Phase 0-5 + 状态机 19 检查 + 数据模型 20 检查）
> 原则：Documents are not truth — code is. 所有对现状的声明均已对照本仓库与本机 DSH 实况取证。

## Plan Verification

- **Depth**: ESCALATED（绝对断言 + 新状态机 + 数据协议）
- **Scope**: 12 项现状声明逐一取证（file:line 级）；7 个 API 路由名核实；2 个可执行模型验证（19 项状态机检查 + 20 项数据模型检查）
- **Escalation**: 已执行 —— Bundle 安装事务状态机 as-written 版 A11 原子性违规（已找到最短反例路径）；修正版通过；数据模型 0 error
- **模型确认**: interaction=auto —— 证据引用提取 + 回环比对，报告标记 **UNCONFIRMED**（未经人工确认的提取）

---

## 一、现状声明核验（计划§「现有底座」）

| # | 计划声明 | 实况 | 证据 | 结论 |
|---|---|---|---|---|
| V1 | Tauri2.0 + Vue3 + Rust | tauri "2"、tauri-build "2"、schema 2；src-vue/ Vite 前端 | Cargo.toml:12-13、tauri.conf.json | ✅ |
| V2 | Windows/Linux 单文件 | bundle.targets="all" 已配置，但仓库仅有 .msi/.exe 产物 | tauri.conf.json、安装包/ | ⚠️ 目标已配、Linux 交付未验证（F7） |
| V3 | 插件扫描/备份/回滚/加速/卸载/更新 | 命令清单实测齐全 | main.rs（scan_plugins、auto_scan_plugins、list_backups、restore_backup、uninstall_plugin、check_updates、update_plugin、check_self_update、self_update）+ github_proxy.rs | ✅ |
| V4 | 官网 Nuxt3 + 排行榜 | website/ Nuxt3，server/api 28 个端点文件 | website/server/api/* | ✅ |
| V5 | （计划未提但关键）compat/conflicts/updater/manifest 签名已上线 | /api/compat/check(GET+POST)、/api/compat/rules、/api/conflicts、/api/updater/latest、/api/manifest/sign|verify、SQLite plugin_compat/plugin_conflicts | website/server/api/*、website/server/utils/db.ts | ⚠️ 计划把其中 3 个列为「新增」——重复排期（F4） |
| V6 | SHA256/Ed25519 已具备 | calculate_sha256（file_ops.rs:354）、ed25519-dalek 2 依赖、X-DSH-SHA256 头 | file_ops.rs:354-366、Cargo.toml | ✅ |
| V7 | Zip-Slip「需新增防护」 | zip 路径已有 enclosed_name() 防护；tgz 文件项由 tar-rs 0.4.46 unpack 内建拒绝 '..'（entry.rs:386-415、validate_inside_dst:437）；**真实缺口=tgz 目录项走 create_dir_all 无校验** | file_ops.rs:100-103、:137-139、:134 | ⚠️ 声明不精确（F3） |
| V8 | MCP 配置生成 cordis.patch.yml | cordis.patch.yml 是**插件层** patch（patch/insert/disabled 语法，本机实证）；MCP 注册实际 = ~/.dsh/dsh-mcp.json（全局）/<项目>/.dsh/mcp.json（项目级） | 本机 profiles/desktop/cordis.patch.yml、dsh-mcp-manager 契约 | ❌ 配置目标错位（F1） |
| V9 | Skill 全局/项目级安装 | ~/.dsh 下无 skills 目录；技能实际载体=插件内嵌 skills/（dsh-logicprobe/skills/logicprobe/SKILL.md 实证） | 本机 profiles/desktop/node_modules/dsh-logicprobe | ⚠️ 无已验证的独立 SKILL.md 加载路径（F2） |
| V10 | min_dsh_version "0.1.12" | 客户端版本 1.0.0（CARGO_PKG_VERSION）；compat API 示例 dsh_ver=1.x；check_environment 只探测 node/npm，**无 DSH 版本探测** | main.rs:104,125、compat/check.get.ts | ❌ 版本锚点无出处（F5） |
| V11 | 任务队列异步（取消/超时/重试） | 当前实现为同步 Tauri 命令 + 前端进度事件，无队列 | main.rs 命令清单 | ⚠️ 全新机制，需状态机定义（F6） |
| V12 | 附带发现 | tauri.conf.json "app" 内 "windows" 键重复定义 | tauri.conf.json | 🔧 卫生问题（F10） |

## 二、发现清单（按严重度）

### Architecture 级
- **F1 MCP 配置目标错位（P0 必改）**：Bundle 的 mcp_servers 若写入 cordis.patch.yml 不会注册任何 MCP 服务。正确分层：插件层 → cordis.patch.yml（insert/disable/pin，现成机制）；MCP 层 → dsh-mcp.json 条目生成（transport 仅 stdio/streamable-http）。
- **F2 Skill 层载体未定（P0 决策）**：DSH 运行时当前唯一实证的技能分发路径是「插件内嵌 skills/」。建议 P0 采用 Skill=插件（dsh-skill-* 包）方案——零运行时改动，完整复用现有安装/回滚/SHA256/兼容链；独立 SKILL.md 目录机制需先与 DSH 运行时确认加载契约，列入 P1 前置调研。

### Mechanism 级
- **F3 Zip-Slip 精确化**：修复目标是 extract_tgz 目录项（file_ops.rs:137-139）与 strip_top_level_dir 后的父目录拼接，抽 normalize_secure() + 恶意 tgz fixture 回归测试；无需重写 zip 路径。
- **F5 版本锚点**：先落地 DSH 运行时版本探测（profile package.json "dsh" 字段 / 应用清单），compat API 的 dsh_ver 语义与 Bundle 版本区间再锚定；"0.1.12" 不得未经核实写入协议示例。
- **F6 安装事务机未定义完整（详见 §三）**：原子边界、分阶段取消语义、回滚失败恢复、取消-完成竞态仲裁 4 点必须写入协议，否则「全部成功才生效，失败自动回滚」不可实现。
- **F7 平台声明**：Linux 产物改为路线图项，不当现状写。

### Consistency 级
- **F4 API 重复排期/命名漂移**：/api/compat/check、/api/updater/latest 已上线；冲突预检现有端点是 /api/conflicts（非 /api/conflicts/check）；索引命名应对齐现有风格（/api/plugins 无 .json 后缀）→ 新增 /api/skills、/api/mcp、/api/bundles（详情用查询参数，规避已记录的 Nuxt [id] 路由坑，见 docs/COMMERCIALIZATION-PLAN.md §六.1）。
- **F10 tauri.conf.json 重复键**。

## 三、可执行模型验证结果（UNCONFIRMED — auto 模式提取，未经人工确认）

### 3.1 Bundle 安装事务状态机（19 检查）

提取依据：计划§4.3（安装前检测/原子事务/失败回滚/审计快照）、§4.4（任务队列取消/超时/重试）。回环比对：下表与验证模型 24 条转移逐一对应（cancel 拆分为 cancel_idle/cancel_tx 两语义事件，为修正版定义）。

```text
State       | Event/Condition                    | Next State    | Guard?
------------|------------------------------------|---------------|-------
IDLE        | install_start                      | PRECHECK      | -
IDLE        | cancel_idle                        | CANCELLED     | -
PRECHECK    | check_pass                         | BACKUP        | -
PRECHECK    | check_fail                         | FAILED        | -
PRECHECK    | cancel_idle                        | CANCELLED     | -
BACKUP      | backup_ok                          | DOWNLOAD      | retry:=0
BACKUP      | backup_fail                        | FAILED        | (环境未动)
BACKUP      | cancel_idle                        | CANCELLED     | -
DOWNLOAD    | download_ok                        | INSTALL       | -
DOWNLOAD    | download_fail                      | DOWNLOAD      | retry<3 (inc)
DOWNLOAD    | download_fail                      | ROLLBACK      | retry>=3
DOWNLOAD    | cancel_tx                          | ROLLBACK      | cancelled:=1
INSTALL     | apply_ok                           | VERIFY        | -
INSTALL     | apply_fail                         | ROLLBACK      | (修正版：不原地重试)
INSTALL     | cancel_tx                          | ROLLBACK      | cancelled:=1
VERIFY      | verify_ok                          | COMMIT        | -
VERIFY      | verify_fail                        | ROLLBACK      | -
VERIFY      | cancel_tx                          | ROLLBACK      | cancelled:=1
COMMIT      | commit_ok                          | DONE          | -
COMMIT      | commit_fail                        | ROLLBACK      | -
ROLLBACK    | rollback_ok                        | PRECHECK      | !cancelled && retry<3 (inc=重试新事务)
ROLLBACK    | rollback_ok                        | FAILED        | !cancelled && retry>=3
ROLLBACK    | rollback_ok                        | CANCELLED     | cancelled
ROLLBACK    | cancel_tx                          | ROLLBACK      | (no-op)
```

| 结果 | 明细 |
|---|---|
| 通过 | S1 可达性、S2 无死锁、S3 无吸收环、S4 确定性、S6 守卫完备、S7 不变量有效、S8 单调、A3、A5 边界（retry 0..3）、A7、A9、A10 顺序（backup→apply→commit）、**A11 原子性（修正版）** |
| 反例（as-written 版） | **A11 违规**：IDLE→PRECHECK→BACKUP→DOWNLOAD→INSTALL --apply_fail(retry<3)--> INSTALL——「原地重试」离开原子组而未 commit/rollback。计划必须二选一：(a) 失败即回滚，重试=回滚后开启新事务（推荐，已验证通过）；(b) 显式把失败事件定义为事务内步骤 |
| 真实缺口 | **A6**：rollback_fail 无恢复路径（计划缺失）→ 必须规定：回滚失败时保留备份、给出人工恢复入口、绝不删除备份；**A2（40 例）**：cancel_tx 与完成事件竞态结果不同 → 需取消仲裁规则：verify_ok 之后 cancel 降级为 no-op；**A8（10 例）**：cancel 在终态需定义为 no-op |
| 簿记伪影（已归因，非设计缺陷） | A4×2：DONE 时仍"持有" backup（备份留存是设计意图，cleanup_old_backups file_ops.rs:216 负责回收）；DONE 时 env_change 释放走 commit 分支（引擎只登记 rollback_ok 为释放事件） |
| 可接受告警 | S5/A1（107 例跨阶段事件）：单事务作业由任务队列按 job 路由事件，跨阶段事件本就不该到达；写入实现规范即可 |

### 3.2 Bundle 协议数据模型（20 检查，0 error / 38 warnings）

实体：Bundle、BundlePlugin、BundleMcpServer、BundleSkill、BundleInstall、Snapshot + 存量 PluginCompat、PluginConflict；DD1-DD4 前后回归通过（纯增量，无移除）。

| 检查 | 结果 | 设计含义 |
|---|---|---|
| DS2 | 警告：新实体字段无迁移源 | 符合预期——新表增量 CREATE TABLE，无需迁移源 |
| DA2 | 警告：websocket/global/both/""/error 均不在枚举 | 枚举白名单必须在 API 层强制（传输=stdio/streamable-http；scope=user/project；mode=global/preset；severity=warn/block），空串必须拒绝 |
| DD4 | 警告：PluginConflict.severity string→enum 收窄 | 现库列为 TEXT——保留 TEXT+应用层校验，或先核实存量数据再上 CHECK 约束 |
| 其余 17 项 | 通过 | 引用完整性/唯一性/孤儿/回滚对称性/幂等/单调/序列全过 |

## 四、计划正确且应保留的部分

1. Bundle 统一协议方向、preset 会话模式（Token 风控）与密钥"仅本地"原则——与 dsh-mcp-manager 契约（env_keys 只下发键名）一致。
2. 三级市场 + Bundle 首页的官网板块划分；插件市场已有 125 条索引实测可用。
3. 五大场景包选题与人群定位。
4. 审计日志/快照纳入安装后动作——与现有 .updater_backups 机制可衔接（restore_backup/list_backups 已存在）。
5. 版本区间强制校验的方向正确（实现锚点见 F5）。

## 五、修正后建议排期

- **P0（1-3 天）**：F1/F2 载体决策落地 → Bundle 协议定稿（含枚举/事务边界/取消语义/回滚失败恢复）→ /api/bundles 只读索引 → 客户端 Bundle 安装（复用现有校验链+事务机修正版）→ F3 tgz 目录项修复 + 恶意包回归测试 → F5 版本探测。
- **P1（3-7 天）**：MCP 环境变量面板（本地加密）、连通性预检、/api/skills /api/mcp、preset 适配、快照导入导出。
- **P2（7-15 天）**：审计日志/Webhook、License/私有源、集群基础、文档中心、OpenAPI。
