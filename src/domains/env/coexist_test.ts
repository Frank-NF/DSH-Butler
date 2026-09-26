/**
 * 共存降级的判据测试（P2-5）。
 *
 * 这里最容易犯的错是【误判】：把管家自己或 node 当成官方桌面端，于是用户什么都没干，
 * 悬浮条就没了。所以判据必须保守，且「设置里强制 full」必须永远能压过自动检测。
 */
import { assertEquals } from "@std/assert";
import { decideMode, isOfficialDesktopProcess } from "./coexist.ts";

Deno.test("共存检测：官方桌面端认得出", () => {
  assertEquals(isOfficialDesktopProcess({ name: "DSH.exe" }), true);
  assertEquals(isOfficialDesktopProcess({ name: "dsh-desktop" }), true);
  assertEquals(isOfficialDesktopProcess({ name: "deepseek-harness.exe" }), true);
  assertEquals(
    isOfficialDesktopProcess({ name: "junk.exe", cmdline: "C:\\Program Files\\DSH Desktop\\electron.exe main.js" }),
    true,
    "Electron 壳：路径里同时有 dsh 与 desktop/electron 也该认出来",
  );
});

Deno.test("共存检测：自己人绝不能被误判", () => {
  for (const name of ["dsh-butler.exe", "dshbutler", "deno.exe", "node.exe", "pwsh.exe", "powershell.exe", "cmd.exe"]) {
    assertEquals(isOfficialDesktopProcess({ name }), false, `${name} 不该被当成官方桌面端`);
  }
  assertEquals(
    isOfficialDesktopProcess({ name: "something.exe", cmdline: "C:\\Users\\x\\.dsh-butler\\dist\\dsh-butler.exe" }),
    false,
    "命令行里带 dsh-butler 的一律排除",
  );
  assertEquals(isOfficialDesktopProcess({}), false);
  assertEquals(isOfficialDesktopProcess({ name: "dsh-tool.exe" }), false, "名字像但不是（保守优先）");
});

Deno.test("共存模式：自动检测 vs 强制完整", () => {
  assertEquals(decideMode(true, { coexistMode: "auto" }), "service-only");
  assertEquals(decideMode(false, { coexistMode: "auto" }), "full");
  assertEquals(decideMode(true, { coexistMode: "full" }), "full", "设置里强制完整模式必须压过自动检测");
  assertEquals(decideMode(false, {}), "full", "配置缺字段时按完整模式");
});
