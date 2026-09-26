/**
 * 守卫：任务失败信息必须经过错误翻译器。【P0-2 · 2026-09-25】
 *
 * 为什么用文本断言：翻译器接在引擎的 #finish 里（所有动作的单点收口），
 * 这条测试防止有人把这个接线删掉 —— 删掉之后功能会静默失效，用户又开始看英文堆栈。
 */
import { assertEquals } from "@std/assert";

Deno.test("任务引擎：失败信息统一过翻译器", async () => {
  const src = await Deno.readTextFile(new URL("./engine.ts", import.meta.url));
  assertEquals(
    src.includes("appendExplanation(error)"),
    true,
    "#finish 里必须把 job.error 过一遍 appendExplanation，否则用户看到的是原始英文堆栈",
  );
  assertEquals(
    src.includes('from "../util/error-translate.ts"'),
    true,
    "翻译器要真的被引入（不是写了个模块没人用）",
  );
});
