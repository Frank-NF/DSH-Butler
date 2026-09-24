/**
 * plugin.facts —— 插件诊断的【采集层】（只读）。
 *
 * 职责边界：只负责把磁盘上的事实收集成一个纯数据结构 PluginFacts，
 * 不做任何判定（判定全在 rules.ts 的纯函数里）——这样规则可以拿
 * 手搓的 facts 样本做阴阳测试（AC-P4），完全不碰真实 DSH 目录。
 *
 * 判据全部对齐本体一手源码 packages/boot/app-boot/src/profile.ts：
 *   - 可作层（bundle_patch_of）＝包里有 dsh.bundle 对象，其 .patch 是
 *     字符串或字符串数组（profile.ts:58-64 bundlePatchFiles），且声明的
 *     每个 patch 文件都真实存在（不存在则 loadOverlayPatches 读文件时
 *     throw，index.ts:333-341）。
 *   - 本体遇到不可作层的 bundle 的行为是【catch → stderr 警告 → 跳过该层】
 *     （profile.ts:666-668），不是一律「启动即崩」——所以诊断文案写
 *     「该层被跳过、层内插件全部不生效；若该包同时被其它层 insert 引用，
 *     则插件树加载失败」，两种后果都有实战依据，不夸大也不缩小。
 */

import type { PluginListCheck, ResidueEntry } from "../core/status.ts";
import { readPluginLists, scanResidue } from "../core/status.ts";
import { isFile, readJson } from "../../host/fs.ts";
import { liveProcesses, looksLikeNodeProcess } from "../../host/process.ts";
import { dshProfileDir, p, resolveDshSourceRoot } from "../../util/paths.ts";

/** 不可作层的原因（与本体 throw 点一一对应）。 */
export type LayerReason =
  /** bundles 里的名字在安装锚点与 profile 都解析不到（resolveBundleDir throw）。 */
  | "unresolved"
  /** 包的 package.json 没有 dsh.bundle 对象（profile.ts:657-659）。 */
  | "no-dsh-bundle"
  /** dsh.bundle.patch 既不是字符串也不是字符串数组（profile.ts:59-62）。 */
  | "patch-illegal"
  /** 声明的 patch 文件在磁盘上不存在（loadOverlayPatches 读时 throw）。 */
  | "patch-missing";

/** 一个 bundle 条目的作层资格判定结果。 */
export interface LayerVerdict {
  name: string;
  /** 解析到的包目录；null = 解析不到。 */
  dir: string | null;
  canLayer: boolean;
  reason: LayerReason | null;
  /** 声明的 patch 文件（相对路径原文），可作层时非空或为空数组（空数组本体也放行）。 */
  patchFiles: string[];
}

/** 一把写锁的事实与判定。verdict 判定也在采集层完成（需要活进程快照）。 */
export interface LockFact {
  path: string;
  /** 首行原文（atomic-write 的约定：首行是持有者 PID）。 */
  firstLine: string;
  pid: number | null;
  /** null = 判活不可用/未判。 */
  alive: boolean | null;
  /** PID 存活时的进程名。 */
  procName: string | null;
  /**
   * held   = 持有者是活的 node 进程（正常，绝不许清）
   * stale  = PID 已不存在（僵尸锁，可清）
   * recycled = PID 活着但已是别的程序（复用，锁同样失效）
   * unknown = 首行不是 PID / 判活失败 —— 宁可当没看见，绝不误判
   */
  verdict: "held" | "stale" | "recycled" | "unknown";
}

/** 一个包自带 patch 文件里的 insert 目标 id 列表。 */
export interface BundlePatchIds {
  pkg: string;
  patchFile: string;
  ids: string[];
}

/** 插件诊断所需的全部事实。全部只读、可序列化。 */
export interface PluginFacts {
  profileDir: string;
  /** profile 的 package.json 是否存在且可解析。 */
  manifestExists: boolean;
  /** 双名单差集（复用 core/status 的 readPluginLists）。 */
  lists: PluginListCheck;
  /** profile dependencies 的原始映射（名 → 版本串），用于识别 file:%TEMP% 安装。 */
  depEntries: Record<string, string>;
  /** 每个 bundle 条目的作层资格。 */
  layers: LayerVerdict[];
  /** 每个「装了但没生效」依赖的作层资格 —— repair 补登记前必须先过这道守卫。 */
  inactiveLayers: LayerVerdict[];
  /** profile 级 cordis.patch.yml 里 `- insert:` 块声明的新 entry id。 */
  profilePatchInsertIds: string[];
  /** 各 bundle 包自带 patch 文件里的 insert id。 */
  bundlePatchInsertIds: BundlePatchIds[];
  /** profile/node_modules 下的 pnpm 中断残留。 */
  residue: ResidueEntry[];
  /** profile 浅层的 *.lock 写锁。 */
  locks: LockFact[];
  checkedAt: string;
}

