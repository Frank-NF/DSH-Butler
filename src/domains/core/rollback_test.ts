/**
 * core.rollback 的判据回归测试（AC-C3：任一步失败后能恢复到操作前状态，恢复后 core.verify 全绿）。
 *
 * 覆盖三件事：
 *   1) 【恢复】失败更新的现场（上游删包僵尸 + 提交号分叉 + 新文件）跑一遍
 *      core.rollback，源码、构建记录、隔离区内容必须逐项回到操作前状态；
 *   2) 【全绿】恢复后的 core.verify 结论必须零 error（profile 维度除外）——
 *      注意断言用的是 findings 而不是 healthOf：真实 ~/.dsh/profiles 读出来的
 *      warn（pnpm 残留等）与本体回滚无关，拿 health==="ok" 当判据会被环境污染；
 *   3) 【防呆】preflight 把「没有回滚点 / 点类型不对」提前拦下，写动作安全装备齐全。
 *
 * 另外钉住 rollbackGreen 的 phase 差异：pre-rebuild 排除 artifacts-mismatch
 * （重建前 dist 是新的，属预期），final 不排除（重建后还不一致就是真没修好）。
 *
 * 测试隔离四件套：DSH_WEB_DIR（源码树）+ BUTLER_ROLLBACK_DIR（回滚存储）+
 * BUTLER_SKIP_SERVICE_OPS（不碰真机 DSH 进程）+ 临时目录 fixture（绝不碰真实源码树）。
 */

import { stageSafetyProblems } from "../../jobs/registry.ts";
import type { ActionContext } from "../../jobs/types.ts";
import { isFile } from "../../host/fs.ts";
import { dirname, p, quarantineStampDir } from "../../util/paths.ts";
import { createRollbackPoint, getRollbackPoint } from "../backup/rollback.ts";
import { collectCoreStatus, type CoreStatus } from "./status.ts";
import { collectLibResidue, coreVerifyAction, type LibResidueReport } from "./verify.ts";
import { coreRollbackAction, ROLLBACK_STEPS, rollbackGreen } from "./rollback.ts";

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

// ── fixture 工具（与 verify_test 同款手法） ─────────────────────────

const HAS_GIT = (() => {
  try {
    return new Deno.Command("git", { args: ["--version"], stdout: "piped", stderr: "piped" })
      .outputSync().code === 0;
  } catch {
    return false;
  }
})();

function sh(root: string, ...args: string[]): void {
  const out = new Deno.Command("git", {
    args: [
      "-C",
      root,
      "-c",
      "user.email=butler@test.local",
      "-c",
      "user.name=butler",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (out.code !== 0) {
    throw new Error(`git ${args.join(" ")} 失败：${new TextDecoder().decode(out.stderr)}`);
  }
}

function gitHead(root: string): string {
  const out = new Deno.Command("git", {
    args: ["-C", root, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  })
    .outputSync();
  return new TextDecoder().decode(out.stdout).trim();
}

function writeFile(root: string, rel: string, text: string): void {
  const full = p(root, ...rel.split("/"));
  Deno.mkdirSync(dirname(full), { recursive: true });
  Deno.writeTextFileSync(full, text);
}

function withDshWebDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("DSH_WEB_DIR");
  Deno.env.set("DSH_WEB_DIR", dir);
  return fn().finally(() => {
    if (prev === undefined) Deno.env.delete("DSH_WEB_DIR");
    else Deno.env.set("DSH_WEB_DIR", prev);
  });
}

/** 回滚存储隔离：每个测试独立的临时根，跑完连目录一起删。 */
async function withTempStore<T>(fn: () => Promise<T>): Promise<T> {
  const dir = Deno.makeTempDirSync();
  const prev = Deno.env.get("BUTLER_ROLLBACK_DIR");
  Deno.env.set("BUTLER_ROLLBACK_DIR", dir);
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("BUTLER_ROLLBACK_DIR");
    else Deno.env.set("BUTLER_ROLLBACK_DIR", prev);
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch { /* ignore */ }
  }
}

/** 服务隔离：回滚会真实停启本机 DSH，测试绝不能碰用户正在用的进程。 */
async function withSkipService<T>(fn: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("BUTLER_SKIP_SERVICE_OPS");
  Deno.env.set("BUTLER_SKIP_SERVICE_OPS", "1");
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("BUTLER_SKIP_SERVICE_OPS");
    else Deno.env.set("BUTLER_SKIP_SERVICE_OPS", prev);
  }
}

function fakeCtx(): ActionContext {
  return {
    jobId: "test-core-rollback",
    signal: new AbortController().signal,
    step: () => {},
    detail: () => {},
    log: () => {},
    progress: () => {},
    onUndo: () => {},
    throwIfCancelled: () => {},
  };
}

function removeAll(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      Deno.removeSync(d, { recursive: true });
    } catch { /* 已删则忽略 */ }
  }
}

