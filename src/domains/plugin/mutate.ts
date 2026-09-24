/**
 * plugin.mutate —— 插件安装 / 卸载的事务化写操作（AC-P3）。
 *
 * AC-P3 的验收原文：「卸载任一插件过程中强制杀进程，重启后 plugin.scan 结果与
 * 操作前一致（无半成品态）。」翻译成人话：**任何时刻断电，重启后要么是操作前、
 * 要么是操作后，绝不允许停在中间**。为此本文件采用「写前回滚点 + 事务日志」双保险：
 *
 *   动手顺序（install / uninstall 同构）：
 *     停服 → 创建回滚点（write-ahead，先落盘再允许动）→ 写事务日志 active.json
 *       → 改清单 / 移目录 / 调 npm → 校验 → 提交（= 删掉日志）→ 重启服务
 *   任一步失败 / 被取消 → 立即按回滚点还原 + 移回目录 + 删日志（= 回到操作前）。
 *   进程在中途被强杀（来不及走失败路径）→ active.json 留在盘上，下次启动
 *   main() 调 recoverPluginTxn() 发现它，执行同一套还原 —— 这就是 AC-P3 的闭环。
 *
 * 四个语义决定（写清免得后人猜）：
 *
 *   1) 【卸载顺序：先摘清单，再移目录】（崩溃安全序）。
 *      DSH 启动按 bundles 逐项 resolveBundleDir，清单留着已删包名 → 启动直接终止；
 *      反过来清单已摘、目录还在 → 只是该插件不激活，DSH 照常起。
 *      所以崩溃窗口的两种中间态里，只有「先摘清单」方向是安全的。
 *      移动目标路径在【移动前】就预写进日志 —— 崩溃在移动当中，恢复时也知道去哪找回。
 *
 *   2) 【register 是双名单的单一写者】。
 *      dependencies 由我们自己写（npm --prefix 也会写，但 BUTLER_SKIP_PM_OPS 隔离
 *      模式下没有 npm —— 自己写才能保证两种模式行为一致）；bundles 仍然严格过
 *      judgeLayer 守卫（声明 dsh.bundle.patch 且文件真实存在才登记）——
 *      不可作层的包登记进 bundles 会让 DSH 启动时解析失败。装了但不可作层 =
 *      进 dependencies 不进 bundles = 「已安装但不激活」，合法状态不算失败。
 *      engines 兼容性检查暂不移植（本体对探测不到的一律放行 = fail-open，
 *      不移植不改变行为方向），待 semver 解析能力就位后补。
 *
 *   3) 【事务日志单文件 + 单写者】。
 *      active.json 是全局唯一的未收尾事务标记；写互斥由引擎的 plugin 域锁保证
 *      （同域写任务互斥），启动恢复跑在任何任务之前 —— 不存在两个写者。
 *      begin 时若日志已存在 = 上次没收尾，直接拒绝开工（绝不并发动手）。
 *
 *   4) 【回滚失败不销账】。
 *      还原清单或移回目录失败 → 日志【保留】，下次启动再试；
 *      pm（npm）同步失败只降 warning —— 名单的权威状态已还原，npm 层的出入
 *      下次安装会重算，绝不让它阻塞收尾。
 *
 * 测试隔离旋钮（生产环境一律不设）：
 *   BUTLER_PROFILE_DIR      —— profile 目录整体覆盖（paths.dshProfileDir）
 *   BUTLER_TXN_DIR          —— 事务日志 + 卸载隔离区位置
 *   BUTLER_ROLLBACK_DIR     —— 回滚点存储（backup/rollback.ts）
 *   BUTLER_SKIP_PM_OPS=1    —— 跳过 npm 调用（fixture 预置 node_modules 实体）
 *   BUTLER_PM_FAIL=1        —— 注入包管理器失败（测失败回滚路径，零网络）
 *   BUTLER_SKIP_SERVICE_OPS=1 —— 不碰真机 DSH 进程
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { finding, type Finding } from "../../util/result.ts";
import { run } from "../../host/shell.ts";
import { isFile, moveSafe, pathExists, readJson, writeJsonAtomic } from "../../host/fs.ts";
import { butlerRoot, dshProfileDir, p, resolveDshSourceRoot, stampOf } from "../../util/paths.ts";
import { DSH_PORT_CANDIDATES, DSH_PORT_DEFAULT, TIMEOUTS } from "../../version.ts";
import { log } from "../../util/log.ts";
import { findDshPort } from "../../host/port.ts";
import { startDshServer, stopDshServer, type StopOutcome } from "../core/finish_update.ts";
import { applyRollbackPoint, createRollbackPoint } from "../backup/rollback.ts";
import { collectPluginFacts, judgeLayer, locateBundleDir } from "./facts.ts";
import { readPluginLists, type PluginListCheck } from "../core/status.ts";

// ── 测试隔离旋钮 ──────────────────────────────────────────────────

/** 跳过 npm 调用（fixture 预置 node_modules 实体的隔离模式）。 */
export function pmSkipped(): boolean {
  return Deno.env.get("BUTLER_SKIP_PM_OPS") === "1";
}

