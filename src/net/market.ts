/**
 * 插件市场目录（把线上市场接进管家）。
 *
 * 数据源：https://dsh.huilinsh.cn/plugins.json —— 由 awesome-dsh-plugin 汇总的目录
 * （2000+ 条，含分类的中英名、npm 包名、star、下载量、以及官方给的安装命令原文）。
 * 这个文件 1.8MB 左右，不适合每次开页面都拉一遍，所以：
 *
 *   - 拉到本地缓存 ~/.dsh-butler/cache/market-catalog.json，默认 6 小时有效；
 *   - 目录在内存里留着，界面的搜索/筛选/分页全部在服务端做（纯函数，好测）；
 *   - 网断了或站点挂了 → 退回上次的缓存并标明"这是几点的数据"，绝不让页面空白。
 *
 * 为什么不用 /api/plugins/list：那个只有几条精选（带签名，给别的用途），
 * 市场要的是全量目录。
 */

import { log } from "../util/log.ts";
import { butlerRoot, p } from "../util/paths.ts";
import { isDir } from "../host/fs.ts";

export const MARKET_CATALOG_URL = "https://dsh.huilinsh.cn/plugins.json";
export const MARKET_SITE = "https://awesome-dsh-plugin.com";

/** 缓存有效期：6 小时。目录更新很慢（上游按天），没必要勤拉。 */
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25_000;
/** 目录体积上限：防止上游被换成一个巨大文件把我们拖死。 */
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

export interface MarketCategory {
  en: string;
  zh: string;
}

export interface MarketPlugin {
  name: string;
  owner: string;
  url: string;
  page: string;
  category: string;
  npm: string;
  stars: number;
  downloads: number;
  /** 上游给的原始安装命令（只在界面上当提示显示，不执行它 —— 我们走自己的安装动作）。 */
  install: string;
  added: string;
  description: { en: string; zh: string };
}

export interface MarketCatalog {
  name: string;
  source: string;
  updated: string;
  fetchedAt: string;
  count: number;
  categories: Record<string, MarketCategory>;
  plugins: MarketPlugin[];
}

export interface CatalogLoadOk {
  ok: true;
  catalog: MarketCatalog;
  /** true = 用的是本地缓存（没联网或还没到刷新时间）。 */
  cached: boolean;
  /** 缓存文件的时间戳（来自缓存时给出，界面要显示"数据截至几点"）。 */
  cachedAt?: string;
  note?: string;
}
export interface CatalogLoadFail {
  ok: false;
  error: string;
  stale?: MarketCatalog;
  cachedAt?: string;
}
export type CatalogLoadResult = CatalogLoadOk | CatalogLoadFail;

export type MarketSort = "stars" | "downloads" | "new" | "name";
export type MarketStateFilter = "all" | "installed" | "missing" | "outdated";

export interface MarketQuery {
  q?: string;
  category?: string;
  sort?: MarketSort;
  state?: MarketStateFilter;
  page?: number;
  pageSize?: number;
}

/** 目录里的一条，接上本机事实之后的形态。 */
export interface MarketEntry extends MarketPlugin {
  /** 本机 profile 依赖清单里的版本，没装就是 null。 */
  installedVersion: string | null;
  installed: boolean;
  /** registry 上的最新版本（没查或查不到就是 null）。 */
  latestVersion: string | null;
  /** 本机版本落后于 registry —— 界面上的"可更新"。 */
  outdated: boolean;
}

export interface MarketFacet {
  key: string;
  label: string;
  count: number;
}

export interface MarketPage {
  total: number;
  matched: number;
  page: number;
  pageSize: number;
  pages: number;
  items: MarketEntry[];
  categories: MarketFacet[];
  stats: { total: number; matched: number; installed: number; outdated: number };
}

