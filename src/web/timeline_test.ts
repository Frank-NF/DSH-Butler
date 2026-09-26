/**
 * 守卫：回滚点页面必须是时间线形态，并且每条都带「影响预览」入口。【P0-4 · 2026-09-25】
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("回滚点页：时间线 + 影响预览入口", () => {
  for (const needle of ["timeline", "tl-item", "tl-dot", "tl-actions", "fmtAgo"]) {
    assertEquals(CLIENT_JS.includes(needle), true, `时间线缺了 ${needle}`);
  }
  assertEquals(
    CLIENT_JS.includes("data-act=\"backup.preview\""),
    true,
    "每个回滚点都要有「影响预览」按钮（否则用户点还原前不知道会改什么）",
  );
  assertEquals(
    CLIENT_JS.includes("if (action === 'backup.preview')"),
    true,
    "预览结果没有渲染分支",
  );
  assertEquals(
    CLIENT_JS.includes("回滚影响预览"),
    true,
    "预览弹窗的标题丢了",
  );
});
