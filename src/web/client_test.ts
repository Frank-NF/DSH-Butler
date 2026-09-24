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
/**
 * 第二次真实事故（就在上面那条之后几小时）：界面里调用了 shellCard() 这个函数，
 * 但定义它的那次编辑没成功落盘 —— 语法完全合法，parse 测试全绿，可浏览器里
 * 整页只剩「shellCard is not defined」。
 *
 * 所以补一条"调用即已定义"的静态检查：把脚本里所有「名字(」挑出来，
 * 逐个核对它是不是在本文件里定义过（函数声明 / var 赋值 / 形参）。
 * 浏览器内置对象单独列白名单；出现既没定义、也不在白名单里的调用就报错 ——
 * 这正是"少定义了一个函数"这一类事故的通用形态。
 */
Deno.test("CLIENT_JS 里不允许调用未定义的函数（防「少写一个函数，整页白」）", () => {
  const src = CLIENT_JS;

  const defined = new Set<string>();
  // 函数声明
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]!);
  // 变量声明（含函数表达式）
  for (const m of src.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]!);
  // 形参（ES5 风格，没有默认值，逗号切分即可）
  for (const m of src.matchAll(/function[^(]*\(([^)]*)\)/g)) {
    for (const raw of m[1]!.split(",")) {
      const name = raw.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
    }
  }

  // 浏览器/JS 内置（用到才加，不预先堆一大堆）
  const globals = new Set([
    "fetch",
    "String",
    "Number",
    "Boolean",
    "Date",
    "JSON",
    "Object",
    "Array",
    "Promise",
    "Math",
    "Error",
    "RegExp",
    "parseInt",
    "parseFloat",
    "isNaN",
    "encodeURIComponent",
    "decodeURIComponent",
    "setTimeout",
    "clearTimeout",
    "EventSource",
    "URLSearchParams",
    "Function",
    "Symbol",
    "atob",
    "btoa",
    "requestAnimationFrame",
    "getComputedStyle",
    "console",
  ]);
  // 属性访问（obj.fn()）与 IIFE 之类不算
  const called = new Set<string>();
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    called.add(m[2]!);
  }

  const missing: string[] = [];
  for (const name of called) {
    if (defined.has(name) || globals.has(name)) continue;
    // 关键字/条件语句这类不是函数调用。
    // var/let/const 也要排除：内联样式字符串里会写 CSS 的 var(--token)，长得像函数调用。
    if (
      [
        "if",
        "for",
        "while",
        "switch",
        "catch",
        "return",
        "typeof",
        "new",
        "function",
        "var",
        "let",
        "const",
      ].includes(name)
    ) continue;
    missing.push(name);
  }
  assertEquals(
    missing.sort(),
    [],
    `CLIENT_JS 里调用了未定义的名字：${missing.join("、")} —— 浏览器里会直接报 xxx is not defined`,
  );
});
