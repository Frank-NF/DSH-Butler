/**
 * 搬家包的打包 / 检查 / 还原（P1-2）。
 *
 * 【为什么存「相对位置」而不是绝对路径】
 * 搬家的本质就是换机器：新机器上用户名可能不同（C:\Users\张三 → /home/li），
 * 绝对路径必然失效。所以 MANIFEST 里每条记 (relTo, rel)：
 *   relTo = home   → 落到 <新机器主目录>/<rel>
 *   relTo = butler → 落到 <新机器管家根目录>/<rel>
 * 原来的绝对路径只作为 source 记着，供人核对，不参与还原。
 *
 * 【安全】还原是「把外部文件写进用户目录」的高危动作，所以：
 *   1. rel 里出现绝对路径、盘符或 .. 段 —— 直接拒绝（防路径穿越：包里塞 ../../Windows/… ）；
 *   2. 每个目标解析后必须仍在 home / butler 根之内 —— 再校验一次；
 *   3. 支持 dryRun：先把「会覆盖什么、会新增什么」摊出来给人看（和回滚影响预览一个思路）。
 */

import { ensureDir, isDir, isFile, listDir, pathExists, readJson, writeJsonAtomic } from "../../host/fs.ts";
import { p } from "../../util/paths.ts";
import { APP_VERSION } from "../../version.ts";
import {
  buildEntries,
  copyInto,
  type DataEntry,
  type DataPreset,
  measureEntries,
  selectEntries,
  skippedEntries,
  sizeText,
} from "./manifest.ts";

export interface PackItem {
  label: string;
  /** 落到哪：home = 主目录，butler = 管家根目录。 */
  relTo: "home" | "butler";
  /** 相对路径（统一用 /）。 */
  rel: string;
  /** 打包时的绝对来源（仅供人核对，不参与还原）。 */
  source: string;
  kind: "file" | "dir";
  bytes: number;
}

export interface PackManifest {
  schemaVersion: 1;
  kind: "dsh-butler-migration";
  createdAt: string;
  appVersion: string;
  preset: DataPreset;
  hostname: string;
  items: PackItem[];
  fileCount: number;
  bytes: number;
  /** 这次没带、但本机存在的（界面解释用）。 */
  skipped: Array<{ label: string; subset: string }>;
}

/** 路径是否落在某个根之内（防越界）。 */
export function underRoot(abs: string, root: string): boolean {
  const a = abs.replace(/\\/g, "/").toLowerCase();
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() + "/";
  return a.startsWith(r);
}

/** 把绝对路径拆成 (relTo, rel)；不属于这两个根就返回 null。 */
export function splitRel(abs: string, home: string, butlerRootDir: string): { relTo: "home" | "butler"; rel: string } | null {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const a = norm(abs);
  const b = norm(butlerRootDir);
  if (a === b || a.startsWith(b + "/")) {
    return { relTo: "butler", rel: a === b ? "" : a.slice(b.length + 1) };
  }
  const h = norm(home);
  if (a === h || a.startsWith(h + "/")) {
    return { relTo: "home", rel: a === h ? "" : a.slice(h.length + 1) };
  }
  return null;
}

/** rel 是否安全（相对、不含 .. 段、不含盘符）。 */
export function isSafeRel(rel: string): boolean {
  if (!rel) return false;
  if (/^[a-zA-Z]:/.test(rel)) return false;
  if (rel.startsWith("/") || rel.startsWith("\\")) return false;
  const segs = rel.replace(/\\/g, "/").split("/");
  return !segs.some((s) => s === ".." || s === "" && segs.length > 1 && false);
}

/** 解析还原目标；不安全或越界返回 null。 */
export function resolveTarget(
  item: { relTo: "home" | "butler"; rel: string },
  home: string,
  butlerRootDir: string,
): string | null {
  if (!isSafeRel(item.rel)) return null;
  const root = item.relTo === "butler" ? butlerRootDir : home;
  const target = p(root, ...item.rel.replace(/\\/g, "/").split("/"));
  return underRoot(target, root) ? target : null;
}

