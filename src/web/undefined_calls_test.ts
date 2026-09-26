/**
 * script_guard 的回归测试：嵌套调用里的「未定义函数」必须被抓到。
 *
 * 【2026-09-25 真实事故】P0-4 给回滚点页加时间线时调用了 fmtAgo()，定义在同一次编辑批次里
 * 被回滚掉（编辑器报成功、文件里没有）。既有守卫本该拦住，却因为判定里前缀字符被消耗，
 * 抓不到 esc(fmtAgo(...)) 这种嵌套写法 —— 页面一打开就 ReferenceError，用户看到「回滚点报错」。
 * 这两条测试把那个洞钉住（第一条就是当时那段的形状）。
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";
import { findUndefinedCalls } from "./script_guard.ts";

Deno.test("守卫：嵌套调用里的未定义函数也要报（fmtAgo 那次的形状）", () => {
  const snippet = [
    "function esc(s) { return s; }",
    "function render(p) {",
    "  return '<span>' + esc(fmtAgo(p.createdAt)) + '</span>';",
    "}",
  ].join("\n");
  const missing = findUndefinedCalls(snippet);
  assertEquals(missing, ["fmtAgo"], `嵌套调用必须被检查到，实际：${JSON.stringify(missing)}`);
});

Deno.test("守卫：形参、关键字、内建都不许误报", () => {
  const snippet = [
    "function f(a, b) { return a(b) + Math.max(1, 2) + String(a) + JSON.stringify({}); }",
    "function g() { if (f) { for (;;) { break; } } return typeof f; }",
  ].join("\n");
  assertEquals(findUndefinedCalls(snippet), []);
});

Deno.test("守卫：当前注入脚本必须干净", () => {
  assertEquals(findUndefinedCalls(CLIENT_JS), []);
});
