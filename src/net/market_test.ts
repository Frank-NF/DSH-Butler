/**
 * 插件市场模块的测试：目录规整、搜索/筛选/排序/分页、缓存读写与降级。
 *
 * 这些逻辑全在纯函数里，测试不碰网络也不碰真实用户目录。
 */
import { assertEquals } from "@std/assert";

import {
  CATALOG_TTL_MS,
  loadCatalog,
  normalizeCatalog,
  queryCatalog,
  readCache,
  writeCache,
} from "./market.ts";

const RAW = {
  name: "awesome-dsh-plugin",
  source: "https://github.com/x/y",
  updated: "2026-08-25",
  count: 3,
  categories: {
    ui: { en: "UI Enhancements", zh: "界面增强" },
    tools: { en: "Tools", zh: "工具与能力" },
  },
  plugins: [
    {
      name: "dsh-b",
      owner: "bob",
      category: "ui",
      npm: "dsh-b",
      stars: 5,
      downloads: 100,
      added: "2026-08-01",
      install: "dsh plugin --profile web add dsh-b",
      description: { en: "Bee", zh: "蜜蜂插件" },
    },
    {
      name: "dsh-a",
      owner: "alice",
      category: "tools",
      npm: "@scope/dsh-a",
      stars: 50,
      downloads: 10,
      added: "2026-08-20",
      description: { en: "Aye", zh: "甲插件" },
    },
    { name: "", npm: "broken" },
    {
      name: "dsh-c",
      owner: "carol",
      category: "ui",
      npm: "dsh-c",
      stars: 50,
      downloads: 900,
      added: "2026-07-01",
      description: { zh: "丙插件 关键词" },
    },
  ],
};

Deno.test("normalizeCatalog：缺字段补空、脏条目丢弃、分类中英名保留", () => {
  const cat = normalizeCatalog(RAW, "2026-09-25T00:00:00.000Z");
  assertEquals(cat.plugins.length, 3, "没有名字的条目应该被丢掉");
  assertEquals(cat.count, 3);
  assertEquals(cat.categories.ui?.zh, "界面增强");
  const a = cat.plugins.find((x) => x.name === "dsh-a")!;
  assertEquals(a.npm, "@scope/dsh-a");
  assertEquals(a.stars, 50);
  assertEquals(a.description.zh, "甲插件");
  // 上游没给 npm 时退回用 name
  assertEquals(cat.plugins.find((x) => x.name === "dsh-b")!.npm, "dsh-b");
});

Deno.test("normalizeCatalog：整份 JSON 烂掉也不抛，返回空目录", () => {
  const cat = normalizeCatalog(null, "2026-09-25T00:00:00.000Z");
  assertEquals(cat.plugins.length, 0);
  assertEquals(cat.categories, {});
});

Deno.test("queryCatalog：默认按下载量排、分页正确", () => {
  const cat = normalizeCatalog(RAW, "x");
  const p = queryCatalog(cat, { pageSize: 2 });
  assertEquals(p.total, 3);
  assertEquals(p.pages, 2);
  assertEquals(p.items.map((i) => i.name), ["dsh-c", "dsh-b"], "默认按下载量降序");
  const p2 = queryCatalog(cat, { pageSize: 2, page: 2 });
  assertEquals(p2.items.map((i) => i.name), ["dsh-a"]);
});

Deno.test("queryCatalog：搜索命中中文描述、多词是 AND", () => {
  const cat = normalizeCatalog(RAW, "x");
  assertEquals(queryCatalog(cat, { q: "丙" }).items.map((i) => i.name), ["dsh-c"]);
  assertEquals(queryCatalog(cat, { q: "插件 关键词" }).items.map((i) => i.name), ["dsh-c"]);
  assertEquals(queryCatalog(cat, { q: "插件 不存在" }).items.length, 0);
  assertEquals(
    queryCatalog(cat, { q: "ALICE" }).items.map((i) => i.name),
    ["dsh-a"],
    "搜索不区分大小写",
  );
});

