/**
 * 提醒去重与上限测试（P2-3）。
 *
 * 定时任务每 5 分钟醒一次：不去重就会把同一件事刷成一屏。
 */
import { assertEquals } from "@std/assert";
import {
  DEDUP_WINDOW_MS,
  MAX_NOTICES,
  mergeNotice,
  noticePlanOf,
  resolveNotices,
} from "./notices.ts";

const T0 = Date.parse("2026-09-26T10:00:00Z");

Deno.test("提醒：同一件事在窗口期内只留一条（刷新时间）", () => {
  let list = mergeNotice([], { level: "warn", title: "3 个插件有新版本", detail: "a", source: "定时查更新" }, T0);
  assertEquals(list.length, 1);
  assertEquals(list[0]!.seen, false);
  list = mergeNotice(list, { level: "warn", title: "3 个插件有新版本", detail: "b", source: "定时查更新" }, T0 + 3600_000);
  assertEquals(list.length, 1, "一小时内重复的同一件事不许再记一条");
  assertEquals(list[0]!.detail, "b", "但要刷新细节");
  assertEquals(list[0]!.at, new Date(T0 + 3600_000).toISOString());
  // 过了窗口期就是新的一条
  // 窗口从「最近一次发生」算起（上面刚刷新过），所以要再往后推一个窗口
  list = mergeNotice(list, { level: "warn", title: "3 个插件有新版本", detail: "c", source: "定时查更新" }, T0 + 3600_000 + DEDUP_WINDOW_MS + 1);
  assertEquals(list.length, 2);
});

Deno.test("提醒：不同来源/标题算不同的事，最新在前", () => {
  let list = mergeNotice([], { level: "info", title: "A", source: "定时体检" }, T0);
  list = mergeNotice(list, { level: "info", title: "A", source: "定时备份" }, T0 + 1000);
  list = mergeNotice(list, { level: "error", title: "B", source: "定时体检" }, T0 + 2000);
  assertEquals(list.length, 3);
  assertEquals(list[0]!.title, "B");
});

Deno.test("提醒：条件没了就把旧条目撤掉（插件全更新完后不该还挂着「有新版本」）", () => {
  let list = mergeNotice([], { level: "info", title: "1 个插件有新版本", detail: "a", source: "定时查更新" }, T0);
  list = mergeNotice(list, { level: "warn", title: "定时体检：0 项错误 / 1 项警告", source: "定时体检" }, T0 + 1000);
  const r = resolveNotices(list, { source: "定时查更新" });
  assertEquals(r.removed, 1);
  assertEquals(r.list.map((n) => n.source), ["定时体检"], "只撤该来源，别误伤别的提醒");
  assertEquals(resolveNotices(r.list, { source: "定时查更新" }).removed, 0, "本来就没有就别报撤掉了");
});

Deno.test("提醒：撤销也能按标题精确到一条", () => {
  let list = mergeNotice([], { level: "info", title: "A", source: "s" }, T0);
  list = mergeNotice(list, { level: "info", title: "B", source: "s" }, T0 + 1000);
  assertEquals(resolveNotices(list, { source: "s", title: "A" }).list.map((n) => n.title), ["B"]);
});

Deno.test("提醒计划：条件成立记一条，条件不成立撤那一条", () => {
  const on = noticePlanOf("定时查更新", { level: "info", title: "1 个插件有新版本", detail: "x 1.0 → 1.1" });
  assertEquals(on.add?.source, "定时查更新");
  assertEquals(on.add?.detail, "x 1.0 → 1.1");
  assertEquals(on.clearSource, null, "有条件成立时不该撤");
  const off = noticePlanOf("定时查更新", null);
  assertEquals(off.add, null);
  assertEquals(off.clearSource, "定时查更新", "没更新了就必须撤掉上次那条提示");
});

Deno.test("提醒：上限裁剪，且已看过的标记会被重置为未看", () => {
  let list = mergeNotice([], { level: "info", title: "老", source: "s" }, T0);
  list = [{ ...list[0]!, seen: true }];
  list = mergeNotice(list, { level: "info", title: "老", source: "s" }, T0 + 1000);
  assertEquals(list[0]!.seen, false, "同一件事又发生了，应重新变成未看");
  let many = mergeNotice([], { level: "info", title: "t0", source: "s" }, T0);
  for (let i = 1; i < MAX_NOTICES + 5; i++) {
    many = mergeNotice(many, { level: "info", title: "t" + i, source: "s" + i }, T0 + i * 1000);
  }
  assertEquals(many.length, MAX_NOTICES);
  assertEquals(many[0]!.title, "t" + (MAX_NOTICES + 4), "保留最新的一批");
});
