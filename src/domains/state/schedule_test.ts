/**
 * 定时任务判定测试（P1-2e + P2-3）。
 *
 * 「到点自动动」的逻辑最容易写错又不自知：跑太勤是骚扰，跑太懒是失职，
 * 首次启动就狂跑一遍更糟（用户什么都没干，机器却在体检+备份）。
 * 所以按纯函数把这些边界逐个钉住。
 */
import { assertEquals } from "@std/assert";
import type { ScheduleConfig } from "./config.ts";
import { dueTasks, initializeScheduleState, markRun, taskIntervals } from "./schedule.ts";

const base: ScheduleConfig = {
  enabled: true,
  healthEveryHours: 12,
  backupEveryHours: 24,
  checkUpdatesEveryHours: 6,
  notify: true,
};

const H = 3600_000;
const now = Date.parse("2026-09-26T12:00:00Z");
const ago = (h: number) => new Date(now - h * H).toISOString();

Deno.test("定时任务：开关与 0 值", () => {
  assertEquals(dueTasks(now, { ...base, enabled: false }, {}), [], "总开关关了就该一个都不跑");
  const off = { ...base, healthEveryHours: 0, backupEveryHours: 0, checkUpdatesEveryHours: 0 };
  assertEquals(dueTasks(now, off, { health: ago(100) }), [], "0 = 不做这件事");
  assertEquals(taskIntervals(base).length, 3);
});

Deno.test("定时任务：没跑过不立刻跑，跑过就按周期算", () => {
  assertEquals(dueTasks(now, base, {}), [], "全新状态：一个都不该跑（避免每次启动都体检+备份）");
  assertEquals(dueTasks(now, base, {}, { initial: true }).length, 3, "显式 initial 才全跑");
  // 体检 12h：11 小时前跑过 → 未到点；13 小时前跑过 → 到点
  assertEquals(dueTasks(now, base, { health: ago(11) }), []);
  const due1 = dueTasks(now, base, { health: ago(13) });
  assertEquals(due1.map((t) => t.id), ["health"]);
  assertEquals(due1[0]!.overdueMs, 1 * H, "超期 1 小时");
});

Deno.test("定时任务：多个到点时，超期最久的排最前", () => {
  const due = dueTasks(now, base, { health: ago(13), backup: ago(50), checkUpdates: ago(7) });
  assertEquals(due.map((t) => t.id), ["backup", "health", "checkUpdates"]);
  assertEquals(due[0]!.overdueMs, 26 * H, "备份超期 26 小时");
});

Deno.test("定时任务：坏时间戳不许炸，也不算到点", () => {
  assertEquals(dueTasks(now, base, { health: "不是时间" }), []);
  assertEquals(dueTasks(now, base, { health: "" }), []);
});

Deno.test("定时任务：跑完记账 + 初始化从现在起算", () => {
  const s0 = initializeScheduleState(base, now);
  assertEquals(Object.keys(s0.lastRun).sort(), ["backup", "checkUpdates", "health"]);
  assertEquals(dueTasks(now, base, s0.lastRun), [], "刚初始化完不该有任何到点");
  assertEquals(dueTasks(now + 7 * H, base, s0.lastRun).map((t) => t.id), ["checkUpdates"]);
  const s1 = markRun(s0, "health", new Date(now).toISOString());
  assertEquals(s1.lastRun.health, new Date(now).toISOString());
  assertEquals(s0.lastRun.health !== undefined, true, "markRun 是纯函数，不改原对象");
});
