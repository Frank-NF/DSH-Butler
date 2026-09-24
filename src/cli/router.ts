/**
 * 命令行路由。
 *
 * 与界面共用同一套领域层与任务引擎 —— 这不是"另写一套脚本"，
 * 而是同一个核心的第二个消费者（方案 §2 的落地证明）。
 *
 * 约定：
 *   - 所有子命令支持 --json（stdout 只出 JSON）
 *   - 所有只读命令零副作用，可放心在任意机器上跑
 *   - 退出码语义见 util/result.ts 的 EXIT
 */

import { engine } from "../jobs/engine.ts";
import type { Job } from "../jobs/types.ts";
import { EXIT } from "../util/result.ts";
import { renderMarkdown, type HealthReport } from "../domains/diag/health.ts";
import type { EnvReport } from "../domains/env/probe.ts";
import type { CoreStatus } from "../domains/core/status.ts";
import type { RuntimeStatus } from "../domains/runtime/status.ts";
import type { LogsReport } from "../domains/runtime/logs.ts";
import { DUMP_FRESH_MS } from "../domains/runtime/facts.ts";
import { humanSize } from "../host/mod.ts";

export const CLI_HELP = `
DSH Butler · 命令行

用法：
  dsh-butler                          打开图形界面（默认）
  dsh-butler --headless               只启动本地服务，不打开窗口
  dsh-butler <命令> [子命令] [--json]  命令行模式

只读诊断（不会有任何副作用）：
  doctor                              全面体检
  env probe                           环境体检
  core status                         本体状态（含「是否需要完成更新」判定）
  runtime status                      服务状态（进程 / 端口 / 健康 / 僵尸锁）
  runtime logs [-n 200]               日志收集与错误定位
  runtime diagnose                    运行时诊断（进程/服务/插件树分层 + 13 条规则）
  plugin diagnose                     插件诊断（双名单 / 作层资格 / 重复注册 / 僵尸锁）

其它：
  actions                             列出所有可用动作
  job ls [--limit 20]                 查看任务历史
  job show <jobId>                    查看任务详情
  help                                显示本帮助

示例：
  dsh-butler doctor --json > report.json
  dsh-butler core status
  dsh-butler runtime logs -n 500
`.trim();

export interface CliOptions {
  json: boolean;
  argv: string[];
}

export function parseCli(argv: string[]): CliOptions {
  return { json: argv.includes("--json"), argv: argv.filter((a) => a !== "--json") };
}

/** 是否为需要走 CLI 的调用（否则进 GUI）。 */
export function isCliInvocation(argv: string[]): boolean {
  const first = argv.find((a) => !a.startsWith("-"));
  if (!first) return false;
  return ["doctor", "env", "core", "runtime", "plugin", "actions", "job", "help"].includes(first);
}

export function wantsHeadless(argv: string[]): boolean {
  return argv.includes("--headless");
}

export async function runCli(argv: string[]): Promise<number> {
  const { json, argv: args } = parseCli(argv);
  const cmd = args[0];
  const sub = args[1];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(CLI_HELP);
    return EXIT.OK;
  }

  switch (cmd) {
    case "doctor":
      return await runOne("diag.healthCheck", {}, json);
    case "env":
      if (sub === "probe") return await runOne("env.probe", {}, json);
      return usage(`env 的可用子命令：probe`);
    case "core":
      if (sub === "status") return await runOne("core.status", {}, json);
      return usage(`core 的可用子命令：status`);
    case "runtime":
      if (sub === "status") return await runOne("runtime.status", {}, json);
      if (sub === "diagnose") return await runOne("runtime.diagnose", {}, json);
      if (sub === "logs") {
        return await runOne("runtime.logs", { lines: numberArg(args, "-n") ?? 200 }, json);
      }
      return usage(`runtime 的可用子命令：status / diagnose / logs`);
    case "plugin":
      if (sub === "diagnose") return await runOne("plugin.diagnose", {}, json);
      return usage(`plugin 的可用子命令：diagnose`);
    case "actions": {
      const defs = engine.definitions();
      if (json) {
        console.log(JSON.stringify(defs.map((d) => ({
          name: d.name,
          domain: d.domain,
          title: d.title,
          readonly: d.readonly,
        })), null, 2));
      } else {
        for (const d of defs) {
          console.log(`  ${d.name.padEnd(18)} ${d.title}${d.readonly ? "（只读）" : ""}`);
        }
      }
      return EXIT.OK;
    }
    case "job":
      return await jobCommand(args, json);
    default:
      return usage(`未知命令：${cmd}`);
  }
}