export interface CollectOptions {
  /** 默认取真实 web profile；测试传 fixture 目录。 */
  profileDir?: string;
  /** 本体安装根；null = 未安装（此时 bundles 侧解析不到的条目仍如实报 unresolved）。 */
  installRoot?: string | null;
  /** 跳过锁采集（锁判活要起 tasklist，纯名单测试不需要）。 */
  skipLocks?: boolean;
}

/**
 * 按本体 resolveBundleDir 的锚点顺序解析包目录：
 * 安装锚点优先（仓库根 node_modules、apps/cli/node_modules），profile 次之。
 * 与 core/status.ts 的 resolvesBundle 同源；这里返回目录而非布尔，
 * 因为作层判定要读包里的 package.json。
 */
export function locateBundleDir(name: string, installRoot: string | null, profileDir: string): string | null {
  const anchors: string[] = [];
  if (installRoot) {
    anchors.push(p(installRoot, "node_modules"), p(installRoot, "apps", "cli", "node_modules"));
  }
  anchors.push(p(profileDir, "node_modules"));
  for (const a of anchors) {
    const dir = p(a, ...name.split("/"));
    if (isFile(p(dir, "package.json"))) return dir;
  }
  return null;
}

/**
 * 作层资格判定 —— 与本体 bundlePatchFiles + loadOverlayPatches 的
 * throw 条件逐条对齐。空数组 patch（`patch: []`）本体不 throw，照抄放行。
 */
export function judgeLayer(name: string, dir: string | null): LayerVerdict {
  if (!dir) return { name, dir: null, canLayer: false, reason: "unresolved", patchFiles: [] };
  const pkg = readJson<{ dsh?: { bundle?: { patch?: unknown } } }>(p(dir, "package.json"));
  const bundle = pkg?.dsh?.bundle;
  if (bundle === undefined || bundle === null || typeof bundle !== "object") {
    return { name, dir, canLayer: false, reason: "no-dsh-bundle", patchFiles: [] };
  }
  const patch = bundle.patch;
  const files = typeof patch === "string" ? [patch] : Array.isArray(patch) ? patch : null;
  if (files === null || !files.every((f) => typeof f === "string")) {
    return { name, dir, canLayer: false, reason: "patch-illegal", patchFiles: [] };
  }
  const strFiles = files as string[];
  if (strFiles.some((f) => !isFile(p(dir, f)))) {
    return { name, dir, canLayer: false, reason: "patch-missing", patchFiles: strFiles };
  }
  return { name, dir, canLayer: true, reason: null, patchFiles: strFiles };
}

/**
 * 提取 YAML patch 里 `- insert:` 块【直接子级】声明的新 entry id。
 *
 * 三不收（每条都有真机/源码依据）：
 *   1. 顶层的 `- id: xxx`（不带 insert）是对已有 entry 的 config 覆盖
 *      （targeting），不新建 loader entry —— 真实 profile 顶层全是这种，
 *      算进来正常机器天天误报（AC-P4 阴性样本）。
 *   2. insert 块【深处】的 `- id:` —— 那是子 entry 的 config 数据。
 *      真机实证：presets 的顶层 insert 只建 preset-standard 一个 entry，
 *      tool-bash/persona 等全躺在 config.plugins[] 数组里；dsh-base 同理。
 *      2026-09-24 第一版把它们全收了，真机一跑报出 32 条假「重复注册」。
 *   3. 注释与空行。
 *
 * 只收直接子级：insert 行之后首个子级行的缩进即 childIndent，
 * 只有缩进恰好等于 childIndent 的 `- id:` 才是新建的 entry。
 *
 * 为什么重复的【顶层 entry】值得 error：aigc-canvas 事故（真机
 * cordis.patch.yml 注释原文）—— 同一 entry 经两条路径 insert 后，
 * 运行时报 `service aigcCanvas has been registered at <dsh-aigc-canvas>`。
 *
 * 不引 YAML 库：patch 文件是受限子集，行状态机足够，且零依赖。
 */