// ── 场景构造 ────────────────────────────────────────────────────────

interface Scenario {
  root: string;
  /** 回滚点钉住的提交（操作前状态）。 */
  c1: string;
  ptId: string;
  buildRecord: string;
  /** 写前回滚点的隔离区（里面预先放一个 stray 文件，回滚后必须移回仓库根）。 */
  qParent: string;
  qdir: string;
}

/**
 * 「失败的更新」现场：
 *   - v1 提交 → 创建 core-build 回滚点（与 finishUpdate 前置同形态）
 *   - 之后模拟一次跑挂的更新：上游删包留僵尸 lib + 源码推进到 v2 + 新文件，
 *     但构建记录仍是 v1 的（没重建完）——正好是 needs-finish-update + zombie 双 error。
 */
async function makeBrokenScenario(): Promise<Scenario> {
  const root = Deno.makeTempDirSync();
  Deno.mkdirSync(p(root, "apps", "cli"), { recursive: true });
  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "fixture-core", version: "0.0.9-fixture" }),
  );
  writeFile(
    root,
    "apps/cli/package.json",
    JSON.stringify({ name: "@deepseek-ai/dsh-cli", version: "0.0.9-fixture" }),
  );
  writeFile(root, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "packages/*"\n');
  writeFile(root, "packages/gone/package.json", JSON.stringify({ name: "gone-pkg" }));

  sh(root, "init", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-m", "v1");
  const c1 = gitHead(root);

  const buildRecord = p(root, ".dsh-build", "client-build-environment.json");
  writeFile(
    root,
    ".dsh-build/client-build-environment.json",
    JSON.stringify({
      formatVersion: 1,
      environment: { DSH_CLIENT_COMMIT_HASH: c1, DSH_CLIENT_VERSION: "0.0.9-fixture" },
      artifacts: { fileCount: 1, sha256: "fixture" },
    }),
  );

  // write-ahead 回滚点（finishUpdate 前置的同款形态）
  const qParent = Deno.makeTempDirSync();
  const qdir = p(qParent, "q");
  Deno.mkdirSync(qdir, { recursive: true });
  Deno.writeTextFileSync(p(qdir, "stray.txt"), "被隔离的残留");
  const pt = await createRollbackPoint({
    kind: "core-build",
    trigger: "core.finishUpdate 前置",
    artifacts: [
      { path: root, mode: "git-ref", ref: "HEAD" },
      { path: buildRecord, mode: "copy" },
    ],
    reverse: { op: "git-reset", commit: c1, quarantine: qdir },
  });

  // ── 跑挂的更新现场 ──────────────────────────────────────────────
  // ① 上游删包：HEAD 不再有 gone/package.json，gitignore 的 lib/ 留在磁盘 → 僵尸
  Deno.removeSync(p(root, "packages", "gone", "package.json"));
  sh(root, "add", "-A");
  sh(root, "commit", "-m", "v2 upstream drops gone");
  writeFile(root, "packages/gone/lib/index.js", "module.exports = {};\n");
  // ② 源码推进到 v2 + 新文件；构建记录仍是 c1（没重建完）
  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "fixture-core", version: "0.0.10-fixture" }),
  );
  writeFile(
    root,
    "apps/cli/package.json",
    JSON.stringify({ name: "@deepseek-ai/dsh-cli", version: "0.0.10-fixture" }),
  );
  writeFile(root, "new-feature.txt", "v2 only");
  sh(root, "add", "-A");
  sh(root, "commit", "-m", "v2 feature");

  return { root, c1, ptId: pt.id, buildRecord, qParent, qdir };
}

