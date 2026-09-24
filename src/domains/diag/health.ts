/**
 * diag.healthCheck —— 全局体检与报告。
 *
 * 设计原则（方案 §5）：
 *   本模块只做「读 + 判断 + 出建议」，【不做任何修复动作】。
 *   修复由对应领域模块执行。这样诊断可以独立、零风险地发布。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { healthOf, type Finding } from "../../util/result.ts";
import { collectEnv, type EnvReport } from "../env/probe.ts";
import { collectCoreStatus, type CoreStatus } from "../core/status.ts";
import { collectRuntimeStatus, type RuntimeStatus } from "../runtime/status.ts";
import { collectLogs, type LogsReport } from "../runtime/logs.ts";
import { APP_VERSION } from "../../version.ts";
import { homeDir } from "../../util/paths.ts";
import { platformLabel } from "../../host/mod.ts";

export interface HealthSection {
  name: string;
  label: string;
  verdict: "ok" | "warn" | "error";
  findings: Finding[];
}

export interface HealthReport {
  verdict: "ok" | "warn" | "error";
  generatedAt: string;
  durationMs: number;
  appVersion: string;
  platform: string;
  summary: { errors: number; warns: number; infos: number; total: number };
  sections: HealthSection[];
  findings: Finding[];
  data: {
    env: EnvReport;
    core: CoreStatus;
    runtime: RuntimeStatus;
    logs: LogsReport;
  };
}

/** 体检的四个采集阶段，用于向界面/命令行回报进度。 */
export type HealthStage = "env" | "core" | "runtime" | "logs";

export interface HealthProgress {
  stage: HealthStage;
  label: string;
  detail: string;
}

/**
 * 全面体检。
 *
 * 【只有这一处实现】：命令行 doctor 与界面都调它。
 * 曾经这里和 diagHealthAction.run 各写了一遍同样的采集流程 —— 两份实现必然会
 * 分叉（当时就已经分叉出「耗时永远是 0」这种问题）。进度通过回调报出去，
 * 而不是把流程抄第二遍。
 */
export async function runHealthCheck(
  onStage?: (p: HealthProgress) => void,
): Promise<HealthReport> {
  const started = Date.now();
  const sections: HealthSection[] = [];

  const env = await collectEnv();
  sections.push({ name: "env", label: "环境与配置", verdict: healthOf(env.findings), findings: env.findings });
  onStage?.({
    stage: "env",
    label: "检查环境与配置",
    detail: env.dsh.sourceRoot ? `本体位置：${env.dsh.sourceRoot}` : "未找到本体",
  });

  const core = await collectCoreStatus();
  sections.push({ name: "core", label: "DSH 本体", verdict: healthOf(core.findings), findings: core.findings });
  onStage?.({
    stage: "core",
    label: "检查 DSH 本体",
    detail: core.needsFinishUpdate
      ? "需要「完成更新」"
      : core.integrity?.verified
      ? "产物完整性已通过官方校验"
      : "源码与产物一致",
  });

  const runtime = await collectRuntimeStatus();
  sections.push({ name: "runtime", label: "运行状态", verdict: healthOf(runtime.findings), findings: runtime.findings });
  onStage?.({
    stage: "runtime",
    label: "检查运行状态",
    detail: runtime.running ? `服务运行中（PID ${runtime.pid}）` : "服务未运行",
  });

  const logs = await collectLogs();
  sections.push({ name: "logs", label: "日志", verdict: healthOf(logs.findings), findings: logs.findings });
  onStage?.({
    stage: "logs",
    label: "分析日志",
    detail: `扫描 ${logs.sources.length} 份日志`,
  });

  const findings = sections.flatMap((s) => s.findings);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const infos = findings.filter((f) => f.severity === "info").length;

  return {
    verdict: errors > 0 ? "error" : warns > 0 ? "warn" : "ok",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    appVersion: APP_VERSION,
    platform: platformLabel(),
    summary: { errors, warns, infos, total: findings.length },
    sections,
    findings,
    data: { env, core, runtime, logs },
  };
}

// ── 报告输出 ──────────────────────────────────────────────────────

