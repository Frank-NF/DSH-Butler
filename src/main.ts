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
import { createTray, openDshWindow } from "./host/desktop.ts";
import { findDshAuthUrl } from "./domains/runtime/dsh-url.ts";

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
    setupDesktopTray(mainWin, shutdown);
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
interface ButlerWindow {
  navigate: (u: string) => void;
  show: () => void;
  hide?: () => void;
  focus?: () => void;
  isClosed?: () => boolean;
  setTitle?: (t: string) => void;
  addEventListener?: (t: string, cb: (e: unknown) => void) => void;
}

/** 主窗口句柄（托盘菜单要拿它 show/focus）。 */
let mainWindow: ButlerWindow | null = null;

function adoptDesktopWindow(url: string): ButlerWindow | null {
  try {
    const BW = (Deno as unknown as Record<string, unknown>).BrowserWindow as new (
      o: Record<string, unknown>,
    ) => ButlerWindow;
    // 默认 800×600 对 1080p 屏太袖珍，按 1.8 倍放到 1440×1080（不超屏）。
    const win = new BW({ title: APP_NAME, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    win.navigate(url);
    try {
      win.show();
    } catch { /* 某些平台构造即显示 */ }
    mainWindow = win;
    log.info("main", `已接管桌面窗口并导航（标题=${APP_NAME}，${WINDOW_WIDTH}×${WINDOW_HEIGHT}）`);
    return win;
  } catch (e) {
    log.warn("main", `接管桌面窗口失败（不影响使用，运行时会自行导航）：${(e as Error).message}`);
    return null;
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
  win: ButlerWindow | null,
  shutdown: () => void,
): void {
  let trayOk = false;
  const focusMain = () => {
    if (!win) return;
    try {
      win.show();
      win.focus?.();
    } catch { /* 窗口可能已关 */ }
  };

  const tray = createTray({
    tooltip: `${APP_NAME} ${APP_VERSION}`,
    menu: [
      { item: { label: "打开管家", id: "butler", enabled: true } },
      { item: { label: "打开 DSH 界面", id: "dsh", enabled: true } },
      "separator",
      { item: { label: "重启 DSH 服务", id: "restart", enabled: true } },
      "separator",
      { item: { label: "退出管家", id: "quit", enabled: true } },
    ],
    onClick: focusMain,
    onMenuClick: (id) => {
      if (id === "butler") {
        focusMain();
        return;
      }
      if (id === "dsh") {
        // 必须用带令牌的地址：DSH 界面不是公开页面，裸地址进去是一片白（401）
        const found = findDshAuthUrl(loadConfig().dshPort);
        if (!found.url) {
          log.warn("main", `打开 DSH 界面失败：${found.note}`);
          return;
        }
        const r = openDshWindow(found.url, { title: "DSH" });
        if (!r.ok) log.warn("main", `打开 DSH 界面失败：${r.error ?? "未知原因"}`);
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
