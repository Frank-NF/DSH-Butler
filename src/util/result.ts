/**
 * 统一结果与「问题四要素」。
 *
 * 设计约束（方案 §6.4 / AC-E4）：
 * 所有「环境不满足」的输出都必须带 { 原因, 影响, 建议动作, 一键执行入口 } 四要素，
 * 不允许只抛错误码让用户猜。
 */

/** CLI 退出码语义，固定不变。 */
export const EXIT = {
  OK: 0,
  FAIL: 1,
  USAGE: 2,
  PERM: 3,
  PRECOND: 4,
  TIMEOUT: 5,
  CANCEL: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type Severity = "info" | "warn" | "error";

/**
 * 一条可展示的发现（诊断结论 / 环境不满足项）。
 * 字段刻意做成可选，但 action 与 impact 在面向用户的错误里必须填。
 */
export interface Finding {
  /** 稳定标识，便于规则库统计命中率与写测试样本。 */
  id: string;
  severity: Severity;
  /** 一句话结论。 */
  title: string;
  /** 原因（为什么）。 */
  cause?: string;
  /** 影响（不修会怎样）。 */
  impact?: string;
  /** 建议动作（人话）。 */
  action?: string;
  /** 一键执行入口：注册表里的 action 名，如 "runtime.repair"。 */
  fixAction?: string;
  /** 支撑证据：原始输出、文件路径、日志行。 */
  evidence?: string[];
  /** 附加数据，供 UI 渲染。 */
  data?: Record<string, unknown>;
}

export interface StepResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: ExitCode;
}

export function ok<T>(data: T): StepResult<T> {
  return { ok: true, data };
}

export function fail(message: string, code: ExitCode = EXIT.FAIL, ...evidence: string[]): StepResult<never> {
  const out: StepResult<never> = { ok: false, error: message, code };
  if (evidence.length) (out as { data?: unknown }).data = { evidence };
  return out;
}

/** 便捷构造一条 finding。 */
export function finding(
  id: string,
  severity: Severity,
  title: string,
  extra: Partial<Finding> = {},
): Finding {
  return { id, severity, title, ...extra };
}

/** 有 error 级 finding 即视为"不健康"。 */
export function healthOf(findings: Finding[]): "ok" | "warn" | "error" {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "ok";
}
