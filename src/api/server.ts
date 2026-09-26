/**
 * HTTP 接口层：REST + SSE + 静态资源。
 *
 * 设计要点（方案 §4.2）：
 *   - 只监听 127.0.0.1，绝不对外暴露
 *   - 所有请求校验本地 token（header 或 query —— EventSource 无法设置请求头）
 *   - 有副作用的操作走统一 Job 通道，纯读走 /api/state/* 快照
 */

import { engine } from "../jobs/engine.ts";
import { collectOverview } from "./overview.ts";
import { INDEX_HTML } from "../web/markup.ts";
import { STYLE_CSS } from "../web/styles.ts";
import { CLIENT_JS } from "../web/client.ts";
import { APP_NAME, APP_VERSION, BUTLER_PORT_HEADLESS } from "../version.ts";
import { collectShellState, enterDsh } from "../domains/runtime/enter.ts";
import {
  desktopAvailable,
  evalJs,
  getMainWindow,
  navigateMain,
  requestShowWindow,
} from "../host/desktop.ts";
import { MIRROR_CANDIDATES } from "../domains/net/sources.ts";
import { collectPluginFacts } from "../domains/plugin/facts.ts";
import {
  loadCatalog,
  type MarketSort,
  type MarketStateFilter,
  queryCatalog,
} from "../net/market.ts";
import { checkUpdates } from "../net/npm-registry.ts";
import { collectLogs, readTail } from "../domains/runtime/logs.ts";
import { butlerConfigPath, downloadsDir, p } from "../util/paths.ts";
import { loadNotices, markNoticesSeen, unseenCount } from "../domains/state/notices.ts";
import { loadConfig, saveConfig } from "../domains/state/config.ts";
import { checkButlerUpdate } from "../net/butler-update.ts";
import { collectCoreChangelog } from "../domains/core/status.ts";
import { maskSecrets } from "../util/redact.ts";
import { autostartCommand, autostartEnabled, setAutostart } from "../host/autostart.ts";
import { log } from "../util/log.ts";

const nextTick = (fn: () => void) => {
  queueMicrotask(() => {
    try {
      fn();
    } catch {
      // 接口层不因为窗口操作失败而报错：窗口的事由 main 侧记日志
    }
  });
};

export interface ServerHandle {
  port: number;
  token: string;
  origin: string;
  shutdown: () => void;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "connection": "keep-alive",
  "x-accel-buffering": "no",
} as const;

/**
 * 会话令牌的 cookie 名。
 *
 * 为什么必须走 cookie，而不是把令牌挂在 URL 上：
 * 桌面态下，窗口是由 `deno desktop` 运行时**自己**导航到 `http://127.0.0.1:<端口>/` 的，
 * 那个 URL 我们控制不了 —— 于是 `?t=<令牌>` 根本送不进去，界面上每一条接口都会 401，
 * 现象就是「窗口开了、布局也在，但永远停在『正在加载…』」。
 *
 * 同源 cookie 由浏览器自动携带，EventSource（SSE）也一样吃这套 —— 而 SSE 恰恰无法自定义请求头，
 * 这正是原先不得不把令牌塞进 query 的原因。
 *
 * 三个属性各有理由：
 *   HttpOnly       页面 JS 不需要读它 —— 这是优点，令牌不再出现在任何 JS 可达的位置；
 *   SameSite=Strict 别的站点发起的请求不会带上它，挡掉 CSRF；
 *   Path=/         全站有效。
 *
 * 威胁模型没变差：本服务只监听 127.0.0.1，令牌挡的是「浏览器里的其它网页」这类跨源来源。
 */
const AUTH_COOKIE = "butler_token";

