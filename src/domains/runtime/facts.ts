/**
 * runtime.facts —— 运行时诊断的【采集层】（只读，AC-R4 零副作用）。
 *
 * 职责边界：只把「进程 / 端口 / HTTP / 启动失败转储 / 日志命中 / 锁」
 * 收成可序列化的 RuntimeFacts；判定全在 rules.ts 纯函数里 ——
 * 规则用手搓 facts 做阴阳测试，采集层用 fixture 做零副作用测试。
 *
 * AC-R1 分层判据（三种状态的信号来源）：
 *   - 进程活着？  listDshProcesses()
 *   - 服务起了？  healthCheck(port) —— TCP+HTTP 可达即「服务起来了」
 *   - 插件树就绪？**没有**外部就绪端点（grep 全仓证实 readiness 只在
 *     桌面宿主内部），退而求其次用【启动失败转储】：startup-*.log 是
 *     DSH 启动失败时写入的诊断转储（真机 09-22 实证：头部就是
 *     `StartupError: dsh: startup failed: N required plugin did not
 *     activate` + `Failed plugins (8)`）；HTTP 通 + 新近失败转储
 *     = 「界面能开但插件树没加载完」。
 *
 * 日志证据的时效（与 logs.ts 的 STALE_LOG_HOURS=12 对齐）：
 *   fresh = 12 小时内写入（现场故障，报 error）；
 *   非 fresh = 历史现场（报 info，防止用户去修一个早就修好的问题）。
 * 启动失败转储的「现场」窗口更窄（15 分钟）：进程刚起没起来才是现场。
 */

import type { Finding } from "../../util/result.ts";
import { healthCheck, type LockInfo, scanLocks } from "./status.ts";
import { extractErrors, listLogSources, readTail } from "./logs.ts";
import { listDshProcesses } from "../../host/process.ts";
import { describePort } from "../../host/port.ts";
import { dshProfileDir } from "../../util/paths.ts";
import { DSH_PORT_CANDIDATES } from "../../version.ts";

/** 日志证据时效：12 小时内的命中算现场（与 logs.ts STALE_LOG_HOURS 一致）。 */
export const LOG_FRESH_HOURS = 12;
/** 启动失败转储的「现场」窗口：15 分钟。 */
export const DUMP_FRESH_MS = 15 * 60_000;

/** 日志规则的证据键（采集层扫正则，规则层只查命中）。 */
export type LogKey =
  | "remoteHang"
  | "doubleReg"
  | "depUnresolved"
  | "moduleTable"
  | "strictCodec"
  | "presetUnmount"
  | "saveFail";

/**
 * 日志证据的正则表 —— 每条都来自 dsh-plugin-repair 技能里【真实故障】的
 * 报错原文（回归集，见 rules.ts 头注的类型映射）：
 *   remoteHang    类型 X `pending (waiting for service: remote.<ns>)`
 *   doubleReg     类型 S/aigc `service ... has been registered at ...`
 *   depUnresolved 类型 A1/E/AG `Cannot find package/module`
 *   moduleTable   类型 W `missed the module table` / AG `does not provide an export named`
 *   strictCodec   类型 V `strict codec has no create() factory`
 *   presetUnmount 类型 C/Z `failed to mount` / `resume failed for session`
 *   saveFail      类型 P/AH 界面「保存失败，请重试」（宿主旧/客户端新、僵尸锁）
 */
export const LOG_PATTERNS: Record<LogKey, RegExp> = {
  remoteHang: /waiting for service: remote\./i,
  doubleReg: /has been registered at/i,
  depUnresolved: /Cannot find (?:package|module)/i,
  moduleTable: /missed the module table|does not provide an export named/i,
  strictCodec: /strict codec has no create\(\)/i,
  presetUnmount:
    /failed to mount|resume failed for session|names a plugin that cannot be resolved/i,
  saveFail: /保存失败/,
};

/** 启动失败转储（startup-*.log）的结构化摘要。 */
export interface StartupDump {
  present: boolean;
  /** 转储里明确出现启动失败字样（区分「失败现场」与「正常启动也写日志」）。 */
  failed: boolean;
  /** mtime 距今毫秒；读不到为 null。 */
  ageMs: number | null;
  /** Failed plugins 块里列出的插件名（最多 20 个）。 */
  failedPlugins: string[];
  /** 头部错误摘要行（extractErrors 产物，供 evidence）。 */
  lines: string[];
  path: string | null;
}

export interface RuntimeFacts {
  profileDir: string;
  procCount: number;
  pids: number[];
  /** 当前端口（识别不到为 null）。 */
  port: number | null;
  /** null = 没有可探的端口（未探或 skipProbes）。 */
  http: { reachable: boolean; status: number | null; error: string | null } | null;
  /** DSH 没在跑时，候选端口被【非 DSH】进程占用的情况。 */
  foreignPorts: Array<{ port: number; owners: string[] }>;
  /** 写锁（复用 status.scanLocks 的四态判定）。 */
  locks: Array<{ path: string; verdict: LockInfo["verdict"] }>;
  startupDump: StartupDump;
  /** 日志命中：每键最多 5 行样例，fresh=是否 12 小时内写入。 */
  logHits: Partial<Record<LogKey, Array<{ text: string; fresh: boolean }>>>;
  checkedAt: string;
}

export interface CollectOptions {
  profileDir?: string;
  /** AC-R4 测试用：跳过进程/端口/HTTP 探测，只做本地只读扫描。 */
  skipProbes?: boolean;
}

