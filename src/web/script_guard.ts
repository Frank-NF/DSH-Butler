/**
 * 注入型脚本的静态守卫（client.ts 与 bar.ts 共用）。
 *
 * 【为什么需要】这些脚本都是塞在字符串里的 JS：TS 不检查它们，语法测试也只管"能不能解析"。
 * 2026-09-24 真实事故：界面里调用了 shellCard()，但定义它的那次编辑没落盘 ——
 * 语法全绿、parse 测试全过，浏览器里整页只剩 "shellCard is not defined"。
 *
 * 这条守卫把脚本里所有"名字("形式的调用挑出来，逐个核对是否在本文件里定义过
 * （函数声明 / var 赋值 / 形参）。既没定义、又不在白名单里，就是这一类事故。
 */

/** 语言关键字与语句 —— 长得像函数调用但不是。 */
const KEYWORDS = [
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "typeof",
  "new",
  "delete",
  "void",
  "in",
  "of",
  "do",
  "else",
  "function",
  "var",
  "let",
  "const",
  "class",
];

/** 运行时/浏览器内置（用到才加，不预先堆一大堆）。 */
const BUILTIN_GLOBALS = new Set([
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
  "setInterval",
  "clearInterval",
  "EventSource",
  "URL",
  "URLSearchParams",
  "Function",
  "Symbol",
  "atob",
  "btoa",
  "requestAnimationFrame",
  "getComputedStyle",
  "MutationObserver",
  "console",
  "document",
  "window",
  "localStorage",
  "navigator",
]);

export interface GuardOptions {
  /** 该脚本独有、但确实存在的全局名（例如页面桥 bindings）。 */
  extraGlobals?: string[];
}

/**
 * 返回"调用了但找不到定义"的名字列表；空数组表示通过。
 *
 * 说明：判定是保守的 —— 只要某个名字在脚本里以形参出现过一次，就当它可能是个函数，
 * 不报。所以它能抓住"整块定义缺失"（本次事故那种），不会因为作用域分析不精确而误报。
 */
/**
 * 去掉字符串字面量的内容（保留引号本身，代码结构不变）。
 *
 * 为什么必须先剥：CSS 里满是 blur(8px)、rgba(0,0,0,.3)、var(--x) 这种东西，
 * 它们长得和函数调用一模一样。剥掉字符串内容之后，剩下的才是真正的代码。
 */
function stripStringLiterals(js: string): string {
  return js
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""');
}

export function findUndefinedCalls(rawJs: string, opts: GuardOptions = {}): string[] {
  const js = stripStringLiterals(rawJs);
  const defined = new Set<string>();
  for (const m of js.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]!);
  for (const m of js.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]!);
  for (const m of js.matchAll(/function[^(]*\(([^)]*)\)/g)) {
    for (const raw of m[1]!.split(",")) {
      const name = raw.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
    }
  }

  const allowed = new Set([...BUILTIN_GLOBALS, ...(opts.extraGlobals ?? [])]);
  const missing = new Set<string>();
  // 【2026-09-25 修的洞】原来写成 /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/ —— 前缀字符被
  // 当作匹配的一部分消耗掉了，于是**紧跟在 `(` 后面的嵌套调用永远检查不到**：
  //   esc(fmtAgo(p.createdAt))      ← fmtAgo 前面那个 `(` 已被 esc( 这次匹配吃掉
  // 结果就是「调用了但没定义」的整类事故里，嵌套写法全都漏网（fmtAgo 那次就是这么漏的：
  // 语法测试全绿、守卫也全绿，回滚点页一打开就 ReferenceError）。
  // 改成后行断言：只断言前面不是名字/点号，不消耗字符，嵌套调用也能逐个看到。
  for (const m of js.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1]!;
    if (defined.has(name) || allowed.has(name) || KEYWORDS.includes(name)) continue;
    missing.add(name);
  }
  return [...missing].sort();
}
