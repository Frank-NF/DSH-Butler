/**
 * 入口。
 *
 * 三种运行形态：
 *   1) deno desktop 编译态 —— Deno.serve 会自动绑定 webview 打开的地址并驱动窗口，
 *      我们只需把令牌带上，无需手动开窗。
 *   2) deno run 开发态 —— 只有本地服务，自动用系统浏览器打开便于调试。
 *   3) --headless —— 只起服务（供脚本/远程使用），不打开任何界面。
 */

import { engine } from "./jobs/engine.ts";
import { assertStageSafety, registerAllActions } from "./jobs/registry.ts";
import { recoverPluginTxn } from "./domains/plugin/mutate.ts";
import { loadConfig } from "./domains/state/config.ts";
import { createApiServer } from "./api/server.ts";
import { isCliInvocation, runCli, wantsHeadless } from "./cli/router.ts";
import { butlerLogFile, butlerRoot, p } from "./util/paths.ts";
import { log } from "./util/log.ts";
import { APP_NAME, APP_VERSION, BUTLER_PORT_HEADLESS, STAGE_LABEL } from "./version.ts";
import { isDir } from "./host/fs.ts";
import { applyDesktopWorkarounds, hasDesktopRuntime } from "./util/runtime-kind.ts";
import { hideOwnConsole } from "./host/console-hide.ts";
import {
  bindBackHotkey,
  createTray,
  type DesktopWindow,
  installOverlay,
  navigateMain,
  setMainWindow,
  showMainWindow,
} from "./host/desktop.ts";
import { enterDsh } from "./domains/runtime/enter.ts";
import { collectRuntimeStatus } from "./domains/runtime/status.ts";
import { BUTLER_BAR_JS } from "./web/bar.ts";

async function main(): Promise<void> {
  const argv = Deno.args;

  // 【必须最先做】WebView2 的适配参数要在窗口/服务创建之前塞进环境变量，
  // 否则渲染进程会在约 2 秒后因沙箱断言失败而静默死掉，画面全白。
  // 详见 runtime-kind.ts 的 applyDesktopWorkarounds()。
  const workaround = applyDesktopWorkarounds();

  // 【静默执行·重中之重】先给自己藏一个控制台，之后派生的 git/powershell 等
  // 子进程全部继承它，不再各自弹终端窗口（详见 host/console-hide.ts 头注释）。
  // 必须在任何 spawn（体检/总览探针）之前执行。
  const consoleHidden = hideOwnConsole();

  initLogging();

  const config = loadConfig();
  log.setMinLevel(config.logLevel);
  log.info("main", `${APP_NAME} ${APP_VERSION} 启动（stage=${STAGE_LABEL}）`);
  log.info("main", `桌面适配：${workaround}`);
  log.info("main", `静默执行：${consoleHidden}`);

  registerAllActions();
  assertStageSafety();

  // 崩溃恢复：识别上次没结束的任务
  const interrupted = engine.loadHistory();
  if (interrupted.length > 0) {
    for (const j of interrupted) {
      log.warn("main", `发现上次未完成的任务：${j.actionTitle}（${j.id}）`);
    }
  }

  // 插件事务恢复（AC-P3）：上次安装/卸载中途被杀 → active.json 还在盘上 →
  // 在此还原到操作前状态再放行任何新任务。恢复失败只记日志（日志保留，
  // 下次启动再试），绝不阻塞启动 —— 但该状态下新的插件写操作会被 preflight 拦住。
  try {
    const rec = await recoverPluginTxn();
    if (rec.recovered) {
      log.warn("main", `已恢复上次未完成的插件事务：${rec.op} ${rec.name}（已回到操作前状态）`);
      for (const w of rec.warnings) log.warn("main", `插件事务恢复警告：${w}`);
    }
  } catch (e) {
    log.error("main", `插件事务恢复失败：${(e as Error).message}`);
  }

  // 命令行模式：跑完即退出，不起服务
  if (isCliInvocation(argv)) {
    const code = await runCli(argv);
    Deno.exit(code);
  }

  // 服务模式
  const token = generateToken();
  const headless = wantsHeadless(argv);
  const server = createApiServer({
    token,
    // 桌面态不指定端口：deno desktop 运行时会把 webview 指到它实际绑定的地址。
    // headless 态固定端口，否则每次都是随机端口，脚本根本接不上。
    ...(headless ? { port: BUTLER_PORT_HEADLESS } : {}),
  });

  const appUrl = `${server.origin}/?t=${token}`;

  // 【实测坑】环境里若有 DENO_SERVE_ADDRESS（deno desktop / 某些沙箱会设），
  // Deno.serve 会拿它**覆盖**我们显式传的端口 —— 于是 --headless 的固定 8731 失效。
  // 这属于 Deno 的既定行为，我们能做的是把它说清楚，别让"脚本连不上"变成悬案。
  const serveAddrOverride = Deno.env.get("DENO_SERVE_ADDRESS");
  if (headless && serveAddrOverride) {
    log.warn(
      "main",
      `环境变量 DENO_SERVE_ADDRESS=${serveAddrOverride} 覆盖了 --headless 的固定端口 ` +
        `${BUTLER_PORT_HEADLESS}（Deno 既定行为），实际地址以本行下面的"本地服务地址"为准`,
    );
  }

  log.info("main", `本地服务地址：${server.origin}`);
  if (interrupted.length > 0) {
    log.info("main", `有 ${interrupted.length} 个上次未完成的任务，可在界面「任务」中查看`);
  }

  // 优雅退出（托盘菜单也要用它，所以先于窗口/托盘定义）
  const shutdown = () => {
    log.info("main", "收到退出信号，正在关闭…");
    server.shutdown();
    try {
      Deno.exit(0);
    } catch { /* ignore */ }
  };

  if (headless) {
    // 无界面模式：把地址打到 stdout，便于脚本抓取
    console.log(`READY ${appUrl}`);
  } else if (hasDesktopRuntime()) {
    // 桌面态（编译产物 或 deno desktop --hmr）：运行时会开一个隐式窗口，
    // 这里接管它 —— 只为两件事：
    //   1) 把标题从产物名（dsh-butler）改成产品名；
    //   2) 显式导航到带令牌的地址（cookie 已是主通道，这属于纵深防御）。
    // 接管手法与 tmp/probe-window.ts / win-v4 的实测一致：第一个构造函数
    // 接管隐式窗口，不会多开一个。曾经用 `typeof Deno.desktopVersion === "string"`
    // 判断而该值实际是 null，导致编译态被误判、额外弹出一次系统浏览器 —— 别回去。
    const mainWin = adoptDesktopWindow(appUrl);
    setupDesktopTray(mainWin, appUrl, shutdown);
    // 悬浮条要在进 DSH 之前装好：进 DSH 之后页面就换了，注入由 navigateMain 触发
    if (mainWin) setupButlerOverlay(appUrl);
    // 「打开就能用」：装了本体就直接把窗口换成 DSH；没装则留在管家界面（一键部署页）。
    // 异步跑 —— 先让管家界面秒开，再做探测与启动。
    if (mainWin) void autoEnterDsh();
  } else if (!wantsNoOpen(argv)) {
    // 纯 `deno run` 态：本来就没有窗口，用系统浏览器打开便于调试。
    await openBrowser(appUrl);
  }

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    try {
      Deno.addSignalListener(sig, shutdown);
    } catch { /* 某些平台不支持该信号 */ }
  }

  // 保持进程存活
  await new Promise<void>(() => {});
}

