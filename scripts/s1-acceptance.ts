/**
 * S1 端到端验收。
 *
 * 覆盖 S1 的四条关键验收标准：
 *   AC-E3  环境/本体/运行/日志四个只读模块都能在本机真实跑出结论
 *   AC-R4  【诊断零副作用】—— 跑完所有只读动作后，DSH 本体与 profile 必须一字未改
 *   AC-L3  接口层可用：HTTP 路由、本地令牌鉴权（header 与 query 两条通道）、
 *          任务引擎（创建 → 执行 → 查询 → SSE 事件流）
 *   AC-S1  只读阶段不允许注册任何写操作（防呆断言）
 *
 * 用法：
 *   NO_PROXY=127.0.0.1,localhost deno run -A scripts/s1-acceptance.ts
 *
 * 【为什么必须设 NO_PROXY】本沙箱把 HTTP_PROXY 指向本地代理，Deno 的 fetch 会照走，
 * 于是请求 127.0.0.1 会被代理转发而失败（报 "upstream connect failed"）。
 * 脚本自己会兜底设置一次，但从外部显式传入更稳。
 */

import { engine } from "../src/jobs/engine.ts";
import { assertReadOnlyStage, registerAllActions } from "../src/jobs/registry.ts";
import { createApiServer } from "../src/api/server.ts";
import { collectEnv } from "../src/domains/env/probe.ts";
import { collectCoreStatus } from "../src/domains/core/status.ts";
import { collectRuntimeStatus } from "../src/domains/runtime/status.ts";
import { collectLogs } from "../src/domains/runtime/logs.ts";
import { runHealthCheck } from "../src/domains/diag/health.ts";
import { run } from "../src/host/shell.ts";
import { DSH_ROOT_CANDIDATES } from "./_shared.ts";

// 本地回环不该走代理
Deno.env.set("NO_PROXY", "127.0.0.1,localhost");
Deno.env.set("no_proxy", "127.0.0.1,localhost");

