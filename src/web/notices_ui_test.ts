/** 守卫：管家提醒卡片与已读交互（P2-3）。 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("提醒卡片：取数据、渲染、标记已读", () => {
  assertEquals(CLIENT_JS.includes("api('/api/notices')"), true, "没有取提醒的请求");
  assertEquals(CLIENT_JS.includes("state.notices = res[2].notices"), true, "没有把结果存下来");
  assertEquals(CLIENT_JS.includes("function noticesCard()"), true, "没有卡片渲染函数");
  assertEquals(CLIENT_JS.includes("html += noticesCard();"), true, "总览页没有插入这张卡");
  assertEquals(CLIENT_JS.includes("if (!list.length) return ''"), true, "没有提醒时不该占地方");
  assertEquals(CLIENT_JS.includes("'/api/notices/seen'"), true, "没有标记已读的请求");
  assertEquals(CLIENT_JS.includes("btn-notices-seen"), true, "缺「全部标记已读」按钮");
});
