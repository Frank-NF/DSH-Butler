/**
 * 数据搬家 / 备份的「要带什么」与「怎么打包」（P1-2）。
 *
 * 【设计取舍】
 *   1. 不做「整目录拷贝」：~/.dsh 实测约 490 MB，其中 sessions 154 MB、attachments 107 MB、
 *      skills 62 MB、cache/logs 等纯派生物 —— 全量打包又慢又没意义。
 *      所以按【子集】分组，用户选预设：config（精简）/ with-skills / full。
 *   2. 永远不带的东西：cache、logs、server-deck-metrics、fixes、管家的 quarantine（340 MB）、
 *      plugin-txn、node_modules —— 全是可重建或过程垃圾。
 *   3. 打包 = 复制 + 写 MANIFEST.json（相对路径 + 体积 + 来源），
 *      不压缩、不发明私有格式：用户拿 7z 也能打开看，出问题能人工抢救。
 *   4. 纯逻辑好测：选集合、量体积、算人话体积都是纯函数。
 */

import { dirSizeBudgeted, ensureDir, isDir, isFile, listDir, pathExists } from "../../host/fs.ts";
import { dirname, p } from "../../util/paths.ts";

export type DataPreset = "config" | "with-skills" | "full";
export type DataSubset = "config" | "skills" | "heavy";

export interface DataEntry {
  /** 人话名字（界面与 MANIFEST 都用它解释「这是什么」）。 */
  label: string;
  /** 绝对路径。 */
  path: string;
  /** 属于哪个子集。 */
  subset: DataSubset;
  kind: "file" | "dir";
  /** 目录模式下要跳过的子项名。 */
  exclude?: string[];
}

/**
 * 要带走的条目表。
 * 【维护提示】路径都相对用户主目录 / 管家根目录，换机后原样落位。
 */
export function buildEntries(home: string, butlerRootDir: string): DataEntry[] {
  const dsh = p(home, ".dsh");
  const web = p(dsh, "profiles", "web");
  return [
    // ── config 子集：不带它就等于没搬（配置与插件注册）──
    { label: "DSH 主配置（含 MCP 服务器）", path: p(dsh, "config.json"), subset: "config", kind: "file" },
    { label: "插件清单", path: p(web, "package.json"), subset: "config", kind: "file" },
    { label: "依赖锁（npm）", path: p(web, "package-lock.json"), subset: "config", kind: "file" },
    { label: "依赖锁（pnpm）", path: p(web, "pnpm-lock.yaml"), subset: "config", kind: "file" },
    { label: "pnpm workspace", path: p(web, "pnpm-workspace.yaml"), subset: "config", kind: "file" },
    { label: "DSH 配置补丁（cordis.patch.yml）", path: p(web, "cordis.patch.yml"), subset: "config", kind: "file" },
    { label: "DSH 基础配置（cordis.yml）", path: p(web, "cordis.yml"), subset: "config", kind: "file" },
    { label: "npm 安装源配置（.npmrc）", path: p(web, ".npmrc"), subset: "config", kind: "file" },
    { label: "插件市场本地状态", path: p(web, ".dsh-market"), subset: "config", kind: "dir" },
    { label: "插件管理器状态", path: p(web, ".plugin-manager"), subset: "config", kind: "dir" },
    { label: "桌面 profile 配置", path: p(dsh, "profiles", "desktop"), subset: "config", kind: "dir" },
    { label: "技能中枢状态", path: p(dsh, "dsh-skill-hub.json"), subset: "config", kind: "file" },
    { label: "server-deck 配置", path: p(dsh, "server-deck.json"), subset: "config", kind: "file" },
    { label: "管家设置", path: p(butlerRootDir, "config.json"), subset: "config", kind: "file" },
  // ── 凭据与存储层（2026-09-27 补）──
  // 【为什么必须补】用户重装系统前问「怎么恢复全量配置」，一查才发现：
  // 旧预设只有配置与插件清单，**密钥一个都没带** —— 恢复完会是「配置齐全但连不上模型」的半残系统。
  { label: "API 凭据（.credentials.yaml）", path: p(dsh, ".credentials.yaml"), subset: "config", kind: "file" },
  { label: "MCP 服务器配置", path: p(dsh, "dsh-mcp.json"), subset: "config", kind: "file" },
  { label: "模型通道配置", path: p(dsh, "llm-deepseek"), subset: "config", kind: "dir" },
  { label: "SSH 隧道配置", path: p(dsh, "ssh-tunnel"), subset: "config", kind: "dir" },
  { label: "jev 通道配置", path: p(dsh, "jev"), subset: "config", kind: "dir" },
  { label: "git-forge 配置", path: p(dsh, "git-forge"), subset: "config", kind: "dir" },
  { label: "聚合插件配置", path: p(dsh, "@wingsky-1"), subset: "config", kind: "dir" },
  { label: "用量 / 轮次 / 体积统计", path: p(dsh, ".dshw-usage.json"), subset: "config", kind: "file" },
  { label: "存储与记忆（storages）", path: p(dsh, "storages"), subset: "heavy", kind: "dir" },
    { label: "回滚点索引", path: p(butlerRootDir, "rollback", "index.json"), subset: "config", kind: "file" },
    // ── skills 子集：用户资产，体积大所以单独一层 ──
    { label: "DSH 技能（~/.dsh/skills）", path: p(dsh, "skills"), subset: "skills", kind: "dir", exclude: [".git"] },
    { label: "Agents 技能（~/.agents/skills）", path: p(home, ".agents", "skills"), subset: "skills", kind: "dir", exclude: [".git"] },
    // ── heavy 子集：会话/附件/存储，默认不带 ──
    { label: "会话记录（体积大）", path: p(dsh, "sessions"), subset: "heavy", kind: "dir" },
    { label: "附件（体积大）", path: p(dsh, "attachments"), subset: "heavy", kind: "dir" },
    { label: "插件存储数据", path: p(dsh, "storages"), subset: "heavy", kind: "dir" },
  ];
}

