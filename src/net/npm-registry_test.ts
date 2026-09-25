/**
 * 版本比较与"查更新"的测试：不联网（fetch 全部注入假实现）。
 */
import { assertEquals } from "@std/assert";

import {
  checkUpdates,
  clearUpdateCache,
  compareSemver,
  fetchLatestVersion,
  isOutdated,
  parseSemver,
} from "./npm-registry.ts";

function fakeFetch(map: Record<string, string | number>): typeof fetch {
  return ((url: string) => {
    const key = String(url);
    for (const [k, v] of Object.entries(map)) {
      if (key.includes(k)) {
        if (typeof v === "number") {
          return Promise.resolve(new Response("", { status: v }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ version: v }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
    }
    return Promise.reject(new Error("not found"));
  }) as unknown as typeof fetch;
}

Deno.test("parseSemver：各种写法的版本串", () => {
  assertEquals(parseSemver("^1.2.3"), "1.2.3");
  assertEquals(parseSemver("~1.2"), "1.2.0");
  assertEquals(parseSemver("1"), "1.0.0");
  assertEquals(parseSemver("  2.0.1  "), "2.0.1");
  assertEquals(parseSemver("1.2.3-beta.1"), "1.2.3-beta.1");
  assertEquals(parseSemver("file:../local-plugin"), null, "本地路径没法比版本");
  assertEquals(parseSemver("workspace:*"), null);
  assertEquals(parseSemver("link:./x"), null);
  assertEquals(parseSemver(""), null);
  assertEquals(parseSemver(undefined), null);
});

Deno.test("compareSemver：数值比较与预发布", () => {
  assertEquals(compareSemver("1.2.3", "1.2.3"), 0);
  assertEquals(compareSemver("1.2.4", "1.2.3"), 1);
  assertEquals(compareSemver("1.3.0", "1.2.9"), 1);
  assertEquals(compareSemver("2.0.0", "1.9.9"), 1);
  assertEquals(compareSemver("1.2.3", "1.2.4"), -1);
  assertEquals(compareSemver("1.2.3", "1.2.3-beta.1"), 1, "正式版大于预发布");
  assertEquals(compareSemver("1.2.3-beta.1", "1.2.3"), -1);
  assertEquals(compareSemver("1.2", "1.2.0"), 0);
});

Deno.test("isOutdated：解析不出来就不提示（宁少不误报）", () => {
  assertEquals(isOutdated("1.0.0", "1.0.1"), true);
  assertEquals(isOutdated("1.0.1", "1.0.1"), false);
  assertEquals(isOutdated("2.0.0", "1.9.0"), false);
  assertEquals(isOutdated(null, "1.0.0"), false);
  assertEquals(isOutdated("1.0.0", null), false);
});

Deno.test("fetchLatestVersion：命中缓存后不再请求", async () => {
  clearUpdateCache();
  let calls = 0;
  const f = ((url: string) => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }));
  }) as unknown as typeof fetch;
  assertEquals(await fetchLatestVersion("dsh-x", f), "9.9.9");
  assertEquals(await fetchLatestVersion("dsh-x", f), "9.9.9");
  assertEquals(calls, 1, "第二次应该走缓存");
});

Deno.test("fetchLatestVersion：404 与网络错都返回 null，且不写缓存", async () => {
  clearUpdateCache();
  assertEquals(await fetchLatestVersion("dsh-missing", fakeFetch({ "dsh-missing": 404 })), null);
  const boom = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  assertEquals(await fetchLatestVersion("dsh-boom", boom), null);
  // 失败后应还能重试（缓存里没有 null 记录）
  assertEquals(await fetchLatestVersion("dsh-boom", fakeFetch({ "dsh-boom": "1.0.0" })), "1.0.0");
});

Deno.test("checkUpdates：只查装了且在市场里的包，标注可更新", async () => {
  clearUpdateCache();
  const installed = { "dsh-a": "^1.0.0", "dsh-b": "2.0.0", "dsh-c": "file:../local" };
  const f = fakeFetch({ "dsh-a": "1.2.0", "dsh-b": "2.0.0", "dsh-c": "9.9.9" });
  // 市场里只有 a 和 b
  const r = await checkUpdates(installed, ["dsh-a", "dsh-b"], f);
  assertEquals(r.checked, 2);
  assertEquals(r.updates["dsh-a"], { current: "1.0.0", latest: "1.2.0", outdated: true });
  assertEquals(r.updates["dsh-b"], { current: "2.0.0", latest: "2.0.0", outdated: false });
  assertEquals(r.updates["dsh-c"], undefined, "没在市场里的不查");
});

Deno.test("checkUpdates：查不到的包记进 failed，不影响其它包", async () => {
  clearUpdateCache();
  const installed = { "dsh-ok": "1.0.0", "dsh-bad": "1.0.0" };
  const f = fakeFetch({ "dsh-ok": "1.1.0", "dsh-bad": 500 });
  const r = await checkUpdates(installed, ["dsh-ok", "dsh-bad"], f);
  assertEquals(r.failed, ["dsh-bad"]);
  assertEquals(r.updates["dsh-ok"]!.outdated, true);
});
