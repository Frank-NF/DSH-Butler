/**
 * 「装上了，却被 DSH 跳过不加载」的插件。
 *
 * 现场（2026-09-29 真机日志）：插件 @dhicoc/dsh-reverse-skill@1.0.5 已经装进 profile ——
 * pnpm 报成功、依赖与 bundles 都在 —— 但 DSH 启动时因为 peerDependencies 版本不匹配，
 * 把整个 profile bundle 静默跳过：
 *
 *   dsh: skipping profile bundle "@dhicoc/dsh-reverse-skill": Error: Plugin
 *   @dhicoc/dsh-reverse-skill@1.0.5 is incompatible with dsh 0.1.7-rc.1:
 *   peerDependencies {"@deepseek-ai/dsh-skill":"^0.0.1-rc.1"}.
 *
 * 用户视角就是「装完了却没反应」，而且管家只报了 pnpm 成功 —— 于是没人知道为什么。
 * 这个模块负责：捞出那些跳过记录，翻译成人话，并给一条官方出路。
 *
 * 出路用 DSH 自己的正式通道：profile 目录下的 compatibility.json（精确版本豁免）。
 * 写豁免不动 dependencies、不动 bundles、不动 cordis.patch.yml —— 最小侵入、可撤销。
 */

import { ensureDir, isDir, isFile, readJson, writeJsonAtomic } from "../../host/fs.ts";
import { butlerLogsDir, dshProfileDir, p } from "../../util/paths.ts";

export const COMPATIBILITY_FILENAME = "compatibility.json";

/** 只管 DSH 自己写的启动日志（管家启动服务时重定向的那两份）。 */
const LOG_NAME_RE = /^dsh-server-.*\.(?:out|err)\.log$/;

/** 日志可能很大（跑一整天的服务输出），只读尾部这么多字节。 */
const MAX_LOG_BYTES = 4 * 1024 * 1024;

export interface SkippedBundle {
  /** 完整包名，如 @dhicoc/dsh-reverse-skill。 */
  name: string;
  version: string;
  /** 包名@版本 —— 兼容性豁免表的键。 */
  key: string;
  /** 出问题的 DSH 运行时版本，如 0.1.7-rc.1。 */
  runtime: string;
  /** 原文里的 peerDependencies 片段（诊断用，可能没有）。 */
  peers: string | null;
  /** 现在这份豁免表里是否已经（针对该运行时）放行。 */
  exempted: boolean;
  /** 从哪个日志文件看到的。 */
  source: string;
}

export interface SkippedScan {
  items: SkippedBundle[];
  /** 扫过的日志文件（新的在前）。 */
  scanned: string[];
  /** 人话总结，界面直接用。 */
  note: string;
}

function textsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * 从一段日志文本里抠出所有「被跳过」的插件。纯函数，好测。
 *
 * exemptions 传当前豁免表（键 name@version → 放行的运行时版本列表），用来判断是否已经放行。
 */
export function parseSkippedBundles(
  text: string,
  opts: { source?: string; exemptions?: Record<string, string[]> } = {},
): SkippedBundle[] {
  const source = opts.source ?? "";
  const table = opts.exemptions ?? {};
  const found = new Map<string, SkippedBundle>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // 认这一句就够：它同时说明「谁」「为什么」
    if (!line.includes("is incompatible with dsh")) continue;
    const m = /Plugin\s+(.+?)@([^\s@]+)\s+is incompatible with dsh\s+([^\s:：，。]+)/.exec(line);
    if (!m) continue;
    const name = m[1]!;
    const version = m[2]!;
    const runtime = m[3]!;
    const key = `${name}@${version}`;
    if (found.has(key)) continue;
    const peers = /peerDependencies\s+(\{[^}]*\})/.exec(line);
    found.set(key, {
      name,
      version,
      key,
      runtime,
      peers: peers ? peers[1]! : null,
      exempted: textsOf(table[key]).includes(runtime),
      source,
    });
  }
  return Array.from(found.values());
}

