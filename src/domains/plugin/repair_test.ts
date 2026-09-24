/**
 * plugin.repair 的行为测试（AC-P2 拦截契约的执行方）。
 *
 * rules_test 钉的是 repairBlockers 纯函数；这里钉【preflight/run 真的会调它
 * 并按 error 拒绝】这条行为链：
 *   - 健康可修 → 放行（零 error）；bundles 造洞 → bundled-but-undeclared 拦；
 *   - 不可作层目标 → repair-blocked 拦；run 内二次校验同样拦（绕过 preflight 也拦）；
 *   - 成功路径：补登记进生效名单 + .bak-updater 留痕 + 事务日志收尾；
 *   - 失败路径：无可修目标 / 被守卫拦下 → 回滚，绝不留半成品事务；
 *   - preflight 四类防呆 + nothing-to-repair 四种 cause 各归各位。
 *
 * 测试隔离七件套：六件套之外【必须设 DSH_WEB_DIR 指向带 apps/cli 的临时
 * fixture】—— resolveDshSourceRoot 的 env 优先级最高，不设它就回落到本机
 * 真实源码树（G:\DeepSeek_Harness），installRoot 判定被真机污染。
 */

import type { ActionContext } from "../../jobs/types.ts";
import type { Finding } from "../../util/result.ts";
import { isFile } from "../../host/fs.ts";
import { dirname, p } from "../../util/paths.ts";
import { stageSafetyProblems } from "../../jobs/registry.ts";
import { readPluginLists } from "../core/status.ts";
import {
  pluginRepairAction,
  profileManifestPath,
  readActiveTxn,
  REPAIR_STEPS,
} from "./mutate.ts";

// ── 极简断言 ────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack: string, needle: string, msg: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`断言失败：${msg}\n  期望包含 ${JSON.stringify(needle)}\n  实际 ${haystack}`);
  }
}

function fakeCtx(): ActionContext {
  return {
    jobId: "test-plugin-repair",
    signal: new AbortController().signal,
    step: () => {},
    detail: () => {},
    log: () => {},
    progress: () => {},
    onUndo: () => {},
    throwIfCancelled: () => {},
  };
}

// ── fixture ─────────────────────────────────────────────────────────

interface Fixture {
  root: string;
  profileDir: string;
  txnDir: string;
  rollbackDir: string;
  webDir: string;
}

/** 隔离七件套：三个存储进临时目录 + 跳过 npm/服务 + DSH_WEB_DIR 指向 fixture。 */
async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const root = Deno.makeTempDirSync();
  const f: Fixture = {
    root,
    profileDir: p(root, "profile"),
    txnDir: p(root, "txn"),
    rollbackDir: p(root, "rollback"),
    webDir: p(root, "dsh-src"),
  };
  // resolveDshSourceRoot 的判据 = apps/cli 是目录；没有它 env 不生效会回落真机
  Deno.mkdirSync(p(f.webDir, "apps", "cli"), { recursive: true });

  const prevs: Array<[string, string | undefined]> = [];
  const set = (k: string, v: string) => {
    prevs.push([k, Deno.env.get(k)]);
    Deno.env.set(k, v);
  };
  set("BUTLER_PROFILE_DIR", f.profileDir);
  set("BUTLER_TXN_DIR", f.txnDir);
  set("BUTLER_ROLLBACK_DIR", f.rollbackDir);
  set("BUTLER_SKIP_PM_OPS", "1");
  set("BUTLER_SKIP_SERVICE_OPS", "1");
  set("DSH_WEB_DIR", f.webDir);
  try {
    await fn(f);
  } finally {
    for (const [k, v] of prevs) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    try {
      Deno.removeSync(root, { recursive: true });
    } catch { /* 已删则忽略 */ }
  }
}

function writeFile(full: string, text: string): void {
  // 必须用 dirname 切父目录 —— p() 只拼分隔符不解析 ".."，
  // mkdirSync(recursive) 会把 "package.json" 这个文件名本身当目录建出来（os error 87）。
  Deno.mkdirSync(dirname(full), { recursive: true });
  Deno.writeTextFileSync(full, text);
}

/** 写 profile 清单：deps 与 bundles 完全自定（防呆/拦截场景各取所需）。 */
function writeProfile(f: Fixture, deps: Record<string, string>, bundles: string[]): void {
  writeFile(
    profileManifestPath(f.profileDir),
    JSON.stringify(
      {
        name: "fixture-profile",
        dependencies: deps,
        dsh: { profile: { bundles } },
      },
      null,
      2,
    ),
  );
}

/** 造包实体；layer=true 时带合法 dsh.bundle + patch 文件（可作层）。 */
function makeEntity(f: Fixture, name: string, layer: boolean): void {
  const dir = p(f.profileDir, "node_modules", ...name.split("/"));
  const pkg: Record<string, unknown> = { name, version: "1.0.0" };
  if (layer) pkg.dsh = { bundle: { patch: "./cordis.patch.yml" } };
  writeFile(p(dir, "package.json"), JSON.stringify(pkg));
  if (layer) writeFile(p(dir, "cordis.patch.yml"), "plugins: []\n");
}

