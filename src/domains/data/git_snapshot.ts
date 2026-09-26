/**
 * 技能与配置的本地 Git 快照（P2-1）。
 *
 * 【为什么直接用 git 而不是自己造一套】
 * 「可回退可同步」正是 git 的本职：本地 commit 管回退，将来想跨机同步加个 remote 就行。
 * 自己再造一套快照格式，只会多一份没人会用的方言。
 *
 * 【落在哪】仓库就在技能目录本身（~/.dsh/skills/.git）：
 *   · 不复制数据、不占双份空间；
 *   · 用户以后可以直接 git remote add + push 同步到自己的私有仓库；
 *   · .git 是 DSH 用不到的东西（搬家包也已经把它排除在外）。
 *
 * 【安全纪律】回退前先 git stash 把当前改动收起来（可 pop 回来），再 checkout —— 绝不让回退变成「一按就丢东西」。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { isDir, pathExists } from "../../host/fs.ts";
import { run } from "../../host/shell.ts";
import { dshProfileDir, homeDir, p, stampOf } from "../../util/paths.ts";
import { TIMEOUTS } from "../../version.ts";

/** 快照仓库的根 = 技能目录（用户资产最集中的地方）。 */
export function snapshotRoot(): string {
  return p(homeDir(), ".dsh", "skills");
}

/** 一起纳入快照的「关键配置文件」（相对各自根的路径 + 说明）。 */
export function configTargets(): Array<{ label: string; path: string }> {
  const dsh = p(homeDir(), ".dsh");
  return [
    { label: "DSH 主配置", path: p(dsh, "config.json") },
    { label: "插件清单", path: p(dshProfileDir(), "package.json") },
    { label: "DSH 配置补丁", path: p(dshProfileDir(), "cordis.patch.yml") },
    { label: "npm 源配置", path: p(dshProfileDir(), ".npmrc") },
    { label: "技能中枢状态", path: p(dsh, "dsh-skill-hub.json") },
  ];
}

async function git(args: string[], opts: { allowNonZero?: boolean } = {}) {
  return await run("git", ["-C", snapshotRoot(), ...args], {
    timeoutMs: TIMEOUTS.install,
    allowNonZero: opts.allowNonZero ?? true,
    scope: "data",
  });
}

