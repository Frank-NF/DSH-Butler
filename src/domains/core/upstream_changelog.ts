/**
 * 上游新版本改了什么 —— 版本区间对比。
 *
 * 【为什么要有这块】管家「DSH 本体」页原来那张「更新日志」卡片读的是**本机已装版本**的
 * git log，用户想知道"升上去会变什么"只能自己去翻 GitHub（2026-09-29 用户提出）。
 *
 * 做法分两层，界面上是一件事：
 *   1) **纯本地对比**（只读、无网络）：在源码仓库里找上游最新版的标签（仓库约定
 *      `dsh-v<version>`），有就直接算「新标签里有、本机 HEAD 没有」的那批提交；
 *   2) 没有标签时，界面给一个「拉取上游更新记录」的动作（`git fetch --tags`，要联网、
 *      会改本机仓库的 refs）—— 它走任务引擎，有步骤、有审计，绝不在页面加载时偷偷跑。
 *
 * 为什么用「提交区间」而不是拉线上 changelog：线上没有 changelog（官方 npm 包与官网
 * 都没有这份数据，实测确认过），提交记录是唯一权威来源。
 * 为什么只看非合并提交：合并里有大量"同步 master"这类噪音，真实改动才是用户要看的东西。
 */

import { run } from "../../host/shell.ts";
import { log } from "../../util/log.ts";
import { readJson } from "../../host/fs.ts";
import { p, resolveDshSourceRoot } from "../../util/paths.ts";
import { checkCoreUpdate } from "../../net/core-update.ts";
import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { TIMEOUTS } from "../../version.ts";

/** 上游标签约定（仓库里的是 dsh-v0.2.0-rc.1 这种）。 */
export const DSH_TAG_PREFIX = "dsh-v";
/** 拉标签的网络超时：慢的是网络，不是 git。 */
export const UPSTREAM_FETCH_TIMEOUT_MS = 90_000;

const KNOWN_KINDS = new Set([
  "feat",
  "fix",
  "docs",
  "test",
  "refactor",
  "perf",
  "build",
  "ci",
  "chore",
  "style",
  "revert",
  "release",
]);

export interface UpstreamCommit {
  sha: string;
  date: string;
  subject: string;
  /** feat / fix / docs / test / ...（认不出算 other）。 */
  type: string;
}

export interface UpstreamCounts {
  total: number;
  feat: number;
  fix: number;
  docs: number;
  test: number;
  other: number;
}

export interface UpstreamChangelog {
  sourceRoot: string | null;
  /** 本机装的版本。 */
  installed: string | null;
  /** 上游最新版。 */
  latest: string | null;
  /** 上游最新版来自哪个通道。 */
  channel: string | null;
  /** 本机确实落后于上游。 */
  available: boolean;
  /** 用哪个标签算的区间。 */
  toTag: string | null;
  /** 本机是否已经有上游新版本的记录（标签在不在）。 */
  recordsReady: boolean;
  counts: UpstreamCounts;
  entries: UpstreamCommit[];
  /** 人话解释：为什么没有条目 / 已是最新 / 记录没拉过。 */
  note: string | null;
}

/** 版本号 → 可能的上游标签名（先按仓库约定，再留两种兜底）。 */
export function versionTagCandidates(version: string): string[] {
  const v = version.trim();
  if (v === "") return [];
  return [DSH_TAG_PREFIX + v, "v" + v, v];
}

/**
 * 提交类型：取 conventional commit 的前缀（feat(scope): … → feat）。
 * 故意不用正则：这里只要"第一个分隔符之前那段"，字符串切分更不容易读错。
 */
export function classifyCommit(subject: string): string {
  const s = subject.trim().toLowerCase();
  let head = s;
  for (const sep of [":", "(", "!"]) {
    const i = s.indexOf(sep);
    if (i > 0 && i < head.length) head = s.slice(0, i);
  }
  head = head.trim();
  return KNOWN_KINDS.has(head) ? head : "other";
}

/** git log 的输出 → 结构化条目（纯函数；行格式：sha|date|subject）。 */
export function parseCommitLines(raw: string): UpstreamCommit[] {
  const out: UpstreamCommit[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    const parts = t.split("|");
    const sha = parts[0] ?? "";
    const date = parts[1] ?? "";
    const subject = parts.slice(2).join("|");
    if (sha === "") continue;
    out.push({ sha, date, subject, type: classifyCommit(subject) });
  }
  return out;
}

/** 按类型汇总（纯函数）。 */
export function summarizeCommits(entries: UpstreamCommit[]): UpstreamCounts {
  const c: UpstreamCounts = { total: entries.length, feat: 0, fix: 0, docs: 0, test: 0, other: 0 };
  for (const e of entries) {
    if (e.type === "feat") c.feat++;
    else if (e.type === "fix") c.fix++;
    else if (e.type === "docs") c.docs++;
    else if (e.type === "test") c.test++;
    else c.other++;
  }
  return c;
}

