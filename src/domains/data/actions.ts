/**
 * 数据搬家 / 备份的动作层（P1-2）。
 *
 * 五个动作各管一件事：
 *   data.export   导出搬移包（可选预设；默认落到管家目录）
 *   data.inspect  只读：读包并摊开「会覆盖什么、会新增什么、哪些被拦」
 *   data.restore  还原（动手前自动把将被覆盖的现有文件做成回滚点，失败/取消可退回）
 *   data.backup   备份一次 + 按保留策略清理旧备份
 *   data.backups  只读：列出备份与占用
 *
 * 【为什么 restore 一定要先建回滚点】
 * 还原是「拿一个外部文件夹覆盖用户当前环境」。做对了是搬家，做错了是把当前环境砸了。
 * 所以先把【将被覆盖的现有文件】逐个入回滚点，再动手；这跟插件装卸是同一套纪律。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { butlerRoot, homeDir, p, stampOf } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";
import { applyRollbackPoint, createRollbackPoint } from "../backup/rollback.ts";
import { loadConfig } from "../state/config.ts";
import { type DataPreset, measureEntries, buildEntries, selectEntries, sizeText, skippedEntries, subsetsOf } from "./manifest.ts";
import {
  type BackupInfo,
  exportPackage,
  type InspectResult,
  inspectPackage,
  listBackups,
  restorePackage,
} from "./pack.ts";

/** 受管目录：备份与默认导出都落这里（跟隔离区、回滚点并列，用户一眼能找到）。 */
export function backupsDir(): string {
  return p(butlerRoot(), "backups");
}

// ── 保留策略（纯函数，便于测试） ───────────────────────────────────

export interface RetentionLimits {
  maxBackups: number;
  maxBackupBytes: number;
}

export interface RetentionPlan {
  keep: BackupInfo[];
  /** 超出保留策略、应清理的（从最旧开始）。 */
  trim: BackupInfo[];
  reason: string;
}

/**
 * 按「最多 N 个 / 最多 X 字节」算出该留哪些、该清哪些（从最旧开始清）。
 * 纯函数：输入是备份列表（已按时间倒序）与上限，输出是计划 —— 真正删除由调用方执行。
 * 【注意】最新的一个永远保留：哪怕它自己就超了体积上限，也不该把刚做的备份清掉。
 */
export function planRetention(backups: BackupInfo[], limits: RetentionLimits): RetentionPlan {
  const keep: BackupInfo[] = [];
  const trim: BackupInfo[] = [];
  let bytes = 0;
  for (let i = 0; i < backups.length; i++) {
    const b = backups[i]!;
    const first = i === 0;
    const overCount = keep.length >= Math.max(1, limits.maxBackups);
    const overBytes = bytes + b.bytes > Math.max(0, limits.maxBackupBytes) && !first;
    if (!first && (overCount || overBytes)) trim.push(b);
    else {
      keep.push(b);
      bytes += b.bytes;
    }
  }
  const reasons: string[] = [];
  if (trim.length) {
    reasons.push("保留策略：最多 " + limits.maxBackups + " 个 / " + Math.round(limits.maxBackupBytes / 1024 / 1024) + " MB");
    if (backups.length - trim.length >= limits.maxBackups) reasons.push("超出数量上限");
    if (bytes > limits.maxBackupBytes) reasons.push("超出体积上限");
  }
  return { keep, trim, reason: reasons.join("；") || "未超限" };
}

// ── data.export ─────────────────────────────────────────────────────

export interface ExportParams {
  preset?: DataPreset;
  /** 导出到哪；省略 = 管家 backups 目录。 */
  destDir?: string;
}

export interface ExportReport {
  dir: string;
  preset: DataPreset;
  fileCount: number;
  bytes: number;
  items: Array<{ label: string; bytes: number; kind: string }>;
  skipped: Array<{ label: string; subset: string }>;
  failed: Array<{ path: string; error: string }>;
}

