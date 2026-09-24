/**
 * 统一「回滚点（Rollback Point）」模型 —— 方案 §8.1 / §8.2。
 *
 * 为什么要有它：旧版三套各自为政的备份（snapshot / offline_pack / .updater_backups）
 * 谁都不管别人，回滚语义全靠人脑。S3 起所有写操作统一走这里：
 *   动手【之前】先落盘回滚点（write-ahead），失败或用户反悔时按点还原。
 *
 * 存储布局（~/.dsh-butler/rollback/，BUTLER_ROLLBACK_DIR 可覆盖供测试隔离）：
 *   index.json            —— 全部回滚点元数据（原子写：同目录 temp → rename）
 *   <id>/<序号>-<原文件名>  —— mode=copy 条目的内容副本
 *
 * 生命周期（§8.2）：
 *   create（写前落盘）→ checkIntegrity（应用前校验）→ apply（校验 → 逆操作 →
 *   应用后验证 → 更新 verified）→ prune（保留 10 个 / 2GB，先删最旧且已验证）
 *
 * 几个语义决定（写清免得后人猜）：
 *   1) verified = 最近一次验证的结果。创建时回读校验通过 → true；
 *      apply 的完整性校验失败 / 应用后验证不过 → 置 false 并【保留】回滚点
 *      （方案原话：验证失败则保留回滚点并告警，不静默成功）。
 *   2) create 先复制内容、最后才写索引 —— 中途崩溃最多留个无主目录
 *      （prune 会顺手清），绝不会出现「索引里有、内容缺半截」的坏回滚点。
 *   3) 「未验证的永不自动删」只约束 prune；delete 是显式人工动作，不受此限。
 *   4) apply 只做【文件级】逆操作；真正的重装 / 重建（pnpm install、构建）
 *      由上层任务（#13/#14）接着编排 —— 这里不越俎代庖。
 *   5) prune 会改共享存储，调用方须持跨版本写锁（write-lock.ts）；
 *      当前它只作为生命周期原语存在，接线在后续任务。
 */

import { p, basename, butlerRoot, dirname } from "../../util/paths.ts";
import { isFile, pathExists, moveSafe, readJson, removeRecursive, writeJsonAtomic } from "../../host/fs.ts";
import { run } from "../../host/shell.ts";

// ── 模型（方案 §8.1，字段与方案一一对应） ─────────────────────────

export type RollbackKind = "core-build" | "plugin-set" | "config" | "snapshot" | "env";

export const ROLLBACK_KINDS: RollbackKind[] = ["core-build", "plugin-set", "config", "snapshot", "env"];

export type ArtifactMode = "copy" | "git-ref" | "manifest-only";

export interface RollbackArtifact {
  /** 原始绝对路径（copy/manifest-only = 文件路径；git-ref = 仓库根）。 */
  path: string;
  /** 内容哈希（git-ref 存解析后的 commit）。 */
  sha256: string;
  size: number;
  mode: ArtifactMode;
}

/** 逆操作配方（声明式，不存代码 —— 方案 §8.1）。 */
export type ReverseOp =
  | { op: "restore-files" }
  | { op: "git-reset"; commit: string; quarantine: string }
  | { op: "npm-reinstall"; pkgJson: string; lockfile: string }
  | { op: "rewrite-manifest"; file: string };

export interface RollbackPoint {
  id: string;
  kind: RollbackKind;
  createdAt: string;
  /** 创建原因："core.finishUpdate 前置" / "手动创建" / … */
  trigger: string;
  jobId?: string;
  artifacts: RollbackArtifact[];
  reverse: ReverseOp;
  /** 最近一次验证（创建回读 / 应用后）是否通过。 */
  verified: boolean;
  sizeBytes: number;
  expiresAt?: string;
}

// ── 存储路径 ──────────────────────────────────────────────────────

