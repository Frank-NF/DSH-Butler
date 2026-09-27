/**
 * 定时任务「留痕」这一半的测试（P2-3 补）。
 *
 * 定时任务不只是记一条就完事：提醒说的是「现在有这件事」，
 * 事情解决了却把条目留着，它就从提醒变成假消息 ——
 * 实测反馈：插件都更新完了，管家首页还挂着「1 个插件有新版本」。
 */

import { assertEquals } from "@std/assert";
import { PLUGIN_VERSION_ACTIONS, updateNoticeOf } from "./scheduler.ts";

Deno.test("定时查更新：没有可更新的插件时不留痕迹", () => {
  assertEquals(updateNoticeOf({}), null);
  assertEquals(
    updateNoticeOf({ a: { current: "1.0.0", latest: "1.0.0", outdated: false } }),
    null,
    "版本一样就不该记提醒",
  );
});

Deno.test("插件装/卸/更新成功 = 「有新版本」这条提醒当场过期", () => {
  for (
    const action of [
      "plugin.install",
      "plugin.uninstall",
      "plugin.batchUpdate",
      "plugin.installOffline",
    ]
  ) {
    assertEquals(
      PLUGIN_VERSION_ACTIONS.has(action),
      true,
      action + " 没登记 —— 用户手动更新完，首页还会挂着旧提示",
    );
  }
  assertEquals(PLUGIN_VERSION_ACTIONS.has("diag.healthCheck"), false, "只读动作不该触发撤销");
});
