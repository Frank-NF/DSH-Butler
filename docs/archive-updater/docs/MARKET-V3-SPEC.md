# 插件市场优化设计规格（Market V3）

> 目标：在不破坏现有组合包事务安装链路的前提下，落地 5 项功能。
> 本文档只定义「数据结构 + 接口 + 交互逻辑」，实施按 §7 阶段拆分。
>
> 现状基线（已通读确认）：
> - 前端 `src-vue/src/components/PluginTable.vue`：三 Tab（市场/组合包/已安装），组合包详情走 `WDialog`，安装走 Tauri `invoke`；市场已支持搜索 + 可更新置顶。
> - 类型 `src-vue/src/types/index.ts`：`BundleDef` / `BundlePluginRef` / `BundleMcpServer` / `BundleSkill` / `MarketPlugin` / `PluginInfo`。
> - API `src-vue/src/api/bundles.ts`（Tauri invoke）与 `src-vue/src/api/mcp.ts`。
> - 后端 `website/server/utils/bundles.ts`：`buildBundle` 聚合 + `seedBundles` 灌官方包；`website/server/utils/db.ts` 建 4 张 bundle 表 + `users/shares/favorites/comments`。
> - 路由 `website/server/api/bundles/index.get.ts`（列表，支持 `q`/`sort`/分页/ETag）、`bundle.get.ts`（单个）、`mcp/index.get.ts`。
> - Rust `src-tauri/src/bundle.rs`：`list_bundles` / `preview_bundle` / `install_bundle` 事务安装。

---

## 0. 设计原则

1. **兼容优先**：所有新增字段在 `buildBundle` 输出里均为**可选（optional）**，缺省回退当前行为；老客户端解析旧数据不受影响。
2. **单一权威源**：组合包数据仍以官网 SQLite 为权威，桌面端 `list_bundles` 直接读官网 API（浏览器预览兜底同一源）。
3. **计费能力「预留不启用」**：免费/付费状态、购买与抽成字段全部先落数据结构 + 接口，但默认值一律「免费 / 未开通」，商业化开关放后端配置（§4.5、§5.3、§7 P3）。
4. **社区包与官方包同源**：`bundles.source` 区分 `official`/`community`，共用同一套子表与安装链路；社区包由用户经「分享」接口写入并落 `shares` 审计。

---

## 1. 功能 ① 组合包详情页完整清单 + 功能简介 + MCP 免费/付费状态

### 1.1 数据结构扩展（前端 `types/index.ts` + 后端 `buildBundle`）

现状：`BundlePluginRef { pluginRef, required }` 只有 npm 引用串，**没有简介**；MCP/Skill 无计费与简介字段。
扩展如下（全部向后兼容，新字段 optional）：

```ts
// 插件引用：新增简介 + 计费状态
export interface BundlePluginRef {
  pluginRef: string
  required: boolean
  /** 功能简介（来自官网插件目录 desc_zh/desc_en，缺失则留空） */
  description?: string | null
  /** 计费状态：free=免费(默认) / paid=付费预留。见 §4.5 计费模型 */
  billing?: 'free' | 'paid'
}

// MCP 服务：新增简介 + 计费状态 + 价格预留
export interface BundleMcpServer {
  serverId: string
  name: string
  transport: string
  command: string
  args: string[]
  envKeys: string[]
  optional: boolean
  description: string
  /** 功能简介（可空，缺省取 description） */
  brief?: string | null
  /** 免费/付费（默认 free） */
  billing?: 'free' | 'paid'
  /** 价格预留（仅 paid 时有值；单位分，CNY；free 恒为 0/缺省） */
  priceCents?: number | null
  /** 计费周期预留：'free' | 'month' | 'year' | 'once' */
  billingCycle?: string
}

// Skill：新增简介 + 计费状态
export interface BundleSkill {
  skillId: string
  name: string
  source: string
  scope: string
  optional: boolean
  description?: string | null
  billing?: 'free' | 'paid'
}

// BundleDef 顶层新增（见 §5 社区模型）：source / author / 社区字段
```

> 说明：`description` 在 MCP 里已有同名必填字段，因此简介用新增 `brief`（短简介），避免语义冲突；插件/Skill 无同名冲突，直接用 `description`。

