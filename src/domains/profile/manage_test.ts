/**
 * 多 profile 的纯逻辑测试（P1-1）。
 *
 * profile 名会进路径、端口判定会影响「该不该换端口」，所以这两件必须钉死。
 * listProfiles 要读真实 ~/.dsh，不在这里测（由真机验证覆盖）。
 */
import { assertEquals } from "@std/assert";
import { isLikelyReservedRange, isSafeProfileName, probePortFree, profilePathOf } from "./manage.ts";

Deno.test("profile 名：合法性与路径", () => {
  assertEquals(isSafeProfileName("web"), true);
  assertEquals(isSafeProfileName("desktop-2"), true);
  assertEquals(isSafeProfileName("a.b_c"), true);
  assertEquals(isSafeProfileName(""), false);
  assertEquals(isSafeProfileName(".."), false, "路径穿越必须拒绝");
  assertEquals(isSafeProfileName("a/b"), false, "分隔符必须拒绝");
  assertEquals(isSafeProfileName("a\\b"), false);
  assertEquals(isSafeProfileName("a b"), false);
  assertEquals(isSafeProfileName("a".repeat(41)), false, "过长拒绝");
  assertEquals(profilePathOf("web").endsWith("profiles" + "\\" + "web") || profilePathOf("web").endsWith("profiles/web"), true);
});

Deno.test("端口：保留区间疑似判定", () => {
  assertEquals(isLikelyReservedRange(51424), true, "今天真踩过的那个端口");
  assertEquals(isLikelyReservedRange(49152), true, "区间下界");
  assertEquals(isLikelyReservedRange(3081), false);
  assertEquals(isLikelyReservedRange(8787), false);
});

Deno.test("端口：真的绑一次才知道能不能用", () => {
  // 先占一个端口，再探它：必须报 false；放开后再探：必须报 true
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (l.addr as Deno.NetAddr).port;
  try {
    assertEquals(probePortFree(port), false, "被占着的端口必须报不可用");
  } finally {
    l.close();
  }
  assertEquals(probePortFree(port), true, "放开后必须报可用");
});
