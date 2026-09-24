/**
 * runtime.repair 的行为测试（僵尸锁自愈，只改名不删除）。
 *
 * 钉四件事：
 *   1) 判据与状态页同口径（scanLocks）：stale（PID 不存在）可清，
 *      unreadable（读不出 PID）绝不清 —— 宁可漏，不可误清活锁；
 *   2) preflight：no-profile / nothing-to-repair（unreadable-only 的 cause
 *      必须讲清保守原则）+ lock-unreadable info 级提示；
 *   3) run 成功：失效锁改名为 *.stale-<时间戳>（证据留原地）、unreadable
 *      原样不动进 skipped、复扫 remaining=0、改名项不被重复报警；
 *   4) run 防呆：bad=0 → 拒绝执行并说明保守跳过了几个；no-profile → 拒绝。
 *
 * 隔离六件套（本动作不调 resolveDshSourceRoot，无需 DSH_WEB_DIR）：
 * profile/txn/rollback 三个存储进临时目录 + 跳过 npm/服务。
 * 僵尸 PID 用 999999999（超出 Windows PID 上限 → stale 判定稳定）。
 */

import type { ActionContext } from "../../jobs/types.ts";
import type { Finding } from "../../util/result.ts";
import { isFile } from "../../host/fs.ts";
import { dirname, p } from "../../util/paths.ts";
import { stageSafetyProblems } from "../../jobs/registry.ts";
import {
  RUNTIME_REPAIR_STEPS,
  runtimeRepairAction,
} from "./repair.ts";
import { scanLocks } from "./status.ts";

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
    jobId: "test-runtime-repair",
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

async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const root = Deno.makeTempDirSync();
  const f: Fixture = {
    root,
    profileDir: p(root, "profile"),
    txnDir: p(root, "txn"),
    rollbackDir: p(root, "rollback"),
  };
  Deno.mkdirSync(f.profileDir, { recursive: true });

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
  // 必须用 dirname 切父目录 —— p() 不解析 ".."（os error 87）
  Deno.mkdirSync(dirname(full), { recursive: true });
  Deno.writeTextFileSync(full, text);
}

/** 造一把僵尸锁：首行是超大 PID（不存在 → stale）。 */
function makeStaleLock(f: Fixture, name = "cordis.lock"): string {
  const file = p(f.profileDir, name);
  writeFile(file, "999999999");
  return file;
}

/** 造一把读不懂的锁：内容不是 PID（→ unreadable，保守不清）。 */
function makeUnreadableLock(f: Fixture, name = "dsh.lock"): string {
  const file = p(f.profileDir, name);
  writeFile(file, "not-a-pid-at-all");
  return file;
}

async function preRepair(): Promise<Finding[]> {
  const fn = runtimeRepairAction.preflight;
  if (!fn) throw new Error("runtime.repair 缺少 preflight");
  return await fn({});
}

// ══ preflight ══════════════════════════════════════════════════════

Deno.test("preflight：有失效锁 → 零 error 放行（不可读锁只给 info 提示）", async () => {
  await withFixture(async (f) => {
    makeStaleLock(f);
    makeUnreadableLock(f);

    const out = await preRepair();
    const errors = out.filter((x) => x.severity === "error");
    assertEq(
      errors.length,
      0,
      `有 stale 可清 → 不该有 error，实际：${errors.map((x) => x.id).join("、") || "（无）"}`,
    );
    const info = out.find((x) => x.id === "runtime.lock-unreadable");
    assert(info, "读不懂的锁应给 info 级提示（人工留意）");
    assertEq(info.severity, "info", "lock-unreadable 绝不能是 error（否则会挡住可清的 stale）");
  });
});

Deno.test("preflight nothing-to-repair：unreadable-only 的 cause 讲清保守原则", async () => {
  await withFixture(async (f) => {
    makeUnreadableLock(f);

    const out = await preRepair();
    const hit = out.find((x) => x.id === "runtime.nothing-to-repair");
    assert(hit, "全是读不懂的锁 → 必须报 nothing-to-repair");
    assertEq(hit.severity, "error", "没有可清对象就是 error（拦截执行）");
    assertIncludes(hit.cause ?? "", "保守", "cause 必须讲清「绝不清活锁」的保守原则");
    assert(
      out.some((x) => x.id === "runtime.lock-unreadable" && x.severity === "info"),
      "同时给 info 级的 unreadable 提示",
    );
  });
});

Deno.test("preflight no-profile：找不到配置目录 → 拦截", async () => {
  await withFixture(async (f) => {
    const prev = Deno.env.get("BUTLER_PROFILE_DIR");
    Deno.env.set("BUTLER_PROFILE_DIR", p(f.root, "no-such-profile"));
    let out: Finding[] = [];
    try {
      out = await preRepair();
    } finally {
      if (prev === undefined) Deno.env.delete("BUTLER_PROFILE_DIR");
      else Deno.env.set("BUTLER_PROFILE_DIR", prev);
    }
    assert(
      out.some((x) => x.id === "runtime.repair.no-profile" && x.severity === "error"),
      "配置目录不存在必须拦截",
    );
  });
});