/** 脱敏：把用户名与主目录替换掉，避免分享报告时泄露本机信息。 */
export function redact(text: string): string {
  const home = homeDir();
  const user = Deno.env.get("USERNAME") ?? Deno.env.get("USER") ?? "";
  let out = text.split(home).join("~");
  out = out.split(home.replace(/\\/g, "\\\\")).join("~");
  if (user.length >= 3) {
    out = out.split(user).join("%USER%");
  }
  // 常见凭据形态
  out = out.replace(/(token|secret|password|passwd|key)\s*[=:]\s*\S+/gi, "$1=***");
  return out;
}

export function renderMarkdown(report: HealthReport): string {
  const v = (x: "ok" | "warn" | "error" | "info") =>
    x === "error" ? "错误" : x === "warn" ? "警告" : x === "info" ? "提示" : "正常";
  const lines: string[] = [];

  lines.push(`# DSH Butler · 体检报告`);
  lines.push("");
  lines.push(`- 生成时间：${new Date(report.generatedAt).toLocaleString("zh-CN")}`);
  lines.push(`- 程序版本：${report.appVersion}`);
  lines.push(`- 平台：${report.platform}`);
  lines.push(`- 耗时：${report.durationMs} ms`);
  lines.push(
    `- 结论：**${v(report.verdict)}**（${report.summary.errors} 项错误 / ${report.summary.warns} 项警告 / ${report.summary.infos} 项提示）`,
  );
  lines.push("");

  for (const s of report.sections) {
    lines.push(`## ${s.label} — ${v(s.verdict)}`);
    if (s.findings.length === 0) {
      lines.push("");
      lines.push("未发现问题。");
      lines.push("");
      continue;
    }
    for (const f of s.findings) {
      lines.push("");
      lines.push(`### [${v(f.severity)}] ${f.title}`);
      if (f.cause) lines.push(`- 原因：${f.cause}`);
      if (f.impact) lines.push(`- 影响：${f.impact}`);
      if (f.action) lines.push(`- 建议：${f.action}`);
      if (f.fixAction) lines.push(`- 一键处理：\`${f.fixAction}\``);
      if (f.evidence?.length) {
        lines.push("- 证据：");
        for (const e of f.evidence.slice(0, 6)) lines.push(`  - ${e}`);
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 环境摘要");
  const env = report.data.env;
  lines.push("");
  lines.push(`- 系统：${env.system.platform} ${env.system.arch} · ${env.system.cpuCount} 核 · ${(env.system.memTotalBytes / 1024 ** 3).toFixed(1)} GB 内存`);
  lines.push(`- 运行时：${env.runtime.map((r) => `${r.label} ${r.found ? r.version ?? "已装" : "缺失"}`).join(" · ")}`);
  lines.push(`- DSH 本体：${env.dsh.sourceRoot ?? "未找到"}`);
  lines.push(`- 服务：${report.data.runtime.running ? `运行中（端口 ${report.data.runtime.port ?? "?"}）` : "未运行"}`);
  if (report.data.core.git) {
    lines.push(`- 源码：分支 ${report.data.core.git.branch} · 提交 ${report.data.core.git.headShort}`);
  }

  return redact(lines.join("\n"));
}

export const diagHealthAction: ActionDef<{ format?: "json" | "markdown" }, HealthReport | string> = {
  name: "diag.healthCheck",
  domain: "diag",
  title: "全面体检",
  description: "依次检查环境、本体、运行状态与日志，汇总成一份可分享的体检报告。只读，绝不修改任何东西。",
  readonly: true,
  steps: ["检查环境与配置", "检查 DSH 本体", "检查运行状态", "分析日志", "汇总报告"],
  run: async (ctx, params) => {
    // 步骤与进度全部由 runHealthCheck 的阶段回调驱动 —— 采集逻辑只有那一份实现
    const report = await runHealthCheck((p) => {
      ctx.step(p.stage, p.label);
      ctx.detail(p.detail);
      ctx.progress(STAGE_PROGRESS[p.stage]);
      ctx.throwIfCancelled();
    });

    ctx.detail(
      `${report.summary.errors} 项错误 · ${report.summary.warns} 项警告 · ${report.summary.infos} 项提示（耗时 ${report.durationMs} ms）`,
    );
    ctx.progress(1);

    return params.format === "markdown" ? renderMarkdown(report) : report;
  },
};

/** 各阶段对应的进度比例。 */
const STAGE_PROGRESS: Record<HealthStage, number> = {
  env: 0.2,
  core: 0.45,
  runtime: 0.7,
  logs: 0.9,
};
