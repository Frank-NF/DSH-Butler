/**
 * bootstrap.apply —— 从零装一台 DSH（写操作，必须走 plan → confirm → apply）。
 *
 * 【可恢复设计】每一步都先看现场再动手，所以"继续"就是"用同一个目录再跑一次"：
 *   源码目录已是 git 仓库 → 改走 git pull；否则才 clone。
 *   这样崩溃恢复（AC-B3）不需要维护"从第几步接着跑"的状态机 —— 状态机一旦与真实
 *   磁盘状态对不上，就会做出"以为还没 clone 其实已经 clone 了"这类危险判断。
 *
 * 【失败不删东西】clone 失败留下的半成品目录移进隔离区（只移动不删除），
 * 与项目其它地方的处置保持一致。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { run } from "../../host/shell.ts";
import { diskSpace, humanSize } from "../../host/mod.ts";
import { ensureDir, isDir, listDir, moveSafe } from "../../host/fs.ts";
import { dirname, p, quarantineStampDir, stampOf } from "../../util/paths.ts";
import { DSH_PORT_DEFAULT, TIMEOUTS } from "../../version.ts";
import { probeRuntimes } from "../env/probe.ts";
import {
  detectPnpm,
  runBuildWithRetry,
  startDshServer,
  stopDshServer,
} from "../core/finish_update.ts";
import { invalidateBuildIntegrityCache, verifyBuildIntegrity } from "../core/official.ts";
import { BOOTSTRAP_ESTIMATES, collectBootstrapPlan } from "./plan.ts";
import { type BootstrapVerifyReport, collectBootstrapVerify } from "./verify.ts";
import { clearBootstrapJournal, readBootstrapJournal, writeBootstrapJournal } from "./journal.ts";

/** 八步清单（单一事实来源：步骤表、进度、汇报共用一份）。 */
export const BOOTSTRAP_STEPS = [
  "系统与权限预检",
  "准备安装目录与 pnpm",
  "获取 DSH 源码（没有则 clone）",
  "安装依赖（pnpm install）",
  "全量构建（pnpm run build）",
  "核对构建产物",
  "启动 DSH 服务",
  "部署后三连验证",
] as const;

export interface BootstrapApplyParams {
  root?: string;
  url?: string;
  /** clone 深度，默认 1（浅克隆，首次快很多）。 */
  depth?: number;
  port?: number;
  /** 已装过时强制重装（旧目录会先移入隔离区，不删除）。 */
  force?: boolean;
}

export interface BootstrapApplyReport {
  root: string;
  url: string;
  depth: number;
  /** 本次是否真的执行了 clone（false = 复用已有仓库）。 */
  cloned: boolean;
  pnpmInstalled: boolean;
  quarantineDir: string | null;
  lines: string[];
  warnings: string[];
  head: string | null;
  verify: BootstrapVerifyReport | null;
  elapsedMs: number;
}

// ── preflight ────────────────────────────────────────────────────────

