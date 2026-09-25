/**
 * cmd 参数闸口的回归测试。【安全 · 2026-09-25 审计 SEC-02】
 *
 * 背景（实测过的事实）：Windows 上 Deno 只在参数含空格或制表符时才加引号，
 * `cmd /c echo left-pad@1.0.0&whoami` 里的 whoami 会被真的执行。
 * 这几条测试盯的就是「不许再把带 cmd 特殊字符的参数放进去」。
 */
import { assertEquals, assertThrows } from "@std/assert";
import { assertSafeCmdArgs } from "./shell.ts";

Deno.test("cmd 闸口：拒绝注入形状的参数", () => {
  const bad = [
    "left-pad@1.0.0&whoami", // 审计里实测能执行的那一条
    "a|b",
    "a>b",
    "a<b",
    "a%USERNAME%b", // % 会被 cmd 展开成环境变量
    'a"b',
    "a\nb",
  ];
  for (const arg of bad) {
    assertThrows(() => assertSafeCmdArgs(["npm", "install", arg]), Error, undefined, `应拒绝：${arg}`);
  }
});

Deno.test("cmd 闸口：放行正常的包名、版本与带空格的路径", () => {
  const good = [
    "npm",
    "install",
    "@liustack/modlens@3.26.5",
    "dsh-market@*",
    "pkg@^1.0.0", // semver 范围里的 ^ 是合法的：真注入仍须带上 & | < > %
    "C:\\Users\\some one\\.dsh\\profiles\\web",
    "--legacy-peer-deps",
  ];
  for (const arg of good) {
    assertSafeCmdArgs([arg]);
  }
  assertEquals(assertSafeCmdArgs([]), undefined);
});
