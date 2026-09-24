/**
 * core.finishUpdate —— 「完成更新」六步曲（方案 AC-C2）。
 *
 * 停服 → 深度清理 → 装依赖 → 全量重建 → 核对 → 重启。
 * 语义逐条继承旧版管家 dsh_core_finish_update（1.18.x，真实机器验证多轮）：
 *
 *   - 前三步失败【警告继续】：依赖没变时网络不通也会报错，但构建照样能成功，
 *     真有问题下一步会给出明确原因——尽量让用户拿到可用结果；
 *   - 第④步全量重建【致命】：走官方 `pnpm run build`（自己拼步骤会漏写构建记录，
 *     工具将永远认为"还没构建完"）；最多 3 次重试，但只对「纯瞬断」重试
 *     （Windows 上 rolldown 并发写 200+ 包随机报 os error 5，重试基本必过；
 *     日志里有真错误时绝不重试，不让人干等必然失败的重编）；
 *   - 第⑤步核对【非致命】：校验依赖 tsx，环境异常时不该把已成功的构建判失败；
 *   - 第⑥步重启【致命】：重建完成起不来 = 用户什么都没拿到；
 *   - 致命失败前先把服务拉回来（engine 的 onUndo 补偿）——「点了一次按钮 DSH
 *     就再也起不来」比不做这件事更糟。
 *
 * 写前安全（方案 §8）：
 *   - 动手【之前】先落盘回滚点（write-ahead）：git-ref 钉住 HEAD +
 *     构建记录 copy，逆操作 git-reset + 隔离区内容整体搬回；
 *   - preflight 检查本体存在、git 可用、pnpm 可探测，任一 error 即不执行。
 *
 * 服务启动为什么用 PowerShell Start-Process 而不是 Deno.Command：
 *   Deno 不支持把文件 fd 直接交给子进程（实测 rid 传进去输出照样丢失），
 *   而 piped 方案意味着【有一根管道连着本进程】——本进程退出后读端关闭，
 *   长期运行的服务下次写 stdout 就 EPIPE 崩掉。Start-Process +
 *   -RedirectStandardOutput 把文件句柄直接交给 node，与本进程零管道，
 *   本进程退出后服务毫发无损（对齐旧版 Rust `Stdio::from(log_file)` 的语义）。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { finding, type Finding } from "../../util/result.ts";
import { locate, powershell, run, type RunResult } from "../../host/shell.ts";
import { isFile } from "../../host/fs.ts";
import { describePort, findDshPort, isPortFree } from "../../host/port.ts";
import { invalidateLiveCache, invalidateProcessCache, killProcess, listDshProcesses } from "../../host/process.ts";
import {
  butlerLogsDir,
  isWindows,
  p,
  quarantineStampDir,
  resolveDshSourceRoot,
  stampOf,
} from "../../util/paths.ts";
import {
  DSH_CLI_SUBDIR,
  DSH_PORT_CANDIDATES,
  DSH_PORT_DEFAULT,
  DSH_PROFILE_DEFAULT,
  TIMEOUTS,
} from "../../version.ts";
import { deepCleanInto, type CleanReport } from "./deep_clean.ts";
import { invalidateBuildIntegrityCache, verifyBuildIntegrity } from "./official.ts";
import { collectCoreStatus } from "./status.ts";
import { createRollbackPoint } from "../backup/rollback.ts";

const BUILD_ATTEMPTS = 3;

/** 六步清单（单一事实来源：步骤表、进度、汇报共用一份）。 */
export const FINISH_STEPS = [
  "停止 DSH 服务",
  "清理残留（隔离不属于当前版本的文件、清掉上游已删的孤儿包、作废编译缓存）",
  "安装 / 更新依赖",
  "全量重建（原生组件 + 主进程 + 界面模块 + 网页外壳）",
  "核对产物与源码是否一致",
  "重启 DSH 服务",
] as const;

// ── pnpm 探测（移植旧版 detect_pnpm） ───────────────────────────────

