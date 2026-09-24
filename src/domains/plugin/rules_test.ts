/**
 * plugin.rules 的阴阳样本测试（AC-P4）。
 *
 * 每条规则都必须有【阳性样本】（该报的报）与【阴性样本】（不该报的绝不报）。
 * 样本全部手搓成 PluginFacts 纯数据 —— 不碰真实 DSH 目录（方案 §10.3）。
 *
 * 阴性基线取自 2026-09-24 真机取证：
 *   - profile cordis.patch.yml 顶层全是 targeting `- id:`（不是 insert，不许报重复注册）
 *   - @deepseek-ai/dsh-web-app 的 dsh.bundle.patch 是 5 元素数组（合法，不许报）
 *   - inBox 基座包（@deepseek-ai/*）不写 dependencies 也合法（不许报）
 */

import type { PluginListCheck } from "../core/status.ts";
import type { PluginFacts } from "./facts.ts";
import { repairBlockers, RULE_COUNT, runRules } from "./rules.ts";

// ── 极简断言（不引外部依赖，任何网络环境下都能跑） ──────────────────

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
  }
}

function noId(findings: { id: string }[], id: string, msg: string): void {
  const hits = findings.filter((f) => f.id === id);
  if (hits.length > 0) {
    throw new Error(`断言失败：${msg}\n  不该出现 ${id}，实际命中 ${hits.length} 条：${JSON.stringify(hits, null, 2)}`);
  }
}

function someId(findings: { id: string }[], id: string, msg: string): void {
  if (!findings.some((f) => f.id === id)) {
    throw new Error(`断言失败：${msg}\n  应出现 ${id}，实际：${findings.map((f) => f.id).join(", ") || "（空）"}`);
  }
}

// ── facts 工厂：健康的真机形态打底，阳性样本只改自己关心的字段 ──────

const EMPTY_LISTS: PluginListCheck = {
  dependencies: [],
  bundles: [],
  active: [],
  declaredButInactive: [],
  inBox: [],
  bundledButUndeclared: [],
};

function baseFacts(
  over: Partial<Omit<PluginFacts, "lists">> & { lists?: Partial<PluginListCheck> } = {},
): PluginFacts {
  const { lists: listOver, ...rest } = over;
  return {
    profileDir: "C:\\Users\\niufe\\.dsh\\profiles\\web",
    manifestExists: true,
    lists: { ...EMPTY_LISTS, ...listOver },
    depEntries: {},
    layers: [],
    inactiveLayers: [],
    profilePatchInsertIds: [],
    bundlePatchInsertIds: [],
    residue: [],
    locks: [],
    checkedAt: "2026-09-24T00:00:00.000Z",
    ...rest,
  };
}

/** 一个「健康真机」基线：阴性样本用它，跑全库必须零命中。 */
function healthyFacts(): PluginFacts {
  return baseFacts({
    lists: {
      // 真机形态：inBox 基座包在 bundles 里、不写 dependencies —— 合法
      dependencies: ["dsh-cost-meter", "dshmarket"],
      bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-cost-meter", "dshmarket"],
      active: ["dsh-cost-meter", "dshmarket"],
      inBox: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    },
    depEntries: { "dsh-cost-meter": "^1.2.3", dshmarket: "^0.5.0" },
    layers: [
      // 真机形态：web-app 的 patch 是 5 元素数组 —— 合法，不许报 not-a-layer
      { name: "@deepseek-ai/dsh-web-app", dir: "G:\\DeepSeek_Harness\\node_modules\\@deepseek-ai\\dsh-web-app", canLayer: true, reason: null, patchFiles: ["a.patch.yml", "b.patch.yml", "c.patch.yml", "d.patch.yml", "e.patch.yml"] },
      { name: "dshmarket", dir: "C:\\Users\\niufe\\.dsh\\profiles\\web\\node_modules\\dshmarket", canLayer: true, reason: null, patchFiles: ["./cordis.patch.yml"] },
    ],
    // 真机形态：profile 顶层 targeting 的 id 不会进这里（extractInsertIds 只认 insert 块）
    profilePatchInsertIds: [],
    bundlePatchInsertIds: [{ pkg: "dshmarket", patchFile: "./cordis.patch.yml", ids: ["dsh-market"] }],
    locks: [{ path: "C:\\Users\\niufe\\.dsh\\profiles\\web\\config.lock", firstLine: "12345", pid: 12345, alive: true, procName: "node.exe", verdict: "held" }],
  });
}

