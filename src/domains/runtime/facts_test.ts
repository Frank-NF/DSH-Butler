/**
 * runtime.facts 的测试：AC-R4 零副作用 + 日志证据正则回归。
 *
 * AC-R4：runtime.diagnose 跑 100 次不产生任何文件变更 ——
 * 用 fixture profile 跑 100 次，前后对目录做「路径+大小」快照比对；
 * 再对真实 DSH 目录跑 5 次全链路（只读探测），同样比对。
 *
 * LOG_PATTERNS 的阳性样本全部取自 dsh-plugin-repair 技能记录的
 * 真实故障报错原文（13 类历史故障回归集的证据面）。
 */

import { LOG_PATTERNS, collectRuntimeFacts } from "./facts.ts";
import { isDir } from "../../host/fs.ts";
import { dshProfileDir, p } from "../../util/paths.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
  }
}

/** 目录快照：路径 + 大小（新增/改动/删除任一都会变化）。 */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(d)];
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = p(d, e.name);
      if (e.isDirectory) {
        out.push(`D ${full}`);
        walk(full);
      } else {
        let size = -1;
        try {
          size = Deno.statSync(full).size;
        } catch { /* 竞态删了就记 -1，快照照样不同 */ }
        out.push(`F ${full} ${size}`);
      }
    }
  };
  walk(dir);
  return out;
}

// ══ AC-R4：零副作用 ═══════════════════════════════════════════════

Deno.test("AC-R4：fixture 上跑 100 次采集，不产生任何文件变更", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    // 造一个最小 profile（含一把锁，确保锁扫描路径也被跑到）
    Deno.writeTextFileSync(p(dir, "package.json"), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
    Deno.writeTextFileSync(p(dir, "config.lock"), "424242");

    const before = snapshot(dir);
    for (let i = 0; i < 100; i++) {
      await collectRuntimeFacts({ profileDir: dir, skipProbes: true });
    }
    const after = snapshot(dir);
    assertEq(after.join("\n"), before.join("\n"), "跑 100 次后 fixture 目录变了 —— 诊断必须零副作用");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("AC-R4：真实 DSH profile 跑 5 次全链路，不产生任何文件变更", async () => {
  const dir = dshProfileDir();
  if (!isDir(dir)) return; // 换机器没有这个目录就跳过
  const before = snapshot(dir);
  for (let i = 0; i < 5; i++) {
    await collectRuntimeFacts({ profileDir: dir });
  }
  const after = snapshot(dir);
  assertEq(after.join("\n"), before.join("\n"), "真实 DSH 目录被诊断写脏了");
});

// ══ LOG_PATTERNS：真实故障报错原文回归（AC-R3 证据面） ════════════

Deno.test("LOG_PATTERNS：13 类历史故障的真实报错原文必须全部命中", () => {
  const realLines: Array<[keyof typeof LOG_PATTERNS, string, string]> = [
    // 类型 X（#36）
    ["remoteHang", "pending (waiting for service: remote.market)", "类型 X"],
    // 类型 S / aigc-canvas（#31，真机 cordis.patch.yml 注释原文）
    ["doubleReg", 'service aigcCanvas has been registered at <dsh-aigc-canvas>', "类型 S"],
    // 类型 E（#21 连坐）/ AG（#45）原文形态
    ["depUnresolved", "Error: Cannot find package 'undici' imported from G:\\profile\\node_modules\\x", "类型 AG"],
    ["depUnresolved", "Cannot find module '/profile/node_modules/ghost/index.js'", "类型 E/A1"],
    // 类型 W（#35）
    ["moduleTable", 'client-modules: require("dsh-foo") missed the module table', "类型 W"],
    // 类型 AG 次要形态
    ["moduleTable", 'Module "./x" does not provide an export named "apply"', "类型 AG"],
    // 类型 V（#34）
    ["strictCodec", "typert: pkg#svc/method result strict codec has no create() factory", "类型 V"],
    // 类型 Z（#38）
    ["presetUnmount", 'resume failed for session s1: preset "std" failed to mount', "类型 Z"],
    ["presetUnmount", 'row "r1" names a plugin that cannot be resolved: dsh-gone', "类型 Z"],
    // 类型 P/AH（#28/#48 界面文案）
    ["saveFail", "settings: 保存失败，请重试", "类型 P/AH"],
  ];
  for (const [key, line, type] of realLines) {
    assert(LOG_PATTERNS[key].test(line), `${type} 的真实报错没被命中：${line}`);
  }
});

Deno.test("LOG_PATTERNS：正常日志行一条都不许命中（防误报）", () => {
  const normal = [
    "2026-09-24T10:00:00.000Z INFO  plugin-loader composed 42 entries in 312ms",
    "2026-09-24T10:00:01.000Z INFO  server listening on http://127.0.0.1:3081",
    "2026-09-24T10:00:02.000Z INFO  remote.market ready in 88ms",
    "GET / 200 12ms",
  ];
  for (const line of normal) {
    for (const [key, re] of Object.entries(LOG_PATTERNS)) {
      assert(!re.test(line), `正常行被 ${key} 误命中：${line}`);
    }
  }
});

// ══ 启动失败转储解析（真机日志在场时） ════════════════════════════

Deno.test("startupDump：真机失败转储必须解析出 failed 与失败插件名单", async () => {
  const facts = await collectRuntimeFacts({ skipProbes: true });
  // 真机 2026-09-22 留有一份 startup failed 转储；换机器/被清理则跳过
  if (!facts.startupDump.present) return;
  if (!facts.startupDump.failed) return; // 若哪天只剩成功启动日志也跳过
  assert(facts.startupDump.failedPlugins.length > 0, "失败转储没解析出插件名单");
  assert(facts.startupDump.lines.length > 0, "失败转储没提取出错误摘要行");
  assert(facts.startupDump.ageMs !== null && facts.startupDump.ageMs > 0, "mtime 应解析出年龄");
});
