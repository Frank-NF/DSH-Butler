/**
 * 离线安装：把本地的 .tgz 装进 profile（P1-4）。
 *
 * 【为什么需要】内网机器、镜像没同步、或者作者只给了个包文件 —— 这时候按包名装是装不上的。
 * npm 支持直接装本地 tgz（包名从文件内容里读，不需要联网查元数据）。
 *
 * 纪律与批量更新一致（共用 update_guard）：停服 → 留整批回滚点 → 逐个装 → 重启 → 体检 →
 * 不通过就整批回退。区别只在于「装什么」：这里装的是本地文件而不是 registry 上的最新版。
 *
 * 【一句话提醒写进输出】依赖仍然要能拿到：tgz 里只含它自己，若它依赖的包本地没有、网又不通，
 * 这一装照样会失败 —— 那时该做的是把依赖的 tgz 也准备好一起装（本动作支持一次给多个文件/一个目录）。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { isDir, isFile, listDir } from "../../host/fs.ts";
import { runCmd } from "../../host/shell.ts";
import { dshProfileDir, p } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";
import { explainErrorText } from "../../util/error-translate.ts";
import { resolveDshSourceRoot } from "../../util/paths.ts";
import { applyRollbackPoint } from "../backup/rollback.ts";
import { createManifestPoint, pmEnvReady, pmSkipped } from "./mutate.ts";
import { restartAndVerify } from "./update_guard.ts";

export interface OfflineInstallParams {
  /** 一个 .tgz 文件，或一个装着若干 .tgz 的目录。 */
  path?: string;
}

export interface OfflineInstallReport {
  files: string[];
  results: Array<{ file: string; ok: boolean; error?: string; explained?: string }>;
  rollbackPointId: string | null;
  reachable: boolean;
  verdict: "ok" | "rolled-back" | "verify-failed";
  lines: string[];
}

/**
 * 路径安全性：会被拼进 npm 命令行，所以挡掉 cmd.exe 会二次解析的字符（SEC-02 的教训）。
 * 另外只接受 .tgz —— 别的一律不装。
 */
