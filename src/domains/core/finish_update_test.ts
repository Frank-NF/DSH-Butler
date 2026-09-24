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
