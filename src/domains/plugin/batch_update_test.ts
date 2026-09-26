/**
 * 批量更新的判定测试（P1-3）。
 *
 * 这里只测「挑谁更新」这个纯函数 —— 它是整条安全链的入口：挑错了要么白装一遍，
 * 要么漏掉真正该更新的插件（用户以为更新了，其实没动）。
 * 执行链本身（停服→装→体检→回退）靠真实机器验证，不用假 npm 假装。
 */
import { assertEquals } from "@std/assert";
import { pickTargets } from "./batch_update.ts";

const U = {
  "dsh-market": { current: "1.0.0", latest: "1.0.2", outdated: true },
  "dsh-sidenote": { current: "0.4.3", latest: "0.4.3", outdated: false },
  "@linxin666/dsh-client-ui-skill-explorer": { current: "0.3.23", latest: "0.4.2", outdated: true },
};

Deno.test("批量更新：只挑真有更新的，且按名字排序", () => {
  const t = pickTargets(U);
  assertEquals(t.length, 2, "已是最新的那个不许被挑进来");
  assertEquals(t.map((x) => x.name), ["@linxin666/dsh-client-ui-skill-explorer", "dsh-market"]);
  assertEquals(t[1], { name: "dsh-market", from: "1.0.0", to: "1.0.2" });
});

Deno.test("批量更新：指定名字时只挑指定的那几个", () => {
  const t = pickTargets(U, ["dsh-sidenote", "dsh-market"]);
  assertEquals(t.map((x) => x.name), ["dsh-market"], "指定了没更新的那个也不许塞进来");
  assertEquals(pickTargets(U, ["根本不存在的包"]), []);
});

Deno.test("批量更新：一个都没有时返回空（上层会拦下并说明）", () => {
  assertEquals(pickTargets({}), []);
  assertEquals(pickTargets({ a: { current: "1", latest: "1", outdated: false } }), []);
});