/** 只有本体树、没有任何回滚点的最小 fixture（preflight 测试用）。 */
function makeCoreOnly(): string {
  const root = Deno.makeTempDirSync();
  Deno.mkdirSync(p(root, "apps", "cli"), { recursive: true });
  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "fixture-core", version: "0.0.9-fixture" }),
  );
  writeFile(
    root,
    "apps/cli/package.json",
    JSON.stringify({ name: "@deepseek-ai/dsh-cli", version: "0.0.9-fixture" }),
  );
  sh(root, "init", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-m", "v1");
  return root;
}

// ── rollbackGreen 的纯函数阴阳样本 ─────────────────────────────────

function greenStatus(): CoreStatus {
  return {
    sourceRoot: "G:\\fixture",
    discoveredBy: "env",
    version: "0.0.9-fixture",
    git: {
      head: "abcdef1234567890abcdef1234567890abcdef12",
      headShort: "abcdef1",
      branch: "main",
      dirtyTracked: 0,
    },
    build: {
      path: "G:\\fixture\\.dsh-build\\client-build-environment.json",
      formatVersion: 1,
      commit: "abcdef1234567890abcdef1234567890abcdef12",
      version: "0.0.9-fixture",
      dirty: false,
      fileCount: 1,
      artifactsSha256: "fixture",
      recordedAt: null,
    },
    integrity: null,
    needsFinishUpdate: false,
    finishReason: null,
    plugins: null,
    suspectedOrphans: [],
    findings: [],
    checkedAt: new Date().toISOString(),
  };
}

function greenLibs(): LibResidueReport {
  return {
    patterns: ["apps/*"],
    candidates: 1,
    headPackages: 1,
    zombieLibs: [],
    missingPackages: [],
    untrackedPackages: [],
  };
}

function errFinding(id: string): CoreStatus["findings"][number] {
  return { id, severity: "error", title: `问题 ${id}` };
}

// ══ AC-C3 主线：恢复 + 全绿 ═══════════════════════════════════════

