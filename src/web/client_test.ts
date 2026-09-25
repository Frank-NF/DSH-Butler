/**
 * 客户端脚本守卫。
 *
 * 背景（真实事故一）：CLIENT_JS 是塞在反引号模板里的字符串，TS 不会当代码检查它。
 * 2026-09-24 曾因一处 join 的转义（模板里被解成真换行）导致注入浏览器的整段 JS 语法错误 ——
 * 页面永远停在「正在加载…」，而服务端、鉴权、接口全部正常，极易误判成 401 或网络问题。
 *
 * 背景（真实事故二）：同一晚，界面调用了 shellCard() 但定义它的那次编辑没落盘 ——
 * 语法全绿、parse 测试全过，浏览器里整页只剩 "shellCard is not defined"。
 *
 * 所以：每次改 client.ts，这两条测试就是「页面到底能不能跑」的最底线。
 * 判据实现在 script_guard.ts，与 bar.ts（注入 DSH 页面的悬浮条）共用一份。
 */
import { assertEquals } from "@std/assert";

import { CLIENT_JS } from "./client.ts";
import { findUndefinedCalls } from "./script_guard.ts";

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


Deno.test("CLIENT_JS：装已装插件被拦住时，给出「卸载并安装」出路（防回归）", () => {
  // 真实事故三：被 plugin.already-installed 拦住时弹窗只有「取消」，用户只能自己
  // 先去卸载再回来点安装 —— 白跑一趟。改动 confirmPlan/runReinstall 时这条先红。
  const must = [
    "plugin.already-installed", // 出路只对「已安装」这一种拦路开放
    "modal-reinstall", // 弹窗底部的按钮
    "卸载并安装", // 按钮文案
    "runReinstall", // 卸载→安装的串跑实现
    "resolve('reinstall')", // 点了之后回给调用方的信号
  ];
  const missing = must.filter((s) => !CLIENT_JS.includes(s));
  assertEquals(
    missing,
    [],
    `CLIENT_JS 缺少「卸载并安装」相关代码：${missing.join("、")} —— 已安装的插件又要被白白拦一次`,
  );
});
Deno.test("CLIENT_JS 里不允许调用未定义的函数（防「少写一个函数，整页白」）", () => {
  const missing = findUndefinedCalls(CLIENT_JS);
  assertEquals(
    missing,
    [],
    `CLIENT_JS 里调用了未定义的名字：${missing.join("、")} —— 浏览器里会直接报 xxx is not defined`,
  );
});
