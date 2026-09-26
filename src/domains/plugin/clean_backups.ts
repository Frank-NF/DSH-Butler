/**
 * plugin.cleanBackups —— 清理 profile 目录里的历史备份（只移动不删除）。
 *
 * 【为什么需要】体检早就报「profile 目录里有 N 类历史备份（xx MB）」，但那时只印一句
 * 「确认无需回退后，清理这些备份」—— 用户既不知道删哪些、也没有入口（本机实测 55.7 MB / 7 类）。
 * 这些目录是历次清理动作「只移动不删除」攒下来的（.cleanup_backup_*、.updater_backups…），
 * 确认不需要回退就该能一键收走。
 *
 * 与同类动作一致的铁律：只移动不删除、隔离区落 MANIFEST、失败或取消自动搬回（ctx.onUndo）、不停服。
 * 隔离区放在管家目录（~/.dsh-butler/quarantine/）而不是 profile 里 —— 放在 profile 里的话
 * 会被自己的扫描再次认成一份备份，复核就永远不为零。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { ensureDir, listDir, moveSafe, pathExists, writeJsonAtomic } from "../../host/fs.ts";
import { butlerRoot, dshProfileDir, p, stampOf } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";
import { PROFILE_RESIDUE_KINDS } from "../runtime/status.ts";

export const CLEAN_BACKUPS_STEPS = [
  "扫描历史备份",
  "移入隔离区（只移动不删除）",
  "复核清理结果",
] as const;

export interface CleanBackupsReport {
  moved: number;
  failed: Array<{ name: string; error: string }>;
  remaining: number;
  quarantineDir: string;
  lines: string[];
  elapsedMs: number;
}

/**
 * 找出 profile 里命中「历史备份」形态的条目。
 * 纯函数（给个目录就能算），判据与体检共用 PROFILE_RESIDUE_KINDS，两处不会漂移。
 */
export function scanBackupTargets(profileDir: string): Array<{ name: string; kind: string }> {
  const out: Array<{ name: string; kind: string }> = [];
  for (const e of listDir(profileDir)) {
    const hit = PROFILE_RESIDUE_KINDS.find((k) => k.pattern.test(e.name));
    if (hit) out.push({ name: e.name, kind: hit.kind });
  }
  return out;
}

// ── preflight（写前检查） ─────────────────────────────────────────────

async function cleanBackupsPreflight(): Promise<Finding[]> {
  const profileDir = dshProfileDir();
  if (!pathExists(profileDir)) {
    return [
      finding("plugin.no-profile", "error", "找不到 DSH profile 目录", {
        cause: `以下位置不存在：${profileDir}`,
        impact: "不知道去哪里找历史备份",
        action: "先确认 DSH 已安装并至少启动过一次",
        evidence: [profileDir],
      }),
    ];
  }
  const targets = scanBackupTargets(profileDir);
  if (targets.length === 0) {
    return [
      finding("plugin.no-backups", "warn", "没有需要清理的历史备份", {
        cause: "profile 目录里没有命中备份形态的条目",
        impact: "这个动作会什么都不做",
        action: "无需处理",
      }),
    ];
  }
  const kinds = [...new Set(targets.map((t) => t.kind))];
  return [
    finding(
      "plugin.clean-backups",
      "info",
      `将清理 ${targets.length} 项历史备份（${kinds.join("、")}）`,
      {
        cause: "历次清理动作「只移动不删除」留下的备份目录",
        impact: "会移入管家隔离区（~/.dsh-butler/quarantine/）；不影响正在运行的插件与插件清单",
        action: "确认这些备份不再需要回退，再继续",
        evidence: targets.slice(0, 10).map((t) => `${t.name}（${t.kind}）`),
      },
    ),
  ];
}

// ── run ──────────────────────────────────────────────────────────────

