/** diag.stats —— 运维统计（只读）。 */
import type { ActionDef } from "../../jobs/types.ts";
import { engine } from "../../jobs/engine.ts";
import { buildJobStats, collectVolumes, dirVolume, listSamples, recordSample, type JobStats, type StatsSample, type VolumeEntry } from "./stats.ts";
import { butlerRoot, p } from "../../util/paths.ts";

export interface StatsReport {
  jobs: JobStats;
  volumes: VolumeEntry[];
  volumesTotal: number;
  samples: StatsSample[];
  backups: { count: number; bytes: number };
}

export const diagStatsAction: ActionDef<Record<string, never>, StatsReport> = {
  name: "diag.stats",
  domain: "diag",
  title: "运维统计",
  description:
    "只读：把任务历史聚合成运维视角（成功率、耗时中位数与最长、最常跑的动作、失败原因 TOP、定时与手动占比、每日任务量），并统计各数据目录体积与每日采样趋势。",
  readonly: true,
  steps: ["聚合任务历史", "统计目录体积", "读每日采样"],
  run: async (ctx) => {
    ctx.step("s1", "聚合任务历史");
    const jobs = engine.list(500);
    const stats = buildJobStats(jobs, 30);
    ctx.detail(`${stats.total} 条任务，成功率 ${stats.successRate}%`);
    ctx.progress(0.4);
    ctx.step("s2", "统计目录体积");
    const volumes = collectVolumes();
    const total = volumes.reduce((s, v) => s + v.bytes, 0);
    ctx.detail(`${volumes.length} 个目录，合计 ${(total / 1024 / 1024).toFixed(1)} MB`);
    ctx.progress(0.8);
    ctx.step("s3", "读每日采样");
    // 顺手补今天的采样：用户打开统计页就顺手记一条，不依赖定时任务（同一天覆盖，不留重复点）
    try {
      recordSample({ jobsOk: stats.ok, jobsFailed: stats.failed });
    } catch { /* 采样失败不影响看统计 */ }
    const samples = listSamples(60);
    const backupDir = dirVolume("backups", p(butlerRoot(), "backups"), 4000);
    ctx.progress(1);
    return { jobs: stats, volumes, volumesTotal: total, samples, backups: { count: 0, bytes: backupDir.bytes } };
  },
};
