/**
 * bootstrap.plan —— 「一键部署」的计划段。
 *
 * 【铁律】plan 永远零副作用：只看、不写、不改。AC-B2 要求连跑 100 次不产生任何文件变更，
 * 所以这里刻意【不用】collectEnv()——它会顺手把探测到的 DSH 根目录写进 ~/.dsh/web-dir 缓存。
 * 计划阶段只调 systemInfo / probeRuntimes / diskSpace 这类纯读能力。
 *
 * 计划的产物是「给人看 + 给机器用」的一份东西：
 *   - steps：这一步要干什么、现在是能直接做、还是需要先做点什么、还是被挡住了；
 *   - estimates：要下多少、占多少盘、大概几分钟（方案 §6.5 的口径）；
 *   - blockers：error 级的阻碍项，带四要素（原因 / 影响 / 建议 / 一键入口）。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { diskSpace, humanSize, platformLabel, systemInfo } from "../../host/mod.ts";
import { checkWritable } from "../../host/privileges.ts";
import { isDir } from "../../host/fs.ts";
import { dirname, homeDir, normalize, p, resolveDshSourceRoot } from "../../util/paths.ts";
import { probeRuntimes, type RuntimeProbe } from "../env/probe.ts";
import { readBootstrapJournal } from "./journal.ts";

/** 计划里每一步当前的状态。 */
export type PlanStepStatus =
  /** 直接可执行。 */
  | "ready"
  /** 可执行，但会顺带做一件事（例如"pnpm 没装，将用 npm 装上"）。 */
  | "action"
  /** 被挡住了，先解决 blockers。 */
  | "blocked";

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  status: PlanStepStatus;
  estimateMs?: number;
  downloadBytes?: number;
}

export interface BootstrapPlan {
  generatedAt: string;
  /** 打算装到哪里（也是 git clone 的落点）。 */
  targetRoot: string;
  targetExists: boolean;
  /** 本机已经有的 DSH 本体（有的话就不该再"从零装"）。 */
  installed: { path: string; discoveredBy: string } | null;
  system: {
    platform: string;
    arch: string;
    osVersion: string;
    cpuModel: string;
    cpuCount: number;
    memTotalBytes: number;
    memFreeBytes: number;
  };
  runtime: RuntimeProbe[];
  disk: { path: string; freeBytes: number; totalBytes: number } | null;
  steps: PlanStep[];
  estimates: {
    downloadBytes: number;
    diskBytes: number;
    minutesMin: number;
    minutesMax: number;
  };
  /** error 级阻碍（有它就别动手）。 */
  blockers: Finding[];
  /** 上次没跑完的部署（崩溃恢复用）。 */
  interrupted: { startedAt: string; step: string } | null;
  verdict: "blocked" | "needs-setup" | "ready" | "already-installed";
}

// ── 估算口径（方案 §6.5 的实测值；AC-B2 允许 40% 误差，这里留了余量） ──

const MB = 1024 * 1024;
export const BOOTSTRAP_ESTIMATES = {
  /** git clone --depth 1：约 480 MB。 */
  cloneDownloadBytes: 480 * MB,
  /** pnpm install：约 1.1 GB。 */
  depsDownloadBytes: 1100 * MB,
  /** 落地占用（源码 + node_modules + 构建产物）。 */
  diskBytes: 3500 * MB,
  /** 各步耗时区间（毫秒）。 */
  cloneMs: [120_000, 300_000] as const,
  depsMs: [180_000, 420_000] as const,
  buildMs: [180_000, 600_000] as const,
  startMs: [5_000, 30_000] as const,
  /** 官方仓库地址（用户可用 params.url 覆盖，例如走内网镜像）。 */
  repoUrl: "https://github.com/deepseek-ai/deepseek-harness.git",
} as const;