async function runCleanBackups(ctx: ActionContext): Promise<CleanBackupsReport> {
  const t0 = Date.now();
  const profileDir = dshProfileDir();
  const report: CleanBackupsReport = {
    moved: 0,
    failed: [],
    remaining: 0,
    quarantineDir: "",
    lines: [],
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  // ── s1 扫描（重扫：preflight 与执行之间状态可能已变） ──
  ctx.step("s1", CLEAN_BACKUPS_STEPS[0]);
  ctx.progress(0.2);
  if (!pathExists(profileDir)) throw new Error(`找不到 profile 目录：${profileDir}`);
  const targets = scanBackupTargets(profileDir);
  if (targets.length === 0) throw new Error("没有可清理的历史备份");
  line(`扫描历史备份：发现 ${targets.length} 项（${[...new Set(targets.map((t) => t.kind))].join("、")}）`);
  ctx.throwIfCancelled();

  // ── s2 逐项移入隔离区（失败单条记录、不中断整体） ──
  ctx.step("s2", CLEAN_BACKUPS_STEPS[1]);
  ctx.progress(0.5);
  const stamp = stampOf();
  const quarantineDir = p(butlerRoot(), "quarantine", `profile-backups-${stamp}`);
  report.quarantineDir = quarantineDir;
  ensureDir(quarantineDir);
  const items: Array<{ original: string; quarantined: string; reason: string }> = [];

  for (const t of targets) {
    ctx.throwIfCancelled();
    const from = p(profileDir, t.name);
    const to = p(quarantineDir, t.name);
    if (!pathExists(from)) continue;
    const rec = moveSafe(from, to);
    if (!rec.ok) {
      report.failed.push({ name: t.name, error: rec.error ?? "未知原因" });
      continue;
    }
    items.push({ original: from, quarantined: to, reason: t.kind });
    // 失败/取消时引擎逆序执行补偿：逐条搬回原位
    ctx.onUndo(async () => {
      if (!pathExists(to)) return;
      const back = moveSafe(to, from);
      if (!back.ok) {
        ctx.log(`⚠ 搬回备份失败：${t.name} — ${back.error ?? "未知原因"}（隔离区有 MANIFEST 可人工还原）`);
      }
    });
    ctx.detail(`已隔离 ${items.length}/${targets.length} 项`);
  }

  if (items.length > 0) {
    try {
      writeJsonAtomic(p(quarantineDir, "MANIFEST.json"), {
        stamp,
        createdAt: new Date().toISOString(),
        dir: quarantineDir,
        items,
      });
    } catch (e) {
      report.failed.push({ name: "MANIFEST.json", error: (e as Error).message });
    }
    report.moved = items.length;
    line(`移入隔离区：${items.length} 项 → ${quarantineDir}`);
    line("　要还原就把隔离区里的条目搬回 profile 目录（只移动、不删除，MANIFEST 记了对应关系）");
  } else {
    line("移入隔离区：0 项（全部未能移动，见失败明细）");
  }
  ctx.throwIfCancelled();

  // ── s3 复核 ──
  ctx.step("s3", CLEAN_BACKUPS_STEPS[2]);
  ctx.progress(0.9);
  const still = scanBackupTargets(profileDir);
  report.remaining = still.length;
  line(still.length === 0 ? "复核清理结果：历史备份已清零 ✓" : `复核清理结果：仍有 ${still.length} 项（多半是移动时被占用，稍后重试）`);

  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// ── 动作定义 ────────────────────────────────────────────────────────

export const pluginCleanBackupsAction: ActionDef<Record<string, never>, CleanBackupsReport> = {
  name: "plugin.cleanBackups",
  domain: "plugin",
  title: "清理历史备份（隔离不删除）",
  description:
    "把 profile 目录里历次清理留下的备份（.cleanup_backup_*、.updater_backups、.dual_lock_backup、.removed-plugins-* 等）整体移入管家隔离区并留 MANIFEST —— 只移动、不删除，可人工搬回。不停服，不影响正在运行的插件。",
  readonly: false,
  steps: [...CLEAN_BACKUPS_STEPS],
  preflight: cleanBackupsPreflight,
  run: (ctx) => runCleanBackups(ctx),
  timeoutMs: TIMEOUTS.install,
};
