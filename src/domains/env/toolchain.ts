/**
 * env.toolchain —— 「能内置的就内置」：把 DSH 干活要用的运行时装进管家自己的目录。
 *
 * 【为什么必须有这个模块】（2026-09-29 昊天实测反馈）
 * 过去「一键部署」只做"检查"：探测不到 Git / Node / pnpm，就把用户挡在门外，
 * 让他自己去 git-scm.com、nodejs.org 下载安装，装完还得重开程序让 PATH 生效。
 * 实测这就是最大的断点 —— 用户点进「一键部署」看到的是三个红叉加三句"请自行安装"，
 * 那就不叫一键部署。
 *
 * 【做法：内置免安装版，而不是调 winget / 静默安装系统包】
 *   1) 不需要管理员权限（winget 与安装包都要提权，很多用户卡在这一步）；
 *   2) 不污染系统：全落在 ~/.dsh-butler/toolchain/，删目录即卸载，不写注册表、不改系统 PATH；
 *   3) 不依赖 winget 是否存在（老 Windows、精简系统经常没有）；
 *   4) 版本钉死 —— 构建结果才可复现，「昨天能构建今天不行」这类问题少一大半。
 *
 * 【为什么只改进程 PATH、不改系统 PATH】
 * 系统 PATH 是用户的环境。管家需要它自己（以及它拉起的 pnpm / node 子进程链）看得见
 * 这些工具，但那只是管家的运行需要，不该留下"卸载管家后系统里多出一堆死路径"的尾巴。
 * 所以走 applyToolchainPath()：只在本进程内把内置目录追加进 PATH，子进程自动继承。
 *
 * 【优先级：系统的优先，内置的兜底】
 * 用户自己装过 Node/Git 就继续用他自己那套（他可能有别的项目依赖那个版本）；
 * 只有在"系统里没有"或"版本太旧"时才用内置版。applyToolchainPath 因此是 append 而非 prepend。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { butlerRoot, dirname, isWindows, p } from "../../util/paths.ts";
import {
  ensureDir,
  humanSize,
  isDir,
  isFile,
  readJson,
  removeRecursive,
  writeJsonAtomic,
} from "../../host/fs.ts";
import { clearLocateCache, locate, run, runCmd } from "../../host/shell.ts";
import { diskSpace } from "../../host/mod.ts";
import { log } from "../../util/log.ts";

export type ToolName = "git" | "node" | "pnpm";

/** 各工具的固定版本 —— 升级这里就等于升级内置工具链（改完必须真跑一遍安装验证）。 */
export const TOOL_VERSIONS = {
  git: "2.51.0",
  node: "22.20.0",
  pnpm: "10.18.0",
} as const;

