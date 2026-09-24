/**
 * runtime.restart —— 重启 DSH 服务。
 *
 * 为什么单独做一个动作（而不是让调用方自己 stop + start）：
 *   托盘菜单、「运行状态」页的按钮、命令行都要这一件事。三处各拼一遍的话，
 *   "端口从哪来""停完等多久""起没起来怎么判"必然各写各的，最后语义漂移。
 *
 * 语义（与旧版一致）：
 *   - 端口优先沿用"停之前服务正在用的那个"，其次用参数，最后用默认 3081；
 *   - 启动判定走 startDshServer 自己的轮询（端口被 DSH 自己占着也算成功，幂等）；
 *   - 起来之后再跑一次健康检查，把"进程活着但 HTTP 不通"这种情况如实报出来。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { collectRuntimeStatus } from "./status.ts";
import { startDshServer, stopDshServer } from "../core/finish_update.ts";
import { resolveDshSourceRoot } from "../../util/paths.ts";
import { DSH_PORT_DEFAULT, TIMEOUTS } from "../../version.ts";

export const RESTART_STEPS = [
  "确认本体与服务现状",
  "停止 DSH 服务",
  "启动 DSH 服务",
  "等待服务就绪",
] as const;

export interface RuntimeRestartParams {
  /** 指定端口；不给就沿用服务原本占用的端口，再不给用 3081。 */
  port?: number;
}

export interface RuntimeRestartReport {
  root: string;
  port: number;
  wasRunning: boolean;
  stopped: number;
  started: boolean;
  message: string;
  /** 起来之后 HTTP 是否真的能通。 */
  healthy: boolean;
  lines: string[];
  elapsedMs: number;
}

async function restartPreflight(): Promise<Finding[]> {
  const out: Finding[] = [];
  if (!resolveDshSourceRoot()) {
    out.push(
      finding("runtime.restart.no-root", "error", "未找到 DSH 本体目录", {
        cause: "本机没有检测到含 apps/cli 的 DSH 源码树",
        impact: "不知道要启动什么，重启无从谈起",
        action: "先用「一键部署」装好本体",
        fixAction: "bootstrap.plan",
      }),
    );
  }
  return out;
}

async function runRestart(
  ctx: ActionContext,
  params: RuntimeRestartParams,
): Promise<RuntimeRestartReport> {
  const t0 = Date.now();
  const probe = resolveDshSourceRoot();
  if (!probe) throw new Error("未找到 DSH 本体目录");
  const root = probe.path;

  const report: RuntimeRestartReport = {
    root,
    port: params.port ?? DSH_PORT_DEFAULT,
    wasRunning: false,
    stopped: 0,
    started: false,
    message: "",
    healthy: false,
    lines: [],
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  // ── s1 现状 ──────────────────────────────────────────────────────
  ctx.step("s1", RESTART_STEPS[0]);
  ctx.progress(0.15);
  const before = await collectRuntimeStatus().catch(() => null);
  if (before?.running) {
    report.wasRunning = true;
    if (!params.port && before.port) report.port = before.port;
    line(`服务正在运行（PID ${before.pid ?? "?"} · 端口 ${before.port ?? "?"}）`);
  } else {
    line("服务当前没有在运行");
  }
  ctx.throwIfCancelled();

  // ── s2 停止 ──────────────────────────────────────────────────────
  ctx.step("s2", RESTART_STEPS[1]);
  ctx.progress(0.4);
  const stopped = await stopDshServer();
  report.wasRunning = report.wasRunning || stopped.wasRunning;
  report.stopped = stopped.stopped;
  if (stopped.port && !params.port) report.port = stopped.port;
  line(stopped.wasRunning ? `已停止 ${stopped.stopped} 个进程` : "没有需要停止的进程");
  ctx.throwIfCancelled();

  // ── s3 启动 ──────────────────────────────────────────────────────
  ctx.step("s3", RESTART_STEPS[2]);
  ctx.progress(0.7);
  const started = await startDshServer(root, report.port);
  report.started = started.ok;
  report.message = started.message ?? "";
  line(`启动结果：${started.message || (started.ok ? "已启动" : "失败")}`);
  ctx.throwIfCancelled();

  // ── s4 就绪复核 ──────────────────────────────────────────────────
  ctx.step("s4", RESTART_STEPS[3]);
  ctx.progress(0.9);
  const after = await collectRuntimeStatus().catch(() => null);
  report.healthy = Boolean(after?.running && after.health?.reachable);
  if (report.healthy) {
    line(`服务就绪：端口 ${after?.port ?? report.port} · HTTP ${after?.health?.status}`);
  } else if (after?.running) {
    line(`进程起来了但 HTTP 访问不通：${after.health?.error ?? "无响应"}`);
  } else {
    line("服务没有起来");
  }

  report.elapsedMs = Date.now() - t0;
  ctx.progress(1);
  return report;
}

export const runtimeRestartAction: ActionDef<RuntimeRestartParams, RuntimeRestartReport> = {
  name: "runtime.restart",
  domain: "runtime",
  title: "重启 DSH 服务",
  description: "停掉所有 DSH 服务进程再重新起来，并复核 HTTP 是否真的通了。端口默认沿用原来的。",
  readonly: false,
  steps: [...RESTART_STEPS],
  preflight: async () => await restartPreflight(),
  run: async (ctx, params) => await runRestart(ctx, params ?? {}),
  timeoutMs: TIMEOUTS.install,
};
