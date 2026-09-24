/**
 * 端口探测与占用分析。
 *
 * 策略：先用「能不能绑上」做快速判定（毫秒级），确认被占再花代价去查是谁占的
 * （netstat / lsof 慢得多，不该在快路径上跑）。
 */

import { run } from "./shell.ts";
import { listProcesses, type ProcInfo } from "./process.ts";

export interface PortStatus {
  port: number;
  free: boolean;
  /** 占用者（如果能查到）。 */
  owners: Array<{ pid: number; name: string; cmdline: string }>;
  /** 占用者是不是 DSH 自己。 */
  isDsh: boolean;
}

/**
 * 端口能否绑定。
 * 注：绑定 127.0.0.1 探测不到只监听其它网卡的进程，故仅作快速判定，
 * 结论为「被占用」时才去查真实占用者。
 */
export function isPortFree(port: number): boolean {
  try {
    const listener = Deno.listen({ port, hostname: "127.0.0.1", transport: "tcp" });
    listener.close();
    return true;
  } catch {
    return false;
  }
}

/** 找出占用某端口的进程（Windows: netstat -ano；类 Unix: lsof）。 */
export async function findPortOwners(port: number): Promise<number[]> {
  if (Deno.build.os === "windows") {
    const r = await run("netstat", ["-ano", "-p", "TCP"], {
      timeoutMs: 15_000,
      allowNonZero: true,
      scope: "port",
    });
    const pids = new Set<number>();
    for (const line of r.stdout.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const cols = line.trim().split(/\s+/);
      // 形如: TCP  0.0.0.0:3081  0.0.0.0:0  LISTENING  12345
      const local = cols[1];
      const pidCol = cols[cols.length - 1];
      if (!local || !pidCol) continue;
      const portPart = local.slice(local.lastIndexOf(":") + 1);
      if (Number(portPart) === port && /^\d+$/.test(pidCol)) pids.add(Number(pidCol));
    }
    return [...pids];
  }

  const r = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    timeoutMs: 15_000,
    allowNonZero: true,
    scope: "port",
  });
  return r.stdout
    .split(/\s+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** 完整端口状态（含占用者身份）。 */
export async function describePort(port: number): Promise<PortStatus> {
  if (isPortFree(port)) return { port, free: true, owners: [], isDsh: false };

  const pids = await findPortOwners(port);
  const all = await listProcesses();
  const byPid = new Map<number, ProcInfo>(all.map((p) => [p.pid, p]));

  const owners = pids.map((pid) => {
    const p = byPid.get(pid);
    return {
      pid,
      name: p?.name ?? "(未知进程)",
      cmdline: p?.cmdline ?? "",
    };
  });

  const isDsh = owners.some((o) =>
    o.cmdline.includes("bin.js") || o.cmdline.includes("DeepSeek_Harness") ||
    o.cmdline.includes("apps/cli") || o.cmdline.includes("apps\\cli")
  );

  return { port, free: false, owners, isDsh };
}

/** 在候选端口里找出当前正在监听 DSH 的那个。 */
export async function findDshPort(candidates: readonly number[]): Promise<number | null> {
  const { listDshProcesses } = await import("./process.ts");
  const procs = await listDshProcesses();
  const fromCmd = procs.map((p) => p.port).filter((p): p is number => typeof p === "number");
  for (const c of candidates) {
    if (fromCmd.includes(c)) return c;
  }
  if (fromCmd.length > 0) return fromCmd[0] ?? null;

  // 命令行里没写端口时，退回探测候选端口是否有 DSH 占用
  for (const c of candidates) {
    const st = await describePort(c);
    if (!st.free && st.isDsh) return c;
  }
  return null;
}
