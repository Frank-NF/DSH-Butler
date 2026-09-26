/**
 * data.diagnose —— 导出一份可以发出去的诊断包（P2-2）。
 *
 * 内容：体检报告（Markdown）+ 环境 + 依赖冲突 + 最近日志错误 + 机器概要（版本/插件清单/管家设置）。
 * 全部过一遍深度脱敏，落盘后**回读自检**；自检有残留就把包改名成「未通过脱敏检查」并让动作失败 ——
 * 宁可这次白做，也不能让你把一个带用户名的包发出去。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { butlerRoot, dshProfileDir, p } from "../../util/paths.ts";
import { APP_VERSION, TIMEOUTS } from "../../version.ts";
import { redactionContext, writeDiagnosePackage, type DiagnoseFile, type LeakHit } from "./package.ts";
import { renderMarkdown, runHealthCheck } from "./health.ts";
import { collectEnv } from "../env/probe.ts";
import { collectCoreStatus } from "../core/status.ts";
import { collectRuntimeStatus } from "../runtime/status.ts";
import { extractErrors, listLogSources, readTail } from "../runtime/logs.ts";
import { findDependencyProblems } from "../plugin/deps.ts";
import { readInstalledDeps } from "../plugin/deps_actions.ts";
import { loadConfig } from "../state/config.ts";

export interface DiagnoseParams {
  /** 导出到哪；省略 = 管家根目录下的 diagnostics。 */
  destDir?: string;
}

export interface DiagnoseReport {
  dir: string;
  files: Array<{ name: string; bytes: number }>;
  totalBytes: number;
  leaks: LeakHit[];
  /** 自检是否通过。 */
  leakCheck: "passed" | "failed";
}

/** 收集要写进包里的所有文件（纯收集，不做脱敏 —— 脱敏统一在落盘那一步做）。 */
export async function collectDiagnoseFiles(ctx: ActionContext): Promise<DiagnoseFile[]> {
  const files: DiagnoseFile[] = [];

  const health = await runHealthCheck((st) => ctx.detail(st.label));
  files.push({ name: "体检报告.md", content: renderMarkdown(health) });

  const env = await collectEnv();
  files.push({ name: "环境.txt", content: JSON.stringify(env, null, 2) });

  const core = await collectCoreStatus();
  const runtime = await collectRuntimeStatus();
  const deps = findDependencyProblems(dshProfileDir());
  files.push({
    name: "依赖与运行.txt",
    content: [
      "# 运行状态",
      `服务在跑：${runtime.running}　端口：${runtime.port ?? "-"}　形态：${runtime.launchForm ?? "-"}`,
      `重复进程：${runtime.duplicates.length} 个`,
      `HTTP 体检：${runtime.health ? (runtime.health.reachable ? `可达（${runtime.health.status}）` : "不可达") : "未探测"}`,
      "",
      "# 依赖问题（谁和谁要的版本对不上）",
      deps.length ? deps.map((d) => `- [${d.kind}] ${d.detail}`).join("\n") : "（未发现冲突）",
      "",
      "# 已装插件（名字 + 版本）",
      Object.entries(readInstalledDeps()).map(([n, v]) => `- ${n}@${v}`).join("\n") || "（清单里没有依赖）",
    ].join("\n"),
  });

  // 日志：只带「像错误」的行，别把几百 KB 全塞进来
  const logLines: string[] = [];
  try {
    const sources = listLogSources().slice(0, 6);
    for (const s of sources) {
      const path = (s as { path?: string }).path;
      const label = (s as { label?: string; name?: string }).label ?? (s as { name?: string }).name ?? "日志";
      if (!path) continue;
      const tail = readTail(path, 400);
      const errs = extractErrors(tail.lines ?? [], 20);
      if (!errs.length) continue;
      logLines.push(`## ${label}`);
      logLines.push(...errs.map((x) => "- " + x));
      logLines.push("");
    }
  } catch {
    logLines.push("（读日志失败，这一节留空）");
  }
  files.push({ name: "日志错误摘要.md", content: logLines.length ? logLines.join("\n") : "（最近日志里没有挑出错误行）" });

  const cfg = loadConfig();
  // installId 是实例标识：与排障无关，但能用来跟踪同一台机器 —— 干脆不带
  const cfgSafe: Record<string, unknown> = { ...(cfg as unknown as Record<string, unknown>) };
  delete cfgSafe.installId;
  files.push({
    name: "机器概要.json",
    content: JSON.stringify(
      {
        appVersion: APP_VERSION,
        dshVersion: core.version,
        dshSourceRoot: core.sourceRoot,
        profileDir: dshProfileDir(),
        butlerConfig: cfgSafe,
        health: { verdict: health.verdict, summary: health.summary, durationMs: health.durationMs },
      },
      null,
      2,
    ),
  });

  files.push({
    name: "读我.txt",
    content: [
      "DSH 管家 · 诊断包",
      "生成时间：" + new Date().toLocaleString("zh-CN"),
      "",
      "这份包用来在求助（发群 / 提 issue）时一次性说明现场，包含：",
      "  · 体检报告.md —— 体检结论与建议；",
      "  · 环境.txt —— node / npm / git / 本体位置等环境探测结果；",
      "  · 依赖与运行.txt —— 服务状态、依赖冲突、已装插件清单；",
      "  · 日志错误摘要.md —— 从最近日志里挑出的错误行（不是全量日志）；",
      "  · 机器概要.json —— 版本、路径、管家设置（已去掉实例标识）。",
      "",
      "【已经脱敏】家目录替换为 ~、用户名替换为 %USER%、密钥与令牌替换为 ***、邮箱替换为 %EMAIL%。",
      "写出后还会回读自检；若发现残留，包名会变成「未通过脱敏检查」并把发现报出来。",
      "分享前建议自己再扫一眼 —— 日志里可能包含第三方插件的名字。",
    ].join(String.fromCharCode(13, 10)),
  });

  return files;
}