async function bootstrapPreflight(params: BootstrapApplyParams): Promise<Finding[]> {
  const out: Finding[] = [];
  const plan = await collectBootstrapPlan({ root: params.root, url: params.url });
  const root = plan.targetRoot;

  const journal = readBootstrapJournal();
  const resuming = Boolean(journal && journal.root === root);
  const installedHere = plan.installed && plan.installed.path === root;

  for (const b of plan.blockers) {
    // 两种情况不算阻碍：
    //   ① 强制重装（用户明确要覆盖）；
    //   ② 续跑未完成的部署（同一目录，半成品还在）。
    if (b.id === "bootstrap.already-installed" && (params.force || resuming)) continue;
    out.push(b);
  }

  // 目录非空、却不是 git 仓库、也不是 DSH 源码 → 拒绝往里写（防止把用户的东西覆盖掉）
  if (isDir(root) && !isDir(p(root, ".git")) && !resuming && !installedHere) {
    const entries = listDir(root).filter((e) => !e.dir || true);
    if (entries.length > 0) {
      out.push(
        finding("bootstrap.target-not-empty", "error", `目标目录非空且不是 DSH 源码：${root}`, {
          cause: `目录里有 ${entries.length} 项内容，但没有 .git`,
          impact: "继续往里 clone 会被 git 拒绝，强行清理可能删掉你有用的文件",
          action: "换一个空目录，或先把该目录里的东西挪走",
          evidence: entries.slice(0, 10).map((e) => e.name),
        }),
      );
    }
  }

  // 磁盘空间（按目标盘判）
  const disk = await diskSpace(root);
  if (disk && disk.freeBytes < BOOTSTRAP_ESTIMATES.diskBytes) {
    out.push(
      finding(
        "bootstrap.apply.no-disk",
        "error",
        `目标盘空间不足（可用 ${humanSize(disk.freeBytes)}）`,
        {
          cause: `预计需要 ${humanSize(BOOTSTRAP_ESTIMATES.diskBytes)}`,
          impact: "装到一半写满磁盘会留下半成品",
          action: "换盘或清理空间后重试",
          evidence: [root],
        },
      ),
    );
  }

  const rt = await probeRuntimes();
  const has = (n: string) => rt.find((r) => r.name === n)?.found === true;
  if (!has("git") || !has("node")) {
    out.push(
      finding("bootstrap.apply.runtime", "error", "运行时不全，无法部署", {
        cause: `git ${has("git") ? "有" : "缺失"} · node ${has("node") ? "有" : "缺失"}`,
        impact: "获取源码与构建都跑不起来",
        action: "先装好 Git 与 Node.js（22 LTS 以上）再试",
      }),
    );
  }
  if (!has("pnpm") && !has("npm")) {
    out.push(
      finding("bootstrap.apply.no-pkg", "error", "没有可用的包管理器", {
        cause: "pnpm 与 npm 都找不到",
        impact: "装不了依赖",
        action: "安装 Node.js（自带 npm）后重试",
      }),
    );
  }
  return out;
}

// ── run ──────────────────────────────────────────────────────────────

function tailLines(text: string, n = 3): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-n);
}

