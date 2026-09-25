/**
 * 首屏快照。
 *
 * 为什么单独做：界面一打开就需要"大概怎么样"，但如果每次都跑完整体检，
 * 用户要点开等好几秒。所以这里做一份轻量摘要 + 短 TTL 缓存。
 */

import { collectCoreStatus } from "../domains/core/status.ts";
import { collectRuntimeStatus } from "../domains/runtime/status.ts";
import { checkCoreUpdate, readCoreUpdateCache } from "../net/core-update.ts";
import { loadConfig } from "../domains/state/config.ts";
import { APP_NAME, APP_VERSION, STAGE_LABEL } from "../version.ts";

export interface Overview {
  app: { name: string; version: string; stage: string };
  dsh: {
    installed: boolean;
    sourceRoot: string | null;
    version: string | null;
    headShort: string | null;
    needsFinishUpdate: boolean;
    /** 上游最新版（查 npm dist-tags 得到；查不到就是 null）。 */
    latestVersion: string | null;
    /** 这个最新版来自哪个通道：latest / next / alpha。 */
    latestChannel: string | null;
    /** 本机装的版本落后于上游最新版。 */
    updateAvailable: boolean;
    /** 上次查更新的时间。 */
    updateCheckedAt: string | null;
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

  // 查上游有没有新版本：走缓存（6 小时），失败也不影响概览
  const cfg = loadConfig();
  const coreUpdate = cfg.autoCheckCoreUpdate
    ? await checkCoreUpdate({ installed: core?.version ?? null }).catch(() => null)
    : readCoreUpdateCache();

  const value: Overview = {
    app: { name: APP_NAME, version: APP_VERSION, stage: STAGE_LABEL },
    dsh: {
      installed: Boolean(core?.sourceRoot),
      sourceRoot: core?.sourceRoot ?? null,
      version: core?.version ?? null,
      headShort: core?.git?.headShort ?? null,
      needsFinishUpdate: core?.needsFinishUpdate ?? false,
      latestVersion: coreUpdate?.latest ?? null,
      latestChannel: coreUpdate?.channel ?? null,
      updateAvailable: coreUpdate?.available ?? false,
      updateCheckedAt: coreUpdate?.checkedAt ?? null,
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
