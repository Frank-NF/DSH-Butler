/**
 * 任务（Job）模型。
 *
 * 为什么要有这一层（方案 §2 的核心）：
 * 平铺式的「一条命令点一下就跑」无法回答这些问题 —— 失败了进行到哪一步？
 * 崩了能不能接着走？取消后会不会留下半成品？谁改过什么？
 * Job 把每次有副作用的操作变成有步骤、有进度、可取消、有补偿、可审计的单位。
 */

import type { Finding } from "../util/result.ts";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout"
  /** 进程上次被杀，未确认结局（启动时识别）。 */
  | "interrupted";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "undone";

export interface JobStep {
  /** 稳定 id，便于补偿动作对号入座。 */
  id: string;
  /** 人话标题（面向非技术用户）。 */
  title: string;
  detail?: string;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
}

export interface Job {
  id: string;
  /** 动作名，如 "env.probe"。 */
  action: string;
  actionTitle: string;
  params: Record<string, unknown>;
  /** 谁触发的：ui = 界面点的，schedule = 定时任务，cli = 命令行。审计报告要用它说清「谁改的」。 */
  source?: "ui" | "cli" | "schedule";
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  steps: JobStep[];
  /** 0..1，用于进度条。 */
  progress: number;
  result?: unknown;
  error?: string;
  /** 执行前的发现（前置条件不满足项）。 */
  findings?: Finding[];
  /** 是否允许取消。 */
  cancellable: boolean;
  /** 建议的后续动作（如"验证"）。 */
  nextActions?: string[];
}

export type JobEventType =
  | "created"
  | "started"
  | "step-start"
  | "step-log"
  | "step-done"
  | "step-failed"
  | "done"
  | "log";

export interface JobEvent {
  seq: number;
  ts: string;
  jobId: string;
  type: JobEventType;
  stepId?: string;
  /** 文本消息（日志行 / 状态说明）。 */
  message?: string;
  /** 结构化补充。 */
  data?: Record<string, unknown>;
}

/** 动作定义。S1 阶段全部是只读动作。 */
export interface ActionDef<P = Record<string, unknown>, R = unknown> {
  name: string;
  domain: ActionDomain;
  /** 界面与 CLI 都用这个标题。 */
  title: string;
  description?: string;
  /** 只读动作永远允许执行，且不需要回滚点。 */
  readonly: boolean;
  /** 预估步骤标题，用于创建后立刻把步骤表展示出来。 */
  steps?: string[];
  /** 前置条件检查：返回的发现里若有 error 级，则不执行。 */
  preflight?: (params: P) => Promise<Finding[]>;
  run: (ctx: ActionContext, params: P) => Promise<R>;
  /** 超时覆盖（毫秒）。 */
  timeoutMs?: number;
}

/**
 * 注册表用的「异质动作」视图。
 *
 * 为什么参数类型取 never：函数参数在类型系统里是逆变的，注册表要同时装
 * `ActionDef<{port:number}, X>` 与 `ActionDef<Record<string, never>, Y>` 这种
 * 参数各异的动作。若统一写成 `ActionDef<Record<string, unknown>, unknown>`，
 * TS 会要求 `Record<string, unknown>` 可赋给各动作的具体参数类型 —— 必然失败。
 * 取 never 后任何参数类型都能装进来，而调用侧本来就统一走 `params as never`。
 */
export type AnyActionDef = ActionDef<never, unknown>;

export type ActionDomain =
  | "core"
  | "plugin"
  | "runtime"
  | "env"
  | "bootstrap"
  | "self"
  | "backup"
  | "data"
  | "profile"
  | "market"
  | "network"
  | "mcp"
  | "diag"
  | "job";

/** 动作执行上下文：动作只通过它与外界对话。 */
export interface ActionContext {
  jobId: string;
  signal: AbortSignal;
  /** 开始一个步骤（会自动把当前 running 步骤标记为 done）。 */
  step(id: string, title?: string, detail?: string): void;
  /** 给当前步骤补充说明（可多次调用）。 */
  detail(text: string): void;
  /** 输出一行日志（进任务事件流 + 日志文件）。 */
  log(line: string): void;
  /** 更新进度 0..1。 */
  progress(p: number): void;
  /** 注册补偿动作（失败/取消时按注册的逆序执行）。 */
  onUndo(fn: () => Promise<void>): void;
  /** 检查是否已被要求取消，动作应在耗时循环里主动调用。 */
  throwIfCancelled(): void;
}

/** 取消时抛出的专用错误，用于区分"被取消"与"真失败"。 */
export class CancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "CancelledError";
  }
}

/** 步骤超时抛出的错误。 */
export class StepTimeoutError extends Error {
  constructor(message = "步骤超时") {
    super(message);
    this.name = "StepTimeoutError";
  }
}
