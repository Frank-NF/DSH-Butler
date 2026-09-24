/**
 * 客户端脚本守卫。
 *
 * 背景（真实事故）：CLIENT_JS 是塞在反引号模板里的字符串，TS 不会当代码检查它。
 * 2026-09-24 曾因一处 `join('\n')`（模板里 \n 被解成真换行）导致注入浏览器的
 * 整段 JS 语法错误 —— 页面永远停在「正在加载…」，而服务端、鉴权、接口全部正常，
 * 排查时极易误判成 401 或网络问题。
 *
 * 所以：每次改 client.ts，这条测试就是「页面到底能不能跑」的最底线。
 */
import { assertEquals } from "@std/assert";

import { CLIENT_JS } from "./client.ts";

Deno.test("CLIENT_JS 是合法 JavaScript（能被解析执行）", () => {
  // new Function 只编译不执行 —— 语法错在这里直接抛，IIFE 不会被跑起来。
  let err: unknown = null;
  try {
    new Function(CLIENT_JS);
  } catch (e) {
    err = e;
  }
  assertEquals(
    err,
    null,
    `CLIENT_JS 语法错误：${err instanceof Error ? err.message : String(err)}`,
  );
});