/** 缓存文件路径。 */
export function catalogCachePath(root: string = butlerRoot()): string {
  return p(root, "cache", "market-catalog.json");
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 把上游 JSON 规整成我们自己的形状（字段缺了就补空，绝不抛）。 */
export function normalizeCatalog(raw: unknown, fetchedAt: string): MarketCatalog {
  const o = (raw ?? {}) as Record<string, unknown>;
  const cats: Record<string, MarketCategory> = {};
  const rawCats = (o.categories ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(rawCats)) {
    const c = (val ?? {}) as Record<string, unknown>;
    cats[key] = { en: asString(c.en), zh: asString(c.zh) || asString(c.en) || key };
  }
  const list = Array.isArray(o.plugins) ? o.plugins : [];
  const plugins: MarketPlugin[] = [];
  for (const it of list) {
    const e = (it ?? {}) as Record<string, unknown>;
    const name = asString(e.name);
    if (!name) continue;
    const desc = (e.description ?? {}) as Record<string, unknown>;
    plugins.push({
      name,
      owner: asString(e.owner),
      url: asString(e.url),
      page: asString(e.page),
      category: asString(e.category),
      npm: asString(e.npm) || name,
      stars: asNumber(e.stars),
      downloads: asNumber(e.downloads),
      install: asString(e.install),
      added: asString(e.added),
      description: { en: asString(desc.en), zh: asString(desc.zh) || asString(desc.en) },
    });
  }
  return {
    name: asString(o.name) || "awesome-dsh-plugin",
    source: asString(o.source),
    updated: asString(o.updated),
    fetchedAt,
    count: asNumber(o.count) || plugins.length,
    categories: cats,
    plugins,
  };
}

/** 读缓存（读不到或坏了都返回 null，不抛）。 */
export function readCache(path: string): MarketCatalog | null {
  try {
    const raw = Deno.readTextFileSync(path);
    const parsed = JSON.parse(raw) as { catalog?: unknown; fetchedAt?: unknown };
    if (!parsed || !parsed.catalog) return null;
    const cat = normalizeCatalog(parsed.catalog, asString(parsed.fetchedAt));
    if (!cat.plugins.length) return null;
    return cat;
  } catch {
    return null;
  }
}

/** 写缓存（失败只记日志：缓存坏了不该影响这次使用）。 */
export function writeCache(path: string, catalog: MarketCatalog): void {
  try {
    const dir = p(path, "..");
    if (!isDir(dir)) Deno.mkdirSync(dir, { recursive: true });
    Deno.writeTextFileSync(
      path,
      JSON.stringify({ fetchedAt: catalog.fetchedAt, catalog }),
    );
  } catch (e) {
    log.warn("market", `写目录缓存失败：${(e as Error).message}`);
  }
}

/** 拉一次线上目录。任何异常都归一成一句人话。 */
export async function fetchCatalog(
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<MarketCatalog> {
  const res = await fetcher(MARKET_CATALOG_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": "dsh-butler" },
  });
  if (!res.ok) throw new Error(`市场目录返回 HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_CATALOG_BYTES) {
    throw new Error(`市场目录异常大（${Math.round(text.length / 1048576)}MB），先不采信`);
  }
  const catalog = normalizeCatalog(JSON.parse(text), now().toISOString());
  if (!catalog.plugins.length) throw new Error("市场目录里没有任何插件");
  return catalog;
}

export interface LoadCatalogOptions {
  force?: boolean;
  fetcher?: typeof fetch;
  cachePath?: string;
  now?: () => number;
}

/**
 * 取目录：能联网就刷新，刷新失败就退回缓存，缓存也没有才报错。
 * 缓存没到期且不是 force 时直接用缓存（省流量也快）。
 */
export async function loadCatalog(opts: LoadCatalogOptions = {}): Promise<CatalogLoadResult> {
  const path = opts.cachePath ?? catalogCachePath();
  const nowMs = (opts.now ?? Date.now)();
  const cached = readCache(path);
  const fresh = cached ? nowMs - Date.parse(cached.fetchedAt) < CATALOG_TTL_MS : false;
  if (cached && fresh && !opts.force) {
    return { ok: true, catalog: cached, cached: true, cachedAt: cached.fetchedAt };
  }
  try {
    const catalog = await fetchCatalog(opts.fetcher ?? fetch);
    writeCache(path, catalog);
    return { ok: true, catalog, cached: false };
  } catch (e) {
    const msg = (e as Error).message || "未知错误";
    if (cached) {
      return {
        ok: true,
        catalog: cached,
        cached: true,
        cachedAt: cached.fetchedAt,
        note: `这次没能连上市场（${msg}），显示的是本地缓存的目录`,
      };
    }
    return { ok: false, error: `拉取市场目录失败：${msg}` };
  }
}

/** 在目录里搜/筛/排/分页。纯函数，便于测试。 */
export function queryCatalog(
  catalog: MarketCatalog,
  query: MarketQuery,
  installed: Record<string, string> = {},
  updates: Record<string, { current: string; latest: string; outdated: boolean }> = {},
): MarketPage {
  const pageSize = Math.min(Math.max(query.pageSize ?? 48, 1), 200);
  const wantInstalled = query.state === "installed";
  const wantMissing = query.state === "missing";
  const wantOutdated = query.state === "outdated";

  const entries: MarketEntry[] = catalog.plugins.map((it) => {
    const ver = installed[it.npm] ?? installed[it.name] ?? null;
    const up = updates[it.npm] ?? updates[it.name] ?? null;
    return {
      ...it,
      installedVersion: ver,
      installed: ver !== null,
      latestVersion: up?.latest ?? null,
      outdated: up?.outdated ?? false,
    };
  });

  // 分类维度：不管当前筛了哪个分类，都把整个目录的分类计数算出来（界面上的 chips 要用）
  const catCount = new Map<string, number>();
  for (const it of entries) {
    catCount.set(it.category, (catCount.get(it.category) ?? 0) + 1);
  }
  const categories: MarketFacet[] = [...catCount.entries()]
    .map(([key, count]) => ({
      key,
      label: catalog.categories[key]?.zh ?? catalog.categories[key]?.en ?? key,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const q = (query.q ?? "").trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  let matched = entries.filter((it) => {
    if (query.category && it.category !== query.category) return false;
    if (wantInstalled && !it.installed) return false;
    if (wantMissing && it.installed) return false;
    if (wantOutdated && !it.outdated) return false;
    if (terms.length) {
      const hay = `${it.name} ${it.npm} ${it.owner} ${it.description.zh} ${it.description.en}`
        .toLowerCase();
      for (const t of terms) if (!hay.includes(t)) return false;
    }
    return true;
  });

  const sort = query.sort ?? "downloads";
  matched = matched.slice().sort((a, b) => {
    if (sort === "stars") return b.stars - a.stars || a.name.localeCompare(b.name);
    if (sort === "new") {
      return (b.added || "").localeCompare(a.added || "") || a.name.localeCompare(b.name);
    }
    if (sort === "name") return a.name.localeCompare(b.name);
    return b.downloads - a.downloads || a.name.localeCompare(b.name);
  });

  const total = entries.length;
  const installedCount = entries.filter((it) => it.installed).length;
  const outdatedCount = entries.filter((it) => it.outdated).length;
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);
  const items = matched.slice((page - 1) * pageSize, page * pageSize);

  return {
    total,
    matched: matched.length,
    page,
    pageSize,
    pages,
    items,
    categories,
    stats: { total, matched: matched.length, installed: installedCount, outdated: outdatedCount },
  };
}