export interface PnpmToolchain {
  node: string;
  pnpmCjs: string;
}

/**
 * 探测 pnpm，返回 `(node, pnpm.cjs)`。
 *
 * 为什么不走 `cmd /c pnpm`：GUI 程序派生 cmd 在桌面堆紧张时子进程初始化会失败
 * （退出码 0xC0000142、零输出），且 pnpm 的 .cmd 只是包装脚本——直接执行其 .cjs 更稳。
 * 优先用与 pnpm 同目录的 node：同一份 Node 安装，版本最一致。
 */
export async function detectPnpm(): Promise<PnpmToolchain | null> {
  const roots: string[] = [];
  // 1) 用户级全局安装——最贴近用户在命令行里用的那个 pnpm
  const appdata = Deno.env.get("APPDATA");
  if (appdata) roots.push(p(appdata, "npm"));
  // 2) PATH 上的每个目录（含 Node 官方安装目录）
  const pathVar = Deno.env.get("PATH") ?? "";
  for (const d of pathVar.split(isWindows ? ";" : ":")) {
    const clean = d.trim().replace(/^"|"$/g, "");
    if (clean) roots.push(clean);
  }
  // 3) Windows 默认安装位置兜底
  if (isWindows) roots.push("C:\\Program Files\\nodejs");

  for (const dir of roots) {
    const cli = p(dir, "node_modules", "pnpm", "bin", "pnpm.cjs");
    if (!isFile(cli)) continue;
    const sameDirNode = p(dir, isWindows ? "node.exe" : "node");
    if (isFile(sameDirNode)) return { node: sameDirNode, pnpmCjs: cli };
    const fallback = await locate("node");
    if (fallback) return { node: fallback, pnpmCjs: cli };
  }
  return null;
}

// ── 构建日志判据（移植旧版，测试钉住） ──────────────────────────────

const BUILD_ERROR_PATTERNS = ["MISSING_EXPORT", "error TS", "Failed to write file", "拒绝访问", "Cannot find module"];

/**
 * 从构建日志里挑出真正的报错行（去重，保序）。
 *
 * 为什么不能只贴最后几行：rolldown 在 Windows 上并发写时会随机报
 * `拒绝访问 (os error 5)`（事后该文件完全可写，属瞬时写竞争），
 * 它往往先炸，把真错误挡在后面——用户拿到的就是一段与故障无关的噪音。
 */
export function pickBuildErrors(text: string): string[] {
  const hits: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (!BUILD_ERROR_PATTERNS.some((pat) => line.includes(pat))) continue;
    if (!hits.includes(line)) hits.push(line);
  }
  return hits;
}

/**
 * 这次失败是不是「并发写的瞬时拒绝」——重试一次通常就过。
 * 只对纯瞬断重试：日志里同时出现真错误（缺导出/类型错/找不到模块）时绝不重试。
 */
export function isTransientBuildFailure(text: string): boolean {
  const transient = text.includes("os error 5") || text.includes("拒绝访问");
  const real = text.includes("MISSING_EXPORT") || text.includes("error TS") || text.includes("Cannot find module");
  return transient && !real;
}

/** 取文本最后 n 个非空行（挑不到真错误时兜底展示）。 */
function tailLines(text: string, n: number): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 服务停止 / 启动 ─────────────────────────────────────────────────

export interface StopOutcome {
  wasRunning: boolean;
  stopped: number;
  /** 停之前服务占的端口（重启时用同一个）。 */
  port: number | null;
}

/**
 * 停止 DSH 服务（对所有 DSH web 进程 taskkill /F /T）。
 * 构建期间服务在跑有两个坏处：写 dist 的瞬间浏览器可能拿到半成品；
 * 服务进程持有的文件句柄在 Windows 上还可能挡住覆盖。
 */