/** 预设 → 子集（纯函数）。 */
export function subsetsOf(preset: DataPreset): DataSubset[] {
  if (preset === "config") return ["config"];
  if (preset === "with-skills") return ["config", "skills"];
  return ["config", "skills", "heavy"];
}

/** 选出这次要打包的条目（纯函数：只保留真实存在的）。 */
export function selectEntries(entries: DataEntry[], preset: DataPreset): DataEntry[] {
  const want = new Set(subsetsOf(preset));
  return entries.filter((e) => want.has(e.subset) && pathExists(e.path));
}

/** 没被选中但存在的条目（界面用来解释「这次没带什么、为什么」）。 */
export function skippedEntries(entries: DataEntry[], preset: DataPreset): DataEntry[] {
  const want = new Set(subsetsOf(preset));
  return entries.filter((e) => !want.has(e.subset) && pathExists(e.path));
}

export interface MeasuredEntry extends DataEntry {
  bytes: number;
  /** false = 超出时间预算，bytes 只是「至少」。 */
  complete: boolean;
}

/**
 * 量体积：走 dirSizeBudgeted（带预算与缓存），超预算就标 complete=false。
 * 理由同体检里那份残留统计：绝不能让一个展示用的数字把页面拖几秒。
 */
export function measureEntries(entries: DataEntry[], totalBudgetMs = 400): MeasuredEntry[] {
  const deadline = Date.now() + totalBudgetMs;
  return entries.map((e) => {
    if (e.kind === "file") {
      let bytes = 0;
      try { bytes = Deno.statSync(e.path).size; } catch { bytes = 0; }
      return { ...e, bytes, complete: true };
    }
    const remain = Math.max(0, deadline - Date.now());
    if (remain < 30) return { ...e, bytes: 0, complete: false };
    const r = dirSizeBudgeted(e.path, Math.min(200, remain));
    return { ...e, bytes: r.bytes, complete: r.complete };
  });
}

/** 人话体积（带「至少 / 约」—— 和体检里同一套说法）。 */
export function sizeText(list: MeasuredEntry[]): string {
  const bytes = list.reduce((s, x) => s + x.bytes, 0);
  const anyIncomplete = list.some((x) => !x.complete);
  const mb = bytes / 1024 / 1024;
  const num = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
  return (anyIncomplete ? "至少 " : "约 ") + num + " MB";
}

// ── 递归复制（带排除） ─────────────────────────────────────────────

export interface CopyResult {
  files: number;
  bytes: number;
  failed: Array<{ path: string; error: string }>;
}

/**
 * 复制文件或目录到目标（目录递归、可排除子项）。
 * 不跟随符号链接：搬家包里塞链接没意义，还可能复制出循环。
 */
export function copyInto(from: string, to: string, exclude: string[] = [], acc?: CopyResult): CopyResult {
  const res: CopyResult = acc ?? { files: 0, bytes: 0, failed: [] };
  try {
    if (isFile(from)) {
      // 必须是目标文件的父目录：写成 p(to, "..") 会造出一个「以文件名为名的目录」，随后复制被系统拒绝
      ensureDir(dirname(to));
      Deno.copyFileSync(from, to);
      res.files++;
      try { res.bytes += Deno.statSync(to).size; } catch { /* 体积统计失败不影响复制 */ }
      return res;
    }
    if (!isDir(from)) return res;
    ensureDir(to);
    for (const e of listDir(from)) {
      if (exclude.includes(e.name)) continue;
      copyInto(p(from, e.name), p(to, e.name), exclude, res);
    }
  } catch (err) {
    res.failed.push({ path: from, error: (err as Error).message });
  }
  return res;
}

/** 相对路径（统一用 /）—— MANIFEST 里一律相对路径，换机后原样落位。 */
export function relOf(base: string, abs: string): string {
  const b = base.replace(/[\\/]+$/, "").replace(/\\/g, "/") + "/";
  const a = abs.replace(/\\/g, "/");
  return a.startsWith(b) ? a.slice(b.length) : a;
}
