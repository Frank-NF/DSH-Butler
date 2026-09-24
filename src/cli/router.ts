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
import type { CoreVerifyReport } from "../domains/core/verify.ts";
import type { FinishUpdateReport } from "../domains/core/finish_update.ts";
import type { CoreRollbackReport } from "../domains/core/rollback.ts";
import type { RuntimeStatus } from "../domains/runtime/status.ts";
import type { LogsReport } from "../domains/runtime/logs.ts";
import { DUMP_FRESH_MS } from "../domains/runtime/facts.ts";
import type { BackupListReport, BackupVerifyReport } from "../domains/backup/actions.ts";
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
  core verify                         本体校验（产物完整性 + 僵尸 lib / 缺失包 / 未提交包）
  runtime status                      服务状态（进程 / 端口 / 健康 / 僵尸锁）
  runtime logs [-n 200]               日志收集与错误定位
  runtime diagnose                    运行时诊断（进程/服务/插件树分层 + 13 条规则）
  plugin diagnose                     插件诊断（双名单 / 作层资格 / 重复注册 / 僵尸锁）
  backup list                         列出回滚点
  backup verify [id]                  校验回滚点完整性

备份与回滚（写操作：不带 --yes 只出计划预览，加 --yes 才执行）：
  backup create <类型> <文件...>       创建回滚点（类型：core-build / plugin-set / config / snapshot / env）
  backup apply <id>                   回滚到指定回滚点（先校验完整性，验证不过保留回滚点）
  backup delete <id>                  删除回滚点
  core finishUpdate                   完成更新六步：停服 → 清残留 → 装依赖 → 全量重建 → 核对 → 重启（约 5-30 分钟）
  core rollback [id]                  回滚本体到最近的构建回滚点（缺省取最新；验证不过保留回滚点，绝不静默成功）

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
  return ["doctor", "env", "core", "runtime", "plugin", "backup", "actions", "job", "help"].includes(first);
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
      if (sub === "verify") return await runOne("core.verify", {}, json);
      if (sub === "finishUpdate") return await runWrite("core.finishUpdate", {}, args, json);
      if (sub === "rollback") {
        const id = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
        return await runWrite("core.rollback", id ? { id } : {}, args, json);
      }
      return usage(`core 的可用子命令：status / verify / finishUpdate / rollback`);
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
    case "backup": {
      if (sub === "list") return await runOne("backup.list", {}, json);
      if (sub === "verify") return await runOne("backup.verify", args[2] ? { id: args[2] } : {}, json);
      if (sub === "create") {
        const kind = args[2];
        const paths = args.slice(3).filter((a) => !a.startsWith("--"));
        if (!kind || paths.length === 0) {
          return usage("backup create 需要类型与至少一个文件：backup create config <文件...>");
        }
        return await runWrite("backup.create", { kind, paths, trigger: "命令行创建" }, args, json);
      }
      if (sub === "apply") {
        const id = args[2];
        if (!id) return usage("backup apply 需要回滚点 id：backup apply <id>");
        return await runWrite("backup.apply", { id }, args, json);
      }
      if (sub === "delete") {
        const id = args[2];
        if (!id) return usage("backup delete 需要回滚点 id：backup delete <id>");
        return await runWrite("backup.delete", { id }, args, json);
      }
      return usage(`backup 的可用子命令：list / verify / create / apply / delete`);
    }
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

/**
 * 写操作入口：plan → confirm → apply 三段式的 CLI 落地（方案 §4 约定）。
 *
 * - 无 --yes：执行【plan】—— 步骤表 + preflight（只读检查）全打印，零副作用，退出 0；
 * - 有 --yes：才真正创建任务执行（apply）。
 * 后续写子命令（core finishUpdate / update / rollback / plugin repair…）统一走这里，
 * 保证没有任何写操作能绕过计划预览直接动手。
 */
export async function runWrite(
  action: string,
  params: Record<string, unknown>,
  args: string[],
  json: boolean,
): Promise<number> {
  const yes = args.includes("--yes");
  const def = engine.definition(action);
  if (!def) return usage(`未知动作：${action}`);

  if (!yes) {
    const findings = def.preflight ? await def.preflight(params as never) : [];
    if (json) {
      console.log(JSON.stringify({
        plan: true,
        action,
        title: def.title,
        description: def.description ?? "",
        steps: def.steps ?? [],
        findings,
      }, null, 2));
    } else {
      console.log(`计划执行：${def.title}`);
      if (def.description) console.log(`  ${def.description}`);
      console.log("步骤：");
      (def.steps ?? []).forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      if (findings.length > 0) {
        console.log("");
        console.log("写前检查：");
        for (const f of findings) {
          console.log(`  [${f.severity === "error" ? "错误" : f.severity === "warn" ? "警告" : "提示"}] ${f.title}`);
        }
      }
      console.log("");
      console.log("这是计划预览，尚未执行任何更改。确认无误后加 --yes 执行。");
    }
    return EXIT.OK;
  }

  return await runOne(action, params, json);
}

