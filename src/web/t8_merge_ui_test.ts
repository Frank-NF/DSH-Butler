/**
 * 守卫：阶段二 T8 —— 合并页与侧栏四组（docs/UI-REDESIGN-PLAN-2026-09-30.md 2.1-2.3 / 4.2 / 4.3）。
 *
 * 三个合并页：DSH 本体（状态|更新|服务）、备份与恢复（回滚点|数据搬家|日志）、体检（报告|运维统计）；
 * 侧栏四组：开始 / 使用 / 保障 / 更多；多 profile 收进设置（一个带 card-title 的顶层卡）。
 * 断言全部打在 CLIENT_JS 源码的字面量上 —— 与 layer / plugins_center 同一套 string 守卫。
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

function between(h: string, from: string, to: string): string {
  const a = h.indexOf(from);
  if (a < 0) return "";
  const b = h.indexOf(to, a + from.length);
  return b < 0 ? "" : h.slice(a, b);
}

function countIn(h: string, needle: string): number {
  let n = 0, i = 0;
  while ((i = h.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

Deno.test("T8 state：三个合并页各有页签状态", () => {
  assertEquals(CLIENT_JS.includes("core: { tab: 'status' }"), true, "缺 core 页签状态");
  assertEquals(CLIENT_JS.includes("backups: { tab: 'rollback' }"), true, "缺 backups 页签状态");
  assertEquals(CLIENT_JS.includes("report: { tab: 'report' }"), true, "缺 report 页签状态");
});

Deno.test("T8 tabShell：通用页签壳（页头 + ptabs + 内容）", () => {
  const shell = between(CLIENT_JS, "function tabShell(", "function pluginShell(");
  assertEquals(shell.length > 300, true, "tabShell 段没截到（锚点要检查）");
  assertEquals(shell.includes("pageHead(title, desc, tools)"), true, "壳没走 pageHead");
  assertEquals(shell.includes('role="tablist"'), true, "缺 tablist 语义");
  assertEquals(shell.includes("data-ptab="), true, "缺 data-ptab 输出");
  assertEquals(shell.includes("aria-selected"), true, "缺 aria-selected");
  assertEquals(shell.includes("return html + '</div>' + inner;"), true, "缺壳收尾");
});

Deno.test("T8 TABS 注册表：四页合并 + 覆盖项", () => {
  const reg = between(CLIENT_JS, "var TABS = {", "function routeDef(");
  assertEquals(reg.length > 200, true, "TABS 注册表没截到");
  for (const k of ["stateKey: 'plugins'", "stateKey: 'core'", "stateKey: 'backups'", "stateKey: 'report'"]) {
    assertEquals(reg.includes(k), true, "TABS 缺 " + k);
  }
  assertEquals(
    reg.includes("update: { render: renderCoreUpdate, cacheKey: 'core' }"),
    true, "core.update 覆盖项不对（与状态页共缓存 'core'）",
  );
  assertEquals(
    reg.includes("service: { action: 'runtime.status', render: renderCoreService, title: '服务状态', cacheKey: 'runtime' }"),
    true, "core.service 覆盖项不对",
  );
  assertEquals(
    reg.includes("data: { action: 'data.backups', render: renderData, title: '数据搬家', cacheKey: 'data' }"),
    true, "backups.data 覆盖项不对",
  );
  assertEquals(
    reg.includes("logs: { action: 'runtime.logs', render: renderLogs, title: '日志收集', cacheKey: 'logs' }"),
    true, "backups.logs 覆盖项不对",
  );
  assertEquals(
    reg.includes("stats: { action: 'diag.stats', render: renderStats, title: '运维统计', cacheKey: 'stats' }"),
    true, "report.stats 覆盖项不对",
  );
});

Deno.test("T8 routeDef：按 TABS 取覆盖与默认页签", () => {
  const def = between(CLIENT_JS, "function routeDef(", "function go(page, force) {");
  assertEquals(def.includes("var cfg = TABS[page];"), true, "routeDef 没走 TABS");
  assertEquals(
    def.includes("var over = cfg.tabs[state[cfg.stateKey].tab] || cfg.tabs[cfg.def];"),
    true, "routeDef 没按 state 页签取覆盖/默认",
  );
  assertEquals(CLIENT_JS.includes("def.cacheKey || page"), true, "缓存键兜底丢了（在 go() 里，plugins_center 同断言）");
});

Deno.test("T8 go：旧页书签一律重定向进合并页", () => {
  const go = between(CLIENT_JS, "function go(page, force) {", "function showError(");
  assertEquals(go.length > 500, true, "go() 段没截到");
  assertEquals(go.includes("state.plugins.tab = 'market'"), true, "market 重定向丢了（T7）");
  assertEquals(go.includes("else if (page === 'runtime') { page = 'core'; state.core.tab = 'service'; }"), true, "runtime 没并进本体·服务");
  assertEquals(go.includes("else if (page === 'data') { page = 'backups'; state.backups.tab = 'data'; }"), true, "data 没并进备份·数据搬家");
  assertEquals(go.includes("else if (page === 'logs') { page = 'backups'; state.backups.tab = 'logs'; }"), true, "logs 没并进备份·日志");
  assertEquals(go.includes("else if (page === 'stats') { page = 'report'; state.report.tab = 'stats'; }"), true, "stats 没并进体检·运维统计");
  assertEquals(
    go.includes("else if (page === 'profiles') { page = 'settings'; state.extra.settingsSec = 999; }"),
    true, "profiles 没并进设置（深链到最后一组）",
  );
  assertEquals(
    go.includes("else if (TABS[page] && state.page !== page) { state[TABS[page].stateKey].tab = TABS[page].def; }"),
    true, "进合并页缺默认页签重置（泛化版）",
  );
});

Deno.test("T8 点击链：页签点击泛化到任意合并页", () => {
  const click = between(CLIENT_JS, "var nv = hit('[data-page]');", "var sbTask");
  assertEquals(click.includes("var pt = hit('[data-ptab]');"), true, "缺页签命中");
  assertEquals(click.includes("var tabCfg = TABS[state.page];"), true, "页签点击没走 TABS");
  assertEquals(
    click.includes("state[tabCfg.stateKey].tab = pt.getAttribute('data-ptab') || tabCfg.def;"),
    true, "没把点到的页签写进对应 state 字段",
  );
  assertEquals(click.includes("go(state.page, false);"), true, "切页签没重渲染当前合并页");
});

Deno.test("T8 DSH 本体三页签：状态/更新拆分 + 服务并入", () => {
  const core = between(CLIENT_JS, "function renderCore(r) {", "function fillChangelog()");
  assertEquals(core.length > 400, true, "renderCore 段没截到");
  assertEquals(core.includes("function coreTools(r) {"), true, "缺共用页头工具 coreTools");
  assertEquals(core.includes("function renderCoreUpdate(r) {"), true, "缺更新页签渲染器");
  assertEquals(core.includes("CORE_TABS, 'status', inner, coreTools(r)"), true, "状态页签没走 tabShell");
  assertEquals(core.includes("CORE_TABS, 'update', inner, coreTools(r)"), true, "更新页签没走 tabShell");
  assertEquals(core.includes("btn-refresh-changelog"), true, "更新日志卡丢了");
  assertEquals(countIn(core, "pageHead('DSH 本体'"), 0, "renderCore 区不该再自带 pageHead");

  const rt = between(CLIENT_JS, "function renderRuntime(r) {", "// ── 页面：插件");
  assertEquals(rt.includes("function renderCoreService(r) {"), true, "缺服务页签渲染器");
  assertEquals(rt.includes("tabShell('DSH 本体', '服务进程、HTTP 健康检查、僵尸锁与 profile 残留物。', CORE_TABS, 'service', renderRuntime(r), '')"), true, "服务页签没包 renderRuntime");
  assertEquals(rt.includes("pageHead('运行状态'"), false, "renderRuntime 不该再自带页头");
  assertEquals(rt.includes("data-enter-dsh"), true, "进入 DSH 动作条要留在服务内容区");
});

Deno.test("T8 备份与恢复三页签：回滚/搬家/日志共用页头", () => {
  const bk = between(CLIENT_JS, "function renderBackups(r) {", "function renderProfiles(r) {");
  assertEquals(bk.includes("tabShell('备份与恢复', '任何写操作动手前都会自动留一个回滚点；这里也能自己建、自己还原。', BACKUP_TABS, 'rollback'"), true, "回滚点页签没走 tabShell");
  assertEquals(bk.includes("writeBtn('plus', '创建回滚点', 'backup.create')"), true, "创建回滚点主按钮丢了");
  assertEquals(bk.includes("pageHead('回滚点'"), false, "renderBackups 不该再自带页头");

  const data = between(CLIENT_JS, "function renderData(r) {", "// ── 页面：一键部署");
  assertEquals(data.includes("tabShell('备份与恢复'"), true, "数据搬家没并进备份与恢复");
  assertEquals(data.includes("BACKUP_TABS, 'data'"), true, "data 页签参数不对");
  assertEquals(data.includes("pageHead('数据搬家'"), false, "renderData 不该再自带页头");
  assertEquals(data.includes(`'<div class="btn-row">' + tools + '</div>'`), true, "搬家 6 钮应降级到内容区顶部");

  const lg = between(CLIENT_JS, "function renderLogs(r) {", "function renderReport(r) {");
  assertEquals(lg.includes("tabShell('备份与恢复', '自动从最近的启动日志里挑出真正的错误行。', BACKUP_TABS, 'logs'"), true, "日志没并进备份与恢复");
  assertEquals(lg.includes("pageHead('日志'"), false, "renderLogs 不该再自带页头");
  assertEquals(lg.includes('id="btn-export-logs"'), true, "导出日志按钮丢了");
});

Deno.test("T8 体检两页签：报告/运维统计", () => {
  const rp = between(CLIENT_JS, "function renderReport(r) {", "function copyReport()");
  assertEquals(rp.includes("tabShell('体检', '生成于 '"), true, "主分支没走 tabShell('体检'");
  assertEquals(rp.includes("REPORT_TABS, 'report', html, writeBtn('box', '导出诊断包（脱敏）', 'data.diagnose')"), true, "导出诊断包应挂在页签壳页头");
  assertEquals(rp.includes("'可直接复制分享（已自动脱敏用户名与路径）。', REPORT_TABS, 'report'"), true, "string 分支没走页签壳");
  assertEquals(rp.includes("pageHead('体检报告'"), false, "renderReport 不该再自带页头");

  const st = between(CLIENT_JS, "function renderStats(r) {", "function loadHelp()");
  assertEquals(st.includes("tabShell('体检', "), true, "运维统计没并进体检");
  assertEquals(st.includes("REPORT_TABS, 'stats', html, tools"), true, "stats 页签参数不对");
  assertEquals(st.includes("pageHead('统计'"), false, "renderStats 不该再自带页头");
});

Deno.test("T8 PAGES：侧栏四组 + 改名 + 旧页隐身", () => {
  assertEquals(countIn(CLIENT_JS, "group: '开始'"), 2, "开始组应 = 总览+一键部署");
  assertEquals(countIn(CLIENT_JS, "group: '使用'"), 3, "使用组应 = 插件中心+DSH本体+AI助手");
  assertEquals(countIn(CLIENT_JS, "group: '保障'"), 2, "保障组应 = 体检+备份与恢复");
  assertEquals(countIn(CLIENT_JS, "group: '更多'"), 3, "更多组应 = 帮助+环境与配置+任务");
  const report = between(CLIENT_JS, "{ id: 'report',", "id: 'backups'");
  assertEquals(report.includes("label: '体检'"), true, "体检报告没改名「体检」");
  const backups = between(CLIENT_JS, "{ id: 'backups',", "id: 'data'");
  assertEquals(backups.includes("label: '备份与恢复'"), true, "回滚点没改名「备份与恢复」");
  const runtime = between(CLIENT_JS, "{ id: 'runtime',", "id: 'logs'");
  assertEquals(runtime.includes("hiddenFromNav: true"), true, "运行状态应隐身");
  const logs = between(CLIENT_JS, "{ id: 'logs',", "id: 'stats'");
  assertEquals(logs.includes("hiddenFromNav: true"), true, "日志应隐身");
  const stats = between(CLIENT_JS, "{ id: 'stats',", "id: 'data'");
  assertEquals(stats.includes("hiddenFromNav: true"), true, "统计应隐身");
  const data = between(CLIENT_JS, "{ id: 'data',", "id: 'profiles'");
  assertEquals(data.includes("hiddenFromNav: true"), true, "数据搬家应隐身");
  const profiles = between(CLIENT_JS, "{ id: 'profiles',", "];");
  assertEquals(profiles.includes("hiddenFromNav: true"), true, "多profile应隐身");
  assertEquals(CLIENT_JS.includes("label: '数据搬家'"), true, "data 页 label 要保留（data_ui_test 同断言）");
});

Deno.test("T8 设置收编多 profile：取数/成卡/深链 clamp", () => {
  const ls = between(CLIENT_JS, "function loadSettings() {", "function renderSettings(");
  assertEquals(ls.includes("api('/api/profiles')"), true, "设置没并取 profile 清单");
  assertEquals(ls.includes("state.extra.settingsProfiles"), true, "缺 settingsProfiles 存储");
  const rs = between(CLIENT_JS, "function renderSettings(", "function saveSettings()");
  assertEquals(rs.includes("multiProfileCard("), true, "设置页没插多 profile 卡");
  const mpc = between(CLIENT_JS, "function multiProfileCard(", "function layoutSettingsSections(");
  assertEquals(mpc.length > 300, true, "multiProfileCard 段没截到");
  assertEquals(mpc.includes("card-title\">多 profile"), true, "卡没有 card-title（左导航靠它成组）");
  assertEquals(mpc.includes("emptyBox"), true, "读不到时要有空态");
  const lay = between(CLIENT_JS, "function layoutSettingsSections(", "function afterRender(");
  assertEquals(lay.includes("if (idx >= cards.length) idx = cards.length - 1;"), true, "缺 settingsSec clamp（深链 999 会越界）");
  assertEquals(lay.includes("state.extra.settingsSec = idx;"), true, "clamp 后要回写，否则首组卡被全体隐藏");
  assertEquals(CLIENT_JS.includes("delete state.cache.settings;"), true, "切换 profile 后设置缓存要失效");
  assertEquals(CLIENT_JS.includes("title === '多 profile'"), true, "settingsSummaryOf 缺多 profile 摘要分支");
});

Deno.test("T8 服务端：GET /api/profiles 直读 profile.list 动作", async () => {
  const srv = await Deno.readTextFile(new URL("../api/server.ts", import.meta.url));
  assertEquals(srv.includes('path === "/api/profiles"'), true, "缺 GET /api/profiles 路由");
  assertEquals(srv.includes('from "../domains/profile/manage.ts"'), true, "server 没导入 profile 模块");
  assertEquals(srv.includes("profileListAction.run("), true, "路由没直调动作");
});
