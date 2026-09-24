/**
 * bootstrap.plan 的守据测试。
 *
 * 两条最重要的性质：
 *   ① 【零副作用】plan 连跑多次不许改动任何文件 —— AC-B2 的"跑 100 次不产生文件变更"。
 *      历史上最容易破功的地方是 resolveDshSourceRoot 的调用方 env.probe 会写
 *      ~/.dsh/web-dir 缓存，所以这里直接盯着那个文件。
 *   ② 步骤表是单一事实来源（steps 与 BOOTSTRAP_STEPS 一一对应），改一处不会漏另一处。
 */

import { assert, assertEquals } from "@std/assert";
import { collectBootstrapPlan } from "./plan.ts";
import { BOOTSTRAP_STEPS, bootstrapApplyAction } from "./apply.ts";
import { bootstrapVerifyAction } from "./verify.ts";
import { stageSafetyProblems } from "../../jobs/registry.ts";

const WEB_DIR_CACHE = `${Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME")}\\.dsh\\web-dir`;

function cacheStamp(): string {
  try {
    const st = Deno.statSync(WEB_DIR_CACHE);
    return `${st.mtime?.getTime() ?? 0}|${st.size}`;
  } catch {
    return "absent";
  }
}

Deno.test("AC-B2：plan 连跑 3 次零副作用（DSH 根目录缓存不许被动过）", async () => {
  const before = cacheStamp();
  const first = await collectBootstrapPlan({});
  await collectBootstrapPlan({});
  const third = await collectBootstrapPlan({});
  const after = cacheStamp();
  assertEquals(after, before, "plan 改动了 ~/.dsh/web-dir 缓存 —— 它必须是纯只读的");
  assertEquals(first.targetRoot, third.targetRoot, "同一台机器上目标目录必须稳定");
  assertEquals(first.steps.length, third.steps.length, "步骤数必须稳定");
});

Deno.test("步骤表自洽：数量与写操作对齐、id 不重复、关键动作能被用户看见", async () => {
  const plan = await collectBootstrapPlan({});
  assertEquals(plan.steps.length, BOOTSTRAP_STEPS.length, "计划步骤数与写操作步骤数不一致");
  const ids = new Set<string>();
  plan.steps.forEach((s, i) => {
    assert(s.id.length > 0, `第 ${i + 1} 步缺少 id`);
    assert(s.title.length > 0, `第 ${i + 1} 步缺少标题`);
    assertEquals(ids.has(s.id), false, `步骤 id 重复：${s.id}`);
    ids.add(s.id);
  });
  // 计划页必须把"到底要干什么命令"讲出来，否则用户点确认时并不知道会发生什么
  assert(
    plan.steps.some((s) => s.detail.includes("pnpm run build")),
    "计划里没有写清楚要跑构建",
  );
  assert(plan.steps.some((s) => s.detail.includes("git")), "计划里没有写清楚要拉源码");
});

Deno.test("估算口径自洽：下载量 > 0、占用盘 > 下载量、时间区间不倒挂", async () => {
  const plan = await collectBootstrapPlan({});
  assert(plan.estimates.downloadBytes >= 1500 * 1024 * 1024, "下载量估算偏低（方案口径约 1.6 GB）");
  assert(
    plan.estimates.diskBytes > plan.estimates.downloadBytes,
    "占用盘应当大于下载量（解压 + 构建产物）",
  );
  assert(
    plan.estimates.minutesMin > 0 && plan.estimates.minutesMin <= plan.estimates.minutesMax,
    "时间区间倒挂或为零",
  );
});

Deno.test("已装过本体的机器：必须报 already-installed，且裁决为 already-installed", async () => {
  const plan = await collectBootstrapPlan({});
  if (!plan.installed) return; // 干净机器上这条不适用
  assert(
    plan.blockers.some((b) => b.id === "bootstrap.already-installed"),
    "发现了既有本体，却没有阻止从零重装",
  );
  assertEquals(plan.verdict, "already-installed");
});

Deno.test("自定义安装目录会被尊重（计划页里改路径这条链路）", async () => {
  const plan = await collectBootstrapPlan({ root: "C:\\butler-plan-test\\DSH" });
  assert(
    plan.targetRoot.toLowerCase().includes("butler-plan-test"),
    `目标目录没被采用：${plan.targetRoot}`,
  );
  assertEquals(plan.verdict === "already-installed", false, "换目录后不该再报已装过");
});

Deno.test("写动作准入：apply 带齐 preflight + steps；verify 必须是只读", () => {
  assertEquals(stageSafetyProblems([bootstrapApplyAction]), [], "bootstrap.apply 的安全装备不齐");
  assertEquals(bootstrapApplyAction.readonly, false, "apply 必须是写动作");
  assertEquals(bootstrapVerifyAction.readonly, true, "verify 必须只读（跑一百次也不许改东西）");
  assertEquals(bootstrapApplyAction.steps?.length, BOOTSTRAP_STEPS.length, "步骤表长度不一致");
});