function usage(message: string): number {
  console.error(message);
  console.error("");
  console.error(CLI_HELP);
  return EXIT.USAGE;
}

function numberArg(args: string[], flag: string): number | null {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : null;
}

async function jobCommand(args: string[], json: boolean): Promise<number> {
  const sub = args[1];
  if (sub === "ls") {
    const limit = numberArg(args, "--limit") ?? 20;
    const jobs = engine.list(limit);
    if (json) {
      console.log(JSON.stringify(jobs, null, 2));
    } else if (jobs.length === 0) {
      console.log("没有任务记录");
    } else {
      for (const j of jobs) {
        console.log(
          `  ${j.id}  ${j.status.padEnd(10)}  ${j.actionTitle}  ${new Date(j.createdAt).toLocaleString("zh-CN")}`,
        );
      }
    }
    return EXIT.OK;
  }
  if (sub === "show") {
    const id = args[2];
    if (!id) return usage("job show 需要任务 id");
    const job = engine.get(id);
    if (!job) {
      console.error(`任务不存在：${id}`);
      return EXIT.FAIL;
    }
    console.log(JSON.stringify(job, null, 2));
    return EXIT.OK;
  }
  return usage("job 的可用子命令：ls / show");
}

/** 创建任务、等待完成、输出结果。 */
async function runOne(action: string, params: Record<string, unknown>, json: boolean): Promise<number> {
  const created = await engine.create(action, params);
  if (!created.ok || !created.jobId) {
    console.error(created.error ?? "无法创建任务");
    return EXIT.PRECOND;
  }

  const job = await waitForJob(created.jobId);
  if (!job) {
    console.error("任务丢失");
    return EXIT.FAIL;
  }

  if (job.status !== "succeeded") {
    if (json) {
      console.log(JSON.stringify({ ok: false, status: job.status, error: job.error, steps: job.steps }, null, 2));
    } else {
      console.error(`任务未成功（${job.status}）：${job.error ?? "无详细信息"}`);
      for (const s of job.steps) {
        const mark = s.status === "done" ? "✓" : s.status === "failed" ? "✗" : "·";
        console.error(`  ${mark} ${s.title}${s.error ? " — " + s.error : ""}`);
      }
    }
    return job.status === "timeout"
      ? EXIT.TIMEOUT
      : job.status === "cancelled"
      ? EXIT.CANCEL
      : EXIT.FAIL;
  }

  if (json) {
    console.log(JSON.stringify(job.result, null, 2));
  } else {
    printHuman(action, job.result);
  }
  return EXIT.OK;
}

async function waitForJob(id: string, timeoutMs = 300_000): Promise<Job | null> {
  const started = Date.now();
  for (;;) {
    const job = engine.get(id);
    if (!job) return null;
    if (job.status !== "running" && job.status !== "queued") return job;
    if (Date.now() - started > timeoutMs) return job;
    await new Promise((r) => setTimeout(r, 120));
  }
}

