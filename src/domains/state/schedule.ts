/**
 * 定时任务：什么时候该跑、上次跑到哪（P1-2e + P2-3 共用底座）。
 *
 * 【两个设计决定】
 *   1. 判定是纯函数（dueTasks）：给定「现在、配置、上次跑的时间」就能算该不该跑 ——
 *      这类「到点自动动」的逻辑最容易写错又不自知，纯函数才测得动。
 *   2. 首次启动**不立刻跑**：状态里没有上次时间时，只记下「从现在起算」，等一个周期再跑。
 *      否则每次开管家都会立刻体检 + 备份一次 —— 用户什么都没干，机器却在忙。
 *
 * 跑动作交给任务引擎（engine.create），所以定时任务和手动任务走同一条路：
 * 有步骤、有历史、受写锁约束、失败可查。
 */

import { pathExists, readJson, writeJsonAtomic } from "../../host/fs.ts";
import { butlerRoot, p } from "../../util/paths.ts";
import type { ScheduleConfig } from "./config.ts";

export type ScheduledTaskId = "health" | "backup" | "checkUpdates";

export interface TaskDef {
  id: ScheduledTaskId;
  label: string;
  everyHours: number;
}

/** 配置 → 任务表（纯函数）。 */
export function taskIntervals(cfg: ScheduleConfig): TaskDef[] {
  return [
    { id: "health", label: "定时体检", everyHours: cfg.healthEveryHours },
    { id: "backup", label: "定时备份", everyHours: cfg.backupEveryHours },
    { id: "checkUpdates", label: "定时查更新", everyHours: cfg.checkUpdatesEveryHours },
  ];
}

export interface DueTask extends TaskDef {
  lastRun: string | null;
  /** 超期多久（毫秒）；首次运行为 0。 */
  overdueMs: number;
}

/**
 * 算出此刻该跑哪些任务（纯函数）。
 * overdueMs 大的排前面：停了一天再开机时，先跑最该跑的。
 */
export function dueTasks(
  nowMs: number,
  cfg: ScheduleConfig,
  lastRun: Partial<Record<ScheduledTaskId, string>>,
  opts: { initial?: boolean } = {},
): DueTask[] {
  if (!cfg.enabled) return [];
  const out: DueTask[] = [];
  for (const t of taskIntervals(cfg)) {
    if (!(t.everyHours > 0)) continue;
    const last = lastRun[t.id];
    if (!last) {
      if (opts.initial) out.push({ ...t, lastRun: null, overdueMs: 0 });
      continue; // 没跑过：不立刻跑，等一个周期（见文件头第 2 条）
    }
    const at = Date.parse(last);
    if (!Number.isFinite(at)) continue;
    const elapsed = nowMs - at;
    const every = t.everyHours * 3600_000;
    if (elapsed >= every) out.push({ ...t, lastRun: last, overdueMs: elapsed - every });
  }
  return out.sort((a, b) => b.overdueMs - a.overdueMs);
}

// ── 状态（上次跑到哪） ─────────────────────────────────────────────

export interface ScheduleState {
  /** 每个任务上次成功跑完的时间。 */
  lastRun: Partial<Record<ScheduledTaskId, string>>;
}

export function scheduleStatePath(): string {
  return p(butlerRoot(), "schedule.json");
}

export function loadScheduleState(): ScheduleState {
  const file = scheduleStatePath();
  if (!pathExists(file)) return { lastRun: {} };
  const j = readJson<ScheduleState>(file);
  return { lastRun: j?.lastRun && typeof j.lastRun === "object" ? j.lastRun : {} };
}

export function saveScheduleState(state: ScheduleState): void {
  writeJsonAtomic(scheduleStatePath(), state);
}

/** 记下某个任务刚跑完（纯函数：返回新状态，落盘由调用方决定）。 */
export function markRun(
  state: ScheduleState,
  id: ScheduledTaskId,
  at: string = new Date().toISOString(),
): ScheduleState {
  return { lastRun: { ...state.lastRun, [id]: at } };
}

/** 首次启动时把「从现在起算」写进去，避免立刻触发（见文件头第 2 条）。 */
export function initializeScheduleState(cfg: ScheduleConfig, now: number = Date.now()): ScheduleState {
  const at = new Date(now).toISOString();
  const state: ScheduleState = { lastRun: {} };
  for (const t of taskIntervals(cfg)) state.lastRun[t.id] = at;
  return state;
}
