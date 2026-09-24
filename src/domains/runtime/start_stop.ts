/**
 * runtime.start / runtime.stop —— 服务的启停开关。
 *
 * 为什么要单独有这两个（restart 已经能覆盖大部分场景）：
 *   「停」是用户真的会用的动作（省内存、断网跑、排查端口冲突），而 restart 的语义是
 *   "停了立刻再起来"，拿去当停止用会误导人；「启」也一样 —— 服务没在跑时点 restart
 *   虽然也能起来，但按钮上写"重启"没人敢点。
 *
 * 两个动作都只动服务进程，不碰源码与依赖；四步/三步清单是单一事实来源。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { resolveDshSourceRoot } from "../../util/paths.ts";
import { loadConfig } from "../state/config.ts";
import { startDshServer, stopDshServer } from "../core/finish_update.ts";
import { collectRuntimeStatus } from "./status.ts";
import { DSH_PORT_DEFAULT, TIMEOUTS } from "../../version.ts";

// ── runtime.start ────────────────────────────────────────────────────

export const START_STEPS = ["确认本体与端口", "启动 DSH 服务", "等待服务就绪"] as const;

export interface RuntimeStartParams {
  port?: number;
}

export interface RuntimeStartReport {
  root: string;
  port: number;
  started: boolean;
  message: string;
  healthy: boolean;
  /** 已经在跑的话这里为 true —— 幂等，不算错误。 */
  wasAlreadyRunning: boolean;
  lines: string[];
  elapsedMs: number;
}

async function startPreflight(): Promise<Finding[]> {
  const out: Finding[] = [];
  if (!resolveDshSourceRoot()) {
    out.push(
      finding("runtime.start.no-root", "error", "未找到 DSH 本体目录", {
        cause: "本机没有检测到含 apps/cli 的 DSH 源码树",
        impact: "不知道要启动什么",
        action: "先用「一键部署」装好本体",
        fixAction: "bootstrap.plan",
      }),
    );
  }
  return out;
}

async function runStart(
  ctx: ActionContext,
  params: RuntimeStartParams,
): Promise<RuntimeStartReport> {
  const t0 = Date.now();
  const probe = resolveDshSourceRoot();
  if (!probe) throw new Error("未找到 DSH 本体目录");

  const report: RuntimeStartReport = {
    root: probe.path,
    port: params.port ?? loadConfig().dshPort ?? DSH_PORT_DEFAULT,
    started: false,
    message: "",
    healthy: false,
    wasAlreadyRunning: false,
    lines: [],
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  ctx.step("s1", START_STEPS[0]);
  ctx.progress(0.2);
  const before = await collectRuntimeStatus().catch(() => null);
  if (before?.running) {
    report.wasAlreadyRunning = true;
    report.healthy = Boolean(before.health?.reachable);
    line(`服务已经在运行（PID ${before.pid ?? "?"} · 端口 ${before.port ?? "?"}），无需重复启动`);
    report.started = true;
    report.message = "已在运行";
    report.elapsedMs = Date.now() - t0;
    ctx.progress(1);
    return report;
  }
  if (before?.port) report.port = before.port;
  line(`准备启动：端口 ${report.port}`);
  ctx.throwIfCancelled();

  ctx.step("s2", START_STEPS[1]);
  ctx.progress(0.5);
  const started = await startDshServer(probe.path, report.port);
  report.started = started.ok;
  report.message = started.message ?? "";
  line(`启动结果：${started.message || (started.ok ? "已启动" : "失败")}`);
  if (!started.ok) throw new Error(`启动失败：${started.message}`);
  ctx.throwIfCancelled();

  ctx.step("s3", START_STEPS[2]);
  ctx.progress(0.9);
  const after = await collectRuntimeStatus().catch(() => null);
  report.healthy = Boolean(after?.running && after.health?.reachable);
  line(
    report.healthy
      ? `服务就绪：端口 ${after?.port ?? report.port} · HTTP ${after?.health?.status}`
      : "进程起来了但 HTTP 还没通（DSH 首次启动可能要几秒）",
  );
  report.elapsedMs = Date.now() - t0;
  ctx.progress(1);
  return report;
}

export const runtimeStartAction: ActionDef<RuntimeStartParams, RuntimeStartReport> = {
  name: "runtime.start",
  domain: "runtime",
  title: "启动 DSH 服务",
  description: "把 DSH 服务起起来并等它就绪。已经在跑时什么都不做（幂等）。",
  readonly: false,
  steps: [...START_STEPS],
  preflight: async () => await startPreflight(),
  run: async (ctx, params) => await runStart(ctx, params ?? {}),
  timeoutMs: TIMEOUTS.install,
};

// ── runtime.stop ─────────────────────────────────────────────────────

export const STOP_STEPS = ["确认服务现状", "停止 DSH 服务"] as const;

export interface RuntimeStopParams {
  /** 显式确认（界面/托盘都会带；CLI 需要 --yes）。 */
  confirm?: boolean;
}

export interface RuntimeStopReport {
  wasRunning: boolean;
  stopped: number;
  lines: string[];
  elapsedMs: number;
}

async function stopPreflight(): Promise<Finding[]> {
  const out: Finding[] = [];
  const st = await collectRuntimeStatus().catch(() => null);
  if (!st?.running) {
    // 没在跑不算错误，但要说清楚 —— 否则用户会以为按钮坏了
    out.push(
      finding("runtime.stop.not-running", "info", "DSH 服务当前没有在运行", {
        cause: "没有检测到 DSH 服务进程",
        impact: "没有需要停止的东西",
        action: "无需处理；要启动就点「启动服务」",
      }),
    );
  }
  return out;
}

async function runStop(ctx: ActionContext, _params: RuntimeStopParams): Promise<RuntimeStopReport> {
  const t0 = Date.now();
  const report: RuntimeStopReport = { wasRunning: false, stopped: 0, lines: [], elapsedMs: 0 };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  ctx.step("s1", STOP_STEPS[0]);
  ctx.progress(0.4);
  const before = await collectRuntimeStatus().catch(() => null);
  report.wasRunning = Boolean(before?.running);
  line(
    report.wasRunning
      ? `服务正在运行（PID ${before?.pid ?? "?"} · 端口 ${before?.port ?? "?"}）`
      : "服务本来就没有在运行",
  );
  ctx.throwIfCancelled();

  ctx.step("s2", STOP_STEPS[1]);
  ctx.progress(0.8);
  const stopped = await stopDshServer();
  report.stopped = stopped.stopped;
  report.wasRunning = report.wasRunning || stopped.wasRunning;
  line(stopped.stopped > 0 ? `已停止 ${stopped.stopped} 个进程` : "没有需要停止的进程");

  report.elapsedMs = Date.now() - t0;
  ctx.progress(1);
  return report;
}

export const runtimeStopAction: ActionDef<RuntimeStopParams, RuntimeStopReport> = {
  name: "runtime.stop",
  domain: "runtime",
  title: "停止 DSH 服务",
  description: "停掉所有 DSH 服务进程。不删任何文件，随时可以用「启动服务」拉回来。",
  readonly: false,
  steps: [...STOP_STEPS],
  preflight: async () => await stopPreflight(),
  run: async (ctx, params) => await runStop(ctx, params ?? {}),
  timeoutMs: TIMEOUTS.install,
};
