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
import { startScheduler, type SchedulerHandle } from "./domains/state/scheduler.ts";
import { unseenCount } from "./domains/state/notices.ts";
import { initCoexist } from "./domains/env/coexist.ts";
import { recordSample } from "./domains/diag/stats.ts";
import { createApiServer } from "./api/server.ts";
import { isCliInvocation, runCli, wantsHeadless } from "./cli/router.ts";
import { butlerLogFile, butlerRoot, p } from "./util/paths.ts";
import { log } from "./util/log.ts";
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  BUTLER_PORT_HEADLESS,
  STAGE_LABEL,
  WINDOW_TITLE,
} from "./version.ts";
import { isDir } from "./host/fs.ts";
import {
  claimSingleInstance,
  consumeShowRequest,
  releaseSingleInstance,
  requestShow,
} from "./host/single-instance.ts";
import { focusWindowOfProcess } from "./host/focus-window.ts";
import { applyDesktopWorkarounds, hasDesktopRuntime } from "./util/runtime-kind.ts";
import { hideOwnConsole } from "./host/console-hide.ts";
import {
  applyWindowIcon,
  bindBackHotkey,
  createAnchorWindow,
  createTray,
  createWindow,
  type DesktopWindow,
  evalJs,
  getMainWindow,
  installOverlay,
  lastNavigatedOrigin,
  msSinceLastNavigation,
  navigateMain,
  rememberNavOrigin,
  setMainWindow,
  setShowHandler,
  showMainWindow,
  type TrayHandle,
} from "./host/desktop.ts";
import { enterDsh } from "./domains/runtime/enter.ts";
import { collectRuntimeStatus } from "./domains/runtime/status.ts";
import { BUTLER_BAR_JS } from "./web/bar.ts";
import { windowLooksStuck } from "./host/window_health.ts";

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

  // ── 单实例保护 ───────────────────────────────────────────────────
  // 【2026-09-25 实测事故】管家已经在跑时再启动一次，第二个实例会和第一个共用同一份
  // WebView2 用户数据目录 —— 窗口在、画面全白（日志：悬浮条注入超时，探测结果 null），
  // 两个实例还会互相抢窗口。用户看到的就是「白屏起不来」。这里直接挡掉第二个实例：
  // 把已在运行的那个叫到前台，然后自己退出。
  // headless 与 CLI 模式不参与（脚本本来就可能同时起多个，测试也依赖这一点）。
  const cliMode = isCliInvocation(argv);
  const headlessMode = wantsHeadless(argv);
  if (!cliMode && !headlessMode) {
    const claim = await claimSingleInstance();
    if (!claim.ok) {
      const focused = focusWindowOfProcess(claim.holderPid ?? 0);
      // 光找窗口不够：对方可能已经把窗口关了（进程靠锚窗口留着）。留个请求，
      // 让它在保活定时器里把窗口重建/前置出来。
      requestShow();
      log.warn(
        "main",
        `已经有一个管家在运行（PID ${claim.holderPid}）—— ${focused ? "已把它的窗口拿到前台" : "没能把它拿到前台（可能收进了托盘，点托盘图标即可）"}；本次启动退出，避免两个实例抢窗口/白屏`,
      );
      Deno.exit(0);
    }
  }

  registerAllActions();
  assertStageSafety();

  // 崩溃恢复：识别上次没结束的任务
  const interrupted = engine.loadHistoryAtBoot();
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
  const headless = headlessMode; // 上面已经算过（单实例保护要用它）
  const server = createApiServer({
    token,
    // 桌面态不指定端口：deno desktop 运行时会把 webview 指到它实际绑定的地址。
    // headless 态固定端口，否则每次都是随机端口，脚本根本接不上。
    ...(headless ? { port: BUTLER_PORT_HEADLESS } : {}),
  });

  const appUrl = `${server.origin}/?t=${token}`;

  // 【实测坑 · 2026-09-25 审计 QUAL-02 已修】环境里若有 DENO_SERVE_ADDRESS（deno desktop /
  // 某些沙箱会设），Deno.serve 会拿它覆盖我们显式传的端口 —— 于是 --headless 的固定 8731 失效，
  // 甚至因端口被占而直接启动失败。现在这个变量在 createApiServer（真正 bind 的地方）里就被摘掉
  // 并记一条 warn，单元测试也一并受保护，这里不再重复提示。

  log.info("main", `本地服务地址：${server.origin}`);
  if (interrupted.length > 0) {
    log.info("main", `有 ${interrupted.length} 个上次未完成的任务，可在界面「任务」中查看`);
  }

  // 优雅退出（托盘菜单也要用它，所以先于窗口/托盘定义）
  const shutdown = () => {
    log.info("main", "收到退出信号，正在关闭…");
    stopHousekeeping();
    scheduler?.stop();
    scheduler = null;
    releaseSingleInstance();
    server.shutdown();
    try {
      Deno.exit(0);
    } catch { /* ignore */ }
  };

  // 与官方桌面端共存：启动时算一次模式（检测失败一律当「没检测到」，不因检测而改变行为）
  const coexist = await initCoexist();
  log.info("main", `共存模式：${coexist.mode === "service-only" ? "运维模式（官方桌面端在跑）" : "完整模式"}${coexist.detection.evidence.length ? " —— " + coexist.detection.evidence.join("；") : ""}`);

  // 每天记一条运维采样（体积 / 任务数），趋势曲线靠它；同一天覆盖，不留重复点
  try {
    recordSample();
  } catch (e) {
    log.warn("main", `运维采样失败：${(e as Error).message}`);
  }

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
    const tray = setupDesktopTray(mainWin, appUrl, shutdown);
    // 保活 + 托盘提示刷新（没有它，收进托盘后进程会自己退出，见 startHousekeeping 注释）
    startHousekeeping(tray, { headless });
    // 悬浮条要在进 DSH 之前装好：进 DSH 之后页面就换了，注入由 navigateMain 触发
    // 运维模式下不注入悬浮条：官方桌面端在跑时，用户不需要多一条浮条抢地方
    if (mainWin && coexist.mode === "full") setupButlerOverlay(appUrl);
    else if (mainWin) log.info("main", "运维模式：跳过悬浮条注入（要恢复完整模式，把设置里的 coexistMode 改成 full）");
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
    const win = new BW({ title: WINDOW_TITLE, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    win.navigate(url);
    rememberNavOrigin(url);
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
 * 装上那条「管家悬浮条」（DSH 页与管家页都注入）。
 *
 * 这是单窗口形态下最重要的一条回程路：DSH 界面会把管家界面顶掉，托盘图标又未必
 * 一眼看得到。悬浮条里的每个按钮都走和界面一致的通道（见 runJobAndWait）。
 *
 * 【为什么管家页也要】用户反馈"只有启动按钮、找不到关闭 DSH 服务"——管家页上
 * 首页那张状态卡只给一个主行动，停止服务藏在「运行状态」页里。两个界面都摆这条
 * 工具条之后，启停/重启在哪儿都点得到；页面会把自己的位置（在不在管家页）报上来，
 * 宿主据此决定"停止/重启之后要不要切页面"。
 */
function setupButlerOverlay(butlerUrl: string): void {
  const cfg = loadConfig();
  // 设置里关掉就别注入：页面保持干净
  if (!cfg.dockEnabled) {
    log.info("main", "设置里关掉了浮动工具条，跳过注入");
    return;
  }
  // 回管家界面：仍然注入悬浮条（用户要在管家界面上也能一键启停 DSH 服务）
  const back = () => navigateMain(butlerUrl, { title: WINDOW_TITLE });
  const butlerOrigin = butlerUrl.split("?")[0]!;
  // 自动收起的秒数、管家页地址都随注入塞给页面脚本：
  // 页面据此知道"我现在是不是就在管家界面上"（在的话不生成「回管家」那颗按钮）
  const barScript = "window.__DSH_BUTLER_IDLE_MS__ = " + Math.max(1000, cfg.dockIdleMs) + ";" +
    "window.__DSH_BUTLER_HOME__ = " + JSON.stringify(butlerOrigin) + ";" +
    BUTLER_BAR_JS;
  installOverlay({
    script: barScript,
    probeId: "dsh-butler-dock",
    bindingName: "butlerCmd",
    // 两个界面都注入：管家页面上原来"什么按钮都有"，可用户就是找不到"关闭 DSH 服务"
    // （首页状态卡只有一个主行动，停止服务藏在运行状态页里）。现在右下角这条工具条
    // 在哪儿都能启停（2026-09-27 用户反馈）。
    handle: async (cmd, arg) => {
      const c = String(cmd ?? "");
      // 页面自己报的"我现在就在管家界面上"（停止/重启之后要不要切页面看它）
      const atHome = Boolean(arg && (arg as { atHome?: unknown }).atHome);
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
        // 服务停了，DSH 页面就成了一张死页面 —— 顺手切回管家界面，别让用户对着白屏。
        // 本来就在管家界面上时别切：那等于把页面重刷一遍，用户刚点的东西全没了。
        if (r.ok && !atHome) back();
        return r;
      }
      if (c === "restart") {
        const r = await runJobAndWait("runtime.restart");
        if (!r.ok) return r;
        // 管家界面上点重启就留在管家界面（那是管理台）；从 DSH 页面点才需要重新导航
        if (atHome) return { ok: true, jobId: r.jobId };
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
 * 托盘常驻 + 窗口生命周期（方案 §6.5）。
 *
 * 【2026-09-25 修正：最小化就只是最小化】窗口两个按钮各归各的：
 *   - **点最小化（−）**：走系统正常最小化 —— 窗口进任务栏，任务栏图标**必须留着**，点一下就能还原。
 *     以前这里把 [-32000,-32000] 当成"要收托盘"的信号直接 hide() 掉窗口，于是任务栏图标消失、
 *     用户只能跑去托盘里找（用户实测反馈：「我怎么老是任务栏图标没了」）。
 *     实际上 [-32000,-32000] 是 Windows 表示"窗口已最小化"的标准哨兵，不是"该隐藏"。
 *   - **点 X**：按设置走 —— closeToTray=true 收进托盘（窗口被销毁，进程与托盘还在，点托盘图标重建）；
 *     false 就真退出。**只有这一个入口会去托盘**。
 * 其余实测结论（2026-09-24，deno 2.9.7 + WebView2，四个探针逐个验证过）：
 *   - close 事件的 cancelable=false，preventDefault() 无效，窗口真被销毁；
 *   - 只要最后一个窗口被销毁，运行时立刻退出 —— 在 close 里临时补窗口也来不及；
 *   - 但启动时留一个隐藏的"锚窗口"就有效：主窗口关掉后进程照旧活着（探针实测 >24 秒）。
 */

let shellTray: TrayHandle | null = null;
/** 真正的退出函数（由 setupDesktopTray 拿到，关窗即退出时要用）。 */
let shellShutdown: (() => void) | null = null;
let shellButlerUrl = "";
/** 窗口当前显示的是哪个界面（重建窗口时要开回原来那个）。 */
let shellView: "butler" | "dsh" = "butler";
/** 锚窗口：唯一作用是别让运行时因为主窗口被关掉而退出。 */
let anchorWindow: DesktopWindow | null = null;


/**
 * 建立（或重建）主窗口。
 *
 * 被关掉之后还能再开回来，是"点 X 不退出"能成立的前提：窗口没了，锚窗口把进程撑住，
 * 这里负责把真正的窗口重建出来并挂好所有处理器。
 */
function ensureMainWindow(url: string, view: "butler" | "dsh"): boolean {
  const cur = getMainWindow();
  shellView = view;
  hiddenToTray = false;
  if (cur && !cur.isClosed?.()) {
    // 两个界面都注入悬浮条（管家页上少一颗「回管家」，见 setupButlerOverlay）
    return navigateMain(url, { title: WINDOW_TITLE });
  }
  const win = createWindow({ title: WINDOW_TITLE, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  if (!win) {
    log.warn("main", "主窗口重建失败（运行时没给出窗口）");
    return false;
  }
  setMainWindow(win);
  try {
    win.navigate(url);
    win.show();
  } catch (e) {
    log.warn("main", `主窗口重建后导航失败：${(e as Error).message}`);
  }
  attachMainWindowHandlers(win);
  log.info("main", `主窗口已重建（${view === "dsh" ? "DSH 界面" : "管家界面"}）`);
  return true;
}

/** 回到管家界面（窗口被关掉过就重建）。 */
function backToButler(): void {
  if (!ensureMainWindow(shellButlerUrl, "butler")) return;
  log.info("main", "已切回管家界面");
}

/** 切到 DSH 界面（窗口被关掉过就重建）。 */
function goToDsh(): void {
  enterDsh({ restartIfNeeded: true }).then((r) => {
    if (r.ok && r.url) {
      ensureMainWindow(r.url, "dsh");
      log.info("main", "已切到 DSH 界面");
    } else {
      log.warn("main", `切到 DSH 失败：${r.error ?? "未知原因"}`);
      backToButler();
    }
  }).catch((e) => log.warn("main", `切到 DSH 异常：${(e as Error).message}`));
}

/** 给主窗口挂上：关窗留进程、最小化收托盘、回前台复位提示、回程快捷键。 */
function attachMainWindowHandlers(win: DesktopWindow): void {
  if (!win.addEventListener) return;

  // ① 点 X：窗口会被销毁（这个运行时拦不住），但锚窗口让进程与托盘活着
  win.addEventListener("close", () => {
    if (!loadConfig().closeToTray) {
      log.info("main", "设置里选了关闭即退出，正在退出管家");
      try {
        shellShutdown?.();
      } catch { /* 忽略 */ }
      return;
    }
    hiddenToTray = true;
    shellTray?.setTooltip(`${APP_NAME}：窗口已关闭，DSH 仍在后台（点图标可重新打开）`);
    log.info(
      "main",
      "主窗口被关闭 —— 进程仍在后台（锚窗口撑着，DSH 也照旧跑），点托盘图标可重新打开",
    );
  });

  // ② 点最小化（−）：**什么都不做，交给系统**。
  // 【2026-09-25 修正】这里以前监听 resize、看到位置变成 [-32000,-32000] 就 hide() 收进托盘 ——
  // 于是最小化把任务栏图标也弄没了，用户以为程序关了（实测反馈）。
  // [-32000,-32000] 只是 Windows 对"已最小化窗口"的坐标表示，最小化就该留在任务栏。

  // ③ 回到前台：复位提示
  win.addEventListener("focus", () => {
    hiddenToTray = false;
    shellTray?.setTooltip(`${APP_NAME} ${APP_VERSION}`);
  });

  // ④ 回程快捷键（DSH 界面里没有我们的按钮，托盘图标也可能被折叠进隐藏区）
  bindBackHotkey(backToButler);

  // ④ 窗口图标：打包器不往 exe 里嵌图标，只能开窗后自己设一遍
  applyWindowIcon();

  // ⑤ 悬浮条的绑定是"每扇窗口一份"的：窗口重建之后必须重新绑定并重新注入，
  //    否则新窗口进了 DSH 界面就没有右下角那条工具条了。
  if (shellButlerUrl) setupButlerOverlay(shellButlerUrl);
}

function setupDesktopTray(
  win: DesktopWindow | null,
  butlerUrl: string,
  shutdown: () => void,
): TrayHandle | null {
  shellShutdown = shutdown;
  let trayOk = false;
  shellButlerUrl = butlerUrl;

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
    // 左键单击 = 把窗口叫回来：还在（收在托盘里）就直接显示；已被关掉就重建
    onClick: () => {
      const cur = getMainWindow();
      if (cur && !cur.isClosed?.()) {
        hiddenToTray = false;
        showMainWindow();
        log.info("main", "托盘左键：把窗口叫回前台");
        return;
      }
      log.info("main", "托盘左键：窗口已被关掉过，重新建一扇");
      if (shellView === "dsh") goToDsh();
      else backToButler();
    },
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

  // 【只有托盘真的建出来才拦】没托盘就照常关/照常最小化 —— 否则用户会得到一个
  // "关不掉、也找不回来"的进程。
  if (trayOk && win) {
    attachMainWindowHandlers(win);
    // 锚窗口：让"主窗口被关掉"不至于带走整个进程（详见文件头那段实测结论）
    if (!anchorWindow) {
      anchorWindow = createAnchorWindow();
      log.info("main", anchorWindow ? "锚窗口已就位（关掉主窗口后进程仍活着）" : "锚窗口创建失败");
    }
  }

  // 把"叫窗口"的能力交给接口层（/api/shell/show）与托盘共用：存在就显示，被关掉过就重建
  const bringUp = () => {
    const cur = getMainWindow();
    if (cur && !cur.isClosed?.()) {
      hiddenToTray = false;
      showMainWindow();
      return true;
    }
    if (shellView === "dsh") {
      goToDsh();
      return true;
    }
    return ensureMainWindow(shellButlerUrl, "butler");
  };
  // 保活定时器也要能叫窗口（第二个实例的「请把窗口叫出来」请求走这条路）
  bringToFront = bringUp;
  setShowHandler(bringUp);

  shellTray = tray.ok ? tray : null;
  return shellTray;
}

// ── 窗口卡在死页面上时的自愈 ─────────────────────────────────────────

/** 问页面三件事：现在在哪、标题是什么、是不是 Chromium 的错误页。 */
const WINDOW_STATE_JS =
  "(function(){var e=document.querySelector('#main-frame-error,#error-code,.neterror');" +
  // 标题要 encodeURIComponent：实测 executeJs 回来的非 ASCII 字符会被弄花
  // （日志里出现过「DSH ,0??」这种），编码成纯 ASCII 才搬得回来，取到后再解码
  "var t='';try{t=encodeURIComponent(document.title||'')}catch(x){}" +
  "return JSON.stringify({href:location.href,origin:location.origin,title:t,error:!!e});})()";

/** 探针把标题做了百分号编码（非 ASCII 过 FFI 会花），这里解回来；解不开就用原文。 */
function decodeProbeText(s: string | undefined): string {
  if (!s) return "";
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 上一轮看到的异常页面：连看两轮才算数，免得把"正在导航中"当成跑偏。 */
let stuckSeen: { href: string; at: number } | null = null;
/** 上次自愈的时间：救完给一分钟静默期，别把页面刷成幻灯片。 */
let lastHealAt = 0;
/** 连续几次问不出页面的话（渲染进程卡死时 executeJs 会一直抛）。 */
let probeFailures = 0;
/** 第一次成功探测记一条日志：出问题时要能确认"看护真的在跑"，平时不刷屏。 */
let probeLogged = false;

/**
 * 「窗口卡在死页面上」的自愈。
 *
 * 【现场】2026-09-28 用户实测：管家窗口停在 Edge 的「127.0.0.1 拒绝连接」错误页
 * （ERR_CONNECTION_REFUSED），而管家与 DSH 两个服务都活着 —— 说明某一刻窗口被指到了
 * 一个**没人监听的本地端口**，之后没有任何机制把它拉回来。页面里那条悬浮条也随页面一起
 * 没了，用户只剩托盘一条路（而托盘图标他们刚刚才遇上"丢了"，那条路也不可靠）。
 *
 * 判据（命中任意一条就是窗口废了）：
 *   1) 页面源不是"我们最后指过去的那个源"，且那个源是本机回环地址 —— 真正出事那次就是这种；
 *   2) 页面带 Chromium 错误页标记（连我们自己的地址都没打开、源却一样的那种）；
 *   3) 页面是空白（about:blank / origin=null）。
 * 用户自己点开的外部网站不算，别去打断他。
 *
 * 救法：跑偏的是管家自己的地址就回管家页，否则重新进 DSH（进不去会自动退回管家页）。
 */
async function healStuckWindow(): Promise<void> {
  const win = getMainWindow();
  if (!win?.executeJs) return;
  let st: { href?: string; origin?: string; title?: string; error?: boolean } | null = null;
  try {
    const raw = await evalJs(win, WINDOW_STATE_JS);
    st = typeof raw === "string" ? JSON.parse(raw) : (raw as typeof st);
  } catch {
    // 页面正在切换、窗口刚建好都会抛：下一轮再看。
    // 但连续几次都问不出话，就说明渲染进程出事了 —— 重新导航一次（浏览器进程会换一个新渲染进程）
    probeFailures++;
    if (probeFailures >= 3) {
      probeFailures = 0;
      log.warn("main", "窗口连续 3 次问不出话（渲染进程可能卡死）—— 重新导航一次");
      backToButler();
    }
    return;
  }
  probeFailures = 0;
  if (!st || typeof st.origin !== "string") return;
  const origin = st.origin;
  // 第一次"看得见真页面"的时候记一条：出问题时要能确认看护真的在跑、看的是哪个页面。
  // 起始那次探测通常是加载中的空白，不记（免得看起来像出事）。
  if (!probeLogged && origin !== "null" && origin !== "") {
    probeLogged = true;
    log.info(
      "main",
      `窗口看护已生效：当前页面 ${origin}（标题「${decodeProbeText(st.title)}」），期望 ${lastNavigatedOrigin() ?? "(未知)"}`,
    );
  }
  const expected = lastNavigatedOrigin();
  const blank = origin === "null" || st.href === "about:blank";
  const now = Date.now();
  if (!windowLooksStuck(st, expected, { msSinceNavigation: msSinceLastNavigation() })) {
    stuckSeen = null;
    return;
  }
  const href = st.href ?? "(读不到地址)";
  if (!stuckSeen || stuckSeen.href !== href) {
    stuckSeen = { href, at: now };
    return; // 第一轮只是记账：可能是导航中途
  }
  // 上一轮（30 秒前）看到的是同一个坏页面 → 确认卡住；救完一分钟内不重复救
  if (now - stuckSeen.at < 20_000 || now - lastHealAt < 60_000) return;
  lastHealAt = now;
  stuckSeen = null;
  const butlerOrigin = shellButlerUrl.split("?")[0] ?? "";
  log.warn(
    "main",
    `窗口卡住了：${href}（标题「${decodeProbeText(st.title)}」${st.error ? "，错误页" : ""}）` +
      ` —— 期望的源是 ${expected ?? "(未知)"}，正在重新导航`,
  );
  if (origin === butlerOrigin || blank) backToButler();
  else goToDsh();
}

// ── 后台保活 ─────────────────────────────────────────────────────────

/** 窗口是否正收在托盘里（隐藏时不要拿服务状态覆盖"已收进托盘"的提示）。 */
let hiddenToTray = false;
let housekeepingTimer: ReturnType<typeof setInterval> | null = null;
let showRequestTimer: ReturnType<typeof setInterval> | null = null;
/** 由 initShell 装上的「把窗口叫到前台（必要时重建）」回调，保活定时器要用。 */
let bringToFront: (() => boolean) | null = null;
/** 定时任务调度器（体检 / 备份 / 查更新）。 */
let scheduler: SchedulerHandle | null = null;
/** 未查看的提醒数（调度器回调更新，托盘提示每 30 秒读它，不反复读文件）。 */
let unseenNotices = 0;

/**
 * 每 30 秒做一次后台整理，同时充当「保活」。
 *
 * 【为什么必须有这个定时器】deno desktop 的退出判据是「没有可见窗口 + 没有活的异步任务」。
 * 实测（2026-09-24，同款探针）：只 await 一个永不 resolve 的 Promise **不算**活任务 ——
 * 关窗收进托盘后进程会在几秒内自己退出，托盘图标随之消失，用户看到的就是"托盘坏了"。
 * 有了这个定时器，进程稳稳留在后台（探针实测隐藏后存活 > 45 秒仍在跑）。
 */
function startHousekeeping(tray: TrayHandle | null, opts: { headless?: boolean } = {}): void {
  if (housekeepingTimer !== null) return;
  const tick = async () => {
    // 先看一眼"窗口是不是卡在死页面上"：这件事与托盘在不在**无关** ——
    // 页面一旦废了，页面里那条悬浮条也一起没了，用户本来就只剩托盘一条路，
    // 托盘再不可用时更需要有人把页面救回来。
    try {
      await healStuckWindow();
    } catch { /* 自愈失败不影响保活 */ }
    if (!tray) return;
    try {
      const st = await collectRuntimeStatus();
      if (hiddenToTray) return; // 收在托盘里时保留"点图标回来"的提示
      const state = st.running ? (st.health?.reachable ? "运行中" : "已启动·未就绪") : "已停止";
      const pick = unseenNotices > 0 ? ` · ${unseenNotices} 条提醒` : "";
      tray.setTooltip(`${APP_NAME}：DSH ${state}${st.port ? ` · ${st.port}` : ""}${pick}`);
    } catch { /* 探测失败不影响保活 */ }
  };
  void tick();
  housekeepingTimer = setInterval(() => {
    void tick();
  }, 30_000);

  // 「请把窗口叫出来」的请求单独用一个 3 秒的轻量定时器（只 statSync 一个文件）。
  // 不能塞进 30 秒那条：用户重复启动管家时，窗口 30 秒后才出来太久，体验像卡死。
  // 定时任务调度器（P1-2e + P2-3）。
  // 与保活共用这一个入口，免得又多一处「谁先谁后启动」的疑问；
  // 只在非 headless 时跑：headless 是给脚本/远程调用的，不该偷偷做体检和备份。
  // 测试钩子：BUTLER_SCHEDULE_FORCE=1 让 headless 也跑调度器；
  // BUTLER_SCHEDULE_TICK_MS 可把默认 5 分钟的间隔调短（真机验证用）。
  const forceSchedule = Deno.env.get("BUTLER_SCHEDULE_FORCE") === "1";
  const tickMs = Number(Deno.env.get("BUTLER_SCHEDULE_TICK_MS") ?? "");
  if ((!opts.headless || forceSchedule) && !scheduler) {
    unseenNotices = unseenCount();
    scheduler = startScheduler({
      intervalMs: Number.isFinite(tickMs) && tickMs > 0 ? tickMs : undefined,
      onNoticesChanged: (n) => { unseenNotices = n; },
    });
    const sc = loadConfig().schedule;
    log.info(
      "main",
      sc.enabled
        ? `定时任务已启动：体检每 ${sc.healthEveryHours} 小时 / 备份每 ${sc.backupEveryHours} 小时 / 查更新每 ${sc.checkUpdatesEveryHours} 小时`
        : "定时任务已关闭（设置里可开）",
    );
  }

  showRequestTimer = setInterval(() => {
    if (!consumeShowRequest()) return;
    log.info("main", "收到「把窗口叫出来」请求（重复启动了管家）—— 正在把窗口叫到前台");
    try {
      bringToFront?.();
    } catch (e) {
      log.warn("main", `叫窗口失败：${(e as Error).message}`);
    }
  }, 3_000);
}

function stopHousekeeping(): void {
  if (housekeepingTimer !== null) {
    clearInterval(housekeepingTimer);
    housekeepingTimer = null;
  }
  if (showRequestTimer !== null) {
    clearInterval(showRequestTimer);
    showRequestTimer = null;
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
