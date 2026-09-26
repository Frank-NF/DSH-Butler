/**
 * 运维统计（P3）。
 *
 * 【为什么值得做】管家手里本来就有原料：~/.dsh-butler/jobs 里几百份任务历史
 * （动作 / 触发方式 / 状态 / 起止时间 / 步骤耗时），此前只是列表展示，从没聚合过。
 * 这个模块把「原料」变成「运维视角」：成功率、耗时分布、最常跑的动作、失败原因 TOP、
 * 定时 vs 手动占比；再配合每日采样，过几天就能看体积与体检结论的趋势。
 *
 * 【为什么自己算而不是引图表库】项目前端是零依赖（内嵌 ES5 + 手写 CSS），
 * 图表也用 SVG 手写；统计本身是纯函数，好测。
 */

import type { Job } from "../../jobs/types.ts";
import { ensureDir, listDir, readJson } from "../../host/fs.ts";
import { butlerRoot, dshProfileDir, homeDir, p } from "../../util/paths.ts";

export interface Bucket { key: string; count: number }
export interface DailyPoint { date: string; count: number; ok: number; failed: number }

export interface JobStats {
  rangeDays: number;
  total: number;
  ok: number;
  failed: number;
  running: number;
  successRate: number;
  avgMs: number | null;
  medianMs: number | null;
  maxMs: number | null;
  bySource: Bucket[];
  topActions: Bucket[];
  topFailures: Bucket[];
  daily: DailyPoint[];
  /** 覆盖到的时间范围（最早一条）。 */
  since: string | null;
}

function dayOf(iso: string): string {
  return (iso || "").slice(0, 10);
}

function durationOf(job: Job): number | null {
  if (!job.startedAt || !job.endedAt) return null;
  const d = Date.parse(job.endedAt) - Date.parse(job.startedAt);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/** 失败原因归一到「一句话」，避免每个 job 的细节各算一类。 */
export function failureKey(job: Job): string {
  const raw = (job.error ?? "").split("\n").map((s) => s.trim()).find((s) => s.length > 0) ?? "";
  if (!raw) return job.status === "interrupted" ? "上次被打断" : job.status === "cancelled" ? "已取消" : job.status === "timeout" ? "超时" : "失败（无原因）";
  // 去掉路径、数字、括号里的细节，只留骨架
  // 把数字抹成 N、砍掉盘符路径，让「同一类失败」归到一条（否则每个 job 一行细节各算一类）
  const slim = raw
    .replace(/[A-Za-z]:\\[^\s，,；;]+/g, "<路径>")
    .replace(/\d+/g, "N")
    .slice(0, 80);
  return slim || "失败（无原因）";
}

/**
 * 任务聚合（纯函数）。
 * 只统计窗口内的任务；窗口按「距今多少天」算。
 */
export function buildJobStats(jobs: Job[], rangeDays = 30, now = Date.now()): JobStats {
  const from = now - rangeDays * 24 * 3600 * 1000;
  const inRange = jobs.filter((j) => {
    const t = Date.parse(j.startedAt ?? j.createdAt);
    return Number.isFinite(t) && t >= from;
  });
  const ok = inRange.filter((j) => j.status === "succeeded").length;
  const failed = inRange.filter((j) => j.status === "failed" || j.status === "timeout" || j.status === "interrupted").length;
  const running = inRange.filter((j) => j.status === "running" || j.status === "queued").length;
  const done = ok + failed;
  const durs = inRange.map(durationOf).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const pick = (q: number) => (durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * q))]! : null);

  const countBy = (keyOf: (j: Job) => string | null): Bucket[] => {
    const m = new Map<string, number>();
    for (const j of inRange) {
      const k = keyOf(j);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };

  const sourceLabel: Record<string, string> = { ui: "界面", cli: "命令行", schedule: "定时", unknown: "未知" };
  const daily = new Map<string, DailyPoint>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    daily.set(d, { date: d, count: 0, ok: 0, failed: 0 });
  }
  for (const j of inRange) {
    const d = dayOf(j.startedAt ?? j.createdAt);
    const point = daily.get(d);
    if (!point) continue;
    point.count++;
    if (j.status === "succeeded") point.ok++;
    else if (j.status === "failed" || j.status === "timeout" || j.status === "interrupted") point.failed++;
  }

  const starts = inRange.map((j) => j.startedAt ?? j.createdAt).filter(Boolean).sort();
  return {
    rangeDays,
    total: inRange.length,
    ok,
    failed,
    running,
    successRate: done ? Math.round((ok / done) * 1000) / 10 : 0,
    avgMs: durs.length ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) : null,
    medianMs: pick(0.5),
    maxMs: durs.length ? durs[durs.length - 1]! : null,
    bySource: countBy((j) => sourceLabel[j.source ?? "unknown"] ?? "未知"),
    topActions: countBy((j) => j.actionTitle || j.action).slice(0, 8),
    topFailures: countBy((j) => (j.status === "succeeded" ? null : failureKey(j))).slice(0, 6),
    daily: [...daily.values()],
    since: starts[0] ?? null,
  };
}