Deno.test("AC-C3：失败更新后 core.rollback 恢复到操作前状态，恢复后 core.verify 零 error", async () => {
  if (!HAS_GIT) return;
  // 造点必须发生在 withTempStore 之内：回滚点写进哪个存储、run 就得从哪个存储读，
  // 之前造在 store 外面（默认存储）导致 run 找不到点直接抛错。
  await withTempStore(async () => {
    const sc = await makeBrokenScenario();
    try {
      const report = await withSkipService(() =>
        withDshWebDir(sc.root, async () => {
          // 操作前：双 error 现场成立（否则测不出「恢复」）
          const before = await collectCoreStatus();
          assert(
            before.needsFinishUpdate,
            "回滚前必须处于「需要完成更新」状态（构建记录 c1 ≠ HEAD c2）",
          );
          const beforeLibs = await collectLibResidue(sc.root);
          assertEq(
            beforeLibs?.zombieLibs.length ?? -1,
            1,
            "回滚前必须有 1 处僵尸 lib（上游删包现场）",
          );

          return await coreRollbackAction.run(fakeCtx(), {} as Record<string, never>);
        })
      );

      // ── ① 恢复到操作前状态（逐项核对，AC-C3 的前半句） ─────────────
      assertEq(gitHead(sc.root), sc.c1, "HEAD 必须退回回滚点钉住的提交");
      assert(!isFile(p(sc.root, "new-feature.txt")), "v2 新增的文件必须随回滚消失");
      assert(isFile(p(sc.root, "packages", "gone", "package.json")), "被上游删掉的包声明必须恢复");
      assertIncludes(
        Deno.readTextFileSync(p(sc.root, "apps", "cli", "package.json")),
        "0.0.9-fixture",
        "apps/cli/package.json 必须回到操作前内容",
      );
      const record = JSON.parse(Deno.readTextFileSync(sc.buildRecord)) as {
        environment: { DSH_CLIENT_COMMIT_HASH: string };
      };
      assertEq(
        record.environment.DSH_CLIENT_COMMIT_HASH,
        sc.c1,
        "构建记录副本必须还原为操作前的提交",
      );
      assertEq(
        Deno.readTextFileSync(p(sc.root, "stray.txt")),
        "被隔离的残留",
        "回滚点隔离区里的文件必须移回仓库根（恢复=移回，不是复制）",
      );
      assert(!isFile(p(sc.qdir, "stray.txt")), "移回是移动不是复制，隔离区原位置不应还有");
      assertEq(report.rollbackId, sc.ptId, "报告必须指明消费的回滚点");

      // ── ② 恢复后全绿（AC-C3 的后半句） ────────────────────────────
      assertEq(report.green, true, "最终复核必须全绿");
      assertEq(
        report.problems.length,
        0,
        `全绿时 problems 必须为空，实际：${report.problems.join("；")}`,
      );
      assertEq(report.rebuild, "skipped-no-script", "fixture 无 build 脚本，重建应跳过而不是硬跑");
      assertEq(report.serviceWasRunning, false, "隔离模式下不停任何服务");
      assertEq(report.serviceRestarted, false, "没停过就不该重启");
      assert(report.lines.some((l) => l.includes("复核通过")), "汇报必须包含复核结论");

      // 用 core.verify 动作本体独立复核（AC-C3 字面口径：恢复后 core.verify 全绿）
      const vr = await withDshWebDir(
        sc.root,
        () => coreVerifyAction.run(fakeCtx(), {} as Record<string, never>),
      );
      const profileIds = [
        "core.plugin-declared-but-inactive",
        "core.plugin-bundled-but-undeclared",
        "core.pnpm-residue",
      ];
      const errs = vr.findings.filter((f) => f.severity === "error" && !profileIds.includes(f.id));
      assertEq(
        errs.length,
        0,
        `core.verify 不许残留 error 级问题：${errs.map((f) => f.id).join(",")}`,
      );
      assert(!vr.status?.needsFinishUpdate, "core.verify 不许再报需要完成更新");
      assertEq(vr.libs?.zombieLibs.length, 0, "core.verify 不许再报僵尸 lib");
      assertEq(vr.libs?.missingPackages.length, 0, "core.verify 不许报缺失包");

      // 回滚点保留且已验证（成功不销毁——还能再回一次）。
      // 注意别再套一层 withTempStore：那会把存储换成新的空目录，读出来永远是 null。
      const kept = await getRollbackPoint(sc.ptId);
      assert(kept !== null, "回滚点必须保留（成功也不销毁）");

      // 本次清理没造出任何隔离区垃圾（fixture 无编译缓存、无孤儿包）
      assertEq(report.quarantineDir, null, "无过期缓存与孤儿包时不该建隔离区");
      assert(
        !isFile(p(sc.root, ".dsh-build", "client-build-environment.tsbuildinfo")),
        "不该有编译缓存残留断言对象",
      );
    } finally {
      removeAll(sc.root, sc.qParent, quarantineStampDir(sc.root));
    }
  });
});

Deno.test("run 防御：没有回滚点时直接拒绝，一个文件都不许动", async () => {
  if (!HAS_GIT) return;
  const root = makeCoreOnly();
  try {
    // 造一个「以后会被回滚删掉」的文件：如果防御失效、误入执行段，它会被 reset 清掉
    writeFile(root, "canary.txt", "不许动我");
    // 直接记消息字符串：`Error | null` 变量在闭包里赋值后会被 TS 收窄成 never，取不到 message
    let thrownMsg: string | null = null;
    await withDshWebDir(root, () =>
      withTempStore(async () => {
        try {
          await coreRollbackAction.run(fakeCtx(), {} as Record<string, never>);
        } catch (e) {
          thrownMsg = (e as Error).message;
        }
      }));
    assert(thrownMsg !== null, "没有回滚点时 run 必须抛错");
    assertIncludes(thrownMsg ?? "", "没有可回滚", "报错必须说清没有可回滚的点");
    assert(isFile(p(root, "canary.txt")), "防御失败时绝不许动任何文件");
  } finally {
    removeAll(root);
  }
});

// ══ preflight：把「不能动手」提前拦下 ═════════════════════════════