const FAILED_DUMP_RE =
  /startup failed|required plugin did not activate|Failed plugins \(|StartupError/i;
const FRESH_MS = LOG_FRESH_HOURS * 3600_000;
const HIT_MAX_PER_KEY = 5;

/** 读文件头部（失败转储的错误块在头部，readTail 读尾部会把它丢掉）。 */
function readHead(path: string, bytes = 512 * 1024): string {
  try {
    const file = Deno.openSync(path, { read: true });
    try {
      const buf = new Uint8Array(bytes);
      const n = file.readSync(buf) ?? 0;
      return new TextDecoder().decode(buf.subarray(0, n));
    } finally {
      file.close();
    }
  } catch {
    return "";
  }
}

/** 解析最新一份启动日志：是不是失败现场、哪些插件没激活。 */
function collectStartupDump(): StartupDump {
  const empty: StartupDump = {
    present: false,
    failed: false,
    ageMs: null,
    failedPlugins: [],
    lines: [],
    path: null,
  };
  const latest = listLogSources().find((s) => s.kind === "dsh-startup");
  if (!latest) return empty;

  const head = readHead(latest.path);
  const failed = FAILED_DUMP_RE.test(head);
  let ageMs: number | null = null;
  if (latest.mtime) {
    const t = Date.parse(latest.mtime);
    if (Number.isFinite(t)) ageMs = Math.max(0, Date.now() - t);
  }

  const failedPlugins: string[] = [];
  if (failed) {
    // `Failed plugins (N):` 块里 4 空格缩进的行是插件名（6 空格起是 Package:/原因）
    for (const m of head.matchAll(/^ {4}(\S[^\r\n]*)\r?$/gm)) {
      const name = m[1]?.trim();
      if (name && !failedPlugins.includes(name)) failedPlugins.push(name);
      if (failedPlugins.length >= 20) break;
    }
  }

  return {
    present: true,
    failed,
    ageMs,
    failedPlugins,
    lines: failed ? extractErrors(head.split(/\r?\n/), 10) : [],
    path: latest.path,
  };
}

/** 扫全部 DSH 启动日志的尾部，收集各证据键的命中行。 */
function collectLogHits(): RuntimeFacts["logHits"] {
  const hits: RuntimeFacts["logHits"] = {};
  for (const src of listLogSources()) {
    if (src.kind !== "dsh-startup") continue;
    const ageMs = src.mtime ? Date.now() - Date.parse(src.mtime) : Number.POSITIVE_INFINITY;
    const fresh = Number.isFinite(ageMs) ? ageMs <= FRESH_MS : false;
    const { lines } = readTail(src.path, 20_000);
    for (const raw of lines) {
      for (const [key, re] of Object.entries(LOG_PATTERNS)) {
        if (!re.test(raw)) continue;
        const k = key as LogKey;
        const arr = hits[k] ?? [];
        if (arr.length >= HIT_MAX_PER_KEY) continue;
        arr.push({ text: raw.trim().slice(0, 300), fresh });
        hits[k] = arr;
      }
    }
  }
  return hits;
}

/** 采集运行时事实（只读；AC-R4：任何路径都不产生文件变更）。 */
export async function collectRuntimeFacts(options: CollectOptions = {}): Promise<RuntimeFacts> {
  const profileDir = options.profileDir ?? dshProfileDir();

  let procCount = 0;
  let pids: number[] = [];
  let port: number | null = null;
  let http: RuntimeFacts["http"] = null;
  const foreignPorts: RuntimeFacts["foreignPorts"] = [];

  if (!options.skipProbes) {
    const procs = await listDshProcesses();
    procCount = procs.length;
    pids = procs.map((x) => x.pid);
    port = procs[0]?.port ?? null;

    // 命令行里没端口 → 候选端口找 DSH 占用；没有 DSH 进程时顺便看端口被谁占了
    for (const c of DSH_PORT_CANDIDATES) {
      if (port !== null && procCount > 0) break;
      const st = await describePort(c);
      if (st.free) continue;
      if (st.isDsh) {
        if (port === null) port = c;
      } else if (procCount === 0) {
        foreignPorts.push({ port: c, owners: st.owners.map((o) => `${o.name}(PID ${o.pid})`) });
      }
    }
    // 有端口就探 HTTP（AC-R1 第二层）
    if (port !== null) {
      const h = await healthCheck(port);
      http = { reachable: h.reachable, status: h.status, error: h.error ?? null };
    }
  }

  const lockInfos = await scanLocks(profileDir).catch(() => [] as LockInfo[]);
  const startupDump = collectStartupDump();
  const logHits = collectLogHits();

  return {
    profileDir,
    procCount,
    pids,
    port,
    http,
    foreignPorts,
    locks: lockInfos.map((l) => ({ path: l.file, verdict: l.verdict })),
    startupDump,
    logHits,
    checkedAt: new Date().toISOString(),
  };
}

/** 诊断结果（runtime.diagnose 的返回体）。 */
export interface RuntimeDiagnoseResult {
  facts: RuntimeFacts;
  findings: Finding[];
  health: "ok" | "warn" | "error";
  rulesRun: number;
}

// runRules 从 rules.ts 注入到这里会造成 facts↔rules 循环 —— diagnose 动作
// 单独放 diagnose.ts，由它同时 import 两者。
