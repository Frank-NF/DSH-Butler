/**
 * runtime.rules 的阴阳样本测试（AC-R3：≥10 条规则在真实故障上验证）。
 *
 * 每条规则阳性 + 阴性；阳性样本的报错语义取自 dsh-plugin-repair 技能
 * 记录的 13 类历史故障。样本全部手搓 RuntimeFacts —— 不碰真实环境。
 *
 * AC-R1 专项：态A（进程活着但服务没起来）与态B（服务起来了但插件树
 * 没加载完）由两条互斥规则区分，测试断言同一只骨架在两种 HTTP 结果下
 * 只会命中其中一条。
 */

import type { RuntimeFacts } from "./facts.ts";
import { RULE_COUNT, RULE_IDS, runRules } from "./rules.ts";
import type { Finding } from "../../util/result.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
  }
}

function someId(findings: { id: string }[], id: string, msg: string): void {
  if (!findings.some((f) => f.id === id)) {
    throw new Error(`断言失败：${msg}\n  应出现 ${id}，实际：${findings.map((f) => f.id).join(", ") || "（空）"}`);
  }
}

function noId(findings: { id: string }[], id: string, msg: string): void {
  const hits = findings.filter((f) => f.id === id);
  if (hits.length > 0) {
    throw new Error(`断言失败：${msg}\n  不该出现 ${id}：${JSON.stringify(hits, null, 2)}`);
  }
}

function hitOf(findings: Finding[], id: string): Finding | undefined {
  return findings.find((f) => f.id === id);
}

/** 健康机器打底：无进程、无锁、无转储、无日志命中。 */
function baseFacts(over: Partial<RuntimeFacts> = {}): RuntimeFacts {
  return {
    profileDir: "C:\\Users\\niufe\\.dsh\\profiles\\web",
    procCount: 0,
    pids: [],
    port: null,
    http: null,
    foreignPorts: [],
    locks: [],
    startupDump: { present: false, failed: false, ageMs: null, failedPlugins: [], lines: [], path: null },
    logHits: {},
    checkedAt: "2026-09-24T00:00:00.000Z",
    ...over,
  };
}

/** 正在健康运行的服务：1 进程 + HTTP 通 + 无失败转储。 */
function runningFacts(over: Partial<RuntimeFacts> = {}): RuntimeFacts {
  return baseFacts({
    procCount: 1,
    pids: [1234],
    port: 3081,
    http: { reachable: true, status: 200, error: null },
    ...over,
  });
}

const FRESH_DUMP = { present: true, failed: true, ageMs: 60_000, failedPlugins: ["dsh-ghost"], lines: ["StartupError: dsh: startup failed: 1 required plugin did not activate"], path: "C:\\Users\\niufe\\.dsh\\logs\\startup-x.log" };

// ══ 总门槛与 AC-R3 回归映射 ═══════════════════════════════════════

Deno.test("规则库 ≥ 10 条，且 13 类历史故障的运行时可判项全部有归属规则（AC-R3）", () => {
  assert(RULE_COUNT >= 10, `当前只有 ${RULE_COUNT} 条规则`);
  // 历史故障类型 → 规则 的回归映射（types 为 dsh-plugin-repair 技能编号）
  const coverage: Array<{ types: string; rule: string }> = [
    { types: "U 启动不打印地址 / 服务不起来", rule: "runtime.proc-no-http" },
    { types: "启动失败（A1/Q/T/R/Y 的启动侧）", rule: "runtime.boot-failed" },
    { types: "X waiting for service remote.*", rule: "runtime.remote-hang" },
    { types: "S 双重注册 / aigc-canvas", rule: "runtime.double-registration" },
    { types: "A1/E/AG 包缺失", rule: "runtime.dep-unresolved" },
    { types: "W missed the module table", rule: "runtime.module-table-miss" },
    { types: "V strict codec", rule: "runtime.strict-codec" },
    { types: "C/Z session preset 挂载失败", rule: "runtime.preset-unmount" },
    { types: "AH 僵尸锁 / #48", rule: "runtime.stale-lock" },
    { types: "P/AH 保存失败", rule: "runtime.save-fail" },
    { types: "重复启动双进程", rule: "runtime.duplicate-processes" },
  ];
  const all = runRules(baseFacts({ procCount: 0 })); // 空机器应零命中，这里只兜底
  const ids = new Set([...RULE_IDS, ...all.map((f) => f.id)]);
  for (const c of coverage) {
    assert(ids.has(c.rule), `历史故障「${c.types}」映射的规则 ${c.rule} 不存在 —— 回归集有洞`);
  }
  assert(coverage.length >= 10, `历史故障回归映射只有 ${coverage.length} 条`);
  assert(RULE_IDS.length >= 10, `规则库实际只有 ${RULE_IDS.length} 条`);
});