async function preRepair(params: { name?: string }): Promise<Finding[]> {
  const fn = pluginRepairAction.preflight;
  if (!fn) throw new Error("plugin.repair 缺少 preflight");
  return await fn(params);
}

// ══ AC-P2 拦截契约（行为面） ════════════════════════════════════════

Deno.test("AC-P2：可修目标 + 守卫通过 —— preflight 零 error 放行", async () => {
  await withFixture(async (f) => {
    writeProfile(f, { "base-layer": "1.0.0", "@fixture/repairable": "1.0.0" }, ["base-layer"]);
    makeEntity(f, "base-layer", true);
    makeEntity(f, "@fixture/repairable", true);

    const out = await preRepair({});
    const errors = out.filter((x) => x.severity === "error");
    assertEq(
      errors.length,
      0,
      `健康可修场景不该有 error：${errors.map((x) => x.id).join("、") || "（无）"}`,
    );
  });
});

Deno.test("AC-P2：bundles 造洞（名单里的包解析不到）→ bundled-but-undeclared 拦下", async () => {
  await withFixture(async (f) => {
    writeProfile(f, { "base-layer": "1.0.0" }, ["base-layer", "ghost-bundle"]);
    makeEntity(f, "base-layer", true);

    const out = await preRepair({});
    const hit = out.find((x) => x.id === "plugin.bundled-but-undeclared");
    assert(hit, `应报 bundled-but-undeclared，实际：${out.map((x) => x.id).join("、") || "（空）"}`);
    assertEq(hit.severity, "error", "名单有洞必须是 error 级（preflight 才会拦截）");
  });
});

Deno.test("AC-P2：deps 里有不可作层目标 → repair-blocked 拦下（禁止盲目补登记）", async () => {
  await withFixture(async (f) => {
    writeProfile(f, { "base-layer": "1.0.0", "plain-pkg": "1.0.0" }, ["base-layer"]);
    makeEntity(f, "base-layer", true);
    makeEntity(f, "plain-pkg", false); // 实体在但没有 dsh.bundle → no-dsh-bundle

    const out = await preRepair({});
    const hit = out.find((x) => x.id === "plugin.repair-blocked");
    assert(hit, `应报 repair-blocked，实际：${out.map((x) => x.id).join("、") || "（空）"}`);
    assertEq(hit.severity, "error", "不可作层目标必须是 error 级（补登记会搞出启动问题）");
  });
});

// ══ 成功路径 ═══════════════════════════════════════════════════════

Deno.test("repair 成功：补登记进生效名单，.bak-updater 留痕，事务日志收尾", async () => {
  await withFixture(async (f) => {
    writeProfile(f, { "base-layer": "1.0.0", "@fixture/repairable": "1.0.0" }, ["base-layer"]);
    makeEntity(f, "base-layer", true);
    makeEntity(f, "@fixture/repairable", true);

    const rep = await pluginRepairAction.run(fakeCtx(), {});
    assertEq(rep.op, "repair", "报告 op");
    assert(
      rep.repaired.includes("@fixture/repairable"),
      `repaired 应含补登记目标，实际：${rep.repaired.join("、") || "（空）"}`,
    );
    assert(rep.rollbackId.length > 0, "应创建写前回滚点");
    assertEq(rep.serviceWasRunning, false, "隔离模式不该声称停过服务");

    const manifestPath = profileManifestPath(f.profileDir);
    const lists = readPluginLists(manifestPath, { installRoot: "", profileDir: f.profileDir });
    assert(lists?.bundles.includes("@fixture/repairable"), "生效名单应含补登记目标");
    assert(lists?.bundles.includes("base-layer"), "原有条目不许被弄丢");
    assert(lists?.active.includes("@fixture/repairable"), "active = 交集，应含目标");
    assert(readActiveTxn() === null, "提交后事务日志必须清");
    assert(isFile(`${manifestPath}.bak-updater`), "改清单前应留 .bak-updater 备份");
  });
});

// ══ 失败路径（run 内二次守卫 + 回滚） ═══════════════════════════════

Deno.test("repair run 内二次守卫：不可作层现场直接拒绝并回滚（绕过 preflight 也拦）", async () => {
  await withFixture(async (f) => {
    writeProfile(f, { "base-layer": "1.0.0", "plain-pkg": "1.0.0" }, ["base-layer"]);
    makeEntity(f, "base-layer", true);
    makeEntity(f, "plain-pkg", false);

    let msg = "";
    try {
      await pluginRepairAction.run(fakeCtx(), {});
    } catch (e) {
      msg = (e as Error).message;
    }
    assertIncludes(msg, "安全守卫", "run 必须拒绝被 AC-P2 拦下的现场");
    assertIncludes(msg, "已回滚到操作前状态", "报错必须声明已回滚（给用户的定心丸）");
    assert(readActiveTxn() === null, "回滚成功即收日志");
  });
});

