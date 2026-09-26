/**
 * 复现并钉住那个 bug：带 scope 的包不许用短名去匹配本机已装清单。
 *
 * 现场：本机装了 dsh-cost-meter；目录里同时有 dsh-cost-meter（Han-1413141）与
 * @steven-wu/dsh-cost-meter。旧逻辑用短名兜底，两个条目都变成「已装 ^1.7.37」，
 * 用户看到的就是「相同的插件显示两次」。
 */
import { assertEquals } from "@std/assert";
import { queryCatalog, type MarketCatalog } from "./market.ts";

const catalog: MarketCatalog = {
  generatedAt: "2026-09-26T00:00:00.000Z",
  categories: {},
  plugins: [
    {
      name: "dsh-cost-meter",
      npm: "dsh-cost-meter",
      owner: "Han-1413141",
      url: "https://github.com/Han-1413141/dsh-cost-meter",
      page: "",
      category: "用量与计费",
      stars: 195,
      downloads: 17152,
      install: "dsh plugin --profile web add dsh-cost-meter",
      added: "2026-08-14",
      description: { en: "", zh: "first" },
    },
    {
      name: "dsh-cost-meter",
      npm: "@steven-wu/dsh-cost-meter",
      owner: "steven-wu",
      url: "https://github.com/steven-wu/dsh-cost-meter",
      page: "",
      category: "用量与计费",
      stars: 3,
      downloads: 601,
      install: "dsh plugin --profile web add @steven-wu/dsh-cost-meter",
      added: "2026-08-14",
      description: { en: "", zh: "second" },
    },
  ],
} as unknown as MarketCatalog;

Deno.test("市场：带 scope 的同名包不许被认成本机已装的那个", () => {
  const page = queryCatalog(catalog, { page: 1, pageSize: 48, state: "all" }, {
    "dsh-cost-meter": "1.7.37",
  });
  const plain = page.items.find((i) => i.npm === "dsh-cost-meter")!;
  const scoped = page.items.find((i) => i.npm === "@steven-wu/dsh-cost-meter")!;
  assertEquals(plain.installed, true, "装了的那个必须标已装");
  assertEquals(plain.installedVersion, "1.7.37");
  assertEquals(scoped.installed, false, "没装的那个绝不能被短名兜底匹配成已装");
  assertEquals(scoped.installedVersion, null);
});

Deno.test("市场：筛选「未安装」时带 scope 的同名包要留在列表里", () => {
  const page = queryCatalog(catalog, { page: 1, pageSize: 48, state: "missing" }, {
    "dsh-cost-meter": "1.7.37",
  });
  assertEquals(page.items.map((i) => i.npm), ["@steven-wu/dsh-cost-meter"]);
});

Deno.test("市场：本机已装的包不许因为短名匹配而从「目录未收录」里消失", () => {
  const page = queryCatalog(catalog, { page: 1, pageSize: 48, state: "all" }, {
    "dsh-cost-meter": "1.7.37",
    "@steven-wu/dsh-cost-meter": "1.7.39",
  });
  const scoped = page.items.find((i) => i.npm === "@steven-wu/dsh-cost-meter")!;
  assertEquals(scoped.installed, true, "本机确实装了这个带 scope 的包");
  assertEquals(scoped.installedVersion, "1.7.39");
});