export function createApiServer(opts: { token: string; port?: number }): ServerHandle {
  const token = opts.token;

  // 【2026-09-25 审计 QUAL-02】Deno.serve 会优先采用环境变量 DENO_SERVE_ADDRESS，
  // 而且它**覆盖**我们显式传的 port（实测：显式传 port 也照样绑到变量里那个）。
  // 本机实测后果：环境里残留 tcp:127.0.0.1:51424（该端口落在 Windows 保留区间）时，
  // --headless 想绑 8731 却去绑 51424 → EADDRINUSE 启动失败，报错还完全不提这个变量；
  // 连单元测试都被一起拖挂。
  // 注意：Deno.env.delete() 对这条路径**无效**（serve 读的是进程环境快照），
  // 必须把变量**改写**成我们真正想要的地址 —— 实测写成 tcp:127.0.0.1:0 就会绑随机端口，
  // 写成 tcp:127.0.0.1:8731 就会老老实实绑 8731。
  const serveOverride = Deno.env.get("DENO_SERVE_ADDRESS");
  if (serveOverride) {
    const want = opts.port ?? 0;
    Deno.env.set("DENO_SERVE_ADDRESS", `tcp:127.0.0.1:${want}`);
    log.warn(
      "api",
      `检测到 DENO_SERVE_ADDRESS=${serveOverride}（它会覆盖监听端口）—— 已改写为 tcp:127.0.0.1:${want}，按管家自己的端口启动`,
    );
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  /**
   * 读取请求里的 cookie。
   * 不用 Deno 的 Cookie 解析工具，是因为这里只需要一个键，手写更少依赖也更直观。
   */
  function readCookie(req: Request, name: string): string | null {
    const raw = req.headers.get("cookie");
    if (!raw) return null;
    for (const part of raw.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
  }

  function authed(req: Request, url: URL): boolean {
    const fromHeader = req.headers.get("x-butler-token");
    if (fromHeader && fromHeader === token) return true;
    const fromQuery = url.searchParams.get("t");
    if (fromQuery === token) return true;
    // cookie 是桌面态的主通道 —— 见下方 AUTH_COOKIE 说明。
    return readCookie(req, AUTH_COOKIE) === token;
  }

  /**
   * 只接受回环 Host。【安全 · 2026-09-25 审计 SEC-01】
   *
   * 只把服务绑在 127.0.0.1 是不够的：DNS rebinding 会让攻击者的域名解析到 127.0.0.1，
   * 此时浏览器发出的请求**同源**（cookie、CORS 都拦不住），但 Host 头仍然是攻击者的域名。
   * 校验 Host 就能把这一步直接掐掉 —— 浏览器一定是按 URL 里的主机名填 Host 的。
   */
  function isLoopbackHost(hostHeader: string | null): boolean {
    if (!hostHeader) return false;
    let h = hostHeader.trim().toLowerCase();
    if (h.startsWith("[")) {
      const end = h.indexOf("]");
      h = end >= 0 ? h.slice(1, end) : h;
    } else {
      const colon = h.lastIndexOf(":");
      if (colon >= 0) h = h.slice(0, colon);
    }
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  }

  /** 单任务的 SSE：先补一份当前快照，再持续推增量事件。 */
  function jobEventStream(jobId: string): Response {
    const encoder = new TextEncoder();
    let unsub: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (obj: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch { /* 客户端已断开 */ }
        };

        const job = engine.get(jobId);
        if (!job) {
          send({ type: "error", message: "任务不存在" });
          controller.close();
          return;
        }

        // 先补快照，避免客户端错过之前的事件
        send({
          type: "snapshot",
          jobId,
          message: job.actionTitle,
          data: { status: job.status, steps: job.steps, progress: job.progress },
        });
        if (job.status !== "running" && job.status !== "queued") {
          send({
            type: "done",
            jobId,
            message: job.error ?? "任务已结束",
            data: { status: job.status },
          });
        }

        unsub = engine.subscribe((ev) => {
          if (ev.jobId !== jobId) return;
          const payload: Record<string, unknown> = {
            type: ev.type,
            jobId: ev.jobId,
            ts: ev.ts,
            seq: ev.seq,
          };
          if (ev.message) payload.message = ev.message;
          if (ev.stepId) payload.stepId = ev.stepId;
          const cur = engine.get(jobId);
          if (cur) {
            payload.data = {
              status: cur.status,
              steps: cur.steps,
              progress: cur.progress,
              ...(ev.data ?? {}),
            };
          } else if (ev.data) {
            payload.data = ev.data;
          }
          send(payload);
          if (ev.type === "done") {
            try {
              controller.close();
            } catch { /* ignore */ }
          }
        });

        // 心跳：防止中间层/浏览器判定超时
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch { /* ignore */ }
        }, 15_000);
      },
      cancel() {
        unsub?.();
        if (heartbeat !== null) clearInterval(heartbeat);
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }

  /** 全局事件流：服务状态变化、任务创建等。 */
  function globalEventStream(): Response {
    const encoder = new TextEncoder();
    let unsub: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (obj: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch { /* ignore */ }
        };
        send({ type: "hello", message: `已连接 ${APP_NAME} ${APP_VERSION}` });

        unsub = engine.subscribe((ev) => {
          send({ type: ev.type, jobId: ev.jobId, ts: ev.ts, message: ev.message, data: ev.data });
        });
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch { /* ignore */ }
        }, 15_000);
      },
      cancel() {
        unsub?.();
        if (heartbeat !== null) clearInterval(heartbeat);
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // 【安全 SEC-01】Host 白名单在**所有路由之前**：静态页、健康检查、接口一律先过这道门。
    if (!isLoopbackHost(req.headers.get("host"))) {
      log.warn("api", `拒绝非回环 Host 的请求：${req.headers.get("host")} ${path}`);
      return json(
        { ok: false, error: "拒绝非本机来源的请求：Host 必须是 127.0.0.1 或 localhost" },
        403,
      );
    }

    if (path === "/healthz") {
      return json({ ok: true, app: APP_NAME, version: APP_VERSION });
    }

    // 静态资源不需要 token（本身不含敏感数据，且要能被 webview 首次加载）
    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      return new Response(INDEX_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (req.method === "GET" && path === "/style.css") {
      return new Response(STYLE_CSS, {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    if (req.method === "GET" && path === "/app.js") {
      return new Response(CLIENT_JS, {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }

    if (!authed(req, url)) {
      return json({ ok: false, error: "未授权：缺少或错误的本地令牌" }, 401);
    }

    // ── 只读快照 ──────────────────────────────────────────────
    if (req.method === "GET" && path === "/api/state/overview") {
      return json(await collectOverview(url.searchParams.get("force") === "1"));
    }
    // 导出日志：日志来源、错误摘录、最新一份日志的正文，拼成一个 txt 落到下载目录。
    // 为什么不走浏览器下载：这是 WebView 窗口，"文件到底存哪了"必须说清楚 —— 直接把路径回给界面。
    if (req.method === "POST" && path === "/api/logs/export") {
      try {
        const report = await collectLogs();
        const out: string[] = [];
        out.push("# DSH管家 日志导出");
        out.push("导出时间：" + new Date().toLocaleString("zh-CN"));
        out.push("产品版本：" + APP_NAME + " " + APP_VERSION);
        out.push(
          "日志来源：" + report.sources.length + " 份 · 合计 " +
            (report.totalBytes / 1048576).toFixed(1) + " MB",
        );
        out.push("");
        out.push("## 日志文件");
        for (const src of report.sources) {
          out.push(
            "- " + src.label + "　" + (src.sizeBytes / 1024).toFixed(0) + " KB　" +
              (src.mtime ?? "未知时间"),
          );
        }
        out.push("");
        out.push("## 错误摘录");
        if (!report.recentErrors.length) out.push("（这次没发现明显错误）");
        for (const hit of report.recentErrors) {
          out.push("");
          out.push("### " + hit.source + (hit.mtime ? "　" + hit.mtime : ""));
          for (const l of hit.lines) out.push(l);
        }
        const newest = report.sources[0];
        if (newest) {
          out.push("");
          out.push("## 最新一份日志全文（" + newest.label + "）");
          out.push(newest.path);
          out.push("");
          const tail = readTail(newest.path, 20000);
          for (const l of tail.lines) out.push(l);
        }
        // 【安全 SEC-10】导出前统一脱敏：日志正文里可能带着 DSH 的进程令牌与其它密钥。
    const text = maskSecrets(out.join("\n"));
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const target = p(downloadsDir(), "DSH管家-日志-" + stamp + ".txt");
        Deno.writeTextFileSync(target, text);
        return json({ ok: true, path: target, bytes: text.length, sources: report.sources.length });
      } catch (e) {
        return json({ ok: false, error: "导出失败：" + (e as Error).message }, 500);
      }
    }
    // 插件市场目录：目录拉取与缓存、搜索/筛选/分页、"本机已装"标注全在服务端做，
    // 界面只负责画 —— 目录有 2000+ 条，不能让浏览器端着。
    // ── 设置 ──────────────────────────────────────────────────────────
    //
    // 设置项一律落 ~/.dsh-butler/config.json（管家自己的文件，绝不碰 DSH）。
    // 只有"开机自启"这一项有系统副作用（写用户级 Run 注册表项），所以它单独处理并回报结果。

    // ── 管家提醒（定时任务发现问题时留痕） ────────────────────────────
    if (req.method === "GET" && path === "/api/notices") {
      const list = loadNotices();
      return json({ ok: true, notices: list, unseen: unseenCount(list) });
    }
    if (req.method === "POST" && path === "/api/notices/seen") {
      const list = markNoticesSeen();
      return json({ ok: true, notices: list, unseen: unseenCount(list) });
    }

    if (req.method === "GET" && path === "/api/settings") {
      const cfg = loadConfig();
      const auto = await autostartEnabled().catch(() => false);
      const cmd = auto ? await autostartCommand().catch(() => null) : null;
      return json({
        ok: true,
        config: cfg,
        // 注册表里的真实状态（配置里那个 autostart 只是用户的意愿，这里给的是事实）
        autostartActual: auto,
        autostartCommand: cmd,
        exePath: Deno.execPath(),
        appName: APP_NAME,
        appVersion: APP_VERSION,
        mirrors: MIRROR_CANDIDATES,
        configPath: butlerConfigPath(),
        defaultPort: BUTLER_PORT_HEADLESS,
      });
    }
    if (req.method === "POST" && path === "/api/settings") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
      }
      const patch: Record<string, unknown> = {};
      const bools = [
        "closeToTray",
        "dockEnabled",
        "autoCheckCoreUpdate",
        "autoCheckButlerUpdate",
        "autoCheckUpdates",
        "backupBeforeUpdate",
        "autostart",
        "onboardingDone", // 首次使用提示完成标记（客户端弹窗点「知道了」后置 true）
      ] as const;
      for (const k of bools) {
        if (typeof body[k] === "boolean") patch[k] = body[k];
      }
      // 定时任务：数字必须是有限非负数（0 = 不做这件事），布尔照收。
      if (body.schedule && typeof body.schedule === "object") {
        const src = body.schedule as Record<string, unknown>;
        const cur = loadConfig().schedule;
        const next = { ...cur };
        for (const k of ["healthEveryHours", "backupEveryHours", "checkUpdatesEveryHours"] as const) {
          const v = src[k];
          if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 24 * 30) next[k] = Math.round(v);
        }
        if (typeof src.enabled === "boolean") next.enabled = src.enabled;
        if (typeof src.notify === "boolean") next.notify = src.notify;
        patch.schedule = next;
      }
      // 备份保留策略：同样只收合理数字
      if (body.retention && typeof body.retention === "object") {
        const src = body.retention as Record<string, unknown>;
        const cur = loadConfig().retention;
        const next = { ...cur };
        if (typeof src.maxBackups === "number" && Number.isFinite(src.maxBackups) && src.maxBackups >= 1 && src.maxBackups <= 500) {
          next.maxBackups = Math.round(src.maxBackups);
        }
        if (typeof src.maxBackupBytes === "number" && Number.isFinite(src.maxBackupBytes) && src.maxBackupBytes >= 1024 * 1024) {
          next.maxBackupBytes = Math.round(src.maxBackupBytes);
        }
        patch.retention = next;
      }
      if (body.coexistMode === "auto" || body.coexistMode === "full") patch.coexistMode = body.coexistMode;
      if (typeof body.theme === "string" && ["light", "dark", "auto"].includes(body.theme)) {
        patch.theme = body.theme;
      }
      if (
        typeof body.logLevel === "string" &&
        ["debug", "info", "warn", "error"].includes(body.logLevel)
      ) {
        patch.logLevel = body.logLevel;
      }
      if (typeof body.dockIdleMs === "number" && Number.isFinite(body.dockIdleMs)) {
        patch.dockIdleMs = Math.min(Math.max(Math.round(body.dockIdleMs), 1000), 60_000);
      }
      if (typeof body.marketCatalogTtlMs === "number" && Number.isFinite(body.marketCatalogTtlMs)) {
        patch.marketCatalogTtlMs = Math.min(
          Math.max(Math.round(body.marketCatalogTtlMs), 5 * 60_000),
          7 * 24 * 60 * 60_000,
        );
      }
      if (typeof body.dshPort === "number" && Number.isFinite(body.dshPort)) {
        patch.dshPort = Math.min(Math.max(Math.round(body.dshPort), 1), 65535);
      }
      if (typeof body.npmRegistry === "string") patch.npmRegistry = body.npmRegistry.trim();
      if (typeof body.proxyUrl === "string") patch.proxyUrl = body.proxyUrl.trim();
      if (Object.keys(patch).length === 0) {
        return json({ ok: false, error: "没有任何可识别的设置项" }, 400);
      }
      const saved = saveConfig(patch as Parameters<typeof saveConfig>[0]);
      const notes: string[] = [];
      if (typeof patch.autostart === "boolean") {
        const res = await setAutostart(patch.autostart);
        notes.push(res.message);
        if (!res.ok) {
          // 系统侧没成功就把意愿回滚，别让配置骗人
          saveConfig({ autostart: !patch.autostart } as Parameters<typeof saveConfig>[0]);
        }
      }
      log.info("api", `设置已更新：${Object.keys(patch).join("、")}`);
      return json({ ok: true, config: saveConfig({}), notes });
    }

    if (req.method === "GET" && path === "/api/market/catalog") {
      const sp = url.searchParams;
      const loaded = await loadCatalog({
        force: sp.get("refresh") === "1",
        ttlMs: loadConfig().marketCatalogTtlMs,
      });
      if (!loaded.ok) return json({ ok: false, error: loaded.error }, 502);

      let installed: Record<string, string> = {};
      try {
        // skipLocks：市场只需要"装了什么、什么版本"，锁判活要起 tasklist，没必要
        const facts = await collectPluginFacts({ skipLocks: true });
        installed = { ...facts.depEntries };
      } catch (e) {
        log.warn("api", `市场：读本机插件清单失败（不影响目录浏览）：${(e as Error).message}`);
      }

      const sortRaw = sp.get("sort") ?? "downloads";
      const stateRaw = sp.get("state") ?? "all";
      const sort: MarketSort = (["stars", "downloads", "new", "name"] as const).includes(
          sortRaw as MarketSort,
        )
        ? (sortRaw as MarketSort)
        : "downloads";
      const state: MarketStateFilter =
        (["all", "installed", "missing", "outdated"] as const).includes(
            stateRaw as MarketStateFilter,
          )
          ? (stateRaw as MarketStateFilter)
          : "all";
      // 已装 ∩ 市场里的包，顺带问一下 registry 有没有新版本（内存里缓存 30 分钟）。
      // 一般只有几个包，查完很快；查不到就当作"不提示更新"，绝不让市场页因此打不开。
      let updates: Record<string, { current: string; latest: string; outdated: boolean }> = {};
      if (sp.get("updates") !== "0") {
        try {
          // 【2026-09-25 修】候选名单必须包含**所有已装插件**，不能只用目录里的 npm 名：
          // 实测本机 15 个插件里有 6 个不在目录里（dsh-sidebar-qa、dsh-sidenote、dsh-server-deck、
          // dsh-docs-panel、dsh-github-workbench，以及目录把它写成 dsh-web-ui#packages/dsh-skill-explorer
          // 的那个）—— 而恰恰这 6 个里有真的有更新的。以前只查目录里能对上的 9 个，
          // 于是「可更新」永远是 0，而 DSH 官方市场同时显示「有 3 个可更新」。
          updates = (await checkUpdates(
            installed,
            [...loaded.catalog.plugins.map((x) => x.npm), ...Object.keys(installed)],
          )).updates;
        } catch (e) {
          log.warn("api", `市场：查更新失败（不影响浏览）：${(e as Error).message}`);
        }
      }

      const page = queryCatalog(
        loaded.catalog,
        {
          q: sp.get("q") ?? "",
          category: sp.get("cat") ?? "",
          sort,
          state,
          page: Number(sp.get("page") ?? "1") || 1,
          pageSize: Number(sp.get("size") ?? "48") || 48,
        },
        installed,
        updates,
      );

      return json({
        ok: true,
        cached: loaded.cached,
        cachedAt: loaded.cachedAt ?? loaded.catalog.fetchedAt,
        note: loaded.note ?? "",
        updated: loaded.catalog.updated,
        source: loaded.catalog.source,
        total: loaded.catalog.plugins.length,
        installedCount: Object.keys(installed).length,
        outdatedCount: page.stats.outdated,
        page,
      });
    }
    if (req.method === "GET" && path === "/api/actions") {
      return json(
        engine.definitions().map((d) => ({
          name: d.name,
          domain: d.domain,
          title: d.title,
          description: d.description ?? "",
          readonly: d.readonly,
          steps: d.steps ?? [],
        })),
      );
    }

    // ── 计划（写操作的 plan 段：零副作用） ────────────────────
    //
    // 界面的写操作一律走 plan → confirm → apply 三段式（方案 §9.6）。
    // 这里就是 plan：只跑动作自己的 preflight（只读检查）并把步骤表摊出来，
    // 一行都不改。真正动手要等用户确认后再走下面的 /api/jobs。
    if (req.method === "POST" && path === "/api/plan") {
      let body: { action?: string; params?: Record<string, unknown> };
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
      }
      const def = body.action ? engine.definition(body.action) : undefined;
      if (!def) return json({ ok: false, error: `未知动作：${body.action ?? "(空)"}` }, 404);
      let findings;
      try {
        findings = def.preflight ? await def.preflight((body.params ?? {}) as never) : [];
      } catch (e) {
        return json({ ok: false, error: `写前检查没能完成：${(e as Error).message}` }, 500);
      }
      return json({
        ok: true,
        plan: true,
        action: def.name,
        title: def.title,
        description: def.description ?? "",
        readonly: def.readonly,
        steps: def.steps ?? [],
        findings,
      });
    }

    // ── 任务 ─────────────────────────────────────────────────
    if (req.method === "POST" && path === "/api/jobs") {
      let body: { action?: string; params?: Record<string, unknown> };
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
      }
      if (!body.action) return json({ ok: false, error: "缺少 action" }, 400);
      const result = await engine.create(body.action, body.params ?? {});
      return json(result, result.ok ? 200 : 400);
    }

    if (req.method === "GET" && path === "/api/jobs") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return json(engine.list(Number.isFinite(limit) ? limit : 50));
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(path);
    if (req.method === "GET" && jobMatch?.[1]) {
      const job = engine.get(jobMatch[1]);
      return job ? json(job) : json({ ok: false, error: "任务不存在" }, 404);
    }

    const eventsMatch = /^\/api\/jobs\/([^/]+)\/events$/.exec(path);
    if (req.method === "GET" && eventsMatch?.[1]) {
      return jobEventStream(eventsMatch[1]);
    }

    const cancelMatch = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(path);
    if (req.method === "POST" && cancelMatch?.[1]) {
      const okCancel = await engine.cancel(cancelMatch[1]);
      return json({ ok: okCancel });
    }

    // ── 外壳状态与「进入 DSH」 ────────────────────────────────────────
    //
    // 【产品形态】一个窗口：管家界面 ↔ DSH 界面，切换就是一次 navigate。
    // 这里只负责"该不该进、进哪去"，导航交给 host 层的 navigateMain。

    if (req.method === "GET" && path === "/api/update/butler") {
      const info = await checkButlerUpdate({
        current: APP_VERSION,
        force: url.searchParams.get("force") === "1",
      });
      return json(info);
    }

    // ③ 本体更新日志：源码仓库最近 N 条提交（只读；未安装本体时给空态）
    if (req.method === "GET" && path === "/api/changelog") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const n = Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 5), 50) : 20;
      return json(await collectCoreChangelog(n));
    }
    if (req.method === "GET" && path === "/api/shell/state") {
      const state = await collectShellState().catch(() => null);
      return json({ ok: true, desktop: desktopAvailable(), state });
    }
    // 诊断用：看看窗口里到底发生了什么（悬浮条在不在、页面到哪一步了）。
    // 排查"注入没生效"这类问题时，这是唯一能看到页面侧真实状态的通道。
    if (req.method === "GET" && path === "/api/shell/probe") {
      const win = getMainWindow();
      if (!win?.executeJs) return json({ ok: false, error: "当前窗口不支持 executeJs" }, 400);
      const probes: Record<string, string> = {
        readyState: "document.readyState",
        hasBody: "!!document.body",
        hasBar: "!!document.getElementById('dsh-butler-dock')",
        hasBinding: "typeof bindings !== 'undefined' && typeof bindings.butlerCmd === 'function'",
        title: "document.title",
        href: "location.href",
      };
      const out: Record<string, unknown> = {};
      for (const [k, code] of Object.entries(probes)) {
        try {
          out[k] = await evalJs(win, code);
        } catch (e) {
          out[k] = `抛出：${(e as Error).message}`;
        }
      }
      return json({ ok: true, probe: out });
    }
    // 把窗口从托盘里叫回来（托盘左键就是干这个；也留一条接口给脚本/未来用）
    if (req.method === "POST" && path === "/api/shell/show") {
      if (!desktopAvailable()) {
        return json({ ok: false, error: "当前不是桌面态" }, 400);
      }
      // 窗口可能已被关掉（这个运行时拦不住 close）—— 交给处理器决定是显示还是重建
      nextTick(() => requestShowWindow());
      return json({ ok: true });
    }
    if (req.method === "POST" && path === "/api/dsh/enter") {
      if (!desktopAvailable()) {
        return json({ ok: false, error: "当前不是桌面态，无法在窗口里打开 DSH" }, 400);
      }
      // 允许为拿令牌而重启一次服务：走到这一步说明用户明确要求"进入 DSH"
      const r = await enterDsh({ restartIfNeeded: true });
      if (!r.ok || !r.url) {
        return json({ ok: false, error: r.error ?? "进不去", state: r.state }, 400);
      }
      // 不覆盖标题：让 DSH 页面自己的 document.title 生效（WebView2 会同步到窗口标题）
      if (!navigateMain(r.url)) {
        return json({ ok: false, error: "窗口导航失败", state: r.state }, 500);
      }
      return json({ ok: true, url: r.url, state: r.state });
    }

    if (req.method === "GET" && path === "/api/events") {
      return globalEventStream();
    }

    // ── 日志 tail（供界面直接取，不必建任务） ────────────────────
    if (req.method === "GET" && path === "/api/logs/butler") {
      const n = Number(url.searchParams.get("n") ?? 200);
      const { log: logger } = await import("../util/log.ts");
      return json(logger.tail(Number.isFinite(n) ? n : 200));
    }

    return json({ ok: false, error: `未找到路由：${req.method} ${path}` }, 404);
  }

  /**
   * 如果请求里还没有正确的会话 cookie，就给响应补一个。
   *
   * 只在缺失时补：避免每条响应（含 SSE 心跳）都重复下发同一个 Set-Cookie。
   * 任何一条响应都能完成"发牌"—— 窗口加载的 `/` 自然就拿到了。
   */
  function withSessionCookie(req: Request, res: Response): Response {
    // 【安全 SEC-01】只有「请求本身已经证明它知道令牌」时才换发 cookie。
    // 以前的写法是「任何缺少 cookie 的请求都补一个」—— 等于把令牌白送给任何能连上本机
    // 端口的人（实测不带任何凭据 GET / 就能从响应头读到令牌），也让 DNS rebinding 拿到同源会话。
    // 桌面态的启动流程不受影响：窗口是用 `/?t=<令牌>` 打开的，那一下就带着正确令牌。
    if (!authed(req, new URL(req.url))) return res;
    if (readCookie(req, AUTH_COOKIE) === token) return res;
    const h = new Headers(res.headers);
    h.append("set-cookie", `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }

  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      ...(opts.port ? { port: opts.port } : {}),
      onListen: () => {/* 端口在下方读取 */},
    },
    (req) => {
      // debug 级请求日志：排查「窗口到底加载到哪一步」时，这是唯一能看到 webview
      // 实际请求序列的地方（渲染进程崩溃时不会有任何其它痕迹）。
      // 默认级别是 info，不会刷屏；需要时把配置的 logLevel 调成 debug。
      const p = new URL(req.url).pathname;
      log.debug("api", `← ${req.method} ${p}`);
      return handle(req)
        .then((res) => withSessionCookie(req, res))
        .catch((e) => {
          log.error("api", `请求处理异常：${(e as Error).message} — ${p}`);
          return withSessionCookie(req, json({ ok: false, error: (e as Error).message }, 500));
        });
    },
  );

  const addr = server.addr as Deno.NetAddr;
  const origin = `http://127.0.0.1:${addr.port}`;
  log.info("api", `本地服务已启动：${origin}`);

  return {
    port: addr.port,
    token,
    origin,
    shutdown: () => {
      try {
        server.shutdown();
      } catch { /* ignore */ }
    },
  };
}
