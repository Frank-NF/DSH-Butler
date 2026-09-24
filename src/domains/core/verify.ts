/**
 * core.verify —— 本体完整性校验（只读）。
 *
 * 定位（方案 §6.1 完整性校验）：
 *   ① 关键产物哈希清单      → 复用 core.status 里的官方算法（core/official.ts）
 *   ② 构建记录 ↔ HEAD 一致  → 复用 collectCoreStatus（AC-C1 的结论入口）
 *   ③ 缺失文件检测          → 本文件：HEAD 有、磁盘无的包（真正的缺失）
 *   ④ 非 HEAD 残留文件检测   → 本文件：僵尸 lib/（AC-C4，必须与 ③ 分开列出）
 *
 * 【AC-C4 的判据为什么这样定】（2026-09-23 #47 事故的现场结论）：
 *   上游删包 → git pull 只删除被跟踪的文件（package.json、src/），
 *   而 lib/ 是 gitignore 的构建产物，原样留在磁盘上 →
 *   下次全量构建时 rolldown 把残留目录当打包入口 → 构建失败（头号原因）。
 *
 *   所以僵尸的签名是三件事【同时】成立：
 *     磁盘上有 <pkg>/lib        （产物还在）
 *     ∧ 磁盘上没有 <pkg>/package.json （被 pull 删掉了）
 *     ∧ HEAD 里也没有 <pkg>/package.json（上游确实删了这个包）
 *
 *   缺任何一条都不算僵尸：
 *   - 本地新建未提交的包（磁盘有 package.json）→ 报「未提交」（info），不误杀用户正在写的东西
 *   - HEAD 里有但磁盘丢了 package.json        → 归 ③「真正的缺失」（error）
 *   ③ 与 ④ 按构造互斥：③ 要求在 HEAD 里，④ 要求不在 HEAD 里。
 *
 *   包目录的枚举来源是 pnpm-workspace.yaml 的 packages 模式 ——
 *   这正是打包工具看见的那份清单，残留能否引爆构建由它决定；
 *   展开时跳过隐藏目录与 pnpm 暂存形态（residueKindOf），避免把已知残留当僵尸报。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { finding, healthOf, type Finding } from "../../util/result.ts";
import { run } from "../../host/shell.ts";
import { isDir, isFile } from "../../host/fs.ts";
import { p } from "../../util/paths.ts";
import { collectCoreStatus, residueKindOf, type CoreStatus } from "./status.ts";

/** 一处僵尸 lib/。 */
export interface ZombieLib {
  /** 包目录（相对源码根，POSIX 分隔；根目录用 "."）。 */
  pkgDir: string;
  /** lib 目录（同上）。 */
  libPath: string;
}

export interface LibResidueReport {
  /** pnpm-workspace.yaml 的 packages 模式；空数组 = 没解析到，僵尸检测不可用（会出 info 提示）。 */
  patterns: string[];
  /** 模式展开后的候选包目录数。 */
  candidates: number;
  /** HEAD 中记录的包目录数。 */
  headPackages: number;
  /** 僵尸 lib/（AC-C4 要求单独列出，绝不与 missingPackages 混）。 */
  zombieLibs: ZombieLib[];
  /** 真正的缺失：HEAD 有 package.json、磁盘没有。 */
  missingPackages: string[];
  /** 磁盘有 package.json、从未进过 HEAD —— 多半是本地新建未提交，info 级请用户自己确认。 */
  untrackedPackages: string[];
}

export interface CoreVerifyReport {
  sourceRoot: string | null;
  status: CoreStatus | null;
  libs: LibResidueReport | null;
  findings: Finding[];
  health: "ok" | "warn" | "error";
  elapsedMs: number;
  checkedAt: string;
}

