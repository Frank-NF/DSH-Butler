/**
 * core.update —— 「更新 DSH 本体」：git pull + 完整重建（对齐铁律 9）。
 *
 * 铁律 9 原话：「更新 DSH 本体必须走完整 4 步（pull → 装依赖 → 全量重建 →
 * 重启），不能只 git pull」。本动作就是那条铁律的执行体：
 *
 *   写前回滚点（reverse 钉【旧 commit】）→ 停服 → git pull --ff-only
 *     → 尾段（清理 → 装依赖 → 全量重建 → 核对 → 重启 → 收尾复核）
 *
 * 尾段与 core.finishUpdate 共用 runFinishTail 同一份实现（防语义漂移）——
 * 本文件只负责 update 特有的三段：回滚点、停服、拉取。
 *
 * 三个语义决定：
 *
 *   1) 【回滚点钉旧 commit】。reverse.op = git-reset 的 commit 必须在创建时
 *      写对（rollback.ts 没有事后改写接口），而 pull 会移动 HEAD —— 所以在
 *      pull 之前 rev-parse 拿到旧提交号再创建。更新出问题，一键还原的落点
 *      就是「更新前的那个提交」。
 *
 *   2) 【pull --ff-only，失败 = 致命，树不变】。非快进（本地有分叉提交）或
 *      网络失败时 git 一个字节都不改，此时直接抛错：服务已被 s2 停掉，
 *      engine 逆序执行 onUndo 把服务拉回来。v1 不做镜像/分叉回退 ——
 *      本体仓库本就不该有本地提交（有改动先提交或丢弃，preflight 会拦）。
 *
 *   3) 【拉取后始终跑尾段】。远端无新提交（Already up to date）也照跑 ——
 *      对齐铁律 9 的完整四步，行为可预期；顺带保证产物与源码一致
 *      （「是否拿到新版本」的判据是构建记录 commit，不是 pull 的输出）。
 *
 * 写前检查（preflight）= finish 三条硬检查（root / git 形态 / pnpm）
 * + 工作区脏检查：已跟踪文件有未提交改动就拒绝 —— 带着本地改动重建会让
 * 产物与提交号对不上，回滚语义也随之混乱（untracked 不拦：仓库里产物类
 * 未跟踪文件是常态，拦它这功能永远用不了；与 core.status 的 dirtyTracked
 * 同口径）。run 内 pull 前还会再查一次（防 preflight 与执行之间的空窗）。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { run } from "../../host/shell.ts";
import { isFile } from "../../host/fs.ts";
import { findDshPort } from "../../host/port.ts";
import { p, quarantineStampDir, resolveDshSourceRoot, stampOf } from "../../util/paths.ts";
import { DSH_PORT_CANDIDATES, DSH_PORT_DEFAULT, TIMEOUTS } from "../../version.ts";
import { createRollbackPoint } from "../backup/rollback.ts";
import {
  detectPnpm,
  finishPreflightBase,
  type FinishUpdateReport,
  runFinishTail,
  startDshServer,
  stopDshServer,
} from "./finish_update.ts";

/** 八步清单（单一事实来源：步骤表、进度、汇报共用一份）。 */
export const UPDATE_STEPS = [
  "创建写前回滚点",
  "停止 DSH 服务",
  "拉取最新源码（git pull --ff-only）",
  "清理残留（隔离不属于当前版本的文件、清掉上游已删的孤儿包、作废编译缓存）",
  "安装 / 更新依赖",
  "全量重建（原生组件 + 主进程 + 界面模块 + 网页外壳）",
  "核对产物与源码是否一致",
  "重启 DSH 服务",
] as const;

// ── 报告 ────────────────────────────────────────────────────────────

export interface CoreUpdateReport extends FinishUpdateReport {
  /** 更新前 HEAD（也是回滚点 reverse 钉住的提交）。 */
  fromCommit: string;
  /** 更新后 HEAD（与 fromCommit 相同 = 远端暂无新提交）。 */
  toCommit: string;
}

// ── preflight（写前检查，error 级直接拦截） ──────────────────────────

/** 工作区脏检查的判据（与 run 内 pull 前的复查同一口径，只看已跟踪文件）。 */
async function dirtyTrackedFiles(
  root: string,
): Promise<{ ok: boolean; files: string[]; error?: string }> {
  const st = await run("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], {
    timeoutMs: 30_000,
    allowNonZero: true,
    scope: "git",
  });
  if (st.code !== 0) {
    return {
      ok: false,
      files: [],
      error: `git status 退出码 ${st.code}：${st.stderr.trim() || "无输出"}`,
    };
  }
  const files = st.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { ok: files.length === 0, files };
}

