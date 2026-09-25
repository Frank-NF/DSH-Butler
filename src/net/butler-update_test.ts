/**
 * 管家自身更新检查的测试（不联网、不碰真实用户目录）。
 */
import { assertEquals } from "@std/assert";

import {
  BUTLER_UPDATE_TTL_MS,
  checkButlerUpdate,
  parseRelease,
  readButlerUpdateCache,
} from "./butler-update.ts";

function feed(body: unknown, status = 200): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

Deno.test("parseRelease：缺 version 一律算无效（绝不因此误报更新）", () => {
  assertEquals(parseRelease(null), null);
  assertEquals(parseRelease({}), null);
  assertEquals(parseRelease({ version: "  " }), null);
  assertEquals(parseRelease({ version: "2.0.0" })?.version, "2.0.0");
  assertEquals(parseRelease({ version: "2.0.0", url: "https://x/y.exe" })?.url, "https://x/y.exe");
});

Deno.test("checkButlerUpdate：有新版本才 available，并写缓存", async () => {
  const root = await Deno.makeTempDir();
  const info = await checkButlerUpdate({
    current: "2.0.0-rc.1",
    fetcher: feed({
      version: "2.0.0-rc.2",
      url: "https://dsh.huilinsh.cn/x.exe",
      notes: "修了个 bug",
    }),
    root,
  });
  assertEquals(info.available, true);
  assertEquals(info.latest, "2.0.0-rc.2");
  assertEquals(info.release?.url, "https://dsh.huilinsh.cn/x.exe");
  assertEquals(readButlerUpdateCache(root)?.latest, "2.0.0-rc.2");
  await Deno.remove(root, { recursive: true });
});

Deno.test("checkButlerUpdate：同版本或更低都不提示", async () => {
  const root = await Deno.makeTempDir();
  assertEquals(
    (await checkButlerUpdate({ current: "2.0.0", fetcher: feed({ version: "2.0.0" }), root }))
      .available,
    false,
  );
  assertEquals(
    (await checkButlerUpdate({ current: "2.0.0", fetcher: feed({ version: "1.9.9" }), root }))
      .available,
    false,
  );
  await Deno.remove(root, { recursive: true });
});

Deno.test("checkButlerUpdate：缓存不过期不联网；清单写坏不误报", async () => {
  const root = await Deno.makeTempDir();
  await checkButlerUpdate({
    current: "2.0.0-rc.1",
    fetcher: feed({ version: "2.0.0-rc.2" }),
    root,
  });
  let calls = 0;
  const spy = (() => {
    calls++;
    return Promise.reject(new Error("不该被调用"));
  }) as unknown as typeof fetch;
  const cached = await checkButlerUpdate({ current: "2.0.0-rc.1", fetcher: spy, root });
  assertEquals(calls, 0);
  assertEquals(cached.latest, "2.0.0-rc.2");

  const bad = await Deno.makeTempDir();
  const broken = await checkButlerUpdate({
    current: "2.0.0-rc.1",
    fetcher: feed({ 不是: "version" }),
    root: bad,
  });
  assertEquals(broken.available, false);
  assertEquals(typeof broken.error, "string");
  await Deno.remove(root, { recursive: true });
  await Deno.remove(bad, { recursive: true });
});

Deno.test("checkButlerUpdate：断网时退回过期缓存并带上原因", async () => {
  const root = await Deno.makeTempDir();
  await checkButlerUpdate({
    current: "2.0.0-rc.1",
    fetcher: feed({ version: "2.0.0-rc.2" }),
    root,
  });
  const boom = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  const info = await checkButlerUpdate({
    current: "2.0.0-rc.1",
    fetcher: boom,
    root,
    force: true,
    now: () => Date.now() + BUTLER_UPDATE_TTL_MS * 2,
  });
  assertEquals(info.latest, "2.0.0-rc.2");
  assertEquals(info.error, "offline");
  await Deno.remove(root, { recursive: true });
});
