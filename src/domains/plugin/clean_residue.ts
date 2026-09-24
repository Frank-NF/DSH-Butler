/**
 * plugin.cleanResidue —— 一键清理 pnpm 安装残留（只移动、不删除）。
 *
 * 判据复用 core/status.ts 的 scanResidue：【只认 pnpm 暂存特征】
 * （隐藏前缀 / _tmp_<pid> / 随机 8 位后缀 / 日期戳），绝不做「不在清单里
 * 就算残留」的推断 —— profile/node_modules 里绝大多数非直接依赖是第三方
 * 插件的传递依赖（rolldown / typescript / dsh-mnemon-provider-* …），
 * 按「不在清单即垃圾」去清，插件会立刻全部崩。宁可漏报，不可误报。
 *
 * 【为什么不建写前回滚点】（与 install/uninstall 的关键差异，写清免得后人猜）：
 *   1) 被移动的对象是【安装中断留下的半成品副本】，正式的那份本来就在原位 ——
 *      移走它们不会让任何东西变坏，「回到操作前」的价值约等于零；
 *   2) 回滚点对 manifest 是 copy 全文件，而本动作根本不碰 package.json；
 *   3) 补偿走 ctx.onUndo 逐条移回（失败/取消时引擎逆序执行），
 *      MANIFEST.json 落在隔离区里可人工整体还原 —— 双保险已足够。
 *   一句话：垃圾的移动不需要事务级别的严肃对待，onUndo + MANIFEST 够了。
 *
 * 隔离落点：`<profile>/.cleanup_backup_<时间戳>/`
 *   - 必须在 profileDir 下（与 node_modules 同盘，Windows 跨盘 rename 必败）；
 *   - 命名匹配 scanProfileResidue 的 `/^\.cleanup_backup_/` → 隔离区自身
 *     进入「清理备份」台账，不会变成没人认识的孤儿目录。
 *
 * 不停服、不重启：残留目录没有进程持有（持有者是死掉的安装器），
 * 移动它们不影响正在运行的 DSH（1.18.15「打开管家即清」同款语义）。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { finding, type Finding } from "../../util/result.ts";
import { isDir, moveSafe, pathExists, writeJsonAtomic } from "../../host/fs.ts";
import { dshProfileDir, p, stampOf } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";
import { scanResidue } from "../core/status.ts";
import { txnDir } from "./mutate.ts";

export const CLEAN_RESIDUE_STEPS = [
  "扫描安装残留",
  "把残留移入隔离区（只移动不删除）",
  "复核清理结果",
] as const;

// ── preflight（写前检查，error 级直接拦截） ──────────────────────────

async function cleanResiduePreflight(): Promise<Finding[]> {
  const out: Finding[] = [];
  const profileDir = dshProfileDir();
  const nodeModules = p(profileDir, "node_modules");

  if (!isDir(nodeModules)) {
    out.push(
      finding("plugin.cleanResidue.no-node-modules", "error", "找不到插件安装目录", {
        cause: `以下位置没有 node_modules：${nodeModules}`,
        impact: "没有可清理的对象",
        action: "先确认 DSH 已安装并至少启动过一次",
        evidence: [nodeModules],
      }),
    );
    return out;
  }

  if (pathExists(p(txnDir(), "active.json"))) {
    out.push(
      finding("plugin.txn-pending", "error", "上一个插件事务尚未收尾", {
        cause: "事务日志还在 —— 上次安装/卸载没走完（可能中途被关闭）",
        impact: "此时移动 node_modules 里的目录，可能与未收尾的事务互相踩踏",
        action: "重启管家（启动时自动恢复上次事务），收尾后再试",
      }),
    );
    return out;
  }

  const residue = scanResidue(nodeModules);
  if (residue.length === 0) {
    out.push(
      finding("plugin.nothing-to-clean", "error", "没有可清理的安装残留", {
        cause: "扫描 profile/node_modules 未发现 pnpm 暂存特征的目录（隐藏前缀 / _tmp_ / 随机后缀 / 日期戳）",
        impact: "没有需要移动的对象",
        action: "双名单之外的问题用 plugin diagnose 查",
        fixAction: "plugin.diagnose",
      }),
    );
  }
  return out;
}

// ── 报告 ────────────────────────────────────────────────────────────

export interface CleanResidueReport {
  /** 隔离区落点（要还原就把里面的文件夹搬回 node_modules 对应位置）。 */
  backupDir: string;
  moved: number;
  failed: Array<{ name: string; error: string }>;
  /** 复扫结果：0 = 干净。 */
  remaining: number;
  lines: string[];
  elapsedMs: number;
}

