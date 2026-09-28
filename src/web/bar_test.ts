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

Deno.test("悬浮条：管家界面上不摆「回管家」按钮，也不压住进度条/提示气泡", () => {
  assertEquals(
    BUTLER_BAR_JS.includes("__DSH_BUTLER_HOME__"),
    true,
    "没拿到管家页地址，页面无法判断自己是不是已经在管家界面上",
  );
  assertEquals(
    BUTLER_BAR_JS.includes("var HOME_BTN = AT_HOME ? '' :"),
    true,
    "在管家界面上仍会生成「回管家」按钮（点下去是空动作）",
  );
  assertEquals(
    BUTLER_BAR_JS.includes("if (backBtn) backBtn.addEventListener"),
    true,
    "按钮在管家页上不存在，事件绑定却没做空判断 —— 整条悬浮条会挂掉",
  );
  // 管家页底部有任务进度条、右下角有提示气泡：悬浮条得按它们的高度抬上去
  assertEquals(BUTLER_BAR_JS.includes("progress-wrap"), true, "没有避让底部任务进度条");
  assertEquals(BUTLER_BAR_JS.includes("toast-host"), true, "没有避让右下角提示气泡");
  assertEquals(BUTLER_BAR_JS.includes("modal-backdrop"), true, "确认弹窗打开时没有把自己藏起来");
});

Deno.test("悬浮条：启停/重启三个按钮都要真的接到命令上", () => {
  for (const cmd of ["'stop'", "'start'", "'restart'"]) {
    assertEquals(BUTLER_BAR_JS.includes(cmd), true, "悬浮条缺 " + cmd + " 命令");
  }
  assertEquals(
    BUTLER_BAR_JS.includes("$('dbb-restart').addEventListener"),
    true,
    "「重启」按钮没有绑事件 —— 点下去毫无反应（曾经就是这样）",
  );
});

Deno.test("悬浮条：被注入到 Chromium 错误页时立刻请宿主救援", () => {
  assertEquals(
    BUTLER_BAR_JS.includes("document.querySelector('#main-frame-error,#error-code,.neterror')"),
    true,
    "没检测错误页 —— 用户会一直盯着「拒绝连接」，只能重开程序",
  );
  assertEquals(
    BUTLER_BAR_JS.includes("history.back()"),
    true,
    "应当先尝试 history.back() 秒退回上一页（不重刷、不丢草稿）",
  );
  assertEquals(BUTLER_BAR_JS.includes("call('recover')"), true, "退回失败时没向宿主求救");
  assertEquals(
    BUTLER_BAR_JS.includes("}, 1200);"),
    true,
    "缺少 back() 之后的复查：连续两次失败时 back() 可能回到的还是错误页",
  );
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
