/**
 * 任务引擎。
 *
 * 职责（方案 §3.1 L2）：
 *   - Job 状态机与步骤表
 *   - 超时 / 取消 / 补偿动作
 *   - write-ahead 落盘（先落盘再动手），崩溃后可识别与恢复
 *   - 事件广播（SSE 推给界面）
 *   - 域级互斥（写操作同一时刻只允许一个在跑）
 *
 * 关键取舍：create() 必须【立刻返回】（<100ms），前置条件检查放到后台作为第 0 步，
 * 否则界面点一下要等好几秒才有反应 —— 那和旧版体验没有任何区别。
 */

import {
  type ActionContext,
  type AnyActionDef,
  CancelledError,
  type Job,
  type JobEvent,
  type JobStep,
} from "./types.ts";
import { butlerJobsDir, p } from "../util/paths.ts";
import { appendExplanation } from "../util/error-translate.ts";
import { listDir, readJson, removeRecursive, writeJsonAtomic } from "../host/fs.ts";
import { type Finding, healthOf } from "../util/result.ts";
import { log } from "../util/log.ts";
import { APP_VERSION, TIMEOUTS } from "../version.ts";
import { releaseWriteLock, tryAcquireWriteLock } from "./write-lock.ts";

export interface CreateResult {
  ok: boolean;
  jobId?: string;
  error?: string;
  findings?: Finding[];
}

export class JobEngine {
  #defs = new Map<string, AnyActionDef>();
  #jobs = new Map<string, Job>();
  #aborts = new Map<string, AbortController>();
  /** 域 → 占用的 jobId。写操作互斥用。 */
  #locks = new Map<string, string>();
  #listeners = new Set<(e: JobEvent) => void>();
  #seq = 0;
  #historyLimit = 200;

  register(def: AnyActionDef): void {
    this.#defs.set(def.name, def);
  }

