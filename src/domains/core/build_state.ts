/**
 * 「上一次全量重建」的结果台账 —— 让失败留下可读的痕迹，而不是留下一串栈帧。
 *
 * 为什么需要它：2026-10-04 的一次真实「完成更新」里，清理步骤把用户在
 * packages/client/ui-dashboard/ 下新写的插件当成残留搬走了，随后的构建
 * 找不到入口直接 ENOENT 失败；DSH 的 scripts/build.ts 又会先把构建记录
 * rmSync 掉，于是失败之后：
 *   · 用户看到的报错是 tsdown/rolldown/Node 的栈帧（真错误被淹没）；
 *   · 构建记录消失，状态页只能一遍遍催「点完成更新生成构建记录」——
 *     也就是用户说的「过好久才发现还要再点一次」。
 *
 * 这里做两件事：把「真错误」从日志里捞出来并翻译成人话；把这次重建的结局
 * 落成台账（~/.dsh-butler/last-build.json），让状态页能直接说「上次重建
 * 失败了，原因是 X」而不是让用户自己去猜。
 *
 * 所有读写都容错：台账写不进去绝不该拦住构建流程。
 */

import { p, butlerRoot } from "../../util/paths.ts";

/** 一次全量重建的结局。 */
export interface BuildAttemptState {
  /** 这次重建成没成。 */
  ok: boolean;
  /** ISO 时间戳。 */
  at: string;
  /** 被重建的 DSH 源码根。 */
  root: string;
  /** 重建时的源码提交（拿不到就是 null）。 */
  commit: string | null;
  /** 从构建日志里挑出的「真错误」行（最多 12 行）。 */
  errors: string[];
  /** 给用户看的一句话。 */
  summary: string;
}

/** 台账文件位置（管家数据目录下，跟 jobs/logs 同级）。 */
export function buildStatePath(dir: string = butlerRoot()): string {
  return p(dir, "last-build.json");
}

/** 读台账；文件不存在、坏了、字段不对都返回 null（绝不抛）。 */
export function readBuildState(dir: string = butlerRoot()): BuildAttemptState | null {
  let raw = "";
  try {
    raw = Deno.readTextFileSync(buildStatePath(dir));
  } catch {
    return null;
  }
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o?.ok !== "boolean") return null;
    const errors = Array.isArray(o.errors) ? o.errors.map((x) => String(x)).slice(0, 12) : [];
    return {
      ok: o.ok,
      at: typeof o.at === "string" ? o.at : "",
      root: typeof o.root === "string" ? o.root : "",
      commit: typeof o.commit === "string" ? o.commit : null,
      errors,
      summary: typeof o.summary === "string" ? o.summary : "",
    };
  } catch {
    return null;
  }
}

/** 写台账（时间戳缺省补 now）；失败静默 —— 台账不该拦住构建。 */
export function writeBuildState(s: BuildAttemptState, dir: string = butlerRoot()): void {
  try {
    Deno.mkdirSync(dir, { recursive: true });
    const out: BuildAttemptState = { ...s, at: s.at || new Date().toISOString() };
    Deno.writeTextFileSync(buildStatePath(dir), JSON.stringify(out, null, 2) + "\n");
  } catch {
    // 静默：管家目录没权限之类的破事，不能反过来弄挂「完成更新」。
  }
}

// ── 构建记录（.dsh-build/client-build-environment.json）的抢救 ──────

/**
 * 构建【之前】把构建记录读进内存。
 *
 * DSH 的 scripts/build.ts 在动手之前就 `rmSync` 掉构建记录（见其 :47），
 * 构建一失败它就永久缺位：`core.status` 会因此判「缺少构建记录」，
 * 界面便反复催用户「点完成更新生成构建记录」——这就是用户说的
 * 「过好久才发现还要再点一次完成更新」。
 */
export function snapshotBuildRecord(root: string): string | null {
  try {
    return Deno.readTextFileSync(p(root, ".dsh-build", "client-build-environment.json"));
  } catch {
    return null;
  }
}

/**
 * 构建失败后：记录还在就算没事；被删了就写回快照。
 * 返回一句人话说明（没做事就返回 null）。
 */
export function restoreBuildRecord(root: string, saved: string | null): string | null {
  if (saved === null) return null;
  const record = p(root, ".dsh-build", "client-build-environment.json");
  try {
    if (Deno.statSync(record).isFile) return null;
  } catch {
    // 不在了 → 继续往下写回
  }
  try {
    Deno.mkdirSync(p(root, ".dsh-build"), { recursive: true });
    Deno.writeTextFileSync(record, saved);
    return "已把上一次的构建记录放回原位（DSH 的构建脚本动手前会先删掉它），" +
      "状态页不会因此误判成「从来没构建过」而反复催你点完成更新。";
  } catch {
    return null;
  }
}

// ── 从构建日志里捞出真错误 ──────────────────────────────────────────

