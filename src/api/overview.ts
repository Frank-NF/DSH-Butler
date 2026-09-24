/**
 * 首屏快照。
 *
 * 为什么单独做：界面一打开就需要"大概怎么样"，但如果每次都跑完整体检，
 * 用户要点开等好几秒。所以这里做一份轻量摘要 + 短 TTL 缓存。
 */

import { collectCoreStatus } from "../domains/core/status.ts";
import { collectRuntimeStatus } from "../domains/runtime/status.ts";
import { loadConfig } from "../domains/state/config.ts";
import { APP_NAME, APP_VERSION } from "../version.ts";

export interface Overview {
  app: { name: string; version: string; stage: string };
  dsh: {
    installed: boolean;
    sourceRoot: string | null;
    version: string | null;
    headShort: string | null;
    needsFinishUpdate: boolean;
  };
  runtime: { running: boolean; pid: number | null; port: number | null };
  plugins: { declared: number; bundles: number; active: number };
  cachedAt: string;
}

let cache: { at: number; value: Overview } | null = null;
const TTL_MS = 10_000;

export async function collectOverview(force = false): Promise<Overview> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const config = loadConfig();
  // 并行：两者互不依赖，串行会更慢
  const [core, runtime] = await Promise.all([
    collectCoreStatus().catch(() => null),
    collectRuntimeStatus().catch(() => null),
  ]);

  const value: Overview = {
    app: { name: APP_NAME, version: APP_VERSION, stage: "S1 只读阶段" },
    dsh: {
      installed: Boolean(core?.sourceRoot),
      sourceRoot: core?.sourceRoot ?? null,
      version: core?.version ?? null,
      headShort: core?.git?.headShort ?? null,
      needsFinishUpdate: core?.needsFinishUpdate ?? false,
    },
    runtime: {
      running: runtime?.running ?? false,
      pid: runtime?.pid ?? null,
      port: runtime?.port ?? config.dshPort,
    },
    plugins: {
      declared: core?.plugins?.dependencies.length ?? 0,
      bundles: core?.plugins?.bundles.length ?? 0,
      active: core?.plugins?.active.length ?? 0,
    },
    cachedAt: new Date().toISOString(),
  };

  cache = { at: Date.now(), value };
  return value;
}

export function invalidateOverview(): void {
  cache = null;
}
