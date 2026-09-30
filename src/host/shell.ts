/**
 * 子进程执行 —— 全项目唯一允许 spawn 的地方。
 *
 * 为什么必须统一：
 * 1) Windows 上不能让子进程闪出黑窗（旧版管家的祖传坑：弹一堆关不掉的 CMD 抢焦点）。
 * 2) 参数必须数组传递，绝不过 shell 拼接（注入风险 + 引号地狱）。
 * 3) 所有调用都要有超时与输出捕获，否则卡住就没人知道。
 *
 * ⚠️ 实测结论（2026-09-24，见 host/console-hide.ts 头注释）：
 *   Deno.Command 确实没有 windowsHide / CREATE_NO_WINDOW 选项，GUI 父进程直接
 *   spawn 控制台子进程会各自弹新窗口（实测一次体检弹 22 个 WindowsTerminal 窗）。
 *   解法不是包装子命令 —— `conhost --headless` 包装会丢失退出码（失败 128→0），
 *   体检判不了成败。正解是主进程启动时 AllocConsole + SW_HIDE 持有隐藏控制台，
 *   子进程按 Windows 原生语义【继承】它：零新窗口、退出码与管道原样。
 *   hideArgs 因此保持透传（子进程继承已藏好的控制台，无需再动）。
 *   前提：main() 必须在任何 spawn 之前调用过 hideOwnConsole()。
 */

import { log } from "../util/log.ts";
import { isWindows, p } from "../util/paths.ts";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** 逐行回调（用于实时进度）。stdout/stderr 都会被喂进来。 */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** 允许非 0 退出码而不报错（默认 false）。 */
  allowNonZero?: boolean;
  timeoutMs?: number;
  scope?: string;
  /** 外部取消信号：触发时终止子进程（与超时无关，长任务要能被用户叫停）。 */
  signal?: AbortSignal;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** 把任意命令包装成 Windows 下隐藏窗口的形式。 */
function hideArgs(cmd: string, args: string[]): { cmd: string; args: string[] } {
  if (Deno.build.os !== "windows") return { cmd, args };
  // 实测结论：无需包装 —— 主进程的隐藏控制台（console-hide.ts）已被子进程继承，
  // 且包装（conhost --headless）会丢退出码。保持透传。
  return { cmd, args };
}

/**
 * 执行命令并等待结束。
 * 默认不抛异常：调用方拿 RunResult 自行判断（很多系统命令非 0 退出是正常情况）。
 */
