/**
 * core.rollback —— 本体回滚（AC-C3：任一步失败后能恢复到操作前状态，恢复后 core.verify 全绿）。
 *
 * 定位：core.finishUpdate 的「后悔药」。finishUpdate 动手【之前】创建的回滚点
 * （kind=core-build：git-ref 钉住 HEAD + 构建记录 copy，逆操作 git-reset + 隔离区移回）
 * 由本动作消费：源码退回 → 构建记录还原 → 隔离区内容移回 → 按需重建 → 复核全绿。
 *
 * 三个语义决定（写清免得后人猜）：
 *
 *   1) 【清理范围刻意 ≠ finishUpdate 的 deepCleanInto】。
 *      finishUpdate 是「更新方向」：旧版本残留要隔离走；而回滚刚把隔离区内容
 *      【移回】仓库根——这时跑完整深清，会把移回来的未跟踪源文件当"不明残留"
 *      再扫进新隔离区，恢复就白做了。所以回滚只清两类确定的垃圾：
 *        - 过期编译缓存（*.tsbuildinfo / .stale-*）：反映的是回滚前的构建，重建前必须作废；
 *        - 孤儿包（reset 后某包只剩 lib/ 的那种）：不清，下次全量构建必被引爆
 *          （2026-09-23 #47 事故的头号原因，见铁律 11）。
 *
 *   2) 【领域验证分两段（rollbackGreen 的 phase 参数）】。
 *      apply 内部的验证跑在【重建之前】：此刻 dist 还是回滚前构建的新产物，
 *      官方完整性校验必然报 core.artifacts-mismatch（error）——它是预期状态，
 *      不是失败，pre-rebuild 阶段必须排除；重建后的最终复核（phase="final"）
 *      则不再排除——产物还不一致就是真没修好，绝不静默成功。
 *      两个阶段都排除 profile 维度的三条（双名单/安装残留）：它们读的是真实
 *      ~/.dsh/profiles/<profile>，与本体回滚无关，进判据会污染 AC-C3 的「全绿」。
 *
 *   3) 【停服开关 BUTLER_SKIP_SERVICE_OPS=1】。
 *      测试隔离的第 4 件套（与 DSH_WEB_DIR / BUTLER_ROLLBACK_DIR 并列）：
 *      回滚会真实停启本机 DSH 服务，而测试机器上可能正跑着用户在用的 DSH——
 *      compiled 形态的进程命令行里没有源码树路径（cwd 不在 CommandLine 里），
 *      无法按树过滤，只能靠开关绕开。测试必须设它；生产环境不要设。
 *
 * 重建的触发条件是「本体 package.json 带 build 脚本」：带才需要重建（install +
 * 官方 pnpm run build，判据与重试语义复用 finishUpdate 的）；不带（测试 fixture）
 * 直接跳过，最终复核照常把关。pnpm 探测失败也跳过（警告），复核会兜底报出来。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { run, type RunResult } from "../../host/shell.ts";
import { moveSafe, readJson } from "../../host/fs.ts";
import { findDshPort } from "../../host/port.ts";
import { dirname, p, quarantineStampDir, resolveDshSourceRoot, stampOf } from "../../util/paths.ts";
import { DSH_PORT_CANDIDATES, DSH_PORT_DEFAULT, TIMEOUTS } from "../../version.ts";
import {
  headTrackedPaths,
  isRiskyPath,
  scanCleanTargets,
  scanOrphanPackages,
} from "./deep_clean.ts";
import { invalidateBuildIntegrityCache } from "./official.ts";
import { collectCoreStatus, type CoreStatus } from "./status.ts";
import { collectLibResidue, libResidueFindings, type LibResidueReport } from "./verify.ts";
import {
  detectPnpm,
  isTransientBuildFailure,
  pickBuildErrors,
  startDshServer,
  stopDshServer,
  type StopOutcome,
} from "./finish_update.ts";
import {
  type ApplyResult,
  applyRollbackPoint,
  getRollbackPoint,
  listRollbackPoints,
  type RollbackPoint,
} from "../backup/rollback.ts";

const BUILD_ATTEMPTS = 3;

/** 步骤清单（单一事实来源：步骤表、进度、汇报共用一份）。 */
export const ROLLBACK_STEPS = [
  "停止 DSH 服务",
  "校验回滚点并执行还原（源码退回 + 构建记录还原 + 隔离区移回）",
  "清理过期缓存并按需重建产物",
  "重启服务并复核（全绿判据）",
] as const;

// ── 全绿判据（AC-C3 的「core.verify 全绿」） ─────────────────────────

