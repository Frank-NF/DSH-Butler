/**
 * 守卫：阶段一「止血」的主/次/危险分层（docs/UI-REDESIGN-PLAN-2026-09-30.md 第 196 行）。
 *
 *  - 本体页页级按钮：主按钮 1 个、次按钮 1 个，低频与危险动作收进「⋯ 更多」下拉；
 *  - 危险动作在菜单里带 danger 样式（红），点菜单外面自动收起；
 *  - 阶段二 T7 后插件页头改由「插件中心」pluginShell 统一提供（见 plugins_center_ui_test.ts）：
 *    页头仍守 1 主 1 次、零指路，低频/危险动作迁到维护页签。
 * 行内动作仍不收 ⋯：.rows 有 overflow:hidden 会裁剪下拉（阶段一已裁决，T7 复核行内动作 ≤2）。
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

Deno.test("分层基础：有「⋯ 更多」下拉菜单，点外面自动收起", () => {
  assertEquals(CLIENT_JS.includes("function moreMenu("), true, "没有 ⋯ 菜单 helper");
  assertEquals(CLIENT_JS.includes('class="more"'), true, "菜单没有稳定的 class 钩子");
  assertEquals(CLIENT_JS.includes("details.more[open]"), true, "菜单点外面不会自动收起");
});

Deno.test("插件中心页头：1 主 1 次，低频/危险迁维护页签，指路按钮删掉", () => {
  const shell = between(CLIENT_JS, "function pluginShell(", "function setMain(");
  assertEquals(shell.length > 300, true, "pluginShell 段没截到（锚点要检查）");
  assertEquals(countIn(shell, "actBtn("), 1, "页头平铺的次按钮只该剩「插件诊断」一个");
  assertEquals(countIn(shell, "writeBtn("), 1, "页头平铺的主按钮只该剩「安装插件」一个");
  assertEquals(shell.includes("navBtn("), false, "指路按钮要删掉，别再让用户绕路");
  assertEquals(countIn(shell, "'primary'"), 1, "插件中心页头主按钮必须唯一");
  assertEquals(
    shell.includes("writeBtn('plus', '安装插件', 'plugin.install', {}, 'primary')"),
    true,
    "「安装插件」该是唯一主按钮",
  );

  const maint = between(CLIENT_JS, "function renderMaint(", "function fillSkippedBundles()");
  assertEquals(maint.length > 300, true, "renderMaint 段没截到（锚点要检查）");
  assertEquals(maint.includes("依赖冲突体检"), true, "依赖冲突体检没进维护页签");
  assertEquals(maint.includes("测安装源速度"), true, "测安装源速度没进维护页签");
  assertEquals(maint.includes("离线安装（.tgz）"), true, "离线安装没进维护页签");
  assertEquals(
    maint.includes("writeBtn('wrench', '清理残留', 'plugin.cleanResidue', {}, 'sm danger')"),
    true,
    "清理残留是危险动作，进维护页签还要带 danger 红样式",
  );
});

Deno.test("指路按钮清零：方案 12 行清单三条落地，页内直达", () => {
  // ① 外壳状态卡「去一键部署」→ 原地开部署表单弹窗（btn-bootstrap-form），不跳页
  const shell = between(CLIENT_JS, "function shellCard()", "function renderFindings(");
  assertEquals(shell.length > 200, true, "shellCard 段没截到（锚点要检查）");
  assertEquals(CLIENT_JS.includes("navBtn('deploy'"), false, "外壳卡还有「去一键部署」指路");
  const dep = between(shell, "这台机器还没装 DSH", "s.next === 'enter'");
  assertEquals(dep.includes('id="btn-bootstrap-form"'), true, "外壳卡该原地开部署表单弹窗");
  assertEquals(dep.includes('class="btn primary"'), true, "外壳卡部署按钮该是主按钮");

  // ② 总览可更新卡「先看本体状态」→ 两个版本号卡内已写全，按钮删掉
  assertEquals(CLIENT_JS.includes("先看本体状态"), false, "总览「先看本体状态」指路还在");

  // ③ 部署页已装卡「去 DSH 本体页」→ 更新动作页内直达
  const inst = between(CLIENT_JS, "这台机器已经装过 DSH", "} else if (plan.blockers");
  assertEquals(inst.length > 100, true, "已装卡段没截到（锚点要检查）");
  assertEquals(
    CLIENT_JS.includes("navBtn('box', '去 DSH 本体页'"),
    false,
    "部署页还有「去 DSH 本体页」指路",
  );
  assertEquals(
    inst.includes("writeBtn('upload', '更新本体', 'core.update', {}, 'primary')"),
    true,
    "已装卡该给页内直达的「更新本体」主按钮",
  );

  // ④ 快捷入口是命名跳板卡（方案 12 行清单外），不许顺手删
  assertEquals(
    CLIENT_JS.includes("navBtn('sliders', '环境与配置', 'env')"),
    true,
    "快捷入口被误删了 —— 它不是指路补丁，是设计好的跳板卡",
  );
});

Deno.test("本体页六卡：卡内不摆指路按钮，双名单详情页内直达", () => {
  const core = between(CLIENT_JS, "function renderCore(r) {", "function fillChangelog()");
  assertEquals(core.length > 400, true, "本体页渲染段没截到（锚点要检查）");
  assertEquals(
    core.includes("navBtn("),
    false,
    "本体页卡里还有指路按钮：双名单卡的「去插件页」要删，详情本卡已列全",
  );
  assertEquals(core.includes("去插件页"), false, "「去插件页」文案还在页面上");
  assertEquals(
    core.includes("btn-refresh-changelog"),
    true,
    "更新日志卡的「刷新」要留着 —— 这是页内次级动作，不是指路",
  );
});

Deno.test("本体页：更新是唯一主按钮，回滚（危险）收进 ⋯，校验本体做次按钮", () => {
  const region = between(CLIENT_JS, "function renderCore(r) {", "var html = pageHead('DSH 本体'");
  assertEquals(
    region.includes("writeBtn('upload', '更新本体', 'core.update', {}, 'primary')"),
    true,
    "「更新本体」该是主按钮",
  );
  assertEquals(
    region.includes(
      "writeBtn('check', '完成更新（重建界面）', 'core.finishUpdate', {}, 'primary')",
    ),
    true,
    "「完成更新」那一支也该是主按钮",
  );
  assertEquals(
    region.includes("actBtn('shield', '校验本体', 'core.verify')"),
    true,
    "次按钮留「校验本体」",
  );
  const menu = region.slice(region.indexOf("moreMenu("));
  assertEquals(
    menu.includes("writeBtn('history', '回滚本体', 'core.rollback', {}, 'sm danger')"),
    true,
    "回滚是危险动作，要收进 ⋯ 且带 danger 红样式",
  );
  assertEquals(menu.includes("'primary'"), false, "⋯ 菜单里不该有主按钮");
  assertEquals(
    region.includes("writeBtn('history', '回滚本体', 'core.rollback')"),
    false,
    "回滚还平铺在页头上",
  );
});
