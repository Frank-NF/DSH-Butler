# DSH 三层生态管理平台 · 优化版实施方案（V2，备用定稿）

> 依据：ECOSYSTEM-PLAN-V2-AUDIT.md 审计结论修订。相对原规划的全部差异都有代码级证据或模型验证支撑。
> 状态：待启动 ｜ 基线：2026-08-30（Phase 1+2 商用化底座已上线，见 docs/COMMERCIALIZATION-PLAN.md）

## 0. 与原规划的关键差异（为什么改）

| 原规划 | V2 修正 | 依据 |
|---|---|---|
| MCP 配置生成 cordis.patch.yml | 插件层写 cordis.patch.yml（insert/disable/pin）；MCP 层写 dsh-mcp.json（全局）/ .dsh/mcp.json（项目级） | cordis.patch.yml 为插件 patch 语法（本机实证）；MCP 注册走 dsh-mcp-manager 契约 |
| Skill 独立 SKILL.md 包 + 全局/项目安装 | P0 以「Skill=插件」（dsh-skill-*）分发；独立目录机制列 P1 前置调研（需运行时契约） | 运行时唯一实证路径=插件内嵌 skills/（dsh-logicprobe 实证） |
| 新增 /api/compat/check、/api/conflicts/check、/api/updater/latest、/api/plugins/index.json | 复用已上线的 /api/compat/check、/api/conflicts、/api/updater/latest；新增 /api/bundles、/api/skills、/api/mcp（对齐现有命名，详情走查询参数） | website/server/api 实测；Nuxt [id] 路由已知坑 |
| min_dsh_version "0.1.12" | 版本锚点待探测：P0 先实现 DSH 运行时版本探测，再定协议示例 | 现有 check_environment 仅测 node/npm（main.rs:104,125） |
| 安装中原子事务+失败回滚+取消/超时/重试（未定义边界） | §3 事务规范定稿：失败即回滚、重试=新事务、分阶段取消、回滚失败保留备份 | 状态机 19 项检查：as-written A11 违规，修正版通过 |
| 新增 Zip-Slip 防护 | 精确修复 extract_tgz 目录项 + 恶意包回归测试（zip 路径与 tgz 文件项已有防护） | file_ops.rs:100-103/137-139；tar-rs 0.4.46 entry.rs:386-437 |

## 1. 三层资源 → 落地机制映射（V2 核心）

| 层 | 分发单元 | 安装动作（全部复用现有链路） | 配置落点 |
|---|---|---|---|
| Plugin | npm tgz / GitHub zip | install_plugin + SHA256 + backup → restore_backup 回滚 | node_modules/dsh-* + cordis.patch.yml（insert/disable/version pin） |
| MCP | 配置模板（非二进制） | 校验模板 → 合并写入 dsh-mcp.json；env 只写键名，值由用户本地填 | ~/.dsh/dsh-mcp.json（全局）/ <项目>/.dsh/mcp.json（项目） |
| Skill | dsh-skill-* 插件（P0） | 同 Plugin 链路；技能随插件 skills/ 目录被运行时加载 | node_modules/dsh-skill-*/skills/<skill>/SKILL.md |
| Bundle | bundle 清单 JSON | §3 事务机编排以上三层 | bundles 表 + 安装记录 + 快照 |

> Skill=插件的好处：零运行时改动、天然获得版本管理/SHA256/回滚/兼容校验/市场索引；dsh-logicprobe 已验证该模式可行。

## 2. Bundle 协议 V2（数据模型已过 20 项验证，0 error）

- 枚举白名单（API 层强制，空串拒绝）：`mode∈{global,preset}`、`scope∈{user,project}`、`transport∈{stdio,streamable-http}`、`severity∈{warn,block}`、`install.status∈{running,committed,rolled_back,failed,cancelled}`。
- mcp_servers[].env_keys：仅键名（pattern ^[A-Za-z_][A-Za-z0-9_]*$），永不存值——与 dsh-mcp-manager 契约一致。
- 版本字段：semver pattern；min/max 区间校验在 /api/bundles 与客户端双端执行；锚点值等 DSH 版本探测落地后回填。
- 新增表（增量 CREATE TABLE，无迁移）：bundles、bundle_plugins、bundle_mcp_servers、bundle_skills、bundle_installs、snapshots；存量 plugin_compat/plugin_conflicts 原样保留（severity 保持 TEXT+应用层校验，避免 TEXT→enum 收窄的破坏性变更）。
- 完整 JSON 示例沿用原规划 §2.1 结构，套用上表枚举与 env_keys 约束。

## 3. Bundle 安装事务规范（状态机验证通过版）

```text
IDLE → PRECHECK（兼容+冲突+版本区间，fail→FAILED）
     → BACKUP（复用 backup_plugin；fail→FAILED，环境未动）
     → DOWNLOAD（retry<3 原地重试；≥3→ROLLBACK）
     → INSTALL（apply_fail→ROLLBACK，不原地重试）
     → VERIFY（SHA256+冲突复检；fail→ROLLBACK）
     → COMMIT（commit_fail→ROLLBACK）→ DONE
ROLLBACK：rollback_ok → retry<3 ⇒ PRECHECK（重试=新事务）；retry≥3 ⇒ FAILED；cancelled ⇒ CANCELLED
```

