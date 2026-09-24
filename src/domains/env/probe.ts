/**
 * env.probe —— 环境全量体检（只读，零副作用）。
 *
 * 这是 S1 的第一块能力：把「这台机器现在是什么状况」一次性讲清楚。
 * 产出既给人看（界面/报告），也给机器用（findings 驱动修复向导）。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { type Finding, finding, ok } from "../../util/result.ts";
import { diskSpace, platformLabel, systemInfo } from "../../host/mod.ts";
import { locate, versionAt } from "../../host/shell.ts";
import { fsx } from "../../host/mod.ts";
import { checkWritable, elevationStatus } from "../../host/privileges.ts";
import { describePort } from "../../host/port.ts";
import {
  butlerLogsDir,
  butlerRoot,
  dshLogsDir,
  dshProfileDir,
  dshRoot,
  dshSessionsDir,
  legacyConfigPath,
  quarantineRootFor,
  rememberDshRoot,
  resolveDshSourceRoot,
  sameVolume,
} from "../../util/paths.ts";
import { DSH_PORT_CANDIDATES } from "../../version.ts";

export interface RuntimeProbe {
  name: string;
  /** 展示名。 */
  label: string;
  found: boolean;
  path: string | null;
  version: string | null;
  required: boolean;
  /** 缺失时的建议。 */
  hint?: string;
}

export interface EnvReport {
  probedAt: string;
  durationMs: number;
  system: {
    platform: string;
    osVersion: string;
    arch: string;
    hostname: string;
    cpuModel: string;
    cpuCount: number;
    memTotalBytes: number;
    memFreeBytes: number;
    user: string;
  };
  runtime: RuntimeProbe[];
  dsh: {
    sourceRoot: string | null;
    discoveredBy: string | null;
    profileDir: string;
    profileExists: boolean;
    /** 隔离区位置与其是否与本体同盘（必须为 true）。 */
    quarantineDir: string | null;
    quarantineSameVolume: boolean;
  };
  paths: {
    home: string;
    dshRoot: string;
    butlerRoot: string;
    legacyConfig: string;
    legacyConfigExists: boolean;
    logsDir: string;
    sessionsDir: string;
  };
  writable: Array<{ path: string; label: string; writable: boolean; error?: string }>;
  elevation: { elevated: boolean; hint?: string };
  disk: { path: string; freeBytes: number; totalBytes: number } | null;
  ports: Array<{ port: number; free: boolean; isDsh: boolean; owners: string[] }>;
  findings: Finding[];
}

/** 需要探测的运行时。pnpm/git 仅在 DSH 采用源码版时才必需。 */
const RUNTIMES: Array<Omit<RuntimeProbe, "found" | "path" | "version">> = [
  {
    name: "node",
    label: "Node.js",
    required: true,
    hint:
      "DSH 本体需要 Node.js 运行。可到 nodejs.org 下载 LTS 版本，或用 winget install OpenJS.NodeJS.LTS 安装。",
  },
  {
    name: "pnpm",
    label: "pnpm",
    required: true,
    hint:
      "DSH 源码版用 pnpm 管理依赖。安装命令：npm install -g pnpm（或用 corepack enable pnpm）。",
  },
  {
    name: "git",
    label: "Git",
    required: true,
    hint: "更新 DSH 本体源码需要 Git。下载：git-scm.com 或用 winget install Git.Git 安装。",
  },
  {
    name: "npm",
    label: "npm",
    required: false,
    hint: "npm 通常随 Node.js 一起安装，缺失时 pnpm 的安装会受影响。",
  },
];

