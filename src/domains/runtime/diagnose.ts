/**
 * runtime.diagnose —— 运行时诊断动作（只读，AC-R4 零副作用）。
 *
 * 分层结论（AC-R1）：
 *   进程活着吗 → 服务起了吗（HTTP） → 插件树加载完了吗（启动失败转储）
 * 三种状态由 rules 前两条互斥规则区分：
 *   态A 进程活着但服务没起来   → runtime.proc-no-http
 *   态B 服务起来了但插件树没加载完 → runtime.plugins-not-ready
 *
 * AC-R4：本动作全链路只读（探进程/端口/HTTP/读日志/读锁），
 * 跑 100 次不产生任何文件变更 —— 由 facts_test 的零副作用测试钉住。
 */

import type { ActionDef } from "../../jobs/types.ts";
import type { Finding } from "../../util/result.ts";
import { healthOf } from "../../util/result.ts";
import { collectRuntimeFacts, type RuntimeFacts } from "./facts.ts";
import { RULE_COUNT, runRules } from "./rules.ts";

export interface RuntimeDiagnoseResult {
  facts: RuntimeFacts;
  findings: Finding[];
  health: "ok" | "warn" | "error";
  rulesRun: number;
}

export const runtimeDiagnoseAction: ActionDef<Record<string, never>, RuntimeDiagnoseResult> = {
  name: "runtime.diagnose",
  domain: "runtime",
  title: "运行时诊断",
  description:
    "只读跑 13 条运行时规则：分层健康（进程/服务/插件树）、启动失败现场、僵尸锁、日志故障原文（remote 挂起、双重注册、依赖缺失等）。不改任何文件。",
  readonly: true,
  steps: ["采集运行时事实", "跑规则库", "汇总结论"],
  run: async (ctx): Promise<RuntimeDiagnoseResult> => {
    ctx.step("collect", "采集运行时事实");
    ctx.progress(0.35);
    const facts = await collectRuntimeFacts();
    ctx.detail(
      facts.procCount > 0
        ? `进程 ${facts.procCount} 个 · 端口 ${facts.port ?? "?"} · HTTP ${
          facts.http?.reachable ? "通" : "不通"
        }`
        : "服务未运行",
    );
    ctx.throwIfCancelled();

    ctx.step("rules", `跑规则库（${RULE_COUNT} 条）`);
    ctx.progress(0.75);
    const findings = runRules(facts);
    ctx.detail(findings.length === 0 ? "全部通过" : `命中 ${findings.length} 条`);
    ctx.throwIfCancelled();

    ctx.step("done", "汇总");
    ctx.progress(1);
    return { facts, findings, health: healthOf(findings), rulesRun: RULE_COUNT };
  },
};