async function updatePreflight(): Promise<Finding[]> {
  const out = await finishPreflightBase();
  if (out.some((f) => f.severity === "error")) return out;

  const probe = resolveDshSourceRoot();
  if (!probe) return out; // 基座已报 no-root，这里纯防御

  const dirty = await dirtyTrackedFiles(probe.path);
  if (!dirty.ok) {
    out.push(
      dirty.error
        ? finding("core.update.status-failed", "error", "无法确认工作区状态，拒绝更新", {
          cause: `执行 git status --porcelain -uno 失败：${dirty.error}`,
          impact: "不知道工作区干不干净就不敢拉取 —— 万一带着本地改动重建，产物会与提交号对不上",
          action: "在本体目录手动跑一次 git status 排查（仓库损坏或磁盘问题）后重试",
          evidence: [probe.path],
        })
        : finding(
          "core.update.dirty-tree",
          "error",
          `工作区有 ${dirty.files.length} 个未提交改动，拒绝直接更新`,
          {
            cause: `这些已跟踪文件被改动过：${dirty.files.slice(0, 10).join("、")}${
              dirty.files.length > 10 ? " …" : ""
            }`,
            impact: "带着本地改动拉取/重建，产物会与提交号对不上，回滚语义也随之混乱",
            action: "先把改动提交（git add + commit），或丢弃（git checkout -- <文件>），再更新",
            evidence: dirty.files.slice(0, 20),
          },
        ),
    );
  }
  return out;
}

// ── helpers ───────────────────────────────────────────────────────────

function tailOf(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(-3).join(" / ") || "无输出";
}

// ── run ───────────────────────────────────────────────────────────────