export async function run(
  cmd: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  const started = Date.now();
  const scope = options.scope ?? "shell";
  const wrapped = hideArgs(cmd, args);

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timeoutMs = options.timeoutMs ?? 30_000;

  // ── 收工兜底（实测 2026-09-25 修 core.update 卡死挂起）──────────────
  // 子进程退出后，它的输出管道本该在毫秒级 EOF。但 Windows 上句柄可能被孙进程
  // 拿走：powershell 用 Start-Process -NoNewWindow 起的【控制台程序】（node.exe）
  // 会一直握着写端，于是管道永远不 EOF，Promise.all 永远等不到 —— abort 只杀得掉
  // 子进程、解不开这个等待，超时形同虚设。表现：一条命令无限挂起、任务永远 running
  // （进度条一直跑）。所以这里双保险：超时后给子进程一点退出宽限，子进程退出后给
  // 管道一点 EOF 宽限，两处到点都强制收工、带着已拿到的输出返回。
  const PIPE_EOF_GRACE_MS = 2_000;
  const EXIT_GRACE_MS = 3_000;
  let releaseForce: (() => void) | null = null;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;
  let pipeHeld = false; // 子进程已退出、管道却始终不关闭
  let caught = false; // 走到 catch 说明已经打过日志，别重复报
  const forcePromise = new Promise<void>((resolve) => {
    releaseForce = resolve;
  });
  const armForce = (ms: number) => {
    if (forceTimer) return;
    forceTimer = setTimeout(() => {
      const fn = releaseForce;
      releaseForce = null;
      fn?.();
    }, ms);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    armForce(EXIT_GRACE_MS);
  }, timeoutMs);
  const onExternalAbort = () => {
    cancelled = true;
    controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) onExternalAbort();
    else options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let stdout = "";
  let stderr = "";
  let code = -1;

  try {
    const command = new Deno.Command(wrapped.cmd, {
      args: wrapped.args,
      cwd: options.cwd,
      env: options.env as Record<string, string> | undefined,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal,
    });
    const child = command.spawn();

    const pump = async (stream: ReadableStream<Uint8Array>, kind: "stdout" | "stderr") => {
      const decoder = new TextDecoder();
      let rest = "";
      for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        rest += text;
        let idx: number;
        while ((idx = rest.indexOf("\n")) >= 0) {
          const line = rest.slice(0, idx).replace(/\r$/, "");
          rest = rest.slice(idx + 1);
          if (kind === "stdout") stdout += line + "\n";
          else stderr += line + "\n";
          options.onLine?.(line, kind);
        }
      }
      if (rest) {
        if (kind === "stdout") stdout += rest;
        else stderr += rest;
        options.onLine?.(rest, kind);
      }
    };

    const pumps = Promise.all([
      pump(child.stdout, "stdout"),
      pump(child.stderr, "stderr"),
    ]);
    const settled = (async () => {
      const status = await child.status;
      code = status.code;
      // 子进程已退出：管道通常立刻 EOF。2 秒还没 EOF = 写端被孙进程占着（见上），
      // 到点收工 —— 输出该拿到的早就拿到了，剩下的是永远等不到的 EOF。
      await Promise.race([
        pumps,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            pipeHeld = true;
            resolve();
          }, PIPE_EOF_GRACE_MS);
        }),
      ]);
    })();
    await Promise.race([settled, forcePromise]);
  } catch (e) {
    const err = e as Error;
    caught = true;
    if (cancelled && !timedOut) {
      log.warn(scope, `命令已被取消：${cmd} ${args.join(" ")}`);
    } else if (err.name === "AbortError" || timedOut) {
      log.warn(scope, `命令超时（${timeoutMs}ms）：${cmd} ${args.join(" ")}`);
    } else {
      log.warn(scope, `命令执行失败：${cmd} — ${err.message}`);
      stderr += err.message;
    }
    code = -1;
  } finally {
    clearTimeout(timer);
    if (forceTimer) clearTimeout(forceTimer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
  // 强制收工的路径没走 catch，这里补一条日志（有异常时 catch 已打过）
  if (!caught && timedOut) {
    log.warn(scope, `命令超时（${timeoutMs}ms）：${cmd} ${args.join(" ")}`);
  } else if (!caught && pipeHeld) {
    log.warn(scope, `命令已退出但输出管道被孙进程占着，已按时收工：${cmd} ${args.join(" ")}`);
  }

  const result: RunResult = { code, stdout, stderr, timedOut, durationMs: Date.now() - started };
  if (cancelled && !timedOut) {
    // 被外部叫停：不算超时、不算普通失败，调用方按「已取消」处理
    log.debug(scope, `命令已取消：${cmd} ${args.join(" ")}`);
  } else if (code !== 0 && !options.allowNonZero && !timedOut) {
    log.debug(scope, `命令非零退出(${code})：${cmd} ${args.join(" ")}`);
  }
  return result;
}

/** 执行并返回是否成功 + stdout（用于"只关心成不成、结果是什么"的场景）。 */
export async function runOk(
  cmd: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<string | null> {
  const r = await run(cmd, args, { ...options, allowNonZero: true });
  return r.code === 0 ? r.stdout : null;
}

/**
 * 定位可执行文件。
 *
 * 【Windows 坑】npm / pnpm / npx 实际是 .cmd 包装脚本，直接 spawn "pnpm" 会失败
 * （CreateProcess 不认 PATHEXT）。所以必须先解析出真实路径（含 .cmd 后缀）再执行。
 *
 * 【为什么不用 where】`where` 是个子进程，每次要 ~237 ms（实测），而环境体检要
 * 定位 4 个运行时 —— 光这一步就近 1 秒。改成自己扫 PATH + PATHEXT：
 * 纯文件系统查询，无进程启动开销，结果还带缓存。
 * （Windows 文件系统大小写不敏感，所以只需按小写扩展名探测一次。）
 */
export async function locate(name: string): Promise<string | null> {
  if (isWindows) return locateOnWindows(name);
  const r = await run("sh", ["-c", `command -v ${name}`], {
    timeoutMs: 8000,
    allowNonZero: true,
    scope: "locate",
  });
  return r.stdout.trim().split(/\r?\n/).find((s) => s.trim().length > 0)?.trim() ?? null;
}

const locateCache = new Map<string, string | null>();

/** 清空定位缓存（PATH 变化、或刚装完内置工具链时必须调，否则"装好了还找不到"）。 */
export function clearLocateCache(): void {
  locateCache.clear();
}

/**
 * 额外搜索目录（管家内置工具链等）。
 *
 * 【为什么需要它】过去 locate 只扫系统 PATH，于是三类"明明装了却读不出来"全都中招：
 *   1) 装在标准位置但 PATH 是旧快照（刚装完没重开程序，explorer 不会刷新已运行进程的环境）；
 *   2) 装在用户目录（如 %LOCALAPPDATA%\Programs\Git）而安装器没写进 PATH；
 *   3) 管家自己下载的免安装版（本就不该进系统 PATH）。
 * 由上层注册目录，locate 在 PATH 之后继续找 —— 顺序仍保证"系统的优先"。
 */
let extraSearchDirs: () => string[] = () => [];
export function addSearchDirs(provider: () => string[]): void {
  extraSearchDirs = provider;
  locateCache.clear();
}

/**
 * Windows 上各运行时常见的安装位置。
 *
 * 这些目录**即便不在 PATH 里也认**：官方安装器一般会写 PATH，但写的是注册表里的
 * 系统/用户 PATH，而**已经在跑的进程拿到的是它启动那一刻的环境副本** —— 用户装完
 * Node 不重启管家，管家就永远看不见。按标准位置兜底一找，这个坑就没了。
 */
function standardSearchDirs(): string[] {
  if (!isWindows) return [];
  const env = (k: string) => Deno.env.get(k) ?? "";
  const pf = env("ProgramFiles") || "C:\\Program Files";
  const pf86 = env("ProgramFiles(x86)") || "C:\\Program Files (x86)";
  const local = env("LOCALAPPDATA") || p(env("USERPROFILE"), "AppData", "Local");
  const roaming = env("APPDATA") || p(env("USERPROFILE"), "AppData", "Roaming");

  return [
    // Node.js：官方安装器与 nvm-windows 的常见落点
    p(pf, "nodejs"),
    p(pf86, "nodejs"),
    p(roaming, "npm"), // 全局 npm 包（pnpm 装在这里时是 npm 的 shim）
    p(local, "Programs", "nodejs"),
    // Git
    p(pf, "Git", "cmd"),
    p(pf86, "Git", "cmd"),
    p(local, "Programs", "Git", "cmd"),
    // 包管理器托管的入口（winget / scoop / volta / fnm）
    p(local, "Microsoft", "WinGet", "Links"),
    p(env("USERPROFILE"), "scoop", "shims"),
    p(env("USERPROFILE"), ".volta", "bin"),
    p(local, "fnm_multishells"),
    p(roaming, "nvm"),
  ].filter((d) => d && d.length > 2);
}

function locateOnWindows(name: string): string | null {
  if (locateCache.has(name)) return locateCache.get(name) ?? null;

  const rawPath = Deno.env.get("PATH") ?? "";
  const rawExts = Deno.env.get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  const pathDirs = rawPath.split(";").map((d) => d.trim().replace(/^"|"$/g, "")).filter(Boolean);
  const dirs = [...pathDirs, ...standardSearchDirs(), ...extraSearchDirs()];
  const exts = rawExts.split(";").map((e) => e.trim()).filter(Boolean);
  const hasExt = /\.[A-Za-z0-9]{1,4}$/.test(name);

  let hit: string | null = null;
  for (const dir of dirs) {
    const clean = dir.replace(/[/\\]+$/, "");
    if (!clean) continue;
    if (hasExt) {
      if (isFileSync(p(clean, name))) {
        hit = p(clean, name);
        break;
      }
      continue;
    }
    for (const ext of exts) {
      const candidate = p(clean, name + ext);
      if (isFileSync(candidate)) {
        hit = candidate;
        break;
      }
    }
    if (hit) break;
  }

  // .cmd / .bat 也要认：Node 的 npm、pnpm 在 Windows 上都是批处理入口，
  // 过去只找 .exe 会让"npm 明明在却报缺失"。
  if (!hit && !hasExt) {
    for (const dir of dirs) {
      const clean = dir.replace(/[/\\]+$/, "");
      if (!clean) continue;
      for (const ext of [".cmd", ".bat"]) {
        const candidate = p(clean, name + ext);
        if (isFileSync(candidate)) {
          hit = candidate;
          break;
        }
      }
      if (hit) break;
    }
  }

  locateCache.set(name, hit);
  return hit;
}

/**
 * 判断一个可执行来自哪里 —— 界面要如实告诉用户"这个是系统里已有的、这个是管家内置的"。
 * 这直接决定用户该不该点「一键获取」：系统里已经有就别重复下载 60MB。
 */
export function explainOrigin(
  path: string | null,
  toolchainDirHint?: string,
): "PATH" | "标准安装位置" | "管家内置" | null {
  if (!path) return null;
  const norm = (s: string) => s.replace(/[/\\]+$/, "").toLowerCase();
  const target = norm(path);
  if (toolchainDirHint && target.startsWith(norm(toolchainDirHint).toLowerCase())) {
    return "管家内置";
  }
  const pathDirs = (Deno.env.get("PATH") ?? "")
    .split(";")
    .map((d) => norm(d.replace(/^"|"$/g, "")))
    .filter(Boolean);
  if (pathDirs.some((d) => target.startsWith(d + "\\") || target.startsWith(d + "/"))) {
    return "PATH";
  }
  if (standardSearchDirs().some((d) => target.startsWith(norm(d) + "\\"))) {
    return "标准安装位置";
  }
  return "PATH";
}

/** 本地实现而非引入 fs.ts：shell 是更底层的模块，不该反向依赖它。 */
function isFileSync(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/** 探测某个可执行文件是否可用（不抛异常）。 */
export async function which(name: string): Promise<string | null> {
  return await locate(name);
}

/**
 * cmd.exe 特殊字符闸口。【安全 · 2026-09-25 审计 SEC-02】
 *
 * 为什么必须专门拦一次：`run("cmd", ["/c", ...])` 的参数最终由 cmd.exe 再解析一遍，
 * 而 Windows 上 Deno(Rust std) 只在参数**含空格或制表符**时才加引号 —— 实测：
 *   args ['/c','echo','left-pad@1.0.0&whoami'] → 真的执行了 whoami；
 *   args ['/c','echo','x & whoami']            → 被引号化，原样输出。
 * 也就是「不含空格的 & | < > % "」会原样落进 cmd，构成命令注入。
 *
 * 这里统一拒绝。注意**不拒绝 ^ 与 ~**：`包名@^1.0.0` 是合法 semver 范围，
 * 而且 ^ 只能转义它后面那个字符 —— 真要注入仍必须带上被拒绝的 & | < > % "，
 * 所以放行 ^ 不会留下绕过口子。
 */
const CMD_METACHARS = /[&|<>%"\r\n]/;

/**
 * 「可以交给系统浏览器打开的地址」白名单。
 *
 * 【为什么单独判一次】跨源链接是页面递过来的（见 web/bar.ts 的点击拦截），
 * 最终会走 cmd /c start 打开 —— 页面能塞任何字符串进来，所以这里只放行干净的
 * http/https 地址：带引号、空格、控制字符的一律拒绝。
 * （CMD_METACHARS 那套是给 npm 参数用的，链接还要额外挡掉空格与单引号。）
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/[\s"'<>|^%`]/.test(url)) return false;
  return true;
}

export function assertSafeCmdArgs(args: readonly string[], what = "cmd 参数"): void {
  for (const a of args) {
    if (CMD_METACHARS.test(a)) {
      throw new Error(
        `${what}里出现了 cmd 特殊字符：${a} —— 已拒绝执行` +
          `（& | < > % " 在 cmd.exe 里有特殊含义，会被当成命令分隔符或变量展开）`,
      );
    }
  }
}

/**
 * 走 cmd /c 执行并强制过闸口。
 * 所有 `cmd /c` 调用都应该用它，而不是裸 `run("cmd", ...)` —— 闸口只有一处才守得住。
 */
export async function runCmd(
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  assertSafeCmdArgs(args);
  return await run("cmd", ["/c", ...args], options);
}

/**
 * 在【已知路径】上取版本号。
 *
 * 与 versionOf 的区别：不再做一次 locate。
 * versionOf 内部会自己 locate，调用方若已经 locate 过就会白起一个子进程 ——
 * 环境体检里每个运行时都要多花一次 where 的时间（实测四个运行时合计多等 1 秒以上）。
 */
export async function versionAt(
  path: string,
  args: string[] = ["--version"],
): Promise<string | null> {
  const r = await run(path, args, { timeoutMs: 15_000, allowNonZero: true, scope: "version" });
  const text = (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.trim();
  return text && text.length > 0 ? extractVersion(text) : null;
}

/** 执行可执行文件并取版本号（先定位真实路径，避免 Windows 的 .cmd 问题）。 */
export async function versionOf(
  name: string,
  args: string[] = ["--version"],
): Promise<string | null> {
  const path = await locate(name);
  if (!path) return null;
  return await versionAt(path, args);
}

/**
 * 从版本输出里挑出真正的版本号。
 *
 * 各工具输出格式完全不同：node 是 "v22.22.2"、git 是 "git version 2.55.0.windows.3"、
 * pnpm 是纯 "11.7.0"。直接展示原文会出现「Git git version 2.55.0.windows.3」这种
 * 标签与内容重复的怪东西（实测确实如此）。这里统一取第一段版本号，
 * 取不到就退回原文，保证不丢信息。
 */
export function extractVersion(text: string): string {
  const m = /\bv?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)/.exec(text);
  return m?.[1] ?? text.trim();
}

/**
 * 执行 PowerShell 脚本并取回文本。
 * 编码处理：显式设置 OutputEncoding 为 UTF8 —— 否则中文路径会被搅成乱码
 * （旧版踩过：PowerShell 重定向把中文变成问号）。
 */
export async function powershell(script: string, options: RunOptions = {}): Promise<RunResult> {
  if (Deno.build.os !== "windows") {
    return { code: -1, stdout: "", stderr: "非 Windows 平台", timedOut: false, durationMs: 0 };
  }
  const prelude =
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;";
  return await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", prelude + script],
    { timeoutMs: 20_000, allowNonZero: true, scope: "powershell", ...options },
  );
}

/** 执行 PowerShell 并把输出按 JSON 解析（失败返回 null）。 */
export async function powershellJson<T>(
  script: string,
  options: RunOptions = {},
): Promise<T | null> {
  const r = await powershell(script, options);
  const text = r.stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
