/**
 * 写操作审计的判据测试（P2-4）。
 *
 * 审计的价值全在「准」：把只读动作混进来会淹掉真改动，回滚点关联错了会让人以为能退回去。
 * 所以这两件都按纯函数钉住。
 */
import { assertEquals } from "@std/assert";
import type { Job } from "../../jobs/types.ts";
import type { RollbackPoint } from "../backup/rollback.ts";
import { auditSummary, buildAuditRows, renderAuditCsv, renderAuditMarkdown, summarizeJob } from "./audit.ts";

function job(over: Partial<Job>): Job {
  return {
    id: "job-1",
    action: "plugin.install",
    actionTitle: "安装插件",
    params: { name: "dsh-x" },
    status: "succeeded",
    createdAt: "2026-09-26T10:00:00.000Z",
    startedAt: "2026-09-26T10:00:00.000Z",
    endedAt: "2026-09-26T10:00:05.000Z",
    steps: [],
    progress: 1,
    source: "ui",
    ...over,
  } as Job;
}

const point = (over: Partial<RollbackPoint>): RollbackPoint => ({
  id: "rp-1",
  kind: "plugin-set",
  createdAt: "2026-09-26T10:00:01.000Z",
  trigger: "plugin.install 前置",
  artifacts: [],
  reverse: { op: "restore-files" },
  verified: true,
  sizeBytes: 0,
  ...over,
} as RollbackPoint);

Deno.test("审计：只列写操作，按时间倒序", () => {
  const jobs = [
    job({ id: "a", action: "plugin.install", startedAt: "2026-09-26T10:00:00.000Z" }),
    job({ id: "b", action: "diag.healthCheck", startedAt: "2026-09-26T11:00:00.000Z" }),
    job({ id: "c", action: "data.backup", startedAt: "2026-09-26T12:00:00.000Z", source: "schedule" }),
  ];
  const isWrite = (a: string) => a !== "diag.healthCheck";
  const rows = buildAuditRows(jobs, [], isWrite);
  assertEquals(rows.map((r) => r.action), ["data.backup", "plugin.install"], "只读动作不许出现，且按时间倒序");
  assertEquals(rows[0]!.source, "schedule", "触发方式要带出来");
  assertEquals(rows[1]!.source, "ui");
});

Deno.test("审计：回滚点关联（jobId 优先，其次触发说明 + 时间窗）", () => {
  const jobs = [job({ id: "job-1" })];
  // ① 精确匹配 jobId
  const byId = buildAuditRows(jobs, [point({ id: "rp-ok", jobId: "job-1", trigger: "无关" })], () => true);
  assertEquals(byId[0]!.rollbackPointId, "rp-ok");
  // ② 兜底：触发说明含动作名 + 时间落在窗口内
  const byTrigger = buildAuditRows(jobs, [point({ id: "rp-t", jobId: undefined, createdAt: "2026-09-26T10:00:02.000Z" })], () => true);
  assertEquals(byTrigger[0]!.rollbackPointId, "rp-t");
  // ③ 时间差太远的旧点不许瞎关联
  const far = buildAuditRows(jobs, [point({ id: "rp-old", jobId: undefined, createdAt: "2026-09-25T10:00:00.000Z" })], () => true);
  assertEquals(far[0]!.rollbackPointId, null, "隔了一天的旧回滚点不该算这次改动的");
  // ④ 动作名对不上也不关联
  const other = buildAuditRows(jobs, [point({ id: "rp-x", jobId: undefined, trigger: "core.update 前置" })], () => true);
  assertEquals(other[0]!.rollbackPointId, null);
});

Deno.test("审计：结果摘要与统计", () => {
  assertEquals(summarizeJob(job({ status: "succeeded", result: { verdict: "ok" } })), "结论 ok");
  assertEquals(summarizeJob(job({ status: "succeeded", result: undefined })), "成功");
  const failed = summarizeJob(job({ status: "failed", error: "第一行原因\n第二行细节" }));
  assertEquals(failed.includes("第一行原因"), true);
  assertEquals(failed.includes("第二行"), false, "只取首行，别把堆栈全塞进表格");
  assertEquals(summarizeJob(job({ status: "interrupted" })), "上次被打断");

  const rows = buildAuditRows([
    job({ id: "a", source: "ui" }),
    job({ id: "b", source: "schedule", status: "failed" }),
  ], [], () => true);
  const s = auditSummary(rows);
  assertEquals(s.total, 2);
  assertEquals(s.ok, 1);
  assertEquals(s.failed, 1);
  assertEquals(s.bySource.ui, 1);
  assertEquals(s.bySource.schedule, 1);
});

Deno.test("审计：Markdown 表格与 CSV 都能生成，且竖线被转义", () => {
  const rows = buildAuditRows([job({ id: "a", error: undefined })], [point({ jobId: "a" })], () => true);
  const md = renderAuditMarkdown(rows, "2026-09-26T12:00:00.000Z");
  assertEquals(md.includes("# DSH 管家 · 写操作审计"), true);
  assertEquals(md.includes("| 时间 | 方式 | 动作 | 结果 | 耗时 | 回滚点 | 摘要 |"), true);
  assertEquals(md.includes("rp-1"), true, "回滚点要出现在表格里");
  const csv = renderAuditCsv(rows);
  assertEquals(csv.split("\r\n").length, rows.length + 1, "一行表头 + 每行一条");
  const withPipe = buildAuditRows([job({ id: "p", actionTitle: "a|b" })], [], () => true);
  assertEquals(renderAuditMarkdown(withPipe).includes("a\\|b"), true, "竖线必须转义，否则表格会散");
});