async function runBootstrap(
  ctx: ActionContext,
  params: BootstrapApplyParams,
): Promise<BootstrapApplyReport> {
  const t0 = Date.now();
  const url = params.url?.trim() || BOOTSTRAP_ESTIMATES.repoUrl;
  const depth = Math.min(Math.max(Math.trunc(params.depth ?? 1), 1), 100);
  const port = params.port ?? DSH_PORT_DEFAULT;

  const report: BootstrapApplyReport = {
    root: "",
    url,
    depth,
    cloned: false,
    pnpmInstalled: false,
    quarantineDir: null,
    lines: [],
    warnings: [],
    head: null,
    verify: null,
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };
  const warn = (s: string) => {
    report.warnings.push(s);
    line(`警告：${s}`);
  };

  // ── s1 预检 ────────────────────────────────────────────────────────
  ctx.step("s1", BOOTSTRAP_STEPS[0]);
  ctx.progress(0.03);
  const problems = await bootstrapPreflight(params);
  const errors = problems.filter((f) => f.severity === "error");
  if (errors.length > 0) {
    throw new Error(`写前检查未通过：${errors.map((f) => f.title).join("；")}`);
  }
  const plan = await collectBootstrapPlan({ root: params.root, url });
  const root = plan.targetRoot;
  report.root = root;
  const journal = readBootstrapJournal();
  const resuming = Boolean(journal && journal.root === root);
  line(resuming ? `续跑未完成的部署：${root}` : `安装目标：${root}`);
  ctx.throwIfCancelled();

  const mark = (stepId: string, stepTitle: string, cloned: boolean) => {
    writeBootstrapJournal({
      startedAt: journal?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      jobId: ctx.jobId,
      root,
      url,
      stepId,
      stepTitle,
      cloned,
    });
  };

  // ── s2 目录 + pnpm ────────────────────────────────────────────────
  ctx.step("s2", BOOTSTRAP_STEPS[1]);
  ctx.progress(0.06);
  mark("s2", BOOTSTRAP_STEPS[1], false);

  // 强制重装：旧目录先移进隔离区（不删除），再重新 clone
  if (params.force && isDir(root) && isDir(p(root, ".git"))) {
    const dest = p(quarantineStampDir(root, stampOf()), "replaced-by-bootstrap");
    ensureDir(dirname(dest));
    try {
      moveSafe(root, dest);
      report.quarantineDir = dest;
      line(`已把原有安装移入隔离区（要还原就搬回来）：${dest}`);
    } catch (e) {
      throw new Error(`无法移动原有安装目录到隔离区：${(e as Error).message}`);
    }
  }
  ensureDir(root);

  let tc = await detectPnpm();
  if (!tc) {
    line("pnpm 未安装，先用 npm 装上…");
    const npmR = await run("npm", ["install", "-g", "pnpm"], {
      timeoutMs: 600_000,
      allowNonZero: true,
      scope: "build",
      signal: ctx.signal,
    });
    if (npmR.code !== 0) {
      throw new Error(
        `安装 pnpm 失败（退出码 ${npmR.code}）：${
          tailLines(npmR.stdout + npmR.stderr, 2).join(" / ")
        }`,
      );
    }
    tc = await detectPnpm();
    if (!tc) {
      throw new Error("pnpm 装好之后仍然找不到 —— 请重开一次管家让 PATH 生效，然后重试");
    }
    report.pnpmInstalled = true;
    line("pnpm 安装完成");
  } else {
    line(`pnpm 已就绪（node ${tc.node}）`);
  }
  ctx.throwIfCancelled();

  // ── s3 获取源码 ───────────────────────────────────────────────────
  ctx.step("s3", BOOTSTRAP_STEPS[2]);
  ctx.progress(0.12);
  mark("s3", BOOTSTRAP_STEPS[2], false);

  const isRepo = isDir(p(root, ".git"));
  let createdHere = false;
  if (isRepo) {
    line("目录里已有 git 仓库，改走 git pull --ff-only");
    const pull = await run("git", ["-C", root, "pull", "--ff-only"], {
      timeoutMs: 900_000,
      allowNonZero: true,
      scope: "git",
      signal: ctx.signal,
      onLine: (l) => {
        if (/receiving|resolving|updating/i.test(l)) ctx.detail(l.slice(0, 120));
      },
    });
    if (pull.code !== 0) {
      warn(
        `git pull 未成功（退出码 ${pull.code}）：${
          tailLines(pull.stdout + pull.stderr, 2).join(" / ")
        }`,
      );
    } else {
      line("源码已更新到最新");
    }
  } else {
    const url0 = url;
    line(`克隆 ${url0}（浅克隆 depth=${depth}）…`);
    // 失败/取消时把半成品移入隔离区 —— 只注册一次，且只对"本次新建的目录"生效
    ctx.onUndo(async () => {
      if (!createdHere || !isDir(root)) return;
      try {
        const dest = p(quarantineStampDir(root, stampOf()), "half-clone");
        ensureDir(dirname(dest));
        moveSafe(root, dest);
        report.quarantineDir = dest;
      } catch { /* 还原失败也不能盖住原始错误 */ }
    });
    const clone = await run("git", ["clone", "--depth", String(depth), url0, root], {
      timeoutMs: 1_800_000,
      allowNonZero: true,
      scope: "git",
      signal: ctx.signal,
      onLine: (l) => {
        const m = /(\d+)%/.exec(l);
        if (m?.[1]) ctx.detail(`克隆进度 ${m[1]}%`);
      },
    });
    createdHere = isDir(p(root, ".git"));
    if (clone.code !== 0 || !createdHere) {
      throw new Error(
        `拉取源码失败（退出码 ${clone.code}）：${
          tailLines(clone.stdout + clone.stderr, 3).join(" / ")
        }`,
      );
    }
    report.cloned = true;
    line("源码拉取完成");
  }

  const headR = await run("git", ["-C", root, "rev-parse", "HEAD"], {
    timeoutMs: 15_000,
    allowNonZero: true,
    scope: "git",
  });
  report.head = headR.code === 0 ? headR.stdout.trim() : null;
  ctx.throwIfCancelled();

  // ── s4 依赖 ───────────────────────────────────────────────────────
  ctx.step("s4", BOOTSTRAP_STEPS[3]);
  ctx.progress(0.3);
  mark("s4", BOOTSTRAP_STEPS[3], report.cloned);
  line("安装依赖（首次约 1.1 GB，请耐心等）…");
  const inst = await run(tc.node, [tc.pnpmCjs, "install"], {
    cwd: root,
    timeoutMs: TIMEOUTS.install,
    allowNonZero: true,
    scope: "build",
    signal: ctx.signal,
    onLine: (l) => {
      if (/progress|downloading|packages/i.test(l)) ctx.detail(l.slice(0, 120));
    },
  });
  if (inst.code !== 0 || inst.timedOut) {
    throw new Error(
      `安装依赖失败（${inst.timedOut ? "超时" : `退出码 ${inst.code}`}）：${
        tailLines(inst.stdout + inst.stderr, 3).join(" / ")
      }`,
    );
  }
  line("依赖安装完成");
  ctx.throwIfCancelled();

  // ── s5 全量构建 ───────────────────────────────────────────────────
  ctx.step("s5", BOOTSTRAP_STEPS[4]);
  ctx.progress(0.4);
  mark("s5", BOOTSTRAP_STEPS[4], report.cloned);
  await runBuildWithRetry(ctx, root, tc, line);
  ctx.progress(0.85);

  // ── s6 核对产物 ───────────────────────────────────────────────────
  ctx.step("s6", BOOTSTRAP_STEPS[5]);
  ctx.progress(0.88);
  mark("s6", BOOTSTRAP_STEPS[5], report.cloned);
  invalidateBuildIntegrityCache();
  const integ = await verifyBuildIntegrity(root, { fresh: true });
  if (integ.official && integ.verified) {
    line(`核对产物：一致（${integ.fileCount ?? "?"} 个文件）`);
  } else {
    warn(`核对产物未通过：${integ.error ?? "官方校验脚本没给结论"}`);
  }
  ctx.throwIfCancelled();

  // ── s7 启动服务 ───────────────────────────────────────────────────
  ctx.step("s7", BOOTSTRAP_STEPS[6]);
  ctx.progress(0.92);
  mark("s7", BOOTSTRAP_STEPS[6], report.cloned);
  const stopped = await stopDshServer();
  if (stopped.wasRunning) line(`已停掉原有服务（${stopped.stopped} 个进程）`);
  ctx.throwIfCancelled();
  const started = await startDshServer(root, port);
  if (!started.ok) {
    throw new Error(`服务启动失败：${started.message || "未知原因"}`);
  }
  line(`DSH 服务已启动（端口 ${port}）`);
  ctx.throwIfCancelled();

  // ── s8 三连验证 ───────────────────────────────────────────────────
  ctx.step("s8", BOOTSTRAP_STEPS[7]);
  ctx.progress(0.96);
  mark("s8", BOOTSTRAP_STEPS[7], report.cloned);
  report.verify = await collectBootstrapVerify();
  line(
    report.verify.ok
      ? "三连验证：全部通过"
      : `三连验证未全过：${
        report.verify.checks.filter((c) => !c.ok).map((c) => c.label).join("、")
      }`,
  );
  for (const c of report.verify.checks) {
    line(`　${c.ok ? "✓" : "✗"} ${c.label}：${c.detail}`);
  }

  clearBootstrapJournal();
  report.elapsedMs = Date.now() - t0;
  ctx.progress(1);
  return report;
}

