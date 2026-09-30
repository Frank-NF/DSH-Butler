/**
 * 本地接口的边界测试。【安全 · 2026-09-25 审计 SEC-01】
 *
 * 两条曾经真实存在的问题，各留一条测试看着：
 *   1) 会话令牌会对**匿名请求**下发 —— 不带任何凭据 GET / 就能从响应头拿到 butler_token；
 *   2) 没有任何 Host 校验 —— DNS rebinding 让攻击者域名解析到 127.0.0.1 后即为同源。
 */
import { assertEquals } from "@std/assert";
import { createApiServer, resolvePort } from "./server.ts";
import { BUTLER_PORT_FALLBACK_SPAN } from "../version.ts";

const TOKEN = "test-token-0123456789abcdef";

/**
 * 取一个可用端口交给被测服务。
 * 为什么必须显式传：Deno.serve 会优先采用环境变量 DENO_SERVE_ADDRESS（本机实测它连显式
 * port 都覆盖），而 server.ts 会把该变量改写成我们要的地址；这里给每次测试一个确定的新端口，
 * 避免两条测试前后抢同一个随机端口。
 */
function freePort(): number {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const p = (l.addr as Deno.NetAddr).port;
  l.close();
  return p;
}

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
  const s = createApiServer({ token: TOKEN, port: freePort() });
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
  const s = createApiServer({ token: TOKEN, port: freePort() });
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

/**
 * 找一段**连续**空闲的端口，用来模拟"首选端口被占"的场景。
 * 必须连续 —— 否则"顺延到下一个"到底该落在哪个端口就不确定了。
 */
function freePortBlock(count: number): number {
  for (let base = 20000; base < 60000; base += count + 1) {
    const held: Deno.Listener[] = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      try {
        held.push(Deno.listen({ hostname: "127.0.0.1", port: base + i }));
      } catch {
        ok = false;
        break;
      }
    }
    for (const l of held) {
      try {
        l.close();
      } catch { /* 关不掉不影响 */ }
    }
    if (ok) return base;
  }
  throw new Error(`找不到 ${count} 个连续空闲端口`);
}

/** 占住 [base, base+count) 这些端口，跑完自动放开。 */
async function withPortsHeld<T>(
  base: number,
  count: number,
  fn: () => T,
): Promise<T> {
  const held: Deno.Listener[] = [];
  for (let i = 0; i < count; i++) {
    try {
      held.push(Deno.listen({ hostname: "127.0.0.1", port: base + i }));
    } catch { /* 被别人占了也算"不可用"，不影响结论 */ }
  }
  try {
    return fn();
  } finally {
    for (const l of held) {
      try {
        l.close();
      } catch { /* 忽略 */ }
    }
  }
}

Deno.test("端口：首选端口空闲时就用它（桌面态地址要稳定）", () => {
  const base = freePortBlock(2);
  assertEquals(resolvePort(base, true), base);
});

Deno.test("端口：首选被占时顺延到下一个可用端口", async () => {
  const base = freePortBlock(3);
  await withPortsHeld(base, 1, () => {
    const got = resolvePort(base, true);
    assertEquals(got === base, false, "不该再选被占住的那个");
    assertEquals(got, base + 1, "顺延应该落在紧邻的下一个空闲端口");
  });
});

Deno.test("端口：连着被占就继续往后找", async () => {
  const base = freePortBlock(4);
  await withPortsHeld(base, 2, () => {
    const got = resolvePort(base, true);
    assertEquals(got, base + 2, "前两个都被占，应该落到第三个");
  });
});

Deno.test(
  "端口：首选及后续全被占时回退随机端口，而不是启动失败",
  async () => {
    const base = freePortBlock(BUTLER_PORT_FALLBACK_SPAN + 2);
    await withPortsHeld(base, BUTLER_PORT_FALLBACK_SPAN + 1, () => {
      // 返回 0 = 交给系统随机分配。这条最要紧：端口全被占也必须能起来，
      // 否则用户看到的就是"这软件打不开"，而不是"端口飘了"。
      assertEquals(resolvePort(base, true), 0);
    });
  },
);

Deno.test("端口：headless 不做兜底，严格用指定端口（脚本要靠它找到我们）", () => {
  const base = freePortBlock(2);
  assertEquals(resolvePort(base, false), base);
});

Deno.test("端口：没有指定就随机分配（保持原有行为）", () => {
  assertEquals(resolvePort(undefined, true), 0);
});

Deno.test("端口：桌面态实际起服务时，地址就是首选端口", () => {
  const base = freePortBlock(2);
  const s = createApiServer({ token: TOKEN, port: base, allowPortFallback: true });
  try {
    assertEquals(s.port, base, "首选端口空闲就该绑在它上面");
    assertEquals(s.origin, `http://127.0.0.1:${base}`);
  } finally {
    s.shutdown();
  }
});