// ══ run 成功路径 ═══════════════════════════════════════════════════

Deno.test("run 成功：stale 改名留证、unreadable 原样进 skipped、复扫清零", async () => {
  await withFixture(async (f) => {
    const staleFile = makeStaleLock(f, "cordis.lock");
    const unreadableFile = makeUnreadableLock(f, "dsh.lock");

    const rep = await runtimeRepairAction.run(fakeCtx(), {});

    assertEq(rep.renamed.length, 1, "只有 stale 那把该被改名");
    assertEq(rep.failed.length, 0, "同目录改名不该失败");
    assertEq(rep.remaining, 0, "复扫失效锁必须清零");

    // 原位消失 + 证据留在原地（只改名不删除）
    assert(!isFile(staleFile), "原锁名应消失（已改名）");
    const renamed = rep.renamed[0];
    assert(renamed, "renamed 应有记录");
    assert(renamed.to.includes(".stale-"), `改名目标必须是 *.stale-<时间戳>，实际：${renamed?.to}`);
    assert(isFile(renamed.to), "改名后的证据文件必须真实存在（不删除）");

    // unreadable 绝不动 + 记进 skipped
    assert(isFile(unreadableFile), "读不懂的锁绝不能碰");
    assert(
      rep.skipped.some((s) => s.file === unreadableFile && s.verdict === "unreadable"),
      "unreadable 必须进 skipped 留痕",
    );
    assert(rep.lines.some((l) => l.includes("失效锁改名留证")), "报告应记录改名动作");
    assert(rep.lines.some((l) => l.includes("失效锁已清零")), "报告应声明复核清零");

    // 改名后的文件不再被当成「又发现一个僵尸锁」
    const after = await scanLocks(f.profileDir);
    const stillBad = after.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
    assertEq(stillBad.length, 0, "stale-* 已处理项必须被 scanLocks 排除（不重复报警）");
  });
});

// ══ run 防呆 ═══════════════════════════════════════════════════════

Deno.test("run bad=0：拒绝执行并说明保守跳过了几个，不留任何改名痕迹", async () => {
  await withFixture(async (f) => {
    makeUnreadableLock(f);

    let msg = "";
    try {
      await runtimeRepairAction.run(fakeCtx(), {});
    } catch (e) {
      msg = (e as Error).message;
    }
    assertIncludes(msg, "没有需要清理的失效写锁", "无可清对象必须拒绝");
    assertIncludes(msg, "保守跳过", "拒绝信息要说清保守跳过了几个（给用户交代）");
    assert(
      !isFile(p(f.profileDir, "dsh.lock.stale-1")) &&
        Deno.readDirSync(f.profileDir).every((e) => !e.name.includes(".stale-")),
      "拒绝路径绝不能产生任何改名痕迹",
    );
  });
});

Deno.test("run no-profile：找不到配置目录直接拒绝", async () => {
  await withFixture(async (f) => {
    const prev = Deno.env.get("BUTLER_PROFILE_DIR");
    Deno.env.set("BUTLER_PROFILE_DIR", p(f.root, "no-such-profile"));
    let msg = "";
    try {
      await runtimeRepairAction.run(fakeCtx(), {});
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      if (prev === undefined) Deno.env.delete("BUTLER_PROFILE_DIR");
      else Deno.env.set("BUTLER_PROFILE_DIR", prev);
    }
    assertIncludes(msg, "找不到 DSH 配置目录", "run 必须与 preflight 同一道闸");
  });
});

// ══ 静态装备 ═══════════════════════════════════════════════════════

Deno.test("runtime.repair 装备：三步清单单一事实来源 + 写动作准入", () => {
  assertEq(RUNTIME_REPAIR_STEPS.length, 3, "必须是三步");
  assertEq(runtimeRepairAction.steps?.length, 3, "动作声明的步骤必须与清单一致");
  assertEq(
    runtimeRepairAction.steps?.[0],
    RUNTIME_REPAIR_STEPS[0],
    "动作步骤必须直接引用清单（单一事实来源）",
  );
  assert(runtimeRepairAction.steps?.[1]?.includes("只改名不删除"), "第 2 步必须强调只改名不删除");
  assert(runtimeRepairAction.steps?.[2]?.includes("复核"), "第 3 步必须是复核结果");
  assertEq(runtimeRepairAction.readonly, false, "这是写动作");
  assert(typeof runtimeRepairAction.preflight === "function", "写动作必须有 preflight");
  assert(
    (runtimeRepairAction.timeoutMs ?? 0) >= 900_000,
    "清理的最坏预算不能低于 install 口径（900 秒）",
  );
  assertEq(stageSafetyProblems([runtimeRepairAction as never]).length, 0, "阶段安全防呆必须零问题");
});
