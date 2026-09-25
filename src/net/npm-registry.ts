/**
 * 查 npm 上的最新版本（用来给"已装插件"标可更新）。
 *
 * 为什么走 npm registry 而不是 GitHub：registry 没有配额限制，也不需要 token，
 * 一条 https://registry.npmjs.org/<包名>/latest 就够 —— 只取 version 字段。
 *
 * 结果在内存里缓存 30 分钟：市场页每翻一页都重查一遍既慢又没必要。
 */

import { log } from "../util/log.ts";

export const UPDATE_CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
/** 同时开几个请求：14 个包并行没问题，但别把 registry 当压力测试。 */
const CONCURRENCY = 6;

export interface UpdateInfo {
  /** 本机装的版本（从 profile 依赖清单里抠出来的，可能带 ^ ~ 前缀）。 */
  current: string;
  /** registry 上的最新版本。 */
  latest: string;
  outdated: boolean;
}

const cache = new Map<string, { version: string | null; at: number }>();

/** 清空内存缓存（测试与手动刷新用）。 */
export function clearUpdateCache(): void {
  cache.clear();
}

/**
 * 从依赖清单里的版本串里抠出可比较的版本号。
 * "^1.2.3" → "1.2.3"；"1.2" → "1.2"；"file:../x"、"link:"、"workspace:*" → null（没法比）。
 */
export function parseSemver(spec: string | undefined | null): string | null {
  if (typeof spec !== "string") return null;
  const s = spec.trim();
  if (!s) return null;
  if (/^(file|link|workspace|portal|npm):/i.test(s) || s.startsWith(".") || s.startsWith("/")) {
    return null;
  }
  const m = s.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return [m[1], m[2] ?? "0", m[3] ?? "0"].join(".") + (m[4] ? `-${m[4]}` : "");
}

function split(v: string): { nums: number[]; pre: string } {
  const clean = v.trim().replace(/^v/i, "");
  const [main, pre = ""] = clean.split("-");
  const nums = (main ?? "").split(".").map((x) => Number.parseInt(x, 10) || 0);
  while (nums.length < 3) nums.push(0);
  return { nums: nums.slice(0, 3), pre };
}

/** 版本比较：a>b 返回 1，相等 0，小于 -1（预发布版小于正式版）。 */
export function compareSemver(a: string, b: string): number {
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < 3; i++) {
    if (A.nums[i]! !== B.nums[i]!) return A.nums[i]! > B.nums[i]! ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1; // 正式版 > 预发布
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}

/** 该不该提示更新：本机版本解析不出来就不提示（宁可少提示，也不误报）。 */
export function isOutdated(current: string | null, latest: string | null): boolean {
  if (!current || !latest) return false;
  try {
    return compareSemver(latest, current) > 0;
  } catch {
    return false;
  }
}

/** 问 registry 要一个包的最新版本；失败统一返回 null（调用方按"没查到"处理）。 */
export async function fetchLatestVersion(
  pkg: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const hit = cache.get(pkg);
  const now = Date.now();
  if (hit && now - hit.at < UPDATE_CACHE_TTL_MS) return hit.version;
  try {
    const res = await fetcher(
      `https://registry.npmjs.org/${pkg.replace("/", "%2f")}/latest`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { version?: unknown };
    const version = typeof body.version === "string" ? body.version : null;
    cache.set(pkg, { version, at: now });
    return version;
  } catch (e) {
    // 失败不写缓存：下次还该重试（网络抖动不该让人 30 分钟看不到更新）
    log.warn("npm", `查 ${pkg} 最新版本失败：${(e as Error).message}`);
    return null;
  }
}

export interface CheckUpdatesResult {
  updates: Record<string, UpdateInfo>;
  checked: number;
  failed: string[];
}

/**
 * 批量查更新。只查"本机装了、且市场目录里有"的包 —— 市场里没有的（本体自带基座包等）
 * 查了也没地方显示。
 */
export async function checkUpdates(
  installed: Record<string, string>,
  names: string[],
  fetcher: typeof fetch = fetch,
): Promise<CheckUpdatesResult> {
  const targets = [...new Set(names)].filter((n) => n in installed);
  const updates: Record<string, UpdateInfo> = {};
  const failed: string[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const name = targets[cursor++]!;
      const current = parseSemver(installed[name]);
      const latest = await fetchLatestVersion(name, fetcher);
      if (latest === null) {
        failed.push(name);
        continue;
      }
      if (!current) continue; // 版本串比不了（file:/workspace:）就不提示
      updates[name] = { current, latest, outdated: isOutdated(current, latest) };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, Math.max(targets.length, 1)) }, () => worker()),
  );
  return { updates, checked: targets.length, failed };
}
