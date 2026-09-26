/** 运维统计的纯函数测试（P3）。 */
import { assertEquals } from "@std/assert";
import type { Job } from "../../jobs/types.ts";
import { buildJobStats, dirVolume, failureKey } from "./stats.ts";

function job(over: Partial<Job>): Job {
  return {
    id: "j",
    action: "plugin.install",
    actionTitle: "安装插件",
    params: {},
    status: "succeeded",
    createdAt: "2026-09-26T10:00:00.000Z",
    startedAt: "2026-09-26T10:00:00.000Z",
    endedAt: "2026-09-26T10:00:02.000Z",
    steps: [],
    progress: 1,
    ...over,
  } as Job;
}

Deno.test("统计：成功率、耗时、动作与触发方式分布", () => {
  const now = Date.parse("2026-09-26T20:00:00.000Z");
  const jobs = [
    job({ id: "a", source: "ui", endedAt: "2026-09-26T10:00:01.000Z" }),
    job({ id: "b", source: "schedule", actionTitle: "立即备份一次", endedAt: "2026-09-26T10:00:04.000Z" }),
    job({ id: "c", source: "ui", status: "failed", error: "第一行原因\n第二行细节" }),
    job({ id: "d", status: "succeeded", startedAt: "2026-08-01T10:00:00.000Z", createdAt: "2026-08-01T10:00:00.000Z" }),
  ];
  const s = buildJobStats(jobs, 30, now);
  assertEquals(s.total, 3, "30 天窗口外的旧任务不该计入");
  assertEquals(s.ok, 2);
  assertEquals(s.failed, 1);
  assertEquals(s.successRate, 66.7);
  assertEquals(s.maxMs, 4000);
  assertEquals(s.bySource.map((b) => b.key), ["界面", "定时"]);
  assertEquals(s.topActions.length, 2);
  assertEquals(s.daily.length, 30, "每天都应有点（没有任务就是 0）");
  assertEquals(s.daily[s.daily.length - 1]!.count, 3);
});

Deno.test("统计：失败原因归一（数字抹平、路径折叠、只取首行）", () => {
  const raw = job({ status: "failed", error: "打不开 C:\\Users\\x\\.dsh\\a\\b.json，码 1234\n细节" });
  const key = failureKey(raw);
  assertEquals(key.includes("1234"), false, "数字应被抹成 N");
  assertEquals(key.includes("Users"), false, "路径应被折叠");
  assertEquals(key.includes("细节"), false, "只取首行");
  assertEquals(failureKey(job({ status: "interrupted", error: "" })), "上次被打断");
  assertEquals(failureKey(job({ status: "failed", error: "" })), "失败（无原因）");
});

Deno.test("统计：空历史不炸", () => {
  const s = buildJobStats([], 7, Date.now());
  assertEquals(s.total, 0);
  assertEquals(s.successRate, 0);
  assertEquals(s.avgMs, null);
  assertEquals(s.since, null);
  assertEquals(s.daily.length, 7);
});

Deno.test("体积统计：目录不存在时返回 0 而不是抛错", () => {
  const v = dirVolume("不存在的目录", "G:\\DSH\\DSH-Butler\\__no_such_dir__");
  assertEquals(v.bytes, 0);
  assertEquals(v.files, 0);
  assertEquals(v.truncated, false);
});
