/**
 * 安装源（镜像）：测速、选择、落盘（P1-4）。
 *
 * 【为什么值得做】国内直连 npmjs 经常几十秒起步甚至超时，而 DSH 插件生态又几乎全靠 npm。
 * 用户手上的选择是：https://registry.npmmirror.com（阿里）、官方源、腾讯云、华为云…
 * 但「该选哪个」不该靠猜 —— 直接测一遍，谁快用谁。
 *
 * 【落盘要落两处】
 *   1. 管家配置 npmRegistry —— 管家自己发起的安装（npmSourceArgs 会加 --registry）用它；
 *   2. profile 的 .npmrc registry=… —— DSH 自己跑的 pnpm/npm 读它。
 * 只改一处就会出现「管家装得快、DSH 自己装卡死」这种半吊子状态。
 */

import { type Finding, finding } from "../../util/result.ts";
import { isFile } from "../../host/fs.ts";
import { dshProfileDir, p } from "../../util/paths.ts";
import { loadConfig, saveConfig } from "../state/config.ts";

export interface SourceCandidate {
  label: string;
  url: string;
  note: string;
}

/** 候选镜像（顺序即界面展示顺序）。 */
export const MIRROR_CANDIDATES: SourceCandidate[] = [
  { label: "阿里云 npmmirror（国内推荐）", url: "https://registry.npmmirror.com", note: "同步快、国内直连稳" },
  { label: "npm 官方源", url: "https://registry.npmjs.org", note: "最权威；国内可能慢或超时" },
  { label: "腾讯云", url: "https://mirrors.cloud.tencent.com/npm/", note: "国内备用" },
  { label: "华为云", url: "https://repo.huaweicloud.com/repository/npm/", note: "国内备用" },
];

/** 探针用的包名：要足够小且一定存在，避免测速本身变成下载大文件。 */
export const PROBE_PACKAGE = "dsh-sidebar-qa";