async function diagnosePreflight(params: DiagnoseParams): Promise<Finding[]> {
  const ctx = redactionContext();
  const out: Finding[] = [
    finding("diag.package-plan", "info", "将收集体检、环境、依赖、日志错误与机器概要，脱敏后打成一个文件夹", {
      cause: "适合在求助时一次性说明现场（发群 / 提 issue）",
      impact:
        `会替换：家目录 → ~、用户名（${ctx.user ? ctx.user.slice(0, 1) + "***" : "未取到"}）→ %USER%、密钥/令牌 → ***、邮箱 → %EMAIL%；写出后还会回读自检，有残留就判失败`,
      action: "确认要生成再继续；包会写到你的磁盘上，随时可删",
      evidence: ["体检报告.md", "环境.txt", "依赖与运行.txt", "日志错误摘要.md", "机器概要.json", "读我.txt"],
    }),
  ];
  if (params.destDir && !/^[A-Za-z]:[\\/]/.test(params.destDir) && !params.destDir.startsWith("\\\\")) {
    out.push(
      finding("diag.bad-dest", "error", "导出目录看起来不是绝对路径", {
        cause: `收到：${params.destDir}`,
        impact: "相对路径会落到不确定的位置",
        action: "填绝对路径（例如 D:\\诊断），或留空用管家默认目录",
      }),
    );
  }
  return out;
}

async function runDiagnose(ctx: ActionContext, params: DiagnoseParams): Promise<DiagnoseReport> {
  const ctxR = redactionContext();
  ctx.step("s1", "收集体检与环境");
  ctx.progress(0.15);
  const files = await collectDiagnoseFiles(ctx);
  ctx.detail(`已收集 ${files.length} 份内容`);
  ctx.progress(0.55);

  ctx.step("s2", "收集依赖与日志");
  ctx.progress(0.7);
  const destDir = params.destDir && params.destDir.trim()
    ? params.destDir.trim()
    : p(butlerRoot(), "diagnostics");
  ctx.detail(`导出目录：${destDir}`);

  ctx.step("s3", "脱敏并写出");
  const res = writeDiagnosePackage(files, destDir, ctxR);
  ctx.log(`已写出：${res.dir}（${res.files.length} 个文件，${(res.totalBytes / 1024).toFixed(1)} KB）`);
  ctx.progress(0.9);

  ctx.step("s4", "回读自检");
  if (res.leaks.length) {
    // 改名，避免有人顺手把没脱干净的包发出去；同时把发现报清楚
    const bad = res.dir + "-未通过脱敏检查";
    try {
      Deno.renameSync(res.dir, bad);
    } catch { /* 改名失败就保持原名，下面照样报失败 */ }
    const detail = res.leaks.slice(0, 8).map((l) => `${l.file}：${l.kind}（${l.sample}）`).join("；");
    ctx.log(`✗ 脱敏自检未通过：${detail}`);
    throw new Error(
      `脱敏自检未通过，已把包改名以免误发：${bad}｜发现 ${res.leaks.length} 处：${detail}`,
    );
  }
  ctx.log("✓ 脱敏自检通过：家目录、用户名、令牌、邮箱均未残留");
  ctx.progress(1);
  return { dir: res.dir, files: res.files, totalBytes: res.totalBytes, leaks: [], leakCheck: "passed" };
}

export const dataDiagnoseAction: ActionDef<DiagnoseParams, DiagnoseReport> = {
  name: "data.diagnose",
  domain: "data",
  title: "导出诊断包（脱敏）",
  description:
    "把体检报告、环境、依赖冲突、日志错误摘要与机器概要脱敏后打成一个文件夹，用于求助时一次性说明现场。脱敏后还会回读自检，发现残留就改名并报错，绝不让你误发带隐私的包。",
  readonly: false,
  steps: ["收集体检与环境", "收集依赖与日志", "脱敏并写出", "回读自检"],
  preflight: diagnosePreflight,
  run: (ctx, params) => runDiagnose(ctx, params),
  timeoutMs: TIMEOUTS.install,
};
