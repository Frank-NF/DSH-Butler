/**
 * core.verify 的判据回归测试（AC-C1 / AC-C4）。
 *
 * 为什么这些逻辑必须有测试：
 *   AC-C4 对应的是 2026-09-23 本体构建失败的头号原因（#47 事故）：
 *   上游删包后 git pull 只清被跟踪的文件，gitignore 的 lib/ 产物原样留下，
 *   下次全量构建被打包工具当入口 → 构建直接挂。
 *   「僵尸 lib」的三条件签名判错任何一条，要么漏报（构建继续挂），
 *   要么误报（把用户正在写的包、正常的产物报成垃圾）——两头都要钉死。
 *
 *   AC-C1 是「HEAD 与构建记录不一致时 3 秒内给出明确结论」：
 *   判定逻辑本身在 collectCoreStatus，这里用 fixture 把「结论正确」
 *   和「3 秒内出结果」两件事一起钉住。
 *
 * 测试铁律（沿用 status_test.ts）：
 *   - 极简手写断言，不引外部依赖，任何网络环境下都能跑；
 *   - 阴性样本（健康 fixture 零命中）与阳性样本同等重要；
 *   - fixture 全部用临时目录 + 真 git 仓库，绝不碰真实 DSH 源码树。
 */

import type { ActionContext } from "../../jobs/types.ts";
import { dirname, p } from "../../util/paths.ts";
import { healthOf } from "../../util/result.ts";
import { collectCoreStatus } from "./status.ts";
import {
  collectLibResidue,
  coreVerifyAction,
  expandWorkspaceGlob,
  libResidueFindings,
  parseWorkspaceGlobs,
} from "./verify.ts";

// ── 极简断言 ────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`,
    );
  }
}

function assertIncludes(haystack: string[], needle: string, msg: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(
      `断言失败：${msg}\n  期望包含 ${JSON.stringify(needle)}\n  实际 ${JSON.stringify(haystack)}`,
    );
  }
}

function assertExcludes(haystack: string[], needle: string, msg: string): void {
  if (haystack.includes(needle)) {
    throw new Error(
      `断言失败：${msg}\n  不该包含 ${JSON.stringify(needle)}\n  实际 ${JSON.stringify(haystack)}`,
    );
  }
}

// ── fixture 工具 ────────────────────────────────────────────────────

const HAS_GIT = (() => {
  try {
    return new Deno.Command("git", { args: ["--version"], stdout: "piped", stderr: "piped" })
      .outputSync().code === 0;
  } catch {
    return false;
  }
})();

/** 在指定仓库里跑 git（自带测试身份，关掉可能存在的全局 gpg 签名）。 */
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

/** 按 POSIX 相对路径写文件（自动建父目录）。 */
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

/**
 * AC-C1 fixture：带 apps/cli 判据 + 真 git 仓库 + 构建记录的迷你源码树。
 * - stale：构建记录里的 commit 与 HEAD 不一致 → 应判「需要完成更新」
 * - fresh：构建记录与 HEAD 一致 → 不应误报
 */
function makeCoreFixture(mode: "stale" | "fresh"): string {
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
  sh(root, "add", "package.json", "apps/cli/package.json");
  sh(root, "commit", "-m", "init");

  const commit = mode === "fresh" ? gitHead(root) : "0000000000000000000000000000000000000000";
  writeFile(
    root,
    ".dsh-build/client-build-environment.json",
    JSON.stringify({
      formatVersion: 1,
      environment: { DSH_CLIENT_COMMIT_HASH: commit, DSH_CLIENT_VERSION: "0.0.9-fixture" },
      artifacts: { fileCount: 1, sha256: "fixture" },
    }),
  );
  return root;
}