### 1.2 后端 `buildBundle` 输出对应扩展

- `plugins` 映射：`pluginRef` 关联官网 `plugins`/`comments` 目录取 `desc_zh`（中文优先）作为 `description`；计费默认 `free`。
- `mcpServers` 映射：`description` 保留；新增 `brief = description`（短版可后续单独列）；`billing`/`priceCents` 默认 `free`/`null`。
- `skills` 映射：`description` 取自 `bundle_skills`（需新增列，见 §6.1）；`billing` 默认 `free`。

### 1.3 交互逻辑（前端）

- 组合包详情 `WDialog` 现有三段（插件清单 / MCP / Skill）保留，每项**新增一行简介**（`description`/`brief`）与**计费角标**（免费=绿 / 付费=橙，预留态显示「付费（即将上线）」）。
- 简介为空时显示「暂无简介」占位，不留白。
- 计费角标组件化：`<BillingTag billing priceCents cycle/>`，free 显示「免费」，paid 显示「¥{priceCents/100} · {cycle}（预留）」并加锁图标。

---


## 2. 功能 ② 组合包内每个插件/技能独立安装按钮

### 2.1 数据结构

复用 §1 的 `BundlePluginRef.description/billing`。安装按钮作用对象是**单项**，故需一个「单项安装请求」入参结构（§3.3）。详情里每项渲染一个独立安装按钮（插件 + 技能；MCP 因只是 env 模板不含可执行包，仅展示计费，不加安装按钮）。

```ts
/** 单项安装请求（组合包内按项挑选，不走整包事务） */
export interface BundleItemInstallRequest {
  bundleId: string
  /** 单项引用：plugin=xxx / skill=yyy（MCP 不可单独安装，传则忽略） */
  itemType: 'plugin' | 'skill'
  itemRef: string
  /** 安装目标目录，缺省 = 当前 profile 目录 */
  targetDir?: string
}

export interface BundleItemInstallResult {
  ok: boolean
  itemType: 'plugin' | 'skill'
  itemRef: string
  status: 'installed' | 'skipped' | 'failed'
  message: string
}
```

### 2.2 后端接口定义

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/bundles/items/install` | 单项安装。入参 `BundleItemInstallRequest`。插件项 = `npm install <pluginRef>` 到目标 profile（复用官网插件下载/安装逻辑）；技能项 = 写 `bundle_skills` 到本地技能目录。幂等：已装且同版本返回 `skipped`。 |
| GET | `/api/bundles/items/status?bundleId=` | 单项安装态。返回 `{ bundleId, items: [{itemType,itemRef,installed, currentVersion, latestVersion, billing}] }`，供前端渲染每项「已安装/安装」按钮态。 |

> 桌面端：单项安装走 Rust 命令 `install_bundle_item`（新增，§3.4），`/api/bundles/items/*` 是官网预览/兜底源。

### 2.3 交互逻辑

- 详情对话框插件/Skill 列表每行右侧新增独立「安装 / 已安装(灰) / 更新」按钮（`<WButton size="mini">`）。
- 单项安装**不触发整包回滚事务**，单项失败只 toast 该项错误，不影响其他项。
- 按钮态由 `/api/bundles/items/status` 初始化；安装成功后本地缓存该项为 installed，行内即时刷新为「已安装」。
- 「一键安装全部」仍保留原整包事务（§现状 `install_bundle`），独立安装是「精细化挑选」入口，二者并存。

---

## 3. 功能 ③ 组合包 + 已安装标签页内集成检索

### 3.1 现状

- 市场 Tab：已有 `marketSearch`（名称/描述/分类）+ 排序 + 分类 chips。
- 组合包 Tab：**无检索**，仅整列网格。
- 已安装 Tab：仅分类 chips + 可更新置顶，**无关键词检索**。

### 3.2 数据结构

无需新数据结构。检索 = 对现有数组做客户端过滤（组合包已全量拉取 `listBundles()`；已安装 = `pluginStore.plugins`）。组合包检索命中字段：`name` / `description` / `tags` / 内含插件 `pluginRef` / `mcpServers.name` / `skills.name`。

```ts
/** 组合包检索过滤器（前端 computed） */
function bundleMatches(q: string, b: BundleDef): boolean {
  const s = q.toLowerCase()
  return (
    b.name.toLowerCase().includes(s) ||
    (b.description || '').toLowerCase().includes(s) ||
    b.tags.some((t) => t.toLowerCase().includes(s)) ||
    b.plugins.some((p) => p.pluginRef.toLowerCase().includes(s) ||
      (p.description || '').toLowerCase().includes(s)) ||
    b.mcpServers.some((m) => m.name.toLowerCase().includes(s) ||
      (m.description || '').toLowerCase().includes(s)) ||
    b.skills.some((sk) => sk.name.toLowerCase().includes(s) ||
      (sk.description || '').toLowerCase().includes(s))
  )
}

