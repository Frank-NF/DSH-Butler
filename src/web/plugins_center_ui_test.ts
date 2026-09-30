/**
 * 守卫：阶段二 T7 —— 插件页 + 插件市场合并为「插件中心」页签式
 * （docs/UI-REDESIGN-PLAN-2026-09-30.md 4.1 / 199-201）。
 *
 *  - 页头「插件中心」，副题「让插件装得上、跑得动」，页头只留 1 主 1 次；
 *  - 三个页签 已装 | 市场 | 维护，role=tablist/tab/aria-selected（复用设置页范式）；
 *  - 旧路由 id 'market' 保留并重定向到市场页签（书签不炸），侧栏不再单列市场；
 *  - 批量更新住在市场页签；离线安装（.tgz）/诊断/清理只在维护页签；
 *  - renderPlugins 只管已装内容，页头由 pluginShell 统一提供。
 */

import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

/** 在 h 中从 from 之后截到 to —— to 必须在 from 之后，避免截错区域。 */
function between(h: string, from: string, to: string): string {
  const a = h.indexOf(from);
  if (a < 0) return "";
  const b = h.indexOf(to, a + from.length);
  if (b < 0) return "";
  return h.slice(a, b);
}

function countIn(h: string, needle: string): number {
  let n = 0;
  let i = h.indexOf(needle);
  while (i >= 0) {
    n++;
    i = h.indexOf(needle, i + needle.length);
  }
  return n;
}

Deno.test("插件中心：路由重定向与页签状态（旧 id 'market' 不炸）", () => {
  const go = between(CLIENT_JS, "function go(page, force) {", "function showError(");
  assertEquals(go.length > 200, true, "go() 段没截到（锚点要检查）");
  assertEquals(
    go.includes("state.plugins.tab = 'market'"),
    true,
    "点侧栏「市场」入口要重定向到市场页签",
  );
  assertEquals(
    go.includes("state.plugins.tab = 'installed'"),
    true,
    "从别处进插件中心要回默认「已装」页签",
  );
  assertEquals(
    go.includes("state.page !== 'plugins'"),
    true,
    "页内点页签不能触发重置（state.page 已是 plugins）",
  );
  assertEquals(go.includes("routeDef(page)"), true, "go() 要按页签取路由");
  assertEquals(go.includes("def.cacheKey || page"), true, "缓存键要跟随页签");
  assertEquals(CLIENT_JS.includes("function routeDef("), true, "没有 routeDef helper");
});

Deno.test("插件中心：PAGES 注册 —— 插件页改名，市场 hiddenFromNav", () => {
  const market = between(CLIENT_JS, "{ id: 'market',", "id: 'settings'");
  assertEquals(market.length > 50, true, "market 路由项没截到");
  assertEquals(
    market.includes("hiddenFromNav: true"),
    true,
    "市场不再单列侧栏（仍注册路由，靠重定向进中心）",
  );
  const plugins = between(CLIENT_JS, "{ id: 'plugins',", "id: 'logs'");
  assertEquals(plugins.length > 50, true, "plugins 路由项没截到");
  assertEquals(plugins.includes("label: '插件中心'"), true, "侧栏应叫「插件中心」");
  assertEquals(
    CLIENT_JS.includes("navBtn('store'"),
    false,
    "还有指路按钮把用户往市场带（市场已是页签）",
  );
});

Deno.test("插件中心：state 与 pluginShell 页头/页签", () => {
  assertEquals(
    CLIENT_JS.includes("plugins: { tab: 'installed' }"),
    true,
    "state 缺页签字段",
  );
  const shell = between(CLIENT_JS, "function pluginShell(", "function setMain(");
  assertEquals(shell.length > 300, true, "pluginShell 段没截到");
  assertEquals(shell.includes("pageHead('插件中心'"), true, "页头不是「插件中心」");
  assertEquals(
    shell.includes("让插件装得上、跑得动"),
    true,
    "副题要按方案 4.1：让插件装得上、跑得动",
  );
  assertEquals(shell.includes('role="tablist"'), true, "页签容器缺 role=tablist");
  assertEquals(shell.includes('role="tab"'), true, "页签按钮缺 role=tab");
  assertEquals(shell.includes("aria-selected"), true, "页签缺 aria-selected");
  assertEquals(
    shell.includes("[['installed', '已装'], ['market', '市场'], ['maint', '维护']]"),
    true,
    "该定义 3 个页签（已装/市场/维护）",
  );
  assertEquals(countIn(shell, "data-ptab=") >= 1, true, "页签按钮要带 data-ptab");
  assertEquals(
    shell.includes("data-ptab=\"' + tabs[i][0]"),
    true,
    "循环里要把页签 id 写进 data-ptab",
  );
  assertEquals(
    shell.includes("actBtn('shield', '插件诊断', 'plugin.diagnose')"),
    true,
    "页头次按钮留「插件诊断」",
  );
  assertEquals(
    shell.includes("writeBtn('plus', '安装插件', 'plugin.install', {}, 'primary')"),
    true,
    "页头主按钮是「安装插件」",
  );
  assertEquals(countIn(shell, "'primary'"), 1, "页头主按钮必须唯一");
  assertEquals(shell.includes("navBtn("), false, "插件中心页头不许有指路按钮");
});