// ══ 总门槛：≥10 条规则（AC-P4 前提） ═══════════════════════════════

Deno.test("规则库总数 ≥ 10（AC-P4 门槛）", () => {
  assert(RULE_COUNT >= 10, `当前只有 ${RULE_COUNT} 条规则`);
});

// ══ 全局阴性基线：健康机器跑全库必须零命中 ═════════════════════════

Deno.test("阴性总闸：健康真机形态跑全库，一条都不许报（防误报）", () => {
  const findings = runRules(healthyFacts());
  assertEq(findings.length, 0, `健康样本出现了误报：${JSON.stringify(findings, null, 2)}`);
});

// ══ 1. plugin.manifest-missing ═════════════════════════════════════

Deno.test("manifest-missing：阳性 —— package.json 缺失要报 error", () => {
  const out = runRules(baseFacts({ manifestExists: false }));
  someId(out, "plugin.manifest-missing", "manifest 缺失未报");
  assertEq(out.find((f) => f.id === "plugin.manifest-missing")?.severity, "error", "应为 error 级");
});

Deno.test("manifest-missing：阴性 —— manifest 正常时不报", () => {
  noId(runRules(baseFacts({ manifestExists: true })), "plugin.manifest-missing", "manifest 正常却报了");
});

// ══ 2. plugin.declared-but-inactive（AC-P1 核心） ══════════════════

Deno.test("AC-P1：装了插件但未进 bundles，diagnose 必须指出原因", () => {
  const facts = baseFacts({
    lists: {
      dependencies: ["dsh-cost-meter"],
      bundles: [],
      declaredButInactive: ["dsh-cost-meter"],
    },
    inactiveLayers: [
      { name: "dsh-cost-meter", dir: "C:\\x\\node_modules\\dsh-cost-meter", canLayer: true, reason: null, patchFiles: ["./cordis.patch.yml"] },
    ],
  });
  const out = runRules(facts);
  const hit = out.find((f) => f.id === "plugin.declared-but-inactive");
  assert(hit !== null, "装了没生效却没报出来");
  assertEq(hit?.severity, "error", "装了不生效应为 error");
  assert(String(hit?.cause ?? "").includes("bundles"), "cause 必须点名双名单/ bundles —— 这就是『指出原因』");
  assertEq(hit?.fixAction, "plugin.repair", "必须挂上一键修复入口（AC-P1 的 repair 指针）");
  assertEq((hit?.data as { plugin?: string } | undefined)?.plugin, "dsh-cost-meter", "data 要带上插件名");
});

Deno.test("declared-but-inactive：阴性 —— 双名单一致时不报", () => {
  noId(runRules(healthyFacts()), "plugin.declared-but-inactive", "名单一致却报了装了没生效");
});

// ══ 3. plugin.declared-not-installed ═══════════════════════════════

Deno.test("declared-not-installed：阳性 —— 声明了但包目录不存在", () => {
  const out = runRules(baseFacts({
    lists: { dependencies: ["ghost-pkg"], declaredButInactive: ["ghost-pkg"] },
    inactiveLayers: [{ name: "ghost-pkg", dir: null, canLayer: false, reason: "unresolved", patchFiles: [] }],
  }));
  someId(out, "plugin.declared-not-installed", "包目录不存在却没报");
});

Deno.test("declared-not-installed：阴性 —— 装了没生效但包在、可作层时归规则 2 管，不报本条", () => {
  const out = runRules(baseFacts({
    lists: { dependencies: ["dsh-cost-meter"], declaredButInactive: ["dsh-cost-meter"] },
    inactiveLayers: [{ name: "dsh-cost-meter", dir: "C:\\x", canLayer: true, reason: null, patchFiles: [] }],
  }));
  noId(out, "plugin.declared-not-installed", "包明明在，却报了『没装上』");
  someId(out, "plugin.declared-but-inactive", "这种场景应由规则 2 报");
});

