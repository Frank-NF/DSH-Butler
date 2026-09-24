/**
 * core 深度清理 —— finishUpdate 第②步的实现。
 *
 * 逐条移植自旧版管家 dsh_core.rs（1.18.x 已在真实机器上验证多轮），
 * 判据、执行顺序、计数语义都不许"顺手优化"——每一条都对应一次真实故障：
 *
 *   ① `.stale-*` 与 `*.tsbuildinfo`：编译缓存骗过 tsc -b 导致 TS6305/TS6059；
 *   ② 孤儿包：上游删包后 git pull 不清 gitignore 的 lib/，rolldown 把僵尸
 *      lib/ 当打包入口 → MISSING_EXPORT（2026-09-23 #47 事故根因）；
 *   ③ 非 HEAD 的未跟踪源文件：tsconfig 的 include 通配符把它们收进编译工程
 *      → 几十条 TS6307/TS6059。
 *
 * 铁律（照旧版继承）：
 *   - 只移动不删除，隔离区落 MANIFEST.json，可整体还原；
 *   - 隔离区必须与源码树【同盘】（quarantineStampDir 已保证）；
 *   - git 清单拿不到时整体保守跳过 ② ③ —— 绝不能把读不到清单
 *     当成"所有未跟踪文件都是残留"；
 *   - 误伤面最小化：仓库根零散文件（pid/yml/log）一律不碰。
 */

import { p, quarantineStampDir, stampOf } from "../../util/paths.ts";
import { moveSafe, pathExists } from "../../host/fs.ts";
import { run } from "../../host/shell.ts";

/** 「会被 tsconfig 通配符收进编译工程」的目录段——历史故障的集中地。 */
const RISKY_SEGMENTS = ["src", "tests", "test", "benchmarks", "__tests__"];

/** 参与编译、或由编译伴生的扩展名（map 是 tsc 产物的影子文件）。 */
const SOURCE_EXTS = ["ts", "tsx", "js", "jsx", "mts", "cts", "css", "map"];

/** 构建产物的常见目录名。一个包目录里只剩这些东西，说明包本身已经不在了。 */
const RESIDUE_NAMES = [
  "lib",
  "node_modules",
  ".typecheck",
  ".dsh-build",
  "dist",
  "tmp",
  "coverage",
];

/**
 * 判断一个「未跟踪且不属于 HEAD」的路径是否危险到需要隔离。
 *
 * 只盯「危险目录 + 源码类扩展名」这一组合，把误伤面压到最小：
 * 仓库根的 pid 文件、临时 yml、日志一律不碰——它们不会进编译工程。
 * 另外单独认领名字里带 `.stale-` 的条目（那是本工具自己留下的残留）。
 */
export function isRiskyPath(rel: string): boolean {
  if (rel.includes(".stale-")) return true;
  if (!rel.split("/").some((s) => RISKY_SEGMENTS.includes(s))) return false;
  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  return SOURCE_EXTS.includes(ext);
}

/** 目录名是否属于「构建残渣」。 */
export function isResidueName(name: string): boolean {
  return RESIDUE_NAMES.includes(name) || name.endsWith(".tsbuildinfo") || name.endsWith(".log");
}

/** 深度清理的结果（如实汇报，不做美化）。 */
export interface CleanReport {
  /** 被隔离的「不属于当前版本」的未跟踪源文件数。 */
  quarantined: number;
  /** 被清掉的历史 `.stale-*` 残留数。 */
  staleRemoved: number;
  /** 被作废的 `*.tsbuildinfo` 数。 */
  tsbuildinfoReset: number;
  /** 被隔离的孤儿包目录数（不清掉它们，构建会被僵尸 lib/ 引爆）。 */
  orphanPackages: number;
  /** 隔离区目录（有内容时才有值）。 */
  quarantineDir: string | null;
  /** 移动失败的条目（让用户知道清理不完整）。 */
  failed: string[];
}

export interface CleanOutcome {
  report: CleanReport;
  /** 逐条人话说明，直接进任务日志。 */
  lines: string[];
}

// ── git 清单（一次拿全，避免逐文件调 git） ─────────────────────────

/**
 * HEAD 里全部被跟踪的路径（NUL 分隔免转义，中文/空格路径原样拿到）。
 * 拿不到返回 null —— 调用方必须据此保守跳过隔离。
 */
export async function headTrackedPaths(root: string): Promise<Set<string> | null> {
  const r = await run("git", ["-C", root, "ls-tree", "-r", "-z", "--name-only", "HEAD"], {
    timeoutMs: 60_000,
    allowNonZero: true,
    scope: "git",
  });
  if (r.code !== 0) return null;
  return new Set(
    r.stdout.split("\0").filter((s) => s.length > 0).map((s) => s.replaceAll("\\", "/")),
  );
}