export const bootstrapApplyAction: ActionDef<BootstrapApplyParams, BootstrapApplyReport> = {
  name: "bootstrap.apply",
  domain: "bootstrap",
  title: "一键部署 DSH",
  description:
    "从零装一台 DSH：预检 → 目录与 pnpm → 拉源码 → 装依赖 → 全量构建 → 核对产物 → 起服务 → 三连验证。中途失败留下的一切都只移入隔离区，不删除。",
  readonly: false,
  steps: [...BOOTSTRAP_STEPS],
  preflight: async (params) => await bootstrapPreflight(params ?? {}),
  run: async (ctx, params) => await runBootstrap(ctx, params ?? {}),
  timeoutMs: TIMEOUTS.jobTotal,
};
// ── bootstrap.discard（回滚未完成的部署） ─────────────────────────────
//
// AC-B3 要求"识别未完成的部署并给出「继续 / 回滚」两个选项"：
//   - 继续 = 直接再跑一次 bootstrap.apply（每步都先看现场，天然可续跑）；
//   - 回滚 = 这个动作：把半成品目录整体移进隔离区，并清掉进度台账。
// 只移动、不删除 —— 与全项目其它地方的处置保持一致。

export interface BootstrapDiscardParams {
  root?: string;
}

export interface BootstrapDiscardReport {
  root: string;
  /** 搬到哪儿了（要还原就把它搬回来）。 */
  quarantineDir: string | null;
  moved: boolean;
  lines: string[];
}

