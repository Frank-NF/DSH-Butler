/**
 * plugin.diagnose —— 插件诊断动作（只读）。
 *
 * 采集层（facts.ts）→ 判定层（rules.ts 纯函数）→ 这里只做编排。
 * 输出标准 { 原因, 影响, 建议动作, 一键入口 } 四要素的 Finding 列表。
 *
 * 阶段边界（方案 §10.3）：S2 绝不写 DSH 目录 —— 本动作 readonly: true，
 * 修复入口（fixAction: "plugin.repair"）只是指针，真实写入动作留 S3；
 * S3 的 repair 在 preflight 里必须复用 rules.ts 的 repairBlockers（AC-P2）。
 */

import type { ActionDef } from "../../jobs/types.ts";
import type { Finding } from "../../util/result.ts";
import { healthOf } from "../../util/result.ts";
import { collectPluginFacts } from "./facts.ts";
import { RULE_COUNT, runRules } from "./rules.ts";

export interface PluginDiagnoseResult {
  profileDir: string;
  /** 双名单/作层/锁/残留的全部命中，四要素齐全。 */
  findings: Finding[];
  health: "ok" | "warn" | "error";
  /** 本次跑了多少条规则（与库总量对账用）。 */
  rulesRun: number;
  /** 关键计数，给界面头部摘要用。 */
  summary: {
    deps: number;
    bundles: number;
    active: number;
    errors: number;
    warns: number;
  };
  checkedAt: string;
}

export const pluginDiagnoseAction: ActionDef<Record<string, never>, PluginDiagnoseResult> = {
  name: "plugin.diagnose",
  domain: "plugin",
  title: "插件诊断",
  description:
    "只读跑规则库：插件双名单、作层资格、patch 重复注册、僵尸写锁、安装残留。输出问题四要素，不改任何文件。",
  readonly: true,
  steps: ["采集插件事实", "跑规则库", "汇总结论"],
  run: async (ctx): Promise<PluginDiagnoseResult> => {
    ctx.step("collect", "采集插件事实");
    ctx.progress(0.3);
    const facts = await collectPluginFacts();
    ctx.detail(`profile：${facts.profileDir}`);
    ctx.throwIfCancelled();

    ctx.step("rules", `跑规则库（${RULE_COUNT} 条）`);
    ctx.progress(0.7);
    const findings = runRules(facts);
    const errors = findings.filter((f) => f.severity === "error").length;
    const warns = findings.filter((f) => f.severity === "warn").length;
    ctx.detail(
      findings.length === 0
        ? "全部通过"
        : `命中 ${findings.length} 条（错误 ${errors} / 警告 ${warns}）`,
    );
    ctx.throwIfCancelled();

    ctx.step("done", "汇总");
    ctx.progress(1);
    return {
      profileDir: facts.profileDir,
      findings,
      health: healthOf(findings),
      rulesRun: RULE_COUNT,
      summary: {
        deps: facts.lists.dependencies.length,
        bundles: facts.lists.bundles.length,
        active: facts.lists.active.length,
        errors,
        warns,
      },
      checkedAt: facts.checkedAt,
    };
  },
};
