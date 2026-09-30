/**
 * 守卫：用户 2026-09-29 一次提的七件事（除后端模块测试外的界面部分）。
 *
 * 这些都是"用户看得见、但很容易在后续改动里悄悄消失"的东西：
 *  1 手动指定 DSH 源码目录（以前文案说有、界面里没有）
 *  2 「装了却没加载」清单 + 允许运行（DSH 跳过的不兼容插件）
 *  3 批量更新按钮挪进插件市场
 *  5 本体更新只留一个智能按钮（原来两个按钮说不清顺序）
 *  6 更新日志：中文概括 + 弹窗看全部 + AI 中文总结
 *  7 AI 助手页：API 设置收进弹窗，不再摊在对话上
 * 4（本体更新提示不消失）是纯后端逻辑，见 net/core-update_test.ts 与 state/scheduler_test.ts。
 */

import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

function between(from: string, to: string): string {
  const a = CLIENT_JS.indexOf(from);
  const b = CLIENT_JS.indexOf(to);
  if (a < 0 || b < 0 || b <= a) return "";
  return CLIENT_JS.slice(a, b);
}

Deno.test("任务1：设置页能手动指定 DSH 源码目录，保存时会带上", () => {
  assertEquals(CLIENT_JS.includes('id="set-source-root"'), true, "设置页没有源码目录输入框");
  assertEquals(
    CLIENT_JS.includes("dshSourceRootOverride: $('set-source-root').value"),
    true,
    "保存设置时没把手工目录送上去 —— 那就又变成死设置了",
  );
  assertEquals(
    CLIENT_JS.includes("var sro = res.sourceRootOverride"),
    true,
    "没读当前的手工指定状态",
  );
  assertEquals(CLIENT_JS.includes("var effRoot = res.sourceRoot"), true, "没显示当前实际用的目录");
  assertEquals(
    CLIENT_JS.includes("SRC_LABEL[effRoot.source]"),
    true,
    "没说明目录是怎么找到的（来源）",
  );
});

Deno.test("任务2：插件页有「装了却没加载」清单，并能开/收通行证", () => {
  assertEquals(CLIENT_JS.includes("装了却没加载"), true, "没有这块卡片");
  assertEquals(CLIENT_JS.includes("function fillSkippedBundles()"), true, "没有扫描填充函数");
  assertEquals(
    CLIENT_JS.includes("if (page === 'plugins') fillSkippedBundles();"),
    true,
    "插件页渲染后没去扫描",
  );
  assertEquals(CLIENT_JS.includes("'/api/plugins/skipped'"), true, "没有取跳过清单的请求");
  assertEquals(CLIENT_JS.includes("'/api/plugins/exempt'"), true, "没有写豁免的请求");
  assertEquals(
    CLIENT_JS.includes("body: { key: key, runtime: runtime, remove: !on }"),
    true,
    "豁免请求要送 包名@版本 + 运行时版本 + 是写还是撤",
  );
  assertEquals(CLIENT_JS.includes("data-exempt-key"), true, "按钮没带包名");
  assertEquals(CLIENT_JS.includes('data-write="runtime.restart"'), true, "开完通行证没给重启入口");
});

Deno.test("任务3：批量更新按钮在插件市场，插件页不再摆指路", () => {
  assertEquals(CLIENT_JS.includes("'plugin.batchUpdate'"), true, "批量更新动作没了");
  assertEquals(
    CLIENT_JS.includes("navBtn('store', '去市场批量更新', 'market')"),
    false,
    "插件页不该再指路 —— 批量更新就住在市场页，侧栏直达",
  );
  const pluginsHead = between("function renderPlugins(r) {", "function fillSkippedBundles()");
  assertEquals(
    pluginsHead.includes("writeBtn('upload', '批量更新（含验证）'"),
    false,
    "插件页还留着批量更新按钮 —— 那就白挪了",
  );
  const market = between("function renderMarket(res) {", "function loadJobs");
  assertEquals(market.includes("'plugin.batchUpdate'"), true, "市场页没有批量更新按钮");
});

Deno.test("任务5：本体更新只有一个智能按钮（有新版拉取+重建，只差重建就直接重建）", () => {
  assertEquals(
    CLIENT_JS.includes("var smartUpdate = r.needsFinishUpdate"),
    true,
    "本体页没有智能按钮",
  );
  assertEquals(
    CLIENT_JS.includes(
      "writeBtn('check', '完成更新（重建界面）', 'core.finishUpdate', {}, 'primary')",
    ),
    true,
    "缺少「只差重建」那一支",
  );
  assertEquals(
    CLIENT_JS.includes("writeBtn('upload', '更新本体', 'core.update', {}, 'primary')"),
    true,
    "缺少「更新本体」那一支",
  );
  assertEquals(
    CLIENT_JS.includes("'<button class=\"btn primary\" data-write=\"' + upAction + '\">'"),
    true,
    "总览页那张卡也该是一个智能按钮",
  );
  assertEquals(
    CLIENT_JS.includes("ov.dsh.updateAvailable || ov.dsh.needsFinishUpdate"),
    true,
    "只差重建时总览页什么都没显示",
  );
});

Deno.test("任务6：更新日志是中文概括 + 弹窗看全部 + AI 中文总结", () => {
  assertEquals(
    CLIENT_JS.includes("var CHANGELOG_PREVIEW = 6;"),
    true,
    "卡片里还是一大串（没有预览条数限制）",
  );
  assertEquals(CLIENT_JS.includes("function changelogChips(counts)"), true, "没有中文分类计数");
  assertEquals(CLIENT_JS.includes("function openChangelogModal(opt)"), true, "没有看全部的弹窗");
  assertEquals(
    CLIENT_JS.includes("function aiSummarizeChangelog(btn, o)"),
    true,
    "没有 AI 中文总结",
  );
  assertEquals(CLIENT_JS.includes("'/api/ai/chat'"), true, "中文总结没走 AI 接口");
  assertEquals(
    CLIENT_JS.includes("看全部 ' + up.entries.length + ' 条"),
    true,
    "没有「看全部」按钮",
  );
  assertEquals(
    CLIENT_JS.includes("先去「AI 助手」页把 API 地址、模型、密钥配好"),
    true,
    "没配 AI 时要说清去哪儿配，不能装作能用",
  );
});

Deno.test("任务7：AI 助手页的 API 设置收进弹窗", () => {
  assertEquals(CLIENT_JS.includes("function aiSettingsCard()"), true, "没有独立的设置表单");
  assertEquals(CLIENT_JS.includes("function openAiSettings()"), true, "没有打开设置的弹窗");
  assertEquals(CLIENT_JS.includes('id="btn-ai-settings"'), true, "页面右上角没有设置入口");
  assertEquals(
    CLIENT_JS.includes('id="btn-ai-settings-2"'),
    false,
    "卡内与右上角重复的设置按钮要合并，只留右上角",
  );
  const renderAi = between("function renderAi(cfg) {", "function aiBubble(");
  assertEquals(renderAi.includes('id="ai-base"'), false, "表单还摊在对话页上 —— 这次改的就是它");
  assertEquals(renderAi.includes('id="ai-box"'), true, "对话区要留在页面上");
  assertEquals(
    CLIENT_JS.includes("if (inModal) closeModal();"),
    true,
    "弹窗里保存后没关窗，页面会被盖住",
  );
});
