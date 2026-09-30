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
import { TOOL_SPECS, TOOL_VERSIONS, type ToolName } from "../env/toolchain.ts";
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

  /*
   * 【2026-09-29 的关键改动：缺运行时不再当"阻障"，而是当"待办"】
   * 过去的写法是：缺 Git / Node / pnpm 就往 blockers 里塞三条 error，界面显示三个红叉，
   * 建议全是"请自行到官网下载安装" —— 那就不叫一键部署（昊天原话）。
   * 现在管家能自己把这三个装进内置工具链（env/toolchain.ts），所以它们降级成
   * 计划里一个 status="action" 的步骤：点下去管家自己会办好。
   * 只有"管家办不了"的事才配留在 blockers 里：磁盘不够、目录不可写、已装过。
   */
  const autoTools: ToolName[] = [];
  if (!git?.found) autoTools.push("git");
  if (!node?.found) autoTools.push("node");
  // pnpm 由内置 npm 安装，node 缺失时它自然也在待办里
  if (!pnpm?.found) autoTools.push("pnpm");
  const autoBytes = autoTools.reduce((a, n) => a + TOOL_SPECS[n].sizeBytes, 0);

  // Node 版本偏低：这台机器上的 Node 跑不动 DSH，但仍可自动解决（改用内置版）
  if (node?.found) {
    const major = Number(/^v?(\d+)/.exec(node.version ?? "")?.[1] ?? 0);
    if (major > 0 && major < 22) {
      blockers.push(
        finding("bootstrap.node-old", "error", `Node.js 版本偏低（${node.version}）`, {
          cause: "DSH 0.1.7 要求 node ^22.19.0 || >=24.0.0",
          impact: "依赖安装或构建可能直接失败",
          action: `用「一键获取运行环境」装一个内置的 Node.js ${TOOL_VERSIONS.node}（与系统版互不影响）`,
          fixAction: "env.toolchain-install",
          evidence: [node.path ?? "", node.version ?? ""],
        }),
      );
    }
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
  const runtimeDetail = autoTools.length === 0
    ? `node ${node?.version ?? "?"} · pnpm ${pnpm?.version ?? "?"} · git ${git?.version ?? "?"}`
    : `将自动获取：${
      autoTools.map((n) => `${TOOL_SPECS[n].label} ${TOOL_VERSIONS[n]}`).join(" / ")
    }（免安装版，装进管家目录，不改系统环境）`;
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
      title: autoTools.length > 0 ? "自动获取运行环境" : "准备运行时",
      detail: runtimeDetail,
      status: hardBlocked
        ? "blocked"
        : autoTools.length > 0
        ? "action"
        : "ready",
      // 下载耗时按体积粗估（约 1.5 MB/s 保守值），解压再算 20 秒
      estimateMs: autoTools.length > 0
        ? Math.round((autoBytes / (1.5 * MB)) * 1000) + 20_000
        : 0,
      downloadBytes: autoBytes,
    },
    {
      id: "fetch",
      title: "拉取 DSH 源码",
      detail: `${params.url ?? cloneEst.repoUrl} → ${targetRoot}（浅克隆，约 480 MB）`,
      status: hardBlocked ? "blocked" : git?.found ? "ready" : "action",
      estimateMs: cloneEst.cloneMs[1],
      downloadBytes: cloneEst.cloneDownloadBytes,
    },
    {
      id: "deps",
      title: "安装依赖",
      detail: "pnpm install（约 1.1 GB，首次最慢）",
      status: hardBlocked ? "blocked" : pnpm?.found || npm?.found ? "ready" : "action",
      estimateMs: cloneEst.depsMs[1],
      downloadBytes: cloneEst.depsDownloadBytes,
    },
    {
      id: "build",
      title: "全量构建",
      detail: "pnpm run build：原生组件 + 主进程 + 界面模块 + 网页外壳，并写入构建记录",
      status: hardBlocked ? "blocked" : node?.found ? "ready" : "action",
      estimateMs: cloneEst.buildMs[1],
    },
    {
      id: "verify",
      title: "核对构建产物",
      detail: "走 DSH 官方校验：产物文件数与构建记录对得上才算成",
      status: hardBlocked ? "blocked" : node?.found ? "ready" : "action",
      estimateMs: 60_000,
    },
    {
      id: "start",
      title: "启动 DSH 服务",
      detail: "后台起服务并等它真的能响应 HTTP",
      status: hardBlocked ? "blocked" : "ready",
      estimateMs: cloneEst.startMs[1],
    },
    {
      id: "final",
      title: "部署后三连验证",
      detail: "构建记录一致性 / 插件名单无异常 / 健康检查通过",
      status: hardBlocked ? "blocked" : "ready",
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
      : autoTools.length > 0
      ? "needs-setup"
      : "ready",
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