Deno.test("preflight：没有 core-build 回滚点 → no-point 错误", async () => {
  if (!HAS_GIT) return;
  const root = makeCoreOnly();
  try {
    await withDshWebDir(root, async () => {
      await withTempStore(async () => {
        const findings = await coreRollbackAction.preflight?.({}) ?? [];
        assertEq(findings.length, 1, "应当恰好报一个问题");
        assertEq(findings[0]?.id, "core.rollback.no-point", "必须是 no-point");
        assertEq(findings[0]?.severity, "error", "no-point 必须是 error 级（写前拦截）");
        assertIncludes(findings[0]?.action ?? "", "完成更新", "必须告诉用户回滚点从哪来");
      });
    });
  } finally {
    removeAll(root);
  }
});

Deno.test("preflight：指定的回滚点类型不对 → bad-kind；不存在 → no-point", async () => {
  if (!HAS_GIT) return;
  const root = makeCoreOnly();
  const ws = Deno.makeTempDirSync();
  const file = p(ws, "cfg.json");
  Deno.writeTextFileSync(file, "原始内容");
  try {
    await withDshWebDir(root, async () => {
      await withTempStore(async () => {
        // 造点必须在 store 内（与读点同存储），否则 preflight 在空存储里只会报 no-point
        const cfgPt = await createRollbackPoint({
          kind: "config",
          trigger: "测试",
          artifacts: [{ path: file, mode: "copy" }],
          reverse: { op: "restore-files" },
        });

        // 类型不对：只带 id 指定一个 config 点
        const badKind = await coreRollbackAction.preflight?.({ id: cfgPt.id }) ?? [];
        assertEq(badKind[0]?.id, "core.rollback.bad-kind", "config 点必须被识别为类型不对");
        assertEq(badKind[0]?.severity, "error", "bad-kind 必须是 error 级");

        // id 不存在
        const missing = await coreRollbackAction.preflight?.({ id: "rp-not-here" }) ?? [];
        assertEq(missing[0]?.id, "core.rollback.no-point", "不存在的 id 必须报 no-point");

        // 不带 id：库里只有 config 点 → 找不到 core-build → no-point
        const none = await coreRollbackAction.preflight?.({}) ?? [];
        assertEq(none[0]?.id, "core.rollback.no-point", "缺省取最新 core-build，没有就 no-point");
      });
    });
  } finally {
    removeAll(root, ws);
  }
});

// ══ rollbackGreen：phase 差异与排除集 ══════════════════════════════

Deno.test("rollbackGreen：绿样本两阶段都过；profile 污染与 mismatch 按 phase 区分", () => {
  // ① 纯绿样本
  assertEq(
    rollbackGreen(greenStatus(), greenLibs(), "pre-rebuild").ok,
    true,
    "绿样本 pre-rebuild 应通过",
  );
  assertEq(rollbackGreen(greenStatus(), greenLibs(), "final").ok, true, "绿样本 final 应通过");

  // ② profile 维度的三条（含 error 级 bundled-undeclared）两个阶段都不许进 problems ——
  //    它们读的是真实 ~/.dsh/profiles，与本体回滚无关（AC-C3 的「全绿」不能被它污染）
  const polluted = greenStatus();
  polluted.findings = [
    errFinding("core.plugin-declared-but-inactive"),
    errFinding("core.plugin-bundled-but-undeclared"),
    errFinding("core.pnpm-residue"),
  ];
  assertEq(
    rollbackGreen(polluted, greenLibs(), "pre-rebuild").ok,
    true,
    "profile 维度必须被排除（pre-rebuild）",
  );
  assertEq(
    rollbackGreen(polluted, greenLibs(), "final").ok,
    true,
    "profile 维度必须被排除（final）",
  );

  // ③ artifacts-mismatch：pre-rebuild 排除（重建前 dist 是新的，属预期），final 必须报
  const mismatch = greenStatus();
  mismatch.findings = [errFinding("core.artifacts-mismatch")];
  assertEq(
    rollbackGreen(mismatch, greenLibs(), "pre-rebuild").ok,
    true,
    "重建前的产物不一致是预期状态，不许判失败",
  );
  const finalVerdict = rollbackGreen(mismatch, greenLibs(), "final");
  assertEq(finalVerdict.ok, false, "重建后仍不一致 = 真没修好，final 必须判失败");
  assertIncludes(
    finalVerdict.problems.join("\n"),
    "core.artifacts-mismatch",
    "problems 必须点名是哪条",
  );

  // ④ 其它 error 两个阶段都拦（随便挑一条非排除集的）
  const other = greenStatus();
  other.findings = [errFinding("core.needs-finish-update")];
  assertEq(
    rollbackGreen(other, greenLibs(), "pre-rebuild").ok,
    false,
    "非排除集的 error 一律不许过",
  );
});

