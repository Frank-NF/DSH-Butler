/**
 * 「目录没收录的已装插件」的回归测试。【2026-09-25 修】
 *
 * 事故：本机 15 个插件里 6 个不在市场目录里，而更新检查以前只查目录里能对上的名字，
 * 于是「可更新」永远显示 0，同时 DSH 官方市场显示「有 3 个可更新」。
 */
import { assertEquals } from "@std/assert";
import { LOCAL_CATEGORY, type MarketCatalog, queryCatalog } from "./market.ts";

const catalog: MarketCatalog = {
  name: "t",
  source: "",
  updated: "2026-08-25",
  fetchedAt: "2026-09-25T00:00:00.000Z",
  count: 1,
  categories: { ui: { en: "UI", zh: "界面" } },
  plugins: [{
    name: "dsh-market",
    owner: "o",
    url: "",
    page: "",
    category: "ui",
    npm: "dshmarket",
    stars: 10,
    downloads: 100,
    install: "",
    added: "",
    description: { en: "", zh: "市场" },
  }],
};

function q(state: "all" | "installed" | "missing" | "outdated") {
  return { q: "", category: "", sort: "downloads" as const, page: 1, pageSize: 48, state };
}

Deno.test("更新检测：目录没收录的已装插件也要被算进「可更新」", () => {
  const installed = { dshmarket: "^1.65.1", "dsh-sidebar-qa": "^1.0.0" };
  const updates = {
    dshmarket: { current: "1.65.1", latest: "1.65.1", outdated: false },
    "dsh-sidebar-qa": { current: "1.0.0", latest: "1.0.2", outdated: true },
  };
  const page = queryCatalog(catalog, q("all"), installed, updates);
  assertEquals(page.stats.installed, 2, "两个都装了，都要算进已装数");
  assertEquals(page.stats.outdated, 1, "目录没收录的那个有更新，必须算出来");

  const only = queryCatalog(catalog, q("outdated"), installed, updates);
  assertEquals(only.items.length, 1);
  assertEquals(only.items[0]!.npm, "dsh-sidebar-qa");
  assertEquals(only.items[0]!.category, LOCAL_CATEGORY);
  assertEquals(only.items[0]!.latestVersion, "1.0.2");
  assertEquals(only.items[0]!.installed, true);

  const cats = page.categories.find((c) => c.key === LOCAL_CATEGORY);
  assertEquals(cats?.label, "本机已装（目录未收录）");
});

Deno.test("更新检测：目录里能对上的插件不会被重复合成一条", () => {
  const installed = { dshmarket: "^1.65.1" };
  const page = queryCatalog(catalog, q("all"), installed, {
    dshmarket: { current: "1.65.1", latest: "1.66.0", outdated: true },
  });
  assertEquals(page.items.filter((i) => i.npm === "dshmarket").length, 1);
  assertEquals(page.stats.installed, 1);
  assertEquals(page.stats.outdated, 1);
  assertEquals(page.items.find((i) => i.npm === "dshmarket")!.category, "ui");
});
