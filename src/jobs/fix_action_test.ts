/**
 * 跨表校验：体检结论上的每一个 fixAction，都必须是**真实注册过**的动作。
 * 【P0-1 · 2026-09-25】
 *
 * 为什么值得单独一条：fixAction 是个纯字符串，写错一个字母（或动作改名后忘了同步）
 * 时界面会照常渲染按钮，点下去才在「生成计划」那一步报「未知动作」—— 属于最难查的一类问题。
 * 这里把源码里所有 fixAction 字面量扫出来，跟注册表对一遍。
 */
import { assertEquals } from "@std/assert";
import { engine } from "./engine.ts";
import { registerAllActions } from "./registry.ts";

/** 递归收集 src 下所有 .ts（跳过测试文件本身）。 */
async function collectSources(dir: URL): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) {
      out.push(...await collectSources(child));
    } else if (e.name.endsWith(".ts")) {
      out.push(await Deno.readTextFile(child));
    }
  }
  return out;
}

Deno.test("体检结论的 fixAction 必须都是已注册动作", async () => {
  registerAllActions();
  const known = new Set(engine.definitions().map((d) => d.name));
  const srcDir = new URL("../", import.meta.url);
  const files = await collectSources(srcDir);
  const refs = new Set<string>();
  for (const text of files) {
    for (const m of text.matchAll(/fixAction:\s*"([^"]+)"/g)) refs.add(m[1]!);
  }
  assertEquals(refs.size > 0, true, "一个 fixAction 都没扫到，说明匹配规则失效了");
  const missing = [...refs].filter((n) => !known.has(n));
  assertEquals(missing, [], `这些 fixAction 在注册表里不存在：${missing.join("、")}`);
  console.log(`fixAction 引用 ${refs.size} 个，全部命中注册表（共 ${known.size} 个动作）`);
});
