/**
 * runtime.status —— 运行态检测（只读）。
 *
 * 覆盖：
 *   - 服务进程识别（PID / 端口 / 启动形态）
 *   - 健康检查（分层：进程活着 ≠ 服务可用 ≠ 插件树就绪）
 *   - 僵尸写锁扫描（只报告，不改动 —— 修复由 S2 的 repair 动作执行）
 *   - profile 残留物台账（旧版积累了 7 类"用完没清"的东西）
 */

import type { ActionDef } from "../../jobs/types.ts";
import { finding, type Finding } from "../../util/result.ts";
import { listDshProcesses, liveProcesses, looksLikeNodeProcess, type ProcInfo } from "../../host/process.ts";
import { describePort } from "../../host/port.ts";
import { dshProfileDir, p } from "../../util/paths.ts";
import { humanSize } from "../../host/fs.ts";
import { dirSizeBudgeted, listDir, isDir, isFile } from "../../host/fs.ts";
import { DSH_PORT_CANDIDATES } from "../../version.ts";

export interface HealthCheck {
  /** 能否建立 TCP 连接并拿到 HTTP 响应。 */
  reachable: boolean;
  status: number | null;
  latencyMs: number | null;
  error?: string;
}

export interface LockInfo {
  file: string;
  /** 锁文件里写的 PID（读不出为 null）。 */
  pid: number | null;
  /** 该 PID 对应的进程当前是否存在。 */
  alive: boolean;
  /** 存活进程的名字（用于识别 PID 复用）。 */
  holderName: string | null;
  sizeBytes: number;
  verdict: "keep" | "recycled" | "unreadable" | "stale";
  note: string;
}

/**
 * profile 目录里的一类残留备份。
 *
 * 命名注意：这里的 residue 指【旧版清理动作留下的备份目录】，
 * 与 core/status.ts 的 ResidueEntry（pnpm 安装中断产生的暂存目录）是两回事，
 * 所以类型与函数名都带上 Profile 前缀，避免两个模块的 scanResidue 撞名字。
 */
export interface ProfileResidue {
  name: string;
  kind: string;
  sizeBytes: number;
  /** false = 体积未统计完（超出时间预算），sizeBytes 只代表"至少"。 */
  sizeComplete: boolean;
  count: number;
}

export interface RuntimeStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  /** 启动形态：A=编译版（lib/bin.js），B=开发态（tsx 直跑 TS 源码）。 */
  launchForm: "compiled" | "dev" | null;
  cmdline: string | null;
  /** 同一时刻发现的多个服务进程（重复启动是常见故障）。 */
  duplicates: ProcInfo[];
  health: HealthCheck | null;
  profileDir: string;
  profileExists: boolean;
  locks: LockInfo[];
  residue: ProfileResidue[];
  findings: Finding[];
  checkedAt: string;
}

