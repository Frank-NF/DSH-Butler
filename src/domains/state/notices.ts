/**
 * 管家提醒（notices）：定时任务发现问题时留一条，界面与托盘都能看到。
 *
 * 【为什么要去重】定时任务每 5 分钟醒一次；如果问题一直存在，不去重就会每轮刷一条，
 * 用户看到的是一屏重复的「3 个插件可更新」。所以同来源 + 同标题在窗口期内只更新一条的时间。
 */

import { pathExists, readJson, writeJsonAtomic } from "../../host/fs.ts";
import { butlerRoot, p } from "../../util/paths.ts";

export type NoticeLevel = "info" | "warn" | "error";

export interface Notice {
  id: string;
  at: string;
  level: NoticeLevel;
  title: string;
  detail?: string;
  /** 谁产生的（定时体检 / 定时备份 / 定时查更新 / 手动）。 */
  source: string;
  /** 用户是否已看过。 */
  seen: boolean;
}

/** 只留最近这些条。 */
export const MAX_NOTICES = 50;
/** 同来源 + 同标题的去重窗口。 */
export const DEDUP_WINDOW_MS = 6 * 3600_000;

export function noticesPath(): string {
  return p(butlerRoot(), "notices.json");
}

export function loadNotices(): Notice[] {
  const file = noticesPath();
  if (!pathExists(file)) return [];
  const j = readJson<Notice[]>(file);
  return Array.isArray(j) ? j.filter((n) => n && typeof n.title === "string") : [];
}

export function saveNotices(list: Notice[]): void {
  writeJsonAtomic(noticesPath(), list.slice(0, MAX_NOTICES));
}

/**
 * 加一条提醒（带去重与上限）。纯逻辑部分可测：给定旧列表与现在时间，返回新列表。
 */
export function mergeNotice(
  list: Notice[],
  input: { level: NoticeLevel; title: string; detail?: string; source: string },
  nowMs = Date.now(),
): Notice[] {
  const nowIso = new Date(nowMs).toISOString();
  const hit = list.find((n) => n.source === input.source && n.title === input.title);
  if (hit && nowMs - Date.parse(hit.at) < DEDUP_WINDOW_MS) {
    // 窗口期内的同一件事：只刷新时间与细节，不新增一条
    const updated: Notice = { ...hit, at: nowIso, detail: input.detail ?? hit.detail, seen: false };
    return [updated, ...list.filter((n) => n.id !== hit.id)];
  }
  const fresh: Notice = {
    id: "nt-" + nowMs.toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    at: nowIso,
    level: input.level,
    title: input.title,
    detail: input.detail,
    source: input.source,
    seen: false,
  };
  return [fresh, ...list].slice(0, MAX_NOTICES);
}

export function addNotice(input: { level: NoticeLevel; title: string; detail?: string; source: string }): Notice[] {
  const next = mergeNotice(loadNotices(), input);
  saveNotices(next);
  return next;
}

export function unseenCount(list: Notice[] = loadNotices()): number {
  return list.filter((n) => !n.seen).length;
}

export function markNoticesSeen(): Notice[] {
  const next = loadNotices().map((n) => ({ ...n, seen: true }));
  saveNotices(next);
  return next;
}
