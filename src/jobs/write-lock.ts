/**
 * 跨进程 / 跨版本写互斥锁（S3 地基）。
 *
 * 为什么需要它（方案 §12 R9 与切换策略）：
 *   S3 期间新版（Deno 管家 2.x）与旧版（1.18.15 Tauri）并存，
 *   同一台机器上两套实现都有能力改 DSH 本体与 profile ——
 *   同一时刻【只有一个】有权执行写操作，否则会互相踩文件。
 *   引擎内部的域锁（engine #locks）只管本进程；这把锁管跨进程、跨版本。
 *
 * 为什么放在 `~/.dsh/write.lock`：
 *   锁必须放在【两版都天然看得见】的位置。旧版管家的配置、DSH 的 profile
 *   都在 ~/.dsh 下，新版的数据在 ~/.dsh-butler 下 —— 放新版家里旧版根本不看，
 *   互斥就形同虚设。这是一个新增的锁文件，不改动 DSH 任何已有数据。
 *
 * 陈旧锁怎么回收（#48 僵尸锁的教训，2026-09-24 同一天撞过两次）：
 *   「凡是用完要自己清理的资源，崩溃路径一定会漏」—— 进程被强杀，锁文件留了下来。
 *   如果发现锁就永远拒绝，一次崩溃 = 写操作永久卡死，用户只能手动删文件。
 *   所以回收判据是双层的：
 *     1) 持有者 pid 已死（tasklist 检活）→ 立即回收；
 *     2) pid 活但 acquiredAt 超过 24 小时 → 兜底回收（防 pid 复用误判导致的死锁）。
 *   回收不是直接删：旧锁先改名备份成 `write.lock.stale-<时间戳>` 留证据，
 *   再写自己的锁 —— 与「隔离区只移动不删除」同一哲学。
 *
 * 释放纪律（对齐 DSH atomic-write 的 orphan 语义）：
 *   只释放【自己持有】的锁（jobId 必须匹配）。绝不删别人的锁 ——
 *   你眼里的"残留"可能是别人正在跑的任务。
 */

import { dshRoot, p, stampOf } from "../util/paths.ts";
import { isFile } from "../host/fs.ts";
import { run } from "../host/shell.ts";

/** 锁文件持有者信息（落盘 JSON）。旧版接入后 holder 会是 "legacy-1.18.x"。 */
export interface WriteLockInfo {
  /** 持有者标识：新版 "butler-2.x"；旧版未来填 "legacy-1.18.x"。 */
  holder: string;
  /** 持有者版本号，便于排查"是谁占着"。 */
  version: string;
  /** 持有进程 pid（检活用）。 */
  pid: number;
  /** 关联任务 id；无任务的手动操作填 "-"。 */
  jobId: string;
  /** 被锁的域（core/plugin/…），只是信息字段，锁本身是全局一把。 */
  domain: string;
  /** ISO 时间；超时兜底判据。 */
  acquiredAt: string;
}

/**
 * 锁文件路径：默认 `~/.dsh/write.lock`（新旧两版共见的位置）。
 * 测试可用 env `BUTLER_WRITE_LOCK_PATH` 指到临时文件，绝不污染真实锁。
 */
export function writeLockPath(): string {
  const override = Deno.env.get("BUTLER_WRITE_LOCK_PATH");
  if (override) return override;
  return p(dshRoot(), "write.lock");
}

/** 持有者版本标识（由 version.ts 注入会造成循环依赖，这里内聚一个小常量）。 */
export const WRITE_LOCK_HOLDER = "butler-2.x";

/** 兜底超时：持有超过此时长视为陈旧（job 总超时 1h 的 24 倍，纯防 pid 复用死锁）。 */
export const WRITE_LOCK_STALE_MS = 24 * 60 * 60 * 1000;