Deno.test("插件中心：renderPlugins 只渲染已装内容，页头外包", () => {
  const region = between(CLIENT_JS, "function renderPlugins(r) {", "function renderMaint(");
  assertEquals(region.length > 500, true, "renderPlugins 段没截到");
  assertEquals(region.includes("pluginShell('installed',"), true, "没包 pluginShell");
  assertEquals(region.includes("pageHead("), false, "页头归 pluginShell，不再自带");
  assertEquals(region.includes("moreMenu("), false, "低频动作已迁维护页签，不该再有 ⋯");
  assertEquals(region.includes("navBtn("), false, "已装页签不许有指路按钮");
});

Deno.test("插件中心：维护页签装离线安装/诊断/清理（危险带 danger）", () => {
  const region = between(CLIENT_JS, "function renderMaint(", "function fillSkippedBundles(");
  assertEquals(region.length > 300, true, "renderMaint 段没截到");
  assertEquals(region.includes("pluginShell('maint',"), true, "没包 pluginShell");
  assertEquals(
    region.includes("writeBtn('box', '离线安装（.tgz）', 'plugin.installOffline')"),
    true,
    "离线安装不在维护页签",
  );
  assertEquals(
    region.includes("actBtn('puzzle', '依赖冲突体检', 'plugin.deps')"),
    true,
    "依赖冲突体检不在维护页签",
  );
  assertEquals(
    region.includes("actBtn('activity', '测安装源速度', 'network.testSources')"),
    true,
    "测安装源速度不在维护页签",
  );
  assertEquals(
    region.includes("writeBtn('wrench', '清理残留', 'plugin.cleanResidue', {}, 'sm danger')"),
    true,
    "清理残留必须带 danger 红样式",
  );
  assertEquals(region.includes("'plugin.cleanBackups'"), true, "清理插件备份不在维护页签");
});

Deno.test("插件中心：市场页签 —— 批量更新住这里，页头外包", () => {
  const region = between(CLIENT_JS, "function renderMarket(res) {", "function loadJobs()");
  assertEquals(region.length > 500, true, "renderMarket 段没截到");
  assertEquals(countIn(region, "pluginShell('market',") >= 1, true, "市场页没包 pluginShell");
  assertEquals(
    region.includes("pageHead('插件市场'"),
    false,
    "页头归 pluginShell，错误分支与主分支都不该再单独造页头",
  );
  assertEquals(region.includes("plugin.batchUpdate"), true, "「全部更新」必须留在市场页签");
  assertEquals(region.includes("btn-market-refresh"), true, "「刷新目录」丢了");
  assertEquals(region.includes("navBtn("), false, "市场页签不许有指路按钮");
});

Deno.test("插件中心：点击页签只切渲染，不跳出路由", () => {
  const region = between(CLIENT_JS, "var nv = hit('[data-page]');", "var sbTask");
  assertEquals(region.length > 60, true, "全局 click 的 data-page 分支没截到");
  assertEquals(region.includes("hit('[data-ptab]')"), true, "缺页签点击分支");
  assertEquals(
    region.includes("state.plugins.tab = pt.getAttribute('data-ptab')"),
    true,
    "没把点到的页签写进 state",
  );
  assertEquals(region.includes("go('plugins', false)"), true, "切页签应重渲染插件中心（走缓存）");
});

Deno.test("插件中心：页签样式落在 styles.ts", async () => {
  const css = await Deno.readTextFile(new URL("./styles.ts", import.meta.url));
  assertEquals(css.includes(".ptabs"), true, "缺 .ptabs 容器样式");
  assertEquals(css.includes(".ptab.on"), true, "缺 .ptab.on 激活态样式");
  assertEquals(css.includes(".ptab:focus-visible"), true, "页签缺键盘焦点环");
});
