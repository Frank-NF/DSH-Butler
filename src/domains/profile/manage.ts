/**
 * 多 profile / 多实例管理（P1-1）。
 *
 * 【为什么要它】DSH 自身可以有 web / desktop / sdk / headless 多个 profile，各自的清单、
 * 依赖、端口都可能不同。官方桌面端只跑它自己那一个 profile —— 而我们得能回答：
 *   · 本机现在有哪些 profile？哪个是管家正在用的？各装了多少插件？
 *   · 我想用的那个端口被谁占着？是不是踩进了 Windows 的动态端口保留区间（今天真踩过 10048）？
 *   · 换个 profile 指挥，怎么切、什么时候生效？
 *
 * 【切换怎么落地】dshProfileDir() 认 BUTLER_PROFILE_DIR 这个逃生口（本来是给测试用的）。
 * 这里复用它：把选中的 profile 名写进配置，并设好进程内环境变量 —— 于是整个进程内所有
 * 「按当前 profile 找文件」的地方都会跟着走。跨进程（托盘/新实例）靠启动时从配置里读。
 */

import type { ActionContext, ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { isDir, isFile, listDir, pathExists, readJson, dirSizeBudgeted } from "../../host/fs.ts";
import { dshProfileDir, dshRoot, p } from "../../util/paths.ts";
import { DSH_PORT_CANDIDATES } from "../../version.ts";
import { loadConfig, saveConfig } from "../state/config.ts";

/** profile 名：只允许字母数字、点、下划线与短横（它会进路径，必须干净）。 */
export function isSafeProfileName(name: string): boolean {
  const n = (name ?? "").trim();
  return /^[A-Za-z0-9._-]{1,40}$/.test(n) && n !== "." && n !== "..";
}

/** profile 名 → 目录（纯函数，便于测试）。 */
export function profilePathOf(name: string): string {
  return p(dshRoot(), "profiles", name);
}

/** 当前生效的 profile 名：环境变量优先（切换后即时生效），否则用传入的默认值。 */
export function currentProfileName(fallback: string): string {
  const override = Deno.env.get("BUTLER_PROFILE_DIR");
  if (override) {
    const parts = override.replace(/[\\/]+$/, "").split(/[\\/]/);
    return parts[parts.length - 1] || fallback;
  }
  return Deno.env.get("BUTLER_PROFILE") ?? fallback;
}

export interface PortProbe {
  port: number;
  /** true = 现在能绑上（没人占）。 */
  free: boolean;
  /** 是不是 DSH 服务自己占着（那就不算冲突）。 */
  heldByDsh: boolean;
  note: string;
}

/**
 * 探一个端口能不能绑（真绑一次再放开 —— 比读 netstat 可靠，也不依赖平台）。
 * 注意：DSH 自己占着的端口会返回 free=false，所以调用方要结合「谁在跑」判断。
 */
export function probePortFree(port: number): boolean {
  try {
    const l = Deno.listen({ hostname: "127.0.0.1", port });
    l.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * 端口是否落在「动态端口保留区间」（Windows 会把某些区间留给系统，绑上去报 10048）。
 * 今天真踩过：DENO_SERVE_ADDRESS 指向 51424，起服务直接 EADDRINUSE。
 * 这里只做「疑似」提示（各机器区间不同，无法从进程内读），所以给的是建议而不是判定。
 */
export function isLikelyReservedRange(port: number): boolean {
  return port >= 49152;
}

export interface ProfileInfo {
  name: string;
  path: string;
  active: boolean;
  hasManifest: boolean;
  pluginCount: number;
  hasLock: boolean;
  /** node_modules 体积（预算内统计，超预算标 complete=false）。 */
  bytes: number;
  bytesComplete: boolean;
}

/** 列出本机所有 profile（跳过 node_modules 这种非 profile 目录）。 */
export function listProfiles(activeName: string, budgetMs = 400): ProfileInfo[] {
  const root = p(dshRoot(), "profiles");
  if (!isDir(root)) return [];
  const out: ProfileInfo[] = [];
  const deadline = Date.now() + budgetMs;
  for (const e of listDir(root)) {
    if (!e.dir || e.name === "node_modules" || e.name.startsWith(".")) continue;
    const dir = p(root, e.name);
    const manifest = p(dir, "package.json");
    const hasManifest = isFile(manifest);
    let pluginCount = 0;
    if (hasManifest) {
      const j = readJson<{ dependencies?: Record<string, unknown> }>(manifest);
      pluginCount = Object.keys(j?.dependencies ?? {}).length;
    }
    const nm = p(dir, "node_modules");
    let bytes = 0;
    let complete = true;
    if (isDir(nm)) {
      const remain = Math.max(0, deadline - Date.now());
      if (remain < 30) complete = false;
      else {
        const r = dirSizeBudgeted(nm, Math.min(200, remain));
        bytes = r.bytes;
        complete = r.complete;
      }
    }
    out.push({
      name: e.name,
      path: dir,
      active: e.name === activeName,
      hasManifest,
      pluginCount,
      hasLock: isFile(p(dir, "package-lock.json")) || isFile(p(dir, "pnpm-lock.yaml")),
      bytes,
      bytesComplete: complete,
    });
  }
  return out.sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
}

// ── 动作 ────────────────────────────────────────────────────────────

export interface ProfilesReport {
  active: string;
  profilesRoot: string;
  profiles: ProfileInfo[];
  port: { configured: number; free: boolean; heldByDsh: boolean; likelyReserved: boolean; candidates: PortProbe[] };
}

export const profileListAction: ActionDef<Record<string, never>, ProfilesReport> = {
  name: "profile.list",
  domain: "profile",
  title: "列出 profile 与端口",
  description:
    "只读：列出本机所有 profile（插件数、锁文件、node_modules 体积、哪个正在用），并体检当前配置的 DSH 端口是否可用（含 Windows 动态端口保留区间的疑似提示）。",
  readonly: true,
  steps: ["扫描 profile 目录", "体检端口", "汇总"],
  run: async (ctx) => {
    const cfg = loadConfig();
    const fallback = currentProfileName("web");
    ctx.step("s1", "扫描 profile 目录");
    const profiles = listProfiles(fallback);
    ctx.detail(`共 ${profiles.length} 个 profile，当前：${fallback}`);
    ctx.progress(0.5);
    ctx.step("s2", "体检端口");
    const port = cfg.dshPort;
    const free = probePortFree(port);
    const candidates: PortProbe[] = DSH_PORT_CANDIDATES.map((pt) => {
      const f = probePortFree(pt);
      return { port: pt, free: f, heldByDsh: !f && pt === port, note: f ? "可用" : pt === port ? "当前 DSH 端口（多半是服务自己占着）" : "已被占用" };
    });
    ctx.detail(`DSH 端口 ${port}：${free ? "可用" : "已被占用（或就是服务自己在用）"}`);
    ctx.progress(0.9);
    ctx.step("s3", "汇总");
    ctx.progress(1);
    return {
      active: fallback,
      profilesRoot: p(dshRoot(), "profiles"),
      profiles,
      port: { configured: port, free, heldByDsh: !free, likelyReserved: isLikelyReservedRange(port), candidates },
    };
  },
};

export interface SwitchParams { name?: string }

export function switchPreflight(params: SwitchParams): Finding[] {
  const out: Finding[] = [];
  const name = (params.name ?? "").trim();
  if (!isSafeProfileName(name)) {
    out.push(
      finding("profile.bad-name", "error", "profile 名不合法", {
        cause: "只允许字母数字、点、下划线、短横（它会进路径）",
        impact: "拒绝切换",
        action: "从列表里点一个，别手输奇怪字符",
        evidence: name ? [name] : [],
      }),
    );
    return out;
  }
  const dir = profilePathOf(name);
  if (!pathExists(dir)) {
    out.push(
      finding("profile.not-found", "error", `profile 不存在：${name}`, {
        cause: `目录不在：${dir}`,
        impact: "切过去也找不到清单，所有插件操作都会失败",
        action: "先确认 DSH 用过这个 profile（或先用 DSH 建一个）",
        evidence: [dir],
      }),
    );
    return out;
  }
  if (!isFile(p(dir, "package.json"))) {
    out.push(
      finding("profile.no-manifest", "warn", `profile「${name}」里没有 package.json`, {
        cause: "这个 profile 可能还没被 DSH 用过",
        impact: "切过去后插件相关的操作会报找不到清单",
        action: "确认要用它再继续",
        evidence: [p(dir, "package.json")],
      }),
    );
  }
  const cfg = loadConfig();
  out.push(
    finding("profile.switch-plan", "info", `将把管家的目标 profile 从「${currentProfileName("web")}」切到「${name}」`, {
      cause: "改的是管家配置里的 profile 路径 + 进程内环境变量",
      impact: "本进程立即生效（之后所有插件操作都指向新 profile）；托盘与后续新实例在下次启动时生效 —— 想彻底切换请重启管家",
      action: "确认这就是你要指挥的那个 profile",
      evidence: [dir, `当前 DSH 端口：${cfg.dshPort}`],
    }),
  );
  return out;
}

export interface SwitchResult {
  name: string;
  path: string;
  previous: string;
  /** 进程内是否已生效（环境变量已设）。 */
  appliedNow: boolean;
  note: string;
}

export async function runSwitch(ctx: ActionContext, params: SwitchParams): Promise<SwitchResult> {
  const name = (params.name ?? "").trim();
  const previous = currentProfileName("web");
  const dir = profilePathOf(name);
  ctx.step("s1", "校验 profile");
  ctx.progress(0.3);
  if (!isSafeProfileName(name) || !pathExists(dir)) throw new Error(`profile 不可用：${name}`);
  ctx.step("s2", "写入管家配置");
  saveConfig({ dshProfileDir: dir } as never);
  ctx.log(`管家配置：dshProfileDir → ${dir}`);
  ctx.progress(0.7);
  ctx.step("s3", "设置进程内环境变量");
  let appliedNow = false;
  try {
    Deno.env.set("BUTLER_PROFILE", name);
    Deno.env.set("BUTLER_PROFILE_DIR", dir);
    appliedNow = true;
    ctx.log("本进程已切到新 profile");
  } catch (e) {
    ctx.log(`⚠ 设置环境变量失败：${(e as Error).message}（重启管家后生效）`);
  }
  ctx.progress(1);
  // 用新 profile 复核一次：确认真的切过去了
  const now = dshProfileDir();
  ctx.log(`复核：当前 profile 目录 = ${now}`);
  return {
    name,
    path: dir,
    previous,
    appliedNow,
    note: appliedNow
      ? "本进程已生效；托盘与后续新实例在下次启动时生效（想彻底切换请重启管家）"
      : "配置已写入，重启管家后生效",
  };
}

export const profileSwitchAction: ActionDef<SwitchParams, SwitchResult> = {
  name: "profile.switch",
  domain: "profile",
  title: "切换目标 profile",
  description:
    "把管家指挥的 profile 换成另一个（写配置 + 设进程内环境变量）。本进程立即生效，托盘与后续实例在下次启动生效。切换前会校验目录存在且清单可用。",
  readonly: false,
  steps: ["校验 profile", "写入管家配置", "设置进程内环境变量"],
  preflight: async (params) => switchPreflight(params),
  run: (ctx, params) => runSwitch(ctx, params),
  timeoutMs: 60_000,
};