Deno.test("rollbackGreen：结构性缺陷逐条拦下（僵尸 / 脏树 / 提交号分叉 / 缺记录）", () => {
  // 僵尸 lib：经 libResidueFindings 进 findings，error 级 → 两阶段都 fail
  const zombie = greenLibs();
  zombie.zombieLibs = [{ pkgDir: "apps/ghost", libPath: "apps/ghost/lib" }];
  assertEq(
    rollbackGreen(greenStatus(), zombie, "pre-rebuild").ok,
    false,
    "僵尸 lib 必须拦下（pre-rebuild）",
  );
  assertEq(rollbackGreen(greenStatus(), zombie, "final").ok, false, "僵尸 lib 必须拦下（final）");

  // 缺失包
  const missing = greenLibs();
  missing.missingPackages = ["packages/gone"];
  assertEq(rollbackGreen(greenStatus(), missing, "final").ok, false, "缺失包必须拦下");

  // 读不到 git 记录（libs=null）
  assertEq(
    rollbackGreen(greenStatus(), null, "final").ok,
    false,
    "残留检测不可用时必须判失败，不许装绿",
  );

  // 脏树：reset --hard 后不该有 tracked 改动，出现即还原不完整
  const dirty = greenStatus();
  dirty.git = { head: dirty.git!.head, headShort: "abcdef1", branch: "main", dirtyTracked: 3 };
  const dirtyVerdict = rollbackGreen(dirty, greenLibs(), "final");
  assertEq(dirtyVerdict.ok, false, "脏树必须拦下");
  assertIncludes(dirtyVerdict.problems.join("\n"), "已跟踪文件被改动", "必须说清是脏树问题");

  // 提交号分叉：自己按 head 前缀算，不依赖 needsFinishUpdate（后者会被 mismatch 置真）
  const fork = greenStatus();
  fork.git = {
    head: "0000000000000000000000000000000000000000",
    headShort: "0000000",
    branch: "main",
    dirtyTracked: 0,
  };
  const forkVerdict = rollbackGreen(fork, greenLibs(), "pre-rebuild");
  assertEq(forkVerdict.ok, false, "构建记录与 HEAD 分叉必须拦下");
  assertIncludes(forkVerdict.problems.join("\n"), "不一致", "必须说清是提交号不一致");

  // 缺构建记录 / 缺提交号
  const noRecord = greenStatus();
  noRecord.build = null;
  assertEq(rollbackGreen(noRecord, greenLibs(), "final").ok, false, "缺构建记录必须拦下");

  // 本体丢失
  const noRoot = greenStatus();
  noRoot.sourceRoot = null;
  assertEq(rollbackGreen(noRoot, greenLibs(), "final").ok, false, "本体丢失必须拦下");
});

// ══ 写动作准入（阶段安全防呆） ═════════════════════════════════════

Deno.test("写动作准入：core.rollback 带齐 preflight + steps，防呆零问题", () => {
  assertEq(coreRollbackAction.readonly, false, "这是写动作");
  assert(typeof coreRollbackAction.preflight === "function", "写动作必须有 preflight（写前检查）");
  assertEq(coreRollbackAction.steps?.length, ROLLBACK_STEPS.length, "动作步骤必须与清单一致");
  assertEq(
    coreRollbackAction.steps?.[0],
    ROLLBACK_STEPS[0],
    "步骤必须直接引用清单（单一事实来源）",
  );
  assert(
    (coreRollbackAction.timeoutMs ?? 0) >= 3_600_000,
    "回滚含 install + 全量重建，预算必须宽于默认 1 小时",
  );
  assertEq(stageSafetyProblems([coreRollbackAction as never]).length, 0, "阶段安全防呆必须零问题");
});
