# DSH 插件生态 · 官网 × 桌面端协同商用化方案（实施版）

> 状态：**Phase 1 + Phase 2 核心已实施上线**（2026-08-29）
> 覆盖：官网 dsh.huilinsh.cn（Nuxt3 SSR）+ 桌面端 DSH-PluginUpdater（Tauri 2.0）

---

## 一、总体架构（已落地）

```
                        ┌─────────────────────────────┐
                        │   dsh.huilinsh.cn (Nuxt3)   │
                        │   = 权威数据源 / 插件目录    │
                        │   /api/* JSON 契约           │
                        └──────────────┬──────────────┘
                                       │ HTTPS
                     ┌─────────────────┼─────────────────┐
                     │                 │                 │
         ┌───────────▼───┐  ┌─────────▼──────┐  ┌────────▼─────────┐
         │ 桌面端 Tauri   │  │ 在线版 Nuxt    │  │ 私有化镜像站      │
         │ 官网源优先     │  │ 共用同一套 API │  │ 内网同步官网源    │
         └───────────────┘  └────────────────┘  └──────────────────┘
```

**原则**：官网是唯一权威源；桌面端/在线版/私有镜像都消费同一套 `/api/*`；数据契约统一（`_source` 扩展区块）。

---

## 二、官网 API 契约（已上线）

### 2.1 插件索引

| 端点 | 方法 | 说明 | 状态 |
|---|---|---|---|
| `/api/plugins` | GET | 插件全量/分页索引，支持 `q` 搜索、`sort=star|name|hot|latest`、`category`、`page`/`page_size`、`fields=basic|full`、ETag 增量 | ✅ 线上 |
| `/api/plugin?id=xxx` | GET | 单插件详情：元数据 + `_source`（npm 版本聚合/changelog/最新版） | ✅ 线上 |
| `/api/plugin/download?id=xxx&version=` | GET | 插件包下载 302 重定向，白名单域名 + `X-DSH-SHA256` 校验头 | ✅ 线上 |
| `/api/plugins/stats` | GET | 收录数、分类计数、类型分布、最近更新 TOP | ✅ 线上 |
| `/api/stats` | GET | 旧端点（兼容保留） | ✅ 线上 |

### 2.2 兼容性 / 冲突知识库

| 端点 | 方法 | 说明 | 状态 |
|---|---|---|---|
| `/api/compat/check?plugin_id=&dsh_ver=` | GET | 兼容预检：精确规则 > 通配 `*` > 默认兼容，附带冲突清单 | ✅ 线上 |
| `/api/compat/check` | POST | Admin 维护兼容规则 | ✅ 线上 |
| `/api/conflicts?plugin_id=` | GET | 某插件冲突清单（公开） | ✅ 线上 |
| `/api/conflicts` | GET | 全量冲突清单（安装前批量预检） | ✅ 线上 |
| `/api/conflicts` | POST/DELETE | Admin 维护冲突 | ✅ 线上 |

### 2.3 桌面端自身更新 + 健康

| 端点 | 方法 | 说明 | 状态 |
|---|---|---|---|
| `/api/updater/latest` | GET | 桌面端最新版本 + 各平台安装包 + SHA256 + changelog + 是否强制 | ✅ 线上 |
| `/api/health` | GET | 服务/DB/数据源健康状态 + uptime | ✅ 线上 |

### 2.4 数据结构：`_source` 扩展区块

插件详情返回时附带（向后兼容，旧字段不删）：

```json
{
  "id": "dsh-plugin-example",
  "name": "示例插件",
  "_source": {
    "registry": "official",
    "npm": "dsh-plugin-example",
    "latest_version": "1.2.0",
    "versions": [
      { "version": "1.2.0", "published_at": "...", "dist": "...", "shasum": "..." }
    ],
    "changelog": [
      { "version": "1.2.0", "published_at": "...", "notes": null }
    ]
  }
}
```

### 2.5 数据库新增表（SQLite）

| 表 | 用途 |
|---|---|
| `plugin_compat` | 插件 × DSH 版本兼容规则（精确/通配，UNIQUE(plugin_id, dsh_version)） |
| `plugin_conflicts` | 已知冲突（severity: warn/block，UNIQUE(plugin_id, conflict_with)） |

---

## 三、桌面端改造（已编译通过）

### 3.1 市场数据源：官网优先 + 三级降级 + 磁盘缓存

`src-tauri/src/catalog.rs` 重构后的源顺序：