/** 注入包管理器失败（测失败回滚路径，零网络）。 */
function pmFailInjected(): boolean {
  return Deno.env.get("BUTLER_PM_FAIL") === "1";
}

function skipService(): boolean {
  return Deno.env.get("BUTLER_SKIP_SERVICE_OPS") === "1";
}

// ── 事务日志（journal） ────────────────────────────────────────────

/** 事务日志根（BUTLER_TXN_DIR 可覆盖供测试隔离）。 */
export function txnDir(): string {
  const override = Deno.env.get("BUTLER_TXN_DIR");
  if (override) return override;
  return p(butlerRoot(), "plugin-txn");
}

function activeJournalPath(): string {
  return p(txnDir(), "active.json");
}

/**
 * 未收尾事务的日志 —— 存在 = 上次安装/卸载走到一半被杀（AC-P3 的现场标记）。
 * quarantinedDir 在 uninstall 时【移动前】就预写：崩溃在移动当中，恢复也知道去哪找回。
 */
export interface PluginTxnJournal {
  kind: "plugin-txn";
  version: 1;
  op: "install" | "uninstall";
  name: string;
  profileDir: string;
  /** 关联的写前回滚点（还原双名单靠它）。 */
  rollbackPointId: string;
  /** 卸载时插件目录的隔离区落点；install 或「本来就没实体」时为空串。 */
  quarantinedDir: string;
  /** 卸载时插件目录的原始位置（恢复时移回这里）。 */
  originalDir: string;
  startedAt: string;
}

/** 开工前落盘日志；已有日志 = 上次没收尾，拒绝并发动手。 */
export function beginTxn(j: PluginTxnJournal): void {
  if (pathExists(activeJournalPath())) {
    throw new Error(
      "检测到上次未收尾的插件事务（可能上次安装/卸载中途被关闭）；重启管家会在启动时自动恢复收尾，之后再试",
    );
  }
  writeJsonAtomic(activeJournalPath(), j);
}

/** 刷新日志（移动目录等里程碑后立即持久化现场）。 */
export function updateActiveTxn(j: PluginTxnJournal): void {
  writeJsonAtomic(activeJournalPath(), j);
}

/**
 * 读未收尾事务日志。
 * 不存在 → null（正常）；损坏 → 抛错（绝不猜内容 —— 猜错会把现场还原到更错的位置）。
 */
export function readActiveTxn(): PluginTxnJournal | null {
  const file = activeJournalPath();
  if (!pathExists(file)) return null;
  let parsed: PluginTxnJournal;
  try {
    parsed = JSON.parse(Deno.readTextFileSync(file)) as PluginTxnJournal;
  } catch (e) {
    throw new Error(`插件事务日志损坏（无法解析）：${file} — ${(e as Error).message}`);
  }
  if (parsed.kind !== "plugin-txn" || parsed.version !== 1 || !parsed.op || !parsed.rollbackPointId) {
    throw new Error(`插件事务日志内容不合法：${file}`);
  }
  return parsed;
}

/** 提交 = 删日志（事务收尾，从此不再有恢复义务）。 */
export function commitTxn(): void {
  try {
    Deno.removeSync(activeJournalPath());
  } catch { /* 不存在即视为已收尾 */ }
}

// ── profile 双名单读写（对齐旧版 Rust register/unregister 语义） ──

interface ProfilePkg {
  dependencies?: Record<string, string>;
  dsh?: { profile?: { bundles?: string[] } };
}

export function profileManifestPath(profileDir: string): string {
  return p(profileDir, "package.json");
}

/** 改动前留 .bak-updater 备份（与旧版 Rust 同名约定，排障时找得到原件）。 */
function backupManifest(manifestPath: string): void {
  try {
    Deno.copyFileSync(manifestPath, `${manifestPath}.bak-updater`);
  } catch (e) {
    log.warn("plugin", `清单备份失败（继续执行，回滚点里还有权威副本）：${(e as Error).message}`);
  }
}

export interface RegisterOutcome {
  /** dependencies 里已有该包（登记完成）。 */
  declared: boolean;
  /** bundles 里有该包（真正激活）。 */
  activated: boolean;
  /** 不可作层的原因（可作层时为 null）。 */
  layerReason: string | null;
}

/**
 * 登记进双名单 —— 见头注释语义决定 2：dependencies 单一写者自己写，
 * bundles 严格过 judgeLayer 守卫。幂等：两份都已就位时不碰磁盘。
 */