function printHuman(action: string, result: unknown): void {
  switch (action) {
    case "diag.healthCheck":
      console.log(renderMarkdown(result as HealthReport));
      return;
    case "env.probe": {
      const r = result as EnvReport;
      console.log(`系统：${r.system.platform} ${r.system.arch} · ${r.system.cpuCount} 核 · ${humanSize(r.system.memTotalBytes)} 内存`);
      console.log(`运行时环境：${r.runtime.map((x) => `${x.label}=${x.found ? x.version ?? "已装" : "缺失"}`).join("  ")}`);
      console.log(`DSH 本体：${r.dsh.sourceRoot ?? "未找到"}`);
      printFindings(r.findings);
      return;
    }
    case "core.status": {
      const r = result as CoreStatus;
      console.log(`本体位置：${r.sourceRoot ?? "未找到"}`);
      if (r.git) console.log(`源码：${r.git.branch} @ ${r.git.headShort}（改动 ${r.git.dirtyTracked} 个文件）`);
      if (r.build) console.log(`构建记录：${r.build.commit} / ${r.build.version}`);
      if (r.integrity) {
        if (r.integrity.official && r.integrity.verified) {
          console.log(
            `产物完整性：通过官方校验（${r.integrity.fileCount} 个文件，摘要 ${(r.integrity.sha256 ?? "").slice(0, 12)}…）`,
          );
        } else if (r.integrity.official) {
          console.log(`产物完整性：官方判定不一致 —— ${r.integrity.error}`);
        } else {
          console.log(`产物完整性：无法校验 —— ${r.integrity.error}`);
        }
      }
      console.log(`需要完成更新：${r.needsFinishUpdate ? "是" : "否"}${r.finishReason ? " — " + r.finishReason : ""}`);
      if (r.plugins) {
        console.log(`插件：依赖 ${r.plugins.dependencies.length} · 名单 ${r.plugins.bundles.length} · 生效 ${r.plugins.active.length}`);
        if (r.plugins.inBox.length > 0) {
          console.log(`      其中 ${r.plugins.inBox.length} 个是本体自带基座包（不必写进依赖）：${r.plugins.inBox.join("、")}`);
        }
      }
      printFindings(r.findings);
      return;
    }
    case "runtime.status": {
      const r = result as RuntimeStatus;
      console.log(`服务：${r.running ? `运行中（PID ${r.pid}，端口 ${r.port ?? "?"}）` : "未运行"}`);
      if (r.launchForm) console.log(`启动形态：${r.launchForm === "compiled" ? "编译版" : "开发态"}`);
      if (r.health) console.log(`健康检查：${r.health.reachable ? `HTTP ${r.health.status} / ${r.health.latencyMs}ms` : "不可访问 — " + r.health.error}`);
      const locks = r.locks ?? [];
      const bad = locks.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
      console.log(`写锁：${locks.length} 个${bad.length ? `（其中 ${bad.length} 个已失效）` : ""}`);
      for (const l of locks) {
        if (l.verdict === "stale" || l.verdict === "recycled") console.log(`      ⚠ ${l.note}`);
      }
      console.log(`残留备份：${r.residue.length} 类`);
      printFindings(r.findings);
      return;
    }
    case "runtime.logs": {
      const r = result as LogsReport;
      console.log(`日志文件：${r.sources.length} 份，共 ${humanSize(r.totalBytes)}`);
      for (const e of r.recentErrors) {
        console.log("");
        console.log(`--- ${e.source} ---`);
        for (const line of e.lines.slice(0, 15)) console.log(`  ${line}`);
      }
      printFindings(r.findings);
      return;
    }
    case "plugin.diagnose": {
      const r = result as {
        profileDir: string;
        findings: Array<{ severity: string; title: string; action?: string }>;
        health: string;
        rulesRun: number;
        summary: { deps: number; bundles: number; active: number; errors: number; warns: number };
      };
      console.log(`profile：${r.profileDir}`);
      console.log(
        `插件：依赖 ${r.summary.deps} · 名单 ${r.summary.bundles} · 生效 ${r.summary.active} · 规则 ${r.rulesRun} 条 · 结论 ${r.health}`,
      );
      printFindings(r.findings);
      return;
    }
    case "runtime.diagnose": {
      const r = result as {
        facts: {
          procCount: number;
          port: number | null;
          http: { reachable: boolean; status: number | null } | null;
          startupDump: { failed: boolean; ageMs: number | null; failedPlugins: string[] };
        };
        findings: Array<{ severity: string; title: string; action?: string }>;
        health: string;
        rulesRun: number;
      };
      // 分层与规则同口径：只有 15 分钟内的失败转储才算「现场」，
      // 陈旧转储由 boot-failed / 日志规则以 info 报历史，不进分层结论。
      const dumpFresh = r.facts.startupDump.failed &&
        r.facts.startupDump.ageMs !== null &&
        r.facts.startupDump.ageMs <= DUMP_FRESH_MS;
      const layer = r.facts.procCount === 0
        ? "未运行"
        : !r.facts.http?.reachable
        ? "进程活着但服务没起来"
        : dumpFresh
        ? "服务通了但插件树没加载完"
        : "正常（进程 / 服务 / 插件树三层全通）";
      console.log(
        `分层结论：${layer} · 进程 ${r.facts.procCount} · 端口 ${r.facts.port ?? "?"} · 规则 ${r.rulesRun} 条 · 结论 ${r.health}`,
      );
      printFindings(r.findings);
      return;
    }
    default:
      console.log(JSON.stringify(result, null, 2));
  }
}

function printFindings(findings: Array<{ severity: string; title: string; action?: string }>): void {
  if (findings.length === 0) {
    console.log("问题清单：无");
    return;
  }
  console.log("");
  console.log("问题清单：");
  for (const f of findings) {
    const tag = f.severity === "error" ? "错误" : f.severity === "warn" ? "警告" : "提示";
    console.log(`  [${tag}] ${f.title}${f.action ? " → " + f.action : ""}`);
  }
}
