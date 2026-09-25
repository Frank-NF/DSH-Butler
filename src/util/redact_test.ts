/** 脱敏规则的回归测试。【安全 · 审计 SEC-10】 */
import { assertEquals } from "@std/assert";
import { maskSecrets } from "./redact.ts";

Deno.test("脱敏：日志里的令牌/密码/密钥都打码", () => {
  const input = [
    "dsh server started token=abc123def456 ok",
    "password: hunter2",
    "api_key = sk-0123456789",
    "secret=xyz",
    "普通日志：插件已安装 @liustack/modlens",
  ].join("\n");
  const out = maskSecrets(input);
  assertEquals(out.includes("abc123def456"), false);
  assertEquals(out.includes("hunter2"), false);
  assertEquals(out.includes("sk-0123456789"), false);
  assertEquals(out.includes("xyz"), false);
  assertEquals(out.includes("token=***"), true);
  // 脱敏会把分隔符统一写成 =（原样是 password: hunter2）—— 关键是值被抹掉了
  assertEquals(out.includes("password=***"), true);
  assertEquals(out.includes("插件已安装 @liustack/modlens"), true, "正常内容不能被误伤");
});