export function registerIntoProfile(
  manifestPath: string,
  name: string,
  version: string,
  profileDir: string,
  installRoot: string | null,
): RegisterOutcome {
  const pkg = readJson<ProfilePkg>(manifestPath);
  if (!pkg) throw new Error(`profile 清单不存在或无法解析：${manifestPath}`);

  const verdict = judgeLayer(name, locateBundleDir(name, installRoot, profileDir));

  const deps = pkg.dependencies ?? {};
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  const hasDep = Object.prototype.hasOwnProperty.call(deps, name);
  const hasBundle = bundles.includes(name);
  const wantBundle = verdict.canLayer;

  // 两份都已是目标状态 → 无事可做，不产生 .bak-updater 也不重写
  if (hasDep && (hasBundle || !wantBundle)) {
    return { declared: true, activated: hasBundle || wantBundle, layerReason: verdict.reason };
  }

  backupManifest(manifestPath);
  const next: ProfilePkg = { ...pkg };
  if (!hasDep) next.dependencies = { ...deps, [name]: version };
  if (wantBundle && !hasBundle) {
    const dshSection = pkg.dsh ?? {};
    const profileSection = dshSection.profile ?? {};
    next.dsh = {
      ...dshSection,
      profile: { ...profileSection, bundles: [...bundles, name] },
    };
  }
  writeJsonAtomic(manifestPath, next);
  return { declared: true, activated: hasBundle || wantBundle, layerReason: verdict.reason };
}

/**
 * 从双名单移除 —— 必做原因（旧版 Rust file_ops 头注释原话级教训）：
 * DSH 启动按 bundles 逐项 resolveBundleDir，清单留着已删包名 → 启动直接终止。
 * 「卸载只删目录不清清单 ⇒ 下次启动必崩」是必现故障。幂等：两边都没有 = 没得摘。
 */
export function unregisterFromProfile(manifestPath: string, name: string): void {
  const pkg = readJson<ProfilePkg>(manifestPath);
  if (!pkg) throw new Error(`profile 清单不存在或无法解析：${manifestPath}`);

  const bundles = pkg.dsh?.profile?.bundles ?? [];
  const deps = pkg.dependencies ?? {};
  const inBundles = bundles.includes(name);
  const inDeps = Object.prototype.hasOwnProperty.call(deps, name);
  if (!inBundles && !inDeps) return;

  backupManifest(manifestPath);
  const next: ProfilePkg = { ...pkg };
  if (inDeps) {
    const rest = { ...deps };
    delete rest[name];
    next.dependencies = rest;
  }
  if (inBundles) {
    const dshSection = pkg.dsh ?? {};
    const profileSection = dshSection.profile ?? {};
    next.dsh = {
      ...dshSection,
      profile: { ...profileSection, bundles: bundles.filter((b) => b !== name) },
    };
  }
  writeJsonAtomic(manifestPath, next);
}

// ── 包管理器（npm） ────────────────────────────────────────────────

function pmEnvReady(): void {
  if (pmFailInjected()) throw new Error("包管理器执行失败（测试注入 BUTLER_PM_FAIL=1）");
}

async function detectNpm(): Promise<boolean> {
  const r = await run("cmd", ["/c", "npm", "--version"], {
    timeoutMs: TIMEOUTS.probe,
    allowNonZero: true,
    scope: "plugin",
  });
  return r.code === 0 && !r.timedOut;
}

function tail3(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(-3).join(" / ") || "无输出";
}

/** npm install <spec> --prefix <profile>。经 cmd /c 调起（Windows 的 npm 是 .cmd）。 */
async function pmInstall(profileDir: string, spec: string, signal?: AbortSignal): Promise<void> {
  pmEnvReady(); // 注入检查必须先于 skip —— 否则 SKIP_PM_OPS 下失败注入永远轮不到
  if (pmSkipped()) return;
  const r = await run(
    "cmd",
    ["/c", "npm", "install", spec, "--prefix", profileDir, "--no-audit", "--no-fund", "--loglevel", "error"],
    { timeoutMs: TIMEOUTS.install, allowNonZero: true, scope: "plugin", signal },
  );
  if (r.code !== 0 || r.timedOut) {
    const why = r.timedOut ? `超过 ${Math.round(TIMEOUTS.install / 60_000)} 分钟未结束` : `退出码 ${r.code}`;
    throw new Error(`npm 安装失败（${why}）：${tail3(r.stderr || r.stdout)}`);
  }
}

/** 按当前 package.json 重算依赖与锁（卸载后清理 / 回滚后对账都用它）。 */
async function pmSync(profileDir: string, signal?: AbortSignal): Promise<void> {
  pmEnvReady(); // 同 pmInstall：注入优先于 skip
  if (pmSkipped()) return;
  const r = await run(
    "cmd",
    ["/c", "npm", "install", "--prefix", profileDir, "--no-audit", "--no-fund", "--loglevel", "error"],
    { timeoutMs: TIMEOUTS.install, allowNonZero: true, scope: "plugin", signal },
  );
  if (r.code !== 0 || r.timedOut) {
    const why = r.timedOut ? `超过 ${Math.round(TIMEOUTS.install / 60_000)} 分钟未结束` : `退出码 ${r.code}`;
    throw new Error(`依赖锁同步失败（${why}）：${tail3(r.stderr || r.stdout)}`);
  }
}

// ── 插件名防呆 ────────────────────────────────────────────────────

function validPkgName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 214) return false;
  if (/\s/.test(name)) return false;
  if (name.includes("..") || name.includes("\\") || name.includes(":")) return false;
  if (name.startsWith("/") || name.startsWith(".")) return false;
  return /^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name);
}