export function extractInsertIds(yamlText: string): string[] {
  const ids: string[] = [];
  let inInsert = false;
  let insertIndent = 0;
  /** 本 insert 块直接子项的缩进；-1 = 还没见到子级行。 */
  let childIndent = -1;
  for (const raw of yamlText.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const t = raw.trim();
    const isInsertLine = /^-?\s*insert\s*:/.test(t);
    if (isInsertLine) {
      inInsert = true;
      insertIndent = indent;
      childIndent = -1;
      continue;
    }
    if (!inInsert) continue;
    // 缩进回到 insert 行自身或更外层 → 块结束（本行属于外层，不收）
    if (indent <= insertIndent) {
      inInsert = false;
      childIndent = -1;
      continue;
    }
    // insert 块内部：首个子级行的缩进就是「直接子项」的基准缩进
    if (childIndent === -1) childIndent = indent;
    if (indent !== childIndent) continue; // 深处的 - id: 是 config 数据，不收
    const m = /^-\s*id:\s*["']?([^"'#\s]+)/.exec(t);
    if (m?.[1]) ids.push(m[1]);
  }
  return ids;
}

/** 读一个 patch 文件的 insert ids；文件读不到返回 null（视为不可用）。 */
function readPatchIds(file: string): string[] | null {
  try {
    return extractInsertIds(Deno.readTextFileSync(file));
  } catch {
    return null;
  }
}

/** 采集 profile 浅层的 *.lock（跳过目录；首行按 atomic-write 约定取 PID）。 */
async function collectLocks(profileDir: string): Promise<LockFact[]> {
  const out: LockFact[] = [];
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(profileDir)];
  } catch {
    return out;
  }
  const lockFiles = entries.filter((e) => e.isFile && e.name.toLowerCase().endsWith(".lock"));
  if (lockFiles.length === 0) return out;

  // 一把锁都不用判活就别起 tasklist
  const live = await liveProcesses();
  for (const e of lockFiles) {
    const path = p(profileDir, e.name);
    let firstLine = "";
    try {
      firstLine = (Deno.readTextFileSync(path).split(/\r?\n/)[0] ?? "").trim();
    } catch {
      out.push({ path, firstLine: "", pid: null, alive: null, procName: null, verdict: "unknown" });
      continue;
    }
    const pid = /^\d+$/.test(firstLine) ? Number(firstLine) : null;
    if (pid === null) {
      out.push({ path, firstLine, pid: null, alive: null, procName: null, verdict: "unknown" });
      continue;
    }
    const procName = live.get(pid) ?? null;
    const alive = procName !== null;
    const verdict: LockFact["verdict"] = !alive
      ? "stale"
      : looksLikeNodeProcess(procName)
      ? "held"
      : "recycled";
    out.push({ path, firstLine, pid, alive, procName, verdict });
  }
  return out;
}

/** 采集插件事实（只读）。 */
export async function collectPluginFacts(options: CollectOptions = {}): Promise<PluginFacts> {
  const profileDir = options.profileDir ?? dshProfileDir();
  const installRoot = options.installRoot !== undefined ? options.installRoot : resolveDshSourceRoot()?.path ?? null;

  const lists = readPluginLists(p(profileDir, "package.json"), { installRoot: installRoot ?? "", profileDir })
    ?? {
      dependencies: [],
      bundles: [],
      active: [],
      declaredButInactive: [],
      inBox: [],
      bundledButUndeclared: [],
    };

  const manifestPath = p(profileDir, "package.json");
  const pkg = readJson<{ dependencies?: Record<string, string> }>(manifestPath);
  const manifestExists = pkg !== null;
  const depEntries = pkg?.dependencies ?? {};

  // 每个 bundle 条目的作层资格
  const layers: LayerVerdict[] = [];
  for (const name of lists.bundles) {
    layers.push(judgeLayer(name, locateBundleDir(name, installRoot, profileDir)));
  }

  // 每个「装了但没生效」依赖的作层资格 —— repair 补登记前必须先过这道守卫
  // （否则补登记动作会把不可作层的包写进 bundles，制造新的启动问题）
  const inactiveLayers: LayerVerdict[] = [];
  for (const name of lists.declaredButInactive) {
    inactiveLayers.push(judgeLayer(name, locateBundleDir(name, installRoot, profileDir)));
  }

  // profile 自己的 patch 层
  const profilePatchInsertIds = readPatchIds(p(profileDir, "cordis.patch.yml")) ?? [];

  // 各 bundle 包自带 patch 的 insert id
  const bundlePatchInsertIds: BundlePatchIds[] = [];
  for (const l of layers) {
    if (!l.dir) continue;
    for (const f of l.patchFiles) {
      const ids = readPatchIds(p(l.dir, f));
      if (ids && ids.length > 0) bundlePatchInsertIds.push({ pkg: l.name, patchFile: f, ids });
    }
  }

  const residue = scanResidue(p(profileDir, "node_modules"));
  const locks = options.skipLocks ? [] : await collectLocks(profileDir);

  return {
    profileDir,
    manifestExists,
    lists,
    depEntries,
    layers,
    inactiveLayers,
    profilePatchInsertIds,
    bundlePatchInsertIds,
    residue,
    locks,
    checkedAt: new Date().toISOString(),
  };
}