export interface ToolSpec {
  name: ToolName;
  label: string;
  version: string;
  /**
   * 下载源，按顺序尝试（全部失败才算失败）。
   * 第一优先 npmmirror（国内直连稳定，实测 Node 35MB / Git 59MB 均可直下），
   * 官方源作为兜底 —— 国外网络环境里反而更快。
   */
  urls: string[];
  /** 归档形态：zip 用系统自带 tar 解；7z-sfx 是 7-Zip 自解压包，直接带参执行。 */
  kind: "zip" | "7z-sfx" | "npm";
  /** 期望体积（用来做下载预估，以及校验"下下来的东西大小离谱"）。 */
  sizeBytes: number;
  /** 安装后要暴露给 PATH 的目录（相对 toolDir）。 */
  binDirs: string[];
  /** 验证用的入口可执行（相对 toolDir）。 */
  verifyExe: string;
  verifyArgs: string[];
  /** 一句话说明它干什么用。 */
  purpose: string;
  /**
   * zip 是否带一层顶层目录（Node 的包解出来是 node-v22.20.0-win-x64/ 这一层，
   * 必须剥掉，否则可执行文件会埋在一个随机版本号目录里）。
   */
  stripTopDir?: boolean;
}

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  git: {
    name: "git",
    label: "Git",
    version: TOOL_VERSIONS.git,
    urls: [
      `https://registry.npmmirror.com/-/binary/git-for-windows/v${TOOL_VERSIONS.git}.windows.1/PortableGit-${TOOL_VERSIONS.git}-64-bit.7z.exe`,
      `https://github.com/git-for-windows/git/releases/download/v${TOOL_VERSIONS.git}.windows.1/PortableGit-${TOOL_VERSIONS.git}-64-bit.7z.exe`,
    ],
    kind: "7z-sfx",
    sizeBytes: 59_384_960,
    binDirs: ["cmd", p("mingw64", "bin")],
    verifyExe: p("cmd", "git.exe"),
    verifyArgs: ["--version"],
    purpose: "拉取与更新 DSH 源码",
  },
  node: {
    name: "node",
    label: "Node.js",
    version: TOOL_VERSIONS.node,
    urls: [
      `https://registry.npmmirror.com/-/binary/node/v${TOOL_VERSIONS.node}/node-v${TOOL_VERSIONS.node}-win-x64.zip`,
      `https://nodejs.org/dist/v${TOOL_VERSIONS.node}/node-v${TOOL_VERSIONS.node}-win-x64.zip`,
    ],
    kind: "zip",
    sizeBytes: 35_500_968,
    binDirs: ["."],
    verifyExe: "node.exe",
    verifyArgs: ["--version"],
    purpose: "运行 DSH 本体与依赖安装、构建",
    stripTopDir: true,
  },
  pnpm: {
    name: "pnpm",
    label: "pnpm",
    version: TOOL_VERSIONS.pnpm,
    /* pnpm 不走"下载归档"：用内置 Node 自带的 npm 装到 toolchain 自己的前缀下。
       这样拿到的是官方 npm 包（比第三方镜像的独立 exe 可信），且版本可精确钉死。 */
    urls: [],
    kind: "npm",
    sizeBytes: 12 * 1024 * 1024,
    binDirs: ["."],
    verifyExe: p("node_modules", "pnpm", "bin", "pnpm.cjs"),
    verifyArgs: ["--version"],
    purpose: "安装 DSH 依赖（仓库用 pnpm workspace）",
  },
};

/** 安装顺序：pnpm 依赖 node，必须排在后面。 */
export const TOOL_ORDER: ToolName[] = ["git", "node", "pnpm"];

export function toolchainRoot(): string {
  return p(butlerRoot(), "toolchain");
}

export function toolDir(name: ToolName): string {
  return p(toolchainRoot(), name);
}

/** 已安装工具的、确实存在的可执行目录（绝对路径）。 */
export function toolBinDirs(name: ToolName): string[] {
  return TOOL_SPECS[name].binDirs
    .map((d) => (d === "." ? toolDir(name) : p(toolDir(name), d)))
    .filter((d) => isDir(d));
}

export interface InstalledTool {
  name: ToolName;
  label: string;
  version: string | null;
  dir: string;
  binDirs: string[];
}

interface ManifestEntry {
  version: string;
  installedAt: string;
  source: string;
  bytes: number;
}
type ToolManifest = Partial<Record<ToolName, ManifestEntry>>;

function manifestPath(): string {
  return p(toolchainRoot(), "manifest.json");
}

export function readManifest(): ToolManifest {
  return readJson<ToolManifest>(manifestPath()) ?? {};
}

/** 磁盘上真实可用的内置工具（以"能跑起来"为准，不信 manifest 的一面之词）。 */
export function installedTools(): InstalledTool[] {
  const out: InstalledTool[] = [];
  for (const name of TOOL_ORDER) {
    const dir = toolDir(name);
    if (!isDir(dir)) continue;
    const spec = TOOL_SPECS[name];
    if (!isFile(p(dir, spec.verifyExe))) continue;
    out.push({
      name,
      label: spec.label,
      version: TOOL_VERSIONS[name],
      dir,
      binDirs: toolBinDirs(name),
    });
  }
  return out;
}

export function hasTool(name: ToolName): boolean {
  return installedTools().some((t) => t.name === name);
}

/**
 * 把内置工具目录追加进本进程的 PATH。
 *
 * 【为什么是追加】用户自己装过 Node/Git 就继续用他的 —— 他可能还有别的项目依赖那个版本，
 * 管家不该把它顶掉。内置版只在"系统里没有"时兜底。
 *
 * 幂等：重复调用不会重复追加（启动流程里可能被多处调用）。
 * 返回本次实际生效的目录，便于日志与自检。
 */