function normalizePreset(v: unknown): DataPreset {
  return v === "with-skills" || v === "full" ? v : "config";
}

async function exportPreflight(params: ExportParams): Promise<Finding[]> {
  const preset = normalizePreset(params.preset);
  const entries = buildEntries(homeDir(), butlerRoot());
  const picked = selectEntries(entries, preset);
  const measured = measureEntries(picked);
  const skipped = skippedEntries(entries, preset);
  const out: Finding[] = [
    finding("data.export-plan", "info", `将打包 ${measured.length} 项、${sizeText(measured)}（预设：${preset}）`, {
      cause: `子集：${subsetsOf(preset).join("、")}`,
      impact: "只读源文件、写到目标目录；不会改动 DSH 的任何配置",
      action: "确认条目与体积符合预期",
      evidence: measured.slice(0, 12).map((m) => `${m.label} — ${m.kind === "dir" ? "目录" : "文件"}，${(m.bytes / 1024).toFixed(1)} KB${m.complete ? "" : "（至少）"}`),
    }),
  ];
  if (skipped.length) {
    out.push(
      finding("data.export-skipped", "info", `这次不带 ${skipped.length} 项（可重建或体积大）`, {
        cause: "它们不属于当前预设",
        impact: "换机后这些数据不会跟着走（缓存、日志、会话/附件除非选完整）",
        action: "确实要一起带走就换「with-skills」或「full」预设",
        evidence: skipped.slice(0, 8).map((s) => `${s.label}（子集 ${s.subset}）`),
      }),
    );
  }
  return out;
}

async function runExport(ctx: ActionContext, params: ExportParams): Promise<ExportReport> {
  const preset = normalizePreset(params.preset);
  const destDir = params.destDir && params.destDir.trim() ? params.destDir.trim() : backupsDir();
  ctx.step("s1", "挑选要打包的条目");
  ctx.progress(0.1);
  const entries = buildEntries(homeDir(), butlerRoot());
  const measured = measureEntries(selectEntries(entries, preset));
  ctx.detail(`将打包 ${measured.length} 项，${sizeText(measured)}`);
  ctx.throwIfCancelled();

  ctx.step("s2", "复制文件到搬移包");
  ctx.progress(0.35);
  const res = exportPackage({ preset, destDir, stamp: stampOf(), home: homeDir(), butlerRootDir: butlerRoot() });
  ctx.detail(`已复制 ${res.manifest.fileCount} 个文件`);
  for (const f of res.failed.slice(0, 5)) ctx.log(`⚠ 复制失败：${f.path}（${f.error}）`);
  ctx.progress(0.9);

  ctx.step("s3", "写入清单");
  ctx.log(`搬移包：${res.dir}`);
  ctx.log(`清单：${res.manifestPath}`);
  ctx.progress(1);
  return {
    dir: res.dir,
    preset,
    fileCount: res.manifest.fileCount,
    bytes: res.manifest.bytes,
    items: res.manifest.items.map((i) => ({ label: i.label, bytes: i.bytes, kind: i.kind })),
    skipped: res.manifest.skipped,
    failed: res.failed,
  };
}

export const dataExportAction: ActionDef<ExportParams, ExportReport> = {
  name: "data.export",
  domain: "data",
  title: "导出搬移包",
  description:
    "把 DSH 配置、profile 清单与锁、技能状态、管家设置打成一个搬移包（不压缩、附 MANIFEST 与说明），换机时拷过去就能恢复。只读源文件，不动 DSH 配置。",
  readonly: false,
  steps: ["挑选要打包的条目", "复制文件到搬移包", "写入清单"],
  preflight: exportPreflight,
  run: (ctx, params) => runExport(ctx, params),
  timeoutMs: TIMEOUTS.install,
};

// ── data.inspect / data.backups（只读） ────────────────────────────