/**
 * profile 维度的 findings —— 读的是真实 ~/.dsh/profiles/<profile>，
 * 与「本体回滚是否成功」无关（也没有环境变量能隔离它），两个阶段都排除。
 */
const PROFILE_FINDINGS = new Set([
  "core.plugin-declared-but-inactive",
  "core.plugin-bundled-but-undeclared",
  "core.pnpm-residue",
]);

export type GreenPhase = "pre-rebuild" | "final";

export interface GreenVerdict {
  ok: boolean;
  problems: string[];
}

/**
 * 回滚全绿判据（纯函数，便于阴阳测试）。
 *
 * phase="pre-rebuild"（apply 内部的领域验证）额外排除 core.artifacts-mismatch：
 * 重建前 dist 还是新的，官方校验报不一致是预期状态。其余维度两个阶段一致：
 *   - 本体还在、能读到 git 记录；
 *   - 构建记录的提交号与当前 HEAD 对齐（reset 后必须一致，自己算，不依赖
 *     status.needsFinishUpdate——后者会被 artifacts-mismatch 置真）；
 *   - 还原后工作树无已跟踪改动（reset --hard 的直接保证，出现即还原不完整）;
 *   - error 级 findings 清零（僵尸 lib / 缺失包 / 需要完成更新 …），排除集见上。
 */
export function rollbackGreen(
  status: CoreStatus,
  libs: LibResidueReport | null,
  phase: GreenPhase,
): GreenVerdict {
  const problems: string[] = [];

  if (!status.sourceRoot) problems.push("未找到本体源码树");
  if (libs === null) problems.push("读不到源码树的 git 记录，残留检测不可用");

  const rec = status.build?.commit ?? null;
  if (!rec) problems.push("构建记录缺少源码提交号");
  else if (!status.git?.head?.startsWith(rec)) {
    problems.push(
      `构建记录（${rec.slice(0, 12)}…）与当前源码提交（${status.git?.headShort ?? "?"}）不一致`,
    );
  }

  const dirty = status.git?.dirtyTracked ?? 0;
  if (dirty > 0) problems.push(`仍有 ${dirty} 个已跟踪文件被改动（还原未完成）`);

  const exclude: Set<string> = phase === "pre-rebuild"
    ? new Set([...PROFILE_FINDINGS, "core.artifacts-mismatch"])
    : PROFILE_FINDINGS;
  const findings: Finding[] = [...status.findings, ...(libs ? libResidueFindings(libs) : [])];
  for (const f of findings) {
    if (f.severity !== "error" || exclude.has(f.id)) continue;
    problems.push(`${f.title}（${f.id}）`);
  }

  return { ok: problems.length === 0, problems };
}

// ── 回滚点定位 ──────────────────────────────────────────────────────

interface CoreRollbackParams {
  /** 回滚点 id；缺省取最新的 kind="core-build"（finishUpdate 前置自动创建的那种）。 */
  id?: string;
}

function resolvePoint(id: string | null): RollbackPoint | null {
  if (id) return getRollbackPoint(id);
  // listRollbackPoints 按 createdAt 降序 → find 即最新
  return listRollbackPoints().find((x) => x.kind === "core-build") ?? null;
}

// ── preflight（写前检查，error 级直接拦截） ──────────────────────────

async function preflight(params: CoreRollbackParams): Promise<Finding[]> {
  const out: Finding[] = [];

  const probe = resolveDshSourceRoot();
  if (!probe) {
    out.push(
      finding("core.rollback.no-root", "error", "未找到 DSH 本体目录", {
        cause: "本机没有检测到 DSH 源码树（apps/cli 判据）",
        impact: "没有可回滚的对象",
        action: "先用「一键部署」装好 DSH，或在设置里指定本体目录",
        fixAction: "bootstrap.plan",
      }),
    );
    return out;
  }

  const head = await run("git", ["-C", probe.path, "rev-parse", "--verify", "HEAD"], {
    timeoutMs: 15_000,
    allowNonZero: true,
    scope: "git",
  });
  if (head.code !== 0) {
    out.push(
      finding("core.rollback.not-git", "error", "当前 DSH 不是 git 源码形态，无法回滚", {
        cause: "在本体目录里执行 git rev-parse HEAD 失败——不是 git 仓库，或一次提交都没有",
        impact: "回滚的逆操作是 git reset，没有 git 就没有「退回」可言",
        action: "重新完整克隆本体仓库，或改用官方安装包形态的 DSH",
        evidence: [probe.path],
      }),
    );
    return out;
  }

  const id = typeof params.id === "string" && params.id ? params.id : null;
  const pt = resolvePoint(id);
  if (!pt) {
    out.push(
      finding(
        "core.rollback.no-point",
        "error",
        id ? `回滚点不存在：${id}` : "没有可回滚的构建回滚点",
        {
          cause: id
            ? "索引里没有这个 id"
            : "回滚存储里没有 kind=core-build 的点——「完成更新」动手前才会自动创建",
          impact: "无法执行回滚",
          action: id
            ? "backup list 查看现有回滚点"
            : "还没有可回滚的节点；下次点「完成更新」前会自动创建",
          evidence: id ? [id] : [],
        },
      ),
    );
    return out;
  }

  if (pt.kind !== "core-build") {
    out.push(
      finding("core.rollback.bad-kind", "error", `回滚点类型不是 core-build：${pt.kind}`, {
        cause: "指定的回滚点不是「本体构建」类型（可能是配置/插件类的点）",
        impact: "对错类型的点执行本体回滚，逆操作与现场对不上",
        action:
          "用 backup list 找 kind=core-build 的点，或 core rollback 不带 id 取最新的构建回滚点",
        evidence: [pt.id],
      }),
    );
  }

  return out;
}

