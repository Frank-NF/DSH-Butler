/**
 * Windows 主机事实：一次 PowerShell 调用取回全部。
 *
 * 【为什么必须合并成一次】
 * 每启动一次 PowerShell 要 1.5~2.5 秒（本机实测），而原先 CPU 型号、系统版本、
 * 磁盘容量、是否管理员各自起一个进程、还是串行的 —— 光这些就让「环境体检」
 * 要等 10 秒，桌面端首屏根本受不了。
 * 合并后只剩一次进程启动开销；结果带 30 秒缓存，界面刷新不会重复付这个代价。
 *
 * 单独成文件（而不是写在 mod.ts 里）的原因：privileges.ts 也要读"是否管理员"，
 * 而 mod.ts 会 re-export privileges.ts —— 写在 mod.ts 里就形成循环依赖。
 */

import { powershellJson } from "./shell.ts";

export interface DiskFact {
  size: number;
  free: number;
}

export interface HostFacts {
  cpuModel: string | null;
  osCaption: string | null;
  osBuild: string | null;
  /** 卷标识（"C:"）→ 容量。只含固定磁盘（DriveType=3）。 */
  disks: Map<string, DiskFact>;
  /** 当前进程是否以管理员身份运行。 */
  elevated: boolean;
}

const EMPTY: HostFacts = {
  cpuModel: null,
  osCaption: null,
  osBuild: null,
  disks: new Map(),
  elevated: false,
};

let cache: { at: number; facts: HostFacts } | null = null;
let inflight: Promise<HostFacts> | null = null;
const TTL_MS = 30_000;

interface RawDisk {
  id?: string;
  size?: number;
  free?: number;
}

/** 是不是 Windows（非 Windows 直接返回空事实，由各调用方走各自分支）。 */
export const onWindows = Deno.build.os === "windows";

export async function hostFacts(opts: { fresh?: boolean } = {}): Promise<HostFacts> {
  if (!onWindows) return EMPTY;
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.facts;

  // 【在途去重】环境体检里 systemInfo() 与 isElevated() 是并行发起的，两者都要这份事实。
  // 没有这一步就会同时起两个 PowerShell 各查一遍 CIM（每个约 2.2 秒），白白多等一倍。
  // 并发调用共享同一个 Promise。
  if (inflight) return await inflight;

  inflight = queryHostFacts();
  try {
    const facts = await inflight;
    // 查询失败时返回 EMPTY，不要把 EMPTY 写进缓存 —— 否则 30 秒内都拿不到真值
    if (facts !== EMPTY) cache = { at: Date.now(), facts };
    return facts;
  } finally {
    inflight = null;
  }
}

async function queryHostFacts(): Promise<HostFacts> {
  const script =
    `$cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name; ` +
    `$os=Get-CimInstance Win32_OperatingSystem; ` +
    `$adm=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())` +
    `.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); ` +
    `$disks=@(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | ` +
    `ForEach-Object { @{ id=$_.DeviceID; size=[int64]$_.Size; free=[int64]$_.FreeSpace } }); ` +
    `ConvertTo-Json -Compress -Depth 4 -InputObject ` +
    `@{ cpu=$cpu; caption=$os.Caption; build=$os.BuildNumber; adm=$adm; disks=$disks }`;

  const j = await powershellJson<{
    cpu?: string;
    caption?: string;
    build?: string;
    adm?: boolean | string;
    disks?: RawDisk | RawDisk[];
  }>(script, { timeoutMs: 25_000 });

  if (!j) {
    // 拿不到就返回空事实：各调用方都有兜底路径（CPU 显示未知、磁盘单独再查、
    // 权限按"非管理员"处理），绝不因为一次查询失败就让整个体检报错。
    return EMPTY;
  }

  const rawDisks = j.disks === undefined ? [] : Array.isArray(j.disks) ? j.disks : [j.disks];
  const disks = new Map<string, DiskFact>();
  for (const d of rawDisks) {
    if (typeof d?.id === "string" && typeof d.size === "number" && typeof d.free === "number") {
      disks.set(d.id.toUpperCase(), { size: d.size, free: d.free });
    }
  }

  const facts: HostFacts = {
    cpuModel: j.cpu?.trim() || null,
    osCaption: j.caption?.trim() || null,
    osBuild: j.build?.trim() || null,
    disks,
    elevated: j.adm === true || j.adm === "True" || j.adm === "true",
  };
  cache = { at: Date.now(), facts };
  return facts;
}

/** 丢弃缓存（例如刚刚以管理员身份重启、或换了磁盘）。 */
export function invalidateHostFacts(): void {
  cache = null;
}