/** 工作区里未被忽略的未跟踪文件（`-uall` 展开到文件级，只收 `??` 记录）。 */
export async function untrackedPaths(root: string): Promise<string[]> {
  const r = await run("git", ["-C", root, "status", "--porcelain", "-z", "--untracked-files=all"], {
    timeoutMs: 60_000,
    allowNonZero: true,
    scope: "git",
  });
  if (r.code !== 0) return [];
  const out: string[] = [];
  for (const rec of r.stdout.split("\0")) {
    // 记录格式：`XY<空格><path>`；只收未跟踪（`??`）
    if (rec.length < 4 || !rec.startsWith("?? ") || rec[2] !== " ") continue;
    const path = rec.slice(3).replaceAll("\\", "/");
    if (path.length > 0) out.push(path);
  }
  return out;
}

// ── 扫描 ──────────────────────────────────────────────────────────

/**
 * 递归收集仓库内（跳过 node_modules/.git）的两类条目：
 * `*.tsbuildinfo` 编译缓存、以及名字带 `.stale-` 的历史残留（命中即不再深入）。
 */
export function scanCleanTargets(root: string): { tsbuildinfo: string[]; stale: string[] } {
  const tsbuildinfo: string[] = [];
  const stale: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = p(dir, entry.name);
      const rel = full.startsWith(root)
        ? full.slice(root.length).replace(/^[/\\]+/, "").replaceAll("\\", "/")
        : "";
      if (rel.length === 0) continue;
      // `.stale-*`：整棵搬走，不再深入（里面的东西同属残留）
      if (entry.name.includes(".stale-")) {
        stale.push(rel);
        continue;
      }
      if (entry.isDirectory) {
        stack.push(full);
      } else if (entry.name.endsWith(".tsbuildinfo")) {
        tsbuildinfo.push(rel);
      }
    }
  }
  return { tsbuildinfo, stale };
}

/**
 * 判定一个目录是不是「上游已删除、本地只剩残渣」的孤儿包。
 *
 * 三条全中才算（顺序按开销从低到高，宁可漏判不可误判）：
 *   ① 目录内没有 package.json
 *   ② 目录的直接子项全部是已知构建残渣，且至少有一个
 *   ③ git 完全不跟踪该目录下的任何路径（读不到清单时由调用方整体跳过）
 */
export function isOrphanPackage(dir: string, rel: string, tracked: Set<string>): boolean {
  // ① 有包声明 → 是真包，哪怕暂时没内容也不能碰
  if (pathExists(p(dir, "package.json"))) return false;
  // ② 直接子项全是残渣
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch {
    return false;
  }
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (!isResidueName(entry.name)) return false;
  }
  // ③ git 完全不知道这个目录（这条最贵，放最后）
  const prefix = `${rel}/`;
  for (const t of tracked) {
    if (t.startsWith(prefix)) return false;
  }
  return true;
}

/** 递归收集孤儿包目录（命中即不再深入，里面的东西同属残渣）。 */
export function scanOrphanPackages(root: string, tracked: Set<string>): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (!entry.isDirectory) continue;
      const full = p(dir, entry.name);
      const rel = full.startsWith(root)
        ? full.slice(root.length).replace(/^[/\\]+/, "").replaceAll("\\", "/")
        : "";
      if (rel.length === 0) continue;
      if (isOrphanPackage(full, rel, tracked)) {
        out.push(rel);
        continue;
      }
      stack.push(full);
    }
  }
  out.sort();
  return [...new Set(out)];
}

// ── 搬运（只移动不删除，保目录结构） ────────────────────────────────

/**
 * 把 `rel`（仓库相对、正斜杠）整体搬到隔离区，保持原有目录结构
 * —— 回滚时按结构整体搬回即可还原。
 */
function quarantineOne(
  root: string,
  destRoot: string,
  rel: string,
  moved: string[],
  failed: string[],
): void {
  const src = p(root, ...rel.split("/"));
  if (!pathExists(src)) return;
  const dst = p(destRoot, ...rel.split("/"));
  const rec = moveSafe(src, dst);
  if (rec.ok) moved.push(rel);
  else failed.push(`${rel}（${rec.error ?? "未知错误"}）`);
}

// ── 深度清理主流程 ─────────────────────────────────────────────────

/**
 * 深度清理的实际实现 —— 隔离区由调用方给定，便于在临时目录里做端到端测试。
 *
 * 执行顺序与旧版一致：stale/编译缓存 → git 清单 → 孤儿包 → 非 HEAD 残留源文件
 * → 落 MANIFEST。任何一段失败都不抛（如实记入 failed / lines），清理不完整
 * 总比把构建拦死好——真有问题下一步构建会给出明确原因。
 */
