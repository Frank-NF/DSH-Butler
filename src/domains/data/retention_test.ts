/**
 * 保留策略测试（P1-2）。
 *
 * 这是「自动删东西」的判据，必须钉死：算错要么把用户刚做的备份清掉，
 * 要么永远不清理把磁盘吃满。所以按纯函数测，边界逐个过。
 */
import { assertEquals } from "@std/assert";
import { planRetention } from "./actions.ts";
import type { BackupInfo } from "./pack.ts";

function mk(n: number, bytes: number): BackupInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    dir: "D:/b/DSH搬移包-" + i,
    stamp: "s" + i,
    createdAt: "2026-09-2" + (9 - i) + "T00:00:00Z",
    bytes,
    fileCount: 1,
    preset: "config" as const,
  }));
}

Deno.test("保留策略：数量上限，从最旧的开始清", () => {
  const plan = planRetention(mk(12, 1024), { maxBackups: 10, maxBackupBytes: 10 ** 9 });
  assertEquals(plan.keep.length, 10);
  assertEquals(plan.trim.map((x) => x.stamp), ["s10", "s11"]);
  assertEquals(plan.reason.includes("超出数量上限"), true);
});

Deno.test("保留策略：体积上限，最新的一个永远留", () => {
  const plan = planRetention(mk(5, 100), { maxBackups: 99, maxBackupBytes: 250 });
  assertEquals(plan.keep.map((x) => x.stamp), ["s0", "s1"], "两个正好 200 ≤ 250，第三个就超了");
  assertEquals(plan.trim.map((x) => x.stamp), ["s2", "s3", "s4"]);
  // 单个备份本身就超上限时，也不许把刚做的那个清掉
  const only = planRetention(mk(1, 999), { maxBackups: 1, maxBackupBytes: 10 });
  assertEquals(only.keep.length, 1);
  assertEquals(only.trim, []);
});

Deno.test("保留策略：都不超就一个不删", () => {
  const plan = planRetention(mk(3, 100), { maxBackups: 10, maxBackupBytes: 10 ** 6 });
  assertEquals(plan.trim, []);
  assertEquals(plan.keep.length, 3);
  assertEquals(plan.reason, "未超限");
  assertEquals(planRetention([], { maxBackups: 10, maxBackupBytes: 10 }).trim, []);
});