// ── 回滚共享（失败路径与启动恢复同一套代码，行为必然一致） ─────────

interface RollbackOutcome {
  ok: boolean;
  warnings: string[];
}

/**
 * 把未收尾事务恢复到操作前状态。
 * 清单还原 + 目录移回【都成功】才收掉日志 —— 任一失败日志保留，下次启动再试（语义决定 4）。
 * pm 同步失败只降 warning，绝不阻塞收尾。
 */
async function rollbackActiveTxn(j: PluginTxnJournal): Promise<RollbackOutcome> {
  const warnings: string[] = [];

  let listOk = false;
  try {
    const res = await applyRollbackPoint(j.rollbackPointId);
    if (res.ok) listOk = true;
    else warnings.push(`还原双名单未完全成功：${res.error ?? res.stage ?? "未知阶段"}`);
  } catch (e) {
    warnings.push(`还原双名单失败：${(e as Error).message}`);
  }

  let dirOk = true;
  if (j.quarantinedDir && pathExists(j.quarantinedDir)) {
    const rec = moveSafe(j.quarantinedDir, j.originalDir);
    if (!rec.ok) {
      dirOk = false;
      warnings.push(`移回插件目录失败：${rec.error ?? "未知原因"}`);
    }
  }

  try {
    await pmSync(j.profileDir);
  } catch (e) {
    warnings.push(`依赖锁同步未完成：${(e as Error).message}（名单已是操作前状态，不影响）`);
  }

  if (listOk && dirOk) commitTxn();
  return { ok: listOk && dirOk, warnings };
}

export interface RecoverResult {
  recovered: boolean;
  op?: "install" | "uninstall";
  name?: string;
  warnings: string[];
}

/**
 * 启动恢复（main() 在 loadHistory 之后调用）：发现 active.json =
 * 上次安装/卸载中途被杀 → 执行同一套还原 → 删日志。AC-P3 的落点。
 * 日志损坏 / 还原失败 → 抛错（main 记 error；日志保留，下次再试或人工处理）。
 */
export async function recoverPluginTxn(): Promise<RecoverResult> {
  const j = readActiveTxn();
  if (!j) return { recovered: false, warnings: [] };
  const out = await rollbackActiveTxn(j);
  if (!out.ok) {
    throw new Error(
      `上次未完成的插件事务（${j.op} ${j.name}）恢复未完全成功：${out.warnings.join("；")}（事务日志已保留，下次启动会再试）`,
    );
  }
  return { recovered: true, op: j.op, name: j.name, warnings: out.warnings };
}

// ── 步骤清单 ──────────────────────────────────────────────────────

export const INSTALL_STEPS = [
  "停止 DSH 服务",
  "创建回滚点并登记事务日志",
  "安装插件包（npm）",
  "登记双名单（依赖清单 + 生效名单）",
  "校验安装结果",
  "提交事务并重启服务",
] as const;

export const UNINSTALL_STEPS = [
  "停止 DSH 服务",
  "创建回滚点并登记事务日志",
  "从双名单移除（先摘清单）",
  "把插件目录移入隔离区",
  "同步依赖锁（npm）",
  "校验卸载结果",
  "提交事务并重启服务",
] as const;

// ── preflight（写前检查，error 级直接拦截） ──────────────────────────

interface PluginInstallParams {
  name: string;
  version?: string;
}

interface PluginUninstallParams {
  name: string;
}

function commonProblems(name: string): Finding[] {
  const out: Finding[] = [];
  if (!validPkgName(name)) {
    out.push(
      finding("plugin.bad-name", "error", `插件名不合法：${name || "(空)"}`, {
        cause: "插件名要像包名（如 dsh-market 或 @scope/name），不能带路径、空格或 ..",
        impact: "按这个名去找包可能写到奇怪的位置",
        action: "检查名字拼写，填包名而不是路径",
      }),
    );
    return out;
  }

  const manifestPath = profileManifestPath(dshProfileDir());
  const pkg = readJson<ProfilePkg>(manifestPath);
  if (!pkg) {
    out.push(
      finding("plugin.no-profile", "error", "找不到插件配置（profile 的 package.json）", {
        cause: `以下位置没有可解析的 package.json：${manifestPath}`,
        impact: "双名单没地方登记，装了也不会生效",
        action: "先确认 DSH 已安装并至少启动过一次",
        evidence: [manifestPath],
      }),
    );
    return out;
  }

  if (pathExists(p(txnDir(), "active.json"))) {
    out.push(
      finding("plugin.txn-pending", "error", "上一个插件事务尚未收尾", {
        cause: "事务日志还在 —— 上次安装/卸载没走完（可能中途被关闭）",
        impact: "此时再动手，两个事务的现场会互相踩踏",
        action: "重启管家（启动时自动恢复上次事务），收尾后再试",
      }),
    );
  }
  return out;
}

