/** 守卫：设置页的定时任务与保留策略表单（P2-3 收尾）。 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("设置页：定时任务与保留策略要有表单，且会被保存", () => {
  for (const id of [
    "set-sched-enabled",
    "set-sched-health",
    "set-sched-backup",
    "set-sched-check",
    "set-sched-notify",
    "set-retention-count",
    "set-retention-mb",
  ]) {
    assertEquals(CLIENT_JS.includes(id), true, `设置页缺字段 ${id}`);
  }
  assertEquals(CLIENT_JS.includes("schedule: {"), true, "保存时没带上 schedule");
  assertEquals(CLIENT_JS.includes("retention: {"), true, "保存时没带上 retention");
  assertEquals(
    CLIENT_JS.includes("maxBackupBytes: (Number($('set-retention-mb').value) || 2048) * 1048576"),
    true,
    "MB → 字节的换算丢了（写错就会把保留上限设成 2 MB）",
  );
  assertEquals(CLIENT_JS.includes("定时任务与备份"), true, "卡片标题丢了");
});
