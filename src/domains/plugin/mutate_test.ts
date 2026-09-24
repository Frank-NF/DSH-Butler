/**
 * plugin.mutate 的事务语义测试（AC-P3）。
 *
 * AC-P3：「卸载任一插件过程中强制杀进程，重启后 plugin.scan 结果与操作前一致
 * （无半成品态）。」—— 主线测试用「构造半成品现场（清单已摘 + 目录已移 + 日志未收）
 * → recoverPluginTxn() → scan 快照逐字段比对」字面覆盖这条验收。
 *
 * 另覆盖：安装成功双名单同步 / 不可作层只进依赖清单 / 卸载成功进隔离区 /
 * 包管理器失败自动回滚 / 损坏日志拒绝瞎恢复 / 四条 preflight 防呆。
 *
 * 测试隔离六件套（生产环境一律不设）：
 *   BUTLER_PROFILE_DIR + BUTLER_TXN_DIR + BUTLER_ROLLBACK_DIR（三个存储全进临时目录）
 *   + BUTLER_SKIP_PM_OPS=1（不调 npm，实体由 fixture 预置）
 *   + BUTLER_SKIP_SERVICE_OPS=1（不碰真机 DSH 进程）
 *   + BUTLER_PM_FAIL=1（仅失败回滚用例临时开启）
 * 绝不碰真实 ~/.dsh/profiles 与真实回滚存储（方案 §10.3）。
 */

import type { ActionContext } from "../../jobs/types.ts";
import type { Finding } from "../../util/result.ts";
import { isDir, isFile, moveSafe, pathExists } from "../../host/fs.ts";
import { dirname, p } from "../../util/paths.ts";
import { createRollbackPoint } from "../backup/rollback.ts";
import { readPluginLists } from "../core/status.ts";
import {
  beginTxn,
  collectScanReport,
  pluginInstallAction,
  type PluginScanReport,
  type PluginTxnJournal,
  pluginUninstallAction,
  profileManifestPath,
  readActiveTxn,
  recoverPluginTxn,
  unregisterFromProfile,
} from "./mutate.ts";

// ── 极简断言 ────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`,
    );
  }
}

function assertIncludes(haystack: string, needle: string, msg: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`断言失败：${msg}\n  期望包含 ${JSON.stringify(needle)}\n  实际 ${haystack}`);
  }
}

