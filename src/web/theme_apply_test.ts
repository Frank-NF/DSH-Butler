/** 守卫：设置里的主题必须真的生效（用户报「主题色切换无效」）。 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("主题：设置改动必须落到 localStorage 并重画", () => {
  const has = (s: string) => CLIENT_JS.includes(s);
  assertEquals(has("function applyThemePref(pref)"), true, "缺少应用主题偏好的实现");
  assertEquals(has("localStorage.removeItem(THEME_KEY)"), true, "auto 必须去掉本地覆盖");
  assertEquals(has("applyThemePref(body.theme);"), true, "保存设置后必须应用主题");
  assertEquals(has("applyThemePref(themeSel.value);"), true, "下拉选择时就该预览");
  assertEquals(has("applyThemePref(res.config.theme);"), true, "启动时按配置同步一次");
});