  definitions(): AnyActionDef[] {
    return [...this.#defs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  definition(name: string): AnyActionDef | undefined {
    return this.#defs.get(name);
  }

  subscribe(fn: (e: JobEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  get(jobId: string): Job | undefined {
    return this.#jobs.get(jobId);
  }

  list(limit = 50): Job[] {
    return [...this.#jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /** 某个域当前是否被占用。 */
  lockOwner(domain: string): string | undefined {
    return this.#locks.get(domain);
  }

  // ── 创建与执行 ─────────────────────────────────────────────────

  async create(
    action: string,
    params: Record<string, unknown> = {},
    opts: { source?: "ui" | "cli" | "schedule" } = {},
  ): Promise<CreateResult> {
    const def = this.#defs.get(action);
    if (!def) {
      return { ok: false, error: `未知动作：${action}` };
    }

    // 写操作域级互斥：同域已有任务在跑就拒绝，并明确告诉用户在等谁
    if (!def.readonly) {
      const holder = this.#locks.get(def.domain);
      if (holder) {
        const h = this.#jobs.get(holder);
        const step = h?.steps.find((s) => s.status === 'running' || s.status === 'pending');
        const stepHint = step ? `（正在「${step.title}」）` : '';
        return {
          ok: false,
          error: `${def.title}需要独占执行，但「${h?.actionTitle ?? holder}」正在进行中${stepHint} —— 去「任务」页看进度，或取消它后再试`,
        };
      }
    }

    const now = new Date().toISOString();
    const job: Job = {
      id: `job-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
      action,
      actionTitle: def.title,
      params,
      source: opts.source ?? "ui",
      status: "queued",
      createdAt: now,
      steps: (def.steps ?? []).map((title, i): JobStep => ({
        id: `s${i + 1}`,
        title,
        status: "pending",
      })),
      progress: 0,
      cancellable: !def.readonly || (def.steps?.length ?? 0) > 0,
    };

    // 跨进程/跨版本写互斥（S3）：新旧两版共享 ~/.dsh/write.lock。
    // 拿不到就不建任务 —— 快速把「谁在占着」告诉用户；job 此时尚未入表，零副作用。
    if (!def.readonly) {
      const acq = await tryAcquireWriteLock(def.domain, job.id, { version: APP_VERSION });
      if (!acq.ok) {
        const who = acq.heldBy
          ? `另一写操作正在进行（${acq.heldBy.holder} ${
            acq.heldBy.holder === acq.heldBy.version ? "" : acq.heldBy.version
          }，任务 ${acq.heldBy.jobId}，域 ${acq.heldBy.domain}）`
          : acq.reason;
        return { ok: false, error: `${def.title}无法执行：${who}` };
      }
    }

    this.#jobs.set(job.id, job);
    // write-ahead：任务一诞生就落盘，进程被杀也能知道"当时在干什么"
    this.#persist(job);
    this.#emit({ type: "created", jobId: job.id, message: `已创建任务：${def.title}` });

    if (!def.readonly) this.#locks.set(def.domain, job.id);

    // 不 await：立刻把 jobId 还给调用方，执行在后台推进
    this.#execute(job, def).catch((e) => {
      log.error("jobs", `任务执行器异常：${(e as Error).message}`, job.id);
    });

    return { ok: true, jobId: job.id };
  }

  /** 请求取消。返回 false 表示任务已结束或不可取消。 */
  async cancel(jobId: string): Promise<boolean> {
    const job = this.#jobs.get(jobId);
    if (!job) return false;
    if (job.status !== "running" && job.status !== "queued") return false;
    if (!job.cancellable) return false;
    const ctrl = this.#aborts.get(jobId);
    if (!ctrl) {
      // 还在排队，直接标记取消
      this.#finish(job, "cancelled", "任务在开始前被取消");
      return true;
    }
    ctrl.abort();
    return true;
  }

  async #execute(job: Job, def: AnyActionDef): Promise<void> {
    const totalTimeout = def.timeoutMs ?? TIMEOUTS.jobTotal;
    const userCtrl = new AbortController();
    this.#aborts.set(job.id, userCtrl);
    const timeoutSignal = AbortSignal.timeout(totalTimeout);
    const signal = AbortSignal.any([userCtrl.signal, timeoutSignal]);
    const undos: Array<() => Promise<void>> = [];

    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.#persist(job);
    this.#emit({ type: "started", jobId: job.id, message: `开始执行：${def.title}` });

    let cursor: JobStep | null = null;
    // cursor 只在 ctx.step 闭包里被赋值，函数体里直接读会被 TS 的流程分析窄化成 never；
    // 经由函数读取才能保住声明类型。
    const currentStep = (): JobStep | null => cursor;

    const ctx: ActionContext = {
      jobId: job.id,
      signal,
      step: (id, title, detail) => {
        if (cursor && cursor.status === "running") {
          cursor.status = "done";
          cursor.endedAt = new Date().toISOString();
          this.#emit({
            type: "step-done",
            jobId: job.id,
            stepId: cursor.id,
            message: cursor.title,
          });
        }
        let s = job.steps.find((x) => x.id === id);
        if (!s) {
          s = { id, title: title ?? id, status: "pending" };
          job.steps.push(s);
        }
        if (title) s.title = title;
        if (detail) s.detail = detail;
        s.status = "running";
        s.startedAt = new Date().toISOString();
        cursor = s;
        this.#emit({
          type: "step-start",
          jobId: job.id,
          stepId: s.id,
          message: s.title,
          data: detail ? { detail } : undefined,
        });
        this.#persist(job);
      },
      detail: (text) => {
        if (cursor) {
          cursor.detail = cursor.detail ? `${cursor.detail}｜${text}` : text;
        }
        this.#emit({ type: "step-log", jobId: job.id, stepId: cursor?.id, message: text });
      },
      log: (line) => {
        log.info(def.name, line, job.id);
        this.#emit({ type: "step-log", jobId: job.id, stepId: cursor?.id, message: line });
      },
      progress: (v) => {
        job.progress = Math.max(0, Math.min(1, v));
        this.#persist(job);
      },
      onUndo: (fn) => {
        undos.push(fn);
      },
      throwIfCancelled: () => {
        if (userCtrl.signal.aborted) throw new CancelledError();
        if (timeoutSignal.aborted) {
          throw new Error(`任务超时（${Math.round(totalTimeout / 1000)} 秒）`);
        }
      },
    };

    try {
      // 第 0 步：前置条件检查（失败则不进入实际操作）
      if (def.preflight) {
        ctx.step("preflight", "检查前置条件");
        const findings = await def.preflight(job.params as never);
        job.findings = findings;
        if (healthOf(findings) === "error") {
          const errs = findings.filter((f) => f.severity === "error");
          throw new Error(errs.map((f) => f.title).join("；"));
        }
      }

      const result = await def.run(ctx, job.params as never);

      const last = currentStep();
      if (last && last.status === "running") {
        last.status = "done";
        last.endedAt = new Date().toISOString();
        this.#emit({ type: "step-done", jobId: job.id, stepId: last.id, message: last.title });
      }

      job.result = result;
      this.#finish(job, "succeeded", undefined, true);
    } catch (e) {
      const err = e as Error;

      const failed = currentStep();
      if (failed && failed.status === "running") {
        failed.status = "failed";
        failed.endedAt = new Date().toISOString();
        failed.error = err.message;
        this.#emit({ type: "step-failed", jobId: job.id, stepId: failed.id, message: err.message });
      }

      // 补偿动作：逆序执行，单个失败不影响其余
      for (const undo of [...undos].reverse()) {
        try {
          await undo();
        } catch (ue) {
          log.warn("jobs", `补偿动作失败：${(ue as Error).message}`, job.id);
        }
      }

      let status: Job["status"] = "failed";
      if (err instanceof CancelledError || userCtrl.signal.aborted) status = "cancelled";
      else if (timeoutSignal.aborted) status = "timeout";

      this.#finish(job, status, err.message, true);
    } finally {
      this.#aborts.delete(job.id);
      this.#locks.delete(def.domain);
      if (!def.readonly) releaseWriteLock(job.id);
    }
  }

  #finish(job: Job, status: Job["status"], error?: string, persist = false): void {
    job.status = status;
    job.endedAt = new Date().toISOString();
    // 【2026-09-25 P0-2】失败信息统一过一遍错误翻译器：
    // 认得出就附上「怎么回事/为什么/影响/怎么办」，认不出就原样保留（绝不硬凑解释）。
    // 放在这里是单点收口 —— 所有动作的失败路径都会经过 #finish。
    job.error = error ? appendExplanation(error) : error;
    if (status === "succeeded") job.progress = 1;
    if (persist) this.#persist(job);
    this.#emit({
      type: "done",
      jobId: job.id,
      message: error ?? `任务结束：${status}`,
      data: { status },
    });
  }

  // ── 事件与持久化 ───────────────────────────────────────────────

  #emit(e: Omit<JobEvent, "seq" | "ts">): void {
    const event: JobEvent = { ...e, seq: ++this.#seq, ts: new Date().toISOString() };
    for (const fn of this.#listeners) {
      try {
        fn(event);
      } catch { /* 单个订阅者异常不影响其它 */ }
    }
  }

  #jobFile(jobId: string): string {
    return p(butlerJobsDir(), `${jobId}.json`);
  }

  #persist(job: Job): void {
    try {
      writeJsonAtomic(this.#jobFile(job.id), job);
    } catch (e) {
      log.warn("jobs", `任务落盘失败：${(e as Error).message}`, job.id);
    }
  }

  /** 启动时载入历史任务，并把上次没跑完的标记为 interrupted。 */
  loadHistory(): Job[] {
    const interrupted: Job[] = [];
    try {
      const files = listDir(butlerJobsDir()).filter((f) => !f.dir && f.name.endsWith(".json"));
      for (const f of files) {
        const job = readJson<Job>(p(butlerJobsDir(), f.name));
        if (!job?.id) continue;
        if (job.status === "running" || job.status === "queued") {
          job.status = "interrupted";
          job.error = "上次运行时程序被关闭，任务未确认结局";
          for (const s of job.steps) {
            if (s.status === "running") s.status = "failed";
          }
          interrupted.push(job);
          this.#persist(job);
        }
        this.#jobs.set(job.id, job);
      }
      this.#pruneHistory(files.length);
    } catch { /* 目录不存在等属正常 */ }
    return interrupted;
  }

  #pruneHistory(currentCount: number): void {
    if (currentCount <= this.#historyLimit) return;
    const sorted = [...this.#jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const drop = sorted.slice(0, currentCount - this.#historyLimit);
    for (const j of drop) {
      if (j.status === "running" || j.status === "queued") continue;
      removeRecursive(this.#jobFile(j.id));
      this.#jobs.delete(j.id);
    }
  }
}

export const engine = new JobEngine();
