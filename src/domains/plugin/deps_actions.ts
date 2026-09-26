/**
 * 依赖体检与锁文件修复（P0-3）。
 *
 * 两个动作分工：
 *   plugin.deps     —— 只读：算冲突、看锁文件状态（不联网、不改东西）
 *   plugin.syncLock —— 写：按清单重建 package-lock.json（先备份、失败自动还原，不重装 node_modules）
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { ensureDir, pathExists } from "../../host/fs.ts";
import { runCmd } from "../../host/shell.ts";
import { butlerRoot, dshProfileDir, p, stampOf } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";
import { findDependencyProblems, type LockState, lockFileState } from "./deps.ts";
import { npmSourceArgs, pmEnvReady, pmSkipped, profileManifestPath } from "./mutate.ts";

export interface DepsReport {
  profileDir: string;
  problems: ReturnType<typeof findDependencyProblems>;
  lock: LockState;
  summary: { duplicates: number; conflicts: number; lockOk: boolean };
  /** 给界面直接渲染的结论（含 fixAction，按钮会跟着出现）。 */
  findings: Finding[];
}

function problemFindings(problems: DepsReport["problems"], lock: LockState): Finding[] {
  const out: Finding[] = [];
  const conflicts = problems.filter((x) => x.kind === "range-conflict");
  const dups = problems.filter((x) => x.kind === "duplicate");

  for (const c of conflicts.slice(0, 12)) {
    out.push(
      finding("plugin.dep-conflict", "warn", c.detail, {
        cause:
          "两个插件各自声明了同一个依赖的版本要求，而这两个范围没有任何版本能同时满足。npm 遇到这种树会直接拒绝安装（报 ERESOLVE），表现为「装不上/卸不掉」",
        impact: "安装或卸载会失败并回滚；升级其中一个插件可能把另一个弄得不生效",
        action:
          "把冲突的两个插件升到较新的版本（作者通常会跟进依赖）；或先卸载其中一个，装完另一个再装回来",
        evidence: [`依赖：${c.dependency}`, `要求：${c.wanted}`, `当前装到：${c.found.join("、") || "（不在 profile 里）"}`],
      }),
    );
  }
  for (const d of dups.slice(0, 8)) {
    out.push(
      finding("plugin.dep-duplicate", "info", d.detail, {
        cause: "不同插件锁定了同一个包的不同大版本，npm 只能各装一份",
        impact: "占用额外磁盘；极端情况下两套版本行为不一致，出现玄学问题",
        action: "通常不用处理；若想收敛，把相关插件升到同一代的版本",
        evidence: [`版本：${d.found.join("、")}`],
      }),
    );
  }

  if (lock.corrupt) {
    out.push(
      finding("plugin.lock-corrupt", "error", "package-lock.json 解析不了（内容写坏了）", {
        cause: "上一次安装/更新被中断，锁文件写了一半",
        impact: "依赖解析会以损坏的锁为准，安装行为不可预期",
        action: "用「重建锁文件」按当前清单重新生成一份（会先备份原文件）",
        fixAction: "plugin.syncLock",
        fixLabel: "重建锁文件",
        evidence: [lock.path],
      }),
    );
  }
  return out;
}

export const pluginDepsAction: ActionDef<Record<string, never>, DepsReport> = {
  name: "plugin.deps",
  domain: "plugin",
  title: "依赖冲突体检",
  description:
    "只读：读 profile 里已装插件的 package.json，算出「谁和谁要的版本不可能同时满足」（npm 报 ERESOLVE 的根因）以及同一个包装了多个版本的情况，并检查锁文件能否解析。不联网、不改任何东西。",
  readonly: true,
  steps: ["读取已装依赖", "核对 peer 版本要求", "检查锁文件"],
  run: async (ctx): Promise<DepsReport> => {
    const profileDir = dshProfileDir();
    ctx.step("s1", "读取已装依赖");
    ctx.detail(`profile：${profileDir}`);
    ctx.progress(0.3);
    ctx.step("s2", "核对 peer 版本要求");
    const problems = findDependencyProblems(profileDir);
    const conflicts = problems.filter((x) => x.kind === "range-conflict").length;
    const duplicates = problems.filter((x) => x.kind === "duplicate").length;
    ctx.detail(`发现 ${conflicts} 处版本冲突、${duplicates} 处重复安装`);
    ctx.progress(0.8);
    ctx.step("s3", "检查锁文件");
    const lock = lockFileState(profileDir);
    ctx.detail(lock.note);
    ctx.progress(1);
    const report: DepsReport = {
      profileDir,
      problems,
      lock,
      summary: { duplicates, conflicts, lockOk: lock.exists && !lock.corrupt },
      findings: [],
    };
    report.findings = depsFindings(report);
    return report;
  },
};

