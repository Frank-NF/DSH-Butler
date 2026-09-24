/**
 * plugin.cleanResidue 的行为测试（隔离不删除）。
 *
 * 钉三件事：
 *   1) 判据只认 pnpm 暂存特征 —— 四类真实残留样本全命中，正常包（typescript）
 *      绝不误伤；
 *   2) preflight 三层闸（no-node-modules → txn-pending → nothing-to-clean）
 *      与 run 的同一道闸防绕过；
 *   3) 成功路径：原位消失 → .cleanup_backup_<stamp> 隔离区 + MANIFEST.json
 *      台账 + 复扫清零 —— 只移动、不删除，可人工还原。
 *
 * 隔离六件套（本动作不调 resolveDshSourceRoot，无需 DSH_WEB_DIR）：
 * profile/txn/rollback 三个存储进临时目录 + 跳过 npm/服务。
 */

import type { ActionContext } from "../../jobs/types.ts";
import type { Finding } from "../../util/result.ts";
import { isDir, isFile } from "../../host/fs.ts";
import { dirname, p } from "../../util/paths.ts";
import { stageSafetyProblems } from "../../jobs/registry.ts";
import { CLEAN_RESIDUE_STEPS, pluginCleanResidueAction } from "./clean_residue.ts";

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
    jobId: "test-plugin-clean-residue",
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
  nodeModules: string;
  txnDir: string;
  rollbackDir: string;
}

async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const root = Deno.makeTempDirSync();
  const f: Fixture = {
    root,
    profileDir: p(root, "profile"),
    nodeModules: p(root, "profile", "node_modules"),
    txnDir: p(root, "txn"),
    rollbackDir: p(root, "rollback"),
  };
  Deno.mkdirSync(f.nodeModules, { recursive: true });

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
  // 必须用 dirname 切父目录 —— p() 不解析 ".."，mkdirSync 会把文件名当目录（os error 87）
  Deno.mkdirSync(dirname(full), { recursive: true });
  Deno.writeTextFileSync(full, text);
}