// ══ AC-R1：态A / 态B 互斥区分 ═════════════════════════════════════

Deno.test("AC-R1 态A：进程活着但服务没起来 → proc-no-http，且绝不报态B", () => {
  const out = runRules(runningFacts({
    http: { reachable: false, status: null, error: "connection refused" },
    startupDump: FRESH_DUMP,
  }));
  someId(out, "runtime.proc-no-http", "态A 没被识别");
  noId(out, "runtime.plugins-not-ready", "态A 时绝不能报态B —— 两种状态必须互斥");
});

Deno.test("AC-R1 态B：服务起来了但插件树没加载完 → plugins-not-ready，且绝不报态A", () => {
  const out = runRules(runningFacts({ startupDump: FRESH_DUMP }));
  someId(out, "runtime.plugins-not-ready", "态B 没被识别");
  noId(out, "runtime.proc-no-http", "态B 时绝不能报态A —— 两种状态必须互斥");
  const hit = hitOf(out, "runtime.plugins-not-ready");
  assertEq(hit?.severity, "error", "态B 是 error 级");
  assert(String(hit?.cause ?? "").includes("dsh-ghost"), "cause 要点名失败插件");
});

Deno.test("AC-R1：三层全通 → 两条分层规则都不报", () => {
  const out = runRules(runningFacts());
  noId(out, "runtime.proc-no-http", "健康运行却报态A");
  noId(out, "runtime.plugins-not-ready", "健康运行却报态B");
});

Deno.test("态B 的时效边界：陈旧失败转储不算现场（由 boot-failed 以 info 报历史）", () => {
  const out = runRules(runningFacts({
    startupDump: { ...FRESH_DUMP, ageMs: 30 * 60_000 }, // 30 分钟前，超出 15 分钟现场窗口
  }));
  noId(out, "runtime.plugins-not-ready", "半小时前的转储被当成了当前现场");
});

// ══ 1 proc-no-http（阴性） ════════════════════════════════════════

Deno.test("proc-no-http：阴性 —— 没进程时不报（没启动不算「活着但没起来」）", () => {
  noId(runRules(baseFacts()), "runtime.proc-no-http", "无进程却报了态A");
});

Deno.test("proc-no-http：cause 引用新鲜失败转储的插件名单（A 组合证据）", () => {
  const out = runRules(runningFacts({
    http: { reachable: false, status: null, error: "timeout" },
    startupDump: FRESH_DUMP,
  }));
  assert(String(hitOf(out, "runtime.proc-no-http")?.cause ?? "").includes("dsh-ghost"), "没带上转储证据");
});

// ══ 2 plugins-not-ready（阴性） ═══════════════════════════════════

Deno.test("plugins-not-ready：阴性 —— HTTP 通且转储非失败时不报", () => {
  noId(runRules(runningFacts()), "runtime.plugins-not-ready", "健康却被报态B");
});

// ══ 3 duplicate-processes ═════════════════════════════════════════

Deno.test("duplicate-processes：阳性 2 进程 → warn；阴性 1 进程 → 不报", () => {
  someId(runRules(runningFacts({ procCount: 2, pids: [1, 2] })), "runtime.duplicate-processes", "双进程没报");
  noId(runRules(runningFacts()), "runtime.duplicate-processes", "单进程被误报");
});

// ══ 4 port-foreign ════════════════════════════════════════════════

Deno.test("port-foreign：阳性 —— 没进程 + 端口被别人占 → warn", () => {
  const out = runRules(baseFacts({ foreignPorts: [{ port: 3081, owners: ["other-app(PID 999)"] }] }));
  someId(out, "runtime.port-foreign", "端口被占没报");
});

Deno.test("port-foreign：阴性 —— DSH 自己在用端口（有进程）时不报", () => {
  const out = runRules(runningFacts({ foreignPorts: [{ port: 3081, owners: ["x(PID 1)"] }] }));
  noId(out, "runtime.port-foreign", "自己占自己的端口被误报");
});

// ══ 5 stale-lock ══════════════════════════════════════════════════

Deno.test("stale-lock：阳性 —— stale/recycled → warn；阴性 —— keep/unreadable 不报", () => {
  const pos = runRules(baseFacts({
    locks: [
      { path: "a.lock", verdict: "stale" },
      { path: "b.lock", verdict: "recycled" },
    ],
  }));
  someId(pos, "runtime.stale-lock", "僵尸锁没报");
  const neg = runRules(baseFacts({
    locks: [
      { path: "live.lock", verdict: "keep" },
      { path: "weird.lock", verdict: "unreadable" },
    ],
  }));
  noId(neg, "runtime.stale-lock", "活锁/看不懂的锁被误报成僵尸锁");
});