// ══ 4. plugin.repair-blocked（AC-P2 前半：修复前拦截） ══════════════

Deno.test("AC-P2：装了没生效但不可作层 —— 必须拦住『盲目补登记』", () => {
  const out = runRules(baseFacts({
    lists: { dependencies: ["bad-pkg"], declaredButInactive: ["bad-pkg"] },
    inactiveLayers: [{ name: "bad-pkg", dir: "C:\\x\\bad-pkg", canLayer: false, reason: "patch-missing", patchFiles: ["./cordis.patch.yml"] }],
  }));
  const hit = out.find((f) => f.id === "plugin.repair-blocked");
  assert(hit !== null, "不可作层的『装了没生效』却没拦截");
  assertEq(hit?.severity, "error", "必须是 error 级，preflight 才会拦住修复动作");
  assertEq(hit?.fixAction, undefined, "这种包绝不能挂 plugin.repair 入口 —— 修了会出事");
  assert(String(hit?.action ?? "").includes("先修复包本身"), "action 必须指到『先修包再登记』");
});

Deno.test("repair-blocked：阴性 —— 可作层的插件走正常补登记，不拦", () => {
  const out = runRules(baseFacts({
    lists: { dependencies: ["dsh-cost-meter"], declaredButInactive: ["dsh-cost-meter"] },
    inactiveLayers: [{ name: "dsh-cost-meter", dir: "C:\\x", canLayer: true, reason: null, patchFiles: [] }],
  }));
  noId(out, "plugin.repair-blocked", "可作层却被拦了 —— 会把正常修复堵死");
});

// ══ 5. plugin.bundled-but-undeclared ═══════════════════════════════

Deno.test("bundled-but-undeclared：阳性 —— 名单里的包哪儿都解析不到", () => {
  const out = runRules(baseFacts({ lists: { bundles: ["dsh-ghost"], bundledButUndeclared: ["dsh-ghost"] } }));
  someId(out, "plugin.bundled-but-undeclared", "真缺失却没报");
});

Deno.test("bundled-but-undeclared：阴性 —— inBox 基座包绝不能报成缺失", () => {
  const out = runRules(healthyFacts());
  noId(out, "plugin.bundled-but-undeclared", "基座包被误报成缺失");
});

// ══ 6. plugin.not-a-layer（AC-P2 后半：误登不可作层包） ════════════

Deno.test("AC-P2：把不可作层的包误登记进 bundles，诊断必须在改文件前报出来", () => {
  // 三种真实的不可作层形态（对应本体三个 throw 点）
  const reasons = ["no-dsh-bundle", "patch-illegal", "patch-missing"] as const;
  for (const reason of reasons) {
    const out = runRules(baseFacts({
      lists: { bundles: ["bad-pkg"], active: ["bad-pkg"] },
      layers: [{ name: "bad-pkg", dir: "C:\\x\\bad-pkg", canLayer: false, reason, patchFiles: ["./cordis.patch.yml"] }],
    }));
    const hit = out.find((f) => f.id === "plugin.not-a-layer");
    assert(hit !== null, `reason=${reason} 的误登记没被报出来`);
    assertEq(hit?.severity, "error", `reason=${reason} 必须是 error 级`);
    assertEq((hit?.data as { reason?: string } | undefined)?.reason, reason, "data 要带上具体原因");
  }
  // 修复入口必须先跑拦截：有 error → 引擎拒绝执行（改动文件前拦住）
  const blockers = repairBlockers(baseFacts({
    lists: { bundles: ["bad-pkg"], active: ["bad-pkg"] },
    layers: [{ name: "bad-pkg", dir: "C:\\x\\bad-pkg", canLayer: false, reason: "no-dsh-bundle", patchFiles: [] }],
  }));
  assert(blockers.some((f) => f.severity === "error"), "repairBlockers 必须给出 error 级拦截");
});