/** 造一个残留目录（目录里放个文件，确保是真实可移动的目录）。 */
function makeResidueDir(nodeModules: string, name: string): void {
  const dir = p(nodeModules, ...name.split("/"));
  writeFile(p(dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
}

/** 造一个正常包（绝不能被当成残留清掉）。 */
function makeNormalPkg(nodeModules: string, name: string): void {
  writeFile(p(nodeModules, name, "package.json"), JSON.stringify({ name, version: "5.0.0" }));
}

async function preClean(): Promise<Finding[]> {
  const fn = pluginCleanResidueAction.preflight;
  if (!fn) throw new Error("plugin.cleanResidue 缺少 preflight");
  return await fn({});
}

// ══ 判据：四类真实残留样本 ═════════════════════════════════════════

Deno.test("cleanResidue 成功：四类残留全清、正常包不误伤、MANIFEST 留台账", async () => {
  await withFixture(async (f) => {
    // 四类真实残留样本（_tmp_ / 随机 8 位 / scoped 隐藏前缀 / 日期戳）
    makeResidueDir(f.nodeModules, "nan_tmp_1248_8");
    makeResidueDir(f.nodeModules, "ansi-regex-AFJM5CM4");
    makeResidueDir(f.nodeModules, "@codemirror/.autocomplete_tmp_15580_31-2kN2ZzMh");
    makeResidueDir(f.nodeModules, "dshmarket_20260924_110135");
    // 正常包：pnpm 装出来的传递依赖就长这样，绝不能碰
    makeNormalPkg(f.nodeModules, "typescript");

    const pre = await preClean();
    const errors = pre.filter((x) => x.severity === "error");
    assertEq(
      errors.length,
      0,
      `有残留 + 目录在 → 应放行，实际：${errors.map((x) => x.id).join("、") || "（无）"}`,
    );

    const rep = await pluginCleanResidueAction.run(fakeCtx(), {});
    assertEq(rep.moved, 4, "四类残留应全部移入隔离区");
    assertEq(rep.failed.length, 0, "同盘移动不该有失败");
    assertEq(rep.remaining, 0, "复扫必须清零");

    // 原位消失
    assert(!isDir(p(f.nodeModules, "nan_tmp_1248_8")), "残留原位应消失");
    assert(!isDir(p(f.nodeModules, "ansi-regex-AFJM5CM4")), "残留原位应消失");
    assert(
      !isDir(p(f.nodeModules, "@codemirror", ".autocomplete_tmp_15580_31-2kN2ZzMh")),
      "scoped 残留原位应消失",
    );
    assert(!isDir(p(f.nodeModules, "dshmarket_20260924_110135")), "残留原位应消失");

    // 隔离区 + MANIFEST 台账
    assert(
      p(f.profileDir, "").length > 0 && rep.backupDir.includes(".cleanup_backup_"),
      `隔离区必须叫 .cleanup_backup_<stamp>，实际：${rep.backupDir}`,
    );
    assert(isDir(rep.backupDir), "隔离区目录应真实存在");
    assert(isFile(p(rep.backupDir, "MANIFEST.json")), "隔离区必须留 MANIFEST 台账");
    const mf = JSON.parse(Deno.readTextFileSync(p(rep.backupDir, "MANIFEST.json")));
    assertEq(mf.items.length, 4, "MANIFEST 应记录全部 4 项（含 original/quarantined/reason）");
    assert(typeof mf.items[0].original === "string", "台账每项要有原位路径（可人工还原）");
    assert(typeof mf.items[0].reason === "string", "台账每项要记残留特征 reason");

    // 正常包毫发无伤
    assert(isFile(p(f.nodeModules, "typescript", "package.json")), "正常包绝不许被移走");
    assert(rep.lines.some((l) => l.includes("残留已清零")), "报告应声明复核清零");
  });
});

// ══ preflight 三层闸 ═══════════════════════════════════════════════

Deno.test("preflight 三层闸：no-node-modules / txn-pending / nothing-to-clean", async () => {
  await withFixture(async (f) => {
    // ① 没有 node_modules（先把目录挪走模拟未安装）
    const nmBackup = p(f.root, "nm-moved-away");
    Deno.renameSync(f.nodeModules, nmBackup);
    const none = await preClean();
    assert(
      none.some((x) => x.id === "plugin.cleanResidue.no-node-modules" && x.severity === "error"),
      "没有安装目录必须拦截",
    );
    Deno.renameSync(nmBackup, f.nodeModules);

    // ② 上一个事务未收尾
    makeResidueDir(f.nodeModules, "nan_tmp_1248_8");
    writeFile(p(f.txnDir, "active.json"), "{}");
    const txn = await preClean();
    assert(
      txn.some((x) => x.id === "plugin.txn-pending" && x.severity === "error"),
      "事务未收尾必须拦截（会与未收尾事务互相踩踏）",
    );
    Deno.removeSync(p(f.txnDir, "active.json"));

    // ③ 目录在但没有残留（只有正常包）
    Deno.removeSync(p(f.nodeModules, "nan_tmp_1248_8"), { recursive: true });
    makeNormalPkg(f.nodeModules, "typescript");
    const clean = await preClean();
    assert(
      clean.some((x) => x.id === "plugin.nothing-to-clean" && x.severity === "error"),
      "没有残留必须拦截（没有需要移动的对象）",
    );
  });
});

// ══ run 同一道闸（防绕过 preflight 直接执行） ═════════════════════

Deno.test("run 闸：事务未收尾 / 无残留一律拒绝，不做半吊子移动", async () => {
  await withFixture(async (f) => {
    // ① 事务未收尾
    makeResidueDir(f.nodeModules, "nan_tmp_1248_8");
    writeFile(p(f.txnDir, "active.json"), "{}");
    let msg = "";
    try {
      await pluginCleanResidueAction.run(fakeCtx(), {});
    } catch (e) {
      msg = (e as Error).message;
    }
    assertIncludes(msg, "检测到上次未收尾的插件事务", "run 必须复述与 preflight 相同的闸");
    Deno.removeSync(p(f.txnDir, "active.json"));

    // ② 无残留
    Deno.removeSync(p(f.nodeModules, "nan_tmp_1248_8"), { recursive: true });
    makeNormalPkg(f.nodeModules, "typescript");
    let msg2 = "";
    try {
      await pluginCleanResidueAction.run(fakeCtx(), {});
    } catch (e) {
      msg2 = (e as Error).message;
    }
    assertIncludes(msg2, "没有可清理的安装残留", "run 重扫发现 0 处必须拒绝");
    assertEq(
      Array.from(Deno.readDirSync(p(f.profileDir))).filter((e) =>
        e.name.startsWith(".cleanup_backup_")
      ).length,
      0,
      "拒绝路径绝不能建出空隔离区",
    );
  });
});

// ══ 静态装备 ═══════════════════════════════════════════════════════

Deno.test("plugin.cleanResidue 装备：三步清单单一事实来源 + 写动作准入", () => {
  assertEq(CLEAN_RESIDUE_STEPS.length, 3, "必须是三步");
  assertEq(pluginCleanResidueAction.steps?.length, 3, "动作声明的步骤必须与清单一致");
  assertEq(
    pluginCleanResidueAction.steps?.[0],
    CLEAN_RESIDUE_STEPS[0],
    "动作步骤必须直接引用清单（单一事实来源）",
  );
  assert(pluginCleanResidueAction.steps?.[1]?.includes("隔离"), "第 2 步必须是移入隔离区");
  assert(pluginCleanResidueAction.steps?.[2]?.includes("复核"), "第 3 步必须是复核结果");
  assertEq(pluginCleanResidueAction.readonly, false, "这是写动作");
  assert(typeof pluginCleanResidueAction.preflight === "function", "写动作必须有 preflight");
  assert(
    (pluginCleanResidueAction.timeoutMs ?? 0) >= 900_000,
    "清理的最坏预算不能低于 install 口径（900 秒）",
  );
  assertEq(
    stageSafetyProblems([pluginCleanResidueAction as never]).length,
    0,
    "阶段安全防呆必须零问题",
  );
});