function fakeCtx(): ActionContext {
  return {
    jobId: "test-plugin-mutate",
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
}

/** 六件套隔离：三个存储进临时目录 + 跳过 npm / 服务，跑完逐一还原 env。 */
async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const root = Deno.makeTempDirSync();
  const f: Fixture = {
    root,
    profileDir: p(root, "profile"),
    txnDir: p(root, "txn"),
    rollbackDir: p(root, "rollback"),
  };
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

/** 造 profile：一个合法层包 base-layer + 双名单两份都含它（操作前状态）。 */
function makeProfile(f: Fixture): void {
  const layerDir = p(f.profileDir, "node_modules", "base-layer");
  writeFile(
    p(layerDir, "package.json"),
    JSON.stringify({
      name: "base-layer",
      version: "1.0.0",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }),
  );
  writeFile(p(layerDir, "cordis.patch.yml"), "plugins: []\n");
  writeFile(
    profileManifestPath(f.profileDir),
    JSON.stringify(
      {
        name: "fixture-profile",
        dependencies: { "base-layer": "1.0.0" },
        dsh: { profile: { bundles: ["base-layer"] } },
      },
      null,
      2,
    ),
  );
}

/** 预置一个待安装包的实体（skip-pm 模式下 npm 不跑，实体必须已在 node_modules）。 */
function makeInstallTarget(f: Fixture, name: string, layer: boolean): void {
  const dir = p(f.profileDir, "node_modules", ...name.split("/"));
  const pkg: Record<string, unknown> = { name, version: "2.0.0" };
  if (layer) pkg.dsh = { bundle: { patch: "./cordis.patch.yml" } };
  writeFile(p(dir, "package.json"), JSON.stringify(pkg));
  if (layer) writeFile(p(dir, "cordis.patch.yml"), "plugins: []\n");
}

/** scan 快照（去掉 checkedAt 时间戳后全量比较 —— AC-P3 的「结果一致」口径）。 */
function snap(r: PluginScanReport): string {
  return JSON.stringify({
    manifestExists: r.manifestExists,
    lists: r.lists,
    summary: r.summary,
    layers: r.layers,
    inactiveLayers: r.inactiveLayers,
    entities: r.entities,
  });
}

async function scanOf(f: Fixture): Promise<string> {
  // installRoot: null —— 不探测真机安装锚点，fixture 自包含
  return snap(await collectScanReport({ profileDir: f.profileDir, installRoot: null }));
}

async function preInstall(params: { name: string; version?: string }): Promise<Finding[]> {
  const fn = pluginInstallAction.preflight;
  if (!fn) throw new Error("plugin.install 缺少 preflight");
  return await fn(params);
}

async function preUninstall(params: { name: string }): Promise<Finding[]> {
  const fn = pluginUninstallAction.preflight;
  if (!fn) throw new Error("plugin.uninstall 缺少 preflight");
  return await fn(params);
}

// ══ AC-P3 主线 ════════════════════════════════════════════════════

Deno.test("AC-P3：卸载中途被杀（半成品现场），恢复后 plugin.scan 与操作前逐字段一致", async () => {
  await withFixture(async (f) => {
    makeProfile(f);
    const before = await scanOf(f);

    // ── 构造「卸载 base-layer 走到一半被强杀」的现场 ──
    // 已完成：回滚点落盘 + 事务日志写入 + 清单已摘 + 目录已移入隔离区
    // 未完成：提交（删日志）—— active.json 留在盘上 = 被杀的标记
    const manifestPath = profileManifestPath(f.profileDir);
    const pt = await createRollbackPoint({
      kind: "plugin-set",
      trigger: "test：卸载中途被杀",
      artifacts: [{ path: manifestPath, mode: "copy" }],
      reverse: { op: "restore-files" },
    });
    const originalDir = p(f.profileDir, "node_modules", "base-layer");
    const quarantinedDir = p(f.txnDir, "quarantine", "20260101-000000", "base-layer");
    const journal: PluginTxnJournal = {
      kind: "plugin-txn",
      version: 1,
      op: "uninstall",
      name: "base-layer",
      profileDir: f.profileDir,
      rollbackPointId: pt.id,
      quarantinedDir,
      originalDir,
      startedAt: new Date().toISOString(),
    };
    beginTxn(journal);
    unregisterFromProfile(manifestPath, "base-layer");
    const mv = moveSafe(originalDir, quarantinedDir);
    assert(mv.ok, `fixture 准备失败：${mv.error ?? ""}`);

    // 半成品态自证：清单已空、目录已不在原位、日志还在（三者缺一，这个测试就白测了）
    const mid = readPluginLists(manifestPath, { installRoot: "", profileDir: f.profileDir });
    assert(!mid?.dependencies.includes("base-layer"), "半成品态自证：依赖应已摘");
    assert(!mid?.bundles.includes("base-layer"), "半成品态自证：生效名单应已摘");
    assert(!pathExists(originalDir), "半成品态自证：目录应已移走");
    assert(readActiveTxn() !== null, "半成品态自证：事务日志必须还在");

    // ── 「重启」：启动恢复 ──
    const rec = await recoverPluginTxn();
    assert(rec.recovered, "应识别到未收尾事务并完成恢复");
    assertEq(rec.op, "uninstall", "恢复报告应记录 op");
    assertEq(rec.name, "base-layer", "恢复报告应记录 name");

    const after = await scanOf(f);
    assertEq(after, before, "AC-P3：恢复后 plugin.scan 结果必须与操作前一致");
    assert(readActiveTxn() === null, "恢复后事务日志必须清掉");
    assert(isDir(originalDir), "插件目录必须移回原位");
    assert(!pathExists(quarantinedDir), "隔离区落点应已搬空");
  });
});

Deno.test("AC-P3：安装中途被杀（清单已写、未提交），恢复后回到安装前", async () => {
  await withFixture(async (f) => {
    makeProfile(f);
    makeInstallTarget(f, "@fixture/kill-pkg", true);
    const before = await scanOf(f);

    // 现场：回滚点 + 日志 + 依赖清单已写入新包 —— 但没进生效名单、没提交
    const manifestPath = profileManifestPath(f.profileDir);
    const pt = await createRollbackPoint({
      kind: "plugin-set",
      trigger: "test：安装中途被杀",
      artifacts: [{ path: manifestPath, mode: "copy" }],
      reverse: { op: "restore-files" },
    });
    Deno.writeTextFileSync(
      manifestPath,
      JSON.stringify(
        {
          name: "fixture-profile",
          dependencies: { "base-layer": "1.0.0", "@fixture/kill-pkg": "2.0.0" },
          dsh: { profile: { bundles: ["base-layer"] } },
        },
        null,
        2,
      ),
    );
    beginTxn({
      kind: "plugin-txn",
      version: 1,
      op: "install",
      name: "@fixture/kill-pkg",
      profileDir: f.profileDir,
      rollbackPointId: pt.id,
      quarantinedDir: "",
      originalDir: p(f.profileDir, "node_modules", "@fixture", "kill-pkg"),
      startedAt: new Date().toISOString(),
    });
    const mid = readPluginLists(manifestPath, { installRoot: "", profileDir: f.profileDir });
    assert(mid?.dependencies.includes("@fixture/kill-pkg"), "半成品态自证：依赖应已写入");

    const rec = await recoverPluginTxn();
    assert(rec.recovered, "应恢复");
    const after = await scanOf(f);
    assertEq(after, before, "恢复后必须回到安装前状态（清单不含半写入的包）");
    assert(readActiveTxn() === null, "日志应清");
    // 实体不删（install 的回滚只还原清单；npm 下次安装会重算）——快照只含依赖项，不受影响
    assert(
      isDir(p(f.profileDir, "node_modules", "@fixture", "kill-pkg")),
      "预置实体保留（回滚不碰目录）",
    );
  });
});

// ══ 安装成功路径 ══════════════════════════════════════════════════

Deno.test("install 成功：双名单同步登记，可作层进生效名单", async () => {
  await withFixture(async (f) => {
    makeProfile(f);
    makeInstallTarget(f, "@fixture/layer-pkg", true);

    const rep = await pluginInstallAction.run(fakeCtx(), {
      name: "@fixture/layer-pkg",
      version: "2.0.0",
    });
    assertEq(rep.activated, true, "可作层的包必须激活");
    assert(rep.rollbackId.length > 0, "应创建写前回滚点");

    const manifestPath = profileManifestPath(f.profileDir);
    const lists = readPluginLists(manifestPath, { installRoot: "", profileDir: f.profileDir });
    assert(lists?.dependencies.includes("@fixture/layer-pkg"), "依赖清单应含新包");
    assert(lists?.bundles.includes("@fixture/layer-pkg"), "生效名单应含新包（过守卫）");
    assert(lists?.active.includes("@fixture/layer-pkg"), "active = 交集，应含新包");
    assert(readActiveTxn() === null, "提交后事务日志必须清");
    assert(isFile(`${manifestPath}.bak-updater`), "改清单前应留 .bak-updater 备份");
  });
});

Deno.test("install 不可作层的包：进依赖清单但不进生效名单（合法状态，不算失败）", async () => {
  await withFixture(async (f) => {
    makeProfile(f);
    makeInstallTarget(f, "plain-pkg", false); // 没有 dsh.bundle → no-dsh-bundle

    const rep = await pluginInstallAction.run(fakeCtx(), { name: "plain-pkg", version: "1.0.0" });
    assertEq(rep.activated, false, "不可作层不应激活");

    const lists = readPluginLists(profileManifestPath(f.profileDir), {
      installRoot: "",
      profileDir: f.profileDir,
    });
    assert(lists?.dependencies.includes("plain-pkg"), "依赖清单仍要登记（装了）");
    assert(!lists?.bundles.includes("plain-pkg"), "生效名单绝不能登记（守卫）");
    assert(lists?.declaredButInactive.includes("plain-pkg"), "应呈现为「装了不生效」");
    assert(readActiveTxn() === null, "成功即提交");
  });
});

// ══ 卸载成功路径 ══════════════════════════════════════════════════

Deno.test("uninstall 成功：双名单移除 + 目录进隔离区（不删除，可找回）+ 日志清", async () => {
  await withFixture(async (f) => {
    makeProfile(f);
    const manifestPath = profileManifestPath(f.profileDir);

    const rep = await pluginUninstallAction.run(fakeCtx(), { name: "base-layer" });
    assertEq(rep.op, "uninstall", "报告 op");
    assert(rep.rollbackId.length > 0, "应创建写前回滚点");

    const lists = readPluginLists(manifestPath, { installRoot: "", profileDir: f.profileDir });
    assert(!lists?.dependencies.includes("base-layer"), "依赖清单应摘除");
    assert(!lists?.bundles.includes("base-layer"), "生效名单应摘除（防「启动即崩」）");

    const q = rep.quarantineDir;
    assert(q !== null, "目录应进隔离区");
    assert(isDir(q), "隔离区实体必须还在（只移动、不删除）");
    assert(isFile(p(q, "package.json")), "隔离区里是完整的包目录");
    assert(!pathExists(p(f.profileDir, "node_modules", "base-layer")), "原位目录应已移走");
    assert(readActiveTxn() === null, "提交后日志必须清");
    assert(isFile(`${manifestPath}.bak-updater`), "改清单前应留 .bak-updater 备份");
  });
});

// ══ 失败回滚路径 ══════════════════════════════════════════════════

Deno.test("install 中途包管理器失败：自动回滚到操作前状态，报错带「已回滚」", async () => {
  await withFixture(async (f) => {
    makeProfile(f);
    makeInstallTarget(f, "fail-pkg", true);
    const before = await scanOf(f);

    const prev = Deno.env.get("BUTLER_PM_FAIL");
    Deno.env.set("BUTLER_PM_FAIL", "1");
    let msg = "";
    try {
      await pluginInstallAction.run(fakeCtx(), { name: "fail-pkg", version: "9.9.9" });
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      if (prev === undefined) Deno.env.delete("BUTLER_PM_FAIL");
      else Deno.env.set("BUTLER_PM_FAIL", prev);
    }

    assert(msg.length > 0, "包管理器失败必须让任务失败，绝不静默成功");
    assertIncludes(msg, "已回滚到操作前状态", "报错必须声明已回滚（给用户的定心丸）");

    const after = await scanOf(f);
    assertEq(after, before, "失败后 scan 必须与操作前一致");
    assert(readActiveTxn() === null, "回滚成功即收日志");
  });
});

// ══ 日志与防呆 ════════════════════════════════════════════════════

Deno.test("事务日志损坏：恢复必须抛错（绝不猜内容），日志保留待人工", async () => {
  await withFixture(async (f) => {
    const file = p(f.txnDir, "active.json");
    writeFile(file, "{ 这不是合法 JSON");

    let msg = "";
    try {
      await recoverPluginTxn();
    } catch (e) {
      msg = (e as Error).message;
    }
    assertIncludes(msg, "损坏", "损坏日志必须抛明确错误");
    assert(pathExists(file), "损坏日志应保留（不能销毁现场）");
  });
});

Deno.test("已有未收尾事务日志时，新事务拒绝开工（beginTxn 防并发）", async () => {
  await withFixture(async (f) => {
    makeProfile(f);
    const manifestPath = profileManifestPath(f.profileDir);
    const pt = await createRollbackPoint({
      kind: "plugin-set",
      trigger: "test：占用日志",
      artifacts: [{ path: manifestPath, mode: "copy" }],
      reverse: { op: "restore-files" },
    });
    const j: PluginTxnJournal = {
      kind: "plugin-txn",
      version: 1,
      op: "uninstall",
      name: "base-layer",
      profileDir: f.profileDir,
      rollbackPointId: pt.id,
      quarantinedDir: "",
      originalDir: p(f.profileDir, "node_modules", "base-layer"),
      startedAt: new Date().toISOString(),
    };
    beginTxn(j);

    let msg = "";
    try {
      beginTxn({ ...j, name: "另一个包" });
    } catch (e) {
      msg = (e as Error).message;
    }
    assertIncludes(msg, "未收尾", "日志还在时必须拒绝第二个事务");
  });
});

Deno.test("preflight 四条防呆：坏名 / 已安装 / 未安装 / 缺清单", async () => {
  await withFixture(async (f) => {
    // ① 坏名（路径穿越写法最先拦）
    const bad = await preInstall({ name: "../evil" });
    assert(
      bad.some((x) => x.id === "plugin.bad-name" && x.severity === "error"),
      "路径穿越式插件名应被拦下",
    );

    makeProfile(f);

    // ② 已安装的再装
    const again = await preInstall({ name: "base-layer" });
    assert(
      again.some((x) => x.id === "plugin.already-installed" && x.severity === "error"),
      "已安装的包不应允许重复安装",
    );

    // ③ 没装过的卸载
    const ghost = await preUninstall({ name: "ghost-pkg" });
    assert(
      ghost.some((x) => x.id === "plugin.not-installed" && x.severity === "error"),
      "三处都找不到的对象不应允许卸载",
    );

    // ④ 缺 profile 清单（临时把 profile 指到不存在的位置）
    const prev = Deno.env.get("BUTLER_PROFILE_DIR") ?? "";
    Deno.env.set("BUTLER_PROFILE_DIR", p(f.root, "no-such-profile"));
    let none: Finding[] = [];
    try {
      none = await preInstall({ name: "whatever" });
    } finally {
      Deno.env.set("BUTLER_PROFILE_DIR", prev);
    }
    assert(
      none.some((x) => x.id === "plugin.no-profile" && x.severity === "error"),
      "清单缺失必须拦截（没地方登记双名单）",
    );

    // ⑤ 正常名单：干净的安装请求应零 error
    const clean = await preInstall({ name: "@fixture/fresh-pkg" });
    assert(
      !clean.some((x) => x.severity === "error"),
      `正常请求不应有 error：${
        clean.filter((x) => x.severity === "error").map((x) => x.id).join("、")
      }`,
    );
  });
});
