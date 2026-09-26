/**
 * plugin.batchUpdate —— 插件批量更新 + 更新前后验证（P1-3）。
 *
 * 【为什么这是管家最硬的一格】
 * 官方 Web 的插件页能一个个点更新，但**没有人替用户确认「更新完 DSH 还起得来」**。
 * 真实事故（2026-08-31 的十二起插件故障、2026-09-25 本机那次 ERESOLVE）：插件更新失败或
 * 更新后互相打架，用户看到的是「DSH 打不开了」，却不知道该退哪一个、退到哪。
 *
 * 这个动作把流程钉成一条安全链：
 *   ① 先算出哪些插件**真有**更新（不猜、不挨个盲装）
 *   ② 更新前留【整批】回滚点 + 记录更新前状态（在不在跑、端口、HTTP 通不通）
 *   ③ 停服 → 顺序逐个更新（npm 不允许同目录并发）
 *   ④ 重启并轮询体检
 *   ⑤ 任一环节不通过 → **自动整批回退**（还原清单与锁 → 把依赖拉回一致 → 重启 → 复检），
 *      并把失败插件的原始报错翻成人话（复用 P0-2 的错误翻译器）
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { isFile, readJson } from "../../host/fs.ts";
import { runCmd } from "../../host/shell.ts";
import { dshProfileDir, p } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";
import { checkUpdates } from "../../net/npm-registry.ts";
import { collectRuntimeStatus, healthCheck } from "../runtime/status.ts";
import { startDshServer, stopDshServer } from "../core/finish_update.ts";
import { applyRollbackPoint } from "../backup/rollback.ts";
import { explainErrorText } from "../../util/error-translate.ts";
import {
  createManifestPoint,
  npmSourceArgs,
  pmEnvReady,
  pmSkipped,
  pmSync,
  profileManifestPath,
} from "./mutate.ts";
import { resolveDshSourceRoot } from "../../util/paths.ts";

export interface BatchUpdateParams {
  /** 只更新这些插件（省略 = 所有可更新的）。 */
  names?: string[];
}

export interface BatchTarget {
  name: string;
  from: string;
  to: string;
}

export interface BatchUpdateReport {
  targets: BatchTarget[];
  results: Array<{ name: string; from: string; to: string; ok: boolean; error?: string; explained?: string }>;
  rollbackPointId: string | null;
  before: { running: boolean; port: number | null; reachable: boolean };
  after: { running: boolean; port: number | null; reachable: boolean };
  /** ok = 更新完还能正常起来；rolled-back = 起不来已自动退回；verify-failed = 退回后仍不正常。 */
  verdict: "ok" | "rolled-back" | "verify-failed";
  lines: string[];
}