async function git(root: string, args: string[], timeoutMs = 30_000) {
  return await run("git", ["-C", root, ...args], {
    timeoutMs,
    allowNonZero: true,
    scope: "git",
  });
}

/** 这个标签在本地仓库里有没有。 */
export async function tagExists(root: string, tag: string): Promise<boolean> {
  const r = await git(root, ["rev-parse", "--verify", "--quiet", "refs/tags/" + tag]);
  return r.code === 0;
}

/** 按候选顺序找第一个存在的标签。 */
export async function firstExistingTag(root: string, candidates: string[]): Promise<string | null> {
  for (const t of candidates) {
    if (await tagExists(root, t)) return t;
  }
  return null;
}

/**
 * 新版本里有、本机 HEAD 没有的那批提交（非合并）。
 *
 * 用 `<tag> ^HEAD` 而不是 `<旧标签>..<新标签>`：这样不要求本机存在旧版本的标签
 * （用户可能是从任意提交/分支状态过来的），"相对我这台机器多了什么"才是他要的答案。
 */
export async function compareCommits(root: string, toTag: string): Promise<UpstreamCommit[]> {
  const r = await git(root, [
    "log",
    "--no-merges",
    "--pretty=format:%h|%ad|%s",
    "--date=short",
    toTag,
    "^HEAD",
  ]);
  if (r.code !== 0) {
    throw new Error("读不到上游提交记录：" + (r.stderr.trim().split("\n")[0] || "git 返回非零"));
  }
  return parseCommitLines(r.stdout);
}

/** 从源码树读版本号（只读 package.json，不惊动整套 status 扫描）。 */
export function readSourceVersion(root: string): string | null {
  const pkg = readJson<{ version?: string }>(p(root, "package.json"));
  return pkg?.version ?? null;
}

/**
 * 汇总出「上游新版本改了什么」。纯本地 + 一次（带缓存的）版本查询，不联网拉代码。
 */
export async function collectUpstreamChangelog(opts: { limit?: number } = {}): Promise<UpstreamChangelog> {
  const limit = Math.min(Math.max(Math.round(opts.limit ?? 300), 10), 1000);
  const probe = resolveDshSourceRoot();
  const base: UpstreamChangelog = {
    sourceRoot: probe?.path ?? null,
    installed: null,
    latest: null,
    channel: null,
    available: false,
    toTag: null,
    recordsReady: false,
    counts: summarizeCommits([]),
    entries: [],
    note: null,
  };
  if (!probe) return { ...base, note: "未安装 DSH 本体" };

  const root = probe.path;
  const installed = readSourceVersion(root);
  const info = await checkCoreUpdate({ installed }).catch(() => null);
  const latest = info?.latest ?? null;
  const channel = info?.channel ?? null;
  const available = info?.available === true;

  const withMeta: UpstreamChangelog = { ...base, installed, latest, channel, available };
  if (latest === null) {
    return { ...withMeta, note: "查不到上游最新版（网络不通或还没查过）" };
  }
  if (!available) {
    return { ...withMeta, note: `本机 ${installed ?? "?"} 已经是最新（上游 ${latest}）` };
  }

  const tag = await firstExistingTag(root, versionTagCandidates(latest));
  if (tag === null) {
    return {
      ...withMeta,
      note: `本机还没有上游 ${latest} 的记录：点「拉取上游更新记录」拉一次标签就能看`,
    };
  }

  try {
    const all = await compareCommits(root, tag);
    return {
      ...withMeta,
      toTag: tag,
      recordsReady: true,
      counts: summarizeCommits(all),
      entries: all.slice(0, limit),
      note: all.length > limit ? `共 ${all.length} 条，这里列前 ${limit} 条` : null,
    };
  } catch (e) {
    log.warn("core", `对比上游更新失败：${(e as Error).message}`);
    return { ...withMeta, toTag: tag, note: "读提交记录失败：" + (e as Error).message };
  }
}

// ── 动作：拉取上游更新记录（由任务引擎驱动，不在页面加载时偷偷跑） ──

export const CORE_FETCH_UPSTREAM_STEPS = [
  "确认源码仓库可用",
  "从上游拉取标签（只动标签，不动工作区）",
  "对比出本机缺的改动清单",
] as const;

async function fetchUpstreamPreflight(): Promise<Finding[]> {
  const out: Finding[] = [];
  const probe = resolveDshSourceRoot();
  if (!probe) {
    out.push(
      finding("core.fetchUpstream.no-source", "error", "找不到 DSH 源码树", {
        cause: "本机没有可用的 DSH 源码目录",
        impact: "没有仓库就没有提交记录可对比",
        action: "先做一次一键部署，或到「环境与配置」页手动指定源码目录",
      }),
    );
    return out;
  }
  const r = await git(probe.path, ["rev-parse", "--git-dir"]);
  if (r.code !== 0) {
    out.push(
      finding("core.fetchUpstream.not-git", "error", "源码目录不是 git 仓库", {
        cause: `${probe.path} 里没有 .git`,
        impact: "拉不了标签，也就没法对比上游改了什么",
        action: "确认源码目录对不对（部署出来的源码树才带 .git）",
        evidence: [probe.path],
      }),
    );
    return out;
  }
  return out;
}