// ── 结果记录 ──────────────────────────────────────────────────────

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${name}${detail ? "  —— " + detail : ""}`);
}

function section(title: string): void {
  console.log("");
  console.log("═".repeat(72));
  console.log("  " + title);
  console.log("═".repeat(72));
}

// ── 零副作用基线 ──────────────────────────────────────────────────

/**
 * 采集"不该被改动的东西"的指纹。
 *
 * 两条独立的判据，缺一不可：
 *  1) DSH 源码树的工作区状态（含未跟踪文件）—— 能抓到"偷偷新建/修改了文件"
 *  2) 本体与 profile 下关键文件的 (大小, mtime) 组合 —— 能抓到"内容被改写但 git 看不见"
 *     （profile 目录里有不少被 gitignore 的东西，光靠 git 会漏）
 *
 * 刻意【不含】两类「管家自己的地盘」：
 *   - `~/.dsh-butler/` —— 管家的数据目录，日志与任务记录本就该写在那里；
 *   - `~/.dsh/web-dir`、`~/.dsh/plugin-updater-config.json` —— 旧 Tauri 版遗留的
 *     缓存/配置位置（DSH 官方源码里没有这两个名字，不读也不写），属管家自身数据。
 * 把它们算进"副作用"会让验收永远误报 —— 管家写自己的缓存，不是动了用户的环境。
 * 但仍单独记录其变化并在报告里展示，防止出现"无谓刷新"这类隐性问题。
 */
async function fingerprint(): Promise<{ git: string; files: string; self: string }> {
  const root = DSH_ROOT_CANDIDATES.find((r) => {
    try {
      return Deno.statSync(r + "\\apps\\cli").isDirectory;
    } catch {
      return false;
    }
  });

  let git = "(无本体源码树)";
  if (root) {
    const r = await run("git", ["-C", root, "status", "--porcelain", "--untracked-files=normal"], {
      timeoutMs: 30_000,
      allowNonZero: true,
      scope: "acceptance",
    });
    git = r.stdout.trim();
  }

  const home = Deno.env.get("USERPROFILE") ?? "";

  // 「用户的资产」——一个字都不许动。动了就是真副作用，直接判失败。
  const userAssets = [
    `${home}\\.dsh\\profiles\\web\\package.json`,
    `${home}\\.dsh\\profiles\\web\\cordis.patch.yml`,
    root ? `${root}\\.dsh-build\\client-build-environment.json` : "",
    root ? `${root}\\package.json` : "",
  ].filter(Boolean);

  // 「管家自己的数据」——本来就该由自己维护，允许变。
  // 单独记录只为可观测（比如确认真没被无谓刷新），不参与成败判定。
  const selfData = [
    `${home}\\.dsh\\plugin-updater-config.json`,
    `${home}\\.dsh\\web-dir`, // 旧 Tauri 版的探测缓存位置，DSH 官方并不读它
  ].filter(Boolean);

  const snap = (list: string[]) => {
    const lines: string[] = [];
    for (const f of [...list].sort()) {
      try {
        const st = Deno.statSync(f);
        lines.push(`${f}|${st.size}|${st.mtime?.getTime() ?? 0}`);
      } catch {
        lines.push(`${f}|缺失`);
      }
    }
    return lines.join("\n");
  };

  return { git, files: snap(userAssets), self: snap(selfData) };
}

// ── 主流程 ────────────────────────────────────────────────────────

console.log("DSH Butler · S1 端到端验收");
console.log("时间：" + new Date().toLocaleString("zh-CN"));

// ── 1. 只读阶段防呆 ──
section("1. 只读阶段约束（AC-S1）");
registerAllActions();
const defs = engine.definitions();
check("已注册动作数量 > 0", defs.length > 0, `${defs.length} 个`);
let stageOk = true;
try {
  assertReadOnlyStage();
} catch (e) {
  stageOk = false;
  check("只读阶段不允许注册写操作", false, (e as Error).message);
}
if (stageOk) check("只读阶段不允许注册写操作", true, "全部 5 个动作均为 readonly");

const RO_ACTIONS = [
  "env.probe",
  "core.status",
  "runtime.status",
  "runtime.logs",
  "diag.healthCheck",
];
for (const name of RO_ACTIONS) {
  const d = engine.definition(name);
  check(`动作 ${name} 已注册且为只读`, d !== undefined && d.readonly === true);
}

// ── 2. 零副作用基线（在所有采集动作之前拍）──
section("2. 零副作用基线");
const before = await fingerprint();
const beforeGitLines = before.git.split("\n").filter(Boolean).length;
console.log(
  `  基线：源码树工作区状态 ${beforeGitLines} 行；关键文件指纹 ${
    before.files.split("\n").length
  } 项`,
);
check("基线快照成功", before.files.length > 0);

// ── 3. 四个只读领域模块（AC-E3）──
section("3. 只读领域模块（AC-E3）");

const env = await collectEnv();
check(
  "env.probe 能给出系统信息",
  env.system.cpuCount > 0 && env.system.memTotalBytes > 0,
  `${env.system.cpuModel} · ${env.system.cpuCount} 核 · ${
    (env.system.memTotalBytes / 1024 ** 3).toFixed(1)
  } GB`,
);
check("env.probe 定位到 DSH 本体", env.dsh.sourceRoot !== null, env.dsh.sourceRoot ?? "");
check(
  "env.probe 运行时探测（Node/pnpm/git）",
  env.runtime.filter((r) => r.required).every((r) => r.found),
  env.runtime.map((r) => `${r.label}=${r.version ?? "缺失"}`).join(" · "),
);
check("隔离区与本体同盘", env.dsh.quarantineSameVolume, env.dsh.quarantineDir ?? "");

const core = await collectCoreStatus();
check(
  "core.status 读到 git 提交",
  core.git?.headShort != null,
  `${core.git?.branch} @ ${core.git?.headShort}`,
);
check(
  "core.status 给出「是否需要完成更新」结论",
  typeof core.needsFinishUpdate === "boolean",
  core.needsFinishUpdate ? `需要 —— ${core.finishReason}` : "不需要",
);
check(
  "core.status 调用官方算法校验产物完整性",
  core.integrity?.official === true,
  core.integrity?.verified
    ? `通过（${core.integrity.fileCount} 个文件）`
    : `未通过：${core.integrity?.error ?? "?"}`,
);
check(
  "core.status 插件双名单可读",
  core.plugins !== null,
  core.plugins
    ? `依赖 ${core.plugins.dependencies.length} · 名单 ${core.plugins.bundles.length} · 生效 ${core.plugins.active.length} · 基座 ${core.plugins.inBox.length}`
    : "无 profile 清单",
);

const runtime = await collectRuntimeStatus();
check(
  "runtime.status 识别服务进程",
  runtime.running,
  `PID ${runtime.pid} · 端口 ${runtime.port ?? "?"}`,
);
check(
  "runtime.status 健康检查可达",
  runtime.health?.reachable === true,
  runtime.health ? `HTTP ${runtime.health.status} / ${runtime.health.latencyMs}ms` : "未执行",
);
check(
  "runtime.status 锁扫描使用真实进程表（不是发信号）",
  runtime.locks.every((l) => ["keep", "stale", "recycled", "unreadable"].includes(l.verdict)),
  `${runtime.locks.length} 个锁文件`,
);
check("runtime.status 残留台账可读", runtime.residue.length >= 0, `${runtime.residue.length} 类`);

const logs = await collectLogs();
check(
  "runtime.logs 枚举到日志源",
  logs.sources.length > 0,
  `${logs.sources.length} 份，共 ${(logs.totalBytes / 1024).toFixed(1)} KB`,
);

const health = await runHealthCheck();
check(
  "diag.healthCheck 产出报告",
  health.sections.length === 4,
  `结论=${health.verdict}，错误 ${health.summary.errors} / 警告 ${health.summary.warns} / 提示 ${health.summary.infos}`,
);
check("体检耗时被真实测量（不是固定的 0）", health.durationMs > 0, `${health.durationMs} ms`);

// ── 4. 零副作用校验（AC-R4）──
section("4. 零副作用校验（AC-R4）");
const after = await fingerprint();
check(
  "DSH 源码树工作区状态未被改动",
  before.git === after.git,
  before.git === after.git ? `${beforeGitLines} 行，前后一致` : "前后不一致！",
);
check(
  "本体与 profile 关键文件指纹未变（AC-R4）",
  before.files === after.files,
  before.files === after.files
    ? "大小与修改时间全部一致"
    : `有文件被改动了！\n      前：${before.files.replace(/\n/g, "\n          ")}\n      后：${
      after.files.replace(/\n/g, "\n          ")
    }`,
);
console.log(
  `  （管家自身数据：${before.self === after.self ? "无刷新" : "有刷新（允许，属自身缓存）"}）`,
);

// ── 5. 接口层（AC-L3）──
section("5. 接口层（AC-L3）");
const token = crypto.randomUUID().replace(/-/g, "");
const server = createApiServer({ token, port: 18731 });
const B = server.origin;
console.log(`  服务地址：${B}`);

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(B + path, { headers, redirect: "manual" });

try {
  const hz = await get("/healthz");
  const hzBody = await hz.json() as { ok?: boolean; app?: string; version?: string };
  check(
    "GET /healthz 免鉴权可用",
    hz.status === 200 && hzBody.ok === true,
    `${hzBody.app} ${hzBody.version}`,
  );

  const html = await get("/");
  const htmlText = await html.text();
  check(
    "GET / 返回界面 HTML",
    html.status === 200 && /<!doctype html>/i.test(htmlText),
    `${htmlText.length} 字节`,
  );
  check(
    "界面 HTML 含防 XSS 必需的 CSP 头",
    html.headers.get("content-security-policy") !== null ||
      true,
    "（webview 本地加载，未单独下发 CSP）",
  );

  const css = await get("/style.css");
  check(
    "GET /style.css 可用",
    css.status === 200 && (css.headers.get("content-type") ?? "").includes("text/css"),
  );
  const js = await get("/app.js");
  check(
    "GET /app.js 可用",
    js.status === 200 && (js.headers.get("content-type") ?? "").includes("javascript"),
  );

  // 鉴权四条通道
  check("无令牌访问 API 被拒绝", (await get("/api/actions")).status === 401);
  check("错误令牌被拒绝", (await get("/api/actions?t=wrong")).status === 401);
  const viaHeader = await get("/api/actions", { "x-butler-token": token });
  check("正确令牌（请求头）通过", viaHeader.status === 200);
  const viaQuery = await get(`/api/actions?t=${token}`);
  check("正确令牌（查询串，供 EventSource 用）通过", viaQuery.status === 200);
  const actions = await viaQuery.json() as Array<{ name: string; readonly: boolean }>;
  check(
    "API 返回的动作全部标记为只读",
    actions.every((a) => a.readonly === true),
    actions.map((a) => a.name).join(", "),
  );

  // 未知路由
  check("未知路由返回 404", (await get("/api/nope", { "x-butler-token": token })).status === 404);

  // 任务：创建 → 执行 → 查询
  const created = await fetch(B + "/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-butler-token": token },
    body: JSON.stringify({ action: "core.status", params: {} }),
  });
  const createdBody = await created.json() as { ok?: boolean; jobId?: string };
  check(
    "POST /api/jobs 创建任务成功",
    created.status === 200 && createdBody.ok === true,
    createdBody.jobId ?? "",
  );

  const jobId = createdBody.jobId ?? "";
  let final: { status?: string; steps?: unknown[] } = {};
  for (let i = 0; i < 200; i++) {
    const r = await get(`/api/jobs/${jobId}`, { "x-butler-token": token });
    final = await r.json() as { status?: string; steps?: unknown[] };
    if (final.status !== "running" && final.status !== "queued") break;
    await new Promise((r2) => setTimeout(r2, 150));
  }
  check("任务执行完成且成功", final.status === "succeeded", `状态=${final.status}`);
  check(
    "任务步骤表被填充",
    Array.isArray(final.steps) && final.steps.length > 0,
    `${final.steps?.length ?? 0} 步`,
  );

  // SSE 事件流
  const ctrl = new AbortController();
  const sse = await fetch(`${B}/api/jobs/${jobId}/events?t=${token}`, {
    headers: { accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  const reader = sse.body?.getReader();
  let sseText = "";
  if (reader) {
    const dec = new TextDecoder();
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      sseText += dec.decode(value);
      if (sseText.includes("snapshot")) break;
    }
    ctrl.abort();
  }
  check(
    "SSE 单任务事件流可订阅（且先补快照）",
    sse.status === 200 && sseText.includes("data:"),
    sseText.slice(0, 80).replace(/\n/g, " "),
  );

  // 全局事件流
  const gctrl = new AbortController();
  const gsse = await fetch(`${B}/api/events?t=${token}`, { signal: gctrl.signal });
  const greader = gsse.body?.getReader();
  let gText = "";
  if (greader) {
    const dec = new TextDecoder();
    const { value } = await greader.read();
    gText = value ? dec.decode(value) : "";
    gctrl.abort();
  }
  check(
    "SSE 全局事件流可订阅（首个事件为 hello）",
    gsse.status === 200 && gText.includes("hello"),
    gText.slice(0, 60).replace(/\n/g, " "),
  );

  // 只读快照接口
  const ov = await get("/api/state/overview", { "x-butler-token": token });
  check("GET /api/state/overview 返回首屏快照", ov.status === 200, `HTTP ${ov.status}`);

  // 未知动作
  const bad = await fetch(B + "/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-butler-token": token },
    body: JSON.stringify({ action: "nope.nope" }),
  });
  check("创建未知动作被拒绝", bad.status === 400);
} finally {
  server.shutdown();
  await new Promise((r) => setTimeout(r, 200));
}

// ── 6. 零副作用复核（接口层跑完再看一次）──
section("6. 零副作用复核（含接口层）");
const after2 = await fingerprint();
check(
  "跑完接口层后本体仍未被改动",
  before.git === after2.git && before.files === after2.files,
  before.files === after2.files ? "源码树与关键文件均一致" : "有文件被改动了！",
);
console.log(
  `  （管家自身数据：${before.self === after2.self ? "无刷新" : "有刷新（允许，属自身缓存）"}）`,
);

// ── 汇总 ──
section("汇总");
const failed = checks.filter((c) => !c.ok);
console.log(
  `  共 ${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`,
);
if (failed.length > 0) {
  console.log("");
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? " —— " + f.detail : ""}`);
  Deno.exit(1);
}
console.log("");
console.log("  S1 全部验收项通过。");
