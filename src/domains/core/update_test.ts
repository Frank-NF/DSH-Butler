/**
 * core.update 的写前检查测试（preflight + 静态装备）。
 *
 * runCoreUpdate 是真 git pull + 官方全量重建（最坏 2 小时预算），
 * 测试里跑它既慢又会碰真网络 —— 所以【只测 preflight 与静态装配】，
 * run 的语义由头注释三个语义决定 + 共享尾段（finish_update_test）兜底。
 *
 * 覆盖：
 *   1) 脏树（已跟踪文件有未提交改动）→ core.update.dirty-tree 拦截；
 *      untracked 不拦（产物类未跟踪文件是仓库常态，拦它功能永远用不了）；
 *   2) 干净树 → 不报 dirty-tree（阴性断言【按 finding id】，不断言
 *      「零 error」—— 本机 pnpm 存在与否不该被写死进断言）；
 *   3) 有 apps/cli 但不是 git 仓库 → core.finish.not-git 拦截；
 *   4) no-root 用例【不可测】：DSH_WEB_DIR 不合法会回落到本机真实源码树，
 *      断言无意义（见 fixture 注释）。
 *
 * 隔离七件套：DSH_WEB_DIR 必须指向带 apps/cli 的临时 fixture，
 * 否则 installRoot 判定被真机（G:\DeepSeek_Harness）污染。
 */

import type { Finding } from "../../util/result.ts";
import { dirname, p } from "../../util/paths.ts";
import { run } from "../../host/shell.ts";
import { stageSafetyProblems } from "../../jobs/registry.ts";
import { coreUpdateAction, UPDATE_STEPS } from "./update.ts";

// ── 极简断言 ────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
  }
}

function assertNotHas(out: Finding[], id: string, msg: string): void {
  const hit = out.find((x) => x.id === id);
  assert(!hit, `${msg}（不应报 ${id}，实际报了：${hit?.title}）`);
}

function hasError(out: Finding[], id: string): boolean {
  return out.some((x) => x.id === id && x.severity === "error");
}

// ── fixture ─────────────────────────────────────────────────────────

interface Fixture {
  root: string;
  webDir: string;
}

/**
 * 临时 git 仓库 fixture。
 * - webDir 带 apps/cli → resolveDshSourceRoot 的 isRoot 判据成立，env 生效；
 *   【不设 DSH_WEB_DIR 或设成非法值都会回落真机】—— 所以 no-root 不可测。
 * - git 用 -c 内联配置提交：不依赖构建机的 user.name / gpgsign 全局设置。
 */
