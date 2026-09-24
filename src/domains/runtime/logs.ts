/**
 * runtime.logs —— 日志收集与定位（只读）。
 *
 * 日志源：
 *   1) DSH 启动日志   ~/.dsh/logs/startup-*.log
 *   2) 管家自身日志   ~/.dsh-butler/logs/*.log
 *   3) 任务输出       （内存环形缓冲，见 util/log.ts）
 *
 * 大文件保护：超过阈值只读尾部，避免把几百 MB 日志整个读进内存。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { finding, type Finding } from "../../util/result.ts";
import { butlerLogsDir, dshLogsDir, p } from "../../util/paths.ts";
import { isDir, isFile, listDir } from "../../host/fs.ts";
import { humanSize } from "../../host/mod.ts";
import { log } from "../../util/log.ts";

export type LogKind = "dsh-startup" | "butler" | "task" | "other";

export interface LogSource {
  id: string;
  label: string;
  path: string;
  kind: LogKind;
  sizeBytes: number;
  mtime: string | null;
}

export interface SearchHit {
  line: number;
  text: string;
}

/** 超过这个大小就只读尾部。 */
const BIG_FILE_BYTES = 4 * 1024 * 1024;
const TAIL_CHUNK_BYTES = 1024 * 1024;

export function listLogSources(): LogSource[] {
  const out: LogSource[] = [];

  const push = (dir: string, kind: LogKind, labelPrefix: string) => {
    if (!isDir(dir)) return;
    for (const e of listDir(dir)) {
      if (e.dir || !/\.(log|txt)$/i.test(e.name)) continue;
      out.push({
        id: `${kind}:${e.name}`,
        label: `${labelPrefix} · ${e.name}`,
        path: p(dir, e.name),
        kind,
        sizeBytes: e.size,
        mtime: e.mtime ? e.mtime.toISOString() : null,
      });
    }
  };

  push(dshLogsDir(), "dsh-startup", "DSH 启动日志");
  push(butlerLogsDir(), "butler", "管家日志");

  return out.sort((a, b) => (b.mtime ?? "").localeCompare(a.mtime ?? ""));
}

/** 读取文件尾部 N 行。大文件只读最后一段。 */
export function readTail(path: string, lines = 200): { lines: string[]; truncated: boolean } {
  if (!isFile(path)) return { lines: [], truncated: false };

  let text: string;
  let truncated = false;
  try {
    const size = Deno.statSync(path).size;
    if (size > BIG_FILE_BYTES) {
      const start = size - TAIL_CHUNK_BYTES;
      const file = Deno.openSync(path, { read: true });
      try {
        file.seekSync(start, Deno.SeekMode.Start);
        const buf = new Uint8Array(TAIL_CHUNK_BYTES);
        const n = file.readSync(buf) ?? 0;
        // 从中间截断可能切到多字节字符，丢弃第一行避免乱码
        const raw = new TextDecoder().decode(buf.subarray(0, n));
        text = raw.slice(raw.indexOf("\n") + 1);
      } finally {
        file.close();
      }
      truncated = true;
    } else {
      text = Deno.readTextFileSync(path);
    }
  } catch (e) {
    log.warn("logs", `读取日志失败：${path} — ${(e as Error).message}`);
    return { lines: [], truncated: false };
  }

  const all = text.split(/\r?\n/);
  return { lines: all.slice(-lines), truncated };
}

/** 在单个日志里搜索关键字。 */
export function searchInLog(
  path: string,
  query: string,
  options: { limit?: number; ignoreCase?: boolean; contextBefore?: number } = {},
): SearchHit[] {
  const limit = options.limit ?? 200;
  const needle = options.ignoreCase === false ? query : query.toLowerCase();
  const hits: SearchHit[] = [];

  const readAll = () => {
    try {
      const size = Deno.statSync(path).size;
      if (size > 32 * 1024 * 1024) {
        return readTail(path, 200_000).lines;
      }
      return Deno.readTextFileSync(path).split(/\r?\n/);
    } catch {
      return [];
    }
  };

  const lines = readAll();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const hay = options.ignoreCase === false ? line : line.toLowerCase();
    if (hay.includes(needle)) {
      hits.push({ line: i + 1, text: line.slice(0, 500) });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/**
 * 从日志文本里挑出「真正的错误行」。
 *
 * 为什么需要这个：启动日志里噪音极多，直接贴最后几行往往全是无关的瞬时输出，
 * 真正的原因被压在中间（旧版为此专门做过「从整份日志提取报错行」的修复）。
 */
export function extractErrors(lines: string[], limit = 30): string[] {
  const PATTERNS: RegExp[] = [
    /\bERR(OR)?[!:_]/i,
    /\bFAIL(ED|URE)?\b/i,
    /\bCannot find (module|package)\b/i,
    /\bMISSING_EXPORT\b/i,
    /\bENOENT\b/,
    /\bEACCES\b/,
    /\bEPERM\b/,
    /\bis not a function\b/,
    /\bUnexpected token\b/,
    /\bexited with (code|signal)\b/i,
    /等待服务|无法加载|加载失败|找不到|失败|错误|拒绝/,
  ];
  const NOISE: RegExp[] = [
    /^\s*at\s/, // 栈帧
    /^\s*$/,
    /DeprecationWarning/i,
    /ExperimentalWarning/i,
  ];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (NOISE.some((n) => n.test(line))) continue;
    if (!PATTERNS.some((p) => p.test(line))) continue;
    const key = line.trim().slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line.trim().slice(0, 400));
    if (out.length >= limit) break;
  }
  return out;
}