function initLogging(): void {
  try {
    if (!isDir(butlerRoot())) Deno.mkdirSync(butlerRoot(), { recursive: true });
    log.attachFile(butlerLogFile());
  } catch (e) {
    console.error("无法初始化日志文件：", (e as Error).message);
  }
}

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** 是否显式要求不要自动开浏览器（纯 `deno run` 态才有意义）。 */
function wantsNoOpen(argv: string[]): boolean {
  return argv.includes("--no-open");
}

/**
 * 接管 deno desktop 的隐式启动窗口：改标题 + 定尺寸 + 显式导航。
 *
 * 只能在「已有桌面运行时」时调用（`hasDesktopRuntime()` 为真），
 * 否则 `Deno.BrowserWindow` 不存在。
 * 任何一步失败都只记日志 —— 窗口是运行时开的，接管失败不影响程序活着。
 */
function adoptDesktopWindow(url: string): DesktopWindow | null {
  try {
    const BW = (Deno as unknown as Record<string, unknown>).BrowserWindow as new (
      o: Record<string, unknown>,
    ) => DesktopWindow;
    // 默认 800×600 对 1080p 屏太袖珍，按 1.8 倍放到 1440×1080（不超屏）。
    const win = new BW({ title: APP_NAME, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    win.navigate(url);
    try {
      win.show();
    } catch { /* 某些平台构造即显示 */ }
    // 登记到 host 层：此后所有"换窗口"都走 navigateMain，谁都不许自己 navigate
    setMainWindow(win);
    log.info("main", `已接管桌面窗口并导航（标题=${APP_NAME}，${WINDOW_WIDTH}×${WINDOW_HEIGHT}）`);
    return win;
  } catch (e) {
    log.warn("main", `接管桌面窗口失败（不影响使用，运行时会自行导航）：${(e as Error).message}`);
    return null;
  }
}

/**
 * 创建任务并等它结束。
 *
 * 悬浮条里的启停/重启都走任务通道（而不是直接调领域函数）：这样它们和界面上点的
 * 完全一样 —— 有步骤、有审计、能在「任务」页回看。桥接调用要等结果，所以这里轮询。
 */
async function runJobAndWait(
  action: string,
  params: Record<string, unknown> = {},
  timeoutMs = 180_000,
): Promise<{ ok: boolean; jobId?: string; result?: unknown; error?: string }> {
  const created = await engine.create(action, params);
  if (!created.ok || !created.jobId) {
    return { ok: false, error: created.error ?? "无法创建任务" };
  }
  const jobId = created.jobId;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = engine.get(jobId);
    if (!job) return { ok: false, jobId, error: "任务记录丢失" };
    if (job.status !== "running" && job.status !== "queued") {
      return job.status === "succeeded"
        ? { ok: true, jobId, result: job.result }
        : { ok: false, jobId, error: job.error ?? `任务未成功（${job.status}）` };
    }
    if (Date.now() > deadline) {
      return { ok: false, jobId, error: "等待超时（任务仍在后台跑，可在「任务」页查看）" };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * 在 DSH 页面里装那条「管家悬浮条」。
 *
 * 这是单窗口形态下最重要的一条回程路：DSH 界面会把管家界面顶掉，托盘图标又未必
 * 一眼看得到。悬浮条里的每个按钮都走和界面一致的通道（见 runJobAndWait）。
 */
function setupButlerOverlay(butlerUrl: string): void {
  const back = () => navigateMain(butlerUrl, { title: APP_NAME, injectOverlay: false });
  const butlerOrigin = butlerUrl.split("?")[0]!;
  installOverlay({
    script: BUTLER_BAR_JS,
    probeId: "dsh-butler-dock",
    bindingName: "butlerCmd",
    // 管家自己的界面不需要悬浮条（那上面本来就有这些按钮），只有 DSH 页面才注入
    shouldInject: (href) => !href.startsWith(butlerOrigin),
    handle: async (cmd) => {
      const c = String(cmd ?? "");
      if (c === "back") {
        back();
        return { ok: true };
      }
      if (c === "status") {
        const st = await collectRuntimeStatus().catch(() => null);
        return {
          ok: true,
          running: Boolean(st?.running),
          healthy: Boolean(st?.health?.reachable),
          port: st?.port ?? null,
        };
      }
      if (c === "start") return await runJobAndWait("runtime.start");
      if (c === "stop") {
        const r = await runJobAndWait("runtime.stop", { confirm: true });
        // 服务停了，DSH 页面就成了一张死页面 —— 顺手切回管家界面，别让用户对着白屏
        if (r.ok) back();
        return r;
      }
      if (c === "restart") {
        const r = await runJobAndWait("runtime.restart");
        if (!r.ok) return r;
        // 重启会换一次访问令牌，必须重新取地址再导航，否则又会掉进 401
        const entered = await enterDsh({ restartIfNeeded: false });
        if (entered.ok && entered.url) {
          navigateMain(entered.url);
          return { ok: true, jobId: r.jobId };
        }
        back();
        return { ok: true, jobId: r.jobId, note: "服务已重启，但没能自动回到 DSH 界面" };
      }
      return { ok: false, error: `未知命令：${c}` };
    },
  });
}

/**
 * 开机自动进 DSH。
 *
 * 这是"打开就能用"的落点：本机装好了本体，启动就直接把窗口换成 DSH 界面 ——
 * 用户不该看到"管家"，除非真的需要（没装、或者服务起不来）。
 *
 * 为什么放在窗口显示之后异步跑：先让窗口把管家界面画出来（秒开），
 * 再去做探测/启动（要几秒到十几秒）。这样用户看到的是"正常打开的程序"，
 * 而不是几秒钟的空白窗口。
 */
async function autoEnterDsh(): Promise<void> {
  try {
    const r = await enterDsh({ restartIfNeeded: true });
    if (r.ok && r.url) {
      log.info("main", `准备进入 DSH：${r.state.note}`);
      // 不覆盖标题：让 DSH 页面自己的 document.title 生效
      navigateMain(r.url);
      return;
    }
    log.info("main", `留在管家界面：${r.error ?? r.state.note}`);
  } catch (e) {
    log.warn("main", `自动进入 DSH 失败（留在管家界面）：${(e as Error).message}`);
  }
}

/**
 * 托盘常驻（方案 §6.5）。
 *
 * 为什么要有它：DSH 是个"挂着跑"的服务型程序 —— 用户最小化/关掉管家之后，
 * 还得能一键把 DSH 界面叫回来、或者把服务重启一下，而不是满桌面找图标。
 *
 * 【降级纪律】拿不到托盘不算错（有的精简桌面没有状态区）：创建失败就什么都不做，
 * 退出路径照旧只有"关窗口"，不给用户留下"关了窗口还赖着不走"的进程。
 */
function setupDesktopTray(
  win: DesktopWindow | null,
  butlerUrl: string,
  shutdown: () => void,
): void {
  let trayOk = false;

  /** 回到管家界面（同一个窗口换回来）。 */
  const backToButler = () => {
    if (!navigateMain(butlerUrl, { title: APP_NAME })) return;
    log.info("main", "已切回管家界面");
  };

  /** 切到 DSH 界面（同一个窗口）。 */
  const goToDsh = () => {
    enterDsh({ restartIfNeeded: true }).then((r) => {
      if (r.ok && r.url) {
        navigateMain(r.url);
        log.info("main", "已切到 DSH 界面");
      } else {
        log.warn("main", `切到 DSH 失败：${r.error ?? "未知原因"}`);
        // 失败时把管家界面叫回来，用户才知道发生了什么
        backToButler();
      }
    }).catch((e) => log.warn("main", `切到 DSH 异常：${(e as Error).message}`));
  };

  const tray = createTray({
    tooltip: `${APP_NAME} ${APP_VERSION}`,
    menu: [
      { item: { label: "进入 DSH", id: "dsh", enabled: true } },
      { item: { label: "回到管家", id: "butler", enabled: true } },
      "separator",
      { item: { label: "重启 DSH 服务", id: "restart", enabled: true } },
      "separator",
      { item: { label: "退出管家", id: "quit", enabled: true } },
    ],
    // 左键单击 = 把窗口叫到前面（不改变当前是管家还是 DSH）
    onClick: () => showMainWindow(),
    onMenuClick: (id) => {
      if (id === "butler") {
        backToButler();
        return;
      }
      if (id === "dsh") {
        goToDsh();
        return;
      }
      if (id === "restart") {
        // 走任务通道：这样重启也有步骤、有审计、能在「任务」页回看
        engine.create("runtime.restart", {}).then((res) => {
          log.info(
            "main",
            res.ok ? `已发起重启任务：${res.jobId}` : `重启任务创建失败：${res.error}`,
          );
        }).catch((e) => log.warn("main", `重启任务创建异常：${(e as Error).message}`));
        return;
      }
      if (id === "quit") shutdown();
    },
  });
  trayOk = tray.ok;

  // 回程第二条路：DSH 界面里没有我们的按钮，托盘图标又可能被折叠进隐藏区，
  // 所以再给一个窗口内快捷键 Ctrl+Shift+B（不占用 DSH 自己的组合键）。
  bindBackHotkey(backToButler);

  // 有托盘才拦「关窗」：关掉主窗口改成收进托盘，DSH 与管家继续在后台跑。
  // 没托盘时绝不能拦 —— 否则用户关不掉这个程序。
  if (trayOk && win?.addEventListener) {
    win.addEventListener("close", (e) => {
      try {
        (e as { preventDefault?: () => void }).preventDefault?.();
        win.hide?.();
        tray.setTooltip(`${APP_NAME}：已收到托盘（右键图标可再打开）`);
        log.info("main", "主窗口已收进托盘（托盘菜单「退出管家」才会真正退出）");
      } catch (err) {
        log.warn("main", `收进托盘失败，按正常关闭处理：${(err as Error).message}`);
      }
    });
  }
}

/** 窗口尺寸：内置默认 800×600 的 1.8 倍 —— 改这一个常数即可整体缩放。 */
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 1080;

/** 用系统默认程序打开 URL（仅开发态使用）。 */
async function openBrowser(url: string): Promise<void> {
  try {
    const cmd = Deno.build.os === "windows"
      ? { c: "cmd", a: ["/c", "start", "", url] }
      : Deno.build.os === "darwin"
      ? { c: "open", a: [url] }
      : { c: "xdg-open", a: [url] };
    const child = new Deno.Command(cmd.c, {
      args: cmd.a,
      stdin: "null",
      stdout: "null",
      stderr: "null",
    });
    child.spawn();
  } catch (e) {
    log.warn("main", `自动打开浏览器失败，请手动访问 ${url}：${(e as Error).message}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    log.error("main", `启动失败：${(e as Error).stack ?? (e as Error).message}`);
    console.error("启动失败：", (e as Error).message);
    Deno.exit(1);
  });
}

// 导出给测试使用
export { engine, p };