// ── run ───────────────────────────────────────────────────────────────

async function runCleanResidue(ctx: ActionContext): Promise<CleanResidueReport> {
  const t0 = Date.now();
  const profileDir = dshProfileDir();
  const nodeModules = p(profileDir, "node_modules");

  const report: CleanResidueReport = {
    backupDir: "",
    moved: 0,
    failed: [],
    remaining: 0,
    lines: [],
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  // preflight 的同一道闸（run 是唯一入口，防绕过）
  if (pathExists(p(txnDir(), "active.json"))) {
    throw new Error("检测到上次未收尾的插件事务；重启管家会自动恢复收尾，之后再试");
  }
  if (!isDir(nodeModules)) throw new Error(`找不到插件安装目录：${nodeModules}`);

  // ── s1 扫描（重扫：preflight 与执行之间状态可能已变） ──
  ctx.step("s1", CLEAN_RESIDUE_STEPS[0]);
  ctx.progress(0.2);
  const residue = scanResidue(nodeModules);
  if (residue.length === 0) throw new Error("没有可清理的安装残留");
  line(`扫描安装残留：发现 ${residue.length} 处（均带 pnpm 暂存特征）`);
  ctx.throwIfCancelled();

  // ── s2 逐条移入隔离区（同盘 rename；失败单条记录不中断） ──
  ctx.step("s2", CLEAN_RESIDUE_STEPS[1]);
  ctx.progress(0.5);
  const stamp = stampOf();
  const backupDir = p(profileDir, `.cleanup_backup_${stamp}`);
  report.backupDir = backupDir;
  const items: Array<{ original: string; quarantined: string; reason: string }> = [];

  for (const r of residue) {
    ctx.throwIfCancelled();
    const from = p(nodeModules, ...r.name.split("/"));
    const to = p(backupDir, ...r.name.split("/"));
    if (!pathExists(from)) continue;
    const rec = moveSafe(from, to);
    if (!rec.ok) {
      report.failed.push({ name: r.name, error: rec.error ?? "未知原因" });
      continue;
    }
    items.push({ original: from, quarantined: to, reason: r.kind });
    // 失败/取消时引擎逆序执行补偿：逐条搬回原位
    ctx.onUndo(async () => {
      if (!pathExists(to)) return;
      const back = moveSafe(to, from);
      if (!back.ok) ctx.log(`⚠ 还原残留目录失败：${r.name} — ${back.error ?? "未知原因"}（隔离区有 MANIFEST 可人工还原）`);
    });
    if (items.length % 10 === 0) ctx.detail(`已隔离 ${items.length}/${residue.length} 项`);
  }

  if (items.length > 0) {
    try {
      writeJsonAtomic(p(backupDir, "MANIFEST.json"), {
        stamp,
        createdAt: new Date().toISOString(),
        dir: backupDir,
        items,
      });
    } catch (e) {
      report.failed.push({ name: "MANIFEST.json", error: (e as Error).message });
    }
    report.moved = items.length;
    line(
      `移入隔离区：${items.length} 项 → ${backupDir}` +
        (report.failed.length ? `（${report.failed.length} 项未能移动）` : ""),
    );
    line("　隔离区（要还原就把里面的文件夹搬回 node_modules 对应位置）：只移动、不删除");
  } else {
    line("移入隔离区：0 项（全部未能移动，见失败明细）");
  }
  ctx.throwIfCancelled();

  // ── s3 复扫 ──
  ctx.step("s3", CLEAN_RESIDUE_STEPS[2]);
  ctx.progress(0.9);
  const still = scanResidue(nodeModules);
  report.remaining = still.length;
  if (still.length === 0) {
    line("复核清理结果：残留已清零 ✓");
  } else {
    line(`复核清理结果：仍有 ${still.length} 处残留（多半是移动时被占用，稍后重试）`);
  }

  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// ── 动作定义 ────────────────────────────────────────────────────────

export const pluginCleanResidueAction: ActionDef<Record<string, never>, CleanResidueReport> = {
  name: "plugin.cleanResidue",
  domain: "plugin",
  title: "清理安装残留（隔离不删除）",
  description:
    "扫描 profile/node_modules 下带 pnpm 暂存特征的残留目录（只认隐藏前缀 / _tmp_ / 随机后缀 / 日期戳，绝不误伤传递依赖），整体移入隔离区并留 MANIFEST —— 只移动、不删除，可人工还原。不停服。",
  readonly: false,
  steps: [...CLEAN_RESIDUE_STEPS],
  preflight: cleanResiduePreflight,
  run: (ctx) => runCleanResidue(ctx),
  timeoutMs: TIMEOUTS.install,
};
