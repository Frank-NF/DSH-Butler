/**
 * 进程枚举与识别。
 *
 * 性能约束（旧版踩过）：Windows 上按命令行枚举进程（CIM 查询）要 0.5~2 秒，
 * 若在 UI 请求路径上同步做，界面直接卡住。故：
 *   - 一律异步
 *   - 结果带 TTL 缓存（默认 2 秒内复用）
 *   - 只取需要的字段，不做全量系统信息采集
 */

import { powershell, run } from "./shell.ts";
import { log } from "../util/log.ts";

export interface ProcInfo {
  pid: number;
  name: string;
  cmdline: string;
}

let cache: { at: number; all: ProcInfo[] } | null = null;
/** 在途查询（单飞）：并发的调用方共享同一次查询，而不是各发一份。 */
let inflight: Promise<ProcInfo[]> | null = null;
const CACHE_TTL_MS = 2000;

/** 列出进程（可按进程名过滤）。结果带短 TTL 缓存 + 在途去重。 */
export async function listProcesses(nameFilter?: string): Promise<ProcInfo[]> {
  const now = Date.now();
  let all: ProcInfo[];

  if (cache && now - cache.at < CACHE_TTL_MS) {
    all = cache.all;
  } else if (inflight) {
    // 【关键】并发的第二个、第三个调用方必须等同一份结果。
    // 没有这一步的话：端口探测并行探 3 个端口，每个都要查一次进程名，
    // 于是同时起 3 个 PowerShell 各查一遍全量进程（实测多花约 2.4 秒）。
    all = await inflight;
  } else {
    inflight = queryProcesses();
    try {
      all = await inflight;
      cache = { at: Date.now(), all };
    } finally {
      inflight = null;
    }
  }

  if (!nameFilter) return all;
  const lower = nameFilter.toLowerCase();
  return all.filter((p) => p.name.toLowerCase() === lower);
}

/** 清缓存（结束进程后必须调用，否则拿到的是旧快照）。 */
export function invalidateProcessCache(): void {
  cache = null;
}

interface RawProc {
  ProcessId?: number;
  Name?: string;
  CommandLine?: string | null;
}

async function queryProcesses(): Promise<ProcInfo[]> {
  if (Deno.build.os === "windows") {
    // 只取有意义的字段；空 CommandLine 的系统进程跳过
    const script =
      `$p=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -ne $null } | ` +
      `Select-Object ProcessId,Name,CommandLine); ` +
      `ConvertTo-Json -InputObject $p -Compress -Depth 2`;
    const raw = await powershellJsonCompat<RawProc>(script);
    return raw
      .filter((r) => typeof r.ProcessId === "number")
      .map((r) => ({
        pid: r.ProcessId as number,
        name: r.Name ?? "",
        cmdline: r.CommandLine ?? "",
      }));
  }

  const r = await run("ps", ["-eo", "pid,comm,args"], {
    timeoutMs: 8000,
    allowNonZero: true,
    scope: "proc",
  });
  const out: ProcInfo[] = [];
  for (const line of r.stdout.split("\n").slice(1)) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), name: m[2] ?? "", cmdline: m[3] ?? "" });
  }
  return out;
}

/** PowerShell JSON 输出的兼容解析：单元素数组在 Windows PowerShell 里会退化成对象。 */
async function powershellJsonCompat<T>(script: string): Promise<T[]> {
  const r = await powershell(script, { timeoutMs: 25_000 });
  const text = r.stdout.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as T | T[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    log.warn("proc", `进程列表解析失败：${(e as Error).message}`);
    return [];
  }
}

// ── DSH 服务进程识别 ─────────────────────────────────────────────