/** 省略 dir 时用最新的一个备份。 */
function resolvePackDir(dir?: string): string | null {
  if (dir && dir.trim()) return dir.trim();
  const list = listBackups(backupsDir());
  return list.length ? list[0]!.dir : null;
}

export interface InspectParams { dir?: string }

export const dataInspectAction: ActionDef<InspectParams, InspectResult | { error: string }> = {
  name: "data.inspect",
  domain: "data",
  title: "检查搬移包",
  description: "只读：读搬移包清单，逐条对比目标位置，摊开「会覆盖什么、会新增什么、哪些因路径不安全被拦下」。不改动任何东西。",
  readonly: true,
  steps: ["读取清单", "逐条对比目标位置"],
  run: async (ctx, params) => {
    ctx.step("s1", "读取清单");
    const dir = resolvePackDir(params.dir);
    if (!dir) throw new Error("没有找到搬移包（管家备份目录是空的，也没有指定目录）");
    ctx.detail(`搬移包：${dir}`);
    ctx.progress(0.5);
    ctx.step("s2", "逐条对比目标位置");
    const res = inspectPackage(dir, homeDir(), butlerRoot());
    if ("error" in res) throw new Error(res.error);
    ctx.detail(`共 ${res.summary.total} 项：覆盖 ${res.summary.overwrites}、新增 ${res.summary.news}、拦下 ${res.summary.blocked}`);
    ctx.progress(1);
    return res;
  },
};

