/**
 * 跨进程写互斥锁的判据回归测试（S3 地基）。
 *
 * 这把锁的两个错误方向都要钉死：
 *   - 该拒不拒（活锁没拦住）→ 新旧两版同时改 DSH 文件，数据互相踩；
 *   - 该放不放（死锁不回收）→ 一次崩溃 = 写操作永久卡死，用户只能手动删文件
 *     （#48 僵尸锁的教训：崩溃路径一定会漏清理）。
 * 另有一条纪律：释放只认自己的 jobId —— 绝不删别人的锁。
 *
 * 全部测试用 BUTLER_WRITE_LOCK_PATH 指到临时文件，绝不碰真实 ~/.dsh/write.lock。
 */

import { p } from "../util/paths.ts";
import {
  readWriteLock,
  releaseWriteLock,
  tryAcquireWriteLock,
  WRITE_LOCK_HOLDER,
  WRITE_LOCK_STALE_MS,
} from "./write-lock.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`,
    );
  }
}

/** 每个测试独立的锁路径：装好 env、跑完连临时目录一起删。 */
async function withTempLock(fn: (lockPath: string) => Promise<void>): Promise<void> {
  const dir = Deno.makeTempDirSync();
  const lockPath = p(dir, "write.lock");
  const prev = Deno.env.get("BUTLER_WRITE_LOCK_PATH");
  Deno.env.set("BUTLER_WRITE_LOCK_PATH", lockPath);
  try {
    await fn(lockPath);
  } finally {
    if (prev === undefined) Deno.env.delete("BUTLER_WRITE_LOCK_PATH");
    else Deno.env.set("BUTLER_WRITE_LOCK_PATH", prev);
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch { /* ignore */ }
  }
}

Deno.test("写锁：拿锁 → 拒绝第二个 → 释放自己的后可再拿", async () => {
  await withTempLock(async (lockPath) => {
    const a = await tryAcquireWriteLock("core", "job-a", { version: "2.0.0-test" });
    assert(a.ok, `第一次拿锁应成功，实际：${JSON.stringify(a)}`);
    // 若 env 覆盖失效，锁会写去真实的 ~/.dsh —— 这条必须是临时路径
    assert(
      (() => {
        try {
          return Deno.statSync(lockPath).isFile;
        } catch {
          return false;
        }
      })(),
      "锁必须写在临时覆盖路径上（env override 失效会污染真实锁）",
    );

    const cur = readWriteLock();
    assertEq(cur?.jobId, "job-a", "锁文件应记录持有者 jobId");
    assertEq(cur?.holder, WRITE_LOCK_HOLDER, "持有者标识错误");
    assertEq(cur?.pid, Deno.pid, "应记录当前进程 pid");

    // 活锁拒绝：本进程 pid 是活的、时间也新鲜 —— 第二个任务必须被拒
    const b = await tryAcquireWriteLock("core", "job-b", { version: "2.0.0-test" });
    assert(!b.ok, "已有活锁时第二个拿锁必须被拒绝");
    assertEq(b.ok === false ? b.heldBy?.jobId : null, "job-a", "拒绝时应告知持有者是谁");

    releaseWriteLock("job-a");
    assertEq(readWriteLock(), null, "释放后锁应消失");

    const c = await tryAcquireWriteLock("plugin", "job-c", { version: "2.0.0-test" });
    assert(c.ok, "释放后应能重新拿锁");
    releaseWriteLock("job-c");
  });
});

Deno.test("写锁：释放纪律——不是自己的锁绝不删", async () => {
  await withTempLock(async () => {
    const a = await tryAcquireWriteLock("core", "job-owner", { version: "2.0.0-test" });
    assert(a.ok, "拿锁失败");

    releaseWriteLock("job-intruder"); // 别人的 jobId
    assertEq(readWriteLock()?.jobId, "job-owner", "用错误 jobId 释放绝不能把别人的锁删掉");

    releaseWriteLock("job-owner");
    assertEq(readWriteLock(), null, "本人释放应成功");
  });
});

Deno.test("写锁：陈旧锁（超 24h）必须自动回收并留证据，不许永久卡死", async () => {
  await withTempLock(async (lockPath) => {
    // 伪造一个"pid 还活着但已经拿了 25 小时"的锁 —— 时间兜底判据必须生效
    const old = {
      holder: "butler-2.x",
      version: "2.0.0-test",
      pid: Deno.pid,
      jobId: "job-dead",
      domain: "core",
      acquiredAt: new Date(Date.now() - WRITE_LOCK_STALE_MS - 3_600_000).toISOString(),
    };
    Deno.writeTextFileSync(lockPath, JSON.stringify(old));

    const acq = await tryAcquireWriteLock("core", "job-fresh", { version: "2.0.0-test" });
    assert(acq.ok, `陈旧锁必须回收后拿锁成功，实际：${JSON.stringify(acq)}`);
    assertEq(readWriteLock()?.jobId, "job-fresh", "应换成新持有者");

    // 回收不是删：旧锁要改名备份留证据
    const dir = lockPath.slice(0, lockPath.lastIndexOf(Deno.build.os === "windows" ? "\\" : "/"));
    const staleBackups: string[] = [];
    for (const e of Deno.readDirSync(dir)) {
      if (e.name.startsWith("write.lock.stale-")) staleBackups.push(e.name);
    }
    assert(
      staleBackups.length >= 1,
      `陈旧锁必须备份为 write.lock.stale-*，实际目录：${
        [...Deno.readDirSync(dir)].map((x) => x.name).join(", ")
      }`,
    );
    releaseWriteLock("job-fresh");
  });
});

Deno.test("写锁：损坏的锁文件不猜不崩——按无锁处理并覆盖", async () => {
  await withTempLock(async (lockPath) => {
    Deno.writeTextFileSync(lockPath, "这不是JSON{{{");
    assertEq(readWriteLock(), null, "损坏文件应读作 null");

    const acq = await tryAcquireWriteLock("core", "job-recover", { version: "2.0.0-test" });
    assert(acq.ok, `损坏锁不应阻塞写操作，实际：${JSON.stringify(acq)}`);
    assertEq(readWriteLock()?.jobId, "job-recover", "应被新锁覆盖");
    releaseWriteLock("job-recover");
  });
});