export async function collectEnv(): Promise<EnvReport> {
  const started = Date.now();
  const findings: Finding[] = [];

  // 这几件事彼此完全独立，必须并行等 —— 串行做的话每一项都要等子进程启动，
  // 加起来就是十几秒（实测改造前 9.9 秒，改造后约 2 秒）。
  const dshProbe = resolveDshSourceRoot();
  const [sys, runtime, elevation] = await Promise.all([
    systemInfo(),
    probeRuntimes(),
    elevationStatus(),
  ]);

  for (const r of runtime) {
    if (r.found) continue;
    if (r.required) {
      findings.push(
        finding(`env.missing-${r.name}`, "error", `缺少 ${r.label}`, {
          cause: `在系统 PATH 中找不到 ${r.name}`,
          impact: "DSH 无法安装或更新",
          action: r.hint ?? `请先安装 ${r.label}`,
          evidence: [`where ${r.name} 无结果`],
        }),
      );
    } else {
      findings.push(
        finding(`env.missing-${r.name}`, "warn", `未检测到 ${r.label}`, {
          cause: `在系统 PATH 中找不到 ${r.name}`,
          impact: "部分依赖安装操作可能受影响",
          action: r.hint ?? `建议安装 ${r.label}`,
        }),
      );
    }
  }

  // Node 版本下限检查（DSH 0.1.7 要求较新的 Node）
  const node = runtime.find((r) => r.name === "node");
  const nodeMajor = node?.version ? Number(/^v?(\d+)/.exec(node.version)?.[1] ?? 0) : 0;
  if (node?.found && nodeMajor > 0 && nodeMajor < 20) {
    findings.push(
      finding("env.node-too-old", "warn", `Node.js 版本偏低（${node.version}）`, {
        cause: "DSH 当前版本基于较新的 Node 运行时开发",
        impact: "构建或运行可能出现兼容性问题",
        action: "升级到 Node.js 20 或更高版本（推荐 LTS）",
        evidence: [node.path ?? "", `检测到 ${node.version}`],
      }),
    );
  }

  // 3) DSH 目录（探测本身是同步的，上面已经并行取好）
  const probe = dshProbe;
  let quarantineDir: string | null = null;
  let quarantineSameVolume = true;
  if (probe) {
    rememberDshRoot(probe.path);
    quarantineDir = quarantineRootFor(probe.path);
    quarantineSameVolume = sameVolume(probe.path, quarantineDir);
  } else {
    findings.push(
      finding("env.dsh-not-found", "error", "未找到 DSH 本体源码目录", {
        cause: "在常见位置（用户目录、各盘根目录的 DeepSeek_Harness）都没有找到含 apps/cli 的目录",
        impact: "所有与 DSH 本体、插件相关的功能都无法使用",
        action: "使用「一键部署」从零安装 DSH，或在设置里手动指定 DSH 源码目录",
        fixAction: "bootstrap.plan",
        evidence: [
          "已尝试：DSH_WEB_DIR 环境变量、~/.dsh/web-dir 缓存、用户目录候选、盘符浅扫描",
        ],
      }),
    );
  }

  const profileDir = dshProfileDir();
  const profileExists = fsx.isDir(profileDir);
  if (probe && !profileExists) {
    findings.push(
      finding("env.profile-missing", "warn", "DSH profile 目录不存在", {
        cause: `未发现 ${profileDir}`,
        impact: "插件体系尚未初始化，插件列表会是空的",
        action: "启动一次 DSH 服务后会自动创建 profile 目录",
        evidence: [profileDir],
      }),
    );
  }

  // 4) 隔离区同盘校验（跨盘会导致清理静默失败，是历史上最恶心的坑之一）
  if (quarantineDir && !quarantineSameVolume) {
    findings.push(
      finding("env.quarantine-cross-volume", "error", "隔离区与 DSH 本体不在同一个盘", {
        cause: "隔离区应位于本体父目录下的 dsh-quarantine，但检测到跨盘",
        impact: "清理与回滚会整体失败且界面看不出异常",
        action: "请把 DSH 本体放在单一盘内（例如统一放到 D:\\DeepSeek_Harness）",
        evidence: [probe?.path ?? "", quarantineDir],
      }),
    );
  }

  // 5) 写权限
  const writeTargets: Array<{ path: string; label: string }> = [
    { path: butlerRoot(), label: "管家数据目录" },
    { path: butlerLogsDir(), label: "管家日志目录" },
  ];
  if (probe) {
    writeTargets.push({ path: probe.path, label: "DSH 本体目录" });
    writeTargets.push({ path: profileDir, label: "DSH profile 目录" });
  }
  const writeChecks = checkWritable(writeTargets.map((t) => t.path));
  const writable = writeChecks.map((c, i) => ({
    path: c.path,
    label: writeTargets[i]?.label ?? c.path,
    writable: c.writable,
    ...(c.error ? { error: c.error } : {}),
  }));
  for (const w of writable) {
    if (!w.writable) {
      findings.push(
        finding("env.dir-not-writable", "error", `${w.label}不可写`, {
          cause: w.error ?? "当前用户对该目录没有写权限，或目录被其它程序占用",
          impact: `涉及${w.label}的操作会中途失败`,
          action: "以管理员身份重新启动本程序，或把 DSH 装到用户目录下（如 D:\\DeepSeek_Harness）",
          evidence: [w.path],
        }),
      );
    }
  }

  // 6) 提权状态（已在上面的并行段取好）

  // 7) 端口（各候选端口彼此独立，并行探测）+ 磁盘
  const diskPath = probe?.path ?? butlerRoot();
  const [portStates, diskRaw] = await Promise.all([
    Promise.all(DSH_PORT_CANDIDATES.map((c) => describePort(c))),
    diskSpace(diskPath),
  ]);

  const ports: EnvReport["ports"] = [];
  for (let i = 0; i < DSH_PORT_CANDIDATES.length; i++) {
    const candidate = DSH_PORT_CANDIDATES[i] as number;
    const st = portStates[i];
    if (!st) continue;
    ports.push({
      port: candidate,
      free: st.free,
      isDsh: st.isDsh,
      owners: st.owners.map((o) => `${o.name} (PID ${o.pid})`),
    });
    if (!st.free && !st.isDsh) {
      findings.push(
        finding(`env.port-busy-${candidate}`, "warn", `端口 ${candidate} 被其它程序占用`, {
          cause: `占用者：${st.owners.map((o) => `${o.name}(PID ${o.pid})`).join("、") || "未知"}`,
          impact: "DSH 服务无法使用该端口启动（会自动改用其它端口，但访问地址会变）",
          action: "结束占用该端口的进程，或让 DSH 使用其它端口",
          evidence: st.owners.map((o) => o.cmdline).filter(Boolean),
        }),
      );
    }
  }

  // 8) 磁盘（已在上面并行取好）
  const disk = diskRaw
    ? { path: diskPath, freeBytes: diskRaw.freeBytes, totalBytes: diskRaw.totalBytes }
    : null;
  if (disk && disk.freeBytes < 5 * 1024 ** 3) {
    findings.push(
      finding("env.low-disk", "warn", "可用磁盘空间不足 5 GB", {
        cause: `所在磁盘剩余 ${(disk.freeBytes / 1024 ** 3).toFixed(1)} GB`,
        impact: "安装依赖与构建 DSH 本体时需要数 GB 空间，可能中途失败",
        action: `清理 ${diskPath} 所在磁盘的空间后重试`,
      }),
    );
  }

  const report: EnvReport = {
    probedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    system: {
      platform: platformLabel(),
      osVersion: sys.osVersion,
      arch: sys.arch,
      hostname: sys.hostname,
      cpuModel: sys.cpuModel,
      cpuCount: sys.cpuCount,
      memTotalBytes: sys.memTotalBytes,
      memFreeBytes: sys.memFreeBytes,
      user: sys.user,
    },
    runtime,
    dsh: {
      sourceRoot: probe?.path ?? null,
      discoveredBy: probe?.source ?? null,
      profileDir,
      profileExists,
      quarantineDir,
      quarantineSameVolume,
    },
    paths: {
      home: sys.user ? (Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? "") : "",
      dshRoot: dshRoot(),
      butlerRoot: butlerRoot(),
      legacyConfig: legacyConfigPath(),
      legacyConfigExists: fsx.isFile(legacyConfigPath()),
      logsDir: dshLogsDir(),
      sessionsDir: dshSessionsDir(),
    },
    writable,
    elevation,
    disk,
    ports,
    findings,
  };

  return report;
}

