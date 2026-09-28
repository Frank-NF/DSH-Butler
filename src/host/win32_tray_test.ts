/**
 * 守卫：托盘图标必须在 Explorer 重启后自己回来。
 *
 * 【为什么用「读源码」这种土办法】这段代码跑在 Win32 FFI 上，真实验证需要重启一次 Explorer；
 * 而漏掉任何一条，用户看到的就是"用着用着托盘图标就丢了、窗口也找不回来"（2026-09-28 实测：
 * 这台机器的 Explorer 一天崩了十几次，图标丢了就再也没回来，用户只能反复双击 exe）。
 * 所以把三条关键结构钉死：注册消息、处理消息、定时兜底。
 */

import { assertEquals } from "@std/assert";

const SRC = await Deno.readTextFile(new URL("./win32-tray.ts", import.meta.url));

Deno.test("托盘：注册并处理 TaskbarCreated（Explorer 重启后的标准补救）", () => {
  assertEquals(
    SRC.includes('"TaskbarCreated"'),
    true,
    "没注册 TaskbarCreated —— Explorer 一重启，图标就永久消失",
  );
  assertEquals(SRC.includes("RegisterWindowMessageW"), true, "没有 RegisterWindowMessageW 就注册不了这条消息");
  assertEquals(/msg === taskbarCreatedMsg/.test(SRC), true, "注册了却没在窗口过程里处理，等于白注册");
});

Deno.test("托盘：探测到图标没了才补挂（探测用 NIM_MODIFY，补挂用 NIM_ADD）", () => {
  const from = SRC.indexOf("ensureIcon = (why");
  const to = SRC.indexOf('if (!addIcon("启动"))');
  assertEquals(from > 0 && to > from, true, "找不到 ensureIcon 的实现段落");
  const ensure = SRC.slice(from, to);
  assertEquals(ensure.includes("NIM_MODIFY"), true, "探测必须看 NIM_MODIFY 的返回值");
  assertEquals(ensure.includes("addIcon(why)"), true, "探测到图标没了要补挂");
});

Deno.test("托盘：定时自检兜底（消息收不到时也能补挂，且销毁时要停掉）", () => {
  assertEquals(
    SRC.includes("const selfCheck = setInterval("),
    true,
    "没有定时自检：消息一旦收不到，图标就只能靠重启程序找回",
  );
  assertEquals(SRC.includes("clearInterval(selfCheck)"), true, "自检定时器没停，销毁托盘后会一直空转");
  // 用 includes 而不是正则：这句话里的括号在正则里是分组元字符，读起来容易骗自己
  assertEquals(
    SRC.includes('ensureIcon("Explorer 重启")'),
    true,
    "消息路径没接到补挂函数上",
  );
});