Deno.test("repair run 无可修目标：拒绝执行并回滚，不留下半成品事务", async () => {
  await withFixture(async (f) => {
    writeProfile(f, { "base-layer": "1.0.0" }, ["base-layer"]);
    makeEntity(f, "base-layer", true);

    let msg = "";
    try {
      await pluginRepairAction.run(fakeCtx(), {});
    } catch (e) {
      msg = (e as Error).message;
    }
    assertIncludes(msg, "没有可修复的插件", "无可修目标必须明确拒绝");
    assertIncludes(msg, "已回滚到操作前状态", "拒绝后要回到操作前状态");
    assert(readActiveTxn() === null, "绝不留下半成品事务日志");
  });
});

// ══ preflight 防呆 ═════════════════════════════════════════════════

Deno.test("preflight 防呆：缺清单 / 事务未收尾 / 坏名 一律拦截", async () => {
  await withFixture(async (f) => {
    // ① 缺清单（临时把 profile 指到不存在的位置）
    const prev = Deno.env.get("BUTLER_PROFILE_DIR");
    Deno.env.set("BUTLER_PROFILE_DIR", p(f.root, "no-such-profile"));
    let none: Finding[] = [];
    try {
      none = await preRepair({ name: "whatever" });
    } finally {
      if (prev === undefined) Deno.env.delete("BUTLER_PROFILE_DIR");
      else Deno.env.set("BUTLER_PROFILE_DIR", prev);
    }
    assert(
      none.some((x) => x.id === "plugin.no-profile" && x.severity === "error"),
      "清单缺失必须拦截（没地方登记双名单）",
    );

    writeProfile(f, { "base-layer": "1.0.0" }, ["base-layer"]);
    makeEntity(f, "base-layer", true);

    // ② 上一个事务未收尾
    writeFile(p(f.txnDir, "active.json"), "{}");
    const txn = await preRepair({});
    assert(
      txn.some((x) => x.id === "plugin.txn-pending" && x.severity === "error"),
      "事务未收尾必须拦截（两个事务的现场会互相踩踏）",
    );
    Deno.removeSync(p(f.txnDir, "active.json"));

    // ③ 路径穿越式插件名
    const bad = await preRepair({ name: "../evil" });
    assert(
      bad.some((x) => x.id === "plugin.bad-name" && x.severity === "error"),
      "坏名必须拦截",
    );
  });
});

Deno.test("preflight nothing-to-repair：四种 cause 各归各位", async () => {
  await withFixture(async (f) => {
    // 底座：base-layer 双名单齐全（无可修目标）
    writeProfile(f, { "base-layer": "1.0.0" }, ["base-layer"]);
    makeEntity(f, "base-layer", true);

    // ④d 不带名字 —— 双名单当前无需修复
    const all = await preRepair({});
    const d = all.find((x) => x.id === "plugin.nothing-to-repair");
    assert(d, "无可修目标必须报 nothing-to-repair");
    assertIncludes(d.cause ?? "", "双名单当前无需修复", "cause 应解释双名单健康");

    // ④a 名字根本没装
    const a = await preRepair({ name: "ghost-pkg" });
    const af = a.find((x) => x.id === "plugin.nothing-to-repair");
    assert(af, "未安装的插件名应报 nothing-to-repair");
    assertIncludes(af.cause ?? "", "没装", "cause 应点明「没装」");

    // ④b 已在生效名单
    const b = await preRepair({ name: "base-layer" });
    const bf = b.find((x) => x.id === "plugin.nothing-to-repair");
    assert(bf, "已生效的插件应报 nothing-to-repair");
    assertIncludes(bf.cause ?? "", "已在生效名单里", "cause 应点明「已生效」");

    // ④c 声明了但包目录不存在（多半安装中断过）
    writeProfile(f, { "base-layer": "1.0.0", "declared-no-entity": "1.0.0" }, ["base-layer"]);
    const c = await preRepair({ name: "declared-no-entity" });
    const cf = c.find((x) => x.id === "plugin.nothing-to-repair");
    assert(cf, "缺实体的声明应报 nothing-to-repair");
    assertIncludes(cf.cause ?? "", "包目录不存在", "cause 应点明「要先重装」");
  });
});

// ══ 静态装备 ═══════════════════════════════════════════════════════

Deno.test("plugin.repair 装备：五步清单单一事实来源 + 写动作准入", () => {
  assertEq(REPAIR_STEPS.length, 5, "必须是五步");
  assertEq(pluginRepairAction.steps?.length, 5, "动作声明的步骤必须与清单一致");
  assertEq(pluginRepairAction.steps?.[0], REPAIR_STEPS[0], "动作步骤必须直接引用清单（单一事实来源）");
  assert(pluginRepairAction.steps?.[2]?.includes("补登记"), "第 3 步必须是补登记双名单");
  assert(pluginRepairAction.steps?.[4]?.includes("提交"), "第 5 步必须是提交事务并重启服务");
  assertEq(pluginRepairAction.readonly, false, "这是写动作");
  assert(typeof pluginRepairAction.preflight === "function", "写动作必须有 preflight（写前检查）");
  assert(
    (pluginRepairAction.timeoutMs ?? 0) >= 900_000,
    "修复的最坏预算不能低于 install 口径（900 秒）",
  );
  assertEq(stageSafetyProblems([pluginRepairAction as never]).length, 0, "阶段安全防呆必须零问题");
});
