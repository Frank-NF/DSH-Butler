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
  // 【必须锁住的耦合】setMain 把页面包进 #main > .wrap，卡片是 .wrap 的子节点。
  // 曾经按 #main.children 找卡片 → 一个都找不到 → 函数静默 return → 界面「完全没改」。
  assertEquals(CLIENT_JS.includes("'<div class=\"wrap\">' + html + '</div>'"), true, "setMain 的包裹结构变了");
  assertEquals(
    CLIENT_JS.includes("var scope = host.querySelector('.wrap') || host;"),
    true,
    "分组排版必须从 .wrap 里找卡片，否则会静默不生效",
  );
  // 顺序约束：必须先插布局、再搬卡片（搬完锚点就不在文档里了，会抛 not-a-child）
  var iInsert = CLIENT_JS.indexOf("scope.insertBefore(layout, anchor);");
  var iMove = CLIENT_JS.indexOf("pane.appendChild(card);");
  assertEquals(iInsert > 0, true, "没有把布局插进 .wrap");
  assertEquals(iMove > 0, true, "没有把卡片搬进 pane");
  assertEquals(iInsert < iMove, true, "必须先 insertBefore 再 appendChild，否则 insertBefore 会抛错、整页报检测失败");
  // 旧的上下折叠必须已经拆掉（留着会和新排版打架）
  assertEquals(CLIENT_JS.includes("collapseSettingsSections"), false, "旧的折叠函数还在");
  assertEquals(CLIENT_JS.includes("data-sec-toggle"), false, "旧的折叠开关还在");
  assertEquals(CLIENT_JS.includes("btn-sec-expand"), false, "「展开全部」按钮应已移除");
});