export function applyToolchainPath(): string[] {
  const dirs: string[] = [];
  for (const name of TOOL_ORDER) dirs.push(...toolBinDirs(name));
  if (dirs.length === 0) return [];

  const cur = Deno.env.get("PATH") ?? "";
  const parts = cur.split(";").map((s) => s.replace(/[/\\]+$/, "").toLowerCase());
  const added = dirs.filter((d) => !parts.includes(d.replace(/[/\\]+$/, "").toLowerCase()));
  if (added.length === 0) return [];

  Deno.env.set("PATH", [...cur.split(";").filter(Boolean), ...added].join(";"));
  /*
   * 清掉 locate 的路径缓存 —— 这里必须【同步】清：下面紧接着就可能有人 locate，
   * 异步清会留下"刚改完 PATH 还是查到旧结果"的竞态窗口。
   * （shell 不反向依赖本模块，所以这里是安全的静态依赖。）
   */
  clearLocateCache();
  log.info("toolchain", `内置工具链已加入 PATH：${added.join("  ")}`);
  return added;
}

// ── 下载 ──────────────────────────────────────────────────────────────

export interface InstallOptions {
  /** 逐行日志回调（动作里接到 ctx.log）。 */
  onLine?: (line: string) => void;
  /** 进度回调 0..1（下载阶段按已下载字节算）。 */
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

/** 期望体积偏差超过这个比例就认为"下的东西不对"（截断 / 被换成别的文件）。 */
const SIZE_TOLERANCE = 0.15;

async function downloadTo(
  url: string,
  dest: string,
  expectBytes: number,
  opts: InstallOptions,
): Promise<number> {
  const res = await fetch(url, { signal: opts.signal, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败：HTTP ${res.status} ${res.statusText}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0) || expectBytes;
  const file = await Deno.open(dest, { create: true, write: true, truncate: true });
  let got = 0;
  let lastReport = 0;
  try {
    for await (const chunk of res.body) {
      if (opts.signal?.aborted) throw new Error("任务已取消");
      await file.write(chunk);
      got += chunk.byteLength;
      const now = Date.now();
      if (total > 0 && now - lastReport > 300) {
        lastReport = now;
        opts.onProgress?.(Math.min(0.99, got / total));
      }
    }
  } finally {
    try {
      file.close();
    } catch {
      /* 已关闭 */
    }
  }
  // 大小离谱直接判失败 —— 比"装完发现是半截包"要早得多
  if (expectBytes > 0 && Math.abs(got - expectBytes) / expectBytes > SIZE_TOLERANCE) {
    throw new Error(
      `下载内容大小异常：期望约 ${humanSize(expectBytes)}，实际 ${humanSize(got)}（可能被截断或镜像异常）`,
    );
  }
  return got;
}

// ── 解压 ──────────────────────────────────────────────────────────────

/**
 * 解 zip。
 *
 * 优先用系统自带 tar.exe（Windows 10 1803+ 都有，比 PowerShell 快一个数量级，
 * 且不经过 .NET 压缩层的内存放大）。老系统上退 PowerShell Expand-Archive。
 */
async function extractZip(zipPath: string, destDir: string, opts: InstallOptions): Promise<void> {
  ensureDir(destDir);
  const tar = await run("tar", ["-xf", zipPath, "-C", destDir], {
    timeoutMs: 300_000,
    allowNonZero: true,
    scope: "toolchain",
    signal: opts.signal,
  });
  if (tar.code === 0) return;

  opts.onLine?.("系统 tar 解压不可用，改用 PowerShell 解压…");
  const ps = await runCmd(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ],
    { timeoutMs: 600_000, allowNonZero: true, scope: "toolchain", signal: opts.signal },
  );
  if (ps.code !== 0) {
    throw new Error(`解压失败：${(ps.stderr || ps.stdout).trim().slice(-300) || `退出码 ${ps.code}`}`);
  }
}

/**
 * 解 7-Zip 自解压包（PortableGit）。
 * 这类 exe 本身就是解压器，`-o<目录> -y` 表示静默解到指定目录、全部覆盖确认。
 */
async function extract7zSfx(sfx: string, destDir: string, opts: InstallOptions): Promise<void> {
  ensureDir(destDir);
  const r = await run(sfx, [`-o${destDir}`, "-y"], {
    timeoutMs: 600_000,
    allowNonZero: true,
    scope: "toolchain",
    signal: opts.signal,
  });
  if (r.code !== 0) {
    throw new Error(`自解压失败：${(r.stderr || r.stdout).trim().slice(-300) || `退出码 ${r.code}`}`);
  }
}

/** 剥掉 zip 解出来的那层顶层目录（Node 包会带 node-vX-win-x64/ 这一层）。 */
function stripSingleTopDir(dir: string): void {
  const entries = [...Deno.readDirSync(dir)].filter((e) => e.name !== "manifest.json");
  if (entries.length !== 1 || !entries[0]!.isDirectory) return;
  const inner = p(dir, entries[0]!.name);
  for (const e of Deno.readDirSync(inner)) {
    Deno.renameSync(p(inner, e.name), p(dir, e.name));
  }
  Deno.removeSync(inner);
}

// ── 安装 ──────────────────────────────────────────────────────────────

export interface InstallOutcome {
  name: ToolName;
  label: string;
  ok: boolean;
  version: string | null;
  dir: string;
  bytes: number;
  source: string;
  /** 失败原因（人话）。 */
  error?: string;
}

/** 跑一次 --version 确认新装的工具真的能用（比任何哈希都硬的自检）。 */
async function verifyTool(name: ToolName, opts: InstallOptions): Promise<string | null> {
  const spec = TOOL_SPECS[name];
  const exe = p(toolDir(name), spec.verifyExe);
  if (!isFile(exe)) return null;
  // pnpm 入口是 .cjs，要交给 node 跑；其余是原生 exe 直接跑。
  const [cmd, args] = name === "pnpm"
    ? [p(toolDir("node"), "node.exe"), [exe, ...spec.verifyArgs]]
    : [exe, spec.verifyArgs];
  const r = await run(cmd, args, {
    timeoutMs: 30_000,
    allowNonZero: true,
    scope: "toolchain",
    signal: opts.signal,
  });
  const text = (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (r.code !== 0 || !text) return null;
  const m = /\bv?(\d+(?:\.\d+){1,3})/.exec(text);
  return m?.[1] ?? text;
}

/**
 * 装一个内置工具（幂等：已装且版本一致就直接返回）。
 *
 * 落盘策略：先在 toolchain/.tmp-<name> 里解压验证，全过了才原子换到正式目录 ——
 * 失败时留下的只有临时目录，不会出现"半截工具被当成装好了"。
 */
export async function installTool(name: ToolName, opts: InstallOptions = {}): Promise<InstallOutcome> {
  const spec = TOOL_SPECS[name];
  const dir = toolDir(name);
  const logLine = opts.onLine ?? (() => {});

  // 已装且能跑：直接复用
  if (isDir(dir)) {
    const v = await verifyTool(name, opts);
    if (v) {
      return { name, label: spec.label, ok: true, version: v, dir, bytes: 0, source: "已安装" };
    }
    logLine(`${spec.label} 目录存在但不可用，将重新获取…`);
    removeRecursive(dir);
  }

  const tmp = p(toolchainRoot(), `.tmp-${name}`);
  removeRecursive(tmp);
  ensureDir(tmp);

  let source = "";
  let bytes = 0;

  try {
    if (spec.kind === "npm") {
      /*
       * pnpm：用 npm 装到 toolchain 自己的前缀下。
       * 优先用【内置 Node】的 npm —— 这样拿到的 pnpm 与内置 Node 是配套的一套；
       * 系统里已有 Node（用户自己装的）而只是缺 pnpm 时，用系统那套的 npm 也一样能装，
       * 不必为了一个 pnpm 再下一遍 36MB 的 Node。
       * 直调 node + npm-cli.js 而不是 npm.cmd：批处理要经 cmd.exe 解析，路径带空格/中文时容易出事。
       */
      const nodeDir = toolDir("node");
      const localNode = p(nodeDir, "node.exe");
      const useLocal = isFile(localNode);
      const nodeExe = useLocal ? localNode : await locate("node");
      if (!nodeExe) {
        throw new Error("需要先有 Node.js 才能获取 pnpm（请先获取 Node.js）");
      }
      const npmCli = useLocal
        ? p(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")
        : p(dirname(nodeExe), "node_modules", "npm", "bin", "npm-cli.js");
      if (!isFile(npmCli)) {
        throw new Error(`找不到 npm 入口（${npmCli}）—— 该 Node 安装可能不完整`);
      }
      const registry = Deno.env.get("DSH_NPM_REGISTRY") ?? "https://registry.npmmirror.com";
      logLine(`用 npm 安装 pnpm@${spec.version}（源：${registry}）…`);
      applyToolchainPath(); // npm 自己要能找到 node
      const r = await run(
        nodeExe,
        [
          npmCli,
          "install",
          "-g",
          `pnpm@${spec.version}`,
          "--prefix",
          tmp,
          "--registry",
          registry,
          "--no-audit",
          "--no-fund",
          "--loglevel",
          "error",
        ],
        { timeoutMs: 300_000, allowNonZero: true, scope: "toolchain", signal: opts.signal },
      );
      if (r.code !== 0) {
        throw new Error(`npm 安装 pnpm 失败：${(r.stderr || r.stdout).trim().slice(-300)}`);
      }
      source = `npm:${registry}`;
    } else {
      const archive = p(tmp, `_dl-${name}.${spec.kind === "zip" ? "zip" : "exe"}`);
      let lastError: string | null = null;
      for (const url of spec.urls) {
        try {
          logLine(`正在下载 ${spec.label} ${spec.version}（约 ${humanSize(spec.sizeBytes)}）…`);
          opts.onProgress?.(0);
          bytes = await downloadTo(url, archive, spec.sizeBytes, opts);
          source = url;
          logLine(`下载完成：${humanSize(bytes)}`);
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          logLine(`该源不可用（${lastError}），换下一个源…`);
          try {
            Deno.removeSync(archive);
          } catch {
            /* 没下成就没有文件 */
          }
        }
      }
      if (!source) throw new Error(lastError ?? "所有下载源都失败了");

      opts.onProgress?.(0.99);
      logLine("正在解压…");
      const extractDir = p(tmp, "x");
      if (spec.kind === "zip") await extractZip(archive, extractDir, opts);
      else await extract7zSfx(archive, extractDir, opts);
      if (spec.stripTopDir) stripSingleTopDir(extractDir);
      try {
        Deno.removeSync(archive);
      } catch {
        /* 已删 */
      }

      // 从临时目录搬到正式目录：先删旧的、再改名（rename 同盘瞬时完成）
      removeRecursive(dir);
      Deno.renameSync(extractDir, dir);
    }

    if (spec.kind === "npm") {
      removeRecursive(dir);
      Deno.renameSync(tmp, dir);
    }

    const v = await verifyTool(name, opts);
    if (!v) {
      removeRecursive(dir);
      throw new Error(`${spec.label} 装好后无法运行（自检未通过，已清理）`);
    }
    logLine(`${spec.label} 就绪：v${v}`);

    const mf = readManifest();
    mf[name] = { version: v, installedAt: new Date().toISOString(), source, bytes };
    writeJsonAtomic(manifestPath(), mf);

    return { name, label: spec.label, ok: true, version: v, dir, bytes, source };
  } catch (err) {
    removeRecursive(tmp);
    removeRecursive(dir);
    applyToolchainPath();
    return {
      name,
      label: spec.label,
      ok: false,
      version: null,
      dir,
      bytes,
      source,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── 动作 ──────────────────────────────────────────────────────────────

export interface ToolchainInstallParams {
  /** 要装的工具；缺省 = 装全部缺失的。 */
  tools?: ToolName[];
}

export interface ToolchainInstallReport {
  results: InstallOutcome[];
  pathDirs: string[];
  lines: string[];
}

/** 尚未内置的工具（按依赖顺序）。 */
export function missingTools(): ToolName[] {
  return TOOL_ORDER.filter((n) => !hasTool(n));
}

async function toolchainPreflight(
  params: ToolchainInstallParams,
): Promise<Finding[]> {
  const out: Finding[] = [];
  const names = params.tools?.length ? params.tools : TOOL_ORDER;

  if (!isWindows) {
    out.push(
      finding("toolchain.unsupported-os", "error", "内置工具链目前只提供 Windows 版", {
        cause: "工具包取自 Windows 官方构建（PortableGit / node-win-x64）",
        impact: "其它系统上无法自动获取",
        action: "请用系统包管理器安装 Node.js 与 Git",
      }),
    );
    return out;
  }

  const need = names.filter((n) => n === "pnpm" || !isDir(toolDir(n)));
  const totalBytes = need.reduce((a, n) => a + TOOL_SPECS[n].sizeBytes, 0);
  const disk = await diskSpace(butlerRoot());
  if (disk && disk.freeBytes < totalBytes * 2 + 500 * 1024 * 1024) {
    out.push(
      finding("toolchain.no-disk", "error", "磁盘空间不足以下载内置工具链", {
        cause: `本次需要约 ${humanSize(totalBytes)}（下载 + 解压峰值），
          当前 ${butlerRoot()} 所在盘可用 ${humanSize(disk.freeBytes)}`,
        impact: "下载或解压会中途失败",
        action: "清理该盘空间后重试",
      }),
    );
  }

  // 目录可写性：toolchain 要建在管家数据目录里，那里不可写就别动手了
  try {
    ensureDir(toolchainRoot());
  } catch (err) {
    out.push(
      finding("toolchain.not-writable", "error", "管家数据目录不可写", {
        cause: err instanceof Error ? err.message : String(err),
        impact: "无法落地内置工具链",
        action: "检查用户目录权限，或以当前用户身份重试",
        evidence: [toolchainRoot()],
      }),
    );
  }
  return out;
}

export const toolchainInstallAction: ActionDef<ToolchainInstallParams, ToolchainInstallReport> = {
  name: "env.toolchain-install",
  domain: "env",
  title: "一键获取运行环境",
  description:
    "把 Git / Node.js / pnpm 的免安装版下载到管家自己的目录（不改系统 PATH、不需要管理员权限），装完即可用于一键部署。已装好的会跳过。",
  readonly: false,
  steps: ["检查磁盘与目录", "下载并解压", "自检可执行"],
  preflight: toolchainPreflight,
  timeoutMs: 30 * 60_000,
  run: async (ctx, params): Promise<ToolchainInstallReport> => {
    const lines: string[] = [];
    const say = (s: string) => {
      lines.push(s);
      ctx.log(s);
    };
    const names = (params?.tools?.length ? params.tools : TOOL_ORDER).filter((n) =>
      TOOL_ORDER.includes(n)
    );

    ctx.step("s1", "检查磁盘与目录");
    const missing = names.filter((n) => n === "pnpm" || !isDir(toolDir(n)));
    if (missing.length === 0) {
      say("所需运行时都已经就绪，无需下载。");
      ctx.progress(1);
      return { results: [], pathDirs: applyToolchainPath(), lines };
    }
    say(`将获取：${missing.map((n) => TOOL_SPECS[n].label).join(" / ")}`);
    say(`安装位置：${toolchainRoot()}（不写注册表、不改系统环境变量）`);
    const bytes = missing.reduce((a, n) => a + TOOL_SPECS[n].sizeBytes, 0);
    say(`预计下载 ${humanSize(bytes)}`);
    ctx.progress(0.05);

    ctx.step("s2", "下载并解压");
    const results: InstallOutcome[] = [];
    for (let i = 0; i < missing.length; i++) {
      const name = missing[i]!;
      ctx.throwIfCancelled();
      const spec = TOOL_SPECS[name];
      ctx.detail(`正在获取 ${spec.label}（${i + 1}/${missing.length}）`);
      const outcome = await installTool(name, {
        onLine: say,
        onProgress: (pr) => ctx.progress(0.05 + (0.85 * (i + pr)) / missing.length),
        signal: ctx.signal,
      });
      results.push(outcome);
      ctx.progress(0.05 + (0.85 * (i + 1)) / missing.length);
      if (!outcome.ok) {
        say(`✗ ${spec.label} 获取失败：${outcome.error ?? "未知原因"}`);
        // 一个失败就停：pnpm 依赖 node，继续下去只会连着报错
        break;
      }
      say(`✓ ${spec.label} ${outcome.version ?? ""} 已就绪`);
    }

    ctx.step("s3", "自检可执行");
    const pathDirs = applyToolchainPath();
    say(pathDirs.length > 0 ? `已加入运行时搜索路径：${pathDirs.join("  ")}` : "无需调整搜索路径");
    ctx.progress(1);
    return { results, pathDirs, lines };
  },
};
