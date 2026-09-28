/**
 * 本体更新检查的测试：不联网（fetch 注入假实现），也不碰真实用户目录（临时目录）。
 */
import { assertEquals } from "@std/assert";

import {
  checkCoreUpdate,
  clearCoreUpdateCache,
  CORE_UPDATE_TTL_MS,
  type CoreUpdateInfo,
  fetchDistTags,
  pickNewest,
  readCoreUpdateCache,
  recomputeAvailable,
} from "./core-update.ts";

function fakeFetch(tags: Record<string, string> | number): typeof fetch {
  return ((_url: string) => {
    if (typeof tags === "number") return Promise.resolve(new Response("", { status: tags }));
    return Promise.resolve(
      new Response(JSON.stringify({ "dist-tags": tags }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

Deno.test("pickNewest：latest 落后于 next 时取 next（实测就是这个局面）", () => {
  const picked = pickNewest({
    latest: "0.1.5-rc.3",
    next: "0.1.7-rc.2",
    alpha: "0.1.7-alpha.2",
  });
  assertEquals(picked, { version: "0.1.7-rc.2", channel: "next" });
});

Deno.test("pickNewest：正式版优先于预发布；空表返回 null", () => {
  assertEquals(pickNewest({ latest: "1.0.0", next: "1.1.0-rc.1" }), {
    version: "1.1.0-rc.1",
    channel: "next",
  });
  assertEquals(pickNewest({ latest: "1.2.0", next: "1.1.0" }), {
    version: "1.2.0",
    channel: "latest",
  });
  assertEquals(pickNewest({}), null);
});

Deno.test("fetchDistTags：解析 dist-tags，失败抛错", async () => {
  assertEquals(await fetchDistTags(fakeFetch({ latest: "1.0.0", next: "1.1.0" })), {
    latest: "1.0.0",
    next: "1.1.0",
  });
  let threw = false;
  try {
    await fetchDistTags(fakeFetch(500));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("checkCoreUpdate：本机落后就 available，并写缓存", async () => {
  const root = await Deno.makeTempDir();
  const info = await checkCoreUpdate({
    installed: "0.1.7-rc.1",
    fetcher: fakeFetch({ latest: "0.1.5-rc.3", next: "0.1.7-rc.2" }),
    root,
  });
  assertEquals(info.available, true);
  assertEquals(info.latest, "0.1.7-rc.2");
  assertEquals(info.channel, "next");
  assertEquals(readCoreUpdateCache(root)?.latest, "0.1.7-rc.2");
  await Deno.remove(root, { recursive: true });
});

Deno.test("checkCoreUpdate：本机已是最新就不提示", async () => {
  const root = await Deno.makeTempDir();
  const info = await checkCoreUpdate({
    installed: "0.1.7-rc.2",
    fetcher: fakeFetch({ next: "0.1.7-rc.2" }),
    root,
  });
  assertEquals(info.available, false);
  await Deno.remove(root, { recursive: true });
});

Deno.test("checkCoreUpdate：缓存不过期就不联网", async () => {
  const root = await Deno.makeTempDir();
  await checkCoreUpdate({
    installed: "0.1.7-rc.1",
    fetcher: fakeFetch({ next: "0.1.7-rc.2" }),
    root,
  });
  let calls = 0;
  const spy = (() => {
    calls++;
    return Promise.reject(new Error("不该被调用"));
  }) as unknown as typeof fetch;
  const info = await checkCoreUpdate({ installed: "0.1.7-rc.1", fetcher: spy, root });
  assertEquals(calls, 0);
  assertEquals(info.latest, "0.1.7-rc.2");
  await Deno.remove(root, { recursive: true });
});

Deno.test("checkCoreUpdate：联网失败但有旧缓存 → 退回缓存；没有缓存 → 不报更新", async () => {
  const root = await Deno.makeTempDir();
  await checkCoreUpdate({
    installed: "0.1.7-rc.1",
    fetcher: fakeFetch({ next: "0.1.7-rc.2" }),
    root,
  });
  const boom = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  const stale = await checkCoreUpdate({
    installed: "0.1.7-rc.1",
    fetcher: boom,
    root,
    force: true,
    now: () => Date.now() + CORE_UPDATE_TTL_MS * 2,
  });
  assertEquals(stale.latest, "0.1.7-rc.2", "过期缓存也要能用");
  const empty = await Deno.makeTempDir();
  const none = await checkCoreUpdate({ installed: "0.1.7-rc.1", fetcher: boom, root: empty });
  assertEquals(none.available, false);
  assertEquals(none.latest, null);
  await Deno.remove(root, { recursive: true });
  await Deno.remove(empty, { recursive: true });
});

Deno.test("recomputeAvailable：缓存里那句「可更新」必须按当前版本重算（任务4 根因）", async () => {
  const root = await Deno.makeTempDir();
  // 更新前：本机 0.1.7-rc.1，上游 0.1.7-rc.2 → 缓存里记下 available=true
  const before = await checkCoreUpdate({
    installed: "0.1.7-rc.1",
    fetcher: fakeFetch({ next: "0.1.7-rc.2" }),
    root,
  });
  assertEquals(before.available, true);
  // 更新后：本机已经是 0.1.7-rc.2，缓存还在有效期内（不会再联网）
  const after = await checkCoreUpdate({
    installed: "0.1.7-rc.2",
    fetcher: fakeFetch({ next: "0.9.9" }),
    root,
  });
  assertEquals(after.installed, "0.1.7-rc.2");
  assertEquals(after.available, false, "更新完还挂着「可更新」就是这次要修的 bug");
  await Deno.remove(root, { recursive: true });
});

Deno.test("recomputeAvailable：拿不到本机版本时不下结论（沿用缓存里的判断）", () => {
  const info: CoreUpdateInfo = {
    installed: "0.1.7-rc.1",
    latest: "0.1.7-rc.2",
    channel: "next",
    tags: { next: "0.1.7-rc.2" },
    available: true,
    checkedAt: new Date().toISOString(),
  };
  assertEquals(recomputeAvailable(info, null).available, true);
  assertEquals(recomputeAvailable(info, "0.1.7-rc.2").available, false);
  assertEquals(recomputeAvailable(info, "0.1.6").available, true);
});

Deno.test("clearCoreUpdateCache：删掉缓存（没有也算清干净）", async () => {
  const root = await Deno.makeTempDir();
  await checkCoreUpdate({
    installed: "0.1.7-rc.1",
    fetcher: fakeFetch({ next: "0.1.7-rc.2" }),
    root,
  });
  assertEquals(readCoreUpdateCache(root) !== null, true);
  assertEquals(clearCoreUpdateCache(root), true);
  assertEquals(readCoreUpdateCache(root), null);
  assertEquals(clearCoreUpdateCache(root), false, "本来就没有，也算清干净了");
  await Deno.remove(root, { recursive: true });
});
