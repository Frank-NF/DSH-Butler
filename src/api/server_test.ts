/**
 * 本地接口的边界测试。【安全 · 2026-09-25 审计 SEC-01】
 *
 * 两条曾经真实存在的问题，各留一条测试看着：
 *   1) 会话令牌会对**匿名请求**下发 —— 不带任何凭据 GET / 就能从响应头拿到 butler_token；
 *   2) 没有任何 Host 校验 —— DNS rebinding 让攻击者域名解析到 127.0.0.1 后即为同源。
 */
import { assertEquals } from "@std/assert";
import { createApiServer } from "./server.ts";

const TOKEN = "test-token-0123456789abcdef";

/** 用裸 TCP 发请求：fetch 不允许自己设 Host 头，而这两条测试恰恰要控制 Host。 */
async function rawGet(port: number, host: string, path = "/"): Promise<string> {
  const conn = await Deno.connect({ hostname: "127.0.0.1", port });
  try {
    await conn.write(
      new TextEncoder().encode(
        `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      ),
    );
    const chunks: Uint8Array[] = [];
    const buf = new Uint8Array(8192);
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;
      chunks.push(buf.slice(0, n));
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return new TextDecoder().decode(out);
  } finally {
    try {
      conn.close();
    } catch { /* 已经关了 */ }
  }
}

Deno.test("接口边界：匿名请求不再拿到会话 cookie（SEC-01）", async () => {
  const s = createApiServer({ token: TOKEN });
  try {
    const anon = await fetch(`${s.origin}/`);
    assertEquals(anon.status, 200);
    assertEquals(anon.headers.get("set-cookie"), null, "匿名请求不应该被塞令牌");
    await anon.body?.cancel();

    const boot = await fetch(`${s.origin}/?t=${TOKEN}`);
    const sc = boot.headers.get("set-cookie") ?? "";
    assertEquals(sc.includes(`butler_token=${TOKEN}`), true, "带令牌的首屏应该换到 cookie");
    await boot.body?.cancel();

    const api = await fetch(`${s.origin}/api/jobs`);
    assertEquals(api.status, 401);
    assertEquals(api.headers.get("set-cookie"), null, "401 也不能顺手把令牌发出去");
    await api.body?.cancel();

    const ok = await fetch(`${s.origin}/api/jobs`, { headers: { "x-butler-token": TOKEN } });
    assertEquals(ok.status, 200);
    await ok.body?.cancel();
  } finally {
    s.shutdown();
  }
});

Deno.test("接口边界：非回环 Host 一律 403（防 DNS rebinding，SEC-01）", async () => {
  const s = createApiServer({ token: TOKEN });
  try {
    const evil = await rawGet(s.port, "evil.example.com");
    assertEquals(evil.startsWith("HTTP/1.1 403"), true, `应 403，实际：${evil.slice(0, 40)}`);
    assertEquals(evil.includes(TOKEN), false, "403 响应里不许出现令牌");

    const local = await rawGet(s.port, `127.0.0.1:${s.port}`);
    assertEquals(local.startsWith("HTTP/1.1 200"), true, `回环 Host 应放行，实际：${local.slice(0, 40)}`);

    const localhost = await rawGet(s.port, `localhost:${s.port}`, "/healthz");
    assertEquals(localhost.startsWith("HTTP/1.1 200"), true);
  } finally {
    s.shutdown();
  }
});
