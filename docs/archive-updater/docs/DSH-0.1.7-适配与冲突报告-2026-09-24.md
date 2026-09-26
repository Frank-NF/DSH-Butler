# DSH 0.1.7 适配报告：插件管家改动清单 + 冲突插件排查

> 日期：2026-09-24 ｜ 对照版本：DSH 0.1.7-rc.1 变更日志（官方），本机本体 0.1.7-alpha.2（commit 0010283）
> 管家改动提交：`6e6d0ef`（main）
> 排查对象：本机 web profile 已装 27 个 bundle（`C:\Users\niufe\.dsh\profiles\web`）

---

## 一、改动清单（代码已改，均有文档依据）

| # | 改动 | 文件 | 文档依据（0.1.7 变更日志原文） | 本体源码佐证 |
|---|------|------|------------------------------|--------------|
| 1 | `bundle_patch_of` 守卫支持 `dsh.bundle.patch` **数组写法**，逐个校验 patch 文件存在；单文件写法不变 | `file_ops.rs` | 「插件组合包支持按顺序加载多个 patch 文件，原有单文件写法仍可使用」 | `app-boot/src/profile.ts` `bundlePatchFiles()`：`patch: string \| string[]`，缺文件抛 `failed to read overlay` |
| 2 | 登记守卫新增 `engines.dsh` **版本兼容性检查**：不兼容 → 不登记进加载清单并说明原因（新枚举 `RegisterOutcome::Incompatible`）；版本探测不到/区间解析失败 → 放行（fail-open） | `file_ops.rs` | 「插件安装和启动会检查与当前 DSH 版本的兼容性；不兼容时说明原因，并可对确切版本授予例外」 | `util/package-manifest/src/types.ts` `DshEnginesManifest.dsh`（SemVer 区间）；alpha.2 快照尚未强制执行，属提前对齐 |
| 3 | node-semver 风格区间归一化解析（空格=AND、`\|\|`=OR；Rust semver 只认逗号） | `file_ops.rs` `parse_node_version_req` | 同上（生态区间由 node-semver 消费） | 实测样例：`dsh-mcp-panel` 的 `>=0.1.2-rc.1 <0.2.0 \|\| …` |
| 4 | 体检④「装了未登记」**排除** engines 不兼容的插件；修复中心改为明确报告不兼容原因，不再盲补登 | `file_ops.rs` + `main.rs` | 同 #2（不兼容插件官方语义=有意不激活，非故障） | — |
| 5 | 安装源自动选择：用户未显式配置源（空=默认官方）且失败属**网络不可达**时，自动改用 npmmirror 重试一次；显式配置的源不受影响 | `bundle.rs` | 「插件安装可选择官方源、国内镜像或自定义源；首次安装自动选择可访问的源」 | — |
| 6 | 环境体检「DSH 配置文件」项：settings.yaml 不存在**不再告警** | `main.rs` | 「设置改由当前 Profile 的插件配置保存…旧 settings.yaml 仅尝试导入一次」 | — |
| 7 | 安装后登记 / 启用 / 修复中心三处调用点全部处理 `Incompatible` 变体（日志/文案透出原因） | `bundle.rs` + `main.rs`×2 | 同 #2 | — |
| 8 | 回归测试：`bundle_patch_of_accepts_string_list`、`register_respects_engines_dsh`（✅ 2 passed） | `file_ops.rs` tests | — | — |

**评估后无需改动的点（附理由）**：

- **PTC 包名统一为 `ptc-runtime` / 工作流执行器改 `workflow-ptc`**：管家代码 grep 零引用，无需改。⚠️ 遗留：官网组合包仓库若含旧 PTC/workflow 引用需另行排查（服务端侧，不在本次桌面端范围）。
- **移除内置 E2B / 默认不启用 Ralph**：管家零引用。
- **MCP 升级 SDK v2**：`dsh-mcp.json` 配置文件格式不变，`mcp.rs` 读写/探活逻辑无需改。
- **配置热更新取消事务回滚**：管家写 profile `package.json` 自带 `.bak-updater` 备份 + 原子写，行为兼容。
- **Agent 预设改由插件组合包声明安装**：管家的「预设模式」建议文件存自有目录（`%APPDATA%\dsh-plugin-updater\preset-suggestions`），与 DSH 预设体系无冲突；长期价值下降，后续版本再评估。
- **弃用 Session 同步历史接口 / `agent/session-start`→`agent/created` / `readBytes` 统一**：管家不调用这些运行时接口。
- **`maxInlineBytes`→`maxInlineTokens`**：管家不写 spill-policy 配置。

---

## 二、与官方新功能重复 / 冲突的插件（本机实测）

> 方法：读取 27 个已装插件的 `package.json`（description / engines.dsh / dsh.bundle.patch）+ 全量源码关键词扫描（subagent_fork / workflow / e2b / maxInlineBytes），逐项对照 0.1.7 新功能清单。

### A. 高风险：既与官方功能重复，又引用了被关停的旧 API