// ── 报告 ────────────────────────────────────────────────────────────

export interface CoreRollbackReport {
  rollbackId: string;
  sourceRoot: string;
  /** 逆操作要退回的目标提交（git-reset 的 commit；非 git-reset 时为 git-ref 记录值）。 */
  targetCommit: string;
  /** 逐条人话汇报。 */
  lines: string[];
  rebuild: "done" | "skipped-no-script" | "skipped-no-pnpm";
  /** 本次清理的隔离区（无垃圾要清时为 null）。 */
  quarantineDir: string | null;
  /** 最终复核是否全绿（不绿时动作已 throw，进不了报告——留字段供断言与 UI）。 */
  green: boolean;
  problems: string[];
  serviceWasRunning: boolean;
  serviceRestarted: boolean;
  head: string | null;
  elapsedMs: number;
}

// ── 小工具 ──────────────────────────────────────────────────────────

function tailLines(text: string, n: number): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-n);
}

/** 本体是否带 build 脚本——带才需要重建；测试 fixture 不带，直接跳过。 */
function hasBuildScript(root: string): boolean {
  try {
    const raw = readJson<{ scripts?: Record<string, string> }>(p(root, "package.json"));
    return typeof raw?.scripts?.build === "string" && raw.scripts.build.length > 0;
  } catch {
    return false;
  }
}

// ── 动作 ────────────────────────────────────────────────────────────