/** 解析 pnpm-workspace.yaml 里 packages: 段下的 glob 列表（手写轻量解析，不引 YAML 依赖）。 */
export function parseWorkspaceGlobs(yamlText: string): string[] {
  const out: string[] = [];
  let inPackages = false;
  for (const raw of yamlText.split(/\r?\n/)) {
    const noComment = raw.split("#")[0] ?? "";
    const s = noComment.trim();
    if (!s) continue;
    if (/^packages\s*:/.test(s)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    // packages 段以缩进列表为主；遇到顶格的新顶层键即结束
    if (raw[0] !== " " && raw[0] !== "\t" && !s.startsWith("-")) {
      inPackages = false;
      continue;
    }
    const m = /^-\s+(.+)$/.exec(s);
    if (m?.[1]) out.push(m[1].replace(/^["']|["']$/g, ""));
  }
  return out;
}

/**
 * 展开一个 workspace glob（只支持按段 `*`，pnpm-workspace 实际用法就这些）。
 * 返回相对 root 的 POSIX 路径；字面段不要求存在（后续 isDir/isFile 会安全返回 false）。
 * 展开时跳过：隐藏目录、pnpm 暂存形态（_tmp_ / 日期戳 / 随机后缀）—— 它们是已知残留，不该算包。
 */
export function expandWorkspaceGlob(root: string, pattern: string): string[] {
  let cur: string[] = [""];
  for (const seg of pattern.split("/").filter(Boolean)) {
    const next: string[] = [];
    if (seg.includes("*")) {
      for (const d of cur) {
        const base = d ? p(root, d) : root;
        try {
          for (const e of Deno.readDirSync(base)) {
            if (!e.isDirectory) continue;
            if (e.name.startsWith(".")) continue;
            if (residueKindOf(e.name)) continue;
            next.push(d ? `${d}/${e.name}` : e.name);
          }
        } catch { /* 目录不存在 → 该支没有候选，继续其余分支 */ }
      }
    } else {
      for (const d of cur) next.push(d ? `${d}/${seg}` : seg);
    }
    cur = next;
  }
  return cur;
}

function readWorkspaceGlobs(root: string): string[] {
  try {
    return parseWorkspaceGlobs(Deno.readTextFileSync(p(root, "pnpm-workspace.yaml")));
  } catch {
    return [];
  }
}

/** 取 HEAD 里的全部文件路径；git 失败（非仓库等）返回 null，调用方降级为「跳过检测」。 */
async function headPaths(root: string): Promise<string[] | null> {
  const r = await run("git", ["-C", root, "ls-tree", "-r", "--name-only", "HEAD"], {
    timeoutMs: 30_000,
    allowNonZero: true,
    scope: "git",
  });
  if (r.code !== 0) return null;
  return r.stdout.split(/\r?\n/).filter((l) => l.length > 0);
}

/**
 * 检测僵尸 lib / 真缺失 / 未提交包（全只读）。
 * @returns null = 读不到 HEAD（不是 git 仓库 / git 不可用），调用方应降级而不是报错。
 */
export async function collectLibResidue(root: string): Promise<LibResidueReport | null> {
  const files = await headPaths(root);
  if (!files) return null;

  // HEAD 里的包目录集合（"" 表示根 package.json）
  const headPkgDirs = new Set<string>();
  for (const f of files) {
    if (f === "package.json") headPkgDirs.add("");
    else if (f.endsWith("/package.json")) headPkgDirs.add(f.slice(0, -"package.json".length - 1));
  }

  const patterns = readWorkspaceGlobs(root);
  const candidates = new Set<string>();
  for (const pat of patterns) {
    for (const d of expandWorkspaceGlob(root, pat)) candidates.add(d);
  }

  const pkgJsonAt = (dir: string): string => dir ? p(root, dir, "package.json") : p(root, "package.json");

  const zombieLibs: ZombieLib[] = [];
  const untrackedPackages: string[] = [];
  for (const dir of candidates) {
    const hasPkgDisk = isFile(pkgJsonAt(dir));
    const inHead = headPkgDirs.has(dir);
    if (!hasPkgDisk && !inHead) {
      // 三条件齐了才叫僵尸：产物还在 ∧ 磁盘没包 ∧ HEAD 也没包
      const libPath = dir ? `${dir}/lib` : "lib";
      if (isDir(dir ? p(root, dir, "lib") : p(root, "lib"))) {
        zombieLibs.push({ pkgDir: dir || ".", libPath });
      }
    } else if (hasPkgDisk && !inHead) {
      // 有 package.json 但从未提交 —— 可能是用户正在写的新包，只提示不判死
      untrackedPackages.push(dir);
    }
  }

  // 真正的缺失：从 HEAD 出发（磁盘上已经没有的目录靠候选枚举是找不到的）
  const missingPackages = [...headPkgDirs].filter((d) => !isFile(pkgJsonAt(d)));

  const cmp = (a: string, b: string) => a.localeCompare(b);
  zombieLibs.sort((x, y) => cmp(x.pkgDir, y.pkgDir));
  missingPackages.sort(cmp);
  untrackedPackages.sort(cmp);

  return {
    patterns,
    candidates: candidates.size,
    headPackages: headPkgDirs.size,
    zombieLibs,
    missingPackages,
    untrackedPackages,
  };
}

/** 把残留报告翻成 findings（纯函数，单独导出便于阴阳测试）。 */
export function libResidueFindings(libs: LibResidueReport): Finding[] {
  const out: Finding[] = [];

  if (libs.zombieLibs.length > 0) {
    out.push(
      finding("core.zombie-lib", "error", `发现 ${libs.zombieLibs.length} 处僵尸 lib/（包已被上游删除）`, {
        cause:
          "这些目录里留着构建产物 lib/，但 package.json 已不在磁盘、也不在当前源码记录里 —— 上游删包后 git pull 只清被跟踪的文件，gitignore 的产物原样留了下来",
        impact:
          "下次全量构建时打包工具会把这些残留目录当入口，构建直接失败（2026-09-23 本体构建失败的头号原因）",
        action: "点「完成更新」做深度清理：非 HEAD 残留会被移入隔离区（只移动不删除，可整体还原）",
        fixAction: "core.finishUpdate",
        evidence: libs.zombieLibs.slice(0, 20).map((z) => z.libPath),
      }),
    );
  }

  if (libs.missingPackages.length > 0) {
    out.push(
      finding("core.missing-package", "error", `${libs.missingPackages.length} 个包在源码记录里但磁盘缺失`, {
        cause: "源码记录（HEAD）里有这些 package.json，但文件已经不在磁盘上（被误删或某次操作中断）",
        impact: "本体工作树不完整，构建与运行都会异常",
        action: "点「完成更新」重新对齐源码（会把缺失文件恢复回来）",
        fixAction: "core.finishUpdate",
        evidence: libs.missingPackages.slice(0, 20).map((d) => `${d || "."}/package.json`),
      }),
    );
  }

  if (libs.untrackedPackages.length > 0) {
    out.push(
      finding("core.untracked-package", "info", `${libs.untrackedPackages.length} 个本地新增、尚未提交的包目录`, {
        cause: "磁盘上有它们的 package.json，但从未进入源码记录 —— 多半是你本地新建的包，也可能是残留",
        impact: "若非有意新建，它们会在下次构建时被当成工作区包参与打包",
        action: "是自己新建的就正常提交使用；不确定的，点「完成更新」的深度清理会一并处理",
        evidence: libs.untrackedPackages.slice(0, 20),
      }),
    );
  }

  return out;
}

export const coreVerifyAction: ActionDef<Record<string, never>, CoreVerifyReport> = {
  name: "core.verify",
  domain: "core",
  title: "本体完整性校验",
  description:
    "校验本体源码树：构建记录与产物一致性（复用 core.status 判据）+ 僵尸 lib/（AC-C4 单独列出）+ 缺失包检测。只读。",
  readonly: true,
  steps: ["核对构建记录与产物完整性", "检测僵尸 lib 与缺失包", "汇总"],
  run: async (ctx): Promise<CoreVerifyReport> => {
    const t0 = Date.now();

    ctx.step("s1", "核对构建记录与产物完整性");
    ctx.progress(0.2);
    const status = await collectCoreStatus();
    ctx.detail(status.sourceRoot ? `源码：${status.sourceRoot}` : "未找到本体");
    ctx.throwIfCancelled();

    const findings: Finding[] = [...status.findings];
    let libs: LibResidueReport | null = null;
    if (status.sourceRoot) {
      ctx.step("s2", "检测僵尸 lib 与缺失包");
      ctx.progress(0.55);
      libs = await collectLibResidue(status.sourceRoot);
      if (libs === null) {
        findings.push(
          finding("core.no-head", "warn", "读不到源码树的 git 记录，残留与缺失检测已跳过", {
            cause: "git ls-tree HEAD 执行失败 —— 本体目录可能不是完整的 git 仓库，或 git 不可用",
            impact: "无法判断有没有僵尸 lib/ 与缺失包，本次校验结论不完整",
            action: "确认本体是完整克隆的 git 仓库后重试",
            evidence: [status.sourceRoot],
          }),
        );
      } else {
        if (libs.patterns.length === 0) {
          findings.push(
            finding("core.no-workspace-globs", "info", "未解析到工作区包清单，僵尸 lib 检测已跳过", {
              cause: "pnpm-workspace.yaml 缺失或没有 packages 段",
              impact: "缺失包检测不受影响，但僵尸 lib/ 这一项目前查不了",
              action: "确认本体源码是否完整；一般重跑「完成更新」即可恢复",
              evidence: [p(status.sourceRoot, "pnpm-workspace.yaml")],
            }),
          );
        }
        findings.push(...libResidueFindings(libs));
        ctx.detail(
          `HEAD 包 ${libs.headPackages} · 候选目录 ${libs.candidates} · 僵尸 ${libs.zombieLibs.length} · 缺失 ${libs.missingPackages.length} · 未提交 ${libs.untrackedPackages.length}`,
        );
      }
      ctx.throwIfCancelled();
    }

    ctx.step("s3", "汇总");
    ctx.progress(1);
    return {
      sourceRoot: status.sourceRoot,
      status,
      libs,
      findings,
      health: healthOf(findings),
      elapsedMs: Date.now() - t0,
      checkedAt: new Date().toISOString(),
    };
  },
};
