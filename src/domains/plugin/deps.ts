/**
 * 依赖冲突可视化：把「谁和谁要的版本对不上」直接算出来。
 *
 * 【为什么要做】2026-09-25 那次事故：用户装插件时报 ERESOLVE，刷了一屏 npm 堆栈，
 * 真实原因只有一句「两个插件要的 @deepseek-ai/dsh-scope 版本不一样」。
 * 这类冲突在 DSH 插件生态里非常普遍（第三方插件各自声明 peer 依赖），
 * 但 npm 只会用一条英文错误告诉你「有冲突」，不会告诉你是谁跟谁冲突。
 *
 * 这里不联网、不调 npm：直接读 profile/node_modules 里每个包的 package.json，
 * 按 peerDependencies 声明与实际装上的版本做核对。纯逻辑，好测。
 */

import { isFile, listDir, readJson } from "../../host/fs.ts";
import { p } from "../../util/paths.ts";

// ── 最小 semver 判断（只覆盖 peer 依赖里真正会用到的写法） ──────────

export interface ParsedVersion {
  nums: number[];
  pre: string;
}

export function parseVersion(v: string): ParsedVersion | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(v).trim().replace(/^[=v\s]+/, ""));
  if (!m) return null;
  return {
    nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)],
    pre: m[4] ?? "",
  };
}

/** a>b 返回 1，相等 0，小于 -1；预发布小于同号正式版（与 npm 一致）。 */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 3; i++) {
    if (A.nums[i]! !== B.nums[i]!) return A.nums[i]! > B.nums[i]! ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}

function bump(nums: number[], index: number): number[] {
  const out = nums.slice();
  out[index] = (out[index] ?? 0) + 1;
  for (let i = index + 1; i < 3; i++) out[i] = 0;
  return out;
}

function cmpTo(base: number[], boundary: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (base[i]! !== boundary[i]!) return base[i]! > boundary[i]! ? 1 : -1;
  }
  return 0;
}

function cmpVersionToNums(v: ParsedVersion, b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (v.nums[i]! !== b[i]!) return v.nums[i]! > b[i]! ? 1 : -1;
  }
  return 0;
}

/**
 * 版本是否落在范围里。支持：`*`、精确、`1.2`/`1`、`^`、`~`、`>=`、`>`、`<=`、`<`、`=`，
 * 以及空格（AND）与 `||`（OR）。
 *
 * 预发布规则照 npm：范围里没写预发布时，带预发布的版本一律不算满足 ——
 * 这正是「0.0.1-rc.1 不满足 ^0.1.2-rc.1」这类判断的依据。
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const raw = String(range ?? "").trim();
  if (!raw || raw === "*" || raw === "latest") return true;

  const hasPreInRange = /-[0-9A-Za-z]/.test(raw);
  if (v.pre && !hasPreInRange) return false;

  return raw.split("||").some((part) => {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    return tokens.every((tok) => matchesToken(v, tok));
  });
}

function matchesToken(v: ParsedVersion, tok: string): boolean {
  const t = tok.trim();
  if (!t || t === "*" || t === "x" || t === "X") return true;

  if (t.startsWith("^")) {
    const base = parseVersion(t.slice(1));
    if (!base) return true;
    if (cmpVersionToNums(v, base.nums) < 0) return false;
    // 标准 caret 语义：0.x 只允许在同一 minor 内升，0.0.x 只允许同一 patch
    const idx = base.nums[0]! > 0 ? 0 : base.nums[1]! > 0 ? 1 : 2;
    return cmpTo(base.nums, bump(base.nums, idx)) > 0 ? true : v.nums[idx]! === base.nums[idx]!;
  }
  if (t.startsWith("~")) {
    const base = parseVersion(t.slice(1));
    if (!base) return true;
    if (cmpVersionToNums(v, base.nums) < 0) return false;
    return cmpVersionToNums(v, bump(base.nums, 1)) < 0;
  }
  if (t.startsWith(">=")) {
    const base = parseVersion(t.slice(2));
    return base ? cmpVersionToNums(v, base.nums) >= 0 : true;
  }
  if (t.startsWith(">")) {
    const base = parseVersion(t.slice(1));
    return base ? cmpVersionToNums(v, base.nums) > 0 : true;
  }
  if (t.startsWith("<=")) {
    const base = parseVersion(t.slice(2));
    return base ? cmpVersionToNums(v, base.nums) <= 0 : true;
  }
  if (t.startsWith("<")) {
    const base = parseVersion(t.slice(1));
    return base ? cmpVersionToNums(v, base.nums) < 0 : true;
  }
  const base = parseVersion(t.replace(/^=/, ""));
  if (!base) return true;
  // 只写 1 / 1.2 / 2.x 这类时按 npm 语义当范围处理：
  //   1     → >=1.0.0 <2.0.0      （只在主版本内）
  //   1.2   → >=1.2.0 <1.3.0      （只在次版本内）
  //   2.x   → >=2.0.0 <3.0.0      （x 是通配段，按主版本封顶 —— 这里踩过一次，写成了次版本封顶）
  const head = t.replace(/^=/, "").split("-")[0]!;
  const parts = head.split(".");
  const numeric = parts.filter((x) => /^\d+$/.test(x)).length;
  if (numeric >= 3) return cmpVersionToNums(v, base.nums) === 0;
  if (numeric === 0) return true;
  return cmpVersionToNums(v, base.nums) >= 0 && cmpVersionToNums(v, bump(base.nums, numeric - 1)) < 0;
}

// ── 已装依赖扫描 ────────────────────────────────────────────────────

export interface InstalledPkg {
  name: string;
  version: string;
  dir: string;
  /** 声明的 peer 依赖（包名 → 版本范围）。 */
  peers: Record<string, string>;
  /** 0 = 顶层安装；1 = 被某个包裹在自带的 node_modules 里（嵌套，常见于冲突）。 */
  depth: number;
}