export function isSafeTgzPath(file: string): boolean {
  const f = (file ?? "").trim();
  if (!f) return false;
  if (!/\.tgz$/i.test(f)) return false;
  if (/[&|<>%^"'`\r\n]/.test(f)) return false;
  return f.length <= 400;
}

/** 从「文件或目录」解析出要装的 tgz 列表（纯函数，便于测试）。 */
export function collectTgz(target: string): { files: string[]; error?: string } {
  const t = (target ?? "").trim();
  if (!t) return { files: [], error: "没有指定 .tgz 文件或目录" };
  if (isFile(t)) {
    return isSafeTgzPath(t) ? { files: [t] } : { files: [], error: `不是合法的 .tgz：${t}` };
  }
  if (isDir(t)) {
    const files = listDir(t)
      .filter((e) => !e.dir && /\.tgz$/i.test(e.name))
      .map((e) => p(t, e.name))
      .filter((f) => isSafeTgzPath(f))
      .sort();
    return files.length ? { files } : { files: [], error: `目录里没有可用的 .tgz：${t}` };
  }
  return { files: [], error: `路径不存在：${t}` };
}

async function offlinePreflight(params: OfflineInstallParams): Promise<Finding[]> {
  const out: Finding[] = [];
  const target = (params.path ?? "").trim();
  const got = collectTgz(target);
  if (got.error) {
    out.push(
      finding("plugin.offline-bad", "error", got.error, {
        cause: "路径不存在、不是 .tgz，或目录里没有 .tgz（只接受 .tgz，别的格式一律不装）",
        impact: "无法执行离线安装",
        action: "确认文件路径；从插件作者那里拿到的包通常叫 <包名>-<版本>.tgz",
        evidence: target ? [target] : [],
      }),
    );
    return out;
  }
  out.push(
    finding("plugin.offline-plan", "info", `将离线安装 ${got.files.length} 个包：${got.files.map((f) => f.split(/[\\\\/]/).pop()).join("、")}`, {
      cause: "从本地 .tgz 安装，不需要从 registry 下载本体",
      impact: "会先停掉 DSH 服务，装完重启并体检；起不来自动整批回退",
      action: "确认这些是要装的包",
      evidence: got.files.slice(0, 10),
    }),
  );
  return out;
}

async function runOfflineInstall(
  ctx: ActionContext,
  params: OfflineInstallParams,
): Promise<OfflineInstallReport> {
  const profileDir = dshProfileDir();
  const manifestPath = p(profileDir, "package.json");
  const lines: string[] = [];
  const line = (s: string) => {
    lines.push(s);
    ctx.log(s);
  };
  const report: OfflineInstallReport = {
    files: [],
    results: [],
    rollbackPointId: null,
    reachable: false,
    verdict: "ok",
    lines,
  };

  ctx.step("s1", "确认要装的包");
  const got = collectTgz((params.path ?? "").trim());
  if (got.error) throw new Error(got.error);
  report.files = got.files;
  for (const f of got.files) line(`将安装：${f}`);
  ctx.progress(0.1);
  ctx.throwIfCancelled();

  ctx.step("s2", "停服并留整批回滚点");
  const { stopDshServer } = await import("../core/finish_update.ts");
  const stop = await stopDshServer();
  if (stop.wasRunning) line(`已停掉 DSH 服务（原端口 ${stop.port}）`);
  report.rollbackPointId = await createManifestPoint(manifestPath, profileDir, `plugin.installOffline 前置（${got.files.length} 个本地包）`);
  line(`已留整批回滚点：${report.rollbackPointId}`);
  const pointId = report.rollbackPointId;
  ctx.onUndo(async () => {
    if (!pointId) return;
    const r = await applyRollbackPoint(pointId);
    ctx.log(r.ok ? `已回退到安装前（回滚点 ${pointId}）` : `⚠ 回退失败：${r.error ?? "未知原因"}`);
  });
  ctx.progress(0.25);
  ctx.throwIfCancelled();

  ctx.step("s3", "逐个安装本地包");
  pmEnvReady();
  const skipped = pmSkipped();
  let okCount = 0;
  for (const f of got.files) {
    ctx.throwIfCancelled();
    const name = f.split(/[\\\\/]/).pop() ?? f;
    const item = { file: f, ok: false as boolean, error: undefined as string | undefined, explained: undefined as string | undefined };
    if (skipped) {
      line(`（测试模式：跳过真实安装 ${name}）`);
      item.ok = true;
      okCount++;
      report.results.push(item);
      continue;
    }
    ctx.detail(`正在安装 ${name}（${okCount + 1}/${got.files.length}）`);
    const r = await runCmd(
      ["npm", "install", f, "--prefix", profileDir, "--no-audit", "--no-fund", "--legacy-peer-deps", "--loglevel", "error"],
      { timeoutMs: TIMEOUTS.install, allowNonZero: true, scope: "plugin", signal: ctx.signal },
    );
    if (r.code === 0) {
      item.ok = true;
      okCount++;
      line(`✓ ${name}`);
    } else {
      const raw = (r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n");
      item.error = raw || `退出码 ${r.code}`;
      item.explained = explainErrorText(item.error) ?? undefined;
      line(`✗ ${name} 安装失败`);
      if (item.explained) for (const l of item.explained.split("\n")) line("  " + l);
    }
    report.results.push(item);
    if (!item.ok) break;
  }
  ctx.progress(0.6);
  ctx.throwIfCancelled();

  ctx.step("s4", "重启并体检");
  const root = resolveDshSourceRoot()?.path ?? null;
  const rv = await restartAndVerify(root, stop.port ?? null);
  for (const l of rv.lines) line(l);
  report.reachable = rv.reachable;

  ctx.step("s5", "结论与必要的回退");
  if (okCount === got.files.length && rv.reachable) {
    report.verdict = "ok";
    line("结论：离线安装完成，DSH 正常起来 ✓");
  } else {
    line("结论：这次安装没通过验证，开始自动整批回退……");
    const rb = pointId ? await applyRollbackPoint(pointId) : { ok: false, error: "没有回滚点" };
    if (rb.ok) {
      line(`已还原安装前的清单与锁（回滚点 ${pointId}）`);
      const rv2 = await restartAndVerify(root, stop.port ?? null);
      for (const l of rv2.lines) line(l);
      report.reachable = rv2.reachable;
      report.verdict = rv2.reachable ? "rolled-back" : "verify-failed";
    } else {
      report.verdict = "verify-failed";
      line(`⚠ 自动回退失败：${rb.error ?? "未知原因"}（回滚点 ${pointId} 仍在，可在回滚点页手动还原）`);
    }
    const bad = report.results.find((x) => !x.ok);
    if (bad) line(`没装上的包：${bad.file.split(/[\\\\/]/).pop()}`);
    line(report.verdict === "rolled-back" ? "结论：已退回安装前状态 ✓" : "结论：回退后仍未通过体检，请手动检查");
  }
  ctx.progress(1);
  return report;
}

export const pluginInstallOfflineAction: ActionDef<OfflineInstallParams, OfflineInstallReport> = {
  name: "plugin.installOffline",
  domain: "plugin",
  title: "离线安装（.tgz）",
  description:
    "从本地 .tgz（单个文件或一个目录）安装插件，不依赖 registry。纪律与批量更新一致：停服 → 留整批回滚点 → 逐个装 → 重启体检 → 起不来自动整批回退，失败原因翻成人话。注意：包自身的依赖仍需可获取（本地已装或网络可达）。",
  readonly: false,
  steps: ["确认要装的包", "停服并留整批回滚点", "逐个安装本地包", "重启并体检", "结论与必要的回退"],
  preflight: offlinePreflight,
  run: (ctx, params) => runOfflineInstall(ctx, params),
  timeoutMs: TIMEOUTS.install * 2,
};
