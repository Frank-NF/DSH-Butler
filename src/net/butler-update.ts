/**
 * 管家自己的更新检查。
 *
 * 策略（详见 docs/UPDATE-STRATEGY.md）：官网放一份 version.json 当"版本清单"，
 * 客户端定期读它、比版本号，有新版本就提示并给出下载入口 —— **不静默自我替换**。
 * 理由：这是未签名程序，运行中替换自己的 exe 会被文件锁拦住，出了问题用户也没有退路。
 * 让用户自己下载、自己装，一步确认，比"悄悄换个二进制"安全得多。
 */

import { log } from "../util/log.ts";
import { compareSemver } from "./npm-registry.ts";
import { butlerRoot, p } from "../util/paths.ts";
import { isDir } from "../host/fs.ts";

export const BUTLER_UPDATE_URL = "https://dsh.huilinsh.cn/butler/version.json";
export const BUTLER_UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

export interface ButlerRelease {
  version: string;
  publishedAt?: string;
  notes?: string;
  /** 安装包地址（官网静态文件）。 */
  url?: string;
  sha256?: string;
  minVersion?: string;
}

export interface ButlerUpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  release: ButlerRelease | null;
  checkedAt: string;
  /** 查失败时给一句人话（有缓存就不填）。 */
  error?: string;
}

function cachePath(root: string = butlerRoot()): string {
  return p(root, "cache", "butler-update.json");
}

export function readButlerUpdateCache(root?: string): ButlerUpdateInfo | null {
  try {
    const raw = Deno.readTextFileSync(cachePath(root));
    const parsed = JSON.parse(raw) as ButlerUpdateInfo;
    if (!parsed || typeof parsed.checkedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeButlerUpdateCache(info: ButlerUpdateInfo, root?: string): void {
  try {
    const file = cachePath(root);
    const dir = p(file, "..");
    if (!isDir(dir)) Deno.mkdirSync(dir, { recursive: true });
    Deno.writeTextFileSync(file, JSON.stringify(info));
  } catch (e) {
    log.warn("update", `写管家更新缓存失败：${(e as Error).message}`);
  }
}

/** 解析版本清单（字段缺失一律当没有，绝不因为清单写坏了就报更新）。 */
export function parseRelease(raw: unknown): ButlerRelease | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const version = typeof o.version === "string" ? o.version.trim() : "";
  if (!version) return null;
  return {
    version,
    publishedAt: typeof o.publishedAt === "string" ? o.publishedAt : undefined,
    notes: typeof o.notes === "string" ? o.notes : undefined,
    url: typeof o.url === "string" ? o.url : undefined,
    sha256: typeof o.sha256 === "string" ? o.sha256 : undefined,
    minVersion: typeof o.minVersion === "string" ? o.minVersion : undefined,
  };
}

export interface CheckButlerUpdateOptions {
  current: string;
  force?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  root?: string;
}

/** 查管家更新。失败不影响主流程：有缓存用缓存，没有就当"没查到"。 */
export async function checkButlerUpdate(
  opts: CheckButlerUpdateOptions,
): Promise<ButlerUpdateInfo> {
  const nowMs = (opts.now ?? Date.now)();
  const cached = readButlerUpdateCache(opts.root);
  if (cached && !opts.force && nowMs - Date.parse(cached.checkedAt) < BUTLER_UPDATE_TTL_MS) {
    return { ...cached, current: opts.current };
  }
  try {
    const res = await (opts.fetcher ?? fetch)(BUTLER_UPDATE_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "dsh-butler" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = parseRelease(await res.json());
    if (!release) throw new Error("版本清单里没有 version 字段");
    const info: ButlerUpdateInfo = {
      current: opts.current,
      latest: release.version,
      available: compareSemver(release.version, opts.current) > 0,
      release,
      checkedAt: new Date(nowMs).toISOString(),
    };
    writeButlerUpdateCache(info, opts.root);
    return info;
  } catch (e) {
    const msg = (e as Error).message || "未知错误";
    if (cached) return { ...cached, current: opts.current, error: msg };
    return {
      current: opts.current,
      latest: null,
      available: false,
      release: null,
      checkedAt: new Date(nowMs).toISOString(),
      error: msg,
    };
  }
}