export async function stopDshServer(): Promise<StopOutcome> {
  const procs = await listDshProcesses();
  if (procs.length === 0) return { wasRunning: false, stopped: 0, port: null };

  let stopped = 0;
  for (const pr of procs) {
    if (await killProcess(pr.pid, true)) stopped++;
  }
  invalidateProcessCache();
  invalidateLiveCache();
  const port = procs.map((x) => x.port).find((x): x is number => typeof x === "number") ?? null;
  // 给文件句柄一点释放时间，避开 Windows 上的瞬时占用冲突（旧版固定等 2 秒）
  await sleep(2000);
  return { wasRunning: true, stopped, port };
}

export interface StartOutcome {
  ok: boolean;
  message: string;
  logFiles: string[];
}

/**
 * 启动 DSH 服务并轮询端口最多 15 秒。
 *
 * 形态与旧版一致：`node --expose-internals lib/bin.js --profile web --no-open --port N`，
 * cwd = apps/cli。stdout/stderr 经 Start-Process 交给日志文件（见文件头注释）。
 * 「端口已被占但占用者就是 DSH」视为成功（幂等：重复点启动不报错）。
 */
export async function startDshServer(root: string, port: number): Promise<StartOutcome> {
  const logFiles: string[] = [];

  if (!isPortFree(port)) {
    const st = await describePort(port);
    if (st.isDsh) return { ok: true, message: `已在运行（端口 ${port}）`, logFiles };
    return {
      ok: false,
      message: `端口 ${port} 被非 DSH 进程占用：${st.owners.map((o) => o.name).join("、") || "未知进程"}`,
      logFiles,
    };
  }

  const node = Deno.env.get("DSH_NODE_PATH") ?? (await locate("node"));
  if (!node) return { ok: false, message: "找不到 node（可在环境体检里确认 Node.js 是否安装）", logFiles };

  const cliDir = p(root, DSH_CLI_SUBDIR);
  const binJs = p(cliDir, "lib", "bin.js");
  if (!isFile(binJs)) {
    return { ok: false, message: `构建产物缺失：${binJs}（先跑「完成更新」的重建步骤）`, logFiles };
  }

  Deno.mkdirSync(butlerLogsDir(), { recursive: true });
  const stamp = stampOf();
  const logOut = p(butlerLogsDir(), `dsh-server-${stamp}.out.log`);
  const logErr = p(butlerLogsDir(), `dsh-server-${stamp}.err.log`);
  logFiles.push(logOut, logErr);

  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const argList = [
    "--expose-internals",
    "lib/bin.js",
    "--profile",
    DSH_PROFILE_DEFAULT,
    "--no-open",
    "--port",
    String(port),
  ].map(q).join(",");

  const script =
    `$p = Start-Process -FilePath ${q(node)} -ArgumentList ${argList} ` +
    `-WorkingDirectory ${q(cliDir)} -RedirectStandardOutput ${q(logOut)} ` +
    `-RedirectStandardError ${q(logErr)} -NoNewWindow -PassThru; $p.Id`;
  const ps = await powershell(script, { timeoutMs: 20_000 });
  const pidText = ps.stdout.trim().split(/\r?\n/).filter((l) => /^\d+$/.test(l.trim())).pop();
  if (!pidText) {
    const why = ps.stderr.trim().split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(" / ");
    return { ok: false, message: `启动命令失败：${why || `退出码 ${ps.code}`}`, logFiles };
  }

  // 轮询端口最多 15 秒
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!isPortFree(port)) {
      const st = await describePort(port);
      if (st.isDsh || st.owners.some((o) => o.cmdline.includes("bin.js"))) {
        return { ok: true, message: `已启动（PID ${pidText}，端口 ${port}）`, logFiles };
      }
    }
    await sleep(500);
  }

  // 起失败：把两个日志的尾部捞出来，别让用户对着黑盒猜
  const tails = logFiles
    .flatMap((f) => {
      try {
        return tailLines(Deno.readTextFileSync(f), 6);
      } catch {
        return [];
      }
    })
    .slice(0, 12);
  return {
    ok: false,
    message: `15 秒内端口 ${port} 未监听${tails.length ? `。启动日志尾部：\n${tails.join("\n")}` : ""}`,
    logFiles,
  };
}

