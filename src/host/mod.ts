/**
 * 主机适配层汇总出口。
 *
 * 【架构铁律】判断操作系统的代码只允许出现在本目录。
 * 其它模块一律通过这里的能力，不得自行 if (Deno.build.os === ...)。
 *
 * API 备注（Deno 2.9.7 实测）：
 *   - Deno.cpus() / Deno.statfsSync() 在本版本【不存在】，故 CPU 信息走
 *     navigator.hardwareConcurrency + PowerShell 查型号，磁盘空间走系统命令。
 *   - Deno.systemMemoryInfo() / Deno.hostname() / Deno.osRelease() 可用。
 */

export * as sh from "./shell.ts";
export * as fsx from "./fs.ts";
export * as proc from "./process.ts";
export * as port from "./port.ts";
export * as priv from "./privileges.ts";
export * as facts from "./windows-facts.ts";

import { powershell } from "./shell.ts";
import { hostFacts, onWindows } from "./windows-facts.ts";
import { isWindows, volumeOf } from "../util/paths.ts";

export interface SystemInfo {
  os: string;
  osKind: "windows" | "macos" | "linux" | "other";
  osVersion: string;
  arch: string;
  hostname: string;
  cpuModel: string;
  cpuCount: number;
  memTotalBytes: number;
  memFreeBytes: number;
  denoVersion: string;
  v8Version: string;
  user: string;
}

let sysCache: { at: number; info: SystemInfo } | null = null;

/** 系统信息（带 30 秒缓存；采集成本不低，别在热路径反复调）。 */
export async function systemInfo(): Promise<SystemInfo> {
  if (sysCache && Date.now() - sysCache.at < 30_000) return sysCache.info;

  const mem = Deno.systemMemoryInfo();
  // 三项 Windows 事实一次性取回（见 hostFacts 的说明），避免三次 PowerShell 串行
  const facts = await hostFacts();

  const info: SystemInfo = {
    os: Deno.build.os,
    osKind: Deno.build.os === "windows"
      ? "windows"
      : Deno.build.os === "darwin"
      ? "macos"
      : Deno.build.os === "linux"
      ? "linux"
      : "other",
    osVersion: await osVersionString(),
    arch: Deno.build.arch,
    hostname: safeHostname(),
    cpuModel: facts.cpuModel ?? await cpuModelFallback(),
    cpuCount: cpuCount(),
    memTotalBytes: mem.total,
    memFreeBytes: mem.available,
    denoVersion: Deno.version.deno,
    v8Version: Deno.version.v8,
    user: Deno.env.get(isWindows ? "USERNAME" : "USER") ?? "(未知)",
  };

  sysCache = { at: Date.now(), info };
  return info;
}

function safeHostname(): string {
  try {
    return Deno.hostname();
  } catch {
    return "(未知)";
  }
}

/** 逻辑核心数：走标准 Web API，不依赖 Deno 扩展。 */
function cpuCount(): number {
  try {
    return navigator.hardwareConcurrency || 1;
  } catch {
    return 1;
  }
}

/** CPU 型号：Windows 与 Linux 走各自最快的取法；取不到就交给调用方兜底。 */
async function cpuModelFallback(): Promise<string> {
  if (Deno.build.os === "linux") {
    try {
      const txt = Deno.readTextFileSync("/proc/cpuinfo");
      const m = /model name\s*:\s*(.+)/.exec(txt);
      if (m?.[1]) return m[1].trim();
    } catch { /* ignore */ }
  } else if (Deno.build.os === "darwin") {
    const { run } = await import("./shell.ts");
    const r = await run("sysctl", ["-n", "machdep.cpu.brand_string"], {
      timeoutMs: 10_000,
      allowNonZero: true,
      scope: "sysinfo",
    });
    const t = r.stdout.trim();
    if (t) return t;
  }
  return "(未知)";
}

async function osVersionString(): Promise<string> {
  const facts = await hostFacts();
  if (facts.osCaption) {
    return facts.osBuild ? `${facts.osCaption} | Build ${facts.osBuild}` : facts.osCaption;
  }
  try {
    return Deno.osRelease();
  } catch {
    return "(未知)";
  }
}

export interface DiskSpace {
  path: string;
  freeBytes: number;
  totalBytes: number;
}

/**
 * 指定路径所在卷的可用空间。
 * Deno 2.9.7 无 statfsSync，故 Windows 走 CIM，类 Unix 走 df。
 */
export async function diskSpace(path: string): Promise<DiskSpace | null> {
  if (Deno.build.os === "windows") {
    // 直接查已缓存的主机事实（一次调用就取了所有卷），不再为此单起 PowerShell
    const facts = await hostFacts();
    const key = volumeOf(path);
    const hit = facts.disks.get(key.toUpperCase());
    if (hit) return { path, freeBytes: hit.free, totalBytes: hit.size };

    // 缓存里没有这个卷（例如刚挂载的移动盘）→ 单独查一次，避免"查不到就说没有"
    const drive = key.replace(/:$/, "");
    if (!/^[A-Za-z]$/.test(drive)) return null;
    const r = await powershell(
      `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}:'"; ` +
        `ConvertTo-Json -Compress -InputObject @{Size=[int64]$d.Size;Free=[int64]$d.FreeSpace}`,
      { timeoutMs: 15_000 },
    );
    try {
      const j = JSON.parse(r.stdout.trim()) as { Size?: number; Free?: number };
      if (typeof j.Size === "number" && typeof j.Free === "number") {
        return { path, freeBytes: j.Free, totalBytes: j.Size };
      }
    } catch { /* fallthrough */ }
    return null;
  }

  const { run } = await import("./shell.ts");
  const r = await run("df", ["-k", path], { timeoutMs: 10_000, allowNonZero: true, scope: "sysinfo" });
  const lines = r.stdout.trim().split(/\r?\n/);
  const cols = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
  const total = Number(cols[1]);
  const avail = Number(cols[3]);
  if (Number.isFinite(total) && Number.isFinite(avail)) {
    return { path, freeBytes: avail * 1024, totalBytes: total * 1024 };
  }
  return null;
}

/** 平台显示名（用 Record 索引，避免 union 类型报错）。 */
export function platformLabel(): string {
  const map: Record<string, string> = { windows: "Windows", darwin: "macOS", linux: "Linux" };
  return map[Deno.build.os] ?? Deno.build.os;
}

/** 人类可读体积。 */
export function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