/** 纯函数：从「更新查询结果 + 已装版本」里挑出要更新的目标（便于测试）。 */
export function pickTargets(
  updates: Record<string, { current: string; latest: string; outdated: boolean }>,
  names?: string[],
): BatchTarget[] {
  const only = names && names.length ? new Set(names) : null;
  return Object.entries(updates)
    .filter(([n, u]) => u.outdated && (!only || only.has(n)))
    .map(([name, u]) => ({ name, from: u.current, to: u.latest }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── preflight ───────────────────────────────────────────────────────

async function batchPreflight(params: BatchUpdateParams): Promise<Finding[]> {
  const out: Finding[] = [];
  const profileDir = dshProfileDir();
  const manifestPath = profileManifestPath(profileDir);
  if (!isFile(manifestPath)) {
    out.push(
      finding("plugin.no-manifest", "error", "找不到插件清单（profile 的 package.json）", {
        cause: `以下位置不存在或不可读：${manifestPath}`,
        impact: "没有清单就不知道该更新什么",
        action: "先确认 DSH 已安装并至少启动过一次",
        evidence: [manifestPath],
      }),
    );
    return out;
  }
  const manifest = readJson<{ dependencies?: Record<string, string> }>(manifestPath) ?? {};
  const installed = manifest.dependencies ?? {};
  const total = Object.keys(installed).length;
  const wanted = params.names && params.names.length ? params.names : Object.keys(installed);
  const res = await checkUpdates(installed, wanted);
  const targets = pickTargets(res.updates, params.names);
  if (targets.length === 0) {
    out.push(
      finding("plugin.no-updates", "warn", `没有可更新的插件（已检查 ${res.checked} 个）`, {
        cause: "所有插件的当前版本都已是最新",
        impact: "这个动作会什么都不做",
        action: "无需处理",
      }),
    );
    return out;
  }
  const st = await collectRuntimeStatus();
  out.push(
    finding("plugin.batch-plan", "info", `将更新 ${targets.length} 个插件：${targets.map((t) => `${t.name} ${t.from}→${t.to}`).join("、")}`, {
      cause: `profile 里共装了 ${total} 个插件，其中这些有新版本`,
      impact: st.running
        ? `会先停掉正在运行的 DSH 服务（端口 ${st.port}），更新后自动重启并体检；起不来会自动整批回退`
        : "DSH 服务当前没在跑；更新后会尝试启动并体检，起不来会自动整批回退",
      action: "确认这些版本是你想要的，再继续",
      evidence: targets.slice(0, 10).map((t) => `${t.name}：${t.from} → ${t.to}`),
    }),
  );
  return out;
}

// ── run ─────────────────────────────────────────────────────────────

async function pollHealthy(port: number | null, timeoutMs: number): Promise<boolean> {
  if (!port) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await healthCheck(port);
    if (h.reachable) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function runBatchUpdate(ctx: ActionContext, params: BatchUpdateParams): Promise<BatchUpdateReport> {
  const profileDir = dshProfileDir();
  const manifestPath = profileManifestPath(profileDir);
  const lines: string[] = [];
  const line = (s: string) => {
    lines.push(s);
    ctx.log(s);
  };
  const report: BatchUpdateReport = {
    targets: [],
    results: [],
    rollbackPointId: null,
    before: { running: false, port: null, reachable: false },
    after: { running: false, port: null, reachable: false },
    verdict: "ok",
    lines,
  };

  // ── s1 算清要更新谁 ──
  ctx.step("s1", "检查可更新插件");
  ctx.progress(0.08);
  const manifest = readJson<{ dependencies?: Record<string, string> }>(manifestPath) ?? {};
  const installed = manifest.dependencies ?? {};
  const wanted = params.names && params.names.length ? params.names : Object.keys(installed);
  const res = await checkUpdates(installed, wanted);
  const targets = pickTargets(res.updates, params.names);
  report.targets = targets;
  if (targets.length === 0) throw new Error(`没有可更新的插件（已检查 ${res.checked} 个）`);
  line(`可更新 ${targets.length} 个：${targets.map((t) => `${t.name} ${t.from}→${t.to}`).join("；")}`);
  ctx.throwIfCancelled();

  // ── s2 更新前：快照 + 整批回滚点 ──
  ctx.step("s2", "更新前留整批回滚点");
  ctx.progress(0.2);
  const stBefore = await collectRuntimeStatus();
  report.before = {
    running: stBefore.running,
    port: stBefore.port,
    reachable: stBefore.running && stBefore.health ? stBefore.health.reachable : false,
  };
  line(`更新前：服务${report.before.running ? `运行中（端口 ${report.before.port}）` : "未运行"}`);
  report.rollbackPointId = await createManifestPoint(
    manifestPath,
    profileDir,
    `plugin.batchUpdate 前置（批量更新 ${targets.length} 个插件）`,
  );
  line(`已留整批回滚点：${report.rollbackPointId}（清单 + 锁文件）`);
  const pointId = report.rollbackPointId;
  ctx.onUndo(async () => {
    if (!pointId) return;
    const r = await applyRollbackPoint(pointId);
    ctx.log(r.ok ? `已回退到更新前的状态（回滚点 ${pointId}）` : `⚠ 回退失败：${r.error ?? "未知原因"}`);
  });
  ctx.throwIfCancelled();

  // ── s3 停服 + 逐个更新 ──
  ctx.step("s3", "逐个更新插件");
  ctx.progress(0.35);
  const stop = await stopDshServer();
  if (stop.wasRunning) line(`已停掉 DSH 服务（原端口 ${stop.port}，停了 ${stop.stopped} 个进程）`);
  const port = stop.port ?? report.before.port ?? null;

  pmEnvReady();
  const skipped = pmSkipped();
  let okCount = 0;
  for (const t of targets) {
    ctx.throwIfCancelled();
    const spec = `${t.name}@${t.to}`;
    const item = { name: t.name, from: t.from, to: t.to, ok: false as boolean, error: undefined as string | undefined, explained: undefined as string | undefined };
    if (skipped) {
      line(`（测试模式：跳过真实安装 ${spec}）`);
      item.ok = true;
      okCount++;
      report.results.push(item);
      continue;
    }
    ctx.detail(`正在更新 ${t.name} → ${t.to}（${okCount + 1}/${targets.length}）`);
    const r = await runCmd(
      ["npm", "install", spec, "--prefix", profileDir, "--no-audit", "--no-fund", ...npmSourceArgs(), "--legacy-peer-deps", "--loglevel", "error"],
      { timeoutMs: TIMEOUTS.install, allowNonZero: true, scope: "plugin", signal: ctx.signal },
    );
    if (r.code === 0) {
      item.ok = true;
      okCount++;
      line(`✓ ${t.name} ${t.from} → ${t.to}`);
    } else {
      const raw = `${(r.stderr || r.stdout).trim()}`.split("\n").slice(-8).join("\n");
      item.error = raw || `退出码 ${r.code}`;
      item.explained = explainErrorText(item.error) ?? undefined;
      line(`✗ ${t.name} 更新失败：${item.error.split("\n").slice(-2).join(" / ")}`);
    }
    report.results.push(item);
    if (!item.ok) break; // 第一个失败就停手，剩下的交给回退
  }
  ctx.progress(0.6);
  ctx.throwIfCancelled();

  // ── s4 重启 + 体检 ──
  ctx.step("s4", "重启并体检");
  ctx.progress(0.75);
  const root = resolveDshSourceRoot()?.path ?? null;
  let started = false;
  if (root && port) {
    const r = await startDshServer(root, port);
    started = r.ok;
    line(r.ok ? `已重启 DSH 服务（端口 ${port}）` : `重启失败：${r.message}`);
  } else {
    line("拿不到 DSH 本体目录或端口，跳过重启（请在面板手动启动后自行确认）");
  }
  const reachable = started ? await pollHealthy(port, 60_000) : false;
  const stAfter = await collectRuntimeStatus();
  report.after = { running: stAfter.running, port: stAfter.port, reachable };
  line(`更新后体检：进程${stAfter.running ? "在" : "不在"}，HTTP ${reachable ? "可达" : "不可达"}`);

  // ── s5 结论：不通过就整批回退 ──
  ctx.step("s5", "结论与必要的回退");
  ctx.progress(0.9);
  if (okCount === targets.length && reachable) {
    report.verdict = "ok";
    line("结论：全部更新成功，DSH 正常起来 ✓");
  } else {
    line("结论：这批更新没通过验证，开始自动整批回退……");
    const rb = pointId ? await applyRollbackPoint(pointId) : { ok: false, error: "没有回滚点" };
    if (rb.ok) {
      line(`已还原更新前的清单与锁（回滚点 ${pointId}）`);
      try {
        await pmSync(profileDir, ctx.signal);
        line("已把依赖树拉回与清单一致");
      } catch (e) {
        line(`⚠ 依赖树同步失败：${(e as Error).message}（清单已还原，可手动重装）`);
      }
      if (root && port) {
        const r2 = await startDshServer(root, port);
        line(r2.ok ? `回退后已重启 DSH（端口 ${port}）` : `回退后重启失败：${r2.message}`);
        const ok2 = r2.ok ? await pollHealthy(port, 60_000) : false;
        report.after = { running: (await collectRuntimeStatus()).running, port, reachable: ok2 };
        report.verdict = ok2 ? "rolled-back" : "verify-failed";
      } else {
        report.verdict = "rolled-back";
      }
    } else {
      report.verdict = "verify-failed";
      line(`⚠ 自动回退失败：${rb.error ?? "未知原因"}（回滚点 ${pointId} 仍在，可手动用「回滚点」页还原）`);
    }
    const bad = report.results.find((x) => !x.ok);
    if (bad) line(`没通过的插件：${bad.name}（${bad.from} → ${bad.to}）`);
    line(report.verdict === "rolled-back" ? "结论：已退回更新前状态，DSH 可用 ✓" : "结论：回退后仍未通过体检，请用回滚点页手动还原并检查");
  }
  ctx.progress(1);
  return report;
}

export const pluginBatchUpdateAction: ActionDef<BatchUpdateParams, BatchUpdateReport> = {
  name: "plugin.batchUpdate",
  domain: "plugin",
  title: "批量更新插件（更新前后验证）",
  description:
    "算出所有真有更新的插件，更新前留一个整批回滚点，停服→逐个更新→重启并体检；只要有一个插件装不上、或者更新后 DSH 起不来，就自动把整批退回更新前状态并把失败原因翻成人话。",
  readonly: false,
  steps: ["检查可更新插件", "更新前留整批回滚点", "逐个更新插件", "重启并体检", "结论与必要的回退"],
  preflight: batchPreflight,
  run: (ctx, params) => runBatchUpdate(ctx, params),
  timeoutMs: TIMEOUTS.install * 2,
};