/** 已安装检索过滤器：命中 name / 描述 / category / current_version */
function pluginMatches(q: string, p: PluginInfo): boolean {
  const s = q.toLowerCase()
  return (
    p.manifest.name.toLowerCase().includes(s) ||
    (p.manifest.description || '').toLowerCase().includes(s) ||
    (p.description_zh || '').toLowerCase().includes(s) ||
    (p.category || '').toLowerCase().includes(s)
  )
}
```

### 3.3 后端接口定义（组合包检索支持服务端模式）

`/api/bundles?q=` 已存在并命中 name/description/tags。新增对**内含项**的服务端检索（可选增强，默认前端本地过滤即可）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bundles?q=&deep=1` | `deep=1` 时 `q` 额外命中组合包内含插件/MCP/Skill 名称（跨 `bundle_plugins`/`bundle_mcp_servers`/`bundle_skills` 联表）。 |

### 3.4 交互逻辑

- 组合包 Tab 顶部加一个搜索框（复用市场 `weui-search-bar` 样式），`bundleSearch` ref + `filteredBundles` computed（`bundleMatches`）。
- 已安装 Tab 顶部加搜索框（`pluginSearch`）+ `searchedPlugins` computed（在现有 `filteredPlugins`（分类 + 可更新置顶）之上叠加关键词过滤，**可更新置顶顺序保留**）。
- 检索为空时沿用 `WEmpty`（`market.noResult`），提供「清除」按钮。
- 桌面端 Rust：无需新增命令（检索在前端本地做；官网深度检索走 §3.3 `deep=1`）。

---

## 4. 功能 ④ 插件市场 Tab 有可用更新优先置顶

### 4.1 现状

`marketFiltered` 已实现：`updatableNpmKeys`（已安装可更新插件的 id/短名）命中市场条目 → `matchesUpdatable` → 置顶。市场卡片已有 `可更新` 角标。

### 4.2 数据结构扩展（强化置顶信号）

`MarketPlugin` 增加「相对本地已装」的更新提示字段（由前端在 `marketFiltered` 阶段就地计算，非后端字段）：

```ts
export interface MarketPlugin {
  /* ...现有字段... */
}
/** 前端派生：市场条目是否对应当前已装且可更新 */
export interface MarketPluginView extends MarketPlugin {
  /** 命中已安装可更新列表（与 matchesUpdatable 同源） */
  hasUpdate: boolean
  /** 已装版本 → 最新版（用于展示 vCur → vLatest） */
  fromVersion?: string | null
  toVersion?: string | null
}
```

置顶排序（`marketFiltered` 内，替换现 `matchesUpdatable` 段，加版本号倒序二级键）：

```ts
// 1) 有可更新的排最前；2) 同为有更新的按 toVersion 倒序；3) 其余保持用户选定 sort
list.sort((a, b) => {
  const ua = (a as MarketPluginView).hasUpdate
  const ub = (b as MarketPluginView).hasUpdate
  if (ub !== ua) return Number(ub) - Number(ua)
  // 二级：有更新的按 toVersion 降序
  if (ub && ua) {
    const va = semverDesc((a as MarketPluginView).toVersion)
    const vb = semverDesc((b as MarketPluginView).toVersion)
    return vb - va
  }
  return 0
})
```

`hasUpdate`/版本对由 `pluginStore`（`plugins` 里的 `update_available`/`latest_version`）与市场 `npm/name` 匹配得到，注入 `pagedMarket` 前组装 `MarketPluginView[]`。

