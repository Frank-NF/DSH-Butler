/**
 * 本体（DSH）有没有新版本 —— 官方 CLI 连 update 命令都没有，只能自己查。
 *
 * 【为什么不能只看 npm 的 latest】实测（2026-09-25）：
 *   latest = 0.1.5-rc.3，而 next = 0.1.7-rc.2 —— **latest 反而落后**。
 * 本机装的是 0.1.7-rc.1，只读 latest 会得出"没有更新"甚至"该降级"的荒唐结论。
 * 所以三个 tag 全读回来，按版本号取最新的那个，并如实告诉用户它来自哪个通道。
 *
 * 结果缓存 6 小时（内存 + 磁盘），概览页每次刷新都去问一遍既慢又没必要。
 */

import { log } from "../util/log.ts";
import { compareSemver } from "./npm-registry.ts";
import { butlerRoot, p } from "../util/paths.ts";
import { isDir } from "../host/fs.ts";

export const DSH_PKG = "@deepseek-ai/dsh";
export const CORE_UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

export interface CoreUpdateInfo {
  /** 本机装的版本。 */
  installed: string | null;
  /** 上游最新的版本（三个通道里最高的那个）。 */
  latest: string | null;
  /** 这个最新版来自哪个通道：latest / next / alpha。 */
  channel: string | null;
  /** 三个通道各自的版本，界面要如实展示。 */
  tags: Record<string, string>;
  /** installed 落后于 latest。 */
  available: boolean;
  checkedAt: string;
}

function cachePath(root: string = butlerRoot()): string {
  return p(root, "cache", "core-update.json");
}

/** 只读缓存（过期与否由调用方判断）。 */
export function readCoreUpdateCache(root?: string): CoreUpdateInfo | null {
  try {
    const raw = Deno.readTextFileSync(cachePath(root));
    const parsed = JSON.parse(raw) as CoreUpdateInfo;
    if (!parsed || typeof parsed.checkedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCoreUpdateCache(info: CoreUpdateInfo, root?: string): void {
  try {
    const file = cachePath(root);
    const dir = p(file, "..");
    if (!isDir(dir)) Deno.mkdirSync(dir, { recursive: true });
    Deno.writeTextFileSync(file, JSON.stringify(info));
  } catch (e) {
    log.warn("core", `写本体更新缓存失败：${(e as Error).message}`);
  }
}

/** 拉 dist-tags（三个通道）。 */
export async function fetchDistTags(
  fetcher: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const res = await fetcher(`https://registry.npmjs.org/${DSH_PKG.replace("/", "%2f")}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as { "dist-tags"?: Record<string, unknown> };
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(body["dist-tags"] ?? {})) {
    if (typeof v === "string") tags[k] = v;
  }
  return tags;
}

/** 从通道里挑出最新的那个（版本比较，不看通道名）。 */
export function pickNewest(
  tags: Record<string, string>,
): { version: string; channel: string } | null {
  let best: { version: string; channel: string } | null = null;
  for (const [channel, version] of Object.entries(tags)) {
    if (!best) {
      best = { version, channel };
      continue;
    }
    if (compareSemver(version, best.version) > 0) best = { version, channel };
  }
  return best;
}

export interface CheckCoreUpdateOptions {
  installed: string | null;
  force?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  root?: string;
}

/**
 * 查本体更新。失败不影响调用方：有缓存就用缓存（哪怕过期），没有就返回 available=false。
 */
export async function checkCoreUpdate(opts: CheckCoreUpdateOptions): Promise<CoreUpdateInfo> {
  const nowMs = (opts.now ?? Date.now)();
  const cached = readCoreUpdateCache(opts.root);
  if (cached && !opts.force && nowMs - Date.parse(cached.checkedAt) < CORE_UPDATE_TTL_MS) {
    return { ...cached, installed: opts.installed ?? cached.installed };
  }
  try {
    const tags = await fetchDistTags(opts.fetcher ?? fetch);
    const newest = pickNewest(tags);
    const installed = opts.installed ?? null;
    const info: CoreUpdateInfo = {
      installed,
      latest: newest?.version ?? null,
      channel: newest?.channel ?? null,
      tags,
      available: Boolean(
        installed && newest && compareSemver(newest.version, installed) > 0,
      ),
      checkedAt: new Date(nowMs).toISOString(),
    };
    writeCoreUpdateCache(info, opts.root);
    return info;
  } catch (e) {
    log.warn("core", `查本体更新失败：${(e as Error).message}`);
    if (cached) return { ...cached, installed: opts.installed ?? cached.installed };
    return {
      installed: opts.installed ?? null,
      latest: null,
      channel: null,
      tags: {},
      available: false,
      checkedAt: new Date(nowMs).toISOString(),
    };
  }
}