/** 读当前锁文件；不存在或损坏返回 null。 */
export function readWriteLock(): WriteLockInfo | null {
  const path = writeLockPath();
  if (!isFile(path)) return null;
  try {
    const raw = Deno.readTextFileSync(path);
    const info = JSON.parse(raw) as WriteLockInfo;
    if (typeof info?.pid !== "number" || typeof info?.jobId !== "string") return null;
    return info;
  } catch {
    // 锁文件损坏：当作"有锁但读不懂"——不猜、不删，交由调用方按陈旧策略处理
    return null;
  }
}

/**
 * pid 活性检测（Windows：tasklist 过滤；S1–S3 只做 Windows）。
 * 输出被杀掉/无匹配时 PID 列不含该 pid → 判死。
 */
export async function isPidAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const r = await run("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], {
      timeoutMs: 5_000,
      allowNonZero: true,
      scope: "proc",
    });
    // CSV 行形如 "explorer.exe","1234",console...；无匹配时输出中文提示无引号行
    return r.stdout.includes(`"${pid}"`);
  } catch {
    // tasklist 都跑不起来时：退化为时间判据（不误杀活锁，靠 stale 兜底）
    return true;
  }
}

export type AcquireResult =
  | { ok: true; info: WriteLockInfo }
  | { ok: false; reason: string; heldBy: WriteLockInfo | null };

/**
 * 尝试拿锁（非阻塞）。
 * - 无锁 / 陈旧锁（pid 死 或 超时）→ 备份旧锁后写入自己的，成功返回；
 * - 活锁 → 拒绝，返回持有者信息，调用方翻译成人话。
 */
export async function tryAcquireWriteLock(
  domain: string,
  jobId: string,
  opts: { version: string },
): Promise<AcquireResult> {
  const path = writeLockPath();
  const existing = readWriteLock();

  if (existing) {
    const timedOut = Date.now() - Date.parse(existing.acquiredAt) > WRITE_LOCK_STALE_MS;
    const alive = await isPidAlive(existing.pid);
    if (alive && !timedOut) {
      return { ok: false, reason: "已有写操作正在进行", heldBy: existing };
    }
    // 陈旧锁：改名备份留证据（pid 已死或超 24h），再重试一次读
    try {
      const backup = `${path}.stale-${stampOf()}`;
      Deno.renameSync(path, backup);
    } catch { /* 改名失败则下面的写入直接覆盖，仍能推进 */ }
  }

  const info: WriteLockInfo = {
    holder: WRITE_LOCK_HOLDER,
    version: opts.version,
    pid: Deno.pid,
    jobId,
    domain,
    acquiredAt: new Date().toISOString(),
  };
  try {
    Deno.mkdirSync(dshRoot(), { recursive: true });
    // 临时名写入 + rename：同盘原子替换，不会出现半个 JSON
    const tmp = `${path}.new`;
    Deno.writeTextFileSync(tmp, JSON.stringify(info, null, 2));
    Deno.renameSync(tmp, path);
  } catch (e) {
    return { ok: false, reason: `写入锁文件失败：${(e as Error).message}`, heldBy: null };
  }

  // 竞态复查：两个进程同时通过"无锁"分支时，后写的会覆盖先写的 —— 写完再读一次，
  // 不是自己就让位（把刚写的删掉）。窗口极小，但要防。
  const confirm = readWriteLock();
  if (confirm && confirm.jobId !== jobId) {
    return { ok: false, reason: "锁竞争失败（另一任务抢先写入）", heldBy: confirm };
  }
  return { ok: true, info };
}

/**
 * 释放锁。只删【自己持有】的（jobId 匹配）；不匹配一律不动。
 * 无锁 / 已被回收时静默成功（幂等）。
 */
export function releaseWriteLock(jobId: string): void {
  const path = writeLockPath();
  const cur = readWriteLock();
  if (!cur || cur.jobId !== jobId) return;
  try {
    Deno.removeSync(path);
  } catch { /* 已被回收等，幂等 */ }
}