| 插件 | 冲突点 | 实测证据 | 建议 |
|------|--------|----------|------|
| **@nanmicoder/dsh-agent-teams**（多 agent 团队协作） | 官方 0.1.7 新增「Agent Team 面板实时展示成员与任务，可从会话页头查看/切换成员」；且「Team 模式统一使用 spawn_teammate，**关闭 subagent 和 subagent_fork**」 | 源码检出 `subagent_fork` + 旧 workflow 引用 | 🔴 **建议禁用**，改用官方 Team 面板。旧工具已被官方关停，插件大概率失效 |
| **@michengai/dsh-agency-agents**（321 名专家智能体） | 官方 Team/subagent 体系收编同类能力 | 源码检出 `subagent_fork` | 🔴 高概率失效。召唤类功能若基于旧 subagent API 将不可用，等作者适配 `spawn_teammate` 或禁用 |
| **dsh-context** | 同上 | 源码检出 `subagent_fork` + 旧 workflow 引用 | 🔴 同上，建议禁用观察 |

### B. 功能重复：官方已原生覆盖，插件价值下降

| 插件 | 重叠的官方新功能 | 保留价值 | 建议 |
|------|------------------|----------|------|
| **@huanlin/…better-sidebar-plugin-office**（Office 预览） | 「侧边栏可预览 Word、Excel、PowerPoint、CSV 和 TSV」（官方还带公式/单元格/复制/缩放） | 基本归零 | 🟡 **建议禁用**。注意它依赖 dsh-better-sidebar |
| **dsh-sidenote**（Codex 式侧聊/旁注） | 「支持在侧边栏打开 Subagent 会话」 | 与官方 subagent 侧栏高度重叠 | 🟡 建议禁用对比体验后二选一 |
| **dsh-ego-browser**（浏览器自动化 30+ 工具） | 「侧边栏浏览器模式访问指定 URL」+「实验性 Playwright MCP / Chrome DevTools MCP / Stagehand 浏览器后端」 | 自动化深度仍在，单纯「看网页」被官方覆盖 | 🟡 只看网页可禁；要自动化可留或迁官方 Playwright MCP |
| **dsh-better-sidebar**（文件树/编辑器/改动/终端/侧聊合一） | 「Web 侧边栏新增终端（多标签/Shell 选择/刷新恢复）」+「会话文件改动审阅（逐行/分栏 diff）」 | 文件树/编辑器仍有价值 | 🟡 保留但**关闭其终端面板**（它就是 AGENTS.md 里「CMD 黑框抢焦点」的病灶：`bottomPanelAutoTerminal`）；与官方 diff 双面板并存易混乱 |
| **dsh-server-deck**（服务器仪表盘 + xterm 终端） | 官方侧边栏终端（部分重叠） | CPU/内存/磁盘趋势监控无官方对应 | 🟢 保留，终端重复可接受 |
| **dsh-cost-meter**（费用统计） | 「性能与用量设置可控制显示详略」 | 官方只有显示开关，无历史费用/90+ 模型价格目录/订阅额度 | 🟢 保留 |

### C. 兼容性警报：`engines.dsh` 区间与 0.1.7-alpha.2 的预发布版本陷阱

标准 node-semver 规则：**带预发布后缀的版本只能被「同三元组且带预发布」的比较器匹配**。实测本机三个插件：

| 插件 | 声明的 `engines.dsh` | 0.1.7-alpha.2 是否满足 | 后果 |
|------|---------------------|------------------------|------|
| dsh-mcp-panel | `>=0.1.7-0 <0.2.0 \|\| >=0.1.5-alpha.1 <0.2.0 \|\| …` | ✅ 满足（作者写了 `0.1.7-0` 预发布门槛，踩过这个坑） | 无 |
| dsh-sidenote | `>=0.1.1-rc.1 <0.2.0` | ❌ **不满足**（没有 (0,1,7) 元组的预发布比较器） | 官方 rc.1 实装兼容性检查后会被判不兼容、拒绝激活（可对确切版本授予例外） |
| dsh-sidebar-qa | `>=0.1.2-alpha.1` | ❌ **不满足**（同上） | 同上 |

> 管家侧已按同一规则实现检查（fail-open：本体 alpha 未实装时不受影响）。等官方 rc 落地后，dsh-sidenote / dsh-sidebar-qa 需要作者把区间改成 `>=0.1.7-0` 写法，或在设置里对确切版本授予例外。

### D. 管家自身 vs 官方插件管理页

官方 0.1.7「插件管理页支持安装、配置、启停和运行时卸载」与管家的装/卸/启停**直接重叠**，且官方多了「运行时卸载（免重启）」。管家的差异化价值在于官方没有的部分：

1. 插件市场（2189+ 目录、分类/搜索/排序）
2. 组合包事务化安装（预检/备份/回滚/半装恢复）
3. 快照导出/导入 + 离线打包还原
4. MCP 服务面板（密钥加密存储、连通性预检）
5. 修复中心 + profile 清单体检（官方报错不可解释时的兜底）
6. `engines.dsh` 兼容性原因透出（本次新增，与官方语义一致）

定位调整建议：管家主打「市场 + 组合包 + 快照 + 修复」，基础启停操作逐步引导用户用官方插件管理页（运行时卸载体验更好）。

---

## 三、验证记录

- `cargo check --bins`：✅ 通过
- 新增测试 `bundle_patch_of_accepts_string_list` / `register_respects_engines_dsh`：✅ 2 passed
- file_ops 全量测试：12 passed / 1 failed——失败项 `robust_remove_handles_deep_paths` 经对照实验（stash 改动后在未修改 HEAD 上同样失败）确认为**本机环境问题**（TEMP 深路径被杀毒/系统占用句柄），与本次改动无关，属既有问题。