export interface VolumeEntry { label: string; path: string; bytes: number; files: number; truncated: boolean }

/**
 * 有预算的目录体积统计：既要出数，又不能把界面卡住。
 * 条目数超过上限就停下并标记 truncated（宁可标「至少这么多」也不冻界面）。
 */
export function dirVolume(label: string, path: string, budget = 20000): VolumeEntry {
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const walk = (dir: string, depth: number) => {
    if (truncated || depth > 8) return;
    let items;
    try {
      items = listDir(dir);
    } catch {
      return;
    }
    for (const it of items) {
      if (files >= budget) { truncated = true; return; }
      if (it.dir) { walk(p(dir, it.name), depth + 1); continue; }
      files++;
      try {
        bytes += Deno.statSync(p(dir, it.name)).size;
      } catch { /* 读不到就不算 */ }
    }
  };
  walk(path, 0);
  return { label, path, bytes, files, truncated };
}

/** 要统计的主要目录（DSH 数据 + 管家自己的）。 */
export function volumeTargets(): Array<{ label: string; path: string }> {
  const dsh = p(homeDir(), ".dsh");
  const butler = butlerRoot();
  return [
    { label: "会话记录", path: p(dsh, "sessions") },
    { label: "附件", path: p(dsh, "attachments") },
    { label: "技能", path: p(dsh, "skills") },
    { label: "存储", path: p(dsh, "storages") },
    { label: "profile 依赖", path: dshProfileDir() },
    { label: "管家备份", path: p(butler, "backups") },
    { label: "回滚点", path: p(butler, "rollback") },
    { label: "诊断包", path: p(butler, "diagnostics") },
    { label: "审计报告", path: p(butler, "audit") },
    { label: "任务历史", path: p(butler, "jobs") },
  ];
}

export function collectVolumes(budget = 6000): VolumeEntry[] {
  return volumeTargets().map((t) => dirVolume(t.label, t.path, budget)).filter((v) => v.bytes > 0 || v.files > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

// ── 每日采样：趋势曲线的原料 ──────────────────────────────────────

export interface StatsSample {
  date: string;
  takenAt: string;
  dshBytes: number;
  butlerBytes: number;
  jobsOk: number;
  jobsFailed: number;
  backups: number;
  backupBytes: number;
}

export function statsDir(): string {
  return p(butlerRoot(), "stats");
}

/** 记一条今天的采样（同一天重复调用就覆盖，不留重复点）。 */
export function recordSample(extra: Partial<StatsSample> = {}): StatsSample {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const dsh = ["sessions", "attachments", "skills", "storages"].reduce((s, d) => s + dirVolume(d, p(homeDir(), ".dsh", d), 4000).bytes, 0);
  const butler = ["backups", "rollback", "diagnostics", "audit", "jobs"].reduce((s, d) => s + dirVolume(d, p(butlerRoot(), d), 4000).bytes, 0);
  const backupDir = p(butlerRoot(), "backups");
  const bk = dirVolume("backups", backupDir, 4000);
  const sample: StatsSample = {
    date,
    takenAt: now.toISOString(),
    dshBytes: dsh,
    butlerBytes: butler,
    jobsOk: 0,
    jobsFailed: 0,
    backups: 0,
    backupBytes: bk.bytes,
    ...extra,
  };
  ensureDir(statsDir());
  Deno.writeTextFileSync(p(statsDir(), date + ".json"), JSON.stringify(sample, null, 2));
  return sample;
}

/** 读最近 n 天的采样（按日期升序）。 */
export function listSamples(limit = 30): StatsSample[] {
  try {
    return listDir(statsDir())
      .filter((f) => !f.dir && f.name.endsWith(".json"))
      .map((f) => readJson<StatsSample>(p(statsDir(), f.name)))
      .filter((s): s is StatsSample => !!s && typeof s.date === "string")
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-limit);
  } catch {
    return [];
  }
}
