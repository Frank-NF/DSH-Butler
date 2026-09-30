/**
 * 守卫：阶段一「止血」的主/次/危险分层（docs/UI-REDESIGN-PLAN-2026-09-30.md 第 196 行）。
 *
 *  - 插件页 / 本体页页级按钮：主按钮 1 个、次按钮 1 个，低频与危险动作收进「⋯ 更多」下拉；
 *  - 危险动作在菜单里带 danger 样式（红），点菜单外面自动收起；
 *  - 插件页删掉「去市场批量更新」指路按钮 —— 批量更新就住在插件市场页，侧栏直达。
 * 行内动作本阶段不收 ⋯：.rows 有 overflow:hidden 会裁剪下拉，且行级 ⋯ 属阶段二
 * 插件中心（方案 4.1 图样）的设计，等页签合并时一起做。
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

Deno.test("插件页：页头 1 主 1 次，低频与危险动作收进 ⋯，指路按钮删掉", () => {
  const flat = between(CLIENT_JS, "function renderPlugins(r) {", "moreMenu(");
  assertEquals(countIn(flat, "actBtn("), 1, "页头平铺的次按钮只该剩「插件诊断」一个");
  assertEquals(countIn(flat, "writeBtn("), 1, "页头平铺的主按钮只该剩「安装插件」一个");
  assertEquals(flat.includes("navBtn("), false, "指路按钮要删掉，别再让用户绕路");

  const head = between(CLIENT_JS, "function renderPlugins(r) {", "var html = pageHead('插件'");
  const menu = head.slice(head.indexOf("moreMenu("));
  assertEquals(menu.includes("依赖冲突体检"), true, "依赖冲突体检没进菜单");
  assertEquals(menu.includes("测安装源速度"), true, "测安装源速度没进菜单");
  assertEquals(menu.includes("离线安装（.tgz）"), true, "离线安装没进菜单");
  assertEquals(
    menu.includes("writeBtn('wrench', '清理残留', 'plugin.cleanResidue', {}, 'sm danger')"),
    true,
    "清理残留是危险动作，进菜单还要带 danger 红样式",
  );
  assertEquals(countIn(head, "'primary'"), 1, "插件页主按钮必须唯一");
  assertEquals(
    head.includes("writeBtn('plus', '安装插件', 'plugin.install', {}, 'primary')"),
    true,
    "「安装插件」该是唯一主按钮",
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