/** 目标目录最近的已存在祖先 —— 目录还不存在时，写权限要按它的父级判。 */
function nearestExisting(path: string): string {
  let cur = normalize(path);
  for (let i = 0; i < 12; i++) {
    if (isDir(cur)) return cur;
    const parent = dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return cur;
}

function minutes(ms: number): number {
  return Math.round(ms / 60_000);
}

export interface BootstrapPlanParams {
  /** 自定义安装目录；默认 ~/DeepSeek_Harness 或已发现的本体路径。 */
  root?: string;
  /** 自定义仓库地址（内网镜像）。 */
  url?: string;
}

export async function collectBootstrapPlan(
  params: BootstrapPlanParams = {},
): Promise<BootstrapPlan> {
  const generatedAt = new Date().toISOString();

  // 只读探测：resolveDshSourceRoot() 不写缓存（写缓存的 rememberDshRoot 由 env.probe 调用）
  const existing = resolveDshSourceRoot();
  const targetRoot = normalize(
    (params.root && params.root.trim()) || existing?.path || p(homeDir(), "DeepSeek_Harness"),
  );
  const targetExists = isDir(targetRoot);

  const writeProbeDir = nearestExisting(targetRoot);
  const [sys, runtime, disk] = await Promise.all([
    systemInfo(),
    probeRuntimes(),
    diskSpace(targetRoot),
  ]);
  const writes = checkWritable([writeProbeDir]);
  const writable = writes[0];

  const blockers: Finding[] = [];
  const has = (name: string): RuntimeProbe | undefined => runtime.find((r) => r.name === name);
  const git = has("git");
  const node = has("node");
  const pnpm = has("pnpm");
  const npm = has("npm");

  if (!git?.found) {
    blockers.push(
      finding("bootstrap.no-git", "error", "缺少 Git，无法拉取 DSH 源码", {
        cause: "在系统 PATH 中找不到 git",
        impact: "第 3 步「获取源码」无法执行，部署根本开不了头",
        action: "到 git-scm.com 下载安装，或执行 winget install Git.Git，装完重开管家再试",
      }),
    );
  }
  if (!node?.found) {
    blockers.push(
      finding("bootstrap.no-node", "error", "缺少 Node.js，无法安装依赖与构建", {
        cause: "在系统 PATH 中找不到 node",
        impact: "依赖安装与全量构建都跑不起来",
        action:
          "到 nodejs.org 下载 LTS（要求 22.19 以上或 24 以上），或用 winget install OpenJS.NodeJS.LTS",
      }),
    );
  } else {
    const major = Number(/^v?(\d+)/.exec(node.version ?? "")?.[1] ?? 0);
    if (major > 0 && major < 22) {
      blockers.push(
        finding("bootstrap.node-old", "error", `Node.js 版本偏低（${node.version}）`, {
          cause: "DSH 0.1.7 要求 node ^22.19.0 || >=24.0.0",
          impact: "依赖安装或构建可能直接失败",
          action: "升级到 Node.js 22 LTS 或更高版本",
          evidence: [node.path ?? "", node.version ?? ""],
        }),
      );
    }
  }
  if (!pnpm?.found && !npm?.found) {
    blockers.push(
      finding("bootstrap.no-pkg-manager", "error", "既没有 pnpm 也没有 npm，装不了依赖", {
        cause: "PATH 中 pnpm 与 npm 都找不到",
        impact: "第 4 步「安装依赖」无法执行",
        action: "先装 Node.js（自带 npm），再用 npm install -g pnpm 装 pnpm",
      }),
    );
  }
  if (disk && disk.freeBytes < BOOTSTRAP_ESTIMATES.diskBytes) {
    blockers.push(
      finding(
        "bootstrap.no-disk",
        "error",
        `目标盘可用空间不足（${humanSize(disk.freeBytes)}）`,
        {
          cause: `安装到 ${targetRoot} 预计需要 ${humanSize(BOOTSTRAP_ESTIMATES.diskBytes)}`,
          impact: "依赖装到一半磁盘写满，会留下半成品目录",
          action: "换一个空间充足的盘（安装目录可在计划页里改），或先清理磁盘",
          evidence: [targetRoot, `可用 ${humanSize(disk.freeBytes)}`],
        },
      ),
    );
  }
  if (!writable?.writable) {
    blockers.push(
      finding("bootstrap.not-writable", "error", `目标位置不可写：${writeProbeDir}`, {
        cause: writable?.error ?? "写权限检查未通过",
        impact: "无法创建安装目录",
        action: "换一个可写目录（例如用户目录下的路径），或以管理员身份重启管家",
        evidence: [writeProbeDir],
      }),
    );
  }
  if (existing && normalize(existing.path) === targetRoot) {
    // 已经装过：不该走"从零装"这条链路
    blockers.push(
      finding("bootstrap.already-installed", "error", "这台机器已经装过 DSH 本体", {
        cause: `在 ${existing.path} 发现了 DSH 源码树（apps/cli）`,
        impact: "再跑一次「一键部署」会覆盖现有安装",
        action: "日常更新请用「DSH 本体 → 更新本体」；确实要重装，请在计划里勾选强制重装",
        fixAction: "core.update",
        evidence: [existing.path],
      }),
    );
  }

  // 「已经装过」是"别从零装"的结论，不是"这一步做不了" —— 它不该把每一步都标成被挡住
  const hardBlocked = blockers.some((b) => b.id !== "bootstrap.already-installed");
  const cloneEst = BOOTSTRAP_ESTIMATES;
  const steps: PlanStep[] = [
    {
      id: "check",
      title: "系统与运行时检查",
      detail: `${platformLabel()} ${sys.arch} · ${sys.cpuCount} 核 · 可用内存 ${
        humanSize(sys.memFreeBytes)
      }`,
      status: hardBlocked ? "blocked" : "ready",
      estimateMs: 1_000,
    },
    {
      id: "runtime",
      title: pnpm?.found ? "准备运行时" : "安装 pnpm 并准备运行时",
      detail: pnpm?.found
        ? `node ${node?.version ?? "?"} · pnpm ${pnpm.version ?? "?"} · git ${git?.version ?? "?"}`
        : `pnpm 缺失，将用 npm 执行 npm install -g pnpm`,
      status: blockers.some((b) => b.id.startsWith("bootstrap.no-pkg"))
        ? "blocked"
        : pnpm?.found
        ? "ready"
        : "action",
      estimateMs: pnpm?.found ? 0 : 60_000,
      downloadBytes: pnpm?.found ? 0 : 10 * MB,
    },
    {
      id: "fetch",
      title: "拉取 DSH 源码",
      detail: `${params.url ?? cloneEst.repoUrl} → ${targetRoot}（浅克隆，约 480 MB）`,
      status: git?.found ? "ready" : "blocked",
      estimateMs: cloneEst.cloneMs[1],
      downloadBytes: cloneEst.cloneDownloadBytes,
    },
    {
      id: "deps",
      title: "安装依赖",
      detail: "pnpm install（约 1.1 GB，首次最慢）",
      status: pnpm?.found || npm?.found ? "ready" : "blocked",
      estimateMs: cloneEst.depsMs[1],
      downloadBytes: cloneEst.depsDownloadBytes,
    },
    {
      id: "build",
      title: "全量构建",
      detail: "pnpm run build：原生组件 + 主进程 + 界面模块 + 网页外壳，并写入构建记录",
      status: node?.found ? "ready" : "blocked",
      estimateMs: cloneEst.buildMs[1],
    },
    {
      id: "verify",
      title: "核对构建产物",
      detail: "走 DSH 官方校验：产物文件数与构建记录对得上才算成",
      status: node?.found ? "ready" : "blocked",
      estimateMs: 60_000,
    },
    {
      id: "start",
      title: "启动 DSH 服务",
      detail: "后台起服务并等它真的能响应 HTTP",
      status: "ready",
      estimateMs: cloneEst.startMs[1],
    },
    {
      id: "final",
      title: "部署后三连验证",
      detail: "构建记录一致性 / 插件名单无异常 / 健康检查通过",
      status: "ready",
      estimateMs: 20_000,
    },
  ];

  const downloadBytes = steps.reduce((a, s) => a + (s.downloadBytes ?? 0), 0);
  const totalMs = steps.reduce((a, s) => a + (s.estimateMs ?? 0), 0);

  return {
    generatedAt,
    targetRoot,
    targetExists,
    installed: existing ? { path: existing.path, discoveredBy: existing.source } : null,
    system: {
      platform: platformLabel(),
      arch: sys.arch,
      osVersion: sys.osVersion,
      cpuModel: sys.cpuModel,
      cpuCount: sys.cpuCount,
      memTotalBytes: sys.memTotalBytes,
      memFreeBytes: sys.memFreeBytes,
    },
    runtime,
    disk,
    steps,
    estimates: {
      downloadBytes,
      diskBytes: cloneEst.diskBytes,
      minutesMin: Math.max(1, minutes(totalMs * 0.6)),
      minutesMax: minutes(totalMs * 1.3),
    },
    blockers,
    // 上次没跑完的部署（读台账，只读不改；AC-B3 的「继续 / 回滚」就靠它）
    interrupted: (() => {
      const j = readBootstrapJournal();
      return j && j.root === targetRoot ? { startedAt: j.startedAt, step: j.stepTitle } : null;
    })(),
    verdict: hardBlocked
      ? "blocked"
      : blockers.some((b) => b.id === "bootstrap.already-installed")
      ? "already-installed"
      : pnpm?.found
      ? "ready"
      : "needs-setup",
  };
}

export const bootstrapPlanAction: ActionDef<BootstrapPlanParams, BootstrapPlan> = {
  name: "bootstrap.plan",
  domain: "bootstrap",
  title: "一键部署计划",
  description:
    "零副作用：检查系统、运行时、磁盘与目标目录，给出完整步骤表与体积/耗时预估。任何东西都不会被改动。",
  readonly: true,
  steps: ["系统与运行时检查", "磁盘与权限检查", "汇总计划"],
  run: async (ctx, params): Promise<BootstrapPlan> => {
    ctx.step("s1", "系统与运行时检查");
    ctx.progress(0.3);
    const plan = await collectBootstrapPlan(params ?? {});
    ctx.step("s2", "磁盘与权限检查");
    ctx.progress(0.7);
    ctx.detail(
      plan.blockers.length > 0
        ? `${plan.blockers.length} 项阻碍`
        : `共 ${plan.steps.length} 步 · 预计 ${plan.estimates.minutesMin}-${plan.estimates.minutesMax} 分钟`,
    );
    ctx.step("s3", "汇总计划");
    ctx.progress(1);
    return plan;
  },
};
