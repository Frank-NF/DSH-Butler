/**
 * core.finishUpdate 的判据回归测试（AC-C2）。
 *
 * 覆盖的是「重试还是报错」这条分岔路——判错的两种结局都很难受：
 *   - 把真错误当瞬断重试：用户对着必然失败的重编干等三轮（每次 5-20 分钟）；
 *   - 把瞬断当真错误报出：Windows 上 rolldown 并发写的 os error 5 会把用户吓退，
 *     而它重试一次基本就过（2026-09-23 本体重建实测）。
 * 另外钉住六步清单与动作安全装备（preflight + steps 是写动作的准入门槛）。
 *
 * 这些全是纯函数/静态结构，不需要 git 也不碰文件系统——任何环境都能跑。
 */

import { stageSafetyProblems } from "../../jobs/registry.ts";
import { dirname, p } from "../../util/paths.ts";
import {
  explainBuildFailure,
  hasRealBuildError,
  readBuildState,
  restoreBuildRecord,
  snapshotBuildRecord,
  summarizeBuildFailure,
  writeBuildState,
} from "./build_state.ts";
import {
  coreFinishUpdateAction,
  FINISH_STEPS,
  isTransientBuildFailure,
  pickBuildErrors,
} from "./finish_update.ts";

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

function removeAll(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      Deno.removeSync(d, { recursive: true });
    } catch { /* 已删则忽略 */ }
  }
}

function assertIncludes(haystack: string[], needle: string, msg: string): void {
  if (!haystack.some((l) => l.includes(needle))) {
    throw new Error(
      `断言失败：${msg}\n  期望包含 ${JSON.stringify(needle)}\n  实际 ${JSON.stringify(haystack)}`,
    );
  }
}

// ══ 瞬断判定：什么时候值得重试 ═════════════════════════════════════

Deno.test("瞬断判定：纯 os error 5 / 拒绝访问 → 重试；混入真错误 → 绝不重试", () => {
  // 纯瞬断（Windows 并发写的典型现场）→ 重试
  assert(
    isTransientBuildFailure(
      "rolldown: failed to write dist/index.js\ncaused by: 拒绝访问 (os error 5)",
    ),
    "纯瞬断应判定为可重试",
  );
  assert(isTransientBuildFailure("somefile.o: os error 5"), "只有 os error 5 也应可重试");

  // 瞬断打头 + 真错误在后（真实日志的常见形态：瞬断先炸，真错误被挡在后面）
  assert(
    !isTransientBuildFailure("拒绝访问 (os error 5)\nerror TS2307: Cannot find module './ghost'"),
    "混入类型错误绝不许重试（重试也过不了）",
  );
  assert(
    !isTransientBuildFailure("os error 5\n[MISSING_EXPORT] SettingsProvider is not exported"),
    "混入 MISSING_EXPORT 绝不许重试",
  );
  assert(
    !isTransientBuildFailure("os error 5\nCannot find module 'tsx'"),
    "混入找不到模块绝不许重试",
  );

  // 没有瞬断特征 → 不重试（走正常报错）
  assert(!isTransientBuildFailure("error TS1005: ';' expected."), "纯类型错误不该重试");
  assert(!isTransientBuildFailure(""), "空日志不该被当成瞬断");
});

// ══ 报错挑拣：把真错误从噪音里捞出来 ═══════════════════════════════

Deno.test("报错挑拣：五类模式命中、去重保序、噪音不收", () => {
  const log = [
    "info: building packages/client…",
    "ERROR [MISSING_EXPORT] 'SettingsProvider' is not exported by src/index.ts", // ① 命中
    "info: still building…", // 噪音
    "src/agent/inbox.ts(12,5): error TS2345: Argument of type 'string' is not assignable.", // ② 命中
    "warning: something about chunks", // 噪音
    "error: Failed to write file dist/lib/index.js", // ③ 命中
    "无法打开 E:\\work\\a.ts: 拒绝访问", // ④ 命中
    "Cannot find module './missing-impl'", // ⑤ 命中
    "ERROR [MISSING_EXPORT] 'SettingsProvider' is not exported by src/index.ts", // 重复行
    "", // 空行
  ].join("\n");

  const errs = pickBuildErrors(log);
  assertEq(errs.length, 5, "五类模式各一行，重复行去重");
  assertIncludes(errs, "MISSING_EXPORT", "缺导出必须被挑出");
  assertIncludes(errs, "error TS2345", "类型错误必须被挑出");
  assertIncludes(errs, "Failed to write file", "写文件失败必须被挑出");
  assertIncludes(errs, "拒绝访问", "拒绝访问必须被挑出");
  assertIncludes(errs, "Cannot find module", "找不到模块必须被挑出");
  assert(!errs.some((l) => l.includes("building")), "构建进度噪音不许进报错清单");
  assert(!errs.some((l) => l.includes("warning")), "警告不许进报错清单");

  // 保序：第一条命中的排最前
  assert(errs[0]?.includes("MISSING_EXPORT"), "应保持日志里的原始顺序（第一条命中在最前）");

  // 全无命中 → 空数组（调用方会退化为展示最后 N 行）
  assertEq(pickBuildErrors("all good\nnothing to see here").length, 0, "无命中应返回空数组");
  assertEq(pickBuildErrors("").length, 0, "空日志应返回空数组");
});