export function packDirName(stamp: string, destDir: string): string {
  return p(destDir, "DSH搬移包-" + stamp);
}

export interface ExportResult {
  dir: string;
  manifestPath: string;
  manifest: PackManifest;
  failed: Array<{ path: string; error: string }>;
}

/** 打包。返回落点与清单；单条失败不影响整体（记录在 failed 里）。 */
export function exportPackage(opts: {
  preset: DataPreset;
  destDir: string;
  stamp: string;
  home: string;
  butlerRootDir: string;
}): ExportResult {
  const all = buildEntries(opts.home, opts.butlerRootDir);
  const picked = selectEntries(all, opts.preset);
  const measured = measureEntries(picked);
  const skipped = skippedEntries(all, opts.preset).map((e) => ({ label: e.label, subset: e.subset }));

  const dir = packDirName(opts.stamp, opts.destDir);
  ensureDir(dir);

  const items: PackItem[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  let fileCount = 0;
  let bytes = 0;

  for (const e of measured) {
    const split = splitRel(e.path, opts.home, opts.butlerRootDir);
    if (!split) {
      failed.push({ path: e.path, error: "不在主目录/管家目录之内，拒绝打包（路径规则）" });
      continue;
    }
    const dest = p(dir, "data", split.relTo, ...split.rel.split("/"));
    const res = copyInto(e.path, dest, e.exclude ?? []);
    fileCount += res.files;
    bytes += res.bytes;
    for (const f of res.failed) failed.push(f);
    items.push({
      label: e.label,
      relTo: split.relTo,
      rel: split.rel,
      source: e.path,
      kind: e.kind,
      bytes: res.bytes,
    });
  }

  const manifest: PackManifest = {
    schemaVersion: 1,
    kind: "dsh-butler-migration",
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    preset: opts.preset,
    hostname: (Deno.env.get("COMPUTERNAME") ?? Deno.env.get("HOSTNAME") ?? "未知"),
    items,
    fileCount,
    bytes,
    skipped,
  };
  const manifestPath = p(dir, "MANIFEST.json");
  writeJsonAtomic(manifestPath, manifest);
  // 一句人话的说明放在包根，拿到包的人不用打开 JSON 也知道这是什么
  Deno.writeTextFileSync(
    p(dir, "读我.txt"),
    [
      "DSH 管家 · 数据搬移包",
      "生成时间：" + new Date(manifest.createdAt).toLocaleString("zh-CN"),
      "打包预设：" + manifest.preset + "　　条目：" + items.length + "　文件：" + fileCount,
      "体积：" + sizeText(measured),
      "",
      "怎么用：打开管家 →「记录 → 数据搬家」→ 选择这个文件夹 → 先点「检查」看清会覆盖什么 → 再点「恢复」。",
      "注意：data/ 下按 home、butler 两个根分开放，恢复时会落回对应位置；不要手工改动目录结构。",
      "",
      "没被打包的东西（可重建或属于过程垃圾）：cache、logs、sessions/attachments（除非选完整）、node_modules、管家隔离区。",
    ].join(String.fromCharCode(13, 10)),
  );
  return { dir, manifestPath, manifest, failed };
}

export interface InspectItem {
  label: string;
  /** 带上 relTo/rel，还原时直接用，不必再回查清单（也避免按 label 查重）。 */
  relTo: "home" | "butler";
  rel: string;
  target: string;
  exists: boolean;
  /** 目标已存在 → 恢复会覆盖它。 */
  overwrites: boolean;
  kind: "file" | "dir";
  bytes: number;
}

export interface InspectResult {
  dir: string;
  manifest: PackManifest;
  items: InspectItem[];
  blocked: Array<{ label: string; reason: string }>;
  summary: { total: number; overwrites: number; news: number; blocked: number };
}

/** 读包并逐条对比目标：会覆盖哪些、新增哪些、哪些被安全规则拦下。 */
export function inspectPackage(dir: string, home: string, butlerRootDir: string): InspectResult | { error: string } {
  const manifestPath = p(dir, "MANIFEST.json");
  if (!pathExists(manifestPath)) return { error: "这个文件夹里没有 MANIFEST.json，不像是管家生成的搬移包" };
  const manifest = readJson<PackManifest>(manifestPath);
  if (!manifest || manifest.kind !== "dsh-butler-migration") {
    return { error: "MANIFEST.json 不是搬移包清单（kind 对不上）" };
  }
  const items: InspectItem[] = [];
  const blocked: Array<{ label: string; reason: string }> = [];
  for (const it of manifest.items ?? []) {
    const target = resolveTarget(it, home, butlerRootDir);
    if (!target) {
      blocked.push({ label: it.label, reason: "路径不安全或越界（含 ..、盘符或落在允许的根之外）" });
      continue;
    }
    const exists = pathExists(target);
    items.push({ label: it.label, relTo: it.relTo, rel: it.rel, target, exists, overwrites: exists, kind: it.kind, bytes: it.bytes });
  }
  return {
    dir,
    manifest,
    items,
    blocked,
    summary: {
      total: items.length,
      overwrites: items.filter((x) => x.overwrites).length,
      news: items.filter((x) => !x.exists).length,
      blocked: blocked.length,
    },
  };
}

export interface RestoreResult {
  restored: number;
  failed: Array<{ target: string; error: string }>;
  blocked: Array<{ label: string; reason: string }>;
  dryRun: boolean;
}

/**
 * 还原。dryRun=true 时只算不做（界面先给人看）。
 * 每条都重新过安全校验 —— 不能因为「检查时是好的」就信任包内容。
 */
export function restorePackage(dir: string, opts: {
  home: string;
  butlerRootDir: string;
  dryRun?: boolean;
}): RestoreResult | { error: string } {
  const insp = inspectPackage(dir, opts.home, opts.butlerRootDir);
  if ("error" in insp) return insp;
  const res: RestoreResult = { restored: 0, failed: [], blocked: insp.blocked, dryRun: !!opts.dryRun };
  if (opts.dryRun) {
    res.restored = insp.items.length;
    return res;
  }
  for (const it of insp.items) {
    const from = p(dir, "data", it.relTo, ...it.rel.split("/"));
    // 还原前再复核一次安全（不能因为「检查时是好的」就信任包内容）
    const target = resolveTarget({ relTo: it.relTo, rel: it.rel }, opts.home, opts.butlerRootDir);
    if (!target) {
      res.blocked.push({ label: it.label, reason: "还原前复核发现路径不安全" });
      continue;
    }
    if (!pathExists(from)) {
      res.failed.push({ target: it.target, error: "包里的内容缺失" });
      continue;
    }
    const c = copyInto(from, target, []);
    if (c.failed.length) {
      for (const f of c.failed) res.failed.push({ target: f.path, error: f.error });
      continue;
    }
    res.restored++;
  }
  return res;
}

// ── 备份目录扫描（给「定时备份/保留策略」用） ─────────────────────

export interface BackupInfo {
  dir: string;
  stamp: string;
  createdAt: string;
  bytes: number;
  fileCount: number;
  preset: DataPreset | null;
}

/** 列出某个目录下的搬移包/备份（按时间倒序）。 */
export function listBackups(rootDir: string): BackupInfo[] {
  if (!isDir(rootDir)) return [];
  const out: BackupInfo[] = [];
  for (const e of listDir(rootDir)) {
    if (!e.dir || !e.name.startsWith("DSH搬移包-")) continue;
    const dir = p(rootDir, e.name);
    const m = readJson<PackManifest>(p(dir, "MANIFEST.json"));
    out.push({
      dir,
      stamp: e.name.replace("DSH搬移包-", ""),
      createdAt: m?.createdAt ?? "",
      bytes: m?.bytes ?? 0,
      fileCount: m?.fileCount ?? 0,
      preset: (m?.preset as DataPreset) ?? null,
    });
  }
  return out.sort((a, b) => (b.createdAt || b.stamp).localeCompare(a.createdAt || a.stamp));
}