### 4.3 交互逻辑

- 市场 Tab 顶部（搜索框旁）加一个可折叠的「可更新 N」快捷筛选（`marketOnlyUpdate` 开关）：开启时仅显示 `hasUpdate` 条目。
- 卡片/列表行已有 `可更新` 角标，置顶后在其左侧加「🔝 待更新」微标识（纯样式，不新增数据）。
- 置顶为**默认且唯一**的默认排序（用户切 stars/downloads 时仍保持「可更新组在最前、组内按所选排序」——置顶权重恒高于用户排序，避免可更新项被埋没）。
- 后端无需改动（置顶是前端本地视图逻辑，依赖 `pluginStore.plugins` 的可更新态）。

---

## 5. 功能 ⑤ 组合包社区化：自由搭配 + 分享 + 购买/抽成预留

### 5.1 数据结构

`BundleDef` 顶层新增社区与计费字段（全部 optional，官方包默认值见 §6.1 列默认）：

```ts
export interface BundleDef {
  /* ...现有字段... */
  /** 来源：official=官方预置 / community=社区用户创建（默认 official） */
  source?: 'official' | 'community'
  /** 作者（官方包=平台，社区包=用户昵称/userId） */
  author?: string
  /** 作者用户 ID（社区包必填；官方包 null） */
  authorId?: string | null
  /** 分享时间（社区包；ISO 8601） */
  shareTime?: string | null
  /** 血缘：基于哪个包改出来的（可追溯，缺省 null） */
  baseBundleId?: string | null
  /** 内含项「付费项数量」，用于卡片「含 N 项付费」提示（预留） */
  paidCount?: number
  /** 平台审核态（社区包上架状态；官方包恒 reviewed） */
  reviewStatus?: 'pending' | 'reviewed' | 'rejected'
  /** 预留计费块（§5.3），缺省 null */
  pricing?: BundlePricing | null
}
```

### 5.2 自由搭配（前端交互）

- 组合包 Tab 新增「+ 自建组合包」按钮 → 打开一个**搭配器对话框**：
  - 左侧三列来源 = 插件市场（`marketPlugins`）/ MCP（`mcpApi.list()`）/ 技能（`/api/skills`）。
  - 每行一个勾选框；勾选即加入右侧「我的组合」清单；可改名、改标签、写简介。
  - 产出 `BundleDef`（`source='community'`，`author=本地用户昵称`，`baseBundleId` 可选血缘）。
- 保存行为二选一（交互逻辑）：
  1. **仅本地**：写入本地（localStorage / 桌面端 Tauri 文件），不上传；标记「本地包」，只本地可见、可安装。
  2. **分享至平台**：调 §5.4 分享接口，服务端落库 + 落 `shares` 审计，`reviewStatus='pending'`，平台审核通过后对全站可见。

### 5.3 购买服务 + 平台抽成结算（数据结构预留，本期不启用）

```ts
export interface BundlePricing {
  hasPaidItems: boolean          // 组合包级：内含付费项数>0
  packagePriceCents: number | null // 整包价（null=免费）；单位分 CNY
  cycle: 'free' | 'month' | 'year' | 'once'
  commissionRate: number | null  // 平台抽成比例（如 0.10），结算用，本期不触发资金流
  channel: 'wechat' | 'alipay' | null // 支付通道预留
}

/** 单笔订单/结算记录（预留，本期只建表不落业务） */
export interface BundleOrder {
  orderId: string
  bundleId: string
  authorId: string          // 被抽成方（创作者）
  buyerId: string
  grossCents: number        // 订单总额
  commissionCents: number   // 平台抽成
  authorCents: number       // 创作者到手
  status: 'created' | 'paid' | 'settled' | 'refunded'
  createdAt: string
}

/** 创作者结算账（预留） */
export interface CreatorLedger {
  authorId: string
  period: string            // 结算周期，如 '2026-09'
  grossCents: number
  commissionCents: number
  settledCents: number
  status: 'open' | 'settled'
}
```

交互逻辑（预留态）：
- 卡片/详情若有 `paidCount>0`，显示「含 N 项付费 · 即将上线」灰态锁；点购买按钮 toast「付费功能即将上线」，**不进入真实支付**。
- 抽成/结算纯数据 + 接口占位（§5.4），资金流 P5 才接。

