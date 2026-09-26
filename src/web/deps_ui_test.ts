/** 守卫：插件页必须有「依赖冲突体检」入口与结果卡片（P0-3）。 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("插件页：依赖体检入口 + 结果卡片 + 重建锁文件按钮", () => {
  assertEquals(CLIENT_JS.includes("'plugin.deps'"), true, "插件页缺依赖体检入口");
  assertEquals(CLIENT_JS.includes("依赖冲突体检"), true, "入口按钮文案丢了");
  assertEquals(CLIENT_JS.includes("state.extra.pluginDeps"), true, "结果没有地方存");
  assertEquals(CLIENT_JS.includes("renderFindings(dp.findings)"), true, "结果卡片没有渲染结论（一键修按钮也就出不来）");
  assertEquals(CLIENT_JS.includes("'plugin.syncLock'"), true, "缺「重建锁文件」按钮");
});
