/**
 * 守卫：注入脚本里不许出现「调用了但没定义」的函数。
 *
 * 【为什么单独补这条 · 2026-09-25 真实事故】
 * P0-4 给回滚点页加时间线时，模板里调用了 fmtAgo()，但它的定义在同一次编辑批次里
 * 因为另一处编辑报错被整体回滚了（编辑器报告成功，文件里却没有）——结果回滚点页一打开就抛
 * ReferenceError，用户看到的是「回滚点报错」。既有的守卫只检查「语法能解析」，
 * 完全抓不到「名字没定义」这一类，所以补上这条通用检查。
 *
 * 判据：把所有 `名字(` 的调用收集起来，减去函数声明、变量声明、形参、浏览器内建与关键字，
 * 剩下的必须是 0 —— 任何一个都会在运行时炸。
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

const KEYWORDS = new Set([
  "function", "var", "let", "const", "if", "for", "while", "switch", "catch", "return",
  "typeof", "new", "delete", "void", "do", "else", "finally", "try", "throw", "case", "in",
  "of", "instanceof", "await", "async", "class", "extends", "import", "export", "default",
  "yield", "this", "super", "null", "true", "false", "get", "set", "static",
]);

const GLOBALS = new Set([
  "document", "window", "location", "navigator", "console", "history", "JSON", "Math", "Date",
  "Object", "Array", "String", "Number", "Boolean", "Promise", "Error", "RegExp", "Set", "Map",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "fetch", "EventSource", "confirm", "alert", "prompt", "Blob", "URL",
  "URLSearchParams", "structuredClone", "queueMicrotask", "Function", "Symbol", "WeakMap", "Uint8Array",
]);

/** 收集「有定义的名字」：函数声明、变量声明、形参。 */
export function definedNames(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[1]!);
  for (const m of src.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) out.add(m[1]!);
  for (const m of src.matchAll(/function[^(]*\(([^)]*)\)/g)) {
    for (const part of m[1]!.split(",")) {
      const n = part.trim().split(/[\s=]/)[0];
      if (n) out.add(n);
    }
  }
  return out;
}

/** 找出「调用了但没定义」的名字。 */
export function undefinedCalls(src: string): string[] {
  const defined = definedNames(src);
  const called = new Map<string, number>();
  for (const m of src.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = m[1]!;
    called.set(n, (called.get(n) ?? 0) + 1);
  }
  return [...called.entries()]
    .filter(([n]) => !defined.has(n) && !GLOBALS.has(n) && !KEYWORDS.has(n))
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `${n}（被调用 ${c} 次）`);
}

Deno.test("注入脚本：不许有调用了但没定义的函数", () => {
  const missing = undefinedCalls(CLIENT_JS);
  assertEquals(missing, [], `这些函数被调用但没有定义，页面一打开就会报错：${missing.join("、")}`);
});

Deno.test("判据自检：故意漏掉定义时必须报出来", () => {
  // 反向验证判据本身有效 —— 否则「一条都没报」也可能是判据失灵
  const broken = "function a(){ return b(1) + fmtAgo('x'); } function b(n){ return n; }";
  const missing = undefinedCalls(broken);
  assertEquals(missing.length, 1, `应恰好报出 1 个未定义函数，实际：${JSON.stringify(missing)}`);
  assertEquals(missing[0]!.startsWith("fmtAgo"), true);
});
