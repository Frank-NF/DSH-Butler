/**
 * 定时任务调度器（P1-2e + P2-3）。
 *
 * 每 intervalMs（默认 5 分钟）醒一次，问一句「现在该跑什么」（dueTasks 纯函数），
 * 然后通过任务引擎起任务 —— 于是定时任务与手动任务走完全同一条路：
 * 有步骤、有历史、受域锁约束、失败可查。
 *
 * 三条纪律：
 *   1. 有任务在跑时整轮跳过（不抢锁、不插队）；
 *   2. 起不来就不记账（下一轮再试），绝不假装跑过；
 *   3. 结果要留痕：体检发现错误/警告、备份失败、有插件可更新 → 记一条提醒（带去重）。
 */

import { engine } from "../../jobs/engine.ts";
import type { Job } from "../../jobs/types.ts";
import { log } from "../../util/log.ts";
import { checkUpdates } from "../../net/npm-registry.ts";
import { loadConfig, type ScheduleConfig } from "./config.ts";
import { addNotice, type NoticeLevel, unseenCount } from "./notices.ts";
import {
  dueTasks,
  initializeScheduleState,
  loadScheduleState,
  markRun,
  saveScheduleState,
  scheduleStatePath,
  type ScheduledTaskId,
} from "./schedule.ts";
import { pathExists } from "../../host/fs.ts";
import { readInstalledDeps } from "../plugin/deps_actions.ts";

export const DEFAULT_TICK_MS = 5 * 60_000;

/** 定时任务 → 要交给引擎的动作。 */
export const TASK_ACTIONS: Record<ScheduledTaskId, { action: string; params: Record<string, unknown> }> = {
  health: { action: "diag.healthCheck", params: {} },
  backup: { action: "data.backup", params: { preset: "config" } },
  checkUpdates: { action: "", params: {} }, // 这个不跑任务，只在进程内查一次（见 tick）
};

/** 查更新的结论 → 提醒内容（纯函数，便于测试）。 */
export function updateNoticeOf(
  updates: Record<string, { current: string; latest: string; outdated: boolean }>,
): { level: NoticeLevel; title: string; detail: string } | null {
  const out = Object.entries(updates).filter(([, u]) => u.outdated);
  if (!out.length) return null;
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    level: "info",
    title: out.length + " 个插件有新版本",
    detail: out.slice(0, 8).map(([n, u]) => `${n} ${u.current} → ${u.latest}`).join("；"),
  };
}

/** 体检结论 → 提醒内容（纯函数）：只报错误与警告，全绿就闭嘴。 */
export function healthNoticeOf(
  findings: Array<{ severity: string; title: string }>,
): { level: NoticeLevel; title: string; detail: string } | null {
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");
  if (!errors.length && !warns.length) return null;
  return {
    level: errors.length ? "error" : "warn",
    title: `定时体检：${errors.length} 项错误 / ${warns.length} 项警告`,
    detail: [...errors, ...warns].slice(0, 5).map((f) => f.title).join("；"),
  };
}

export interface SchedulerHandle {
  /** 停掉定时器。 */
  stop: () => void;
  /** 立刻跑一轮（测试与「立即执行」用）。 */
  tickNow: () => Promise<void>;
}

export interface SchedulerOptions {
  intervalMs?: number;
  /** 提醒有变化时回调（界面/托盘用来刷新）。 */
  onNoticesChanged?: (unseen: number) => void;
}

export function startScheduler(opts: SchedulerOptions = {}): SchedulerHandle {
  const cfg = loadConfig();
  // 首次：把「从现在起算」写进状态，避免一开管家就体检 + 备份一遍
  if (!pathExists(scheduleStatePath())) {
    saveScheduleState(initializeScheduleState(cfg.schedule));
    log.info("schedule", "已初始化定时任务状态（从现在起算，一个周期后开始跑）");
  }

  /** jobId → 定时任务 id：用于在任务收尾时判断该不该记提醒。 */
  const watched = new Map<string, ScheduledTaskId>();
  const unsub = engine.subscribe((ev) => {
    if (ev.type !== "done") return;
    const task = watched.get(ev.jobId);
    if (!task) return;
    watched.delete(ev.jobId);
    const job: Job | undefined = engine.get(ev.jobId);
    if (!job) return;
    if (task === "health" && job.status === "succeeded") {
      const findings = (job.result as { findings?: Array<{ severity: string; title: string }> } | undefined)?.findings ?? [];
      const n = healthNoticeOf(findings);
      if (n && loadConfig().schedule.notify) {
        addNotice({ ...n, source: "定时体检" });
        log.info("schedule", `定时体检：${n.title}`);
      }
    } else if (task === "backup") {
      if (job.status === "succeeded") {
        log.info("schedule", "定时备份完成");
      } else if (loadConfig().schedule.notify) {
        addNotice({ level: "error", title: "定时备份失败", detail: job.error ?? "未知原因", source: "定时备份" });
      }
    }
    opts.onNoticesChanged?.(unseenCount());
  });

  const tick = async () => {
    const now = loadConfig();
    const sc: ScheduleConfig = now.schedule;
    if (!sc.enabled) return;
    // ① 有任务在跑就整轮跳过：不抢锁、不插队
    if (engine.list(20).some((j) => j.status === "running" || j.status === "queued")) return;
    const due = dueTasks(Date.now(), sc, loadScheduleState().lastRun);
    if (!due.length) return;

    for (const t of due) {
      try {
        if (t.id === "checkUpdates") {
          const installed = readInstalledDeps();
          const names = Object.keys(installed);
          if (names.length) {
            const res = await checkUpdates(installed, names);
            const n = updateNoticeOf(res.updates);
            if (n && sc.notify) {
              addNotice({ ...n, source: "定时查更新" });
              log.info("schedule", n.title);
            }
          }
          saveScheduleState(markRun(loadScheduleState(), t.id));
          opts.onNoticesChanged?.(unseenCount());
          continue;
        }
        const spec = TASK_ACTIONS[t.id];
        const created = await engine.create(spec.action, spec.params, { source: "schedule" });
        if (!created.ok || !created.jobId) {
          // 起不来就不记账 —— 下一轮再试（例如别的写操作正占着）
          log.warn("schedule", `${t.label}本轮未启动：${created.error ?? "未知原因"}`);
          continue;
        }
        watched.set(created.jobId, t.id);
        saveScheduleState(markRun(loadScheduleState(), t.id));
        log.info("schedule", `已按计划启动${t.label}（任务 ${created.jobId}）`);
      } catch (e) {
        log.warn("schedule", `${t.label} 调度失败：${(e as Error).message}`);
      }
    }
  };

  const timer = setInterval(() => {
    tick().catch((e) => log.error("schedule", `调度器异常：${(e as Error).message}`));
  }, opts.intervalMs ?? DEFAULT_TICK_MS);

  return {
    stop: () => {
      clearInterval(timer);
      unsub();
    },
    tickNow: tick,
  };
}

