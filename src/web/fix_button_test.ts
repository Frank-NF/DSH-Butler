/**
 * 守卫：体检结论上的修复入口必须真的被渲染成按钮。【P0-1 · 2026-09-25】
 *
 * 以前 renderFindings 只印「建议：…」这句话，带 fixAction 的 19 条结论全都没有入口，
 * 用户得自己找地方点。这条测试盯住那段渲染代码，防止哪天被重写掉。
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("体检结论：带 fixAction 的结论会渲染出一键修按钮", () => {
  assertEquals(CLIENT_JS.includes("finding-fix"), true, "修复按钮的容器类没了");
  assertEquals(CLIENT_JS.includes("if (f.fixAction)"), true, "没有按 fixAction 渲染按钮的逻辑");
  assertEquals(
    CLIENT_JS.includes("'wrench',"),
    true,
    "按钮应该用扳手图标（与其它普通按钮区分开）",
  );
  // 按钮要能带上参数（有些修复动作需要，比如按名字修某个插件）
  assertEquals(CLIENT_JS.includes("data-params"), true, "按钮没有携带参数的通道");
  assertEquals(CLIENT_JS.includes("getAttribute('data-params')"), true, "参数没有在读回来时解析");
});
