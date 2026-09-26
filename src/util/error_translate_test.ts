/**
 * 错误翻译器的测试。样本全部来自真实踩过的坑（尤其是 2026-09-25 那次依赖冲突）。
 */
import { assertEquals } from "@std/assert";
import { appendExplanation, EXPLAIN_MARK, explainErrorText, translateError } from "./error-translate.ts";

// 真实原文：今天卸载/安装 @liustack/modlens 时 npm 刷出来的那段
const ERESOLVE_REAL = [
  "npm error code ERESOLVE",
  "npm error While resolving: dsh-context@0.55.0",
  "npm error Found: @deepseek-ai/dsh-scope@0.0.1-rc.1",
  "npm error Could not resolve dependency:",
  "npm error peer @deepseek-ai/dsh-session@\">=0.1.2-rc.1\" from dsh-context@0.55.0",
  "npm error Conflicting peer dependency: @deepseek-ai/dsh-scope@0.1.2-rc.1",
  "npm error Fix the upstream dependency conflict, or retry with --force or --legacy-peer-deps",
].join(String.fromCharCode(10));

Deno.test("翻译器：真实的 ERESOLVE 会被认出来并给出人话", () => {
  const a = translateError(ERESOLVE_REAL);
  assertEquals(a?.id, "err.eresolve");
  assertEquals(a?.title.includes("依赖版本对不上"), true);
  assertEquals((a?.action ?? "").includes("宽松解析"), true);
  assertEquals((a?.evidence ?? []).length > 0, true);
});

Deno.test("翻译器：各类常见报错都有人话", () => {
  const cases: Array<[string, string]> = [
    ["npm error code EADDRINUSE", "err.port-in-use"],
    ["Error: os error 10048: 通常每个套接字地址只允许使用一次", "err.port-in-use"],
    ["EPERM: operation not permitted, rename 'C:\\x\\tmp-1' -> 'C:\\x'", "err.filelock"],
    [["npm error code E404", "npm error 404 Not Found - GET https://registry/x"].join(String.fromCharCode(10)), "err.e404"],
    [["npm error code ETARGET", "npm error notarget No matching version found"].join(String.fromCharCode(10)), "err.etarget"],
    [["npm error code ENOSPC", "npm error nospc ENOSPC: no space left on device"].join(String.fromCharCode(10)), "err.enospc"],
    [["npm error code ETIMEDOUT", "npm error network request timed out"].join(String.fromCharCode(10)), "err.timeout"],
    [["npm error code ECONNRESET", "npm error network socket hang up"].join(String.fromCharCode(10)), "err.connreset"],
    [["npm error code ENOTFOUND", "npm error network getaddrinfo ENOTFOUND registry.x"].join(String.fromCharCode(10)), "err.dns"],
    [["npm error code EINTEGRITY", "npm error sha512-abc integrity checksum failed"].join(String.fromCharCode(10)), "err.eintegrity"],
    [["npm error code EBADENGINE", "npm error Unsupported engine for foo@1: wanted node 22"].join(String.fromCharCode(10)), "err.badengine"],
    ["ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile", "err.pnpm-lockfile"],
    ["ERR_PNPM_NO_MATCHING_VERSION No matching version found for foo@^9", "err.pnpm-nomatch"],
    [["npm error code EACCES", "npm error errno -4092 permission denied"].join(String.fromCharCode(10)), "err.eacces"],
    ["SyntaxError: Unexpected token } in JSON at position 12", "err.badjson"],
    [["npm error command failed", "npm error Lifecycle script `postinstall` failed"].join(String.fromCharCode(10)), "err.script"],
    ["git@github.com: Permission denied (publickey).", "err.git-auth"],
    ["remote: Repository not found.", "err.git-repo"],
    ["error: os error 4551 应用程序控制策略已阻止此文件", "err.win-sac"],
  ];
  for (const [raw, wantId] of cases) {
    assertEquals(translateError(raw)?.id, wantId, "没认出来：" + wantId + " ← " + raw.slice(0, 60));
  }
});

Deno.test("翻译器：认不出来就闭嘴（绝不编解释）", () => {
  assertEquals(translateError("一切正常，没有错误"), null);
  assertEquals(translateError(""), null);
  assertEquals(explainErrorText("某个没人见过的新错误"), null);
});

Deno.test("翻译器：拼到失败信息上只拼一次，且四条俱全", () => {
  const once = appendExplanation(ERESOLVE_REAL);
  assertEquals(once.includes(EXPLAIN_MARK), true);
  for (const k of ["【怎么回事】", "【为什么】", "【影响】", "【怎么办】"]) {
    assertEquals(once.includes(k), true, "缺了 " + k);
  }
  assertEquals(once.startsWith("npm error code ERESOLVE"), true);
  assertEquals(appendExplanation(once), once);
  assertEquals(appendExplanation("某个没人见过的新错误"), "某个没人见过的新错误");
});
