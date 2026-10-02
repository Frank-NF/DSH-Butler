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
    BUTLER_BAR_JS.includes("var HOST_ID = 'dsh-butler-dock'"),
    true,
    "脚本里没有宿主探针 id，重复注入会叠出多条悬浮条",
  );
  assertEquals(
    /var host = document\.getElementById\(HOST_ID\);\s*var style = document\.getElementById\(STYLE_ID\);\s*if \(host && style\) return;/
      .test(BUTLER_BAR_JS),
    true,
    "脚本没有「宿主与样式表都在就直接返回」的短路",
  );
});

// 2026-10-02 用户反馈「右下角管家小图标总丢失，要不就是样式表没了」的防复发断言。
// 样式表挂在 head、宿主 div 挂在 body，是两次 append；页面侧重建 head（换主题、
// 重建客户端 bundle）会只抹掉样式表。所以补的时候必须「缺哪样补哪样」，
// 而且只补样式表那一支必须补完就收手——往下走会把事件再绑一遍。
Deno.test("悬浮条：样式表被页面抹掉时只补样式表，不重绑事件", () => {
  assertEquals(
    BUTLER_BAR_JS.includes("var STYLE_ID = 'dsh-butler-dock-style'"),
    true,
    "脚本没有样式表的探针 id —— 只查宿主时，页面重建 head 会留一条没样式的裸 div 再也补不回来",
  );
  const branch = BUTLER_BAR_JS.indexOf("if (host) {");
  const ret = BUTLER_BAR_JS.indexOf("return;", branch);
  const mount = BUTLER_BAR_JS.indexOf("document.body.appendChild(host)");
  assertEquals(branch > 0, true, "没有「宿主还在、只补样式表」这一支");
  assertEquals(
    ret > branch && ret < mount,
    true,
    "只补样式表那一支没有提前 return —— 会继续往下走，把事件和定时器再绑一遍（点一下响应多次）",
  );
  assertEquals(
    BUTLER_BAR_JS.includes("if (!style) {"),
    true,
    "宿主没了、样式表还在时不能再塞一个同 id 的 style（重复 id 谁也没法管）",
  );
});

// 另一半根因：当初注释写着「每 15 秒保证它在」，其实从来没有那个定时器 ——
// 页面整页重载（DSH 重启后 WebView 重新加载、用户手动刷新、WebView2 崩溃恢复）
// 会把注入的 DOM 一起清空，图标从此回不来。这两条断言钉住修复。
Deno.test("悬浮条：页面整页重载后要有人把它捞回来（探针 + 周期性兜底）", async () => {
  const mainTs = await Deno.readTextFile(new URL("../main.ts", import.meta.url));
  assertEquals(
    mainTs.includes('extraProbeIds: ["dsh-butler-dock-style"]'),
    true,
    "宿主侧探针没带上样式表 id —— 页面抹掉样式表后会被判成「已注入」，永远不补",
  );
  const tickAt = mainTs.indexOf("const tick = async () => {");
  const endAt = mainTs.indexOf("void tick();", tickAt);
  assertEquals(tickAt > 0 && endAt > tickAt, true, "没找到后台保活定时器的 tick，守卫本身失效了");
  assertEquals(
    mainTs.slice(tickAt, endAt).includes("ensureOverlay();"),
    true,
    "ensureOverlay 没挂在后台保活的 tick 上 —— 页面整页重载后悬浮条就永远回不来",
  );
});