// ══ 六步清单与动作安全装备 ═════════════════════════════════════════

Deno.test("六步清单：顺序固定且是单一事实来源", () => {
  assertEq(FINISH_STEPS.length, 6, "必须是六步");
  assertEq(coreFinishUpdateAction.steps?.length, 6, "动作声明的步骤必须与清单一致");
  assertEq(
    coreFinishUpdateAction.steps?.[0],
    FINISH_STEPS[0],
    "动作步骤必须直接引用清单（单一事实来源）",
  );
  assert(coreFinishUpdateAction.steps?.[1]?.includes("清理"), "第 2 步必须是清理残留");
  assert(coreFinishUpdateAction.steps?.[3]?.includes("全量重建"), "第 4 步必须是全量重建");
  assert(coreFinishUpdateAction.steps?.[5]?.includes("重启"), "第 6 步必须是重启服务");
});

Deno.test("写动作准入：core.finishUpdate 带齐 preflight + steps，防呆零问题", () => {
  assertEq(coreFinishUpdateAction.readonly, false, "这是写动作");
  assert(
    typeof coreFinishUpdateAction.preflight === "function",
    "写动作必须有 preflight（写前检查）",
  );
  assert((coreFinishUpdateAction.steps?.length ?? 0) > 0, "写动作必须声明步骤");
  assert(
    (coreFinishUpdateAction.timeoutMs ?? 0) >= 3_600_000,
    "六步最坏预算必须比默认 jobTotal 宽（构建 3 次重试可能到 1.5 小时以上）",
  );
  assertEq(
    stageSafetyProblems([coreFinishUpdateAction as never]).length,
    0,
    "阶段安全防呆必须零问题",
  );
});

// ══ 2026-10-04 事故日志：真错误要捞得出来、还要说成人话 ═════════════

Deno.test("报错挑拣：ENOENT / Build failed with / 退出码 —— 真事故日志不再只剩栈帧", () => {
  const accident = [
    "ERROR  Error: Build failed with 1 error:",
    "Error: ENOENT: no such file or directory, open 'C:\\Users\\niufe\\DeepSeek_Harness\\packages\\client\\ui-dashboard\\src\\client\\index.ts'",
    "    at async runCLI (file:///C:/Users/niufe/DeepSeek_Harness/node_modules/.pnpm/tsdown@0.22.2/dist/run.mjs:45:3)",
    "    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)",
    "[ELIFECYCLE] Command failed with exit code 1.",
  ].join("\n");

  const errs = pickBuildErrors(accident);
  assertIncludes(errs, "ENOENT", "缺文件必须被挑出来（旧版五类模式全不中，用户只看到栈帧）");
  assertIncludes(errs, "Build failed with 1 error", "打包器的总结行也要挑出来");
  assertIncludes(errs, "Command failed with exit code", "退出码行也要挑出来");
  assert(!errs.some((l) => l.includes("at async runCLI")), "纯栈帧不算报错行");

  assert(hasRealBuildError(accident), "ENOENT 是「重试也没用」的真错误");
  assert(!isTransientBuildFailure(accident), "缺文件绝不许当成瞬断去重试三轮");

  const why = explainBuildFailure(errs, accident);
  assert(why !== null, "必须给出人话解释（否则用户还是只能看到一串栈帧）");
  assert(why!.includes("不存在的文件"), `解释要先说清是什么事：${why}`);
  assert(why!.includes("ui-dashboard") && why!.includes("index.ts"), `解释要点出具体文件：${why}`);
  assert(why!.includes("隔离区"), "解释要给出能动手的下一步（去隔离区搬回来）");

  const most = summarizeBuildFailure(errs, accident);
  assert(most.includes("ENOENT"), `一句话结论要挑最具体的真错误，不能是打包器的总结行：${most}`);
  assert(!most.includes("ELIFECYCLE"), "包管理器的总结行不许当结论");
  assertEq(
    summarizeBuildFailure(["ELIFECYCLE  Command failed with exit code 1."], ""),
    "ELIFECYCLE  Command failed with exit code 1.",
    "只有总结行时也得给出点什么（不能返回空）",
  );
});