/** 创建任务、等待完成、输出结果。 */
async function runOne(action: string, params: Record<string, unknown>, json: boolean): Promise<number> {
  const created = await engine.create(action, params);
  if (!created.ok || !created.jobId) {
    console.error(created.error ?? "无法创建任务");
    return EXIT.PRECOND;
  }

  // 等待上限跟着动作自己的超时走（finishUpdate 预算 2 小时，不能用默认 300 秒掐断）
  const def = engine.definition(action);
  const job = await waitForJob(created.jobId, (def?.timeoutMs ?? 300_000) + 60_000);
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
    case "core.verify": {
      const r = result as CoreVerifyReport;
      console.log(`本体位置：${r.sourceRoot ?? "未找到"}`);
      const st = r.status;
      if (st) {
        console.log(`需要完成更新：${st.needsFinishUpdate ? "是" : "否"}${st.finishReason ? " — " + st.finishReason : ""}`);
        if (st.integrity) {
          if (st.integrity.official && st.integrity.verified) {
            console.log(`产物完整性：通过官方校验（${st.integrity.fileCount} 个文件）`);
          } else if (st.integrity.official) {
            console.log(`产物完整性：官方判定不一致 —— ${st.integrity.error}`);
          } else {
            console.log(`产物完整性：无法校验 —— ${st.integrity.error}`);
          }
        }
      }
      if (r.libs) {
        console.log(
          `工作区包清单：${r.libs.patterns.length} 条 globs → 展开 ${r.libs.candidates} 个候选目录 · HEAD ${r.libs.headPackages} 个包`,
        );
        console.log(
          `残留判定：僵尸 lib ${r.libs.zombieLibs.length} · 缺失包 ${r.libs.missingPackages.length} · 未提交包 ${r.libs.untrackedPackages.length}`,
        );
        for (const z of r.libs.zombieLibs.slice(0, 20)) console.log(`      ⚠ 僵尸 ${z.libPath}`);
        for (const m of r.libs.missingPackages.slice(0, 20)) console.log(`      ✗ 缺失 ${m}/package.json`);
        for (const u of r.libs.untrackedPackages.slice(0, 20)) console.log(`      · 未提交 ${u}`);
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
    case "core.finishUpdate": {
      const r = result as FinishUpdateReport;
      for (const l of r.lines) console.log(l);
      console.log("");
      console.log(
        `耗时 ${Math.round(r.elapsedMs / 1000)} 秒 · 回滚点 ${r.rollbackId}` +
          (r.quarantineDir ? ` · 隔离区 ${r.quarantineDir}` : ""),
      );
      console.log(`需要完成更新（复核）：${r.needsFinishUpdateAfter ? "是 ⚠" : "否 ✓"} · 源码 ${r.head?.slice(0, 12) ?? "未知"}`);
      return;
    }
    case "core.rollback": {
      const r = result as CoreRollbackReport;
      for (const l of r.lines) console.log(l);
      console.log("");
      console.log(
        `回滚点 ${r.rollbackId} → ${r.targetCommit.slice(0, 12)}… · 重建：${
          r.rebuild === "done" ? "已完成" : r.rebuild === "skipped-no-script" ? "跳过（无 build 脚本）" : "跳过（未找到 pnpm）"
        }${r.quarantineDir ? ` · 隔离区 ${r.quarantineDir}` : ""}`,
      );
      console.log(`复核：${r.green ? "全绿 ✓" : "未通过 ✗"} · 源码 ${r.head?.slice(0, 12) ?? "未知"} · 耗时 ${Math.round(r.elapsedMs / 1000)} 秒`);
      return;
    }
    case "backup.list": {
      const r = result as BackupListReport;
      console.log(`回滚存储：${r.root}`);
      if (r.points.length === 0) {
        console.log("没有回滚点");
        return;
      }
      console.log(`共 ${r.points.length} 个回滚点：`);
      for (const pt of r.points) {
        console.log(
          `  ${pt.id}  ${pt.kind.padEnd(11)}  ${pt.verified ? "已验证" : "⚠ 未验证"}  ${
            humanSize(pt.sizeBytes)
          }  ${pt.trigger}`,
        );
      }
      return;
    }
    case "backup.verify": {
      const r = result as BackupVerifyReport;
      console.log(`校验 ${r.results.length} 个回滚点：${r.allOk ? "全部通过" : "存在问题"}`);
      for (const x of r.results) {
        if (x.ok) console.log(`  ✓ ${x.id}`);
        else {
          console.log(`  ✗ ${x.id}`);
          for (const pr of x.problems) console.log(`      ${pr}`);
        }
      }
      return;
    }
    case "backup.create": {
      const pt = result as { id: string; artifacts: Array<{ path: string }>; sizeBytes: number };
      console.log(`回滚点已创建：${pt.id}`);
      console.log(`  ${pt.artifacts.length} 个条目 · ${humanSize(pt.sizeBytes)}`);
      return;
    }
    case "backup.apply": {
      const r = result as { id: string; result: { ok: boolean; warnings?: string[] } };
      console.log(`已回滚到：${r.id}${r.result.ok ? "（验证通过）" : ""}`);
      for (const w of r.result.warnings ?? []) console.log(`  ⚠ ${w}`);
      return;
    }
    case "backup.delete": {
      const r = result as { deleted: string };
      console.log(`回滚点已删除：${r.deleted}`);
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