1. **官网权威源**（`GET https://dsh.huilinsh.cn/api/plugins?fields=basic&page_size=200`）
2. npm 镜像包（腾讯镜像 → npmjs 的 `dsh-plugin-catalog`）
3. 官方 GitHub Pages 直连（`awesome-dsh-plugin.com/plugins.json`）
4. **本地磁盘缓存**（`%APPDATA%/dsh-plugin-updater/catalog.json`，官网不可达时兜底，不白屏）

实现要点：
- `fetch_catalog_from_website()`：官网源拉取 + 成功时刷新磁盘缓存
- `write_cache()` / `read_cache()`：磁盘缓存读写
- `CatalogEntry` / `CatalogDescription` 增加 `#[derive(Serialize)]` 支持缓存序列化

### 3.2 待实施（Phase 2 剩余）

- 更新校验链：下载后校验 `X-DSH-SHA256`
- `/api/compat/check` 安装前预检 + 冲突预警
- `/api/updater/latest` 自我更新通道接入
- `_source` 写入 `plugin.manifest.json`

---

## 四、安全设计（已上线）

| 层 | 措施 | 状态 |
|---|---|---|
| API | 注册限频 1h/5 次 + 一次性邮箱域名黑名单 | ✅ |
| API | 登录限频 15min/10 次（IP+邮箱双维度） | ✅ |
| API | 反馈/评论/收藏 60s 限频 | ✅ |
| 下载 | `/api/plugin/download` 白名单域名（npm/mirror/github），防开放重定向/SSRF | ✅ |
| 校验 | 下载响应带 `X-DSH-SHA256` 头 | ✅ |
| Web | nginx 安全头全量（HSTS/CSP/X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy） | ✅ |
| Web | 全站 5r/s、API 写 2r/s 限流 + server_tokens off | ✅ |
| Web | gzip 压缩 | ✅ |
| SSH | 密码登录关闭 + root 仅密钥 | ✅ |
| 系统 | fail2ban（sshd + nginx） | ✅ |
| 认证 | GitHub OAuth（state 防 CSRF）+ 超级管理员白名单 | ✅ |

---

## 五、落地状态与下一步

### 已完成（2026-08-29）
- [x] Phase 1：官网权威 API（索引/详情/下载/统计/健康/updater）
- [x] Phase 1：桌面端官网源优先 + 磁盘缓存兜底
- [x] Phase 2 部分：下载白名单 + SHA256 头
- [x] Phase 2 部分：compat/conflicts 知识库表 + API + admin 维护
- [x] 安全加固全量上线

### 下一步（按优先级）
1. **桌面端校验链**：下载后 SHA256 校验 + 失败自动回滚（现有备份机制可复用）
2. **桌面端安装预检**：调 `/api/compat/check` + `/api/conflicts`，不兼容直接拒绝
3. **桌面端自我更新**：`/api/updater/latest` 接入
4. **Ed25519 签名**：manifest 签名防篡改（信任根）
5. **admin 维护界面**：compat/conflicts 可视化管理（复用反馈管理页框架）
6. **私有化镜像**：官网源同步到内网的脚本 + 部署文档
7. **插件详情页 + 兼容性看板**（前端页面）
8. **OpenAPI 文档** + 在线调试页

---

## 六、风险与注意

1. **`[id]` 路由兼容**：Nuxt 对 `server/api/plugins/[id].get.ts` 的路径参数在部分构建下拿不到值，详情/下载统一改用**查询参数形式**（`/api/plugin?id=`）——这是实施中发现并规避的坑，新端点一律用查询参数。
2. **数据一致性**：只保留官网一个写入口，桌面端只读消费；`plugins.json` 由发布流程统一生成。
3. **官网高可用**：桌面端必须保持本地缓存兜底，官网不可达不白屏（已实现）。
4. **manifest 演进**：`_source` 独立区块向后兼容，旧字段不删。

---

## 七、验证记录

| 端点 | 实测结果 |
|---|---|
| `/api/plugins?q=memory` | total=125，分页正常 |
| `/api/plugin?id=dsh-status-rotator` | 2743B，_source.versions=10（npm 聚合） |
| `/api/plugin/download?id=dsh-status-rotator` | 302 → npm tarball，X-DSH-SHA256 正常 |
| `/api/plugins/stats` | 21 分类 + 最近更新 TOP5 |
| `/api/health` | status=ok，db/data_source 正常 |
| `/api/compat/check` | 默认兼容 + 空冲突 |
| `/api/conflicts` | 空清单（初始） |
| `/api/updater/latest` | 返回当前版本 + release_url |
| 桌面端 cargo check | 编译通过（官网源 + 磁盘缓存） |
