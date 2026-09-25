/**
 * 日志：环形缓冲 + 订阅推送 + 文件落盘。
 *
 * 用途：
 * - 任务步骤输出的实时推送（经 SSE 到界面）
 * - 自身日志落盘（~/.dsh-butler/logs/），轮转
 * - 崩溃现场保留（保留最后 N 行，异常时可整体导出）
 */

import { shouldLogToConsole } from "./runtime-kind.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLine {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  /** 关联任务 id（若来自某个 Job）。 */
  jobId?: string;
}

type Sink = (line: LogLine) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  #ring: LogLine[] = [];
  #cap = 2000;
  #sinks = new Set<Sink>();
  #minLevel: LogLevel = "info";
  #file?: Deno.FsFile;
  #filePath?: string;
  #fileLines = 0;
  #maxFileLines: number;

  /** maxFileLines 可注入，只为测试轮转（线上永远用默认 20000 行）。 */
  constructor(opts: { maxFileLines?: number } = {}) {
    this.#maxFileLines = opts.maxFileLines ?? 20_000;
  }

  setMinLevel(level: LogLevel): void {
    this.#minLevel = level;
  }

  attachFile(path: string): void {
    try {
      Deno.mkdirSync(path.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
      this.#file = Deno.openSync(path, { create: true, append: true, write: true });
      this.#filePath = path;
    } catch (e) {
      this.#emit({
        ts: new Date().toISOString(),
        level: "warn",
        scope: "log",
        msg: `日志文件不可写，仅保留内存缓冲：${(e as Error).message}`,
      });
    }
  }

  subscribe(sink: Sink): () => void {
    this.#sinks.add(sink);
    return () => this.#sinks.delete(sink);
  }

  /** 最近 N 行（用于崩溃现场导出与界面「查看管家日志」）。 */
  tail(n = 200): LogLine[] {
    return this.#ring.slice(-n);
  }

  debug(scope: string, msg: string, jobId?: string): void {
    this.#emit({ ts: new Date().toISOString(), level: "debug", scope, msg, jobId });
  }
  info(scope: string, msg: string, jobId?: string): void {
    this.#emit({ ts: new Date().toISOString(), level: "info", scope, msg, jobId });
  }
  warn(scope: string, msg: string, jobId?: string): void {
    this.#emit({ ts: new Date().toISOString(), level: "warn", scope, msg, jobId });
  }
  error(scope: string, msg: string, jobId?: string): void {
    this.#emit({ ts: new Date().toISOString(), level: "error", scope, msg, jobId });
  }

  #emit(line: LogLine): void {
    if (LEVEL_ORDER[line.level] < LEVEL_ORDER[this.#minLevel]) return;

    this.#ring.push(line);
    if (this.#ring.length > this.#cap) this.#ring.shift();

    for (const sink of this.#sinks) {
      try {
        sink(line);
      } catch {
        // 单个订阅者出错不能影响其它订阅者
      }
    }

    if (this.#file) {
      const text = `${line.ts} [${line.level.toUpperCase()}] (${line.scope}) ${line.msg}\n`;
      try {
        this.#file.writeSync(new TextEncoder().encode(text));
        if (++this.#fileLines >= this.#maxFileLines) this.#rotate();
      } catch {
        // 落盘失败不影响主流程
      }
    }

    // 开发态打到控制台，便于 `deno run` 排查。
    //
    // 【必须全部走 stderr】：stdout 是留给机器可读输出的（`--json` 契约是
    // "stdout 只出 JSON"）。若日志走 stdout，`dsh-butler core status --json | 解析器`
    // 会在第一行就炸（实测：SyntaxError: Unexpected token 'i'）。
    // 终端里 stderr 与 stdout 都显示，人眼无差别；管道里才有差别。
    // 有没有人在看控制台？判据是 stdout 是不是终端，而不是"是不是编译态"——
    // `deno desktop --hmr` 同样是 standalone，但确实开着终端，按 standalone 判会误伤。
    // 详见 util/runtime-kind.ts 的实测表。
    if (shouldLogToConsole()) {
      console.error(`[${line.level}] ${line.scope}`, line.msg);
    }
  }

  /**
   * 文件轮转：关旧 → 改名成 .1 → 重开一个新文件。
   *
   * 【2026-09-25 审计 Q-06】旧实现只 close 并把 #file 置空，既不重开也不改名 ——
   * 于是本进程写满 20000 行之后**再也不写日志文件**，现场在无声中断链。
   */
  #rotate(): void {
    const path = this.#filePath;
    try {
      this.#file?.close();
    } catch { /* ignore */ }
    this.#file = undefined;
    this.#fileLines = 0;
    if (!path) return;
    try {
      const rolled = `${path}.1`;
      try {
        Deno.removeSync(rolled);
      } catch { /* 上一份不存在，正常 */ }
      Deno.renameSync(path, rolled);
      this.#file = Deno.openSync(path, { create: true, append: true, write: true });
    } catch (e) {
      this.#file = undefined;
      this.#emit({
        ts: new Date().toISOString(),
        level: "warn",
        scope: "log",
        msg: `日志轮转失败，后续只保留内存缓冲：${(e as Error).message}`,
      });
    }
  }
}

export const log = new Logger();