async function runFetchUpstream(ctx: ActionContext): Promise<UpstreamChangelog> {
  const probe = resolveDshSourceRoot();
  if (!probe) throw new Error("未安装 DSH 本体");
  const root = probe.path;

  ctx.step("s1", CORE_FETCH_UPSTREAM_STEPS[0]);
  ctx.progress(0.1);
  const gitDir = await git(root, ["rev-parse", "--git-dir"]);
  if (gitDir.code !== 0) throw new Error("源码目录不是 git 仓库：" + root);
  ctx.log("源码仓库：" + root);
  ctx.log("只拉标签，不动工作区、不动 HEAD");
  ctx.throwIfCancelled();

  ctx.step("s2", CORE_FETCH_UPSTREAM_STEPS[1]);
  ctx.progress(0.4);
  const { remote } = await fetchUpstreamTags(root, (line) => ctx.log(line));
  ctx.log(`标签已从 ${remote} 拉取完成`);
  ctx.throwIfCancelled();

  ctx.step("s3", CORE_FETCH_UPSTREAM_STEPS[2]);
  ctx.progress(0.8);
  const result = await collectUpstreamChangelog({ limit: 300 });
  if (!result.recordsReady) throw new Error(result.note ?? "拉取后仍然没有上游新版本的记录");
  const c = result.counts;
  ctx.log(
    `上游 ${result.latest}（${result.channel ?? "?"} 通道）相对本机 ${result.installed ?? "?"}：` +
      `${c.total} 条改动 —— 新功能 ${c.feat} · 修复 ${c.fix} · 文档 ${c.docs} · 测试 ${c.test} · 其它 ${c.other}`,
  );
  ctx.progress(1);
  return result;
}

export const coreFetchUpstreamAction: ActionDef<Record<string, never>, UpstreamChangelog> = {
  name: "core.fetchUpstreamTags",
  domain: "core",
  title: "拉取上游更新记录",
  description:
    "从上游远端只拉标签（git fetch --tags），然后算出「上游最新版相对本机多了哪些提交」。不碰工作区、不改 HEAD、不安装任何东西 —— 只是把上游的版本记录取回来，让「DSH 本体」页能列出新版本改了什么。",
  readonly: false,
  steps: [...CORE_FETCH_UPSTREAM_STEPS],
  preflight: fetchUpstreamPreflight,
  run: (ctx) => runFetchUpstream(ctx),
  timeoutMs: TIMEOUTS.install,
};

/** 要试哪些远端（本机自己的 mirror 最快，排前面；之后是常见的公共远端名）。 */
export function remoteTryOrder(remotes: string[]): string[] {
  const preferred = ["mirror", "upstream", "origin"];
  const out: string[] = [];
  for (const name of preferred) {
    if (remotes.includes(name)) out.push(name);
  }
  for (const name of remotes) {
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 拉取上游标签（`git fetch --tags <remote>`）。
 *
 * 只动 .git 里的 refs/标签，不碰工作区、不改 HEAD —— 但仍然是"会改本机仓库"的动作，
 * 所以由任务引擎驱动（有步骤、有审计），不在页面加载时偷偷跑。
 * 返回实际用了哪个远端（全都失败时抛错，把每个远端的错误带出来）。
 */
export async function fetchUpstreamTags(
  root: string,
  onLog: (line: string) => void,
): Promise<{ remote: string; output: string }> {
  const listed = await git(root, ["remote"]);
  const remotes = listed.stdout.split("\n").map((s) => s.trim()).filter((s) => s !== "");
  if (remotes.length === 0) throw new Error("源码仓库没有配置任何远端（remote），无法拉取上游标签");
  const errors: string[] = [];
  for (const remote of remoteTryOrder(remotes)) {
    onLog(`从 ${remote} 拉取标签…`);
    const r = await git(root, ["fetch", "--tags", remote], UPSTREAM_FETCH_TIMEOUT_MS);
    if (r.code === 0) {
      const brief = r.stderr.trim().split("\n").slice(-2).join(" · ") || r.stdout.trim();
      onLog(`${remote}：拉取成功${brief ? "（" + brief + "）" : ""}`);
      return { remote, output: r.stderr.trim() };
    }
    const first = r.stderr.trim().split("\n").find((l) => l.trim() !== "") ?? "未知错误";
    errors.push(`${remote}：${first}`);
    onLog(`${remote}：拉取失败 —— ${first}`);
  }
  throw new Error("所有远端都拉不到标签（" + errors.join("；") + "）");
}