### 5.4 分享 + 结算接口定义（后端）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/bundles` | 创建/分享。入参：`{ id?, name, description, tags, plugins[], mcpServers[], skills[], source='community', author, authorId, baseBundleId?, pricing? }`。需登录。落 `bundles` + 子表 + `shares` 审计；`reviewStatus='pending'`。 |
| GET | `/api/bundles?scope=community&review=reviewed` | 列表增强：`scope` 过滤来源，`review` 过滤上架态（默认返回全部官方 + reviewed 社区包）。 |
| POST | `/api/bundles/review` | 平台审核。body `{ id, status:'reviewed'\|'rejected', note? }`，写 `bundles.review_status`。 |
| POST | `/api/bundles/pricing` | 预留计费设置。body `{ id, pricing:BundlePricing }`，写计费列（本期只存档不触发支付）。 |
| POST | `/api/bundles/orders` | 预留下单。入参 `{ bundleId, buyerId, channel }`，生成 `BundleOrder`（含 `commissionCents`）；本期返回 `status:'created'` + 未开通提示。 |
| GET | `/api/creators/ledger?authorId=` | 预留结算账。返回 `CreatorLedger[]`。 |

> 前端「分享」走 Tauri `invoke('share_bundle', {...})`（Rust 新增 §3.4），Rust 直接 POST `/api/bundles`；官网纯浏览器侧走 `fetch`。

---

## 6. 数据库迁移（`website/server/utils/db.ts`）

### 6.1 既有 bundle 表新增列（增量 `ALTER TABLE`，幂等补列）

```sql
-- bundles：社区化 + 计费 + 审核
ALTER TABLE bundles ADD COLUMN source TEXT DEFAULT 'official';
ALTER TABLE bundles ADD COLUMN author TEXT;
ALTER TABLE bundles ADD COLUMN author_id TEXT;
ALTER TABLE bundles ADD COLUMN share_time TEXT;
ALTER TABLE bundles ADD COLUMN base_bundle_id TEXT;
ALTER TABLE bundles ADD COLUMN review_status TEXT DEFAULT 'reviewed';
ALTER TABLE bundles ADD COLUMN package_price_cents INTEGER;
ALTER TABLE bundles ADD COLUMN commission_rate REAL;
ALTER TABLE bundles ADD COLUMN pay_channel TEXT;

-- bundle_plugins：简介 + 计费
ALTER TABLE bundle_plugins ADD COLUMN description TEXT;
ALTER TABLE bundle_plugins ADD COLUMN billing TEXT DEFAULT 'free';
ALTER TABLE bundle_plugins ADD COLUMN price_cents INTEGER;

-- bundle_mcp_servers：简介 + 计费 + 周期
ALTER TABLE bundle_mcp_servers ADD COLUMN brief TEXT;
ALTER TABLE bundle_mcp_servers ADD COLUMN billing TEXT DEFAULT 'free';
ALTER TABLE bundle_mcp_servers ADD COLUMN price_cents INTEGER;
ALTER TABLE bundle_mcp_servers ADD COLUMN billing_cycle TEXT;

-- bundle_skills：简介 + 计费
ALTER TABLE bundle_skills ADD COLUMN description TEXT;
ALTER TABLE bundle_skills ADD COLUMN billing TEXT DEFAULT 'free';
```

> SQLite `ALTER TABLE ADD COLUMN` 非幂等（列已存在会报错），需逐条 `try/catch`（「duplicate column name」忽略），仿现有 `CREATE TABLE IF NOT EXISTS` 风格；首启自动补列。

### 6.2 新增订单/结算表（预留，本期只建表）

```sql
CREATE TABLE IF NOT EXISTS bundle_orders (
  order_id TEXT PRIMARY KEY,
  bundle_id TEXT, buyer_id TEXT, author_id TEXT,
  gross_cents INTEGER, commission_cents INTEGER, author_cents INTEGER,
  status TEXT DEFAULT 'created', created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_bundle ON bundle_orders(bundle_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON bundle_orders(buyer_id);

CREATE TABLE IF NOT EXISTS creator_ledgers (
  author_id TEXT, period TEXT,
  gross_cents INTEGER, commission_cents INTEGER, settled_cents INTEGER,
  status TEXT DEFAULT 'open',
  PRIMARY KEY (author_id, period)
);
```