Deno.test("not-a-layer：阴性 —— patch 是 5 元素数组的基座包绝不能报（真机 web-app 形态）", () => {
  noId(runRules(healthyFacts()), "plugin.not-a-layer", "数组 patch 的合法包被误报成不可作层");
});

Deno.test("not-a-layer：阴性 —— 解析不到的条目归规则 5 管，本条不重复报", () => {
  const out = runRules(baseFacts({
    lists: { bundles: ["ghost"], bundledButUndeclared: ["ghost"] },
    layers: [{ name: "ghost", dir: null, canLayer: false, reason: "unresolved", patchFiles: [] }],
  }));
  someId(out, "plugin.bundled-but-undeclared", "解析不到应由规则 5 报");
  noId(out, "plugin.not-a-layer", "规则 6 重复报了 unresolved");
});

// ══ 7. plugin.dup-insert-profile-bundle（技能 A3/S 双重注册） ═══════

Deno.test("dup-insert-profile-bundle：阳性 —— profile 与包自带 patch 都 insert 同一 id", () => {
  const out = runRules(baseFacts({
    profilePatchInsertIds: ["dsh-market"],
    bundlePatchInsertIds: [{ pkg: "dshmarket", patchFile: "./cordis.patch.yml", ids: ["dsh-market"] }],
  }));
  someId(out, "plugin.dup-insert-profile-bundle", "双重注册没报出来");
});

Deno.test("dup-insert-profile-bundle：阴性 —— 两处 insert 的 id 各不相同则不报", () => {
  const out = runRules(baseFacts({
    profilePatchInsertIds: ["profile-only-id"],
    bundlePatchInsertIds: [{ pkg: "dshmarket", patchFile: "./cordis.patch.yml", ids: ["dsh-market"] }],
  }));
  noId(out, "plugin.dup-insert-profile-bundle", "id 不同却被报成重复注册");
});

// ══ 8. plugin.dup-insert-cross-bundle（技能 A3b 跨包重复） ══════════

Deno.test("dup-insert-cross-bundle：阳性 —— 两个包 insert 同一 id", () => {
  const out = runRules(baseFacts({
    bundlePatchInsertIds: [
      { pkg: "pkg-a", patchFile: "a.patch.yml", ids: ["shared-entry"] },
      { pkg: "pkg-b", patchFile: "b.patch.yml", ids: ["shared-entry"] },
    ],
  }));
  someId(out, "plugin.dup-insert-cross-bundle", "跨包重复注册没报出来");
});

Deno.test("dup-insert-cross-bundle：阴性 —— 各包 id 不撞车则不报", () => {
  const out = runRules(baseFacts({
    bundlePatchInsertIds: [
      { pkg: "pkg-a", patchFile: "a.patch.yml", ids: ["entry-a"] },
      { pkg: "pkg-b", patchFile: "b.patch.yml", ids: ["entry-b"] },
    ],
  }));
  noId(out, "plugin.dup-insert-cross-bundle", "id 不撞车却被报了");
});

// ══ 9. plugin.zombie-lock（技能 AH / 事故 #48） ═════════════════════

Deno.test("zombie-lock：阳性 —— stale（PID 已死）与 recycled（PID 被复用）都要报", () => {
  const out = runRules(baseFacts({
    locks: [
      { path: "C:\\p\\a.lock", firstLine: "99999", pid: 99999, alive: false, procName: null, verdict: "stale" },
      { path: "C:\\p\\b.lock", firstLine: "1001", pid: 1001, alive: true, procName: "notepad.exe", verdict: "recycled" },
    ],
  }));
  const hits = out.filter((f) => f.id === "plugin.zombie-lock");
  assertEq(hits.length, 2, `两把坏锁应报两条，实际 ${hits.length}`);
  assert(hits.every((f) => f.severity === "error"), "僵尸锁会让所有配置写入超时，必须 error 级");
});

Deno.test("zombie-lock：阴性 —— held（持有者是活 node）绝不能报，unknown 也不算僵尸", () => {
  const out = runRules(baseFacts({
    locks: [
      { path: "C:\\p\\live.lock", firstLine: "12345", pid: 12345, alive: true, procName: "node.exe", verdict: "held" },
      { path: "C:\\p\\weird.lock", firstLine: "not-a-pid", pid: null, alive: null, procName: null, verdict: "unknown" },
    ],
  }));
  noId(out, "plugin.zombie-lock", "活锁/看不懂的锁被误报成僵尸锁 —— 会诱导用户清掉真锁");
});

