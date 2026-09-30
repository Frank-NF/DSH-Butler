/**
 * 守卫：阶段四 T9 —— 响应式与规范收尾（docs/UI-REDESIGN-PLAN-2026-09-30.md §5.1/5.2/5.3/5.4、第 207-209 行）。
 *
 * 范围：
 *  - 640-900px 侧栏 64px 图标态（现有 @media max-width:900 保留）；
 *  - <640px 侧栏转抽屉 + 顶栏汉堡按钮；顶栏徽标收进状态栏（移动端兜底）；
 *  - 间距 token --sp-1..6 定义，页面内联 margin 不再写死 px；
 *  - 字号四级（页头 18 / 卡题 13 / 正文 13 / 辅助 12.5）；
 *  - 徽标与问题清单只用语义色 --ok/--warn/--err/--info（不引入新色相）；
 *  - 可访问性：危险确认焦点落「取消」、toast 图标区分 ok/err/warn、
 *    焦点环与页签 tablist 角色、prefers-reduced-motion 保持。
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";
import { STYLE_CSS } from "./styles.ts";
import { INDEX_HTML } from "./markup.ts";

Deno.test("T9 响应式：640-900 图标态 + <640 抽屉 + 汉堡 + 徽标收进状态栏", () => {
  const railAt = STYLE_CSS.indexOf("@media (max-width: 900px) {");
  assertEquals(railAt >= 0, true, "缺 640-900 侧栏图标态（方案 5.1 保留现有 900 档）");
  assertEquals(STYLE_CSS.slice(railAt, railAt + 300).includes("--sidebar-w"), true, "900 档里侧栏没折叠成图标态");
  const drAt = STYLE_CSS.indexOf("@media (max-width: 640px) {");
  assertEquals(drAt >= 0, true, "缺 <640 抽屉档媒体查询（方案 5.1 新增）");
  const drawer = STYLE_CSS.slice(drAt, drAt + 900);
  assertEquals(drawer.includes("translateX"), true, "侧栏抽屉没有滑入滑出");
  assertEquals(drawer.includes("nav-open"), true, "抽屉开合没接 body.nav-open 状态类");
  assertEquals(drawer.includes(".topbar-right .badge"), true, "窄屏顶栏徽标没隐藏（收进状态栏）");
  assertEquals(STYLE_CSS.includes(".nav-toggle { display: none; }"), true, "汉堡按钮缺默认隐藏态");
  assertEquals(INDEX_HTML.includes('id="nav-toggle"'), true, "骨架缺汉堡按钮");
  assertEquals(INDEX_HTML.includes('id="sb-badges"'), true, "状态栏缺徽标镜像段");
  assertEquals(CLIENT_JS.includes("nav-toggle"), true, "汉堡按钮没接线");
  assertEquals(CLIENT_JS.includes("nav-open"), true, "抽屉开合没接线");
  assertEquals(CLIENT_JS.includes("sb-badges"), true, "状态栏徽标镜像段没填充");
});

Deno.test("T9 间距 token：--sp 五档定义 + 页面内联 margin 不再写死 px", () => {
  for (const t of ["--sp-1: 4px", "--sp-2: 8px", "--sp-3: 12px", "--sp-4: 16px", "--sp-6: 24px"]) {
    assertEquals(STYLE_CSS.includes(t), true, "缺间距 token " + t + "（方案 5.2）");
  }
  const inlines = CLIENT_JS.match(/style="margin[^"]*"/g) || [];
  const px = inlines.filter((s) => /\d+px/.test(s));
  assertEquals(px, [], "页面内联还有写死 px 的 margin（该用 var(--sp-N)）: " + px.slice(0, 5).join(" | "));
  assertEquals(CLIENT_JS.includes("var(--sp-"), true, "页面内联没有用上间距 token");
});

Deno.test("T9 字号四级：页头 18 / 卡题 13 / 正文 13 / 辅助 12.5", () => {
  assertEquals(/body \{[^}]*font-size: 13px/.test(STYLE_CSS), true, "正文不是 13px（方案 5.3）");
  assertEquals(STYLE_CSS.includes(".page-title { font-size: 18px"), true, "页头不是 18px/600");
  assertEquals(STYLE_CSS.includes(".card-title { font-size: 13px"), true, "卡片题不是 13px/600");
  assertEquals(STYLE_CSS.includes("12.5px"), true, "辅助字号 12.5px 丢了");
});

Deno.test("T9 语义色：徽标与问题清单只走 --ok/--warn/--err/--info", () => {
  assertEquals(STYLE_CSS.includes("--ok:"), true, "缺语义色 --ok");
  assertEquals(STYLE_CSS.includes("--info-weak:"), true, "缺语义色 --info-weak");
  const rules = STYLE_CSS.match(/\.(badge|tag|finding|nav-count)[^,{]*\{[^}]*\}/g) || [];
  const bad = rules.filter((r) => /#[0-9a-fA-F]{3,8}/.test(r.replace(/#fff/gi, "")));
  assertEquals(bad, [], "语义类里出现硬编码色相（不引入新色相）: " + bad.slice(0, 3).join(" | "));
  assertEquals(rules.length > 6, true, "语义类规则没截到（锚点要检查）");
});

Deno.test("T9 可访问性：危险确认焦点落取消 + toast 图标 + 焦点环/tablist/reduced-motion", () => {
  const cp = CLIENT_JS.slice(CLIENT_JS.indexOf("function confirmPlan("), CLIENT_JS.indexOf("function showResult("));
  assertEquals(cp.includes("$('modal-cancel').focus()"), true, "确认弹窗没把焦点落到「取消」（方案 5.4 危险操作）");
  const ts = CLIENT_JS.slice(CLIENT_JS.indexOf("function toast("), CLIENT_JS.indexOf("function api("));
  assertEquals(ts.includes("icon("), true, "toast 没有图标区分（不能只靠颜色）");
  assertEquals(ts.includes("esc(msg)"), true, "toast 改 innerHTML 后必须 esc");
  assertEquals(STYLE_CSS.includes(":focus-visible"), true, "缺全局焦点环");
  assertEquals(STYLE_CSS.includes("prefers-reduced-motion"), true, "reduced-motion 支持丢了");
  assertEquals(CLIENT_JS.includes('role="tablist"'), true, "页签组件缺 tablist 角色");
});