Deno.test("queryCatalog：分类筛选 + 分类计数基于全量", () => {
  const cat = normalizeCatalog(RAW, "x");
  const p = queryCatalog(cat, { category: "ui" });
  assertEquals(p.items.map((i) => i.name).sort(), ["dsh-b", "dsh-c"]);
  const ui = p.categories.find((c) => c.key === "ui")!;
  assertEquals(ui.count, 2, "分类计数不受当前筛选影响");
  assertEquals(ui.label, "界面增强");
});

Deno.test("queryCatalog：已安装/未安装筛选与安装状态标注", () => {
  const cat = normalizeCatalog(RAW, "x");
  const installed = { "dsh-b": "1.2.3", "@scope/dsh-a": "0.9.0" };
  const all = queryCatalog(cat, {}, installed);
  assertEquals(all.stats.installed, 2);
  assertEquals(all.items.find((i) => i.name === "dsh-b")!.installedVersion, "1.2.3");
  assertEquals(all.items.find((i) => i.name === "dsh-c")!.installed, false);
  assertEquals(queryCatalog(cat, { state: "installed" }, installed).items.length, 2);
  assertEquals(queryCatalog(cat, { state: "missing" }, installed).items.map((i) => i.name), [
    "dsh-c",
  ]);
});

Deno.test("queryCatalog：排序可选 star / 新增 / 名字", () => {
  const cat = normalizeCatalog(RAW, "x");
  assertEquals(queryCatalog(cat, { sort: "stars" }).items[0]!.name, "dsh-a", "star 并列时按名字");
  assertEquals(queryCatalog(cat, { sort: "new" }).items[0]!.name, "dsh-a");
  assertEquals(queryCatalog(cat, { sort: "name" }).items.map((i) => i.name), [
    "dsh-a",
    "dsh-b",
    "dsh-c",
  ]);
});

Deno.test("queryCatalog：页码越界会被夹回有效范围", () => {
  const cat = normalizeCatalog(RAW, "x");
  assertEquals(queryCatalog(cat, { page: 99, pageSize: 2 }).page, 2);
  assertEquals(queryCatalog(cat, { page: 0 }).page, 1);
});

Deno.test("缓存：写进去读出来一致，坏文件当没有", async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/market-catalog.json`;
  const cat = normalizeCatalog(RAW, "2026-09-25T00:00:00.000Z");
  writeCache(file, cat);
  const back = readCache(file);
  assertEquals(back?.plugins.length, 3);
  assertEquals(back?.fetchedAt, "2026-09-25T00:00:00.000Z");
  await Deno.writeTextFile(file, "{ 不是 JSON");
  assertEquals(readCache(file), null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadCatalog：联网失败时退回缓存并说明这是旧数据", async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/market-catalog.json`;
  writeCache(file, normalizeCatalog(RAW, new Date(Date.now() - CATALOG_TTL_MS * 2).toISOString()));
  const boom = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  const r = await loadCatalog({ cachePath: file, fetcher: boom });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.cached, true);
    assertEquals(r.catalog.plugins.length, 3);
    assertEquals(typeof r.note, "string");
  }
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadCatalog：没有缓存又连不上，返回人话错误", async () => {
  const dir = await Deno.makeTempDir();
  const boom = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  const r = await loadCatalog({ cachePath: `${dir}/none.json`, fetcher: boom });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.includes("offline"), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadCatalog：缓存没过期就不联网", async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/market-catalog.json`;
  writeCache(file, normalizeCatalog(RAW, new Date().toISOString()));
  let called = 0;
  const spy = (() => {
    called++;
    return Promise.reject(new Error("不该被调用"));
  }) as unknown as typeof fetch;
  const r = await loadCatalog({ cachePath: file, fetcher: spy });
  assertEquals(r.ok, true);
  assertEquals(called, 0);
  if (r.ok) assertEquals(r.cached, true);
  await Deno.remove(dir, { recursive: true });
});
