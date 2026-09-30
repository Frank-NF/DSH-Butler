/**
 * 守卫：阶段一 T5「新增底部状态栏」（docs/UI-REDESIGN-PLAN-2026-09-30.md 第 26/98/106/196 行）。
 *
 * 方案要的是永远可见的 28px 底部条，四段：
 *   v2.0.0-rc.4 · http://127.0.0.1:8731 · 空闲/任务名 · 最近回滚点 3h 前
 *  - 住在 .app 的第三行栅格里（main 之后、进度面板之前），不浮不遮；
 *  - 任务进行中状态栏同步任务名，点一下展开（收起）进度面板；空闲时点一下给一句提示；
 *  - 进度面板 fixed bottom 抬到 28px，别把状态栏盖住；
 *  - 版本与服务地址来自首屏快照，回滚点时间来自 /api/state/overview 的 backup.latestRollbackAt。
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";
import { INDEX_HTML } from "./markup.ts";
import { STYLE_CSS } from "./styles.ts";

/** 截取 from 之后到 to 之前的片段（找不到就返回空串，断言自然失败）。 */
function between(h: string, from: string, to: string): string {
  const a = h.indexOf(from);
  if (a < 0) return "";
  const b = h.indexOf(to, a + from.length);
  return b < 0 ? "" : h.slice(a + from.length, b);
}

/** 计数：needle 在 h 里出现几次。 */
function countIn(h: string, needle: string): number {
  let n = 0;
  let i = h.indexOf(needle);
  while (i >= 0) {
    n++;
    i = h.indexOf(needle, i + needle.length);
  }
  return n;
}

Deno.test("状态栏：骨架四段都在，且住在 .app 第三行（main 之后、进度面板之前）", () => {
  assertEquals(INDEX_HTML.includes('class="statusbar"'), true, "页面骨架没有状态栏");
  for (const id of ["sb-version", "sb-url", "sb-task", "sb-backup"]) {
    assertEquals(INDEX_HTML.includes(`id="${id}"`), true, `状态栏缺一段：${id}`);
  }
  const mainAt = INDEX_HTML.indexOf("<main");
  const sbAt = INDEX_HTML.indexOf('class="statusbar"');
  const pwAt = INDEX_HTML.indexOf('class="progress-wrap"');
  assertEquals(
    mainAt >= 0 && sbAt > mainAt && sbAt < pwAt,
    true,
    "状态栏必须跟在内容区后面、进度面板前面（.app 的第三行栅格）",
  );
});

Deno.test("状态栏：28px 常显，进度面板浮在其上方不遮挡", () => {
  assertEquals(
    STYLE_CSS.includes("grid-template-rows: var(--topbar-h) 1fr 28px"),
    true,
    ".app 没给状态栏留第三行",
  );
  const sb = between(STYLE_CSS, ".statusbar {", "}");
  assertEquals(sb.includes("height: 28px"), true, "状态栏不是 28px 高");
  const pw = between(STYLE_CSS, ".progress-wrap {", "}");
  assertEquals(pw.includes("bottom: 28px"), true, "进度面板还在 bottom:0，会盖住状态栏");
});

Deno.test("状态栏：四段数据接线 —— 版本/地址/回滚点时间来自首屏快照", async () => {
  assertEquals(CLIENT_JS.includes("function fillStatusBar("), true, "没有状态栏填充函数");
  assertEquals(CLIENT_JS.includes("$('sb-version')"), true, "版本段没接线");
  assertEquals(CLIENT_JS.includes("$('sb-url')"), true, "服务地址段没接线");
  assertEquals(CLIENT_JS.includes("latestRollbackAt"), true, "回滚点时间没从概览快照里读");
  assertEquals(
    countIn(CLIENT_JS, "fillStatusBar(ov);") >= 2,
    true,
    "填充函数只定义没人调（至少启动 + 总览刷新两处）",
  );
  const OV_SRC = await Deno.readTextFile(new URL("../api/overview.ts", import.meta.url));
  assertEquals(OV_SRC.includes("latestRollbackAt"), true, "overview 快照没带回滚点时间字段");
  assertEquals(OV_SRC.includes("listRollbackPoints"), true, "回滚点时间要取自 listRollbackPoints");
});

Deno.test("状态栏：任务指示跟随进度，点击展开进度面板、空闲点一下有提示", () => {
  const show = between(CLIENT_JS, "function showProgress(title) {", "function hideProgress()");
  assertEquals(show.includes("$('sb-task')"), true, "任务开始时状态栏没亮任务名");
  const hide = between(CLIENT_JS, "function hideProgress() {", "function renderSteps(");
  assertEquals(hide.includes("空闲"), true, "任务结束后状态栏没回空闲");
  assertEquals(CLIENT_JS.includes("hit('#sb-task')"), true, "状态栏任务段没绑点击");
  const branch = between(CLIENT_JS, "hit('#sb-task')", "hit('#btn-refresh-changelog')");
  assertEquals(branch.includes("classList.toggle('show')"), true, "点击没展开/收起进度面板");
  assertEquals(branch.includes("当前空闲"), true, "空闲时点击没有提示");
});
