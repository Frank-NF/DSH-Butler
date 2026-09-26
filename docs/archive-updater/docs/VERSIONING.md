# 版本与更新日志规范

> 自 2026-08-31（v1.1.0）起严格执行。每次交付（feat/fix/安全修复）都必须走本规范。

## 1. 版本号规则（SemVer）

格式 `MAJOR.MINOR.PATCH`，升哪一位由本次交付内容决定：

| 变更类型 | 升位 | 示例 |
|---|---|---|
| 破坏性：协议不兼容、配置结构变更、数据迁移不可逆 | MAJOR | 更新缓存格式重写 |
| 新功能：feat（含新命令、新页面、新 API） | MINOR | 组合包安装、版本徽章 |
| 修复：bug fix、安全修复、UI 微调 | PATCH | 目录穿越修复、按钮错位 |

- 一次交付只升一位：含 feat 的交付升 MINOR（纯 fix 才升 PATCH）；
- 多个改动一起发布时，取其中最高位；
- 版本号一旦定版（打 tag）不可复用，即使该版本未分发。

## 2. 版本源清单（4 处，全部同步）

| 位置 | 消费方 |
|---|---|
| `src-tauri/tauri.conf.json` → `version` | 桌面端徽章 `getVersion()`、安装包元数据 |
| `src-tauri/Cargo.toml` → `version` | `CARGO_PKG_VERSION`（自更新 current_version） |
| `src-vue/package.json` → `version` | 前端包标识 |
| `website/package.json` → `version` | 官网头部徽章（与客户端主/次版本保持一致，PATCH 位可独立） |

> `Cargo.lock` 在 `cargo check/build` 时自动跟随，无需手改。

## 3. 发布流程（每次修复/交付的固定顺序）

1. **开发期间**：所有变更记入 `CHANGELOG.md` 顶部 `## [Unreleased]` 段（按类型分小节，面向用户写结果，不写实现过程）；
2. **定版**：按第 1 节确定新版本号 X.Y.Z → 同步改 4 处版本源 → 把 `[Unreleased]` 改为 `[X.Y.Z] - YYYY-MM-DD`；
3. **构建验证**：`cd src-vue && pnpm build` → `cd src-tauri && cargo check`（改了 Rust 必须）→ `cargo build --release`；官网有变更则 `cd website && npx nuxt build` 并部署（tar → scp → .output.bak 替换 → restart dsh-website）；
4. **提交**：`chore(release): vX.Y.Z`（本次交付的功能 commit 仍按各自 feat/fix 前缀在定版前完成）；
5. **打 tag**：`git tag vX.Y.Z && git push origin vX.Y.Z`；
6. **自更新联动**：客户端内「检查更新」读官网 `/api/updater/latest`——分发新 exe 时同步更新该端点的版本与下载地址。

## 4. 更新日志格式（Keep a Changelog）

```markdown
## [X.Y.Z] - YYYY-MM-DD
### Added   新功能
### Changed 行为/界面变更
### Fixed   缺陷修复
### Security 安全修复
### Removed 移除
```

- 每条一行，中文，写「用户得到什么」而非「改了哪个文件」；
- `[Unreleased]` 允许为空；发布时整段改名，禁止删史；
- 桌面端与官网共用一份 CHANGELOG.md（仓库根）。

## 5. 版本显示链路

- 桌面端左上角徽章：`getVersion()` ← `tauri.conf.json`；
- 官网左上角徽章：`import { version } from '~/package.json'` ← `website/package.json`；
- 自更新弹窗 current：`CARGO_PKG_VERSION` ← `Cargo.toml`。

三处必须同版本出现，见第 2 节清单。