### 6.3 `buildBundle` / `seedBundles` 适配

- `seedBundles` 灌官方包时显式写 `source='official'`、`review_status='reviewed'`，计费列缺省（free/null）。
- `buildBundle` 输出补 §5.1/§1.1 可选字段；计费缺省 `'free'`/`null`，保证老客户端解析不报错。

---

## 7. 阶段拆分与实施顺序

| 阶段 | 范围 | 依赖 | 说明 |
|---|---|---|---|
| **P1 详情增强** | §1 数据结构 + `buildBundle` 简介/计费 + 详情页简介 & 计费角标 | 无 | 纯展示，最低风险，先上。 |
| **P2 检索 & 置顶** | §3 组合包/已安装检索 + §4 市场可更新置顶强化 | P1 | 前端本地逻辑，`/api/bundles?deep=1` 可选增强。 |
| **P3 独立安装** | §2 单项安装（`/api/bundles/items/*` + Rust `install_bundle_item` + 前端独立按钮） | P1 | 不改整包事务，增量能力。 |
| **P4 社区化** | §5 搭配器 + 分享 + 审核 + §6 DB 迁移 | P1 | 需登录态、`shares` 审计。 |
| **P5 商业化预留** | §5.3/§5.4 订单/结算表 + pricing/order/ledger 接口占位 + 卡片付费锁 | P4 | 数据结构 + 接口占位，**资金流本期不接**，预留抽成结算。 |

每阶段独立可发版（版本号递增）。P1–P3 不影响现有「一键整包安装」链路；P4 起需登录（复用现有 `users` 登录接口）；P5 全程「预留不触发」。

---

## 8. 前端落点清单（改动文件速查）

| 文件 | 改动 |
|---|---|
| `src-vue/src/types/index.ts` | 新增 `description/billing/priceCents/brief/billingCycle`（插件/MCP/Skill）；`BundleDef.source/author/authorId/shareTime/baseBundleId/paidCount/reviewStatus/pricing`；`BundlePricing/BundleOrder/CreatorLedger`；`MarketPluginView`；`BundleItemInstallRequest/Result`。 |
| `src-vue/src/api/bundles.ts` | `listBundles` 透传新字段；新增 `installBundleItem(req)`（Tauri `install_bundle_item`）、`shareBundle(payload)`（Tauri `share_bundle`）、`listBundleItemStatus(bundleId)`。 |
| `src-vue/src/components/PluginTable.vue` | 组合包 Tab 加搜索框 + `bundleSearch`/`filteredBundles`；已安装 Tab 加搜索框 + `searchedPlugins`；市场 `MarketPluginView` 组装 + `marketOnlyUpdate` 开关；详情页每项加简介/计费角标 + 独立安装按钮；组合包 Tab 加「+ 自建组合包」入口。 |
| `src-tauri/src/bundle.rs` | 新增 `install_bundle_item`、`share_bundle` 命令（share 直接 POST `/api/bundles`）。 |
| `website/server/utils/bundles.ts` | `buildBundle` 输出新字段；`seedBundles` 补默认值。 |
| `website/server/utils/db.ts` | §6.1 补列（try/catch 幂等）+ §6.2 建订单/结算表。 |
| `website/server/api/bundles/index.get.ts` | `q` 加 `deep=1` 联表检索；`scope`/`review` 过滤。 |
| 新增路由 | `api/bundles/items/install.post.ts`、`api/bundles/items/status.get.ts`、`api/bundles/index.post.ts`（分享）、`api/bundles/review.post.ts`、`api/bundles/pricing.post.ts`、`api/bundles/orders.post.ts`、`api/creators/ledger.get.ts`。 |

> i18n：`src-vue/src/i18n/zh.ts` / `en.ts` 新增 `bundle.billingFree/paid/comingSoon`、`bundle.addItemInstall/installed/update`、`market.onlyUpdate`、`bundle.buildOwn/share/shareSuccess/reviewPending` 等键。