export const dataBackupsAction: ActionDef<Record<string, never>, {
  root: string;
  backups: BackupInfo[];
  totalBytes: number;
  limits: RetentionLimits;
  plan: RetentionPlan;
}> = {
  name: "data.backups",
  domain: "data",
  title: "列出搬移包/备份",
  description: "只读：列出管家备份目录里的搬移包（时间、体积、条目数），并按保留策略算出哪些会被清理。",
  readonly: true,
  steps: ["扫描备份目录", "套用保留策略"],
  run: async (ctx) => {
    ctx.step("s1", "扫描备份目录");
    const root = backupsDir();
    const backups = listBackups(root);
    const totalBytes = backups.reduce((s, b) => s + b.bytes, 0);
    ctx.detail(`共 ${backups.length} 个，合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    ctx.progress(0.6);
    ctx.step("s2", "套用保留策略");
    const cfg = loadConfig();
    const plan = planRetention(backups, cfg.retention);
    ctx.detail(plan.trim.length ? `按策略会清理 ${plan.trim.length} 个（${plan.reason}）` : "未超保留策略");
    ctx.progress(1);
    return { root, backups, totalBytes, limits: cfg.retention, plan };
  },
};

// ── data.restore（写，动手前建回滚点） ─────────────────────────────

export interface RestoreParams {
  dir?: string;
  /** true = 只算不做（界面先给人看）。 */
  dryRun?: boolean;
}

export interface RestoreReport {
  dir: string;
  restored: number;
  dryRun: boolean;
  rollbackPointId: string | null;
  overwritten: Array<{ label: string; target: string }>;
  failed: Array<{ target: string; error: string }>;
  blocked: Array<{ label: string; reason: string }>;
}

async function restorePreflight(params: RestoreParams): Promise<Finding[]> {
  const out: Finding[] = [];
  const dir = resolvePackDir(params.dir);
  if (!dir) {
    out.push(
      finding("data.no-pack", "error", "没有找到搬移包", {
        cause: "管家备份目录是空的，也没有指定目录",
        impact: "没有可恢复的内容",
        action: "先用「导出搬移包」出一个，或指定搬移包所在目录",
      }),
    );
    return out;
  }
  const insp = inspectPackage(dir, homeDir(), butlerRoot());
  if ("error" in insp) {
    out.push(
      finding("data.bad-pack", "error", insp.error, {
        cause: "搬移包不完整或不是管家生成的",
        impact: "无法恢复",
        action: "换一个搬移包，或重新导出",
        evidence: [dir],
      }),
    );
    return out;
  }
  out.push(
    finding("data.restore-plan", "info", insp.items.length + " 项将被写回（其中 " + insp.summary.overwrites + " 项会覆盖现有文件）", {
      cause: `搬移包生成于 ${new Date(insp.manifest.createdAt).toLocaleString("zh-CN")}，来自机器 ${insp.manifest.hostname}`,
      impact: "会覆盖的现有文件会先入回滚点，恢复不满意可以退回",
      action: "确认这是你要恢复的那份包",
      evidence: insp.items.slice(0, 10).map((i) => `${i.label} → ${i.target}${i.overwrites ? "（覆盖）" : "（新增）"}`),
    }),
  );
  if (insp.blocked.length) {
    out.push(
      finding("data.blocked", "error", insp.blocked.length + " 项因路径不安全被拦下", {
        cause: "清单里的相对路径含 .. 或落在允许的目录之外",
        impact: "这些项不会被执行（这是保护，不是故障）",
        action: "如果是别人给你的包，建议先核对内容再继续",
        evidence: insp.blocked.slice(0, 6).map((b) => `${b.label}：${b.reason}`),
      }),
    );
  }
  return out;
}

async function runRestore(ctx: ActionContext, params: RestoreParams): Promise<RestoreReport> {
  const dir = resolvePackDir(params.dir);
  if (!dir) throw new Error("没有找到搬移包");
  const insp = inspectPackage(dir, homeDir(), butlerRoot());
  if ("error" in insp) throw new Error(insp.error);

  ctx.step("s1", "把将被覆盖的现有文件存入回滚点");
  ctx.progress(0.15);
  const overwritten = insp.items.filter((i) => i.overwrites && i.kind === "file");
  let pointId: string | null = null;
  if (overwritten.length) {
    const point = await createRollbackPoint({
      kind: "config",
      trigger: `data.restore 前置（${insp.items.length} 项，来自 ${insp.manifest.hostname}）`,
      artifacts: overwritten.map((i) => ({ path: i.target, mode: "copy" as const })),
      reverse: { op: "restore-files" },
    });
    pointId = point.id;
    ctx.log(`已把 ${overwritten.length} 个将被覆盖的文件存入回滚点：${pointId}`);
    const pid = pointId;
    ctx.onUndo(async () => {
      const r = await applyRollbackPoint(pid);
      ctx.log(r.ok ? `已退回还原前的状态（回滚点 ${pid}）` : `⚠ 退回失败：${r.error ?? "未知原因"}`);
    });
  } else {
    ctx.log("没有需要覆盖的现有文件（都是新增），无需回滚点");
  }
  ctx.throwIfCancelled();

  ctx.step("s2", "写回文件");
  ctx.progress(0.5);
  const res = restorePackage(dir, { home: homeDir(), butlerRootDir: butlerRoot(), dryRun: !!params.dryRun });
  if ("error" in res) throw new Error(res.error);
  for (const f of res.failed.slice(0, 5)) ctx.log(`⚠ 写回失败：${f.target}（${f.error}）`);
  ctx.progress(1);
  return {
    dir,
    restored: res.restored,
    dryRun: !!params.dryRun,
    rollbackPointId: pointId,
    overwritten: overwritten.map((i) => ({ label: i.label, target: i.target })),
    failed: res.failed,
    blocked: res.blocked,
  };
}

export const dataRestoreAction: ActionDef<RestoreParams, RestoreReport> = {
  name: "data.restore",
  domain: "data",
  title: "从搬移包恢复",
  description:
    "把搬移包里的配置写回本机（换机或重装后使用）。动手前会先把【将被覆盖的现有文件】存入回滚点，恢复不满意可以退回；路径不安全或越界的条目一律不执行。",
  readonly: false,
  steps: ["把将被覆盖的现有文件存入回滚点", "写回文件"],
  preflight: restorePreflight,
  run: (ctx, params) => runRestore(ctx, params),
  timeoutMs: TIMEOUTS.install,
};

// ── data.backup（写：备份 + 保留策略） ────────────────────────────

export interface BackupParams { preset?: DataPreset }

export interface BackupReport {
  dir: string;
  fileCount: number;
  bytes: number;
  kept: number;
  trimmed: Array<{ stamp: string; bytes: number }>;
  reason: string;
}

async function backupPreflight(params: BackupParams): Promise<Finding[]> {
  const preset = normalizePreset(params.preset);
  const entries = buildEntries(homeDir(), butlerRoot());
  const measured = measureEntries(selectEntries(entries, preset));
  const cfg = loadConfig();
  const backups = listBackups(backupsDir());
  const plan = planRetention(
    [{ dir: "(本次)", stamp: "now", createdAt: new Date().toISOString(), bytes: measured.reduce((s, m) => s + m.bytes, 0), fileCount: 0, preset },
      ...backups],
    cfg.retention,
  );
  return [
    finding("data.backup-plan", "info", `将备份 ${measured.length} 项、${sizeText(measured)}，并按保留策略清理 ${plan.trim.length} 份旧备份`, {
      cause: `保留策略：最多 ${cfg.retention.maxBackups} 个 / ${Math.round(cfg.retention.maxBackupBytes / 1024 / 1024)} MB（可在设置里改）`,
      impact: plan.trim.length ? `会删除最旧的 ${plan.trim.length} 份备份：${plan.trim.map((b) => b.stamp).join("、")}` : "不会删除任何旧备份",
      action: "确认后继续",
      evidence: measured.slice(0, 8).map((m) => `${m.label} — ${(m.bytes / 1024).toFixed(1)} KB`),
    }),
  ];
}

async function runBackup(ctx: ActionContext, params: BackupParams): Promise<BackupReport> {
  const preset = normalizePreset(params.preset);
  ctx.step("s1", "打包到管家备份目录");
  ctx.progress(0.2);
  const res = exportPackage({ preset, destDir: backupsDir(), stamp: stampOf(), home: homeDir(), butlerRootDir: butlerRoot() });
  ctx.log(`备份完成：${res.dir}（${res.manifest.fileCount} 个文件）`);
  ctx.progress(0.7);

  ctx.step("s2", "按保留策略清理旧备份");
  const cfg = loadConfig();
  const backups = listBackups(backupsDir());
  const plan = planRetention(backups, cfg.retention);
  const trimmed: Array<{ stamp: string; bytes: number }> = [];
  for (const b of plan.trim) {
    ctx.throwIfCancelled();
    if (!b.dir.startsWith(backupsDir())) continue; // 双保险：只清管家备份目录里的
    try {
      Deno.removeSync(b.dir, { recursive: true });
      trimmed.push({ stamp: b.stamp, bytes: b.bytes });
      ctx.log(`已清理旧备份 ${b.stamp}（${(b.bytes / 1024 / 1024).toFixed(1)} MB）`);
    } catch (e) {
      ctx.log(`⚠ 清理失败：${b.stamp}（${(e as Error).message}）`);
    }
  }
  if (!trimmed.length) ctx.log("未超保留策略，没有清理旧备份");
  ctx.progress(1);
  return {
    dir: res.dir,
    fileCount: res.manifest.fileCount,
    bytes: res.manifest.bytes,
    kept: plan.keep.length,
    trimmed,
    reason: plan.reason,
  };
}

export const dataBackupAction: ActionDef<BackupParams, BackupReport> = {
  name: "data.backup",
  domain: "data",
  title: "立即备份一次",
  description:
    "在管家备份目录做一份搬移包，并按保留策略（设置里的「最多几个 / 最多多少 MB」）清理最旧的备份。不动 DSH 配置。",
  readonly: false,
  steps: ["打包到管家备份目录", "按保留策略清理旧备份"],
  preflight: backupPreflight,
  run: (ctx, params) => runBackup(ctx, params),
  timeoutMs: TIMEOUTS.install,
};