// ══ 6 boot-failed ═════════════════════════════════════════════════

Deno.test("boot-failed：新近失败（无进程）→ error；陈旧失败 → info；有进程不报", () => {
  const fresh = runRules(baseFacts({ startupDump: FRESH_DUMP }));
  const fh = hitOf(fresh, "runtime.boot-failed");
  assert(fh !== undefined, "无进程 + 新近失败转储没报");
  assertEq(fh?.severity, "error", "现场失败应为 error");

  const stale = runRules(baseFacts({ startupDump: { ...FRESH_DUMP, ageMs: 48 * 3600_000 } }));
  assertEq(hitOf(stale, "runtime.boot-failed")?.severity, "info", "两天前的历史失败应降为 info");

  noId(runRules(runningFacts({ startupDump: FRESH_DUMP })), "runtime.boot-failed", "有进程时不该由本规则报（归态B管）");
});

Deno.test("boot-failed：阴性 —— 转储存在但非失败（正常启动日志）不报", () => {
  noId(
    runRules(baseFacts({ startupDump: { ...FRESH_DUMP, failed: false, failedPlugins: [] } })),
    "runtime.boot-failed",
    "正常启动日志被当成失败现场",
  );
});

// ══ 7-12 日志原文规则：每条 fresh→error / stale→info / 无→不报 ════

const LOG_RULE_CASES: Array<{ id: string; key: "remoteHang" | "doubleReg" | "depUnresolved" | "moduleTable" | "strictCodec" | "presetUnmount" }> = [
  { id: "runtime.remote-hang", key: "remoteHang" },
  { id: "runtime.double-registration", key: "doubleReg" },
  { id: "runtime.dep-unresolved", key: "depUnresolved" },
  { id: "runtime.module-table-miss", key: "moduleTable" },
  { id: "runtime.strict-codec", key: "strictCodec" },
  { id: "runtime.preset-unmount", key: "presetUnmount" },
];

for (const c of LOG_RULE_CASES) {
  Deno.test(`${c.id}：fresh → error / stale → info / 无 → 不报`, () => {
    const fresh = runRules(baseFacts({ logHits: { [c.key]: [{ text: "real error line", fresh: true }] } }));
    assertEq(hitOf(fresh, c.id)?.severity, "error", "现场故障应为 error");

    const stale = runRules(baseFacts({ logHits: { [c.key]: [{ text: "old error line", fresh: false }] } }));
    assertEq(hitOf(stale, c.id)?.severity, "info", "历史现场应降为 info —— 不许让用户去修已修好的问题");

    noId(runRules(baseFacts()), c.id, "无证据却报了");
  });
}

// ══ 13 save-fail（两支定位） ══════════════════════════════════════

Deno.test("save-fail：新鲜命中 + 僵尸锁在场 → 指向清锁（带 fixAction）", () => {
  const out = runRules(baseFacts({
    logHits: { saveFail: [{ text: "保存失败，请重试", fresh: true }] },
    locks: [{ path: "config.lock", verdict: "stale" }],
  }));
  const hit = hitOf(out, "runtime.save-fail");
  assert(hit !== undefined, "保存失败没报");
  assert(String(hit?.cause ?? "").includes("僵尸"), "没点名僵尸锁根因");
  assertEq(hit?.fixAction, "runtime.repair", "要挂清锁修复入口");
});

Deno.test("save-fail：新鲜命中但锁全部正常 → 宿主旧/客户端新分支", () => {
  const out = runRules(baseFacts({
    logHits: { saveFail: [{ text: "保存失败，请重试", fresh: true }] },
    locks: [{ path: "live.lock", verdict: "keep" }],
  }));
  const hit = hitOf(out, "runtime.save-fail");
  assert(hit !== undefined, "保存失败没报");
  assert(String(hit?.cause ?? "").includes("宿主旧"), "没走「宿主旧客户端新」分支");
});

Deno.test("save-fail：阴性 —— 历史命中 / 无命中都不报", () => {
  noId(
    runRules(baseFacts({ logHits: { saveFail: [{ text: "保存失败", fresh: false }] } })),
    "runtime.save-fail",
    "历史「保存失败」被当现场报",
  );
  noId(runRules(baseFacts()), "runtime.save-fail", "无证据却报了");
});

// ══ 健康总闸 ══════════════════════════════════════════════════════

Deno.test("阴性总闸：健康运行的服务跑全库零命中", () => {
  const out = runRules(runningFacts());
  assertEq(out.length, 0, `健康样本误报：${JSON.stringify(out, null, 2)}`);
});

Deno.test("阴性总闸：什么都没开的空机器也零命中", () => {
  const out = runRules(baseFacts());
  assertEq(out.length, 0, `空机器误报：${JSON.stringify(out, null, 2)}`);
});