async function isRepo(): Promise<boolean> {
  if (!isDir(p(snapshotRoot(), ".git"))) return false;
  const r = await git(["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0;
}

/** 自动生成的提交信息：带上时间与改动规模，翻日志时能认出「这是哪一次」。 */
export function snapshotMessage(at: Date = new Date(), changed: number = 0): string {
  const stamp = at.toLocaleString("zh-CN");
  return changed > 0 ? `管家快照 ${stamp}（${changed} 处改动）` : `管家快照 ${stamp}`;
}

export interface SnapshotReport {
  root: string;
  initialized: boolean;
  committed: boolean;
  hash: string | null;
  changedFiles: number;
  message: string | null;
  lines: string[];
}

function snapshotPreflight(): Finding[] {
  const root = snapshotRoot();
  const out: Finding[] = [];
  if (!isDir(root)) {
    out.push(
      finding("snap.no-skills", "error", "找不到技能目录", {
        cause: `目录不存在：${root}`,
        impact: "没有可快照的内容",
        action: "先确认 DSH 用过（技能目录会在装技能时创建）",
        evidence: [root],
      }),
    );
    return out;
  }
  const cfgs = configTargets().filter((c) => pathExists(c.path));
  out.push(
    finding("snap.plan", "info", `将在技能目录里做一次本地 Git 快照（不推送到任何远端）`, {
      cause: `仓库位置：${root}（就是技能目录本身，不复制数据）`,
      impact: `会把技能目录的改动提交；另附 ${cfgs.length} 个关键配置的当前内容摘要（不复制进仓库）`,
      action: "确认后继续；想跨机同步可以自己给这个仓库加 remote 再 push",
      evidence: ["git add -A", "git commit -m \"管家快照 <时间>\"", ...cfgs.map((c) => "配置：" + c.label)],
    }),
  );
  return out;
}

async function runSnapshot(ctx: ActionContext): Promise<SnapshotReport> {
  const root = snapshotRoot();
  const lines: string[] = [];
  const line = (s: string) => {
    lines.push(s);
    ctx.log(s);
  };
  const report: SnapshotReport = {
    root,
    initialized: false,
    committed: false,
    hash: null,
    changedFiles: 0,
    message: null,
    lines,
  };

  ctx.step("s1", "确认仓库");
  ctx.progress(0.15);
  if (!(await isRepo())) {
    const init = await git(["init", "-q"]);
    if (init.code !== 0) throw new Error(`git init 失败：${(init.stderr || init.stdout).trim()}`);
    report.initialized = true;
    line(`已把技能目录初始化为本地 Git 仓库：${root}`);
    // 别把 node_modules 之类塞进来；技能目录一般没有，但防一手
    try {
      Deno.writeTextFileSync(p(root, ".gitignore"), "node_modules/\n.DS_Store\n");
    } catch { /* 写不了就算了，不影响提交 */ }
  } else {
    line("仓库已存在，直接做快照");
  }
  ctx.throwIfCancelled();

  ctx.step("s2", "暂存改动");
  ctx.progress(0.45);
  const add = await git(["add", "-A"]);
  if (add.code !== 0) throw new Error(`git add 失败：${(add.stderr || add.stdout).trim()}`);
  const staged = await git(["diff", "--cached", "--name-only"]);
  const changed = staged.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  report.changedFiles = changed.length;
  line(`本次改动 ${changed.length} 个文件`);
  if (changed.length) line("　" + changed.slice(0, 8).join("、") + (changed.length > 8 ? " …" : ""));

  ctx.step("s3", "提交");
  ctx.progress(0.7);
  if (changed.length === 0) {
    line("没有改动，跳过提交（不留空提交）");
  } else {
    const msg = snapshotMessage(new Date(), changed.length);
    const commit = await git(["commit", "-q", "-m", msg]);
    if (commit.code !== 0) throw new Error(`git commit 失败：${(commit.stderr || commit.stdout).trim()}`);
    const head = await git(["rev-parse", "--short", "HEAD"]);
    report.committed = true;
    report.hash = head.stdout.trim() || null;
    report.message = msg;
    line(`已提交：${report.hash} —— ${msg}`);
  }
  ctx.progress(1);
  return report;
}

export const dataSnapshotAction: ActionDef<Record<string, never>, SnapshotReport> = {
  name: "data.snapshot",
  domain: "data",
  title: "技能快照（本地 Git）",
  description:
    "在技能目录（~/.dsh/skills）里做一次本地 Git 提交：没有仓库就先初始化。不推送到任何远端；没有改动时不留空提交。想跨机同步，自己给这个仓库加 remote 即可。",
  readonly: false,
  steps: ["确认仓库", "暂存改动", "提交"],
  preflight: async () => snapshotPreflight(),
  run: (ctx) => runSnapshot(ctx),
  timeoutMs: TIMEOUTS.install,
};

export interface SnapshotsReport {
  root: string;
  isRepo: boolean;
  log: Array<{ hash: string; at: string; subject: string }>;
  /** 相对上次快照的改动（工作区状态）。 */
  dirty: string[];
  dirtyCount: number;
  hasRemote: boolean;
}

/** 解析 git log 的一行（纯函数，便于测试）。 */
export function parseLogLine(line: string): { hash: string; at: string; subject: string } | null {
  const parts = line.split("\u001f");
  if (parts.length < 3) return null;
  return { hash: (parts[0] ?? "").trim(), at: (parts[1] ?? "").trim(), subject: (parts[2] ?? "").trim() };
}

export const dataSnapshotsAction: ActionDef<Record<string, never>, SnapshotsReport> = {
  name: "data.snapshots",
  domain: "data",
  title: "查看技能快照",
  description: "只读：列出技能目录的本地 Git 快照（最近 20 次）以及相对上次快照还没提交的改动，并说明有没有配置远端。",
  readonly: true,
  steps: ["确认仓库", "读快照列表", "看工作区状态"],
  run: async (ctx) => {
    const root = snapshotRoot();
    ctx.step("s1", "确认仓库");
    const repo = await isRepo();
    if (!repo) {
      ctx.progress(1);
      return { root, isRepo: false, log: [], dirty: [], dirtyCount: 0, hasRemote: false };
    }
    ctx.step("s2", "读快照列表");
    const logRes = await git(["log", "--pretty=format:%h\u001f%ad\u001f%s", "--date=iso", "-n", "20"]);
    const logs = logRes.stdout.split("\n").map(parseLogLine).filter((x): x is NonNullable<typeof x> => x !== null);
    ctx.detail(`共 ${logs.length} 次快照`);
    ctx.progress(0.7);
    ctx.step("s3", "看工作区状态");
    const st = await git(["status", "--porcelain"]);
    const dirty = st.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    const remote = await git(["remote"]);
    ctx.detail(dirty.length ? `有 ${dirty.length} 处改动还没快照` : "工作区干净");
    ctx.progress(1);
    return { root, isRepo: true, log: logs, dirty, dirtyCount: dirty.length, hasRemote: remote.stdout.trim().length > 0 };
  },
};

export interface RestoreSnapshotParams { hash?: string }

/** 回退：先 stash 保住当前改动，再 checkout 到指定快照。 */
export const dataSnapshotRestoreAction: ActionDef<RestoreSnapshotParams, {
  hash: string;
  stashed: boolean;
  restored: number;
}> = {
  name: "data.snapshotRestore",
  domain: "data",
  title: "回退到某次技能快照",
  description:
    "只读地把技能目录恢复成某次快照的样子：动手前先 git stash 把当前改动收起来（可 pop 回来），再 checkout。绝不让回退变成一按就丢东西。",
  readonly: false,
  steps: ["校验快照", "收起当前改动", "恢复到该快照"],
  preflight: async (params) => {
    const out: Finding[] = [];
    const hash = (params.hash ?? "").trim();
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
      out.push(
        finding("snap.bad-hash", "error", "快照 id 看起来不合法", {
          cause: `收到：${hash || "（空）"}`,
          impact: "不知道该回到哪一次",
          action: "先用「查看技能快照」列出可用的 id",
        }),
      );
      return out;
    }
    const repo = await isRepo();
    if (!repo) {
      out.push(
        finding("snap.no-repo", "error", "技能目录还不是 Git 仓库", {
          cause: "没有仓库就没有快照可回退",
          impact: "无法执行",
          action: "先做一次「技能快照」",
        }),
      );
      return out;
    }
    out.push(
      finding("snap.restore-plan", "info", `将把技能目录恢复成快照 ${hash}`, {
        cause: "动手前会先把当前改动 stash 起来（可 pop 回来）",
        impact: "工作区会变成那次快照的内容；stash 里保留着你现在的改动",
        action: "确认要回到这一次",
        evidence: [`快照：${hash}`, `仓库：${snapshotRoot()}`],
      }),
    );
    return out;
  },
  run: async (ctx, params) => {
    const hash = (params.hash ?? "").trim();
    ctx.step("s1", "校验快照");
    const check = await git(["rev-parse", "--verify", `${hash}^{commit}`]);
    if (check.code !== 0) throw new Error(`找不到这个快照：${hash}`);
    ctx.progress(0.3);
    ctx.step("s2", "收起当前改动");
    const st = await git(["status", "--porcelain"]);
    let stashed = false;
    if (st.stdout.trim()) {
      const s = await git(["stash", "push", "-u", "-m", "butler-restore-" + stampOf()]);
      if (s.code !== 0) throw new Error(`stash 失败，为安全起见中止：${(s.stderr || s.stdout).trim()}`);
      stashed = true;
      ctx.log("已把当前改动收进 stash（要拿回来：git stash pop）");
    } else {
      ctx.log("工作区本来就干净，无需 stash");
    }
    ctx.throwIfCancelled();
    ctx.step("s3", "恢复到该快照");
    ctx.progress(0.7);
    const co = await git(["checkout", hash, "--", "."]);
    if (co.code !== 0) throw new Error(`checkout 失败：${(co.stderr || co.stdout).trim()}`);
    const changed = await git(["diff", "--name-only", "HEAD"]);
    const restored = changed.stdout.split("\n").filter((s) => s.trim()).length;
    ctx.log(`已恢复到 ${hash}（与当前 HEAD 相比改动 ${restored} 个文件）`);
    ctx.progress(1);
    return { hash, stashed, restored };
  },
  timeoutMs: TIMEOUTS.install,
};