export interface LogsReport {
  sources: LogSource[];
  totalBytes: number;
  /** 最近几份 DSH 启动日志的错误摘录（没有则为空）。 */
  recentErrors: Array<{
    source: string;
    path: string;
    /** 日志最后写入时间。 */
    mtime: string | null;
    lines: string[];
  }>;
  findings: Finding[];
}

/** 多久以前写的启动日志算「历史」，不再当现场故障报。 */
const STALE_LOG_HOURS = 12;

function hoursAgo(ms: number): string {
  const h = ms / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟前`;
  if (h < 48) return `${Math.round(h)} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export async function collectLogs(): Promise<LogsReport> {
  const sources = listLogSources();
  const totalBytes = sources.reduce((s, x) => s + x.sizeBytes, 0);
  const findings: Finding[] = [];
  const recentErrors: LogsReport["recentErrors"] = [];

  const startups = sources.filter((s) => s.kind === "dsh-startup").slice(0, 3);
  for (const s of startups) {
    const { lines } = readTail(s.path, 3000);
    const errs = extractErrors(lines);
    if (errs.length > 0) {
      recentErrors.push({ source: s.label, path: s.path, mtime: s.mtime, lines: errs });
    }
  }

  if (recentErrors.length > 0) {
    // 关键：必须说清这些错误是什么时候的。
    // 实测本机只剩一份 09-22 的失败启动日志，而服务此刻是正常运行的 ——
    // 若只报一句"启动日志里发现错误"，用户会去修一个早就修好的问题。
    // 判据用日志自身的写入时间，不猜"当前实例启动于何时"（那需要进程创建时间，代价更高且未必准）。
    const times = recentErrors.map((r) => (r.mtime ? Date.parse(r.mtime) : NaN)).filter((n) => Number.isFinite(n));
    const newestMs = times.length > 0 ? Math.max(...times) : NaN;
    const ageMs = Number.isFinite(newestMs) ? Date.now() - newestMs : NaN;
    const isStale = Number.isFinite(ageMs) && ageMs > STALE_LOG_HOURS * 3600_000;

    const when = Number.isFinite(ageMs)
      ? `最近一次写入于 ${hoursAgo(ageMs)}`
      : "无法确定日志时间";

    findings.push(
      finding("logs.errors-present", isStale ? "info" : "warn", isStale
        ? `历史启动日志里有错误记录（${when}）`
        : "启动日志里发现错误", {
        cause: `${recentErrors.length} 份启动日志包含错误行；${when}`,
        impact: isStale
          ? "这份日志记录的是过去某次失败启动，未必代表现在还有问题 —— 若当前服务能正常使用，可据此忽略"
          : "DSH 可能启动不完整（界面能打开但功能缺失）",
        action: "查看错误详情，或运行自动诊断定位原因",
        fixAction: "runtime.diagnose",
        evidence: recentErrors.flatMap((r) =>
          [`【${new Date(r.mtime ?? 0).toLocaleString("zh-CN")}】${r.source}`, ...r.lines.slice(0, 5)]
        ),
      }),
    );
  }

  if (sources.length === 0) {
    findings.push(
      finding("logs.no-source", "info", "没有找到日志文件", {
        cause: "既没有 DSH 启动日志，也没有管家日志",
        impact: "出问题时缺少排查依据",
        action: "启动一次 DSH 服务后会自动产生启动日志",
        evidence: [dshLogsDir(), butlerLogsDir()],
      }),
    );
  }

  return { sources, totalBytes, recentErrors, findings };
}

export const runtimeLogsAction: ActionDef<{ lines?: number }, LogsReport> = {
  name: "runtime.logs",
  domain: "runtime",
  title: "日志收集与定位",
  description: "列出所有日志文件，并自动从最近的启动日志里挑出真正的错误行。只读。",
  readonly: true,
  steps: ["枚举日志源", "读取最近启动日志", "提取错误行", "汇总"],
  run: async (ctx): Promise<LogsReport> => {
    ctx.step("s1", "枚举日志源");
    ctx.progress(0.25);
    const report = await collectLogs();
    ctx.detail(`${report.sources.length} 份日志，共 ${humanSize(report.totalBytes)}`);
    ctx.throwIfCancelled();

    ctx.step("s2", "提取错误行");
    ctx.progress(0.7);
    ctx.detail(
      report.recentErrors.length > 0
        ? `从 ${report.recentErrors.length} 份日志中提取到错误`
        : "未发现明显错误",
    );
    ctx.progress(1);
    return report;
  },
};