export async function deepCleanInto(root: string, destRoot: string): Promise<CleanOutcome> {
  const report: CleanReport = {
    quarantined: 0,
    staleRemoved: 0,
    tsbuildinfoReset: 0,
    orphanPackages: 0,
    quarantineDir: null,
    failed: [],
  };
  const lines: string[] = [];
  const moved: string[] = [];

  // 隔离区先建好：否则后面每个文件都会各自失败一次，
  // 用户看到几百条「移动失败」，而真正的原因只有一个。
  try {
    Deno.mkdirSync(destRoot, { recursive: true });
  } catch (e) {
    report.failed.push(`隔离区不可用：${(e as Error).message}`);
    lines.push(`⚠️ 建不出隔离区 ${destRoot}（${(e as Error).message}）——已跳过清理。`);
    return { report, lines };
  }

  // ── ① 编译缓存 + 历史 `.stale-*` 残留 ────────────────────────────
  const { tsbuildinfo, stale } = scanCleanTargets(root);
  let before = moved.length;
  for (const rel of stale) quarantineOne(root, destRoot, rel, moved, report.failed);
  report.staleRemoved = moved.length - before;
  if (report.staleRemoved > 0) lines.push(`清掉历次留下的残留：${report.staleRemoved} 项`);

  // 作废编译缓存：产物被删/从未生成时，*.tsbuildinfo 会让 tsc -b 误判「已最新」
  // 而跳过 emit，进而报出 TS6305 / TS6059。
  before = moved.length;
  for (const rel of tsbuildinfo) quarantineOne(root, destRoot, rel, moved, report.failed);
  report.tsbuildinfoReset = moved.length - before;
  if (report.tsbuildinfoReset > 0) {
    lines.push(`作废编译缓存：${report.tsbuildinfoReset} 个（下次构建会完整重编，属预期）`);
  }

  // 一次拿全 git 清单：孤儿包与残留文件隔离都要用
  const tracked = await headTrackedPaths(root);
  if (tracked === null) {
    lines.push(
      "⚠️ 读不到 git 的文件清单，已跳过「孤儿包清理」与「残留文件隔离」——" +
        "这两步失败是构建报 MISSING_EXPORT / TS6307 / TS6059 的常见原因。",
    );
  }

  // ── ② 孤儿包：上游已删除、本地只剩构建残渣的目录 ──────────────────
  if (tracked !== null) {
    const orphans = scanOrphanPackages(root, tracked);
    before = moved.length;
    for (const rel of orphans) quarantineOne(root, destRoot, rel, moved, report.failed);
    report.orphanPackages = moved.length - before;
    if (report.orphanPackages > 0) {
      lines.push(
        `清掉上游已删除的孤儿包：${report.orphanPackages} 个（残留的 lib/ 会被当成打包入口，导致构建报 MISSING_EXPORT）`,
      );
      for (const rel of orphans.slice(0, 20)) lines.push(`  · ${rel}`);
      if (orphans.length > 20) lines.push(`  · …其余 ${orphans.length - 20} 个`);
    }
  }

  // ── ③ 不属于当前 HEAD 的未跟踪源文件 ─────────────────────────────
  if (tracked !== null) {
    const risky = [...new Set(await untrackedPaths(root))]
      .filter((rel) => !tracked.has(rel) && isRiskyPath(rel))
      .sort();
    before = moved.length;
    for (const rel of risky) quarantineOne(root, destRoot, rel, moved, report.failed);
    report.quarantined = moved.length - before;
    if (report.quarantined > 0) {
      lines.push(
        `隔离「不属于当前版本」的文件：${report.quarantined} 个（这些文件会让构建报错，已移到隔离区）`,
      );
      for (const rel of risky.slice(0, 20)) lines.push(`  · ${rel}`);
      if (risky.length > 20) lines.push(`  · …其余 ${risky.length - 20} 个`);
    }
  }

  // ── 落清单，让搬运可逆 ────────────────────────────────────────────
  if (moved.length > 0) {
    try {
      Deno.writeTextFileSync(
        p(destRoot, "MANIFEST.json"),
        JSON.stringify(
          {
            reason: "完成更新：清理不属于当前版本的残留文件与编译缓存",
            root,
            movedCount: moved.length,
            moved,
          },
          null,
          2,
        ) + "\n",
      );
      report.quarantineDir = destRoot;
    } catch (e) {
      report.failed.push(`隔离清单写入失败：${(e as Error).message}`);
    }
  }
  if (report.failed.length > 0) {
    lines.push(`⚠️ 有 ${report.failed.length} 项未能移动（不影响继续构建）`);
    for (const f of report.failed.slice(0, 10)) lines.push(`  · ${f}`);
  }
  if (moved.length === 0) lines.push("无需清理：没有发现残留文件或编译缓存");

  return { report, lines };
}

/**
 * 深度清理入口：隔离区自动落在源码树同级的 `dsh-quarantine/<时间戳>/`
 * （同盘 rename 才能成功，见 paths.ts 的铁律注释）。
 */
export async function deepClean(root: string, stamp = stampOf()): Promise<CleanOutcome> {
  return await deepCleanInto(root, quarantineStampDir(root, stamp));
}