// ══ 10. plugin.lock-unrecognized ═══════════════════════════════════

Deno.test("lock-unrecognized：阳性 —— 看不懂的锁报 info（只报告不判可清）", () => {
  const out = runRules(baseFacts({
    locks: [{ path: "C:\\p\\weird.lock", firstLine: "garbage", pid: null, alive: null, procName: null, verdict: "unknown" }],
  }));
  const hit = out.find((f) => f.id === "plugin.lock-unrecognized");
  assert(hit !== null, "看不懂的锁没报告");
  assertEq(hit?.severity, "info", "看不懂就只是 info —— 绝不升级成『可清理』");
});

Deno.test("lock-unrecognized：阴性 —— 正常锁（held/stale）不报本条", () => {
  const out = runRules(baseFacts({
    locks: [{ path: "C:\\p\\x.lock", firstLine: "1", pid: 1, alive: false, procName: null, verdict: "stale" }],
  }));
  noId(out, "plugin.lock-unrecognized", "看得懂的锁被报成看不懂");
});

// ══ 11. plugin.temp-dependency ═════════════════════════════════════

Deno.test("temp-dependency：阳性 —— file: 指向 %TEMP% 要报", () => {
  const out = runRules(baseFacts({
    depEntries: { "dsh-tmp-plugin": "file:C:\\Users\\niufe\\AppData\\Local\\Temp\\dsh-tmp-plugin" },
  }));
  someId(out, "plugin.temp-dependency", "指向临时目录的依赖没报");
});

Deno.test("temp-dependency：阴性 —— 正常版本号与非临时路径的 file: 都不报", () => {
  const out = runRules(baseFacts({
    depEntries: {
      "dsh-cost-meter": "^1.2.3",
      "local-plugin": "file:G:\\plugins\\local-plugin",
    },
  }));
  noId(out, "plugin.temp-dependency", "正常依赖被误报成临时目录");
});

// ══ 12. plugin.pnpm-residue ════════════════════════════════════════

Deno.test("pnpm-residue：阳性 —— 有残留要报并带证据", () => {
  const out = runRules(baseFacts({
    residue: [{ name: "@codemirror/.autocomplete_tmp_15580_31-2kN2ZzMh", kind: "scope 下的 _tmp_ 隐藏目录" }],
  }));
  const hit = out.find((f) => f.id === "plugin.pnpm-residue");
  assert(hit !== null, "残留没报");
  assert((hit?.evidence ?? []).some((e) => e.includes("_tmp_")), "证据里要能看到残留名");
});

Deno.test("pnpm-residue：阴性 —— 干净的 node_modules 不报", () => {
  noId(runRules(baseFacts({ residue: [] })), "plugin.pnpm-residue", "没残留却报了");
});

// ══ AC-P2 修复入口拦截契约（S3 的 plugin.repair 将复用） ════════════

Deno.test("AC-P2：repairBlockers —— 健康场景必须放行（不误伤正常修复）", () => {
  const blockers = repairBlockers(baseFacts({
    lists: { dependencies: ["dsh-cost-meter"], declaredButInactive: ["dsh-cost-meter"] },
    inactiveLayers: [{ name: "dsh-cost-meter", dir: "C:\\x", canLayer: true, reason: null, patchFiles: ["./cordis.patch.yml"] }],
  }));
  assertEq(blockers.length, 0, `可作层的正常修复被误拦：${JSON.stringify(blockers)}`);
});

Deno.test("AC-P2：repairBlockers —— bundles 里有真缺失也必须拦（名单与实物对不上时不动手）", () => {
  const blockers = repairBlockers(baseFacts({
    lists: { bundles: ["dsh-ghost"], bundledButUndeclared: ["dsh-ghost"] },
  }));
  assert(blockers.some((f) => f.severity === "error"), "名单有洞时修复动作必须被拦下");
});