// ── 报告 ────────────────────────────────────────────────────────────

export interface FinishUpdateReport {
  sourceRoot: string;
  /** 写前回滚点 id（失败可一键还原）。 */
  rollbackId: string;
  /** 本次清理的隔离区（null = 无需清理）。 */
  quarantineDir: string | null;
  clean: CleanReport | null;
  /** 逐条人话汇报（照旧版 report 格式）。 */
  lines: string[];
  verify: { official: boolean; verified: boolean; error: string | null } | null;
  serviceWasRunning: boolean;
  serviceRestarted: boolean;
  /** 收尾复核：「需要完成更新」是否已消除（AC-C2 的最终判据之一）。 */
  needsFinishUpdateAfter: boolean;
  head: string | null;
  elapsedMs: number;
}

// ── preflight（写前检查，error 级直接拦截） ──────────────────────────

/**
 * 写前三条硬检查：本体存在、git 源码形态、pnpm 可用。
 * core.finishUpdate 与 core.update 共用（update 另加工作区脏检查）。
 */
export async function finishPreflightBase(): Promise<Finding[]> {
  const out: Finding[] = [];

  const probe = resolveDshSourceRoot();
  if (!probe) {
    out.push(
      finding("core.finish.no-root", "error", "未找到 DSH 本体目录", {
        cause: "本机没有检测到 DSH 源码树（apps/cli 判据）",
        impact: "无法执行「完成更新」的任何步骤",
        action: "先用「一键部署」装好 DSH，或在设置里指定本体目录",
        fixAction: "bootstrap.plan",
      }),
    );
    return out;
  }

  const head = await run("git", ["-C", probe.path, "rev-parse", "--verify", "HEAD"], {
    timeoutMs: 15_000,
    allowNonZero: true,
    scope: "git",
  });
  if (head.code !== 0) {
    out.push(
      finding("core.finish.not-git", "error", "当前 DSH 不是 git 源码形态，无法用这种方式重建", {
        cause: "在本体目录里执行 git rev-parse HEAD 失败——不是 git 仓库，或一次提交都没有",
        impact: "深度清理依赖 git 的文件清单判定残留，重建后的「是否需要收尾」也靠提交号比对",
        action: "改用官方安装包形态的 DSH，或重新完整克隆本体仓库",
        evidence: [probe.path],
      }),
    );
  }

  const tc = await detectPnpm();
  if (!tc) {
    out.push(
      finding("core.finish.no-pnpm", "error", "没找到 pnpm", {
        cause: "APPDATA/npm、PATH、C:\\Program Files\\nodejs 里都没有 pnpm.cjs",
        impact: "装依赖与全量重建都执行不了",
        action: "先安装 Node.js 18+ 与 pnpm 11+（npm install -g pnpm），再重试",
        evidence: [probe.path],
      }),
    );
  }

  return out;
}

// ── 动作 ────────────────────────────────────────────────────────────