interface RawPkg {
  name?: unknown;
  version?: unknown;
  peerDependencies?: unknown;
}

function readOnePkg(dir: string, depth: number): InstalledPkg | null {
  const file = p(dir, "package.json");
  if (!isFile(file)) return null;
  const j = readJson<RawPkg>(file);
  if (!j || typeof j.name !== "string" || typeof j.version !== "string") return null;
  const peers: Record<string, string> = {};
  if (j.peerDependencies && typeof j.peerDependencies === "object") {
    for (const [k, val] of Object.entries(j.peerDependencies as Record<string, unknown>)) {
      if (typeof val === "string") peers[k] = val;
    }
  }
  return { name: j.name, version: j.version, dir, peers, depth };
}

/** 扫描已装依赖：顶层 + 各自的 node_modules（嵌套）—— 冲突常藏在嵌套里。 */
export function scanInstalled(profileDir: string, maxDepth = 1): InstalledPkg[] {
  const out: InstalledPkg[] = [];
  const top = p(profileDir, "node_modules");
  const walk = (nmDir: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const e of listDir(nmDir)) {
      if (!e.dir) continue;
      if (e.name.startsWith(".")) continue; // .bin / .pnpm / .package-lock.json…
      if (e.name.startsWith("@")) {
        for (const scoped of listDir(p(nmDir, e.name))) {
          if (!scoped.dir) continue;
          const hit = readOnePkg(p(nmDir, e.name, scoped.name), depth);
          if (hit) {
            out.push(hit);
            walk(p(hit.dir, "node_modules"), depth + 1);
          }
        }
        continue;
      }
      const hit = readOnePkg(p(nmDir, e.name), depth);
      if (hit) {
        out.push(hit);
        walk(p(hit.dir, "node_modules"), depth + 1);
      }
    }
  };
  walk(top, 0);
  return out;
}

// ── 冲突判定 ────────────────────────────────────────────────────────

/**
 * 问题类型：
 *   duplicate      —— 同一个包装了多个版本（去重失败）
 *   range-conflict —— 同一个依赖被两个包要求了**互不可能同时满足**的版本范围
 *
 * 【为什么不报「peer 没装」】实测本机 profile：直接报「没装」会得到 66 条，绝大多数是
 * @deepseek-ai/* 这类**由 DSH 本体运行时提供**的框架包（插件从本体解析，不在 profile 的
 * node_modules 里）—— 那是误报，只会淹没真问题。真正会让人装不上、卸不掉的信号是
 * 「两个包要的版本不可能同时满足」，也就是 npm 报 ERESOLVE 的根因。
 */
export type DepProblemKind = "duplicate" | "range-conflict";

export interface DepProblem {
  kind: DepProblemKind;
  /** 谁提出的要求（包名）。 */
  subject: string;
  /** 要求针对哪个依赖。 */
  dependency: string;
  /** 要求的版本范围（重复版本时为空）。 */
  wanted: string;
  /** 实际装到的版本（可能多个）。 */
  found: string[];
  /** 一句人话。 */
  detail: string;
}

