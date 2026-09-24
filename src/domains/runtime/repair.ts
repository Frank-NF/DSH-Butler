/**
 * runtime.repair —— 清理失效写锁（僵尸锁 / PID 复用锁），只改名、不删除。
 *
 * 背景（事故 #48 的根治动作）：DSH 的 atomic-write 遇到锁文件时
 * 【只等 2 秒就超时、绝不自行移除别人的锁】（其文档原话：orphan recovery
 * is an operator action）。程序被强杀（断电 / 任务管理器 / 崩溃）后留下的
 * 僵尸锁会永久挡路 —— 之后所有配置写入全部排队然后超时，界面反复报
 * 「保存失败，请重试」。
 *
 * 判据复用 runtime/status.ts 的 scanLocks（与状态页同一口径）：
 *   - stale   = 锁里记的 PID 已不存在            → 可清
 *   - recycled = PID 活着但已是别的程序（复用）   → 可清（原进程早没了）
 *   - keep    = 持有者是活的 node 进程            → 绝不动
 *   - unreadable = 读不出 PID                     → 绝不动（宁可当没看见）
 *
 * 处置方式与旧版一致：把 `X.lock` 改名为 `X.lock.stale-<时间戳>`
 * （只改名，证据留在原地）。scanLocks 用 `/\.stale-\d+$/` 排除已处理项 ——
 * 改名后的文件不会再被当成「又发现一个僵尸锁」重复报警。
 *
 * 不停服、不重启：改名的对象是死进程留下的标记，正在运行的 DSH 不持有
 * 它们（持有者已死）；且 DSH 每次写配置都是「尝试获取 → 失败才等锁」，
 * 锁一消失下一次写入自然成功（1.18.15「打开管家即清」同款语义）。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { finding, type Finding } from "../../util/result.ts";
import { isDir, pathExists } from "../../host/fs.ts";
import { dshProfileDir } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";
import { scanLocks } from "./status.ts";

export const RUNTIME_REPAIR_STEPS = [
  "扫描写锁（区分活锁与失效锁）",
  "把失效锁改名留证（只改名不删除）",
  "复核清理结果",
] as const;

// ── preflight（写前检查，error 级直接拦截） ──────────────────────────

async function runtimeRepairPreflight(): Promise<Finding[]> {
  const out: Finding[] = [];
  const profileDir = dshProfileDir();

  if (!isDir(profileDir)) {
    out.push(
      finding("runtime.repair.no-profile", "error", "找不到 DSH 配置目录", {
        cause: `以下位置不是目录：${profileDir}`,
        impact: "没有可检查的写锁",
        action: "先确认 DSH 已安装并至少启动过一次",
        evidence: [profileDir],
      }),
    );
    return out;
  }

  const locks = await scanLocks(profileDir);
  const bad = locks.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
  const unreadable = locks.filter((l) => l.verdict === "unreadable");

  if (bad.length === 0) {
    out.push(
      finding("runtime.nothing-to-repair", "error", "没有需要清理的失效写锁", {
        cause: unreadable.length > 0
          ? `扫描到 ${unreadable.length} 个锁文件，但都读不出持有者 PID —— 按保守原则不判定为僵尸，绝不清（宁可漏，不可误清活锁）`
          : `扫描 ${locks.length} 个锁文件：活锁 ${locks.filter((l) => l.verdict === "keep").length} 个，失效锁 0 个`,
        impact: "没有可清理的对象",
        action: "配置仍写不进的话，用 runtime diagnose 查别的原因",
        fixAction: "runtime.diagnose",
      }),
    );
  }

  if (unreadable.length > 0) {
    out.push(
      finding("runtime.lock-unreadable", "info", `${unreadable.length} 个锁文件读不出持有者 PID（保守跳过）`, {
        cause: "锁文件首行不是 PID 或内容为空/无权限",
        impact: "无法判断持有者死活，因此不会自动清理 —— 宁可当没看见，也绝不误清活锁",
        action: "人工确认无人持有后再处理",
        evidence: unreadable.map((l) => l.file),
      }),
    );
  }
  return out;
}

// ── 报告 ────────────────────────────────────────────────────────────

export interface RuntimeRepairReport {
  renamed: Array<{ from: string; to: string }>;
  failed: Array<{ file: string; error: string }>;
  /** 重扫时新出现或保守跳过的锁（keep/unreadable）。 */
  skipped: Array<{ file: string; verdict: string }>;
  /** 复扫剩余失效锁：0 = 干净。 */
  remaining: number;
  lines: string[];
  elapsedMs: number;
}