async function runRollback(
  ctx: ActionContext,
  params: CoreRollbackParams,
): Promise<CoreRollbackReport> {
  const t0 = Date.now();
  const probe = resolveDshSourceRoot();
  if (!probe) throw new Error("未找到 DSH 本体目录");
  const root = probe.path;

  const id = typeof params.id === "string" && params.id ? params.id : null;
  const pt = resolvePoint(id);
  if (!pt) throw new Error(id ? `回滚点不存在：${id}` : "没有可回滚的构建回滚点");
  if (pt.kind !== "core-build") throw new Error(`回滚点类型不是 core-build：${pt.kind}`);

  const targetCommit = pt.reverse.op === "git-reset"
    ? pt.reverse.commit
    : pt.artifacts.find((a) => a.mode === "git-ref")?.sha256 ?? "未知";

  const report: CoreRollbackReport = {
    rollbackId: pt.id,
    sourceRoot: root,
    targetCommit,
    lines: [],
    rebuild: "skipped-no-script",
    quarantineDir: null,
    green: false,
    problems: [],
    serviceWasRunning: false,
    serviceRestarted: false,
    head: null,
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  // ── ① 停止 DSH 服务 ─────────────────────────────────────────────
  ctx.step("s1", ROLLBACK_STEPS[0]);
  ctx.progress(0.05);
  let stop: StopOutcome = { wasRunning: false, stopped: 0, port: null };
  const skipSvc = Deno.env.get("BUTLER_SKIP_SERVICE_OPS") === "1";
  if (skipSvc) {
    line("停止 DSH 服务：隔离模式跳过（BUTLER_SKIP_SERVICE_OPS=1）");
  } else {
    stop = await stopDshServer();
    report.serviceWasRunning = stop.wasRunning;
    if (stop.wasRunning) {
      line(`停止 DSH 服务：已停止 ${stop.stopped} 个进程`);
      ctx.detail(`已停止 ${stop.stopped} 个进程`);
    } else {
      line("停止 DSH 服务：服务未运行，跳过");
    }
  }
  const restartPort = stop.port ?? (await findDshPort(DSH_PORT_CANDIDATES)) ?? DSH_PORT_DEFAULT;
  if (report.serviceWasRunning) {
    // 中途失败/取消时把服务拉回来（engine 失败时逆序执行补偿）
    ctx.onUndo(async () => {
      const r = await startDshServer(root, restartPort);
      ctx.log(r.ok ? `补偿：DSH 服务已恢复（${r.message}）` : `⚠️ 补偿启动服务失败：${r.message}`);
    });
  }
  ctx.throwIfCancelled();

  // ── ② 校验回滚点并执行还原 ──────────────────────────────────────
  // 库内四段闸固定顺序：完整性 → 逆操作 → 内置回读 → 领域验证（下面的回调）。
  // 任一失败：verified=false + 回滚点保留 —— 与「不静默成功」一致；
  // 不注册 onUndo：逆操作的逆操作 = 再建一个回滚点，这里不假装能撤销。
  ctx.step("s2", ROLLBACK_STEPS[1]);
  ctx.progress(0.15);
  ctx.detail(`回滚点 ${pt.id} → ${targetCommit.slice(0, 12)}…（先校验完整性，坏了不碰系统）`);
  let verifyProblems: string[] = [];
  const res: ApplyResult = await applyRollbackPoint(pt.id, {
    verify: async () => {
      const st = await collectCoreStatus();
      const libs = st.sourceRoot ? await collectLibResidue(st.sourceRoot) : null;
      const v = rollbackGreen(st, libs, "pre-rebuild");
      verifyProblems = v.problems;
      if (!v.ok) ctx.log(`回滚领域验证未通过：${v.problems.join("；")}`);
      return v.ok;
    },
  });
  if (!res.ok) {
    const extra = verifyProblems.length > 0
      ? verifyProblems.join("；")
      : (res.problems && res.problems.length > 0 ? res.problems.join("；") : "");
    throw new Error(
      `${res.error ?? "回滚失败"}${
        extra ? `：${extra}` : ""
      }（回滚点 ${pt.id} 已保留，可排查后重试）`,
    );
  }
  for (const w of res.warnings ?? []) line(`⚠ ${w}`);
  line(`还原完成：源码已退回 ${targetCommit.slice(0, 12)}…`);
  ctx.progress(0.45);
  ctx.throwIfCancelled();

  // ── ③ 清理过期缓存 + 按需重建 ───────────────────────────────────
  // 清理范围见文件头注释第 1 条：只清编译缓存与孤儿包，绝不动刚移回的源文件。
  ctx.step("s3", ROLLBACK_STEPS[2]);
  ctx.progress(0.5);
  try {
    const tracked = await headTrackedPaths(root);
    const { tsbuildinfo, stale } = scanCleanTargets(root);
    const orphans = tracked ? scanOrphanPackages(root, tracked) : [];
    const targets = [...tsbuildinfo, ...stale, ...orphans].filter((rel) => !isRiskyPath(rel));
    if (targets.length > 0) {
      const destRoot = quarantineStampDir(root, stampOf());
      Deno.mkdirSync(destRoot, { recursive: true });
      let movedN = 0;
      const failed: string[] = [];
      for (const rel of targets) {
        const from = p(root, ...rel.split("/"));
        const to = p(destRoot, ...rel.split("/"));
        Deno.mkdirSync(dirname(to), { recursive: true });
        const rec = moveSafe(from, to);
        if (rec.ok) movedN++;
        else failed.push(`${rel} — ${rec.error}`);
      }
      report.quarantineDir = destRoot;
      line(
        `清理过期缓存：已隔离 ${movedN} 项（编译缓存 ${
          tsbuildinfo.length + stale.length
        } · 孤儿包 ${orphans.length}）` +
          (failed.length ? `，${failed.length} 项未能移动` : ""),
      );
      line(`　隔离区（要还原就把里面的文件搬回原位）：${destRoot}`);
    } else {
      line("清理过期缓存：无过期编译缓存与孤儿包");
    }
  } catch (e) {
    line(`清理过期缓存：未能完成（${(e as Error).message}），继续`);
  }
  ctx.throwIfCancelled();

  if (!hasBuildScript(root)) {
    report.rebuild = "skipped-no-script";
    line("重建：本体无 build 脚本，跳过");
  } else {
    const tc = await detectPnpm();
    if (!tc) {
      report.rebuild = "skipped-no-pnpm";
      line("⚠ 重建：未找到 pnpm，跳过 —— 最终复核可能不通过，装好 pnpm 后重试即可");
    } else {
      ctx.progress(0.55);
      const inst = await run(tc.node, [tc.pnpmCjs, "install"], {
        cwd: root,
        timeoutMs: TIMEOUTS.install,
        allowNonZero: true,
        scope: "build",
        signal: ctx.signal,
      });
      if (inst.code === 0 && !inst.timedOut) line("安装 / 更新依赖：完成");
      else {line(
          `安装 / 更新依赖：${inst.timedOut ? "超时" : `退出码 ${inst.code}`}（已跳过，继续构建）`,
        );}
      ctx.throwIfCancelled();

      ctx.detail("全量重建，通常需要 5-20 分钟");
      ctx.progress(0.6);
      let outcome: RunResult | null = null;
      let attempt = 0;
      let lineCount = 0;
      for (;;) {
        attempt++;
        ctx.detail(`第 ${attempt}/${BUILD_ATTEMPTS} 次构建…`);
        outcome = await run(tc.node, [tc.pnpmCjs, "run", "build"], {
          cwd: root,
          timeoutMs: TIMEOUTS.build,
          allowNonZero: true,
          scope: "build",
          signal: ctx.signal,
          onLine: () => {
            lineCount++;
            if (lineCount % 200 === 0) ctx.detail(`构建输出 ${lineCount} 行…`);
          },
        });
        if (outcome.code === 0 || outcome.timedOut) break;
        if (
          attempt >= BUILD_ATTEMPTS ||
          !isTransientBuildFailure(outcome.stdout + "\n" + outcome.stderr)
        ) break;
        ctx.log(
          `第 ${attempt} 次撞上 Windows 并发写的瞬时拒绝（换个包再来一次通常就过），正在重试…`,
        );
      }
      ctx.throwIfCancelled();
      if (!outcome || outcome.timedOut || outcome.code !== 0) {
        const text = (outcome?.stdout ?? "") + "\n" + (outcome?.stderr ?? "");
        const errs = pickBuildErrors(text);
        const brief = errs.length > 0 ? errs.slice(0, 12) : tailLines(text, 12);
        const why = outcome?.timedOut
          ? `超过 ${Math.round(TIMEOUTS.build / 60_000)} 分钟未结束`
          : `退出码 ${outcome?.code ?? -1}`;
        throw new Error(
          `源码已还原，但重建失败（${why}）。从构建日志里定位到的报错：\n${brief.join("\n")}\n\n` +
            `产物可能处于新旧混合状态——建议把上面的报错发给知行排查。`,
        );
      }
      invalidateBuildIntegrityCache();
      report.rebuild = "done";
      line("重建：完成");
    }
  }
  ctx.progress(0.85);
  ctx.throwIfCancelled();

  // ── ④ 重启服务 + 最终复核（AC-C3 的「全绿」） ─────────────────────
  ctx.step("s4", ROLLBACK_STEPS[3]);
  ctx.progress(0.9);
  if (report.serviceWasRunning) {
    const started = await startDshServer(root, restartPort);
    if (!started.ok) {
      throw new Error(
        `源码已还原，但重启服务失败：${started.message}\n可在面板上用「启动」按钮手动启动。`,
      );
    }
    report.serviceRestarted = true;
    line(`重启 DSH 服务：${started.message}`);
  } else {
    line("重启 DSH 服务：无需重启");
  }

  const st = await collectCoreStatus();
  const libs = st.sourceRoot ? await collectLibResidue(st.sourceRoot) : null;
  const verdict = rollbackGreen(st, libs, "final");
  report.problems = verdict.problems;
  report.head = st.git?.head ?? null;
  if (!verdict.ok) {
    // 回滚点保留（apply 已成功、这里是复核不过）——绝不静默成功
    throw new Error(
      `回滚已执行，但最终复核未通过：\n${verdict.problems.map((x) => `· ${x}`).join("\n")}\n` +
        `回滚点 ${pt.id} 已保留；需要重建的话点「完成更新」，或把上面的信息发给知行。`,
    );
  }
  report.green = true;
  line(`复核通过：源码已回到 ${targetCommit.slice(0, 12)}…，core.verify 全绿`);
  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

export const coreRollbackAction: ActionDef<CoreRollbackParams, CoreRollbackReport> = {
  name: "core.rollback",
  domain: "core",
  title: "回滚本体到操作前状态",
  description:
    "把 DSH 本体回滚到最近的构建回滚点：源码退回 + 构建记录还原 + 隔离区内容移回 → 清过期缓存 → 按需重建 → 复核全绿。验证不过保留回滚点，绝不静默成功。",
  readonly: false,
  steps: [...ROLLBACK_STEPS],
  preflight,
  run: (ctx, params) => runRollback(ctx, params),
  // 与 finishUpdate 同预算：回滚也含 install + 全量重建，最坏 2 小时
  timeoutMs: 7_200_000,
};
