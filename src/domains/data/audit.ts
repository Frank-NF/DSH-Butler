/**
 * 写操作审计（P2-4）。
 *
 * 【要回答的问题】「谁在什么时候改了什么，还能不能退回去」。
 * 任务历史里有动作与结果、回滚点索引里有还原点，两边一拼就是完整流水 ——
 * 纯函数合并即可（好测），不需要新采集。
 *
 * 【为什么只列写操作】只读动作（体检、查看状态）每天几十条，混进来会把真正改过的东西淹掉。
 */

import type { Job, JobStatus } from "../../jobs/types.ts";
import type { RollbackPoint } from "../backup/rollback.ts";

export interface AuditRow {
  at: string;
  action: string;
  title: string;
  source: "ui" | "cli" | "schedule" | "unknown";
  status: JobStatus;
  durationMs: number | null;
  summary: string;
  rollbackPointId: string | null;
  params: Record<string, unknown>;
}

/** 结果摘要（纯函数）。 */
export function summarizeJob(job: Job): string {
  if (job.status === "succeeded") {
    const r = job.result as Record<string, unknown> | undefined;
    if (r && typeof r.verdict === "string") return "结论 " + r.verdict;
    if (r && typeof r.moved === "number") return "处理 " + r.moved + " 项";
    if (r && typeof r.fileCount === "number") return r.fileCount + " 个文件";
    if (r && typeof r.restored === "number") return "写回 " + r.restored + " 项";
    if (r && typeof r.deleted === "string") return "已删除 " + r.deleted;
    return "成功";
  }
  const err = (job.error ?? "").split("\n").find((l) => l.trim().length > 0) ?? "";
  const label = job.status === "cancelled"
    ? "已取消"
    : job.status === "timeout"
    ? "超时"
    : job.status === "interrupted"
    ? "上次被打断"
    : "失败";
  return err ? label + "：" + err.slice(0, 120) : label;
}

/**
 * 合并任务与回滚点，按时间倒序（纯函数）。
 * 回滚点关联：优先 jobId 精确匹配；否则用「触发说明含动作名 + 时间落在任务窗口内」兜底
 * （回滚点的 trigger 形如「plugin.install 前置」，含动作名是既定约定）。
 */
export function buildAuditRows(
  jobs: Job[],
  points: RollbackPoint[],
  isWrite: (action: string) => boolean,
): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const job of jobs) {
    if (!isWrite(job.action)) continue;
    const start = job.startedAt ?? job.createdAt;
    const t0 = Date.parse(start);
    const t1 = job.endedAt ? Date.parse(job.endedAt) : Date.now();
    let linked: RollbackPoint | null = null;
    for (const pt of points) {
      if (pt.jobId && pt.jobId === job.id) {
        linked = pt;
        break;
      }
      if (!pt.trigger.includes(job.action)) continue;
      const tp = Date.parse(pt.createdAt);
      if (Number.isFinite(tp) && tp >= t0 - 30_000 && tp <= t1 + 30_000) {
        linked = pt;
        break;
      }
    }
    rows.push({
      at: start,
      action: job.action,
      title: job.actionTitle,
      source: (job.source as AuditRow["source"]) ?? "unknown",
      status: job.status,
      durationMs: job.endedAt && job.startedAt ? Date.parse(job.endedAt) - Date.parse(job.startedAt) : null,
      summary: summarizeJob(job),
      rollbackPointId: linked ? linked.id : null,
      params: job.params ?? {},
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

export interface AuditSummary {
  total: number;
  ok: number;
  failed: number;
  bySource: Record<string, number>;
  earliest: string | null;
  latest: string | null;
}

/** 统计（纯函数）。 */
export function auditSummary(rows: AuditRow[]): AuditSummary {
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  const at = rows.map((r) => r.at).sort();
  return {
    total: rows.length,
    ok: rows.filter((r) => r.status === "succeeded").length,
    failed: rows.filter((r) => r.status !== "succeeded").length,
    bySource,
    earliest: at[0] ?? null,
    latest: at[at.length - 1] ?? null,
  };
}

const SOURCE_LABEL: Record<string, string> = { ui: "界面", cli: "命令行", schedule: "定时", unknown: "未知" };

function escCell(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** 渲染成 Markdown（人看）—— 审计报告的主文件。 */
export function renderAuditMarkdown(rows: AuditRow[], generatedAt = new Date().toISOString()): string {
  const s = auditSummary(rows);
  const lines: string[] = [
    "# DSH 管家 · 写操作审计",
    "",
    "- 生成时间：" + new Date(generatedAt).toLocaleString("zh-CN"),
    "- 记录条数：" + s.total + "（成功 " + s.ok + " / 未成功 " + s.failed + "）",
    "- 触发方式：" + (Object.entries(s.bySource).map(([k, v]) => (SOURCE_LABEL[k] ?? k) + " " + v).join("、") || "-"),
    "- 时间范围：" + (s.earliest ? new Date(s.earliest).toLocaleString("zh-CN") : "-") + " → " +
      (s.latest ? new Date(s.latest).toLocaleString("zh-CN") : "-"),
    "",
    "| 时间 | 方式 | 动作 | 结果 | 耗时 | 回滚点 | 摘要 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    const dur = r.durationMs === null ? "-" : (r.durationMs / 1000).toFixed(1) + "s";
    lines.push(
      "| " + new Date(r.at).toLocaleString("zh-CN") + " | " + (SOURCE_LABEL[r.source] ?? r.source) + " | " +
        escCell(r.title) + " | " + r.status + " | " + dur + " | " + (r.rollbackPointId ?? "-") + " | " +
        escCell(r.summary) + " |",
    );
  }
  lines.push("");
  lines.push("说明：只列【写操作】。回滚点 id 可拿去「记录 → 回滚点」页一键还原；没有回滚点的条目说明当时无需还原或未留点。");
  return lines.join("\n");
}

/** 渲染成 CSV（机器处理/表格软件）。 */
export function renderAuditCsv(rows: AuditRow[]): string {
  const cell = (s: string) => '"' + (s ?? "").replace(/"/g, '""') + '"';
  const out = ["时间,方式,动作,动作标题,结果,耗时秒,回滚点,摘要,参数"];
  for (const r of rows) {
    out.push([
      cell(r.at),
      cell(r.source),
      cell(r.action),
      cell(r.title),
      cell(r.status),
      cell(r.durationMs === null ? "" : (r.durationMs / 1000).toFixed(1)),
      cell(r.rollbackPointId ?? ""),
      cell(r.summary),
      cell(JSON.stringify(r.params)),
    ].join(","));
  }
  return out.join("\r\n");
}
