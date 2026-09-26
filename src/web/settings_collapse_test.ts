/** 守卫：设置页改成左侧分组导航 + 右侧内容（页面不再需要长滚）。 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("设置页：左导航分组，右侧只显示当前一组", () => {
  assertEquals(CLIENT_JS.includes("function layoutSettingsSections()"), true, "没有分组排版");
  assertEquals(CLIENT_JS.includes("if (page === 'settings') layoutSettingsSections();"), true, "渲染后没调用");
  assertEquals(CLIENT_JS.includes("function settingsSummaryOf(title, card)"), true, "导航项没有状态摘要");
  for (const t of ["外观与窗口", "DSH 页面里的浮动工具条", "插件市场", "定时任务与备份", "更新", "网络与高级"]) {
    assertEquals(CLIENT_JS.includes("'" + t + "'"), true, `摘要表缺 ${t}`);
  }
  // 左侧导航：真按钮 + role=tab + aria-selected（键盘与读屏可达）
  assertEquals(CLIENT_JS.includes("nav.setAttribute('role', 'tablist')"), true);
  assertEquals(CLIENT_JS.includes("btn.setAttribute('data-sec-go', String(j))"), true);
  assertEquals(CLIENT_JS.includes("setAttribute('aria-selected'"), true);
  // 切组只切 hidden：不重渲染，已改的输入不丢；正文留在 DOM 里，保存读得到
  assertEquals(CLIENT_JS.includes("panels[pi].hidden ="), true);
  assertEquals(CLIENT_JS.includes("card.hidden = j !== idx;"), true);
  // 旧的上下折叠必须已经拆掉（留着会和新排版打架）
  assertEquals(CLIENT_JS.includes("collapseSettingsSections"), false, "旧的折叠函数还在");
  assertEquals(CLIENT_JS.includes("data-sec-toggle"), false, "旧的折叠开关还在");
  assertEquals(CLIENT_JS.includes("btn-sec-expand"), false, "「展开全部」按钮应已移除");
});