// ── run ───────────────────────────────────────────────────────────────

async function runRuntimeRepair(ctx: ActionContext): Promise<RuntimeRepairReport> {
  const t0 = Date.now();
  const profileDir = dshProfileDir();

  const report: RuntimeRepairReport = {
    renamed: [],
    failed: [],
    skipped: [],
    remaining: 0,
    lines: [],
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  if (!isDir(profileDir)) throw new Error(`找不到 DSH 配置目录：${profileDir}`);

  // ── s1 扫描（重扫：preflight 与执行之间状态可能已变） ──
  ctx.step("s1", RUNTIME_REPAIR_STEPS[0]);
  ctx.progress(0.2);
  const locks = await scanLocks(profileDir);
  const bad = locks.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
  for (const l of locks) {
    if (l.verdict === "keep" || l.verdict === "unreadable") {
      report.skipped.push({ file: l.file, verdict: l.verdict });
    }
  }
  if (bad.length === 0) {
    const hint = report.skipped.length > 0 ? `（保守跳过 ${report.skipped.length} 个活锁/不可读锁）` : "";
    throw new Error(`没有需要清理的失效写锁${hint}`);
  }
  line(
    `扫描写锁：共 ${locks.length} 个，失效 ${bad.length} 个（` +
      `${bad.filter((l) => l.verdict === "stale").length} 个持有者已不存在 · ` +
      `${bad.filter((l) => l.verdict === "recycled").length} 个 PID 被复用）`,
  );
  ctx.throwIfCancelled();

  // ── s2 逐条改名留证（同目录 rename；失败单条记录不中断） ──
  ctx.step("s2", RUNTIME_REPAIR_STEPS[1]);
  ctx.progress(0.5);
  const stamp = Date.now();
  for (const l of bad) {
    ctx.throwIfCancelled();
    const to = `${l.file}.stale-${stamp}`;
    try {
      Deno.renameSync(l.file, to);
    } catch (e) {
      report.failed.push({ file: l.file, error: (e as Error).message });
      continue;
    }
    report.renamed.push({ from: l.file, to });
    // 失败/取消时引擎逆序执行补偿：改回原名
    ctx.onUndo(async () => {
      if (!pathExists(to)) return;
      try {
        Deno.renameSync(to, l.file);
      } catch (e) {
        ctx.log(`⚠ 还原锁文件名失败：${l.file} — ${(e as Error).message}`);
      }
    });
    line(`失效锁改名留证：${l.file} → *.stale-${stamp}`);
  }
  if (report.renamed.length === 0 && report.failed.length > 0) {
    throw new Error(`全部 ${report.failed.length} 个失效锁改名失败：${report.failed[0]?.error ?? "未知原因"}`);
  }
  if (report.failed.length > 0) {
    line(`${report.failed.length} 个改名失败（多半正被占用，稍后重试）`);
  }
  ctx.throwIfCancelled();

  // ── s3 复核 ──
  ctx.step("s3", RUNTIME_REPAIR_STEPS[2]);
  ctx.progress(0.9);
  const after = await scanLocks(profileDir);
  const still = after.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
  report.remaining = still.length;
  if (still.length === 0) {
    line("复核清理结果：失效锁已清零 ✓（改名后的文件留在原地作证据，不会重复报警）");
  } else {
    line(`复核清理结果：仍有 ${report.remaining} 个失效锁（改名失败的那些，稍后重试）`);
  }

  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// ── 动作定义 ────────────────────────────────────────────────────────

export const runtimeRepairAction: ActionDef<Record<string, never>, RuntimeRepairReport> = {
  name: "runtime.repair",
  domain: "runtime",
  title: "清理失效写锁（僵尸锁自愈）",
  description:
    "扫描 profile 写锁，把持有者已死或 PID 被复用的失效锁改名为 *.stale-<时间戳>（只改名、留证据、可还原）。活锁与读不懂的锁绝不动。不停服 —— 配置写入失败（保存超时）的头号原因就是它们。",
  readonly: false,
  steps: [...RUNTIME_REPAIR_STEPS],
  preflight: runtimeRepairPreflight,
  run: (ctx) => runRuntimeRepair(ctx),
  timeoutMs: TIMEOUTS.install,
};
