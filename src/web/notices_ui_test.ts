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

Deno.test("提醒卡片：能手动清空（定时任务撤不掉的旧条目要有出口）", () => {
  assertEquals(CLIENT_JS.includes("'/api/notices/clear'"), true, "没有清空提醒的请求");
  assertEquals(CLIENT_JS.includes("btn-notices-clear"), true, "缺「清空提醒」按钮");
});

Deno.test("首页状态卡：服务在跑时给得出「停止服务」", () => {
  // 只看「DSH 已就绪」这一支：运行状态页里本来就有停止按钮，全文件搜会假绿
  const start = CLIENT_JS.indexOf('<div class="hero-title">DSH 已就绪</div>');
  assertEquals(start > 0, true, "找不到首页状态卡的「DSH 已就绪」分支");
  const block = CLIENT_JS.slice(start, CLIENT_JS.indexOf("} else if (s.next === 'start')", start));
  assertEquals(
    block.includes("writeBtn('stop', '停止服务', 'runtime.stop'"),
    true,
    "首页只有进入/启动，没有关闭 DSH 服务的入口（用户反馈过）",
  );
});
