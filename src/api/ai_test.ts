/**
 * AI 助手边界测试。
 *
 * 配置隔离（重要）：本文件把 HOME / USERPROFILE 指到临时目录并重置配置缓存，
 * 全程不会读写真实的 ~/.dsh-butler/config.json；结束恢复环境并再次重置缓存。
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createApiServer } from "./server.ts";
import {
  aiChat,
  assembleSystemPrompt,
  buildSystemPrompt,
  chatCompletionsUrl,
  type AiMessage,
} from "../domains/ai/ai.ts";
import { resetConfigCacheForTest } from "../domains/state/config.ts";

const TOKEN = "ai-test-token-0123456789";

function freePort(): number {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const p = (l.addr as Deno.NetAddr).port;
  l.close();
  return p;
}

/** 切到临时 HOME（隔离真实配置），返回恢复函数。 */
function isolateHome(): () => void {
  const dir = Deno.makeTempDirSync({ prefix: "butler-ai-test-" });
  const oldHome = Deno.env.get("HOME");
  const oldProfile = Deno.env.get("USERPROFILE");
  Deno.env.set("HOME", dir);
  Deno.env.set("USERPROFILE", dir);
  resetConfigCacheForTest();
  return () => {
    if (oldHome === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", oldHome);
    if (oldProfile === undefined) Deno.env.delete("USERPROFILE");
    else Deno.env.set("USERPROFILE", oldProfile);
    resetConfigCacheForTest();
  };
}

Deno.test("AI：chat/completions 地址归一化", () => {
  assertEquals(chatCompletionsUrl("https://api.deepseek.com"), "https://api.deepseek.com/chat/completions");
  assertEquals(chatCompletionsUrl("https://api.deepseek.com/"), "https://api.deepseek.com/chat/completions");
  assertEquals(chatCompletionsUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
  assertEquals(
    chatCompletionsUrl("https://api.deepseek.com/v1/chat/completions"),
    "https://api.deepseek.com/v1/chat/completions",
  );
});

Deno.test("AI：系统提示词带关键约束", () => {
  const p = buildSystemPrompt();
  assertStringIncludes(p, "结论先行");
  assertStringIncludes(p, "计划");
  assertStringIncludes(p, "只读检查");
});

Deno.test("AI：现场信息并入系统提示词时脱敏并限长", () => {
  const out = assembleSystemPrompt("基础提示", [
    "DSH 服务：未运行\n日志：token=abcdef123456 出现在日志里",
    "A".repeat(8000),
  ], 6000);
  assert(!out.includes("abcdef123456"), "密钥样文本必须被脱敏");
  assertStringIncludes(out, "token=***");
  assert(out.length <= 6300, "超长必须被截断");
});

Deno.test("AI：aiChat 走用户端点、系统提示在最前、错误不泄漏密钥", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "连接正常" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const cfg = { baseUrl: "https://api.test.local/v1", apiKey: "sk-secret-abcdef", model: "test-model" };
    const msgs: AiMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "你好" }];
    const reply = await aiChat(cfg, msgs);
    assertEquals(reply, "连接正常");
    assertEquals(calls.length, 1);
    const call0 = calls[0];
    assert(call0 !== undefined);
    assertEquals(call0.url, "https://api.test.local/v1/chat/completions");
    const headers = call0.init.headers as Record<string, string>;
    assertEquals(headers.authorization, "Bearer sk-secret-abcdef");
    const body = JSON.parse(String(call0.init.body));
    assertEquals(body.model, "test-model");
    assertEquals(body.messages[0].role, "system");

    globalThis.fetch = (async () => new Response("denied", { status: 401 })) as typeof fetch;
    let msg = "";
    try {
      await aiChat(cfg, msgs);
    } catch (e) {
      msg = (e as Error).message;
    }
    assertStringIncludes(msg, "密钥");
    assert(!msg.includes("sk-secret-abcdef"), "错误信息不得携带密钥");
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("AI 路由：配置保存/掩码/对话（隔离 HOME，不碰真实配置）", async () => {
  const restore = isolateHome();
  const s = createApiServer({ token: TOKEN, port: freePort() });
  const H = { "x-butler-token": TOKEN, "content-type": "application/json" };
  try {
    const g0 = await (await fetch(s.origin + "/api/ai/config", { headers: H })).json();
    assertEquals(g0.hasKey, false);

    const save = await (await fetch(s.origin + "/api/ai/config", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        baseUrl: "https://api.test.local/v1",
        model: "test-model",
        apiKey: "sk-test-1234567890",
        attachDiagnostics: false,
      }),
    })).json();
    assertEquals(save.hasKey, true);
    assertEquals(save.keyMasked, "sk-t••••7890");

    const g1 = await (await fetch(s.origin + "/api/ai/config", { headers: H })).json();
    assertEquals(g1.hasKey, true);
    assertEquals(g1.keyMasked, "sk-t••••7890");
    const raw = await (await fetch(s.origin + "/api/ai/config", { headers: H })).text();
    assert(!raw.includes("sk-test-1234567890"), "配置接口不得回传密钥原文");

    const captured: Array<{ url: string; body: string }> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      // 只劫持发往用户 API 的调用；测试自身对管家服务的请求要走真实 fetch
      if (String(input).includes("/chat/completions")) {
        captured.push({ url: String(input), body: String(init?.body ?? "") });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "先看日志尾部" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return orig(input as Parameters<typeof fetch>[0], init);
    }) as typeof fetch;
    try {
      const chat = await (await fetch(s.origin + "/api/ai/chat", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ messages: [{ role: "user", content: "DSH 起不来怎么办" }] }),
      })).json();
      assertEquals(chat.ok, true);
      assertEquals(chat.reply, "先看日志尾部");
      assertEquals(captured.length, 1);
      const cap0 = captured[0];
      assert(cap0 !== undefined);
      const sent = JSON.parse(cap0.body);
      assertEquals(sent.messages[0].role, "system");
      assertStringIncludes(sent.messages[0].content, "结论先行");
      assert(!sent.messages[0].content.includes("自动采集"), "attachDiagnostics=false 时不得附带现场");
    } finally {
      globalThis.fetch = orig;
    }

    await fetch(s.origin + "/api/ai/config", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ clearKey: true }),
    });
    const g2 = await (await fetch(s.origin + "/api/ai/config", { headers: H })).json();
    assertEquals(g2.hasKey, false);
  } finally {
    s.shutdown();
    restore();
  }
});
