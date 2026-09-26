/**
 * 可分享诊断包（P2-2）。
 *
 * 【为什么要自检】诊断包是拿出去给别人看的（发群、提 issue）。
 * 只要里面残留一个用户名、家目录、令牌或邮箱，就是一次隐私泄露 —— 而且是发出去之后才发现。
 * 所以这里除了「替换」，还多一道【写出后回读扫描】：把每个文件再读一遍，
 * 只要还能找到家目录 / 用户名 / 令牌样式 / 邮箱，就判定这份包不合格并明确报出来。
 *
 * 复用而非另写：体检的 redact()（家目录→~、用户名→%USER%、通用密钥字段→***）、
 * renderMarkdown()（体检报告直接出 Markdown）、环境的 collectEnv()、依赖的 findDependencyProblems()。
 */

import { ensureDir, isDir, listDir, writeJsonAtomic } from "../../host/fs.ts";
import { butlerRoot, homeDir, p, stampOf } from "../../util/paths.ts";
import { APP_VERSION } from "../../version.ts";
import { redact as redactBasic } from "./health.ts";

export interface RedactionContext {
  home: string;
  user: string;
}

/** 当前机器的脱敏上下文（家目录 + 用户名）。 */
export function redactionContext(): RedactionContext {
  return {
    home: homeDir(),
    user: Deno.env.get("USERNAME") ?? Deno.env.get("USER") ?? "",
  };
}

/**
 * 深度脱敏：在体检那份 redact() 之上再挡四类东西。
 *   ① 家目录的两种写法（原样与转义过的反斜杠）；
 *   ② 各类令牌样式（sk-/ghp_/github_pat_/Bearer/常见键值对）；
 *   ③ 邮箱；
 *   ④ 用户名（长度 ≥3 才替换，避免把 too/for 这类词里的片段打掉）。
 */
export function redactDeep(text: string, ctx: RedactionContext): string {
  let out = redactBasic(text ?? "");
  if (ctx.home) {
    const esc = ctx.home.replace(/\\/g, "\\\\");
    out = out.split(ctx.home).join("~");
    if (esc !== ctx.home) out = out.split(esc).join("~");
    // 统一用正斜杠的家目录也挡一下
    const fwd = ctx.home.replace(/\\/g, "/");
    if (fwd !== ctx.home) out = out.split(fwd).join("~");
  }
  if (ctx.user && ctx.user.length >= 3) {
    out = out.split(ctx.user).join("%USER%");
  }
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "%TOKEN%");
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "%TOKEN%");
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, "%TOKEN%");
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer %TOKEN%");
  out = out.replace(
    /((?:token|secret|password|passwd|api[_-]?key|authorization|credential)["']?\s*[=:]\s*)[^\s,;"'}]{6,}/gi,
    "$1***",
  );
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "%EMAIL%");
  return out;
}

export interface LeakHit {
  /** 哪个文件。 */
  file: string;
  /** 命中了什么（人话）。 */
  kind: string;
  /** 命中位置的上下文片段（已脱敏到只够定位）。 */
  sample: string;
}

/** 回读扫描：这份文本里还有没有不该出现的东西。 */
export function scanForLeaks(file: string, text: string, ctx: RedactionContext): LeakHit[] {
  const hits: LeakHit[] = [];
  const push = (kind: string, at: number) => {
    const from = Math.max(0, at - 20);
    const sample = (text.slice(from, at + 40) || "").replace(/\s+/g, " ");
    hits.push({ file, kind, sample: sample.length > 60 ? sample.slice(0, 60) + "…" : sample });
  };
  if (ctx.home) {
    const i = text.indexOf(ctx.home);
    if (i >= 0) push("残留家目录路径", i);
    else {
      const j = text.replace(/\\/g, "/").indexOf(ctx.home.replace(/\\/g, "/"));
      if (j >= 0) push("残留家目录路径（正斜杠写法）", j);
    }
  }
  if (ctx.user && ctx.user.length >= 3) {
    const i = text.indexOf(ctx.user);
    if (i >= 0) push("残留用户名", i);
  }
  for (const [re, kind] of [
    [/\bsk-[A-Za-z0-9_-]{8,}/, "疑似 OpenAI 风格密钥"],
    [/\bgh[pousr]_[A-Za-z0-9]{16,}/, "疑似 GitHub 令牌"],
    [/\bBearer\s+[A-Za-z0-9._-]{8,}/i, "疑似 Bearer 令牌"],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, "疑似邮箱"],
  ] as Array<[RegExp, string]>) {
    const m = re.exec(text);
    if (m) push(kind, m.index);
  }
  return hits;
}

export interface DiagnoseFile {
  name: string;
  content: string;
}

/** 包名：诊断包-<stamp>（跟搬家包一样是个目录，方便人直接翻看）。 */
export function diagnoseDirName(destDir: string, stamp: string): string {
  return p(destDir, "诊断包-" + stamp);
}

export function defaultDiagnoseRoot(): string {
  return p(butlerRoot(), "diagnostics");
}

export interface WriteResult {
  dir: string;
  files: Array<{ name: string; bytes: number }>;
  totalBytes: number;
  leaks: LeakHit[];
}

/**
 * 写出诊断包。
 * 【安全】先全部脱敏再落盘；落盘后逐文件回读扫描。发现残留时把 leaks 报出来（由动作层决定是否判失败）。
 */
export function writeDiagnosePackage(
  files: DiagnoseFile[],
  destDir: string,
  ctx: RedactionContext,
): WriteResult {
  const stamp = stampOf();
  const dir = diagnoseDirName(destDir, stamp);
  ensureDir(dir);
  const written: Array<{ name: string; bytes: number }> = [];
  for (const f of files) {
    const safe = redactDeep(f.content, ctx);
    Deno.writeTextFileSync(p(dir, f.name), safe);
    written.push({ name: f.name, bytes: new TextEncoder().encode(safe).length });
  }
  // 回读扫描（读的是真正落盘的内容，不是内存里的字符串）
  const leaks: LeakHit[] = [];
  for (const f of listDir(dir)) {
    if (f.dir) continue;
    let text = "";
    try {
      text = Deno.readTextFileSync(p(dir, f.name));
    } catch {
      continue;
    }
    leaks.push(...scanForLeaks(f.name, text, ctx));
  }
  const totalBytes = written.reduce((s, x) => s + x.bytes, 0);
  writeJsonAtomic(p(dir, "MANIFEST.json"), {
    schemaVersion: 1,
    kind: "dsh-butler-diagnostic",
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    files: written,
    totalBytes,
    redaction: { homeReplaced: ctx.home ? true : false, userReplaced: ctx.user.length >= 3 },
    leakCheck: leaks.length === 0 ? "passed" : `${leaks.length} 处残留`,
  });
  written.push({ name: "MANIFEST.json", bytes: Deno.statSync(p(dir, "MANIFEST.json")).size });
  return { dir, files: written, totalBytes, leaks };
}

/** 目录是否是管家生成的诊断包（供列表/校验用）。 */
export function isDiagnoseDir(dir: string): boolean {
  return isDir(dir) && (() => {
    try {
      const j = JSON.parse(Deno.readTextFileSync(p(dir, "MANIFEST.json")));
      return j && j.kind === "dsh-butler-diagnostic";
    } catch {
      return false;
    }
  })();
}