async function installPreflight(params: PluginInstallParams): Promise<Finding[]> {
  const name = typeof params.name === "string" ? params.name.trim() : "";
  const out = commonProblems(name);
  if (out.length > 0) return out;

  const pkg = readJson<ProfilePkg>(profileManifestPath(dshProfileDir()));
  const deps = Object.keys(pkg?.dependencies ?? {});
  const bundles = pkg?.dsh?.profile?.bundles ?? [];
  if (deps.includes(name) || bundles.includes(name)) {
    out.push(
      finding("plugin.already-installed", "error", `插件已安装：${name}`, {
        cause: "它已经在依赖清单或生效名单里了",
        impact: "重复安装没有意义，还可能把版本搞混",
        action: "想换版本就先卸载再装；装了没生效用 plugin diagnose 查原因",
        fixAction: "plugin.diagnose",
      }),
    );
    return out;
  }

  if (!pmSkipped() && !(await detectNpm())) {
    out.push(
      finding("plugin.no-npm", "error", "未找到可用的 npm", {
        cause: "安装插件要调用 npm，但 npm --version 探测失败",
        impact: "无法下载插件包",
        action: "安装 Node.js（自带 npm）后重试",
      }),
    );
  }
  return out;
}

async function uninstallPreflight(params: PluginUninstallParams): Promise<Finding[]> {
  const name = typeof params.name === "string" ? params.name.trim() : "";
  const out = commonProblems(name);
  if (out.length > 0) return out;

  const profileDir = dshProfileDir();
  const manifestPath = profileManifestPath(profileDir);
  const pkg = readJson<ProfilePkg>(manifestPath);
  const deps = Object.keys(pkg?.dependencies ?? {});
  const bundles = pkg?.dsh?.profile?.bundles ?? [];
  const installRoot = resolveDshSourceRoot()?.path ?? null;
  const entity = locateBundleDir(name, installRoot, profileDir);

  if (!deps.includes(name) && !bundles.includes(name) && !entity) {
    out.push(
      finding("plugin.not-installed", "error", `插件未安装：${name}`, {
        cause: "依赖清单、生效名单、磁盘实体三处都找不到它",
        impact: "没有可卸载的对象",
        action: "用 plugin scan 看当前装了哪些插件",
        fixAction: "plugin.scan",
      }),
    );
  }
  return out;
}

// ── 报告 ────────────────────────────────────────────────────────────

export interface PluginOpReport {
  op: "install" | "uninstall";
  name: string;
  /** install 时的安装说明（name 或 name@version）。 */
  spec?: string;
  /** install：是否进了生效名单（可作层才算激活）。 */
  activated: boolean;
  rollbackId: string;
  /** uninstall：插件目录的隔离区落点（可整体找回），没动过实体时为 null。 */
  quarantineDir: string | null;
  lines: string[];
  warnings: string[];
  serviceWasRunning: boolean;
  serviceRestarted: boolean;
  elapsedMs: number;
}

// ── 公共流程段（收尾重启） ─────────────────────────────────────────

/** 停过的服务拉回来（失败路径与成功路径共用；root 找不到时降级为 warning）。 */
async function restartPhase(
  _ctx: ActionContext,
  report: PluginOpReport,
  line: (s: string) => void,
  restartPort: number,
  softFailWarnings: string[] | null,
): Promise<void> {
  if (!report.serviceWasRunning) {
    line("重启 DSH 服务：无需重启");
    return;
  }
  const root = resolveDshSourceRoot()?.path ?? null;
  if (!root) {
    const msg = "未找到 DSH 本体目录，无法自动重启服务 —— 请手动启动";
    if (softFailWarnings) softFailWarnings.push(msg);
    else throw new Error(`${report.op === "install" ? "插件已安装" : "插件已卸载"}，但${msg}`);
    return;
  }
  const r = await startDshServer(root, restartPort);
  if (r.ok) {
    report.serviceRestarted = true;
    line(`重启 DSH 服务：${r.message}`);
  } else if (softFailWarnings) {
    softFailWarnings.push(`重启服务失败：${r.message}（可在面板手动启动）`);
  } else {
    throw new Error(
      `${report.op === "install" ? "插件已安装" : "插件已卸载"}，但重启服务失败：${r.message}；可在面板上用「启动」按钮手动启动`,
    );
  }
}

/** 写前回滚点：清单 + （存在的）锁文件，逆操作 = 还原文件。 */
async function createManifestPoint(manifestPath: string, profileDir: string, trigger: string): Promise<string> {
  const artifacts: Array<{ path: string; mode: "copy" }> = [{ path: manifestPath, mode: "copy" }];
  const lockPath = p(profileDir, "package-lock.json");
  if (isFile(lockPath)) artifacts.push({ path: lockPath, mode: "copy" });
  const pt = await createRollbackPoint({
    kind: "plugin-set",
    trigger,
    artifacts,
    reverse: { op: "restore-files" },
  });
  return pt.id;
}

// ── install ─────────────────────────────────────────────────────────