/** 从命令行里提取 --port 参数值。 */
export function extractPort(cmdline: string): number | null {
  const m = /--port[=\s]+(\d{2,5})/.exec(cmdline);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/**
 * 判定一条命令行是否像 DSH Web 服务。
 * 两种形态（旧版实测）：
 *   A 编译版 cwd=apps/cli  node --expose-internals lib/bin.js --profile web --no-open --port N
 *   B 开发态 cwd=仓库根      node --expose-internals --import tsx/esm apps/cli/src/bin.ts web --no-open --port N
 */
export function looksLikeDshServer(cmdline: string): boolean {
  if (!cmdline) return false;
  const hasBinJs = cmdline.includes("bin.js") && cmdline.includes("--profile");
  const hasSrcTs = cmdline.includes("src/bin.ts") && /\bweb\b/.test(cmdline);
  const mentionsProfile = cmdline.includes("--profile");
  return hasBinJs || hasSrcTs || (mentionsProfile && cmdline.includes("dsh"));
}

/** 列出所有疑似 DSH 服务的 node 进程。 */
export async function listDshProcesses(): Promise<Array<ProcInfo & { port: number | null }>> {
  const nodes = await listProcesses("node.exe");
  const candidates = nodes.length > 0 ? nodes : await listProcesses("node");
  return candidates
    .filter((p) => looksLikeDshServer(p.cmdline))
    .map((p) => ({ ...p, port: extractPort(p.cmdline) }));
}

/** 结束进程。force=false 时先尝试温和终止。 */
export async function killProcess(pid: number, force = false): Promise<boolean> {
  invalidateProcessCache();
  invalidateLiveCache();
  if (Deno.build.os === "windows") {
    const args = force ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/T"];
    const r = await run("taskkill", args, { timeoutMs: 15_000, allowNonZero: true, scope: "proc" });
    const okKill = r.code === 0;
    if (!okKill) {
      log.warn(
        "proc",
        `taskkill 失败(${r.code})，pid=${pid}：${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
    return okKill;
  }
  try {
    Deno.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch (e) {
    log.warn("proc", `kill 失败 pid=${pid}：${(e as Error).message}`);
    return false;
  }
}

/** 当前进程是否还活着。 */
export async function isAlive(pid: number): Promise<boolean> {
  if (pid === Deno.pid) return true;
  return (await liveProcesses()).has(pid);
}

/**
 * 取「当前存在的进程」快照：PID → 进程名。
 *
 * 【为什么不能靠发信号探活 —— 这是实测踩出来的坑】
 * 直觉写法是 `Deno.kill(pid, "SIGCONT")`（POSIX 语义：信号 0 只探测不打扰）。
 * 但在 Windows 上实测（2026-09-24）：
 *   Deno.kill(999999, "SIGCONT") → TypeError: Invalid signal: SIGCONT
 *   Deno.kill(Deno.pid, "SIGCONT") → TypeError: Invalid signal: SIGCONT
 * 也就是说 SIGCONT 在 Windows【不支持，且与进程是否存在完全无关】。
 * 而 Deno 在 Windows 只认 SIGINT/SIGTERM/SIGKILL —— 那三个会真的把进程杀掉，
 * 绝不能拿来当探针。
 * 后果：任何"catch 到异常就当进程已死"的写法在 Windows 上都是反的 ——
 * 死进程会被判成活的，于是【僵尸写锁永远查不出来】，而清僵尸锁正是旧版
 * 1.18.15 的招牌功能。
 *
 * 改用 tasklist 全量取名：一次枚举回答所有 PID，且输出是纯 CSV（第 2 字段是 PID），
 * 不像 `tasklist /FI` 那样会返回随系统语言变化的提示文本。
 */
let liveCache: { at: number; map: Map<number, string> } | null = null;
let liveInflight: Promise<Map<number, string>> | null = null;
const LIVE_TTL_MS = 1500;

export async function liveProcesses(): Promise<Map<number, string>> {
  const now = Date.now();
  if (liveCache && now - liveCache.at < LIVE_TTL_MS) return liveCache.map;
  // 在途去重：并发的锁扫描与残留扫描不该各起一次 tasklist
  if (liveInflight) return await liveInflight;

  liveInflight = queryLiveProcesses();
  try {
    const map = await liveInflight;
    liveCache = { at: Date.now(), map };
    return map;
  } finally {
    liveInflight = null;
  }
}

/** 结束进程后调用，避免拿到过期快照。 */
export function invalidateLiveCache(): void {
  liveCache = null;
}

async function queryLiveProcesses(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (Deno.build.os === "windows") {
    const r = await run("tasklist", ["/NH", "/FO", "CSV"], {
      timeoutMs: 20_000,
      allowNonZero: true,
      scope: "proc",
    });
    for (const line of r.stdout.split(/\r?\n/)) {
      // 形如 "node.exe","117720","Console","1","332,520 K"
      const m = /^"([^"]*)","(\d+)"/.exec(line.trim());
      if (m?.[2]) map.set(Number(m[2]), m[1] ?? "");
    }
    return map;
  }

  const r = await run("ps", ["-eo", "pid,comm"], {
    timeoutMs: 8000,
    allowNonZero: true,
    scope: "proc",
  });
  for (const line of r.stdout.split("\n").slice(1)) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line);
    if (m?.[1]) map.set(Number(m[1]), m[2] ?? "");
  }
  return map;
}

/**
 * 进程名是否像 node。
 * 用来识别【PID 被复用】——锁里记的 PID 还活着，但已经是别的程序了，
 * 这种情况下锁同样是废的（旧进程早就没了）。
 */
export function looksLikeNodeProcess(name: string): boolean {
  return /^node(\.exe)?$/i.test(name.trim());
}