/** 分层健康检查：先探进程，再探 HTTP。 */
export async function healthCheck(port: number): Promise<HealthCheck> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    return {
      reachable: true,
      status: res.status,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return {
      reachable: false,
      status: null,
      latencyMs: null,
      error: (e as Error).name === "AbortError" ? "请求超时（8 秒）" : (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 扫描 profile 目录里的 .lock 残留。
 *
 * 判据保守（与旧版一致）：读不出 PID 不动；持有者还活着不动。
 * 但"还活着"的判定必须靠【进程表查询】，不能靠发信号 ——
 * Windows 上 SIGCONT 不受支持且与进程是否存在无关，发信号探活会把死进程
 * 判成活的（详见 host/process.ts 的说明）。S1 阶段只报告不修改。
 *
 * 额外识别【PID 复用】：锁里的 PID 存在、但已经不是 node 进程了，
 * 说明原进程早已消失、这个号被系统分给了别人，锁同样是废的。
 */
export async function scanLocks(profileDir: string): Promise<LockInfo[]> {
  const out: LockInfo[] = [];
  const candidates: string[] = [];
  for (const e of listDir(profileDir)) {
    if (e.dir || !/\.lock(\.|$)/.test(e.name)) continue;
    // 已经被处理过的锁：旧版清理动作会把 X.lock 改名为 X.lock.stale-<时间戳>
    // （只改名不删除，保留证据）。这类文件【不是活跃锁】，必须排除，
    // 否则会把它当成"又发现一个僵尸锁"重复报警，而它其实早就修好了。
    if (/\.stale-\d+$/.test(e.name)) continue;
    candidates.push(p(profileDir, e.name));
  }
  for (const nm of ["package.json.lock", "cordis.lock", "dsh.lock"]) {
    const full = p(profileDir, nm);
    if (isFile(full) && !candidates.includes(full)) candidates.push(full);
  }
  if (candidates.length === 0) return out;

  const live = await liveProcesses();

  for (const file of candidates) {
    let raw = "";
    let size = 0;
    try {
      raw = Deno.readTextFileSync(file).trim();
      size = Deno.statSync(file).size;
    } catch { /* 读不到就当不可读 */ }

    const pidMatch = /^\d+$/.test(raw)
      ? Number(raw)
      : (/pid[=:\s]+(\d+)/i.exec(raw)?.[1] ? Number(/pid[=:\s]+(\d+)/i.exec(raw)![1]) : null);

    if (pidMatch === null) {
      out.push({
        file,
        pid: null,
        alive: false,
        holderName: null,
        sizeBytes: size,
        verdict: "unreadable",
        note: "无法从锁文件读出持有者 PID，按保守原则不判定为僵尸",
      });
      continue;
    }

    if (!live.has(pidMatch)) {
      out.push({
        file,
        pid: pidMatch,
        alive: false,
        holderName: null,
        sizeBytes: size,
        verdict: "stale",
        note: `持有者 PID ${pidMatch} 已不存在（写入会一直超时）`,
      });
      continue;
    }

    const holderName = live.get(pidMatch) ?? "";
    if (looksLikeNodeProcess(holderName)) {
      out.push({
        file,
        pid: pidMatch,
        alive: true,
        holderName,
        sizeBytes: size,
        verdict: "keep",
        note: `持有者 PID ${pidMatch}（${holderName}）仍在运行`,
      });
    } else {
      out.push({
        file,
        pid: pidMatch,
        alive: true,
        holderName,
        sizeBytes: size,
        verdict: "recycled",
        note: `PID ${pidMatch} 已被 ${holderName} 占用 —— 原来的进程早已消失，这个号被系统回收复用，锁同样是废的`,
      });
    }
  }
  return out;
}

/** profile 目录残留物台账（只统计，不清理）。 */
/**
 * profile 目录残留备份台账（只统计，不清理）。
 *
 * 体积统计走 dirSizeBudgeted（带时间预算与缓存）：本机 .updater_backups 有
 * 20671 个文件，完整统计要 2.7 秒，而这里只是个提示条目 —— 绝不能让一个
 * 展示用的数字把整个状态页拖慢几秒。预算用尽就标 sizeComplete=false，
 * 界面显示成「≥ x MB」，宁可说"至少"也不假装精确。
 * 各目录共享一个总预算，避免备份目录很多时总耗时线性膨胀。
 */
export function scanProfileResidue(profileDir: string, totalBudgetMs = 250): ProfileResidue[] {
  const KINDS: Array<{ pattern: RegExp; kind: string }> = [
    { pattern: /^\.updater_backups$/, kind: "管家历史备份" },
    { pattern: /^\.cleanup_backup_/, kind: "清理备份" },
    { pattern: /^\.dual_lock_backup$/, kind: "双锁备份" },
    { pattern: /^\.abandoned_tgz_backup$/, kind: "废弃安装包备份" },
    { pattern: /^\.removed-plugins-/, kind: "已移除插件备份" },
    { pattern: /^package\.json\.bak/, kind: "清单备份文件" },
    { pattern: /\.stale-\d+$/, kind: "僵尸锁改名残留" },
  ];

  const deadline = Date.now() + totalBudgetMs;
  const out: ProfileResidue[] = [];

  for (const e of listDir(profileDir)) {
    const hit = KINDS.find((k) => k.pattern.test(e.name));
    if (!hit) continue;

    let bytes = e.size;
    let complete = true;
    if (e.dir) {
      const remain = Math.max(0, deadline - Date.now());
      if (remain <= 20) {
        // 总预算已用完：不再走目录，体积留空并标记未统计
        bytes = 0;
        complete = false;
      } else {
        const r = dirSizeBudgeted(p(profileDir, e.name), Math.min(120, remain));
        bytes = r.bytes;
        complete = r.complete;
      }
    }

    const existing = out.find((r) => r.kind === hit.kind);
    if (existing) {
      existing.count++;
      existing.sizeBytes += bytes;
      existing.sizeComplete = existing.sizeComplete && complete;
    } else {
      out.push({ name: e.name, kind: hit.kind, sizeBytes: bytes, sizeComplete: complete, count: 1 });
    }
  }
  return out.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

export async function collectRuntimeStatus(): Promise<RuntimeStatus> {
  const findings: Finding[] = [];
  const checkedAt = new Date().toISOString();
  const profileDir = dshProfileDir();
  const profileExists = isDir(profileDir);

  const procs = await listDshProcesses();
  const primary = procs[0] ?? null;
  const duplicates = procs.slice(1);

  let port = primary?.port ?? null;
  if (port === null) {
    for (const c of DSH_PORT_CANDIDATES) {
      const st = await describePort(c);
      if (!st.free && st.isDsh) {
        port = c;
        break;
      }
    }
  }

  const launchForm = primary
    ? primary.cmdline.includes("src/bin.ts")
      ? "dev"
      : primary.cmdline.includes("bin.js")
      ? "compiled"
      : null
    : null;

  if (duplicates.length > 0) {
    findings.push(
      finding("runtime.duplicate-processes", "warn", `检测到 ${procs.length} 个 DSH 服务进程`, {
        cause: "可能有多次启动没有正确结束（旧版常见：重复点启动 / 端口冲突后换了端口再起一个）",
        impact: "插件树可能被两个进程同时改写，出现「改了不生效」或莫名冲突",
        action: "保留一个所需端口上的进程，结束其余进程后重启服务",
        evidence: procs.map((x) => `PID ${x.pid} · 端口 ${x.port ?? "?"} · ${x.cmdline.slice(0, 120)}`),
      }),
    );
  }

  let health: HealthCheck | null = null;
  if (primary && port !== null) {
    health = await healthCheck(port);
    if (!health.reachable) {
      findings.push(
        finding("runtime.unhealthy", "error", "服务进程存在但无法访问", {
          cause: health.error ?? `无法连接 127.0.0.1:${port}`,
          impact: "界面打不开，插件与设置都无法使用",
          action: "查看启动日志定位错误，或重启服务",
          fixAction: "runtime.diagnose",
          evidence: [`PID ${primary.pid}`, `端口 ${port}`, health.error ?? ""],
        }),
      );
    }
  }

  const locks = profileExists ? await scanLocks(profileDir) : [];
  const badLocks = locks.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
  if (badLocks.length > 0) {
    const staleCount = badLocks.filter((l) => l.verdict === "stale").length;
    const recycledCount = badLocks.filter((l) => l.verdict === "recycled").length;
    findings.push(
      finding("runtime.stale-lock", "warn", `发现 ${badLocks.length} 个失效写锁`, {
        cause: [
          staleCount > 0 ? `${staleCount} 个的持有者进程已不存在` : "",
          recycledCount > 0 ? `${recycledCount} 个的 PID 已被别的程序复用（原进程也早没了）` : "",
          "通常是程序被强行结束（断电 / 任务管理器结束进程 / 崩溃）时留下的占用标记",
        ].filter(Boolean).join("；"),
        impact: "之后所有配置写入都会排队等待然后超时，界面只会反复提示「保存失败，请重试」",
        action: "清理这些失效锁（只改名不删除，保留证据）",
        fixAction: "runtime.repair",
        evidence: badLocks.map((l) => `${l.file} — ${l.note}`),
      }),
    );
  }

  const residue = profileExists ? scanProfileResidue(profileDir) : [];
  const residueTotal = residue.reduce((s, r) => s + r.sizeBytes, 0);
  // 触发条件用【存在残留】而不是【体积超阈值】：
  // 体积要走目录统计、可能因预算用尽而不准；拿它当触发条件的话，
  // 一旦没算完就会漏报。体积只作为补充说明。
  if (residue.length > 0) {
    const anyIncomplete = residue.some((r) => !r.sizeComplete);
    // 未统计完就只能说"至少"；统计完了才可以说"约"
    const totalLabel = anyIncomplete
      ? `至少 ${humanSize(residueTotal)}`
      : `约 ${humanSize(residueTotal)}`;
    findings.push(
      finding(
        "runtime.profile-residue",
        residueTotal > 200 * 1024 * 1024 ? "warn" : "info",
        `profile 目录里有 ${residue.length} 类历史备份（${totalLabel}）`,
        {
          cause:
            "历史清理动作留下的备份目录（旧版策略是只移动不删除，所以越积越多）—— 这些是当时有意保留的，不是意外产生的垃圾",
          impact: "占用磁盘空间；极端情况下残留包会被误当成模块参与打包，导致构建失败",
          action: "确认无需回退后，清理这些备份",
          evidence: residue.map((r) =>
            `${r.kind} × ${r.count}（${r.sizeComplete ? "" : "≥ "}${humanSize(r.sizeBytes)}）`
          ),
        },
      ),
    );
  }

  return {
    running: procs.length > 0,
    pid: primary?.pid ?? null,
    port,
    launchForm,
    cmdline: primary?.cmdline ?? null,
    duplicates,
    health,
    profileDir,
    profileExists,
    locks,
    residue,
    findings,
    checkedAt,
  };
}

export const runtimeStatusAction: ActionDef<Record<string, never>, RuntimeStatus> = {
  name: "runtime.status",
  domain: "runtime",
  title: "服务状态检查",
  description: "检测 DSH 服务进程、端口、健康状态，并扫描僵尸锁与 profile 残留物。只读。",
  readonly: true,
  steps: ["识别服务进程", "探测服务端口", "健康检查", "扫描僵尸锁与残留物", "汇总"],
  run: async (ctx): Promise<RuntimeStatus> => {
    ctx.step("s1", "识别服务进程");
    ctx.progress(0.2);
    const status = await collectRuntimeStatus();
    ctx.detail(status.running ? `运行中（PID ${status.pid}，端口 ${status.port ?? "未知"}）` : "未运行");
    ctx.throwIfCancelled();

    ctx.step("s2", "探测服务端口");
    ctx.progress(0.4);
    ctx.detail(status.port ? `服务端口 ${status.port}` : "未发现监听端口");
    ctx.throwIfCancelled();

    ctx.step("s3", "健康检查");
    ctx.progress(0.6);
    ctx.detail(
      status.health
        ? status.health.reachable
          ? `可访问（HTTP ${status.health.status}，${status.health.latencyMs}ms）`
          : `不可访问：${status.health.error}`
        : "服务未运行，跳过",
    );
    ctx.throwIfCancelled();

    ctx.step("s4", "扫描僵尸锁与残留物");
    ctx.progress(0.85);
    ctx.detail(
      `${status.locks.length} 个锁文件（其中 ${status.locks.filter((l) => l.verdict === "stale").length} 个疑似僵尸）· ` +
        `${status.residue.length} 类残留备份`,
    );
    ctx.progress(1);
    return status;
  },
};