async function runInstall(ctx: ActionContext, params: PluginInstallParams): Promise<PluginOpReport> {
  const t0 = Date.now();
  const name = (params.name ?? "").trim();
  const version = typeof params.version === "string" && params.version.trim() ? params.version.trim() : "*";
  const spec = version === "*" ? name : `${name}@${version}`;

  const profileDir = dshProfileDir();
  const manifestPath = profileManifestPath(profileDir);
  const installRoot = resolveDshSourceRoot()?.path ?? null;

  const report: PluginOpReport = {
    op: "install",
    name,
    spec,
    activated: false,
    rollbackId: "",
    quarantineDir: null,
    lines: [],
    warnings: [],
    serviceWasRunning: false,
    serviceRestarted: false,
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  // preflight 的同一道闸（run 是唯一入口，防绕过）
  if (pathExists(activeJournalPath())) {
    throw new Error("检测到上次未收尾的插件事务；重启管家会自动恢复收尾，之后再试");
  }
  if (!isFile(manifestPath)) throw new Error(`找不到插件配置：${manifestPath}`);

  // ── s1 停服 ──
  ctx.step("s1", INSTALL_STEPS[0]);
  ctx.progress(0.05);
  let stop: StopOutcome = { wasRunning: false, stopped: 0, port: null };
  if (skipService()) {
    line("停止 DSH 服务：隔离模式跳过（BUTLER_SKIP_SERVICE_OPS=1）");
  } else {
    stop = await stopDshServer();
    report.serviceWasRunning = stop.wasRunning;
    line(stop.wasRunning ? `停止 DSH 服务：已停止 ${stop.stopped} 个进程` : "停止 DSH 服务：服务未运行，跳过");
  }
  const restartPort = stop.port ?? (await findDshPort(DSH_PORT_CANDIDATES)) ?? DSH_PORT_DEFAULT;
  ctx.throwIfCancelled();

  let journal: PluginTxnJournal | null = null;
  try {
    // ── s2 写前回滚点 + 事务日志 ──
    ctx.step("s2", INSTALL_STEPS[1]);
    ctx.progress(0.1);
    const rollbackId = await createManifestPoint(manifestPath, profileDir, `plugin.install ${name}`);
    journal = {
      kind: "plugin-txn",
      version: 1,
      op: "install",
      name,
      profileDir,
      rollbackPointId: rollbackId,
      quarantinedDir: "",
      originalDir: p(profileDir, "node_modules", ...name.split("/")),
      startedAt: new Date().toISOString(),
    };
    beginTxn(journal);
    report.rollbackId = rollbackId;
    line(`回滚点 ${rollbackId} · 事务日志已落盘（中断也能恢复到操作前状态）`);
    ctx.throwIfCancelled();

    // ── s3 npm install ──
    ctx.step("s3", INSTALL_STEPS[2]);
    ctx.progress(0.3);
    if (pmSkipped() && !pmFailInjected()) {
      line(`安装插件包：隔离模式跳过 npm（${spec}）`);
    } else {
      ctx.detail(`npm install ${spec}（通常 10-120 秒）`);
      await pmInstall(profileDir, spec, ctx.signal);
      line(`安装插件包：完成（${spec}）`);
    }
    ctx.throwIfCancelled();

    // ── s4 登记双名单 ──
    ctx.step("s4", INSTALL_STEPS[3]);
    ctx.progress(0.6);
    const reg = registerIntoProfile(manifestPath, name, version, profileDir, installRoot);
    report.activated = reg.activated;
    if (reg.activated) {
      line("登记双名单：依赖清单 ✓ · 生效名单 ✓（下次启动即生效）");
    } else {
      line(`登记双名单：依赖清单 ✓ · 未进生效名单（${reg.layerReason ?? "不可作层"}）—— 已安装但不激活，属于合法状态`);
    }

    // ── s5 校验 ──
    ctx.step("s5", INSTALL_STEPS[4]);
    ctx.progress(0.8);
    const lists = readPluginLists(manifestPath, { installRoot: installRoot ?? "", profileDir });
    if (!lists) throw new Error(`登记后读不回清单：${manifestPath}`);
    if (!lists.dependencies.includes(name)) throw new Error(`校验失败：依赖清单里没有 ${name}`);
    if (reg.activated && !lists.bundles.includes(name)) throw new Error(`校验失败：生效名单里没有 ${name}`);
    if (!locateBundleDir(name, installRoot, profileDir)) {
      throw new Error(`校验失败：装完却找不到 ${name} 的包目录（node_modules 缺实体）`);
    }
    line("校验安装结果：双名单与包实体全部就位");

    // ── s6 提交 ──
    ctx.step("s6", INSTALL_STEPS[5]);
    ctx.progress(0.9);
    commitTxn();
    journal = null;
    line("提交事务：日志已收尾");
  } catch (e) {
    const orig = (e as Error).message;
    const warnings: string[] = [];
    if (journal) {
      const out = await rollbackActiveTxn(journal);
      warnings.push(...out.warnings);
    }
    if (report.serviceWasRunning) {
      await restartPhase(ctx, report, line, restartPort, warnings);
    }
    report.warnings.push(...warnings);
    const extra = warnings.length > 0 ? `；${warnings.join("；")}` : "";
    throw new Error(`${orig}${extra}（已回滚到操作前状态）`);
  }

  await restartPhase(ctx, report, line, restartPort, null);
  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// ── uninstall ────────────────────────────────────────────────────────

async function runUninstall(ctx: ActionContext, params: PluginUninstallParams): Promise<PluginOpReport> {
  const t0 = Date.now();
  const name = (params.name ?? "").trim();

  const profileDir = dshProfileDir();
  const manifestPath = profileManifestPath(profileDir);
  const installRoot = resolveDshSourceRoot()?.path ?? null;

  const report: PluginOpReport = {
    op: "uninstall",
    name,
    activated: false,
    rollbackId: "",
    quarantineDir: null,
    lines: [],
    warnings: [],
    serviceWasRunning: false,
    serviceRestarted: false,
    elapsedMs: 0,
  };
  const line = (s: string) => {
    report.lines.push(s);
    ctx.log(s);
  };

  if (pathExists(activeJournalPath())) {
    throw new Error("检测到上次未收尾的插件事务；重启管家会自动恢复收尾，之后再试");
  }
  if (!isFile(manifestPath)) throw new Error(`找不到插件配置：${manifestPath}`);

  // ── s1 停服（防「带锁删一半」） ──
  ctx.step("s1", UNINSTALL_STEPS[0]);
  ctx.progress(0.05);
  let stop: StopOutcome = { wasRunning: false, stopped: 0, port: null };
  if (skipService()) {
    line("停止 DSH 服务：隔离模式跳过（BUTLER_SKIP_SERVICE_OPS=1）");
  } else {
    stop = await stopDshServer();
    report.serviceWasRunning = stop.wasRunning;
    line(stop.wasRunning ? `停止 DSH 服务：已停止 ${stop.stopped} 个进程` : "停止 DSH 服务：服务未运行，跳过");
  }
  const restartPort = stop.port ?? (await findDshPort(DSH_PORT_CANDIDATES)) ?? DSH_PORT_DEFAULT;
  ctx.throwIfCancelled();

  let journal: PluginTxnJournal | null = null;
  try {
    // ── s2 写前回滚点 + 事务日志（隔离区路径【移动前】预写，见头注释 1） ──
    ctx.step("s2", UNINSTALL_STEPS[1]);
    ctx.progress(0.1);
    const rollbackId = await createManifestPoint(manifestPath, profileDir, `plugin.uninstall ${name}`);
    const originalDir = p(profileDir, "node_modules", ...name.split("/"));
    const quarantinedDir = p(txnDir(), "quarantine", stampOf(), ...name.split("/"));
    journal = {
      kind: "plugin-txn",
      version: 1,
      op: "uninstall",
      name,
      profileDir,
      rollbackPointId: rollbackId,
      quarantinedDir,
      originalDir,
      startedAt: new Date().toISOString(),
    };
    beginTxn(journal);
    updateActiveTxn(journal);
    report.rollbackId = rollbackId;
    line(`回滚点 ${rollbackId} · 事务日志已落盘（中断也能恢复到操作前状态）`);
    ctx.throwIfCancelled();

    // ── s3 先摘清单（崩溃安全序：清单先干净，最坏也只是「插件不激活」） ──
    ctx.step("s3", UNINSTALL_STEPS[2]);
    ctx.progress(0.35);
    unregisterFromProfile(manifestPath, name);
    line(`已从双名单移除：${name}（依赖清单 + 生效名单）`);
    ctx.throwIfCancelled();

    // ── s4 目录移入隔离区（只移动、不删除，可整体找回） ──
    ctx.step("s4", UNINSTALL_STEPS[3]);
    ctx.progress(0.55);
    if (pathExists(originalDir)) {
      const rec = moveSafe(originalDir, quarantinedDir);
      if (!rec.ok) throw new Error(`移动插件目录失败：${rec.error ?? "未知原因"}`);
      report.quarantineDir = quarantinedDir;
      line(`插件目录已移入隔离区（要找回就把里面的文件夹搬回原位）：${quarantinedDir}`);
    } else {
      report.quarantineDir = null;
      line("插件目录：本来就没有实体（只清了名单）");
    }
    ctx.throwIfCancelled();

    // ── s5 同步依赖锁（按摘除后的清单重算） ──
    ctx.step("s5", UNINSTALL_STEPS[4]);
    ctx.progress(0.7);
    if (pmSkipped() && !pmFailInjected()) {
      line("同步依赖锁：隔离模式跳过 npm");
    } else {
      await pmSync(profileDir, ctx.signal);
      line("同步依赖锁：完成");
    }
    ctx.throwIfCancelled();

    // ── s6 校验 ──
    ctx.step("s6", UNINSTALL_STEPS[5]);
    ctx.progress(0.85);
    const lists = readPluginLists(manifestPath, { installRoot: installRoot ?? "", profileDir });
    if (!lists) throw new Error(`卸载后读不回清单：${manifestPath}`);
    if (lists.dependencies.includes(name) || lists.bundles.includes(name)) {
      throw new Error(`校验失败：双名单里仍有 ${name}`);
    }
    if (pathExists(originalDir)) throw new Error(`校验失败：${name} 的包目录还在原位`);
    line("校验卸载结果：双名单已不含、目录已离开原位 —— 不会留下「启动即崩」的半成品");

    // ── s7 提交（隔离区保留，路径在报告里给出） ──
    ctx.step("s7", UNINSTALL_STEPS[6]);
    ctx.progress(0.95);
    commitTxn();
    journal = null;
    line("提交事务：日志已收尾");
  } catch (e) {
    const orig = (e as Error).message;
    const warnings: string[] = [];
    if (journal) {
      const out = await rollbackActiveTxn(journal);
      warnings.push(...out.warnings);
    }
    if (report.serviceWasRunning) {
      await restartPhase(ctx, report, line, restartPort, warnings);
    }
    report.warnings.push(...warnings);
    const extra = warnings.length > 0 ? `；${warnings.join("；")}` : "";
    throw new Error(`${orig}${extra}（已回滚到操作前状态）`);
  }

  await restartPhase(ctx, report, line, restartPort, null);
  ctx.progress(1);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// ── plugin.scan（AC-P3 的比对基准，只读） ────────────────────────────

interface PluginScanParams {
  /** 默认取真实 profile；测试传 fixture。 */
  profileDir?: string;
  /** undefined = 探测真机安装根；测试传 null。 */
  installRoot?: string | null;
}

export interface PluginScanReport {
  profileDir: string;
  manifestExists: boolean;
  summary: { deps: number; bundles: number; active: number; declaredButInactive: number };
  lists: PluginListCheck;
  layers: Array<{ name: string; canLayer: boolean; reason: string | null }>;
  inactiveLayers: Array<{ name: string; canLayer: boolean; reason: string | null }>;
  /** 每个依赖的包实体是否在磁盘上（名 → true/false）。 */
  entities: Record<string, boolean>;
  checkedAt: string;
}

/** 采集插件事实并压成稳定可比的报告（AC-P3「操作前后一致」就比它）。 */
export async function collectScanReport(params: PluginScanParams = {}): Promise<PluginScanReport> {
  const profileDir = params.profileDir ?? dshProfileDir();
  const installRoot = params.installRoot !== undefined ? params.installRoot : resolveDshSourceRoot()?.path ?? null;
  const facts = await collectPluginFacts({ profileDir, installRoot });
  const entities: Record<string, boolean> = {};
  for (const n of facts.lists.dependencies) {
    entities[n] = locateBundleDir(n, installRoot, facts.profileDir) !== null;
  }
  return {
    profileDir: facts.profileDir,
    manifestExists: facts.manifestExists,
    summary: {
      deps: facts.lists.dependencies.length,
      bundles: facts.lists.bundles.length,
      active: facts.lists.active.length,
      declaredButInactive: facts.lists.declaredButInactive.length,
    },
    lists: facts.lists,
    layers: facts.layers.map((l) => ({ name: l.name, canLayer: l.canLayer, reason: l.reason })),
    inactiveLayers: facts.inactiveLayers.map((l) => ({ name: l.name, canLayer: l.canLayer, reason: l.reason })),
    entities,
    checkedAt: facts.checkedAt,
  };
}

export const pluginScanAction: ActionDef<PluginScanParams, PluginScanReport> = {
  name: "plugin.scan",
  domain: "plugin",
  title: "扫描插件双名单",
  description:
    "只读：读取依赖清单 / 生效名单 / 作层资格 / 包实体，作为「装没装上、生没生效」的权威口径（安装卸载前后对比的基准）。",
  readonly: true,
  run: (_ctx, params) => collectScanReport(params),
};

// ── 动作定义 ────────────────────────────────────────────────────────

export const pluginInstallAction: ActionDef<PluginInstallParams, PluginOpReport> = {
  name: "plugin.install",
  domain: "plugin",
  title: "安装插件",
  description:
    "停服 → 写前回滚点 + 事务日志 → npm 安装 → 登记双名单（可作层才进生效名单）→ 校验 → 提交。任一步失败或中途被杀，重启后自动回到操作前状态。",
  readonly: false,
  steps: [...INSTALL_STEPS],
  preflight: installPreflight,
  run: (ctx, params) => runInstall(ctx, params),
  timeoutMs: TIMEOUTS.install,
};

export const pluginUninstallAction: ActionDef<PluginUninstallParams, PluginOpReport> = {
  name: "plugin.uninstall",
  domain: "plugin",
  title: "卸载插件",
  description:
    "停服 → 写前回滚点 + 事务日志 → 先摘双名单（崩溃安全序）→ 目录移入隔离区（不删除，可找回）→ 同步依赖锁 → 校验 → 提交。绝不留下「启动即崩」的半成品。",
  readonly: false,
  steps: [...UNINSTALL_STEPS],
  preflight: uninstallPreflight,
  run: (ctx, params) => runUninstall(ctx, params),
  timeoutMs: TIMEOUTS.install,
};
