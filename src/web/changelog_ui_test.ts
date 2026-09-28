/**
 * 守卫：本体页那张「更新日志」卡必须**在渲染之后**填充。
 *
 * 老 bug（2026-09-29 端到端实测抓到）：fillChangelog() 写在 go() 里、setMain 之前，
 * 那时卡片还没建出来 —— 结果卡片永远停在"正在读取提交记录…"，只有手动点「刷新」才有内容。
 */

import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("本体更新日志：填充必须发生在 afterRender（渲染之后），不能在 go() 渲染之前", () => {
  const call = "if (page === 'core') fillChangelog();";
  const first = CLIENT_JS.indexOf(call);
  assertEquals(first > 0, true, "找不到填充调用");
  assertEquals(CLIENT_JS.indexOf(call, first + 1), -1, "填充调用出现了不止一次（容易又跑回渲染前）");

  const afterRenderAt = CLIENT_JS.indexOf("function afterRender(page)");
  const goAt = CLIENT_JS.indexOf("function go(page, force)");
  assertEquals(afterRenderAt > 0 && goAt > afterRenderAt, true, "找不到 afterRender / go 的定义");
  assertEquals(
    first > afterRenderAt && first < goAt,
    true,
    "填充调用必须在 afterRender 里、且在 go 之前 —— 否则卡片会停在读取中",
  );
});

Deno.test("本体更新日志：优先上游对比，没有上游记录才退回本机提交", () => {
  assertEquals(CLIENT_JS.includes("'/api/changelog/upstream?limit=120'"), true, "没有取上游对比的请求");
  assertEquals(CLIENT_JS.includes("function renderUpstreamChangelog(up)"), true, "没有渲染上游改动的函数");
  assertEquals(CLIENT_JS.includes("function renderUpstreamPending(up)"), true, "没有「有新版但记录没拉过」的引导");
  assertEquals(CLIENT_JS.includes("function renderLocalChangelog()"), true, "没有退回本机提交的回退路径");
  assertEquals(CLIENT_JS.includes("'core.fetchUpstreamTags'"), true, "引导里没有拉取动作");
  assertEquals(CLIENT_JS.includes("changelog-sub"), true, "卡片副标题没留可更新的锚点");
});