强制规则（写入协议与实现规范）：
1. **失败即回滚**：任何事务内失败一步进入 ROLLBACK，重试以新事务开始（A11 通过的唯一解）。
2. **分阶段取消**：BACKUP 前 cancel=中止（CANCELLED）；进入 DOWNLOAD 后 cancel=触发 ROLLBACK（cancel_tx）。
3. **取消仲裁**：verify_ok 之后到达的 cancel 降级为 no-op（消除 A2 40 例竞态分歧）。
4. **回滚失败恢复**：rollback_fail 时保留备份 + 人工恢复入口 + 审计告警，绝不删除备份（A6 唯一缺口）。
5. 终态忽略一切迟到事件；每事务一个 job，任务队列按 job 路由事件（S5/A1 的 107 例跨阶段告警由该规则消解）。
6. 安装成功后：写 bundle_installs(status=committed) + 环境快照记录 + 审计日志；备份按 cleanup_old_backups 策略回收。

## 4. API 增量（复用优先）

| 端点 | 状态 | 说明 |
|---|---|---|
| /api/plugins、/api/plugin、/api/plugin/download、/api/plugins/stats、/api/compat/check、/api/compat/rules、/api/conflicts、/api/updater/latest、/api/health、/api/manifest/* | 已上线 | 零改动复用 |
| /api/bundles（GET 索引，q/sort/page）、/api/bundle?id=（详情） | P0 新增 | 查询参数风格；ETag 增量；客户端磁盘缓存兜底 |
| /api/skills（GET）、/api/mcp（GET 模板索引） | P1 新增 | 同风格；mcp 模板含 required_env_keys（仅键名） |
| /api/bundles/compat/check | P1 | 复用 compat/conflicts 知识库做整包预检（一次返回全量结果） |

## 5. 客户端增量（Tauri/Rust）

1. P0 安全修复：extract_tgz 目录项过 same 校验（抽 normalize_secure()），新增恶意 tgz fixture 回归测试（../、绝对路径、符号链接、超深路径、空目录项）。
2. P0 版本探测：read_profile_dsh_version()（profile package.json "dsh" 字段优先，降级应用清单），接入 compat 预检与 Bundle 区间校验。
3. P0 Bundle 安装编排：按 §3 事务机实现（tokio 任务 + 进度事件沿用现有 emit_progress 通道）；安装目标=profile 目录（现状 plugin_directory 已指向 .dsh/profiles/desktop）。
4. P1 MCP 面板：dsh-mcp.json 读写合并（保留用户手工条目）、env 值本地加密存储（Windows DPAPI/Credential）、连通性预检（stdio spawn 探活）、单服务启停。
5. P1 preset 适配：Bundle.mode=preset 时写会话预设建议而非全局 patch，避免 Token 过载。
6. P2 任务队列：job 表 + 取消令牌 + 超时 + 重试上限（对齐 §3 规则）。

## 6. 官网增量（Nuxt3）

- P0：/bundles 场景组合包首页 + /api/bundles；五大官方场景包数据（协议 V2 格式入库）。
- P1：/skills、/mcp 市场页（配置模板展示、所需密钥提示——只列键名与用途）；Bundle 详情页一键安装唤起（dshupdater:// scheme，P2）。
- P2：社区/企业版对比页、离线部署下载页、文档中心、状态看板（复用 /api/health 与源服务探测）。

## 7. 安全体系（全部有代码锚点）

- 防篡改：SHA256（已有）+ Ed25519 manifest 签名（框架已有，服务器 X-DSH-SIGNATURE 头补齐——上一轮审计待办 #1）。
- 防攻击：F3 精确修复 + 回归测试；下载白名单域名（已有，防 SSRF/开放重定向）。
- 密钥：MCP 密钥仅本地加密存储；官网/Bundle 协议只出现键名；.env/credentials 不入库不入包。
- 审计：bundle_installs + 审计日志（SQLite），永久留存；回滚失败即告警。
- Token 风控：global/preset 双模式强制标注（协议枚举），Bundle 详情必须展示上下文注入量预估。

## 8. 排期

- **P0（1-3 天）**：Skill=插件决策定稿 → Bundle 协议 V2 定稿 → 5 官方包数据（插件层先行，MCP 层附模板，Skill 层选已有插件组合）→ /api/bundles → 客户端 Bundle 事务安装（§3）→ F3 安全修复 → F5 版本探测。
- **P1（3-7 天）**：MCP 配置生成+环境变量面板+连通性预检 → /api/skills、/api/mcp → preset 适配 → 快照导入导出/离线打包。
- **P2（7-15 天）**：审计日志全量+Webhook → License/私有源/集群基础 → 官网完整市场页+文档中心 → OpenAPI。

## 9. 验收清单（每项可直接测试）

1. 恶意 tgz（目录项含 ../）安装被拒且无目录逃逸（fixture 测试）。
2. Bundle 安装中途 kill 进程 → 重启后检测 half-installed → 引导回滚成功（原子性）。
3. verify_ok 后发 cancel → 安装照常 DONE（取消仲裁）。
4. 模拟 rollback_fail（占用文件锁）→ 备份保留 + 人工恢复入口可用。
5. dsh-mcp.json 合并后既有手工条目零丢失；env 值不出现在任何上传流量。
6. compat 区间边界：v=min 通过、v=max 通过、v<min / v>max 拒绝。
7. Skill=插件安装后，DSH 会话内技能目录可见该技能（运行时加载实证）。