/** 豁免文件路径。 */
export function compatibilityFilePath(profileDir: string = dshProfileDir()): string {
  return p(profileDir, COMPATIBILITY_FILENAME);
}

/** 读豁免表；文件不在或读坏了都返回空表（读坏时不写回，交给写入路径处理）。 */
export function readExemptions(profileDir: string = dshProfileDir()): Record<string, string[]> {
  const raw = readJson<Record<string, unknown>>(compatibilityFilePath(profileDir));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const table: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const list = textsOf(value);
    if (list.length > 0) table[key] = list;
  }
  return table;
}

/**
 * 写/撤一条精确版本豁免。
 *
 * 形状按 DSH 自己的约定：{ "包名@版本": ["运行时版本", ...] }（见 plugin-manager 的测试）。
 * remove=true 时把该运行时版本从列表里摘掉，摘空了就连键一起删。
 */
export function writeExemption(
  key: string,
  runtime: string,
  opts: { profileDir?: string; remove?: boolean } = {},
): { path: string; table: Record<string, string[]>; changed: boolean } {
  const profileDir = opts.profileDir ?? dshProfileDir();
  const file = compatibilityFilePath(profileDir);
  const table = readExemptions(profileDir);
  const before = textsOf(table[key]);
  let after: string[];
  if (opts.remove) {
    after = before.filter((v) => v !== runtime);
  } else {
    after = Array.from(new Set([...before, runtime]));
  }
  const changed = after.length !== before.length || after.some((v, i) => v !== before[i]);
  if (after.length > 0) table[key] = after;
  else delete table[key];
  if (changed) {
    if (!isDir(profileDir)) ensureDir(profileDir);
    writeJsonAtomic(file, table);
  }
  return { path: file, table, changed };
}

function readTail(file: string): string {
  let text = "";
  try {
    text = Deno.readTextFileSync(file);
  } catch {
    return "";
  }
  return text.length > MAX_LOG_BYTES ? text.slice(text.length - MAX_LOG_BYTES) : text;
}

/** 扫管家日志目录里最近的几份 DSH 启动输出，汇总被跳过的插件。 */
export function collectSkippedBundles(
  opts: { profileDir?: string; logsDir?: string; maxFiles?: number } = {},
): SkippedScan {
  const profileDir = opts.profileDir ?? dshProfileDir();
  const logsDir = opts.logsDir ?? butlerLogsDir();
  const exemptions = readExemptions(profileDir);

  let names: string[] = [];
  try {
    names = Array.from(Deno.readDirSync(logsDir))
      .filter((e) => e.isFile && LOG_NAME_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    return { items: [], scanned: [], note: "还没有 DSH 的启动输出可查（服务不是管家启动的？）" };
  }
  if (names.length === 0) {
    return { items: [], scanned: [], note: "还没有 DSH 的启动输出可查（服务不是管家启动的？）" };
  }

  // 文件名带时间戳（yyyymmdd-hhmmss），倒序即最新在前
  names.sort().reverse();
  const limit = Math.max(1, Math.min(opts.maxFiles ?? 8, names.length));
  const scanned: string[] = [];
  const merged = new Map<string, SkippedBundle>();
  for (const name of names.slice(0, limit)) {
    const file = p(logsDir, name);
    if (!isFile(file)) continue;
    scanned.push(file);
    const hits = parseSkippedBundles(readTail(file), { source: file, exemptions });
    for (const hit of hits) if (!merged.has(hit.key)) merged.set(hit.key, hit);
  }

  const items = Array.from(merged.values());
  const note = items.length === 0
    ? "没有发现被跳过的插件。"
    : `发现 ${items.length} 个插件被 DSH 跳过：它们装是装上了，但 DSH 启动时判定版本不兼容，整包没加载。`;
  return { items, scanned, note };
}
