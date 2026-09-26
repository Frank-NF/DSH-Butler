/**
 * 插件写操作的「重启 + 体检」共用件（P1-3 / P1-4）。
 *
 * 【为什么抽出来】批量更新与离线安装是同一条纪律：停服 → 留整批回滚点 → 装 → 重启 → 体检
 * → 不通过就整批回退。如果各写一份，「重启后怎么算健康」这种判据必然分叉（本项目已经
 * 吃过两份体检流程分叉的亏）。这里只抽最实的那两件：轮询健康 + 重启并验证。
 */

import { collectRuntimeStatus, healthCheck } from "../runtime/status.ts";
import { startDshServer } from "../core/finish_update.ts";

/**
 * 轮询直到 HTTP 可达（或超时）。
 * 用 HTTP 可达而不是「进程在」作为判据：进程活着但端口没起来，对用户来说就是「打不开」。
 */
export async function pollHealthy(port: number | null, timeoutMs: number): Promise<boolean> {
  if (!port) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await healthCheck(port);
    if (h.reachable) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export interface RestartVerifyResult {
  /** 启动调用是否成功。 */
  started: boolean;
  /** 重启后 HTTP 是否可达（真正的健康判据）。 */
  reachable: boolean;
  /** 服务进程是否在（用于报告，不作为判据）。 */
  running: boolean;
  port: number | null;
  lines: string[];
}

/**
 * 重启 DSH 服务并验证它真的起来了。
 * 拿不到本体目录或端口时不假装成功：started=false，交给调用方决定怎么报。
 */
export async function restartAndVerify(
  root: string | null,
  port: number | null,
  timeoutMs = 60_000,
): Promise<RestartVerifyResult> {
  const lines: string[] = [];
  if (!root || !port) {
    lines.push("拿不到 DSH 本体目录或端口，跳过重启（请在面板手动启动后自行确认）");
    const st = await collectRuntimeStatus();
    return { started: false, reachable: false, running: st.running, port: st.port, lines };
  }
  const r = await startDshServer(root, port);
  lines.push(r.ok ? `已重启 DSH 服务（端口 ${port}）` : `重启失败：${r.message}`);
  const reachable = r.ok ? await pollHealthy(port, timeoutMs) : false;
  const st = await collectRuntimeStatus();
  lines.push(`体检：进程${st.running ? "在" : "不在"}，HTTP ${reachable ? "可达" : "不可达"}`);
  return { started: r.ok, reachable, running: st.running, port: st.port, lines };
}