async function runCoreUpdate(ctx: ActionContext): Promise<CoreUpdateReport> {
  const t0 = Date.now();
  const probe = resolveDshSourceRoot();
  if (!probe) throw new Error("未找到 DSH 本体目录");
  const root = probe.path;
  const tc = await detectPnpm();
  if (!tc) throw new Error("没找到 pnpm，请先安装后重试");

  const stamp = stampOf();
  const destRoot = quarantineStampDir(root, stamp);

  // ── s1 写前回滚点（reverse 钉旧 commit —— 见头注释语义决定 1） ──
  ctx.step("s1", UPDATE_STEPS[0]);
  ctx.progress(0.05);
  const headR = await run("git", ["-C", root, "rev-parse", "HEAD"], {
    timeoutMs: 15_000,
    allowNonZero: true,
    scope: "git",
  });
  if (headR.code !== 0 || !headR.stdout.trim()) {
    throw new Error("无法解析当前提交（git rev-parse HEAD 失败），拒绝在没有回滚点的情况下更新");
  }
  const fromCommit = headR.stdout.trim();
  const buildRecord = p(root, ".dsh-build", "client-build-environment.json");
  const pt = await createRollbackPoint({
    kind: "core-build",
    trigger: "core.update 前置",
    jobId: ctx.jobId,
    artifacts: [
      { path: root, mode: "git-ref", ref: fromCommit },
      ...(isFile(buildRecord) ? [{ path: buildRecord, mode: "copy" as const }] : []),
    ],
    reverse: { op: "git-reset", commit: fromCommit, quarantine: destRoot },
  });
  ctx.log(`回滚点已创建：${pt.id}（更新出问题可一键还原到 ${fromCommit.slice(0, 12)}…）`);

  const report: CoreUpdateReport = {
    sourceRoot: root,
    rollbackId: pt.id,
    quarantineDir: null,
    clean: null,
    lines: [],
    verify: null,
    serviceWasRunning: false,
    serviceRestarted: false,
    needsFinishUpdateAfter: false,
    head: null,
    elapsedMs: 0,
    fromCommit,
    toCommit: fromCommit,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  // ── s2 停服（失败警告继续；停过就注册补偿，致命失败前把服务拉回来） ──
  ctx.step("s2", UPDATE_STEPS[1]);
  ctx.progress(0.1);
  const stop = await stopDshServer();
  const port = stop.port ?? (await findDshPort(DSH_PORT_CANDIDATES)) ?? DSH_PORT_DEFAULT;
  report.serviceWasRunning = stop.wasRunning;
  if (stop.wasRunning) {
    ctx.onUndo(async () => {
      const r = await startDshServer(root, port);
      ctx.log(r.ok ? `补偿：DSH 服务已恢复（${r.message}）` : `⚠️ 补偿启动服务失败：${r.message}`);
    });
    line(`停止 DSH 服务：已停止 ${stop.stopped} 个进程`);
    ctx.detail(`已停止 ${stop.stopped} 个进程，服务端口 ${port}`);
  } else {
    line("停止 DSH 服务：服务未运行，跳过");
    ctx.detail("服务未在运行");
  }
  ctx.throwIfCancelled();

  // ── s3 拉取最新源码（致命；ff-only 失败树不变 —— 语义决定 2） ──
  ctx.step("s3", UPDATE_STEPS[2]);
  ctx.progress(0.2);
  const dirty = await dirtyTrackedFiles(root);
  if (!dirty.ok) {
    throw new Error(
      dirty.error
        ? `无法确认工作区状态（${dirty.error}），拒绝拉取（服务将自动恢复）`
        : `工作区有 ${dirty.files.length} 个已跟踪文件被改动（如 ${
          dirty.files.slice(0, 5).join("、")
        }），` +
          "拒绝拉取 —— 先提交或丢弃改动（服务将自动恢复）",
    );
  }
  const pull = await run("git", ["-C", root, "pull", "--ff-only"], {
    timeoutMs: TIMEOUTS.install,
    allowNonZero: true,
    scope: "git",
    signal: ctx.signal,
  });
  if (pull.code !== 0 || pull.timedOut) {
    throw new Error(
      `拉取最新源码失败（${
        pull.timedOut ? `超过 ${Math.round(TIMEOUTS.install / 60_000)} 分钟` : `退出码 ${pull.code}`
      }）：${
        tailOf(pull.stderr || pull.stdout)
      }\n（工作区未被改动，服务将自动恢复；检查网络后重试）`,
    );
  }
  const head2 = await run("git", ["-C", root, "rev-parse", "HEAD"], {
    timeoutMs: 15_000,
    allowNonZero: true,
    scope: "git",
  });
  report.toCommit = head2.code === 0 && head2.stdout.trim() ? head2.stdout.trim() : fromCommit;
  if (report.toCommit !== fromCommit) {
    line(`拉取最新源码：${fromCommit.slice(0, 12)}… → ${report.toCommit.slice(0, 12)}…`);
  } else {
    line("拉取最新源码：远端暂无新提交（已是最新）—— 仍继续完整重建，保证产物与源码一致");
  }
  ctx.throwIfCancelled();

  // ── s4..s8 共享尾段（铁律 9：pull 后必须走完整四步，不是只拉代码） ──
  await runFinishTail({
    ctx,
    root,
    tc,
    destRoot,
    restartPort: port,
    report,
    line,
    stepIds: ["s4", "s5", "s6", "s7", "s8"],
    stepTitles: [
      UPDATE_STEPS[3],
      UPDATE_STEPS[4],
      UPDATE_STEPS[5],
      UPDATE_STEPS[6],
      UPDATE_STEPS[7],
    ],
    // 尾段内部进度（finish 口径 0..1）线性映射到 0.3..1.0 —— 防止 pull 完
    // 进度条从尾段起点倒退回更小的值（progress 不强制单调，倒退难看）。
    mapProgress: (v) => 0.3 + v * 0.7,
  });
  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// ── 动作定义 ────────────────────────────────────────────────────────

export const coreUpdateAction: ActionDef<Record<string, never>, CoreUpdateReport> = {
  name: "core.update",
  domain: "core",
  title: "更新 DSH 本体（拉取 + 完整重建）",
  description:
    "写前回滚点（钉住旧提交）→ 停服 → git pull --ff-only → 深度清理 → 装依赖 → 官方全量重建 → 核对 → 重启。铁律 9：更新必须走完整四步，绝不是只拉代码；工作区有未提交改动时拒绝执行。",
  readonly: false,
  steps: [...UPDATE_STEPS],
  preflight: updatePreflight,
  run: (ctx) => runCoreUpdate(ctx),
  // 八步最坏预算：拉取 15 分钟 + 装依赖 15 分钟 + 3×构建 30 分钟 + 余量
  timeoutMs: 7_200_000,
};