/** 把体检结论转成界面能渲染的 findings（动作结果里带上，界面直接显示并可点一键修）。 */
export function depsFindings(report: DepsReport): Finding[] {
  const out = problemFindings(report.problems, report.lock);
  if (out.length === 0) {
    out.push(
      finding("plugin.deps-ok", "info", "依赖树没发现版本冲突", {
        cause: "所有插件的 peer 版本要求都能被当前依赖树满足",
        impact: "安装/卸载不会再因为依赖冲突失败",
        action: "无需处理",
        evidence: [report.lock.note],
      }),
    );
  }
  return out;
}

// ── plugin.syncLock（写） ────────────────────────────────────────────

export interface SyncLockReport {
  lockPath: string;
  backupPath: string | null;
  lockfileVersion: number | null;
  lines: string[];
}

async function syncLockPreflight(): Promise<Finding[]> {
  const out: Finding[] = [];
  const profileDir = dshProfileDir();
  if (!pathExists(profileManifestPath(profileDir))) {
    out.push(
      finding("plugin.no-profile", "error", "找不到插件配置（profile 的 package.json）", {
        cause: `以下位置没有可解析的 package.json：${profileManifestPath(profileDir)}`,
        impact: "没有清单就没有重建锁文件的依据",
        action: "先确认 DSH 已安装并至少启动过一次",
        evidence: [profileManifestPath(profileDir)],
      }),
    );
  }
  const lock = lockFileState(profileDir);
  if (lock.exists && !lock.corrupt) {
    out.push(
      finding("plugin.lock-ok", "info", "锁文件当前是好的，重建会用新的一份覆盖它", {
        cause: lock.note,
        impact: "原文件会先备份，随时可以搬回",
        action: "确实想重建再继续",
        evidence: [lock.path],
      }),
    );
  }
  return out;
}

async function runSyncLock(ctx: ActionContext): Promise<SyncLockReport> {
  const profileDir = dshProfileDir();
  const lockPath = p(profileDir, "package-lock.json");
  const report: SyncLockReport = { lockPath, backupPath: null, lockfileVersion: null, lines: [] };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  ctx.step("s1", "备份现有锁文件");
  ctx.progress(0.15);
  if (pathExists(lockPath)) {
    const dir = p(butlerRoot(), "quarantine", `lock-backup-${stampOf()}`);
    ensureDir(dir);
    const dest = p(dir, "package-lock.json");
    Deno.copyFileSync(lockPath, dest);
    report.backupPath = dest;
    line(`已备份原锁文件 → ${dest}`);
    ctx.onUndo(async () => {
      try {
        Deno.copyFileSync(dest, lockPath);
        ctx.log("已把原锁文件还原回去");
      } catch (e) {
        ctx.log(`⚠ 还原锁文件失败：${(e as Error).message}（备份还在 ${dest}）`);
      }
    });
  } else {
    line("profile 里原本没有锁文件，这次会新建一份");
  }
  ctx.throwIfCancelled();

  ctx.step("s2", "按清单重建锁文件");
  ctx.progress(0.5);
  pmEnvReady();
  if (pmSkipped()) {
    line("（测试模式：跳过真实 npm 调用）");
  } else {
    const r = await runCmd(
      ["npm", "install", "--prefix", profileDir, "--package-lock-only", "--no-audit", "--no-fund", ...npmSourceArgs(), "--legacy-peer-deps", "--loglevel", "error"],
      { timeoutMs: TIMEOUTS.install, allowNonZero: true, scope: "plugin", signal: ctx.signal },
    );
    if (r.code !== 0) {
      throw new Error(
        `重建锁文件失败（退出码 ${r.code}）：${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" / ")}`,
      );
    }
    line("npm 已按当前清单生成新的锁文件");
  }
  ctx.throwIfCancelled();

  ctx.step("s3", "校验新锁文件");
  ctx.progress(0.9);
  const after = lockFileState(profileDir);
  report.lockfileVersion = after.lockfileVersion;
  if (!pmSkipped() && (!after.exists || after.corrupt)) {
    throw new Error(`重建后的锁文件仍然不可用：${after.note}`);
  }
  line(`校验：${after.note}`);
  ctx.progress(1);
  return report;
}

export const pluginSyncLockAction: ActionDef<Record<string, never>, SyncLockReport> = {
  name: "plugin.syncLock",
  domain: "plugin",
  title: "重建依赖锁文件",
  description:
    "按当前 profile 清单重新生成 package-lock.json（--package-lock-only，不重装 node_modules）。原锁文件会先备份到管家隔离区，失败或取消自动还原；遇到 peer 冲突时用宽松解析，不会因此卡住。",
  readonly: false,
  steps: ["备份现有锁文件", "按清单重建锁文件", "校验新锁文件"],
  preflight: syncLockPreflight,
  run: (ctx) => runSyncLock(ctx),
  timeoutMs: TIMEOUTS.install,
};