/** 从版本范围里取出「基准版本」（第一个像版本号的片段），用于冲突判定的候选集。 */
export function baseOf(range: string): string | null {
  const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(String(range ?? ""));
  return m ? m[1]! : null;
}

/** 找依赖问题（纯逻辑：给一份已装列表就能算，便于用 fixture 测试）。 */
export function findProblems(pkgs: InstalledPkg[]): DepProblem[] {
  const out: DepProblem[] = [];
  const versionsOf = (name: string): string[] =>
    [...new Set(pkgs.filter((x) => x.name === name).map((x) => x.version))];

  // ① 同一个包装出了多个版本（去重失败 → 体积膨胀 + 运行期行为不一致）
  const byName = new Map<string, string[]>();
  for (const k of pkgs) {
    const arr = byName.get(k.name) ?? [];
    if (!arr.includes(k.version)) arr.push(k.version);
    byName.set(k.name, arr);
  }
  for (const [name, versions] of byName) {
    if (versions.length > 1) {
      out.push({
        kind: "duplicate",
        subject: "依赖树",
        dependency: name,
        wanted: "",
        found: versions.sort(),
        detail: `${name} 在依赖树里装了 ${versions.length} 个不同版本（${versions.join("、")}）`,
      });
    }
  }

  // ② 版本范围冲突：同一个依赖被两个包要求了不可能同时满足的版本
  //    判法：把两边的范围都拿来，用「已装版本 + 两边各自的范围基准版本」当候选，
  //    若没有任何候选能同时满足两边 → 这两个要求不可能共存（npm 会直接 ERESOLVE）。
  const claims = new Map<string, Array<{ by: string; range: string }>>();
  for (const k of pkgs) {
    for (const [dep, range] of Object.entries(k.peers)) {
      if (dep === k.name) continue;
      const arr = claims.get(dep) ?? [];
      arr.push({ by: k.name, range });
      claims.set(dep, arr);
    }
  }
  for (const [dep, list] of claims) {
    if (list.length < 2) continue;
    const installed = versionsOf(dep);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i]!;
        const B = list[j]!;
        if (A.range === B.range) continue;
        const candidates = [...installed, baseOf(A.range), baseOf(B.range)].filter(Boolean) as string[];
        const coexist = candidates.some((c) => satisfies(c, A.range) && satisfies(c, B.range));
        if (coexist) continue;
        out.push({
          kind: "range-conflict",
          subject: A.by + " ↔ " + B.by,
          dependency: dep,
          wanted: A.range + " ／ " + B.range,
          found: installed.slice().sort(),
          detail:
            `${A.by} 要 ${dep}@${A.range}，而 ${B.by} 要 ${dep}@${B.range} —— 这两个要求不可能同时满足`,
        });
      }
    }
  }
  return out;
}

export function findDependencyProblems(profileDir: string, maxDepth = 1): DepProblem[] {
  return findProblems(scanInstalled(profileDir, maxDepth));
}

// ── 锁文件状态 ──────────────────────────────────────────────────────

export interface LockState {
  /** package-lock.json 的绝对路径。 */
  path: string;
  exists: boolean;
  /** 存在但解析不了（写坏了 / 写了一半）。 */
  corrupt: boolean;
  /** lockfileVersion（解析成功时给出）。 */
  lockfileVersion: number | null;
  /** 人话结论。 */
  note: string;
}

export function lockFileState(profileDir: string): LockState {
  const path = p(profileDir, "package-lock.json");
  if (!isFile(path)) {
    return {
      path,
      exists: false,
      corrupt: false,
      lockfileVersion: null,
      note: "profile 目录里没有 package-lock.json（这份 profile 一直没维护锁文件）",
    };
  }
  const j = readJson<{ lockfileVersion?: unknown }>(path);
  if (!j) {
    return {
      path,
      exists: true,
      corrupt: true,
      lockfileVersion: null,
      note: "package-lock.json 存在但解析不了（内容被写坏了）",
    };
  }
  const v = typeof j.lockfileVersion === "number" ? j.lockfileVersion : null;
  return {
    path,
    exists: true,
    corrupt: false,
    lockfileVersion: v,
    note: v ? `锁文件正常（lockfileVersion ${v}）` : "锁文件能解析，但缺少 lockfileVersion 字段",
  };
}