function discardPreflight(params: BootstrapDiscardParams): Finding[] {
  const out: Finding[] = [];
  const j = readBootstrapJournal();
  if (!j) {
    out.push(
      finding("bootstrap.discard.no-journal", "error", "没有未完成的部署可回滚", {
        cause: "进度台账不存在（~/.dsh-butler/bootstrap/journal.json）",
        impact: "不知道要回滚哪个目录，贸然动手可能删错东西",
        action: "如果你确实想清掉某个装了一半的目录，手动把它移走即可",
      }),
    );
    return out;
  }
  if (params.root && params.root.trim() && params.root.trim() !== j.root) {
    out.push(
      finding("bootstrap.discard.mismatch", "error", "指定目录与台账里的不一致", {
        cause: `台账记的是 ${j.root}，请求的是 ${params.root}`,
        impact: "可能动到不该动的目录",
        action: "确认要回滚哪个目录后重试（留空即按台账来）",
        evidence: [j.root, params.root],
      }),
    );
  }
  return out;
}

async function runBootstrapDiscard(
  ctx: ActionContext,
  _params: BootstrapDiscardParams,
): Promise<BootstrapDiscardReport> {
  const journal = readBootstrapJournal();
  if (!journal) throw new Error("没有未完成的部署可回滚");
  const root = journal.root;
  const report: BootstrapDiscardReport = { root, quarantineDir: null, moved: false, lines: [] };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  ctx.step("s1", "确认半成品位置");
  ctx.progress(0.3);
  line(`未完成的部署停在：${journal.stepTitle}（开始于 ${journal.startedAt}）`);
  line(`目录：${root}`);
  ctx.throwIfCancelled();

  ctx.step("s2", "移入隔离区");
  ctx.progress(0.7);
  if (isDir(root)) {
    const dest = p(quarantineStampDir(root, stampOf()), "abandoned-deploy");
    ensureDir(dirname(dest));
    moveSafe(root, dest);
    report.quarantineDir = dest;
    report.moved = true;
    line(`已把半成品移入隔离区（要还原就把它搬回 ${root}）：${dest}`);
  } else {
    line("目录已经不在盘上了，无需移动");
  }

  ctx.step("s3", "清掉进度台账");
  ctx.progress(1);
  clearBootstrapJournal();
  line("进度台账已清除，下次「一键部署」会当作全新安装");
  return report;
}

export const bootstrapDiscardAction: ActionDef<BootstrapDiscardParams, BootstrapDiscardReport> = {
  name: "bootstrap.discard",
  domain: "bootstrap",
  title: "放弃这次部署",
  description:
    "把没跑完的部署目录整体移入隔离区并清掉进度台账。只移动不删除 —— 想还原随时能搬回来。",
  readonly: false,
  steps: ["确认半成品位置", "移入隔离区", "清掉进度台账"],
  preflight: async (params) => discardPreflight(params ?? {}),
  run: async (ctx, params) => await runBootstrapDiscard(ctx, params ?? {}),
};
