/** 写操作审计的两个动作（P2-4）：只读查看 + 导出成文件。 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { engine } from "../../jobs/engine.ts";
import { ensureDir, listDir, writeJsonAtomic } from "../../host/fs.ts";
import { butlerRoot, p, stampOf } from "../../util/paths.ts";
import { APP_VERSION, TIMEOUTS } from "../../version.ts";
import { listRollbackPoints } from "../backup/rollback.ts";
import { redactDeep, redactionContext, scanForLeaks, type LeakHit } from "../diag/package.ts";
import { auditSummary, buildAuditRows, renderAuditCsv, renderAuditMarkdown, type AuditRow } from "./audit.ts";

/** 只读动作也算写的话就错了 —— 判据统一走注册表里的 readonly 标记。 */
function isWriteAction(action: string): boolean {
  const def = engine.definition(action);
  return def ? def.readonly === false : false;
}

/**
 * 取历史任务。
 * 【踩过的坑】绝不能用那个「启动时的一次性恢复」方法：它会把 running/queued
 * 的任务标成 interrupted 并落盘 —— 在运行中的动作里调它，等于把正在跑的自己和同伴标成「被打断」
 * （用户截图里「写操作审计」自己报「上次运行时程序被关闭」就是这个原因）。engine.list 只读。
 */
function historyJobs() {
  return engine.list(500);
}

function collectRows(): AuditRow[] {
  return buildAuditRows(historyJobs(), listRollbackPoints(), isWriteAction);
}

export interface AuditReport {
  rows: AuditRow[];
  summary: ReturnType<typeof auditSummary>;
  /** 历史里一共多少条任务（含只读），用于说明「为什么只列这些」。 */
  totalJobs: number;
}

export const dataAuditAction: ActionDef<Record<string, never>, AuditReport> = {
  name: "data.audit",
  domain: "data",
  title: "写操作审计",
  description:
    "只读：把任务历史里的【写操作】按时间倒序列出（谁触发的 / 改了什么 / 结果 / 耗时 / 留下的回滚点），用于回答「这个改动是谁做的、还能不能退回去」。",
  readonly: true,
  steps: ["读取任务历史", "关联回滚点", "汇总"],
  run: async (ctx) => {
    ctx.step("s1", "读取任务历史");
    const jobs = historyJobs();
    ctx.detail(`历史任务 ${jobs.length} 条`);
    ctx.progress(0.4);
    ctx.step("s2", "关联回滚点");
    const points = listRollbackPoints();
    const rows = buildAuditRows(jobs, points, isWriteAction);
    const linked = rows.filter((r) => r.rollbackPointId).length;
    ctx.detail(`写操作 ${rows.length} 条，其中 ${linked} 条能定位到回滚点`);
    ctx.progress(0.8);
    ctx.step("s3", "汇总");
    const summary = auditSummary(rows);
    ctx.progress(1);
    return { rows, summary, totalJobs: jobs.length };
  },
};

export interface AuditExportParams { destDir?: string }
export interface AuditExportReport {
  dir: string;
  files: Array<{ name: string; bytes: number }>;
  rows: number;
  leaks: LeakHit[];
  leakCheck: "passed" | "failed";
}

export function auditExportPreflight(): Finding[] {
  const ctx = redactionContext();
  const rows = collectRows();
  return [
    finding("audit.export-plan", "info", `将导出 ${rows.length} 条写操作记录（Markdown + CSV）`, {
      cause: "内容来自任务历史与回滚点索引，只包含【写操作】",
      impact:
        `会脱敏：家目录 → ~、用户名（${ctx.user ? ctx.user.slice(0, 1) + "***" : "未取到"}）→ %USER%、密钥/令牌 → ***、邮箱 → %EMAIL%；写出后回读自检，有残留就判失败`,
      action: "确认后继续；文件写在你磁盘上，随时可删",
      evidence: ["审计流水.md（表格，给人看）", "审计流水.csv（给表格软件）", "MANIFEST.json"],
    }),
  ];
}

async function runAuditExport(ctx: ActionContext, params: AuditExportParams): Promise<AuditExportReport> {
  const redCtx = redactionContext();
  ctx.step("s1", "读取并合并记录");
  ctx.progress(0.25);
  const rows = collectRows();
  ctx.detail(`写操作 ${rows.length} 条`);
  ctx.step("s2", "渲染并脱敏写出");
  const destDir = params.destDir && params.destDir.trim()
    ? params.destDir.trim()
    : p(butlerRoot(), "audit");
  const dir = p(destDir, "审计报告-" + stampOf());
  ensureDir(dir);
  const files: Array<{ name: string; bytes: number }> = [];
  const write = (name: string, content: string) => {
    const safe = redactDeep(content, redCtx);
    Deno.writeTextFileSync(p(dir, name), safe);
    files.push({ name, bytes: new TextEncoder().encode(safe).length });
  };
  write("审计流水.md", renderAuditMarkdown(rows));
  write("审计流水.csv", renderAuditCsv(rows));
  writeJsonAtomic(p(dir, "MANIFEST.json"), {
    schemaVersion: 1,
    kind: "dsh-butler-audit",
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    rows: rows.length,
    files,
  });
  files.push({ name: "MANIFEST.json", bytes: Deno.statSync(p(dir, "MANIFEST.json")).size });
  ctx.log(`已写出：${dir}（${rows.length} 条记录）`);
  ctx.progress(0.85);

  ctx.step("s3", "回读自检");
  const leaks: LeakHit[] = [];
  for (const f of listDir(dir)) {
    if (f.dir) continue;
    try {
      leaks.push(...scanForLeaks(f.name, Deno.readTextFileSync(p(dir, f.name)), redCtx));
    } catch { /* 读不了就跳过 */ }
  }
  if (leaks.length) {
    const bad = dir + "-未通过脱敏检查";
    try {
      Deno.renameSync(dir, bad);
    } catch { /* 改名失败就保持原名 */ }
    const detail = leaks.slice(0, 6).map((l) => `${l.file}：${l.kind}（${l.sample}）`).join("；");
    throw new Error(`脱敏自检未通过，已改名以免误发：${bad}｜发现 ${leaks.length} 处：${detail}`);
  }
  ctx.log("✓ 脱敏自检通过");
  ctx.progress(1);
  return { dir, files, rows: rows.length, leaks: [], leakCheck: "passed" };
}

export const dataAuditExportAction: ActionDef<AuditExportParams, AuditExportReport> = {
  name: "data.auditExport",
  domain: "data",
  title: "导出写操作审计",
  description:
    "把写操作流水导成 Markdown（给人看）与 CSV（给表格软件），同样做脱敏与回读自检。适合留档或交给别人核对「这些改动是谁做的」。",
  readonly: false,
  steps: ["读取并合并记录", "渲染并脱敏写出", "回读自检"],
  preflight: async () => auditExportPreflight(),
  run: (ctx, params) => runAuditExport(ctx, params),
  timeoutMs: TIMEOUTS.install,
};