Deno.test("瞬断判定补充：真瞬断也打 Build failed with，不能因此放弃重试", () => {
  assert(
    isTransientBuildFailure("拒绝访问 (os error 5)\nERROR  Error: Build failed with 1 error:"),
    "真瞬断时 rolldown 也会打这句，必须仍然重试",
  );
  assert(!hasRealBuildError("拒绝访问 (os error 5)\nBuild failed with 1 error:"), "这句不算真错误");
});

// ══ 构建记录抢救：失败之后别再制造「缺记录」催办 ═══════════════════

Deno.test("构建记录抢救：建之前留底、失败后放回，缺记录不再由失败制造", () => {
  const base = Deno.makeTempDirSync();
  try {
    assertEq(snapshotBuildRecord(base), null, "没有记录时留底为 null");
    assertEq(restoreBuildRecord(base, null), null, "没有留底就不许伪造记录");

    const full = p(base, ".dsh-build", "client-build-environment.json");
    Deno.mkdirSync(dirname(full), { recursive: true });
    const original = '{"formatVersion":1,"environment":{"DSH_CLIENT_COMMIT_HASH":"abc1234"}}\n';
    Deno.writeTextFileSync(full, original);

    const saved = snapshotBuildRecord(base);
    assertEq(saved, original, "留底必须是原文");
    assertEq(restoreBuildRecord(base, saved), null, "记录还在（构建没删它）就什么都不做");

    Deno.removeSync(full); // 模拟 scripts/build.ts:47 动手前先 rmSync 掉记录
    const note = restoreBuildRecord(base, saved);
    assert(note !== null && note.includes("构建记录"), `放回时要给出人话说明：${note}`);
    assertEq(Deno.readTextFileSync(full), original, "构建记录必须原样回到原位");
  } finally {
    removeAll(base);
  }
});

// ══ 台账：失败留下可读痕迹，坏文件不许炸 ═══════════════════════════

Deno.test("台账：写入/读回/坏文件容错/错误行截断", () => {
  const base = Deno.makeTempDirSync();
  try {
    assertEq(readBuildState(base), null, "没有台账 → null");
    writeBuildState({
      ok: false,
      at: "",
      root: "R:\\dsh",
      commit: null,
      errors: ["ENOENT: xxx", "Build failed with 1 error"],
      summary: "退出码 1：ENOENT: xxx",
    }, base);
    const back = readBuildState(base);
    assert(back !== null, "写进去必须读得回来");
    assertEq(back!.ok, false, "ok 要原样保留");
    assert(back!.at.length > 0, "没给时间戳时要自动补上");
    assertEq(back!.summary, "退出码 1：ENOENT: xxx", "一句话结论要保留");
    assertEq(back!.errors.length, 2, "错误行要保留");

    writeBuildState({
      ok: false,
      at: "2026-10-04T15:27:26.000Z",
      root: "R:\\dsh",
      commit: "5badb15",
      errors: Array.from({ length: 20 }, (_, i) => `err ${i}`),
      summary: "很多错误",
    }, base);
    assertEq(readBuildState(base)!.errors.length, 12, "错误行最多留 12 条（台账不该无限长）");

    Deno.writeTextFileSync(p(base, "last-build.json"), "{ 这不是 JSON");
    assertEq(readBuildState(base), null, "坏文件必须返回 null 而不是抛");
    Deno.writeTextFileSync(p(base, "last-build.json"), '{"summary":"缺 ok 字段"}');
    assertEq(readBuildState(base), null, "字段不对也要当没有");

    writeBuildState({ ok: true, at: "2026-10-04T00:00:00.000Z", root: "R:", commit: "abc", errors: [], summary: "全量重建完成。" }, base);
    assertEq(readBuildState(base)!.ok, true, "成功也要记（状态页据此区分「上次是失败」）");
  } finally {
    removeAll(base);
  }
});

