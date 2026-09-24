/**
 * S3 阶段安全防呆的判据回归测试。
 *
 * S1 的旧断言是「禁止任何写动作」；S3 接管写操作后换成「写动作必须装备齐全」：
 *   readonly:false 的动作必须带 preflight（写前检查）+ 声明 steps（可展示的步骤表）。
 * 这两条防呆是 plan → confirm → apply 三段式的地基 —— 缺了 preflight，
 * 引擎第 0 步就拦不住坏前置；缺了 steps，用户点下去之前看不到它打算干什么。
 *
 * 阴阳两个方向都钉死：只读动作不该被管；装备齐全的写动作也不该被误报。
 */

import { assertStageSafety, registerAllActions, stageSafetyProblems } from "./registry.ts";
import { engine } from "./engine.ts";
import type { AnyActionDef } from "./types.ts";

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

/** 造一个最小动作定义；override 填 readonly/preflight/steps 组合。 */
function def(override: Partial<AnyActionDef>): AnyActionDef {
  return {
    name: "test.stub",
    domain: "diag",
    title: "测试桩",
    readonly: true,
    run: async () => undefined,
    ...override,
  } as AnyActionDef;
}

Deno.test("防呆：只读动作不设防——无 preflight/steps 也不报", () => {
  const problems = stageSafetyProblems([
    def({ name: "a.read", readonly: true }),
    def({ name: "b.read", readonly: true, steps: [] }),
  ]);
  assertEq(problems.length, 0, `只读动作不该被防呆拦截，实际：${problems.join("；")}`);
});

Deno.test("防呆：写动作缺 preflight 必须报（plan 的来源，缺了坏前置直接动手）", () => {
  const problems = stageSafetyProblems([
    def({ name: "core.bad", readonly: false, steps: ["做点什么"] }),
  ]);
  assertEq(problems.length, 1, `应只报 preflight 一条，实际：${problems.join("；")}`);
  const first = problems[0] ?? "";
  assert(first.includes("core.bad"), "报错必须点名是哪个动作");
  assert(first.includes("preflight"), "报错必须说明缺的是 preflight");
});

Deno.test("防呆：写动作缺 steps 必须报；两条都缺报两条", () => {
  const noSteps = stageSafetyProblems([
    def({ name: "core.nosteps", readonly: false, preflight: async () => [] }),
  ]);
  assertEq(noSteps.length, 1, `应只报 steps 一条，实际：${noSteps.join("；")}`);
  const noStepsFirst = noSteps[0] ?? "";
  assert(
    noStepsFirst.includes("core.nosteps") && noStepsFirst.includes("步骤"),
    "报错须点名动作并说明缺步骤",
  );

  const neither = stageSafetyProblems([
    def({ name: "core.bare", readonly: false }),
  ]);
  assertEq(neither.length, 2, `两条都缺应报两条，实际：${neither.join("；")}`);

  const emptySteps = stageSafetyProblems([
    def({ name: "core.empty", readonly: false, preflight: async () => [], steps: [] }),
  ]);
  assertEq(
    emptySteps.length,
    1,
    `steps 为空数组等同于没声明，应报，实际：${emptySteps.join("；")}`,
  );
});

Deno.test("防呆：装备齐全的写动作放行（阴性总闸，不许误报）", () => {
  const problems = stageSafetyProblems([
    def({ name: "core.full", readonly: false, preflight: async () => [], steps: ["检查", "执行"] }),
    def({ name: "mixed.read", readonly: true }),
  ]);
  assertEq(problems.length, 0, `齐全的写动作不该被误报，实际：${problems.join("；")}`);
});

Deno.test("防呆：真实注册表全量过检——registerAllActions 后零问题", () => {
  registerAllActions();
  const problems = stageSafetyProblems(engine.definitions());
  assertEq(
    problems.length,
    0,
    `注册表里有写动作没带安全装备：${problems.join("；")}`,
  );
  // assert 版是入口调用的那个，它也不能抛
  assertStageSafety();
});
