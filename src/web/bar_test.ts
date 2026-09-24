/**
 * 悬浮条脚本的守卫（与 client_test 同一套判据，见 script_guard.ts）。
 *
 * 悬浮条是**注入到 DSH 页面里**的代码：一旦有语法错或调了不存在的函数，
 * 表现是"DSH 界面右下角什么都没有"，而且不会有任何日志 —— 比管家自己的页面更难查。
 */
import { assertEquals } from "@std/assert";
import { BUTLER_BAR_JS } from "./bar.ts";
import { findUndefinedCalls } from "./script_guard.ts";

Deno.test("BUTLER_BAR_JS 是合法 JavaScript", () => {
  let err: unknown = null;
  try {
    new Function(BUTLER_BAR_JS);
  } catch (e) {
    err = e;
  }
  assertEquals(
    err,
    null,
    `悬浮条脚本语法错误：${err instanceof Error ? err.message : String(err)}`,
  );
});

Deno.test("BUTLER_BAR_JS 不调用未定义的名字（bindings 是页面桥，属白名单）", () => {
  const missing = findUndefinedCalls(BUTLER_BAR_JS, { extraGlobals: ["bindings"] });
  assertEquals(missing, [], `悬浮条脚本调用了未定义的名字：${missing.join("、")}`);
});

Deno.test("悬浮条必须幂等：注入前先查探针 id（防止 SPA 下叠加出好几条）", () => {
  assertEquals(
    BUTLER_BAR_JS.includes("dsh-butler-dock"),
    true,
    "脚本里没有探针 id，重复注入会叠出多条悬浮条",
  );
  assertEquals(
    /getElementById\('dsh-butler-dock'\)\)\s*return/.test(BUTLER_BAR_JS),
    true,
    "脚本没有「已存在就直接返回」的短路",
  );
});
