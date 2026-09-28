/**
 * 「装上了却被跳过」的测试。
 *
 * 现场那句日志是从真机日志里原样抄来的（C:\Users\niufe\.dsh-butler\logs\dsh-server-*.err.log），
 * 所以这里的解析用例不是编的：它必须能认出现场那一行。
 * 全部走临时目录，不碰用户的 profile。
 */
import { assertEquals } from "@std/assert";

import {
  collectSkippedBundles,
  compatibilityFilePath,
  parseSkippedBundles,
  readExemptions,
  writeExemption,
} from "./skipped_bundles.ts";

const REAL_LINE =
  "dsh: skipping profile bundle \"@dhicoc/dsh-reverse-skill\": Error: Plugin @dhicoc/dsh-reverse-skill@1.0.5 is incompatible with dsh 0.1.7-rc.1: peerDependencies {\"@deepseek-ai/dsh-skill\":\"^0.0.1-rc.1\"}. Running it may cause crashes or data loss. Exact-version exemption: not active.";

Deno.test("parseSkippedBundles：认得出真机那条 skipping 行", () => {
  const items = parseSkippedBundles(REAL_LINE);
  assertEquals(items.length, 1);
  const it = items[0]!;
  assertEquals(it.name, "@dhicoc/dsh-reverse-skill");
  assertEquals(it.version, "1.0.5");
  assertEquals(it.key, "@dhicoc/dsh-reverse-skill@1.0.5");
  assertEquals(it.runtime, "0.1.7-rc.1");
  assertEquals(it.peers, '{"@deepseek-ai/dsh-skill":"^0.0.1-rc.1"}');
  assertEquals(it.exempted, false);
});

Deno.test("parseSkippedBundles：豁免表里有这个版本就标记已放行", () => {
  const items = parseSkippedBundles(REAL_LINE, {
    exemptions: { "@dhicoc/dsh-reverse-skill@1.0.5": ["0.1.7-rc.1"] },
  });
  assertEquals(items[0]!.exempted, true);
  // 放行的是别的运行时版本 → 不算
  const other = parseSkippedBundles(REAL_LINE, {
    exemptions: { "@dhicoc/dsh-reverse-skill@1.0.5": ["0.1.6"] },
  });
  assertEquals(other[0]!.exempted, false);
});

Deno.test("parseSkippedBundles：无关的行不认，重复只算一条", () => {
  const noise = [
    "some random log line",
    "dsh: bundling ui-chat",
    REAL_LINE,
    "   " + REAL_LINE,
  ].join("\n");
  assertEquals(parseSkippedBundles(noise).length, 1);
  assertEquals(parseSkippedBundles("nothing here").length, 0);
});

Deno.test("writeExemption：写的是 DSH 约定的 shape，可加可撤", async () => {
  const dir = await Deno.makeTempDir();
  const res = writeExemption("@dhicoc/dsh-reverse-skill@1.0.5", "0.1.7-rc.1", { profileDir: dir });
  assertEquals(res.changed, true);
  assertEquals(res.path, compatibilityFilePath(dir));
  assertEquals(readExemptions(dir), { "@dhicoc/dsh-reverse-skill@1.0.5": ["0.1.7-rc.1"] });
  // 再放行另一个运行时版本 → 累积，不覆盖
  writeExemption("@dhicoc/dsh-reverse-skill@1.0.5", "0.2.0-rc.1", { profileDir: dir });
  assertEquals(readExemptions(dir)["@dhicoc/dsh-reverse-skill@1.0.5"], ["0.1.7-rc.1", "0.2.0-rc.1"]);
  // 重复写同一个 → 不重复、不变
  const again = writeExemption("@dhicoc/dsh-reverse-skill@1.0.5", "0.1.7-rc.1", { profileDir: dir });
  assertEquals(again.changed, false);
  assertEquals(readExemptions(dir)["@dhicoc/dsh-reverse-skill@1.0.5"], ["0.1.7-rc.1", "0.2.0-rc.1"]);
  // 撤销一个运行时版本 → 剩下的还在
  writeExemption("@dhicoc/dsh-reverse-skill@1.0.5", "0.1.7-rc.1", { profileDir: dir, remove: true });
  assertEquals(readExemptions(dir), { "@dhicoc/dsh-reverse-skill@1.0.5": ["0.2.0-rc.1"] });
  // 撤空了 → 连键一起删
  writeExemption("@dhicoc/dsh-reverse-skill@1.0.5", "0.2.0-rc.1", { profileDir: dir, remove: true });
  assertEquals(readExemptions(dir), {});
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readExemptions：文件坏了/形状不对不崩，当空表", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(compatibilityFilePath(dir), "{ this is not json");
  assertEquals(readExemptions(dir), {});
  await Deno.writeTextFile(compatibilityFilePath(dir), JSON.stringify({ ok: ["1.0.0"], bad: "1.0.0" }));
  assertEquals(readExemptions(dir), { ok: ["1.0.0"] });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("collectSkippedBundles：从日志尾部捞出被跳过的插件", async () => {
  const logs = await Deno.makeTempDir();
  const profile = await Deno.makeTempDir();
  await Deno.writeTextFile(
    logs + "\\dsh-server-20260929-120000.err.log",
    "starting dsh\n" + REAL_LINE + "\n",
  );
  await Deno.writeTextFile(logs + "\\dsh-server-20260929-120000.out.log", "no problems here\n");
  await Deno.writeTextFile(logs + "\\butler-2026-09-29.log", REAL_LINE + "\n"); // 管家的日志不掺和
  const scan = collectSkippedBundles({ logsDir: logs, profileDir: profile });
  assertEquals(scan.items.length, 1);
  assertEquals(scan.items[0]!.key, "@dhicoc/dsh-reverse-skill@1.0.5");
  assertEquals(scan.items[0]!.exempted, false);
  assertEquals(scan.note.includes("1 个插件被 DSH 跳过"), true);
  assertEquals(scan.scanned.length, 2, "只扫 dsh-server-* 那两份");
  // 写了豁免后再扫 → 已放行
  writeExemption(scan.items[0]!.key, scan.items[0]!.runtime, { profileDir: profile });
  const after = collectSkippedBundles({ logsDir: logs, profileDir: profile });
  assertEquals(after.items[0]!.exempted, true);
  await Deno.remove(logs, { recursive: true });
  await Deno.remove(profile, { recursive: true });
});

Deno.test("collectSkippedBundles：没有日志时说人话，不假装扫过", async () => {
  const logs = await Deno.makeTempDir();
  const profile = await Deno.makeTempDir();
  const scan = collectSkippedBundles({ logsDir: logs, profileDir: profile });
  assertEquals(scan.items, []);
  assertEquals(scan.scanned, []);
  assertEquals(scan.note.includes("还没有 DSH 的启动输出"), true);
  const missing = collectSkippedBundles({ logsDir: logs + "\\nope", profileDir: profile });
  assertEquals(missing.items, []);
  await Deno.remove(logs, { recursive: true });
  await Deno.remove(profile, { recursive: true });
});
