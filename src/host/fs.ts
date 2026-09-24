/**
 * 文件操作 —— 原子写与隔离区。
 *
 * 铁律：
 * 1) 原子写 = 同盘 temp + rename。跨盘禁止 rename，必须先复制再改名。
 * 2) 隔离区的操作永远是「只移动、不删除」，并留清单可整体还原。
 * 3) 任何移动前都要校验同盘，否则会静默失败（最恶心的一类 bug）。
 */

import { basename, dirname, p, sameVolume, stampOf, volumeOf } from "../util/paths.ts";
import { log } from "../util/log.ts";

export interface MoveRecord {
  from: string;
  to: string;
  ok: boolean;
  error?: string;
}

export interface QuarantineManifest {
  stamp: string;
  createdAt: string;
  /** 隔离区根目录（与本体同盘同级）。 */
  dir: string;
  /** 被移走的东西的原始位置，用于整体还原。 */
  items: Array<{ original: string; quarantined: string; reason: string }>;
}

export function pathExists(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function isDir(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
}

export function isFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/** 原子写文本：同目录 temp → rename。失败时清理 temp。 */
export function writeAtomic(path: string, content: string): void {
  const dir = dirname(path);
  Deno.mkdirSync(dir, { recursive: true });
  const tmp = p(dir, `.${basename(path)}.tmp-${crypto.randomUUID().slice(0, 8)}`);
  try {
    Deno.writeTextFileSync(tmp, content);
    Deno.renameSync(tmp, path);
  } catch (e) {
    try {
      Deno.removeSync(tmp);
    } catch { /* ignore */ }
    throw e;
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeAtomic(path, JSON.stringify(value, null, 2) + "\n");
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as T;
  } catch {
    return null;
  }
}

/**
 * 移动（跨盘自动降级为复制+删除）。
 *
 * 为什么不用 rename 直接上：Windows 上跨盘 rename 抛 winerror=17，
 * 而历史上这个错误被静默吞掉过，表现为"清理看起来做了、其实什么都没做"。
 */
export function moveSafe(from: string, to: string): MoveRecord {
  const dir = dirname(to);
  try {
    Deno.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { from, to, ok: false, error: `无法创建目标目录：${(e as Error).message}` };
  }

  const crossVolume = !sameVolume(from, to);
  try {
    if (crossVolume) {
      log.debug("fs", `跨盘移动（${volumeOf(from)} → ${volumeOf(to)}），改用复制：${from}`);
      copyRecursive(from, to);
      removeRecursive(from);
    } else {
      Deno.renameSync(from, to);
    }
    return { from, to, ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    // rename 失败时再尝试复制（某些占用场景）
    if (!crossVolume) {
      try {
        copyRecursive(from, to);
        removeRecursive(from);
        return { from, to, ok: true };
      } catch (e2) {
        return { from, to, ok: false, error: `${msg} / 复制亦失败：${(e2 as Error).message}` };
      }
    }
    return { from, to, ok: false, error: msg };
  }
}

export function copyRecursive(from: string, to: string): void {
  const st = Deno.lstatSync(from);
  if (st.isDirectory) {
    Deno.mkdirSync(to, { recursive: true });
    for (const entry of Deno.readDirSync(from)) {
      copyRecursive(p(from, entry.name), p(to, entry.name));
    }
  } else if (st.isSymlink) {
    // 符号链接按文件复制，避免跟随链接把外面整个搬进来
    Deno.copyFileSync(from, to);
  } else {
    Deno.copyFileSync(from, to);
  }
}

export function removeRecursive(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch { /* 不存在即视为已删除 */ }
}

/**
 * 把一批路径移入隔离区。
 * @param dshSourceRoot DSH 源码树根（用于计算同盘隔离区位置）
 */
export function quarantine(
  dshSourceRoot: string,
  targets: Array<{ path: string; reason: string }>,
  destRoot?: string,
): QuarantineManifest {
  const stamp = stampOf();
  const dir = destRoot ?? p(
    dirname(dshSourceRoot),
    "dsh-quarantine",
    stamp,
  );

  const manifest: QuarantineManifest = {
    stamp,
    createdAt: new Date().toISOString(),
    dir,
    items: [],
  };

  for (const t of targets) {
    if (!pathExists(t.path)) continue;
    const dest = p(dir, basename(t.path));
    const r = moveSafe(t.path, dest);
    if (r.ok) {
      manifest.items.push({ original: t.path, quarantined: dest, reason: t.reason });
      log.info("fs", `已隔离：${t.path} → ${dest}（${t.reason}）`);
    } else {
      log.warn("fs", `隔离失败：${t.path} — ${r.error}`);
    }
  }

  if (manifest.items.length > 0) {
    try {
      Deno.writeTextFileSync(
        p(dir, "MANIFEST.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
    } catch (e) {
      log.warn("fs", `隔离清单写入失败：${(e as Error).message}`);
    }
  }
  return manifest;
}

/** 递归列举目录（只返回文件与目录名，不跟随符号链接）。 */
export function listDir(
  path: string,
): Array<{ name: string; dir: boolean; size: number; mtime: Date | null }> {
  const out: Array<{ name: string; dir: boolean; size: number; mtime: Date | null }> = [];
  try {
    for (const e of Deno.readDirSync(path)) {
      let size = 0;
      let mtime: Date | null = null;
      try {
        const st = Deno.statSync(p(path, e.name));
        size = st.size;
        mtime = st.mtime;
      } catch { /* ignore */ }
      out.push({ name: e.name, dir: e.isDirectory, size, mtime });
    }
  } catch { /* ignore */ }
  return out;
}

export interface DirSizeResult {
  bytes: number;
  files: number;
  /** false = 到达预算上限就停了，bytes 只代表"至少这么多"，界面要显示成「≥ x」。 */
  complete: boolean;
}

const sizeCache = new Map<string, { at: number; r: DirSizeResult }>();
const warming = new Set<string>();
const SIZE_TTL_MS = 5 * 60_000;

/**
 * 目录体积（带时间预算 + 结果缓存 + 后台补算）。
 *
 * 【为什么必须有时间预算】
 * 本机 profile/.updater_backups 里有 20671 个文件，逐个 stat 要 2663 ms（实测）——
 * 而它在运行状态里只是一个提示条目。界面每次刷新都付这个代价，体验直接废掉。
 *
 * 【为什么要后台补算】
 * 只加预算会引出新毛病：每次都从头走、又只走到一半，数字永远停在"至少 20 MB"，
 * 既不收敛、又每次都白花时间。所以这里的策略是：
 *   有完整缓存 → 直接给准确值；
 *   没有 → 先用预算内的部分结果顶上（标记 complete=false），同时把一个
 *          【异步分片】的完整统计放到后台，算完写入缓存。下一次刷新就是准确值。
 * 后台统计每 400 个条目让出一次事件循环 —— 同步走完 2.7 秒会把界面冻住。
 */
export function dirSizeBudgeted(
  path: string,
  budgetMs = 250,
  maxEntries = 20_000,
): DirSizeResult {
  const hit = sizeCache.get(path);
  if (hit && Date.now() - hit.at < SIZE_TTL_MS) return hit.r;

  // 让后台把完整结果算出来（同一个目录同时只有一个在算）
  warmDirSize(path);

  const deadline = Date.now() + budgetMs;
  let bytes = 0;
  let files = 0;
  let complete = true;

  const walk = (dir: string, depth: number): void => {
    if (!complete) return;
    if (depth > 8) return;
    if (Date.now() > deadline || files > maxEntries) {
      complete = false;
      return;
    }
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      return;
    }
    for (const e of entries) {
      if (Date.now() > deadline || files > maxEntries) {
        complete = false;
        return;
      }
      const full = p(dir, e.name);
      if (e.isDirectory) {
        walk(full, depth + 1);
      } else {
        files++;
        try {
          // 用 lstat 而不是 stat：备份目录里可能有符号链接，
          // 跟随链接去 stat 会跨到别处，既慢又可能算出不属于这里的体积。
          bytes += Deno.lstatSync(full).size;
        } catch { /* ignore */ }
      }
    }
  };

  walk(path, 0);

  const r: DirSizeResult = { bytes, files, complete };
  // 只有走完整了才缓存 —— 半截结果缓存住会一直显示偏小的数字
  if (complete) sizeCache.set(path, { at: Date.now(), r });
  return r;
}

/** 后台把目录体积算完并写入缓存（不阻塞调用方，出错静默）。 */
function warmDirSize(path: string): void {
  if (warming.has(path)) return;
  warming.add(path);
  // 用 setTimeout(0) 而不是 queueMicrotask：微任务仍会占住事件循环，
  // 必须让出到宏任务队列，界面才有机会重绘。
  setTimeout(() => {
    void (async () => {
      try {
        const r = await walkFullCount(path);
        if (r.complete) sizeCache.set(path, { at: Date.now(), r });
      } catch {
        /* 缓存失败不影响主流程 */
      } finally {
        warming.delete(path);
      }
    })();
  }, 0);
}

/**
 * 异步分片统计：每 400 个条目让出一次事件循环。
 * 整个过程可以跑几秒，但界面始终有响应。
 */
async function walkFullCount(root: string): Promise<DirSizeResult> {
  let bytes = 0;
  let files = 0;
  let processed = 0;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || cur.depth > 8) continue;
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(cur.dir)];
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = p(cur.dir, e.name);
      if (e.isDirectory) stack.push({ dir: full, depth: cur.depth + 1 });
      else {
        files++;
        try {
          bytes += Deno.lstatSync(full).size;
        } catch { /* ignore */ }
      }
      if (++processed % 400 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { bytes, files, complete: true };
}

/** 弃用体积缓存（清理/移动目录之后必须调用）。 */
export function invalidateDirSizeCache(path?: string): void {
  if (path) sizeCache.delete(path);
  else sizeCache.clear();
}

/** 目录占用体积（同步版，带深度与条目上限）。需要可控耗时时改用 dirSizeBudgeted。 */
export function dirSize(path: string, limits = { maxEntries: 20_000, maxDepth: 8 }): number {
  let total = 0;
  let count = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > limits.maxDepth || count > limits.maxEntries) return;
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      return;
    }
    for (const e of entries) {
      if (++count > limits.maxEntries) return;
      const full = p(dir, e.name);
      if (e.isDirectory) walk(full, depth + 1);
      else if (e.isFile) {
        try {
          total += Deno.statSync(full).size;
        } catch { /* ignore */ }
      }
    }
  };
  walk(path, 0);
  return total;
}

/** 探测目录是否可写（真的写一个临时文件再删掉，别信权限位）。 */
export function isWritable(path: string): { writable: boolean; error?: string } {
  const probe = p(path, `.butler-write-probe-${crypto.randomUUID().slice(0, 8)}`);
  try {
    Deno.mkdirSync(path, { recursive: true });
    Deno.writeTextFileSync(probe, "probe");
    Deno.removeSync(probe);
    return { writable: true };
  } catch (e) {
    return { writable: false, error: (e as Error).message };
  }
}

export function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
