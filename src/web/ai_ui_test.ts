/**
 * 守卫：AI 助手页的「从 DSH 导入」入口。
 *
 * 这一块的失败方式很隐蔽：按钮画出来了、点下去 404，用户只会觉得"这功能是坏的"。
 * 所以把「渲染 + 取数据 + 调接口」三件事都钉住；顺带钉住"页面不碰明文密钥"。
 */

import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("AI 助手：有「从 DSH 导入」卡片，且拿得到通道清单", () => {
  assertEquals(CLIENT_JS.includes("function dshImportCard()"), true, "没有导入卡片");
  assertEquals(CLIENT_JS.includes("html += dshImportCard();"), true, "卡片没插进 AI 页");
  assertEquals(CLIENT_JS.includes("'/api/ai/dsh-channels'"), true, "没有取通道清单的请求");
  assertEquals(
    CLIENT_JS.includes("AI.channels = (r[1] && r[1].channels)"),
    true,
    "没有把通道清单存下来",
  );
  assertEquals(CLIENT_JS.includes("if (!AI.channels.length) return ''"), true, "没有通道时不该占地方");
});

Deno.test("AI 助手：点「用这个」走导入接口，且只送通道名", () => {
  assertEquals(CLIENT_JS.includes("data-dsh-import"), true, "按钮没有带通道名");
  assertEquals(CLIENT_JS.includes("'/api/ai/import-dsh'"), true, "没有导入请求");
  assertEquals(
    CLIENT_JS.includes("body: { key: key }"),
    true,
    "导入请求要送的就是通道名（密钥在服务端自己取，绝不经过页面）",
  );
  assertEquals(
    CLIENT_JS.includes("r.apiKey"),
    false,
    "页面不该从接口拿明文密钥",
  );
});

Deno.test("AI 助手：导入失败要说人话，按钮要能再点一次", () => {
  assertEquals(CLIENT_JS.includes("'导入失败：'"), true, "失败没有提示");
  assertEquals(CLIENT_JS.includes("btn.textContent = '用这个';"), true, "失败后按钮没恢复，用户点不了第二次");
});