/**
 * AC-C4 阳性 fixture —— 每个目录都是一种判据场景：
 *   apps/real          HEAD 有 ∧ 磁盘有        → 正常，三筐都不进
 *   apps/ghost         HEAD 无 ∧ 磁盘无包 ∧ 有 lib → 僵尸（三条件齐）
 *   packages/gone      HEAD 有 ∧ 磁盘无包 ∧ 有 lib → 真缺失（HEAD 有包 → 绝不能报成僵尸）
 *   packages/newpkg    HEAD 无 ∧ 磁盘有包 ∧ 有 lib → 未提交（磁盘有包 → 绝不能报成僵尸）
 *   apps/empty         HEAD 无 ∧ 磁盘无包 ∧ 无 lib → 三条件缺一，静默（无产物可炸）
 *   apps/.hidden / *_tmp_* / *_20260924_110135 → 已知残留形态，展开时就跳过，不进任何筐
 */
function makeLibFixture(): string {
  const root = Deno.makeTempDirSync();
  writeFile(root, "package.json", JSON.stringify({ name: "fixture-libs", version: "0.0.0" }));
  writeFile(root, "pnpm-workspace.yaml", "packages:\n  - \"apps/*\"\n  - 'packages/*' # 包目录\n");
  writeFile(root, "apps/real/package.json", JSON.stringify({ name: "real-pkg" }));
  writeFile(root, "packages/gone/package.json", JSON.stringify({ name: "gone-pkg" }));

  sh(root, "init", "-b", "main");
  sh(
    root,
    "add",
    "package.json",
    "pnpm-workspace.yaml",
    "apps/real/package.json",
    "packages/gone/package.json",
  );
  sh(root, "commit", "-m", "init");

  // 模拟上游删包后的现场：被跟踪的 package.json 没了，gitignore 的 lib/ 留着
  Deno.removeSync(p(root, "packages", "gone"), { recursive: true });
  writeFile(root, "packages/gone/lib/index.js", "module.exports = {};\n");

  // 三条件齐的真僵尸
  writeFile(root, "apps/ghost/lib/index.js", "module.exports = {};\n");
  // 缺一条件：目录还在但没有产物可炸
  Deno.mkdirSync(p(root, "apps", "empty"), { recursive: true });
  // 缺一条件：磁盘有 package.json（用户正在写的新包，哪怕带 lib 也不许判死）
  writeFile(root, "packages/newpkg/package.json", JSON.stringify({ name: "newpkg" }));
  writeFile(root, "packages/newpkg/lib/index.js", "module.exports = {};\n");
  // 已知残留形态：展开阶段就该被跳过
  writeFile(root, "apps/.hidden/lib/index.js", "module.exports = {};\n");
  writeFile(root, "apps/real_tmp_1248_8/lib/index.js", "module.exports = {};\n");
  writeFile(root, "apps/legacy_20260924_110135/lib/index.js", "module.exports = {};\n");
  return root;
}