async function runUpdate(ctx: ActionContext): Promise<FinishUpdateReport> {
  const t0 = Date.now();
  const probe = resolveDshSourceRoot();
  if (!probe) throw new Error("未找到 DSH 本体目录");
  const root = probe.path;
  const tc = await detectPnpm();
  if (!tc) throw new Error("没找到 pnpm，请先安装后重试");

  const stamp = stampOf();
  const destRoot = quarantineStampDir(root, stamp);

  // ── write-ahead：动手【之前】先落盘回滚点 ──────────────────────────
  // reverse 里的 commit 必须在创建时就写对（rollback.ts 没有事后改写接口），
  // 所以先自己解析 HEAD——与随后 git-ref 条目解析的是同一个提交（同进程顺序执行）。
  const headR = await run("git", ["-C", root, "rev-parse", "HEAD"], {
    timeoutMs: 15_000,
    allowNonZero: true,
    scope: "git",
  });
  if (headR.code !== 0 || !headR.stdout.trim()) {
    throw new Error("无法解析当前提交（git rev-parse HEAD 失败），拒绝在没有回滚点的情况下重建");
  }
  const commit = headR.stdout.trim();
  const buildRecord = p(root, ".dsh-build", "client-build-environment.json");
  const pt = await createRollbackPoint({
    kind: "core-build",
    trigger: "core.finishUpdate 前置",
    jobId: ctx.jobId,
    artifacts: [
      { path: root, mode: "git-ref" },
      ...(isFile(buildRecord) ? [{ path: buildRecord, mode: "copy" as const }] : []),
    ],
    reverse: { op: "git-reset", commit, quarantine: destRoot },
  });
  const gitArt = pt.artifacts.find((a) => a.mode === "git-ref");
  if (!gitArt) throw new Error("回滚点缺少 git-ref 条目（内部不一致）");
  ctx.log(`回滚点已创建：${pt.id}（任务失败可一键还原到 ${gitArt.sha256.slice(0, 12)}…）`);

  const report: FinishUpdateReport = {
    sourceRoot: root,
    rollbackId: pt.id,
    quarantineDir: null,
    clean: null,
    lines: [],
    verify: null,
    serviceWasRunning: false,
    serviceRestarted: false,
    needsFinishUpdateAfter: false,
    head: null,
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  /** 致命失败前把服务拉回来（engine 失败时逆序执行补偿）。 */
  const rememberRestore = (port: number) => {
    ctx.onUndo(async () => {
      const r = await startDshServer(root, port);
      ctx.log(r.ok ? `补偿：DSH 服务已恢复（${r.message}）` : `⚠️ 补偿启动服务失败：${r.message}`);
    });
  };

  // ── ① 停止 DSH 服务（失败警告继续） ──────────────────────────────
  ctx.step("s1", FINISH_STEPS[0]);
  ctx.progress(0.05);
  const stop = await stopDshServer();
  const port = stop.port ?? (await findDshPort(DSH_PORT_CANDIDATES)) ?? DSH_PORT_DEFAULT;
  report.serviceWasRunning = stop.wasRunning;
  if (stop.wasRunning) {
    rememberRestore(port);
    line(`停止 DSH 服务：已停止 ${stop.stopped} 个进程`);
    ctx.detail(`已停止 ${stop.stopped} 个进程，服务端口 ${port}`);
  } else {
    line("停止 DSH 服务：服务未运行，跳过");
    ctx.detail("服务未在运行");
  }
  ctx.throwIfCancelled();

  await runFinishTail({
    ctx,
    root,
    tc,
    destRoot,
    restartPort: port,
    report,
    line,
    stepIds: ["s2", "s3", "s4", "s5", "s6"],
    stepTitles: [FINISH_STEPS[1], FINISH_STEPS[2], FINISH_STEPS[3], FINISH_STEPS[4], FINISH_STEPS[5]],
    mapProgress: (v) => v,
  });
  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// ── 尾段共享（finish 与 update 同一份实现，防语义漂移） ───────────────

interface FinishTailOptions {
  ctx: ActionContext;
  root: string;
  tc: PnpmToolchain;
  destRoot: string;
  restartPort: number;
  report: FinishUpdateReport;
  line: (s: string) => void;
  /** 尾段 5 步的 step id（finish: s2..s6；update: s4..s8）。 */
  stepIds: readonly [string, string, string, string, string];
  /** 尾段 5 步的标题（finish: FINISH_STEPS[1..5]；update: UPDATE_STEPS[3..7]）。 */
  stepTitles: readonly [string, string, string, string, string];
  /** 内部进度（finish 口径 0..1）→ 对外进度；update 传 v => 0.3 + v*0.7 防进度倒退。 */
  mapProgress: (v: number) => number;
}

/**
 * 「清理 → 装依赖 → 重建 → 核对 → 重启 → 收尾复核」尾段。
 *
 * core.finishUpdate 与 core.update 共用这一份实现 —— 铁律 9 要求本体更新
 * 必须走完整四步（pull → 装依赖 → 全量重建 → 重启），两边各写一份必然漂移，
 * 所以抽在这里，调用方只注入步骤 id / 标题 / 进度映射。
 * 各步失败语义（警告继续 vs 致命）见 FINISH_STEPS 头注释，不因调用方而异。
 */
export async function runFinishTail(o: FinishTailOptions): Promise<void> {
  const { ctx, root, tc, destRoot, restartPort, report, line } = o;
  const pg = (v: number) => ctx.progress(o.mapProgress(v));
  const beginStep = (i: 0 | 1 | 2 | 3 | 4) => ctx.step(o.stepIds[i], o.stepTitles[i]);

  // ── ② 深度清理（失败不阻断：本就无残留时也可能因权限报错） ──────────
  beginStep(0);
  pg(0.15);
  try {
    const { report: clean, lines } = await deepCleanInto(root, destRoot);
    for (const l of lines) ctx.log(l);
    report.clean = clean;
    report.quarantineDir = clean.quarantineDir;
    const movedCount = clean.quarantined + clean.staleRemoved + clean.orphanPackages;
    line(
      `清理残留：已隔离 ${movedCount} 项、作废 ${clean.tsbuildinfoReset} 个编译缓存` +
        (clean.failed.length ? `（${clean.failed.length} 项未能移动）` : ""),
    );
    if (clean.quarantineDir) {
      line(`　隔离区（要还原就把里面的文件搬回原位）：${clean.quarantineDir}`);
    }
    ctx.detail(`孤儿包 ${clean.orphanPackages} · 残留源文件 ${clean.quarantined} · 编译缓存 ${clean.tsbuildinfoReset}`);
  } catch (e) {
    line(`清理残留：未能完成（${(e as Error).message}），继续构建`);
  }
  ctx.throwIfCancelled();

  // ── ③ 安装依赖（失败警告继续：依赖没变时网络不通也报错，构建照样能成） ──
  beginStep(1);
  pg(0.3);
  const inst = await run(tc.node, [tc.pnpmCjs, "install"], {
    cwd: root,
    timeoutMs: TIMEOUTS.install,
    allowNonZero: true,
    scope: "build",
    signal: ctx.signal,
  });
  if (inst.code === 0 && !inst.timedOut) {
    line("安装 / 更新依赖：完成（依赖已是最新）");
    ctx.detail("依赖已是最新");
  } else {
    const last = tailLines(inst.stdout + "\n" + inst.stderr, 1)[0] ?? "";
    line(
      `安装 / 更新依赖：${inst.timedOut ? "超时" : `退出码 ${inst.code}`}（已跳过，继续构建）${last ? ` — ${last}` : ""}`,
    );
  }
  ctx.throwIfCancelled();

  // ── ④ 全量重建（致命；只对纯瞬断重试，最多 3 次） ───────────────────
  beginStep(2);
  pg(0.4);
  let outcome: RunResult | null = null;
  let attempt = 0;
  let lineCount = 0;
  for (;;) {
    attempt++;
    ctx.detail(
      `第 ${attempt}/${BUILD_ATTEMPTS} 次构建，通常需要 5-20 分钟${attempt > 1 ? "（瞬时拒绝，重试中）" : ""}`,
    );
    outcome = await run(tc.node, [tc.pnpmCjs, "run", "build"], {
      cwd: root,
      timeoutMs: TIMEOUTS.build,
      allowNonZero: true,
      scope: "build",
      signal: ctx.signal,
      onLine: () => {
        lineCount++;
        if (lineCount % 200 === 0) ctx.detail(`构建输出 ${lineCount} 行…`);
      },
    });
    if (outcome.code === 0 && !outcome.timedOut) break;
    if (outcome.timedOut) break;
    if (attempt >= BUILD_ATTEMPTS || !isTransientBuildFailure(outcome.stdout + "\n" + outcome.stderr)) break;
    ctx.log(`第 ${attempt} 次撞上 Windows 并发写的瞬时拒绝（换个包再来一次通常就过），正在重试…`);
  }
  // 用户中途取消时 run 返回的也是非 0 —— 先按「已取消」走，别报成构建失败
  ctx.throwIfCancelled();
  if (!outcome || outcome.timedOut || outcome.code !== 0) {
    const text = (outcome?.stdout ?? "") + "\n" + (outcome?.stderr ?? "");
    const errs = pickBuildErrors(text);
    const brief = errs.length > 0 ? errs.slice(0, 12) : tailLines(text, 12);
    const why = outcome?.timedOut
      ? `超过 ${Math.round(TIMEOUTS.build / 60_000)} 分钟未结束`
      : `退出码 ${outcome?.code ?? -1}`;
    throw new Error(
      `全量重建失败（${why}）。从构建日志里定位到的报错：\n${brief.join("\n")}\n\n` +
        `产物可能仍处于新旧混合状态——服务已尝试恢复，建议把上面的报错发给知行排查。`,
    );
  }
  line("全量重建：完成");
  pg(0.85);
  ctx.throwIfCancelled();

  // ── ⑤ 核对产物（非致命：校验依赖 tsx，环境异常不判死已成功的构建） ────
  beginStep(3);
  pg(0.9);
  invalidateBuildIntegrityCache();
  const integ = await verifyBuildIntegrity(root, { fresh: true });
  report.verify = { official: integ.official, verified: integ.verified, error: integ.error };
  if (integ.official && integ.verified) {
    line("核对产物：一致（通过官方校验）");
    ctx.detail(`产物与源码一致（${integ.fileCount} 个文件）`);
  } else {
    const why = integ.error ?? "未能调用官方校验脚本";
    line(`核对产物：未通过（${why}）`);
    ctx.detail(why);
  }
  ctx.throwIfCancelled();

  // ── ⑥ 重启服务（致命：重建完成起不来 = 用户什么都没拿到） ─────────────
  beginStep(4);
  pg(0.95);
  const started = await startDshServer(root, restartPort);
  if (!started.ok) {
    throw new Error(
      `重建已完成，但重启服务失败：${started.message}\n可在面板上用「启动」按钮手动启动。`,
    );
  }
  report.serviceRestarted = true;
  line(`重启 DSH 服务：${started.message}`);

  // 收尾：重新采集状态，让结论立刻反映 needs_finish 已消除
  const after = await collectCoreStatus();
  report.needsFinishUpdateAfter = after.needsFinishUpdate;
  report.head = after.git?.head ?? null;
  if (after.needsFinishUpdate && after.finishReason) {
    line(`⚠️ 核对仍未通过：${after.finishReason}产物可能仍不一致——请把上面的信息发给知行。`);
  } else {
    line(`完成更新：产物已重建到源码提交 ${after.git?.headShort ?? after.git?.head ?? "未知"}。`);
  }
  pg(1);
}

export const coreFinishUpdateAction: ActionDef<Record<string, never>, FinishUpdateReport> = {
  name: "core.finishUpdate",
  domain: "core",
  title: "完成更新（六步重建）",
  description:
    "停服 → 深度清理（孤儿包 / 残留源文件 / 编译缓存，只移动不删除）→ 装依赖 → 官方全量重建 → 核对产物 → 重启。动手前自动创建回滚点。",
  readonly: false,
  steps: [...FINISH_STEPS],
  preflight: finishPreflightBase,
  run: (ctx) => runUpdate(ctx),
  // 六步最坏预算：装依赖 15 分钟 + 3×构建 30 分钟 + 余量 —— 比默认 jobTotal 宽
  timeoutMs: 7_200_000,
};
