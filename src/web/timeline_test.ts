/**
 * 守卫：回滚点页面必须是时间线形态，并且每条都带「影响预览」入口。【P0-4 · 2026-09-25】
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

/**
 * 【2026-09-26 真实事故】影响预览按钮带了 data-id，但 paramsFor 没给 backup.preview 取 id ——
 * 点下去报「未指定要预览哪个回滚点」。这条守卫把「带 id 的按钮」与「paramsFor 是否真的传 id」
 * 对起来，成类拦住，而不是只修一个动作。
 */
/**
 * 把注入脚本里的 paramsFor 抠出来**真的执行** —— 比字符串匹配硬：能验证它到底返回什么。
 */
function loadParamsFor(): (action: string, el: unknown) => Record<string, unknown> {
  const m = /function paramsFor\(action, el\) \{[\s\S]*?\n  \}/.exec(CLIENT_JS);
  assertEquals(m !== null, true, "找不到 paramsFor 函数");
  return new Function("action", "el", m![0] + "\nreturn paramsFor(action, el);") as (
    action: string,
    el: unknown,
  ) => Record<string, unknown>;
}

Deno.test("回滚点页：带 data-id 的按钮，动作必须真的拿到 id（执行验证）", () => {
  const paramsFor = loadParamsFor();
  const el = { getAttribute: (k: string) => (k === "data-id" ? "rp-test" : null) };
  // 事故回归：修复前这里返回 {} —— 所以点「影响预览」报「未指定要预览哪个回滚点」
  assertEquals(paramsFor("backup.preview", el), { id: "rp-test" });
  // 成类：所有带 data-id 的按钮动作都必须把 id 传出去，而不是只修一个
  const used = new Set<string>();
  for (const m of CLIENT_JS.matchAll(/data-act="([\w.]+)"\s+data-id=/g)) used.add(m[1]!);
  for (const m of CLIENT_JS.matchAll(/writeBtn\(\s*'[\w]+',\s*'[^']*',\s*'([\w.]+)',\s*\{\s*id:/g)) used.add(m[1]!);
  assertEquals(used.size > 0, true, "一个带 id 的按钮都没扫到，说明匹配规则失效了");
  const bad = [...used].filter((a) => (paramsFor(a, el) as { id?: string }).id !== "rp-test");
  assertEquals(bad, [], `这些动作的按钮带了 data-id，但 paramsFor 没把 id 传出去：${bad.join("、")}`);
  // 不需要参数的动作保持空对象，别乱塞
  assertEquals(paramsFor("plugin.deps", el), {});
});

Deno.test("回滚点页：时间线 + 影响预览入口", () => {
  for (const needle of ["timeline", "tl-item", "tl-dot", "tl-actions", "fmtAgo"]) {
    assertEquals(CLIENT_JS.includes(needle), true, `时间线缺了 ${needle}`);
  }
  assertEquals(
    CLIENT_JS.includes("data-act=\"backup.preview\""),
    true,
    "每个回滚点都要有「影响预览」按钮（否则用户点还原前不知道会改什么）",
  );
  assertEquals(
    CLIENT_JS.includes("if (action === 'backup.preview')"),
    true,
    "预览结果没有渲染分支",
  );
  assertEquals(
    CLIENT_JS.includes("回滚影响预览"),
    true,
    "预览弹窗的标题丢了",
  );
});