/**
 * 探测全部运行时（并行）。
 *
 * 【为什么要合并 locate 与取版本】
 * versionOf() 内部会自己再 locate 一次，而调用方已经 locate 过了 ——
 * 每个运行时因此要起 3 个子进程（where + where + --version）。
 * 这里 locate 一次、再用 versionAt 直接在已知路径上取版本，省掉一半。
 * 四个运行时再并行，总耗时≈最慢的那一个。
 */
/** 运行时探测（node / pnpm / git / npm）。bootstrap 复用它，保证两处口径一致。 */
export async function probeRuntimes(): Promise<RuntimeProbe[]> {
  return await Promise.all(
    RUNTIMES.map(async (r): Promise<RuntimeProbe> => {
      const path = await locate(r.name);
      const version = path ? await versionAt(path) : null;
      return { ...r, found: version !== null, path, version };
    }),
  );
}

export const envProbeAction: ActionDef<Record<string, never>, EnvReport> = {
  name: "env.probe",
  domain: "env",
  title: "环境体检",
  description:
    "检测系统、运行时、DSH 目录、权限、端口与磁盘状况，并汇总问题清单。只读，不修改任何东西。",
  readonly: true,
  steps: [
    "采集系统信息",
    "检查运行时（Node / pnpm / git）",
    "定位 DSH 本体目录",
    "检查目录写权限与提权状态",
    "检查端口占用",
    "汇总问题清单",
  ],
  run: async (ctx): Promise<EnvReport> => {
    ctx.step("s1", "采集系统信息");
    ctx.progress(0.1);
    const sys = await systemInfo();
    ctx.detail(
      `${platformLabel()} ${sys.arch} · ${sys.cpuCount} 核 · ${
        (sys.memTotalBytes / 1024 ** 3).toFixed(1)
      } GB 内存`,
    );
    ctx.throwIfCancelled();

    ctx.step("s2", "检查运行时");
    ctx.progress(0.25);
    const report = await collectEnv();
    const found = report.runtime.filter((r) => r.found).map((r) => r.label).join(" / ");
    ctx.detail(found ? `已就绪：${found}` : "未检测到任何运行时");
    ctx.throwIfCancelled();

    ctx.step("s3", "定位 DSH 本体目录");
    ctx.progress(0.5);
    ctx.detail(report.dsh.sourceRoot ? `已找到：${report.dsh.sourceRoot}` : "未找到");
    ctx.throwIfCancelled();

    ctx.step("s4", "检查权限与提权状态");
    ctx.progress(0.65);
    const unwritable = report.writable.filter((w) => !w.writable);
    ctx.detail(
      unwritable.length === 0 ? "所有关键目录均可写" : `${unwritable.length} 个目录不可写`,
    );
    ctx.throwIfCancelled();

    ctx.step("s5", "检查端口占用");
    ctx.progress(0.8);
    ctx.detail(
      report.ports.map((p) => `${p.port}${p.free ? "空闲" : p.isDsh ? "(DSH)" : "(占用)"}`).join(
        " · ",
      ),
    );
    ctx.throwIfCancelled();

    ctx.step("s6", "汇总问题清单");
    ctx.progress(0.95);
    const errors = report.findings.filter((f) => f.severity === "error").length;
    const warns = report.findings.filter((f) => f.severity === "warn").length;
    ctx.detail(`发现 ${errors} 项错误、${warns} 项警告`);
    ctx.progress(1);

    return report;
  },
};

/** 供其它模块复用的轻量包装。 */
export async function quickEnv(): Promise<{ ok: ReturnType<typeof ok>; report: EnvReport }> {
  const report = await collectEnv();
  return { ok: ok(report), report };
}