/**
 * 命中即视为「真错误」的特征串。
 *
 * 前五条是 v2.0.0 之前就在用的老表；后面几条是 2026-10-04 那次事故补的——
 * ENOENT / Build failed with 才是那次的真错误，老表一条都不认，于是用户只看到
 * 一屏栈帧。
 */
export const BUILD_ERROR_PATTERNS: readonly string[] = [
  "MISSING_EXPORT",
  "error TS",
  "Failed to write file",
  "拒绝访问",
  "Cannot find module",
  "ENOENT",
  "no such file or directory",
  "Could not resolve",
  "Failed to resolve",
  "is not exported by",
  "Build failed with",
  "Command failed with exit code",
];

/**
 * 按日志原始顺序挑出命中特征串的行，去掉重复。
 * 一行都没命中时返回空数组（调用方退化为「展示日志最后 N 行」）。
 */
export function pickBuildErrors(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (!BUILD_ERROR_PATTERNS.some((pat) => line.includes(pat))) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * 日志里有没有「重试也没用」的真错误。
 *
 * 用于瞬断判定：Windows 上 rolldown 并发写会随机报 `拒绝访问 (os error 5)`，
 * 重试基本就过；但只要日志里同时出现下面这些，重试就是让人干等必然失败的编译。
 * 注意【不能】把 `Build failed with` 算进来——真瞬断时 rolldown 同样会打这句。
 */
export function hasRealBuildError(text: string): boolean {
  const real = [
    "MISSING_EXPORT",
    "error TS",
    "Cannot find module",
    "ENOENT",
    "no such file or directory",
    "Could not resolve",
    "Failed to resolve",
    "is not exported by",
  ];
  return real.some((pat) => text.includes(pat));
}

/** 从 ENOENT 那种行里把文件路径抠出来（'xxx' / "xxx" / `xxx` / 盘符路径）。 */
function extractPath(line: string): string | null {
  const quoted = line.match(/[(（'"`]([^'"`)]+)[)'"`]/);
  if (quoted?.[1]) return quoted[1].trim();
  const win = line.match(/[A-Za-z]:\\[^\s'"]+/);
  return win?.[0] ?? null;
}

/**
 * 把挑出来的错误行翻译成一句人话；认不出来返回 null（调用方就不加这句）。
 * 只解释最常见、且解释完用户真能动手的那几类。
 */
export function explainBuildFailure(errors: string[], text: string): string | null {
  const joined = errors.join("\n");
  const hay = joined.length > 0 ? joined : text;

  if (/ENOENT|no such file or directory/i.test(hay)) {
    const hit = errors.find((l) => /ENOENT|no such file or directory/i.test(l)) ?? "";
    const path = extractPath(hit);
    return path
      ? `构建要读一个不存在的文件：${path}。最常见的原因是上一步「清理残留」把这个源文件搬进了隔离区（搬回来即可），其次是源码树本身缺文件。`
      : "构建要读一个不存在的文件。最常见的原因是上一步「清理残留」把源文件搬进了隔离区（搬回来即可），其次是源码树本身缺文件。";
  }
  if (/MISSING_EXPORT|is not exported by/i.test(hay)) {
    return "打包时缺一个导出（MISSING_EXPORT）：通常是某个包只剩旧的 lib/ 产物、或源码没同步。";
  }
  if (/error TS/i.test(hay)) {
    return "TypeScript 编译错误（看上面的 error TS 那几行）。";
  }
  if (/拒绝访问|os error 5/i.test(hay)) {
    return "Windows 上并发写文件被拒（瞬时竞争），重试一般能过。";
  }
  if (/Cannot find module|Could not resolve|Failed to resolve/i.test(hay)) {
    return "找不到模块：依赖没装全，或者路径写错了。";
  }
  return null;
}

/**
 * 打包器/包管理器的「总结行」——它们只说明「失败了」，不说明为什么。
 * 挑一句话结论时要避开它们，否则状态页上的原因是
 * 「ELIFECYCLE Command failed with exit code 1.」这种等于没说的东西。
 */
const GENERIC_FAILURE_LINES = [
  /\bELIFECYCLE\b/i,
  /Build failed with \d+ error/i,
  /Command failed with exit code/i,
  /^\s*ERROR\s+Error: Build failed/i,
];

/** 组装「失败原因」那种面向用户的简短结论，给状态页/日志共用。 */
export function summarizeBuildFailure(errors: string[], text: string): string {
  const specific = errors.find(
    (l) => l.trim().length > 0 && !GENERIC_FAILURE_LINES.some((re) => re.test(l)),
  );
  if (specific !== undefined) return specific;
  const first = errors[0];
  if (first !== undefined && first.length > 0) return first;
  const tail = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-1)[0];
  return tail ?? "构建以非 0 退出码结束（日志里没有可识别的错误行）";
}