/** 安装源地址是否合法（只允许 http/https，且不含空白与引号 —— 它会被拼进命令行）。 */
export function isSafeRegistryUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  if (/[\s"'`]/.test(u)) return false;
  return u.length <= 300;
}

export interface SourceProbe {
  label: string;
  url: string;
  ok: boolean;
  ms: number | null;
  status: number | null;
  error?: string;
}

/** 测一个源：拿一个小包的 dist-tags，算往返耗时。 */
export async function probeSource(c: SourceCandidate, timeoutMs = 6000): Promise<SourceProbe> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const target = c.url.replace(/\/+$/, "") + "/-/package/" + encodeURIComponent(PROBE_PACKAGE) + "/dist-tags";
  try {
    const res = await fetch(target, { signal: ac.signal, redirect: "follow" });
    const ms = Date.now() - t0;
    return { label: c.label, url: c.url, ok: res.ok, ms, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { label: c.label, url: c.url, ok: false, ms: Date.now() - t0, status: null, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** 从测速结果里挑最快的（纯函数，便于测试）。 */
export function pickFastest(probes: SourceProbe[]): SourceProbe | null {
  const ok = probes.filter((x) => x.ok && typeof x.ms === "number");
  if (!ok.length) return null;
  return ok.slice().sort((a, b) => (a.ms! - b.ms!))[0]!;
}

// ── .npmrc 读写（只碰 registry 一行，其它行原样保留） ───────────────

export function npmrcPath(): string {
  return p(dshProfileDir(), ".npmrc");
}

/** 把 registry 一行写进 .npmrc（保留其它配置）。纯函数便于测试。 */
export function upsertRegistryLine(existing: string, url: string): string {
  const lines = (existing ?? "").split(/\r?\n/);
  const out: string[] = [];
  let done = false;
  for (const line of lines) {
    if (/^\s*registry\s*=/.test(line)) {
      if (!done) {
        out.push("registry=" + url);
        done = true;
      }
      continue; // 重复的 registry 行丢掉（npm 只认最后一条，留着只会让人困惑）
    }
    out.push(line);
  }
  if (!done) {
    // 去掉尾部多余空行再追加，避免文件越写越长
    while (out.length && out[out.length - 1]!.trim() === "") out.pop();
    out.push("registry=" + url);
  }
  return out.join("\n").replace(/\n*$/, "\n");
}

export function readNpmrc(): string {
  const file = npmrcPath();
  if (!isFile(file)) return "";
  try {
    return Deno.readTextFileSync(file);
  } catch {
    return "";
  }
}

export interface ApplySourceResult {
  url: string;
  configUpdated: boolean;
  npmrcPath: string | null;
  npmrcBackup: string | null;
  proxy: string | null;
}

/** 落盘：管家配置 + profile 的 .npmrc（原文件先留一份 .bak）。 */
export function applySource(opts: { url: string; proxy?: string | null; stamp: string }): ApplySourceResult {
  const url = opts.url.trim();
  const cfg = loadConfig();
  const patch: Record<string, unknown> = { npmRegistry: url };
  if (opts.proxy !== undefined) patch.proxyUrl = (opts.proxy ?? "").trim();
  saveConfig(patch as never);
  void cfg;

  const file = npmrcPath();
  let backup: string | null = null;
  if (isFile(file)) {
    backup = file + ".bak-" + opts.stamp;
    try {
      Deno.copyFileSync(file, backup);
    } catch {
      backup = null;
    }
  }
  const next = upsertRegistryLine(readNpmrc(), url);
  try {
    Deno.mkdirSync(dshProfileDir(), { recursive: true });
    Deno.writeTextFileSync(file, next);
  } catch {
    return { url, configUpdated: true, npmrcPath: null, npmrcBackup: backup, proxy: (opts.proxy ?? null) };
  }
  return { url, configUpdated: true, npmrcPath: file, npmrcBackup: backup, proxy: (opts.proxy ?? null) };
}

// ── 动作 ────────────────────────────────────────────────────────────

export interface SourcesReport {
  current: { npmRegistry: string; proxyUrl: string; mirrorUrl: string };
  npmrc: { path: string; exists: boolean; registryLine: string | null };
  probes: SourceProbe[];
  fastest: SourceProbe | null;
}

export const networkTestSourcesAction: ActionDef<{ urls?: string[] }, SourcesReport> = {
  name: "network.testSources",
  domain: "network",
  title: "测安装源速度",
  description:
    "只读：对几个常见 npm 镜像各发一次小请求（取一个小包的 dist-tags），量出往返耗时并挑出最快的；同时读出管家配置与 profile .npmrc 里当前的源。不改任何配置。",
  readonly: true,
  steps: ["读取当前源配置", "逐个测速", "挑出最快"],
  run: async (ctx, params) => {
    ctx.step("s1", "读取当前源配置");
    const cfg = loadConfig();
    const rc = readNpmrc();
    const regLine = rc.split(/\r?\n/).find((l) => /^\s*registry\s*=/.test(l)) ?? null;
    ctx.detail(`管家配置源：${cfg.npmRegistry || "（未设置）"}`);
    ctx.progress(0.2);

    ctx.step("s2", "逐个测速");
    const wanted = params.urls && params.urls.length
      ? MIRROR_CANDIDATES.filter((c) => params.urls!.includes(c.url))
      : MIRROR_CANDIDATES;
    const probes = await Promise.all(wanted.map((c) => probeSource(c)));
    for (const pb of probes) {
      ctx.log(`${pb.ok ? "✓" : "✗"} ${pb.label} — ${pb.ms} ms${pb.error ? "（" + pb.error + "）" : ""}`);
    }
    ctx.progress(0.85);

    ctx.step("s3", "挑出最快");
    const fastest = pickFastest(probes);
    ctx.detail(fastest ? `最快：${fastest.label}（${fastest.ms} ms）` : "全部不可用");
    ctx.progress(1);
    return {
      current: { npmRegistry: cfg.npmRegistry ?? "", proxyUrl: cfg.proxyUrl ?? "", mirrorUrl: cfg.mirrorUrl ?? "" },
      npmrc: { path: npmrcPath(), exists: rc.length > 0, registryLine: regLine },
      probes,
      fastest,
    };
  },
};

// ActionDef 类型在文件末尾导入，避免上面的纯函数区被类型噪音淹没
import type { ActionDef } from "../../jobs/types.ts";

export interface SetRegistryParams { url?: string; proxy?: string | null }

export const networkSetRegistryAction: ActionDef<SetRegistryParams, ApplySourceResult> = {
  name: "network.setRegistry",
  domain: "network",
  title: "切换安装源",
  description:
    "把 npm 安装源写进管家配置与 profile 的 .npmrc（两处都改，避免「管家装得快、DSH 自己装卡死」的半吊子状态）；原 .npmrc 会先留一份 .bak。也可同时设置/清除网络代理。",
  readonly: false,
  steps: ["校验地址", "写入管家配置", "写入 profile 的 .npmrc"],
  preflight: async (params) => {
    const out: Finding[] = [];
    const url = (params.url ?? "").trim();
    if (!url) {
      out.push(
        finding("net.no-url", "error", "没有指定安装源地址", {
          cause: "url 为空",
          impact: "不知道该切到哪个源",
          action: "先用「测安装源速度」挑一个，或手动填写 https:// 开头的地址",
        }),
      );
    } else if (!isSafeRegistryUrl(url)) {
      out.push(
        finding("net.bad-url", "error", "安装源地址不合法", {
          cause: "只允许 http/https 开头、不含空白与引号的地址（它会进命令行，必须干净）",
          impact: "拒绝执行，避免把奇怪字符带进 npm 参数",
          action: "检查地址是否写错",
          evidence: [url],
        }),
      );
    }
    const cfg = loadConfig();
    out.push(
      finding("net.plan", "info", `将把安装源从「${cfg.npmRegistry || "未设置"}」切到「${url}」`, {
        cause: "管家配置与 profile/.npmrc 都会更新",
        impact: "之后所有 npm 安装（管家发起的与 DSH 自己发起的）都走新源；原有 .npmrc 会留一份 .bak",
        action: "确认这个源是你想用的",
      }),
    );
    return out;
  },
  run: async (ctx, params) => {
    const url = (params.url ?? "").trim();
    if (!isSafeRegistryUrl(url)) throw new Error("安装源地址不合法：" + url);
    ctx.step("s1", "校验地址");
    ctx.progress(0.2);
    ctx.step("s2", "写入管家配置");
    const res = applySource({ url, proxy: params.proxy, stamp: new Date().toISOString().replace(/[:.]/g, "-") });
    ctx.log(`管家配置 npmRegistry → ${url}`);
    if (params.proxy !== undefined) ctx.log(`网络代理 → ${(params.proxy ?? "").trim() || "（已清空，直连）"}`);
    ctx.progress(0.7);
    ctx.step("s3", "写入 profile 的 .npmrc");
    if (res.npmrcPath) {
      ctx.log(`已写入 ${res.npmrcPath}（registry=${url}）`);
      if (res.npmrcBackup) ctx.log(`原文件已备份：${res.npmrcBackup}`);
    } else {
      ctx.log("⚠ 写 .npmrc 失败（管家配置已生效，DSH 自己的安装仍走旧源）");
    }
    ctx.progress(1);
    return res;
  },
};