async function withRepo(fn: (f: Fixture) => Promise<void>, opts: { git?: boolean } = {}): Promise<void> {
  const root = Deno.makeTempDirSync();
  const f: Fixture = { root, webDir: p(root, "dsh-src") };
  Deno.mkdirSync(p(f.webDir, "apps", "cli"), { recursive: true });

  if (opts.git !== false) {
    const git = async (...args: string[]) => {
      const r = await run("git", ["-C", f.webDir, ...args], {
        timeoutMs: 30_000,
        allowNonZero: true,
        scope: "git",
      });
      if (r.code !== 0) {
        throw new Error(`fixture git ${args.join(" ")} 失败（${r.code}）：${r.stderr || r.stdout}`);
      }
    };
    await git("init");
    writeFileP(p(f.webDir, "README.md"), "# fixture\n");
    await git("add", "-A");
    await git(
      "-c",
      "user.email=fixture@test.local",
      "-c",
      "user.name=fixture",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture init",
    );
  }

  const prevs: Array<[string, string | undefined]> = [];
  const set = (k: string, v: string) => {
    prevs.push([k, Deno.env.get(k)]);
    Deno.env.set(k, v);
  };
  set("BUTLER_PROFILE_DIR", p(root, "profile"));
  set("BUTLER_TXN_DIR", p(root, "txn"));
  set("BUTLER_ROLLBACK_DIR", p(root, "rollback"));
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

function writeFileP(full: string, text: string): void {
  // 必须用 dirname 切父目录 —— p() 不解析 ".."（os error 87）
  Deno.mkdirSync(dirname(full), { recursive: true });
  Deno.writeTextFileSync(full, text);
}

async function preUpdate(): Promise<Finding[]> {
  const fn = coreUpdateAction.preflight;
  if (!fn) throw new Error("core.update 缺少 preflight");
  return await fn({});
}

// ══ 脏检查（update 特有） ═══════════════════════════════════════════

Deno.test("preflight 脏树：已跟踪文件有未提交改动 → dirty-tree 拦截", async () => {
  await withRepo(async (f) => {
    // 改一个【已跟踪】文件（--untracked-files=no 只看已跟踪）
    writeFileP(p(f.webDir, "README.md"), "# fixture（被改过，未提交）\n");

    const out = await preUpdate();
    assert(
      hasError(out, "core.update.dirty-tree"),
      `脏树必须拦截（带本地改动重建会让产物与提交号对不上），实际：${
        out.map((x) => x.id).join("、") || "（空）"
      }`,
    );
  });
});

Deno.test("preflight 干净树：不报 dirty-tree（untracked 不算脏）", async () => {
  await withRepo(async (f) => {
    // 未跟踪的新文件：产物类未跟踪文件是仓库常态，绝不能拦
    writeFileP(p(f.webDir, "build-output.tmp"), "untracked artifact\n");

    const out = await preUpdate();
    assertNotHas(out, "core.update.dirty-tree", "干净树（含 untracked）不该被脏检查拦下");
  });
});

// ══ 基座三条（finish 共用口径） ═════════════════════════════════════

Deno.test("preflight not-git：有 apps/cli 但不是 git 仓库 → 拦截", async () => {
  await withRepo(async () => {
    // 有 apps/cli（isRoot 成立、env 生效），但没跑 git init
    const out = await preUpdate();
    // 注意：not-git / no-pnpm 在基座里不提前 return —— 断言按 id，不断言「只有它」
    assert(
      hasError(out, "core.finish.not-git"),
      `不是 git 仓库必须拦截，实际：${out.map((x) => x.id).join("、") || "（空）"}`,
    );
    // not-git 是 error → updatePreflight 在基座处就短路，脏检查不会执行
    assertNotHas(out, "core.update.dirty-tree", "基座已有 error 时不该再往下跑脏检查");
  }, { git: false });
});

// ══ 静态装备 ═══════════════════════════════════════════════════════

Deno.test("core.update 装备：八步清单单一事实来源 + 写动作准入", () => {
  assertEq(UPDATE_STEPS.length, 8, "必须是八步（铁律 9 的完整四步展开）");
  assertEq(coreUpdateAction.steps?.length, 8, "动作声明的步骤必须与清单一致");
  assertEq(
    coreUpdateAction.steps?.[0],
    UPDATE_STEPS[0],
    "动作步骤必须直接引用清单（单一事实来源）",
  );
  assert(coreUpdateAction.steps?.[1]?.includes("停止"), "第 2 步必须是停服");
  assert(coreUpdateAction.steps?.[2]?.includes("git pull --ff-only"), "第 3 步必须是 ff-only 拉取");
  assert(coreUpdateAction.steps?.[7]?.includes("重启"), "第 8 步必须是重启服务");
  assertEq(coreUpdateAction.readonly, false, "这是写动作");
  assert(typeof coreUpdateAction.preflight === "function", "写动作必须有 preflight");
  assert(
    (coreUpdateAction.timeoutMs ?? 0) >= 7_200_000,
    "八步最坏预算不能低于 2 小时（拉取 + 装依赖 + 三段构建）",
  );
  assertEq(stageSafetyProblems([coreUpdateAction as never]).length, 0, "阶段安全防呆必须零问题");
});