/** 阴性总闸 fixture：一切对齐的健康源码树（含正经产物 lib/）。 */
function makeHealthyLibFixture(): string {
  const root = Deno.makeTempDirSync();
  writeFile(root, "package.json", JSON.stringify({ name: "fixture-healthy", version: "0.0.0" }));
  writeFile(root, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n');
  writeFile(root, "apps/real/package.json", JSON.stringify({ name: "real-pkg" }));
  writeFile(root, "apps/real/lib/index.js", "module.exports = {};\n"); // 有包的产物是正经东西
  sh(root, "init", "-b", "main");
  sh(root, "add", "package.json", "pnpm-workspace.yaml", "apps/real/package.json");
  sh(root, "commit", "-m", "init");
  return root;
}

function fakeCtx(): ActionContext {
  return {
    jobId: "test-core-verify",
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

// ══ AC-C1：3 秒钉子 ═══════════════════════════════════════════════

Deno.test("AC-C1：HEAD 与构建记录不一致时，3 秒内给出「需要完成更新」结论", async () => {
  if (!HAS_GIT) return;
  const root = makeCoreFixture("stale");
  try {
    const t0 = Date.now();
    const status = await withDshWebDir(root, () => collectCoreStatus());
    const elapsed = Date.now() - t0;

    assert(status.needsFinishUpdate, "构建记录与 HEAD 不一致，必须判「需要完成更新」");
    assert(
      status.finishReason !== null && status.finishReason.includes("构建"),
      `结论必须说清原因，实际：${status.finishReason}`,
    );
    const hit = status.findings.find((f) => f.id === "core.needs-finish-update");
    assert(hit !== undefined, "必须给出 core.needs-finish-update 发现（带四要素）");
    assertEq(hit?.severity, "error", "该发现必须是 error 级");
    assert(elapsed < 3000, `结论必须在 3 秒内给出，实际耗时 ${elapsed}ms`);
  } finally {
    removeAll(root);
  }
});

Deno.test("AC-C1 阴性：构建记录与 HEAD 一致时不许误报需要更新", async () => {
  if (!HAS_GIT) return;
  const root = makeCoreFixture("fresh");
  try {
    const status = await withDshWebDir(root, () => collectCoreStatus());
    assert(
      !status.needsFinishUpdate,
      `源码与产物一致却被报成需要更新，finishReason=${status.finishReason}`,
    );
    assert(
      !status.findings.some((f) => f.id === "core.needs-finish-update"),
      "健康样本零命中：不得出现 core.needs-finish-update",
    );
  } finally {
    removeAll(root);
  }
});

// ══ AC-C4：僵尸 lib 三条件 ════════════════════════════════════════

Deno.test("AC-C4：僵尸 lib / 真缺失 / 未提交三个筐各归各，绝不混报", async () => {
  if (!HAS_GIT) return;
  const root = makeLibFixture();
  try {
    const libs = await collectLibResidue(root);
    assert(libs !== null, "git 仓库应能读出 HEAD");
    if (!libs) return;

    // 篮子内容精确匹配
    assertEq(libs.zombieLibs.length, 1, "应恰好报 1 处僵尸");
    assertEq(libs.zombieLibs[0]?.pkgDir, "apps/ghost", "僵尸判错对象");
    assertEq(libs.zombieLibs[0]?.libPath, "apps/ghost/lib", "僵尸证据路径错误");
    assertEq(libs.missingPackages.length, 1, "应恰好报 1 个真缺失");
    assertIncludes(libs.missingPackages, "packages/gone", "真缺失判错对象");
    assertEq(libs.untrackedPackages.length, 1, "应恰好报 1 个未提交包");
    assertIncludes(libs.untrackedPackages, "packages/newpkg", "未提交判错对象");

    // 互斥不混报（按构造，这里显式钉死）
    const zombieDirs = libs.zombieLibs.map((z) => z.pkgDir);
    assertExcludes(
      zombieDirs,
      "packages/gone",
      "HEAD 有包的目录绝不能报成僵尸（尽管磁盘留着 lib/）",
    );
    assertExcludes(libs.missingPackages, "apps/ghost", "HEAD 没有的目录绝不能报成真缺失");
    assertExcludes(zombieDirs, "packages/newpkg", "磁盘有包的目录绝不能报成僵尸（用户正在写）");
    for (const z of zombieDirs) assertExcludes(libs.missingPackages, z, "僵尸与缺失必须互斥");

    // 三条件缺一不报、已知残留不报
    assertExcludes(zombieDirs, "apps/empty", "没有 lib/ 的目录不是僵尸（缺第一条件）");
    assertExcludes(zombieDirs, "apps/.hidden", "隐藏目录不该被枚举进来");
    assertExcludes(zombieDirs, "apps/real_tmp_1248_8", "pnpm 暂存形态不该被报成僵尸");
    assertExcludes(zombieDirs, "apps/legacy_20260924_110135", "日期戳残留不该被报成僵尸");
    assertExcludes(zombieDirs, "apps/real", "正经包的产物不是僵尸");

    // globs 解析与展开计数
    assertEq(libs.patterns.length, 2, "应解析出 2 条 globs");
    assertIncludes(libs.patterns, "apps/*", "globs 解析错误");
    assertIncludes(libs.patterns, "packages/*", "globs 解析错误");
    assert(libs.headPackages >= 3, `HEAD 包数应 >= 3，实际 ${libs.headPackages}`);

    // findings 翻译：该升级成 error 的升级、该留 info 的留 info
    const findings = libResidueFindings(libs);
    const ids = findings.map((f) => f.id).sort();
    assertEq(
      ids.join(","),
      "core.missing-package,core.untracked-package,core.zombie-lib",
      "findings 集合不对",
    );
    assertEq(healthOf(findings), "error", "有僵尸与缺失，结论必须是 error");
    const z = findings.find((f) => f.id === "core.zombie-lib");
    assertEq(z?.severity, "error", "僵尸必须是 error 级");
    assertEq(z?.fixAction, "core.finishUpdate", "僵尸必须给一键修复入口");
    assertIncludes(z?.evidence ?? [], "apps/ghost/lib", "僵尸 finding 必须带证据");
    const u = findings.find((f) => f.id === "core.untracked-package");
    assertEq(u?.severity, "info", "未提交包只许提示");
    assert(u?.fixAction === undefined, "未提交包不许给一键修复（可能误删用户正在写的东西）");
  } finally {
    removeAll(root);
  }
});

Deno.test("AC-C4 阴性总闸：健康源码树上三筐全空、findings 为零", async () => {
  if (!HAS_GIT) return;
  const root = makeHealthyLibFixture();
  try {
    const libs = await collectLibResidue(root);
    assert(libs !== null, "git 仓库应能读出 HEAD");
    if (!libs) return;
    assertEq(libs.zombieLibs.length, 0, "健康样本不得报僵尸");
    assertEq(libs.missingPackages.length, 0, "健康样本不得报缺失");
    assertEq(libs.untrackedPackages.length, 0, "健康样本不得报未提交");
    const findings = libResidueFindings(libs);
    assertEq(
      findings.length,
      0,
      `健康样本必须零 findings，实际：${JSON.stringify(findings.map((f) => f.id))}`,
    );
    assertEq(healthOf(findings), "ok", "健康样本结论必须是 ok");
  } finally {
    removeAll(root);
  }
});

Deno.test("AC-C4 降级：空 git 仓库（读不到 HEAD）返回 null 而不是硬报错", async () => {
  if (!HAS_GIT) return;
  const root = Deno.makeTempDirSync();
  try {
    sh(root, "init", "-b", "main"); // 有仓库但没有任何提交 → ls-tree HEAD 必失败
    const libs = await collectLibResidue(root);
    assertEq(libs, null, "读不到 HEAD 应返回 null，由调用方降级");
  } finally {
    removeAll(root);
  }
});

// ══ globs 解析与展开 ══════════════════════════════════════════════

Deno.test("parseWorkspaceGlobs：引号、注释、段边界都要处理对", () => {
  const yaml = [
    "packages:",
    '  - "apps/*"',
    "  - 'packages/*'   # 包目录",
    "  - tools/*",
    "otherKey:",
    '  - "should-not-be-picked"',
    "",
  ].join("\n");
  const globs = parseWorkspaceGlobs(yaml);
  assertEq(globs.length, 3, `应解析出 3 条，实际 ${JSON.stringify(globs)}`);
  assertIncludes(globs, "apps/*", "双引号未剥离");
  assertIncludes(globs, "packages/*", "单引号或注释未处理");
  assertIncludes(globs, "tools/*", "普通条目丢失");
  assertExcludes(globs, "should-not-be-picked", "段边界失效，吃到了别的键");

  assertEq(parseWorkspaceGlobs("name: whatever\n").length, 0, "没有 packages 段应返回空");
  assertEq(parseWorkspaceGlobs("").length, 0, "空文件应返回空");
  assertEq(parseWorkspaceGlobs('packages:\n  # - "commented"\n').length, 0, "注释行不该被收进来");
});

Deno.test("expandWorkspaceGlob：展开按段进行，跳过隐藏与已知残留形态", () => {
  if (!HAS_GIT) return; // 复用 fixture 的 git 初始化开销不必要，这里只测目录枚举
  const root = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(p(root, "apps", "real"), { recursive: true });
    Deno.mkdirSync(p(root, "apps", "ghost"), { recursive: true });
    Deno.mkdirSync(p(root, "apps", ".cache"), { recursive: true });
    Deno.mkdirSync(p(root, "apps", "nan_tmp_1248_8"), { recursive: true });
    Deno.mkdirSync(p(root, "apps", "dshmarket_20260924_110135"), { recursive: true });
    Deno.mkdirSync(p(root, "tools"), { recursive: true });

    const apps = expandWorkspaceGlob(root, "apps/*").sort();
    assertEq(apps.join(","), "apps/ghost,apps/real", `展开结果不对：${JSON.stringify(apps)}`);

    // 字面段不要求存在（后续 isDir/isFile 安全返回 false）
    const literal = expandWorkspaceGlob(root, "apps/real");
    assertEq(literal.join(","), "apps/real", "字面段应原样返回");
    const missing = expandWorkspaceGlob(root, "nope/xx");
    assertEq(missing.join(","), "nope/xx", "不存在的字面段也应返回（交给后续检查判空）");

    // 根段 * 展开（注意别把隐藏目录与残留带进来）
    const top = expandWorkspaceGlob(root, "*").sort();
    assertEq(top.join(","), "apps,tools", `根展开不对：${JSON.stringify(top)}`);
  } finally {
    removeAll(root);
  }
});

// ══ core.verify 动作冒烟（经 action 入口复核 AC-C1 结论） ═════════

Deno.test("core.verify 动作：完整跑通并携带 AC-C1 结论与残留判定", async () => {
  if (!HAS_GIT) return;
  const stale = makeCoreFixture("stale");
  try {
    const report = await withDshWebDir(
      stale,
      () => coreVerifyAction.run(fakeCtx(), {} as Record<string, never>),
    );

    assert(report.sourceRoot !== null, "应定位到源码树");
    assert(report.status !== null, "应携带 core.status 结论");
    assert(report.status?.needsFinishUpdate === true, "AC-C1 结论必须随 verify 一起给出");
    assert(report.libs !== null, "应执行残留检测");
    assertEq(report.libs?.zombieLibs.length, 0, "fixture 干净，不该有僵尸");
    assertEq(report.libs?.missingPackages.length, 0, "fixture 干净，不该有缺失");
    assert(
      report.findings.some((f) => f.id === "core.needs-finish-update"),
      "findings 应含 AC-C1 的结论",
    );
    assertEq(report.health, "error", "有待完成更新结论时 health 必须是 error");
    assert(report.elapsedMs < 5000, `动作整体应远快于超时线，实际 ${report.elapsedMs}ms`);
  } finally {
    removeAll(stale);
  }
});

Deno.test("core.verify 动作：残留检测被跳过时给出降级 finding 而不是崩溃", async () => {
  if (!HAS_GIT) return;
  const root = Deno.makeTempDirSync();
  try {
    // 造一个能通过 resolveDshSourceRoot、但 git 读不到 HEAD 的树
    Deno.mkdirSync(p(root, "apps", "cli"), { recursive: true });
    writeFile(root, "package.json", JSON.stringify({ name: "fixture-nohead", version: "0.0.0" }));
    sh(root, "init", "-b", "main"); // 无提交

    const report = await withDshWebDir(
      root,
      () => coreVerifyAction.run(fakeCtx(), {} as Record<string, never>),
    );
    assertEq(report.libs, null, "读不到 HEAD 时 libs 应为 null");
    const hit = report.findings.find((f) => f.id === "core.no-head");
    assert(hit !== undefined, "必须给出 core.no-head 降级提示");
    assertEq(hit?.severity, "warn", "降级应是 warn 级");
  } finally {
    removeAll(root);
  }
});