/** 回滚存储根（测试用 BUTLER_ROLLBACK_DIR 覆盖，绝不污染真实存储）。 */
export function rollbackRoot(): string {
  const override = Deno.env.get("BUTLER_ROLLBACK_DIR");
  if (override) return override;
  return p(butlerRoot(), "rollback");
}

function indexPath(): string {
  return p(rollbackRoot(), "index.json");
}

/** 某条目副本在存储里的落点（序号 = 在 artifacts 数组里的位置，持久稳定）。 */
export function storedArtifactPath(id: string, index: number, originalPath: string): string {
  return p(rollbackRoot(), id, `${index}-${basename(originalPath)}`);
}

// ── 索引读写 ──────────────────────────────────────────────────────

function loadIndex(): RollbackPoint[] {
  const file = indexPath();
  if (!pathExists(file)) return [];
  const raw = readJson<RollbackPoint[]>(file);
  // 损坏的索引宁可炸出来也不猜：静默返回 [] 会让「回滚点全没了」看起来像从没创建过
  if (!raw || !Array.isArray(raw)) throw new Error(`回滚点索引损坏（无法解析）：${file}`);
  return raw;
}

function saveIndex(points: RollbackPoint[]): void {
  writeJsonAtomic(indexPath(), points);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // Uint8Array 泛型（ArrayBufferLike）与 BufferSource（ArrayBuffer）在新版 TS 下不直通，断言收口
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newId(existing: Set<string>): string {
  const z = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}T${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  for (let i = 0; i < 16; i++) {
    const id = `rp-${stamp}-${crypto.randomUUID().slice(0, 6)}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("无法生成唯一的回滚点 id（同秒内碰撞 16 次）");
}

// ── create：write-ahead，先落盘再允许动手 ─────────────────────────

export interface CreateSpec {
  kind: RollbackKind;
  trigger: string;
  jobId?: string;
  /**
   * 要备份的条目：
   *   copy / manifest-only — path 必须是已存在的文件；
   *   git-ref              — path 是仓库根，ref 是要钉住的引用（缺省 HEAD）。
   */
  artifacts: Array<{ path: string; mode: ArtifactMode; ref?: string }>;
  reverse: ReverseOp;
  expiresAt?: string;
}

export async function createRollbackPoint(spec: CreateSpec): Promise<RollbackPoint> {
  if (spec.artifacts.length === 0) throw new Error("回滚点至少要有一个备份条目");

  const index = loadIndex();
  const id = newId(new Set(index.map((x) => x.id)));
  const dir = p(rollbackRoot(), id);
  Deno.mkdirSync(dir, { recursive: true });

  try {
    const artifacts: RollbackArtifact[] = [];
    let sizeBytes = 0;

    for (const [i, a] of spec.artifacts.entries()) {
      if (a.mode === "git-ref") {
        const ref = (a.ref ?? "HEAD").trim();
        const r = await run("git", ["-C", a.path, "rev-parse", "--verify", `${ref}^{commit}`], {
          timeoutMs: 15_000,
          allowNonZero: true,
          scope: "rollback",
        });
        if (r.code !== 0) {
          throw new Error(`git 引用无法解析（${ref}）：${r.stderr.trim() || `仓库不可用（${a.path}）`}`);
        }
        artifacts.push({ path: a.path, sha256: r.stdout.trim(), size: 0, mode: "git-ref" });
        continue;
      }

      if (!isFile(a.path)) throw new Error(`备份源不存在或不是文件：${a.path}`);
      const bytes = await Deno.readFile(a.path);
      const sha = await sha256Bytes(bytes);

      if (a.mode === "copy") {
        const dest = storedArtifactPath(id, i, a.path);
        await Deno.writeFile(dest, bytes);
        // 回读校验：写进去的必须与源一致 —— write-ahead 的「完整」不是说说而已
        const back = await Deno.readFile(dest);
        if ((await sha256Bytes(back)) !== sha) throw new Error(`备份写入校验失败：${a.path}`);
        sizeBytes += bytes.length;
      }
      // manifest-only：只记哈希不复制（记录型，体积计 0）
      artifacts.push({ path: a.path, sha256: sha, size: bytes.length, mode: a.mode });
    }

    const point: RollbackPoint = {
      id,
      kind: spec.kind,
      createdAt: new Date().toISOString(),
      trigger: spec.trigger,
      jobId: spec.jobId,
      artifacts,
      reverse: spec.reverse,
      verified: true,
      sizeBytes,
      expiresAt: spec.expiresAt,
    };

    // 索引最后写：内容不齐绝不见于索引（见头注释第 2 条）
    index.push(point);
    saveIndex(index);
    return point;
  } catch (e) {
    // 自己造的半成品自己清：失败路径不留孤儿目录
    removeRecursive(dir);
    throw e;
  }
}

// ── list / get ────────────────────────────────────────────────────

export function listRollbackPoints(): RollbackPoint[] {
  return loadIndex().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRollbackPoint(id: string): RollbackPoint | null {
  return loadIndex().find((x) => x.id === id) ?? null;
}

// ── 完整性校验（应用前的门票） ─────────────────────────────────────

export interface IntegrityReport {
  ok: boolean;
  problems: string[];
}

export async function checkIntegrity(pt: RollbackPoint): Promise<IntegrityReport> {
  const problems: string[] = [];

  for (const [i, a] of pt.artifacts.entries()) {
    if (a.mode === "manifest-only") continue; // 记录型，没有实体可校验

    if (a.mode === "git-ref") {
      const r = await run("git", ["-C", a.path, "cat-file", "-e", `${a.sha256}^{commit}`], {
        timeoutMs: 15_000,
        allowNonZero: true,
        scope: "rollback",
      });
      if (r.code !== 0) problems.push(`git 对象已不可用：${a.path} @ ${a.sha256.slice(0, 12)}…`);
      continue;
    }

    const stored = storedArtifactPath(pt.id, i, a.path);
    if (!isFile(stored)) {
      problems.push(`备份副本缺失：${stored}`);
      continue;
    }
    const sha = await sha256Bytes(await Deno.readFile(stored));
    if (sha !== a.sha256) problems.push(`备份副本已被改动：${a.path}`);
  }

  return { ok: problems.length === 0, problems };
}

/** 更新某点的 verified 标记（持久化）。 */
function setVerified(id: string, verified: boolean): void {
  const index = loadIndex();
  const hit = index.find((x) => x.id === id);
  if (!hit) return;
  hit.verified = verified;
  saveIndex(index);
}

// ── apply：校验 → 逆操作 → 应用后验证 → 更新 verified ──────────────

export interface ApplyResult {
  ok: boolean;
  /** 失败发生在哪一段；成功为 null。 */
  stage: "integrity" | "reverse" | "verify" | null;
  verified: boolean;
  problems?: string[];
  warnings?: string[];
  error?: string;
}

export interface ApplyOptions {
  /** 领域级验证（core.verify / plugin.scan…），由上层按 kind 提供；不提供则只做内置还原验证。 */
  verify?: () => boolean | Promise<boolean>;
}

interface ReverseOutcome {
  warnings: string[];
  /** 本轮回实际动过的文件（应用后逐个回读验哈希）。 */
  restoredFiles: Array<{ path: string; sha256: string }>;
  /** git-reset 的落点（应用后比对 HEAD）。 */
  headExpect?: { repo: string; commit: string };
}

export async function applyRollbackPoint(id: string, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const pt = getRollbackPoint(id);
  if (!pt) throw new Error(`回滚点不存在：${id}`);

  // ① 完整性：备份本身坏了就不许动系统（这是「先校验再还原」的底线）
  const integrity = await checkIntegrity(pt);
  if (!integrity.ok) {
    setVerified(id, false);
    return {
      ok: false,
      stage: "integrity",
      verified: false,
      problems: integrity.problems,
      error: "备份内容完整性校验未通过，已中止（未执行任何逆操作）",
    };
  }

  // ② 逆操作（文件级）
  let outcome: ReverseOutcome;
  try {
    outcome = await executeReverse(pt);
  } catch (e) {
    setVerified(id, false);
    return { ok: false, stage: "reverse", verified: false, error: (e as Error).message };
  }

  // ③ 内置应用后验证：还原的文件回读比哈希 / git 落点比 HEAD
  const postProblems: string[] = [];
  for (const f of outcome.restoredFiles) {
    if (!isFile(f.path)) {
      postProblems.push(`还原后文件不存在：${f.path}`);
      continue;
    }
    const sha = await sha256Bytes(await Deno.readFile(f.path));
    if (sha !== f.sha256) postProblems.push(`还原后内容与备份不一致：${f.path}`);
  }
  const head = outcome.headExpect;
  if (head) {
    const r = await run("git", ["-C", head.repo, "rev-parse", "HEAD"], {
      timeoutMs: 15_000,
      allowNonZero: true,
      scope: "rollback",
    });
    if (r.code !== 0 || r.stdout.trim() !== head.commit) {
      postProblems.push(`git 未落到目标提交（期望 ${head.commit.slice(0, 12)}…）`);
    }
  }
  if (postProblems.length > 0) {
    setVerified(id, false);
    return {
      ok: false,
      stage: "verify",
      verified: false,
      problems: postProblems,
      warnings: outcome.warnings,
      error: "文件已还原，但应用后验证未通过 —— 回滚点已保留，可再次尝试",
    };
  }

  // ④ 领域级验证（调用方按 kind 提供；不过 → 保留回滚点、告警、绝不静默成功）
  if (opts.verify) {
    let passed = false;
    try {
      passed = await opts.verify();
    } catch (e) {
      setVerified(id, false);
      return {
        ok: false,
        stage: "verify",
        verified: false,
        warnings: outcome.warnings,
        error: `应用后验证异常：${(e as Error).message} —— 回滚点已保留`,
      };
    }
    if (!passed) {
      setVerified(id, false);
      return {
        ok: false,
        stage: "verify",
        verified: false,
        warnings: outcome.warnings,
        error: "文件已还原，但领域验证未通过 —— 回滚点已保留，请人工检查",
      };
    }
  }

  setVerified(id, true);
  return { ok: true, stage: null, verified: true, warnings: outcome.warnings };
}

async function executeReverse(pt: RollbackPoint): Promise<ReverseOutcome> {
  const out: ReverseOutcome = { warnings: [], restoredFiles: [] };
  const rev = pt.reverse;

  /** 从 copy 副本把单个文件还原回原位。 */
  const restoreOne = (target: string): void => {
    const art = pt.artifacts.find((x) => x.mode === "copy" && x.path === target);
    if (!art) throw new Error(`回滚点未包含该文件的副本：${target}`);
    const i = pt.artifacts.indexOf(art);
    const stored = storedArtifactPath(pt.id, i, target);
    if (!isFile(stored)) throw new Error(`备份副本缺失：${stored}`);
    Deno.mkdirSync(dirname(target), { recursive: true });
    Deno.copyFileSync(stored, target);
    out.restoredFiles.push({ path: target, sha256: art.sha256 });
  };

  switch (rev.op) {
    case "restore-files": {
      for (const [i, a] of pt.artifacts.entries()) {
        if (a.mode !== "copy") continue;
        const stored = storedArtifactPath(pt.id, i, a.path);
        if (!isFile(stored)) throw new Error(`备份副本缺失：${stored}`);
        Deno.mkdirSync(dirname(a.path), { recursive: true });
        Deno.copyFileSync(stored, a.path);
        out.restoredFiles.push({ path: a.path, sha256: a.sha256 });
      }
      break;
    }

    case "git-reset": {
      const gitArt = pt.artifacts.find((a) => a.mode === "git-ref");
      if (!gitArt) throw new Error("git-reset 逆操作缺少 git-ref 条目（不知道仓库在哪）");

      const r = await run("git", ["-C", gitArt.path, "reset", "--hard", rev.commit], {
        timeoutMs: 60_000,
        allowNonZero: true,
        scope: "rollback",
      });
      if (r.code !== 0) throw new Error(`git reset 失败：${r.stderr.trim() || `退出码 ${r.code}`}`);

      // 隔离区内容移回仓库根：只移动不删除（同名已存在 → 跳过并告警，绝不覆盖）
      if (rev.quarantine && pathExists(rev.quarantine)) {
        for (const e of Deno.readDirSync(rev.quarantine)) {
          if (e.name === "MANIFEST.json") continue; // 隔离清单是记录，不还原
          const from = p(rev.quarantine, e.name);
          const to = p(gitArt.path, e.name);
          if (pathExists(to)) {
            out.warnings.push(`还原时发现同名已存在，跳过：${e.name}`);
            continue;
          }
          const rec = moveSafe(from, to);
          if (!rec.ok) out.warnings.push(`移回失败：${e.name} — ${rec.error}`);
        }
      }

      out.headExpect = { repo: gitArt.path, commit: rev.commit };
      break;
    }

    case "npm-reinstall": {
      // 只还原清单两件套（文件级）；真正 pnpm install 由上层任务接着做
      restoreOne(rev.pkgJson);
      restoreOne(rev.lockfile);
      break;
    }

    case "rewrite-manifest": {
      restoreOne(rev.file);
      break;
    }
  }

  return out;
}

// ── delete（显式人工动作，不受「未验证永不删」约束） ─────────────────

export function deleteRollbackPoint(id: string): boolean {
  const index = loadIndex();
  const next = index.filter((x) => x.id !== id);
  if (next.length === index.length) return false;
  saveIndex(next);
  removeRecursive(p(rollbackRoot(), id));
  return true;
}

// ── prune：保留 10 个 / 2GB，先删最旧且已验证；未验证永不自动删 ─────

export const PRUNE_KEEP = 10;
export const PRUNE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface PruneOptions {
  keep?: number;
  maxBytes?: number;
}

export interface PruneResult {
  removed: string[];
  kept: number;
  freedBytes: number;
}

export function pruneRollbackPoints(opts: PruneOptions = {}): PruneResult {
  const keep = opts.keep ?? PRUNE_KEEP;
  const maxBytes = opts.maxBytes ?? PRUNE_MAX_BYTES;

  const index = loadIndex();
  // 旧 → 新遍历：淘汰永远先动最旧的
  const sorted = [...index].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let total = index.reduce((s, x) => s + x.sizeBytes, 0);

  const removedIds: string[] = [];
  let freed = 0;
  for (let i = 0; i < sorted.length; i++) {
    const pt = sorted[i];
    if (!pt) continue;
    const beyondKeep = i < sorted.length - keep;
    const overCap = total > maxBytes;
    const expired = pt.expiresAt !== undefined && Date.parse(pt.expiresAt) <= Date.now();
    if (!beyondKeep && !overCap && !expired) continue;
    if (!pt.verified) continue; // 未验证永不自动删 —— 安全 > 配额（宁可超一点）
    removedIds.push(pt.id);
    total -= pt.sizeBytes;
    freed += pt.sizeBytes;
  }

  const survivors = index.filter((x) => !removedIds.includes(x.id));
  if (removedIds.length > 0) {
    saveIndex(survivors);
    for (const id of removedIds) removeRecursive(p(rollbackRoot(), id));
  }
  sweepOrphanDirs(new Set(survivors.map((x) => x.id)));

  return { removed: removedIds, kept: survivors.length, freedBytes: freed };
}

/** 清掉「复制了内容但没来得及写索引」的无主目录（create 中途崩溃的遗留）。 */
function sweepOrphanDirs(live: Set<string>): void {
  try {
    for (const e of Deno.readDirSync(rollbackRoot())) {
      if (e.isDirectory && !live.has(e.name)) removeRecursive(p(rollbackRoot(), e.name));
    }
  } catch { /* 根目录不存在 = 没什么可清 */ }
}
