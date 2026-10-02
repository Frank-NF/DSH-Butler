/**
 * 桌面能力（子窗口 / 托盘）—— 全项目【唯一】允许碰 Deno.BrowserWindow / Deno.Tray 的地方。
 *
 * 为什么必须集中：这两个 API 是 experimental（deno.json 里写着"subject to change"），
 * 而且只在 deno desktop 运行时里存在。散落各处的话，一旦升级 Deno 改了签名，
 * 要找的地方就是整个仓库；集中在这里，改一处就行。
 *
 * 两条纪律：
 *   ① 任何调用都可能不存在/抛错（开发态、headless、未来 API 变动）—— 全部 typeof 检查 + try/catch，
 *      失败只记日志并返回"不可用"，绝不让桌面能力的缺失拖垮主流程；
 *   ② 托盘图标走**内嵌 PNG 字节**，不读磁盘文件 —— 编译态下 cwd 不是工程目录，
 *      按相对路径读图标是经典的"开发能跑、打包就白"的坑。
 *
 * API 依据（2026-06 官方文档 deno.com/runtime/desktop/{windows,tray_and_dock}）：
 *   - 第一个 new BrowserWindow() 接管隐式启动窗口，之后每 new 一次开一个新窗口；
 *   - Tray.setIcon 收的是 PNG 字节（不是路径）；setMenu 收 MenuItem 数组，字符串 "separator" 表示分隔线；
 *   - 事件统一走 addEventListener（窗口与托盘都是 EventTarget）。
 */

import { isDir } from "./fs.ts";
import { hasDesktopRuntime } from "../util/runtime-kind.ts";
import { log } from "../util/log.ts";
import { butlerRoot, dirname, p } from "../util/paths.ts";
import { createWin32Tray } from "./win32-tray.ts";
import { setWindowIcon } from "./win32-window.ts";

// ── 最小接口（只声明我们真正用到的部分） ──────────────────────────────

interface BrowserWindowOptions {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  resizable?: boolean;
  alwaysOnTop?: boolean;
  frameless?: boolean;
  noActivate?: boolean;
}

interface BrowserWindowLike {
  windowId: number;
  setTitle(t: string): void;
  getSize(): [number, number];
  setSize(w: number, h: number): void;
  getPosition(): [number, number];
  setPosition(x: number, y: number): void;
  isClosed(): boolean;
  close(): void;
  isVisible(): boolean;
  show(): void;
  hide(): void;
  focus(): void;
  navigate(u: string): void;
  reload(): void;
  executeJs(code: string): Promise<unknown>;
  addEventListener(type: string, cb: (e: unknown) => void): void;
}

export interface TrayMenuItem {
  item: {
    label: string;
    id: string;
    /**
     * 【必填】运行时对菜单项做反序列化时，enabled 缺失会直接报
     * "missing field `enabled`" 并整份菜单都不生效（实测 2026-09-24，deno 2.9.7）。
     * 文档示例里每一项都带它，这里把类型也钉成必填，免得下次又漏。
     */
    enabled: boolean;
    accelerator?: string;
  };
}

interface TrayLike {
  trayId: number;
  setIcon(bytes: Uint8Array): void;
  setIconDark(bytes: Uint8Array | null): void;
  setTooltip(t: string | null): void;
  setMenu(menu: unknown): void;
  getBounds(): { x: number; y: number; width: number; height: number } | null;
  destroy(): void;
  addEventListener(type: string, cb: (e: { detail?: { id?: string } }) => void): void;
}

function browserWindowCtor(): (new (o: BrowserWindowOptions) => BrowserWindowLike) | null {
  const v = (Deno as unknown as Record<string, unknown>).BrowserWindow;
  return typeof v === "function" ? (v as new (o: BrowserWindowOptions) => BrowserWindowLike) : null;
}

function trayCtor(): (new () => TrayLike) | null {
  const v = (Deno as unknown as Record<string, unknown>).Tray;
  return typeof v === "function" ? (v as new () => TrayLike) : null;
}

/** 桌面能力是否可用（开发态 / headless 态为 false）。 */
export function desktopAvailable(): boolean {
  return hasDesktopRuntime() && browserWindowCtor() !== null;
}

/** 托盘能力是否可用（与窗口分开判：有的环境有窗口没托盘）。 */
export function trayAvailable(): boolean {
  return hasDesktopRuntime() && trayCtor() !== null;
}

// ── 主窗口（单一窗口外壳） ────────────────────────────────────────────
//
// 【产品形态】这个程序就**是**桌面版 DSH：一个窗口。
//   本机没装 → 窗口里是部署向导；装好了 → 同一个窗口直接换成 DSH 界面。
// 早先的"另开一扇 DSH 窗口"已被这个设计取代 —— 用户明确要的是"打开就能用"，
// 而不是"管家窗口 + DSH 窗口"两个窗口来回切。
//
// 于是窗口只有两种模式，切换就是一次 navigate：
//   setup 模式：管家自己的界面（部署 / 诊断 / 插件 / 日志）
//   dsh   模式：DSH 的 web 界面
// 回程入口：托盘菜单「回到管家」+ 窗口快捷键 Ctrl+Shift+B（因为 DSH 界面里没有我们的按钮）。

export interface DesktopWindow {
  windowId: number;
  navigate(url: string): void;
  show(): void;
  hide?(): void;
  focus?(): void;
  isClosed?(): boolean;
  isVisible?(): boolean;
  setTitle?(t: string): void;
  getSize?(): [number, number];
  getPosition?(): [number, number];
  addEventListener?(type: string, cb: (e: unknown) => void): void;
  /** 在页面里执行一段脚本并拿回结果（JSON 可序列化）。 */
  executeJs?(code: string): Promise<unknown>;
  /** 暴露一个 Deno 侧函数给页面：页面里用 bindings.<name>(...) 调。 */
  bind?(name: string, handler: (...args: unknown[]) => unknown): void;
}

let mainWindow: DesktopWindow | null = null;

/** 登记主窗口（由 main.ts 在接管隐式窗口后调用）。 */
export function setMainWindow(win: DesktopWindow | null): void {
  mainWindow = win;
}

export interface CreateWindowOptions {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  frameless?: boolean;
  noActivate?: boolean;
}

/**
 * 创建一扇窗口。
 *
 * 注意第一条构造会"接管"运行时启动时开的那扇隐式窗口，之后的每次构造才是新开一扇 ——
 * main.ts 首次接管用它，主窗口被用户关掉之后重建也用它。
 */
/** 应用图标文件候选（产物目录的 AppIcon.ico / 源码目录的 icons/icon.ico）。 */
export function resolveAppIconPath(): string | undefined {
  const candidates: string[] = [];
  try {
    candidates.push(p(dirname(Deno.execPath()), "AppIcon.ico"));
  } catch { /* 取不到 exe 路径就算了 */ }
  candidates.push(p(Deno.cwd(), "icons", "icon.ico"));
  for (const c of candidates) {
    try {
      if (Deno.statSync(c).isFile) return c;
    } catch { /* 试下一个 */ }
  }
  return undefined;
}

/**
 * 把应用图标设到窗口上（标题栏 + 任务栏）。
 *
 * 打包器只生成 AppIcon.ico、不往 exe 里嵌（见 host/win32-window.ts 的说明），
 * 所以每次开窗/重建窗口后都要自己设一遍 —— 这个函数就是要挂在那两个时机上。
 */
export function applyWindowIcon(): boolean {
  const path = resolveAppIconPath();
  if (!path) return false;
  // 开窗那一刻窗口常常还没"可见"，直接找会找不到 —— 先试一次，不成就在 5 秒内退避重试。
  let done = setWindowIcon(path);
  if (done) return true;
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (done || tries >= 10) {
      clearInterval(timer);
      return;
    }
    done = setWindowIcon(path);
    if (done) clearInterval(timer);
  }, 500);
  // 别让定时器把进程吊着（它是 unref'able 的：真正的保活另有其人）
  (timer as unknown as { unref?: () => void }).unref?.();
  return false;
}

export function createWindow(opts: CreateWindowOptions = {}): DesktopWindow | null {
  const Ctor = browserWindowCtor();
  if (!Ctor) return null;
  try {
    return new Ctor(opts) as DesktopWindow;
  } catch (e) {
    log.warn("desktop", `创建窗口失败：${(e as Error).message}`);
    return null;
  }
}

/**
 * 建一个"锚窗口"：1×1、屏幕外、不激活，创建后立刻隐藏。
 *
 * 【为什么需要它】实测（2026-09-24，deno 2.9.7 + WebView2）：
 *   - 窗口的 close 事件 cancelable=false —— preventDefault() 拦不住，窗口真会被销毁；
 *   - 只要"最后一个窗口"被销毁，运行时立刻退出，托盘图标随之消失（用户看到的就是"托盘坏了"）；
 *   - 但在 close 里临时补一个新窗口来不及；**启动时就留一个隐藏窗口**则有效：
 *     主窗口关掉后它还在，运行时就不退出（同款探针实测存活 24 秒以上仍在跑）。
 * 有了它，"点 X 不退出"才成立；托盘或「回到管家」再把真正的窗口建回来。
 */
export function createAnchorWindow(): DesktopWindow | null {
  const win = createWindow({
    title: `${"DSH Butler"}-anchor`,
    width: 1,
    height: 1,
    x: -32000,
    y: -32000,
    frameless: true,
    noActivate: true,
  });
  if (!win) return null;
  try {
    win.navigate("about:blank");
    win.hide?.();
  } catch { /* 忽略 */ }
  return win;
}

export function getMainWindow(): DesktopWindow | null {
  if (mainWindow && safe(() => mainWindow!.isClosed?.() ?? false, false)) mainWindow = null;
  return mainWindow;
}

export function mainWindowAvailable(): boolean {
  return getMainWindow() !== null;
}

/**
 * 把主窗口导航到某个地址（外壳切换的唯一入口）。
 *
 * 为什么所有切换都走这里：窗口只有一扇，谁都能 navigate 的话，
 * 迟早出现"部署完没换过去""托盘点了没反应"这类各写各的问题。
 */
export function navigateMain(
  url: string,
  opts: { title?: string; injectOverlay?: boolean } = {},
): boolean {
  const win = getMainWindow();
  if (!win) {
    log.warn("desktop", `当前不是桌面态，无法在窗口里打开：${url}`);
    return false;
  }
  try {
    win.navigate(url);
    rememberNavOrigin(url);
    if (opts.title && win.setTitle) {
      try {
        win.setTitle(opts.title);
      } catch { /* 标题失败不影响使用 */ }
    }
    try {
      win.show();
      win.focus?.();
    } catch { /* 某些平台不支持 */ }
    // 页面换了，注入过的悬浮条也随之消失 —— 这里跟着重新注入一次（两个界面都要）。
    if (opts.injectOverlay !== false) overlayInstaller?.();
    return true;
  } catch (e) {
    log.warn("desktop", `窗口导航失败：${(e as Error).message}`);
    return false;
  }
}

/**
 * 窗口最后被指到哪个源（origin）上 —— 「页面跑偏」的自愈判据。
 *
 * 【为什么需要】2026-09-28 用户实测：管家窗口停在 Edge 的「127.0.0.1 拒绝连接」错误页上，
 * 而管家与 DSH 两个服务都活着 —— 说明某次导航把窗口指到了没人监听的本地端口，
 * 之后没有任何东西把它拉回来（页面里那条悬浮条也随页面一起没了，用户只剩托盘一条路）。
 * 主程序每 30 秒拿页面里的 location.origin 和这里比一比，不一样就是跑偏了。
 */
let lastNavOrigin: string | null = null;
/** 上次导航的时间：页面加载中会出现短暂空白，判"卡死"要给这段宽限期留位置。 */
let lastNavAt = 0;

export function lastNavigatedOrigin(): string | null {
  return lastNavOrigin;
}

/** 距离上次导航过了多少毫秒（没导航过时返回一个很大的数）。 */
export function msSinceLastNavigation(): number {
  return lastNavAt === 0 ? Number.MAX_SAFE_INTEGER : Date.now() - lastNavAt;
}

/** 记下"这次把窗口指到了哪个源"（navigateMain 会自动记；直接 navigate 的地方要自己调）。 */
export function rememberNavOrigin(url: string): void {
  lastNavAt = Date.now();
  try {
    lastNavOrigin = new URL(url).origin;
  } catch {
    log.warn("desktop", `导航地址解析不了（自愈只能靠错误页标记判断）：${url}`);
  }
}

// ── 页面内悬浮条（把 Deno 侧的能力递到 DS H页面里） ──────────────────

let overlayInstaller: (() => void) | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 在窗口里求值，并把运行时那层信封拆掉。
 *
 * 【实测坑】deno desktop 的 executeJs 返回的不是裸值，而是 `{ ok, value }` 信封
 * （2026-09-24 用 /api/shell/probe 抓到：`{"ok":true,"value":"complete"}`）。
 * 直接拿它跟 true 比会永远不相等 —— 当初悬浮条注入超时就是这么来的。
 * 这里统一拆封：出错就抛，成功就返回 value。
 */
export async function evalJs(win: DesktopWindow, code: string): Promise<unknown> {
  if (!win.executeJs) throw new Error("当前窗口不支持 executeJs");
  const raw = await win.executeJs(code);
  if (raw && typeof raw === "object" && "ok" in (raw as Record<string, unknown>)) {
    const env = raw as { ok?: unknown; value?: unknown; error?: unknown };
    if (env.ok === false) {
      throw new Error(String(env.error ?? "页面脚本执行失败"));
    }
    return env.value;
  }
  return raw;
}

export interface InstallOverlayOptions {
  /** 要注入的脚本（幂等：脚本自己负责防重复注入）。 */
  script: string;
  /** 页面里用 bindings.<bindingName>(cmd, arg) 调过来的名字。 */
  bindingName: string;
  /** 收到页面调用时的处理函数。 */
  handle: (cmd: unknown, arg: unknown) => Promise<unknown> | unknown;
  /** 注入前探针用的 DOM id（已存在就不重复注入）。 */
  probeId: string;
  /**
   * 还要一起在场的 DOM id（默认只查 probeId）。
   *
   * 【为什么需要】悬浮条的样式表与宿主 div 是分两次 append 的（一个进 head、一个进 body）。
   * 页面侧重建 head 会只抹掉样式表，此时只查宿主 div 会永远判定「已存在」，
   * 于是页面里留一条没有样式的裸 div，再也补不回来（2026-10-02 用户实测）。
   * 探针改成「这几个 id 全部在，才算已经注入过」。
   */
  extraProbeIds?: readonly string[];
  /**
   * 只在满足条件的页面上注入（拿到的是当前 location.href）。
   * 现在两个界面都要悬浮条，所以没用到它；留着给"某些页面不该注入"的将来。
   */
  shouldInject?: (href: string) => boolean;
}

/**
 * 在主窗口页面里注入悬浮条，并在每次导航、以及后台保活定时器每 30 秒兜一次。
 *
 * 为什么不用 addEventListener("load")：官方事件表里没有 load，而且 SPA 内部跳转
 * 根本不会触发页面级 load。所以这里用"轮询 readyState + 探针 id"这种最笨也最稳的办法：
 * 页面就绪了、而且探针不齐，就注入一次。
 *
 * 【为什么必须有周期性兜底】页面整页重载（DSH 重启后 WebView 重新加载、用户手动刷新、
 * WebView2 崩溃恢复、被错误页自愈导航）会把注入进去的 DOM 一起清空，而管家这边毫无察觉。
 * 2026-10-02 用户实测右下角小图标经常就没了 —— 当初注释里写的「每 15 秒」其实从来没实现过：
 * 装完只跑一次，之后只有 navigateMain 才会再跑一次。
 * 现在由 main.ts 的后台保活定时器调 ensureOverlay() 兜住（见该函数注释）。
 */
export function installOverlay(opts: InstallOverlayOptions): boolean {
  const win = getMainWindow();
  if (!win?.bind || !win?.executeJs) {
    log.warn("desktop", "当前窗口不支持 bind/executeJs，跳过悬浮条注入");
    return false;
  }
  try {
    win.bind(opts.bindingName, (cmd: unknown, arg: unknown) => {
      // 页面那边的调用一律回 Promise；这里把同步异常也转成 {ok:false}
      try {
        return Promise.resolve(opts.handle(cmd, arg)).catch((e) => ({
          ok: false,
          error: (e as Error)?.message ?? String(e),
        }));
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    });
  } catch (e) {
    log.warn("desktop", `注册页面绑定失败（悬浮条不可用）：${(e as Error).message}`);
    return false;
  }

  let injecting = false;
  // 兜底定时器每 30 秒调一次，页面一直不就绪时每轮都会走到超时告警 ——
  // 不去重的话一晚上能刷几百条，把真正的告警淹了（同一条原因只报第一次，
  // 真的注入成功过一次之后再允许它重新报）。
  let timeoutWarned = false;
  const injectOnce = async () => {
    let lastRaw = "";
    for (let i = 0; i < 120; i++) {
      const w = getMainWindow();
      if (!w?.executeJs) return;
      try {
        // 判据取"文档不再是 loading 且 body 已存在"：
        // 实测（2026-09-24）用 readyState === 'complete' 会一直等不到 —— 对 DSH 这种
        // 长时间挂着长连接的 SPA，complete 可能迟迟不来，而我们只是要往 body 里塞个东西。
        const raw = await evalJs(w, "[document.readyState, !!document.body]");
        lastRaw = JSON.stringify(raw);
        const okDoc = Array.isArray(raw) && raw[0] !== "loading" && raw[1] === true;
        if (okDoc) {
          if (opts.shouldInject) {
            const href = String(await evalJs(w, "location.href"));
            if (!opts.shouldInject(href)) return;
          }
          // 探针 = 宿主 + 附属节点（样式表等）必须同时在，缺一样就当没注入过
          const probeIds = [opts.probeId, ...(opts.extraProbeIds ?? [])];
          const probeJs = JSON.stringify(probeIds) +
            ".every(function (id) { return !!document.getElementById(id); })";
          const existsRaw = await evalJs(w, probeJs);
          // 不同运行时可能把布尔包一层（字符串 / 对象），两种形状都认
          const exists = existsRaw === true || String(existsRaw) === "true";
          if (!exists) {
            await evalJs(w, opts.script);
            log.info("desktop", `已注入页面悬浮条（${opts.probeId}）`);
            timeoutWarned = false;
          }
          return;
        }
      } catch (e) {
        // 页面正在切换时 executeJs 会抛（目标已销毁），等下一轮即可
        lastRaw = `抛出：${(e as Error).message}`;
      }
      await sleep(500);
    }
    if (!timeoutWarned) {
      timeoutWarned = true;
      log.warn("desktop", `悬浮条注入超时（页面一直没就绪）—— 最后一次探测结果：${lastRaw}`);
    }
  };

  const inject = (): void => {
    if (injecting) return;
    injecting = true;
    void injectOnce().finally(() => {
      injecting = false;
    });
  };

  overlayInstaller = () => {
    inject();
  };
  overlayInstaller();
  return true;
}

/**
 * 幂等补注入 —— 页面整页重载后，那条悬浮条会随页面一起消失，这里是唯一的兜底。
 *
 * 由 main.ts 的后台保活定时器每 30 秒调一次（不另开定时器，少一个常驻句柄）。
 * 幂等由脚本自己保证：宿主与样式表都在就直接返回，缺哪样补哪样。
 */
export function ensureOverlay(): void {
  overlayInstaller?.();
}

/**
 * 「把窗口叫回来」的处理器（由 main.ts 注册）。
 *
 * 为什么要有这一层：主窗口可能已经**被销毁**（这个运行时拦不住 close），这时
 * 光 show() 是没用的，得重建一扇。重建逻辑在 main.ts（它才管着托盘、悬浮条、处理器），
 * 所以这里留一个钩子，接口层与托盘都通过它来"叫窗口"，不各自实现一遍。
 */
let showHandler: (() => boolean) | null = null;

export function setShowHandler(fn: () => boolean): void {
  showHandler = fn;
}

/** 请求把窗口叫回来（存在就显示、被关掉过就重建）。 */
export function requestShowWindow(): boolean {
  if (showHandler) return showHandler();
  showMainWindow();
  return true;
}

/** 让主窗口显示出来并抢焦点（托盘「回到管家」用）。 */
export function showMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  try {
    win.show();
    win.focus?.();
  } catch { /* 忽略 */ }
}

/**
 * 给主窗口挂一个"回管家"的快捷键。
 *
 * DSH 界面里没有我们的按钮，所以需要一条不依赖托盘的回程路（托盘图标会被折叠进
 * Windows 的隐藏区，不一定一眼看得到）。用 Ctrl+Shift+B，不占用 DSH 自己的快捷键。
 */
export function bindBackHotkey(goBack: () => void): void {
  const win = getMainWindow();
  if (!win?.addEventListener) return;
  try {
    win.addEventListener("keydown", (e) => {
      const k = e as { key?: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
      if (!k.ctrlKey || !k.shiftKey || k.altKey) return;
      if ((k.key ?? "").toLowerCase() !== "b") return;
      log.info("desktop", "快捷键 Ctrl+Shift+B：回到管家界面");
      goBack();
    });
  } catch (e) {
    log.warn("desktop", `绑定回程快捷键失败（不影响托盘回程）：${(e as Error).message}`);
  }
}

/** 执行一小段表达式并吞掉异常（桌面 API 的探测都要走它，绝不因为探测本身炸掉主流程）。 */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ── 托盘 ─────────────────────────────────────────────────────────────

/**
 * 托盘图标（32×32 PNG，内嵌 base64）。
 *
 * 为什么内嵌而不是读 icons/tray.png：编译产物的 cwd 是用户当前目录，
 * 相对路径读不到；而 deno compile 只会把源码图里静态可见的文件打进去，
 * 运行时拼路径读图标是"开发能跑、打包就白"的经典坑。
 */
const TRAY_ICON_PNG_BASE64 =
  "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";

export function trayIconBytes(): Uint8Array {
  const bin = atob(TRAY_ICON_PNG_BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 托盘 .ico（16/24/32/48 多尺寸，透明底）。
 *
 * 为什么还要 .ico：Windows 的 LoadImageW 不认 PNG，只认 ICO/BMP。
 * 同样内嵌，启动时原样落到管家数据目录再交给系统加载 —— 这样开发态与编译态都不依赖
 * 源码目录里有没有 icons 文件夹。
 */
const TRAY_ICON_ICO_BASE64 =
  "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";

/** 把内嵌的 .ico 落到磁盘并返回路径（失败返回 null，调用方会退回系统默认图标）。 */
export function ensureTrayIconFile(): string | null {
  try {
    const dir = butlerRoot();
    if (!isDir(dir)) Deno.mkdirSync(dir, { recursive: true });
    const file = p(dir, "tray.ico");
    const bin = atob(TRAY_ICON_ICO_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // 内容不一致就重写（换了图标能自动跟上），一致就不动盘
    let same = false;
    try {
      const old = Deno.readFileSync(file);
      same = old.length === bytes.length && old.every((b, i) => b === bytes[i]);
    } catch { /* 没有就写 */ }
    if (!same) Deno.writeFileSync(file, bytes);
    return file;
  } catch (e) {
    log.warn("desktop", "落地托盘图标失败：" + (e as Error).message);
    return null;
  }
}

export interface TrayHandle {
  trayId: number;
  ok: boolean;
  /** 托盘实现来源：win32 = 我们自己的 FFI 实现；deno = 运行时自带。 */
  source?: "win32" | "deno";
  setTooltip(t: string | null): void;
  destroy(): void;
}

export interface CreateTrayOptions {
  tooltip: string;
  menu: Array<TrayMenuItem | "separator">;
  onMenuClick(id: string): void;
  /** 左键单击（Windows 上它的语义是"打开主界面"）。 */
  onClick?(): void;
}

/**
 * 创建托盘图标。
 *
 * 失败一律降级：拿不到托盘不算错误（有些精简 Linux 桌面没有状态区），
 * 返回 ok=false，调用方据此决定"关窗即退出"还是"关窗留托盘"。
 */
/** 托盘图标文件候选（编译产物目录 / 源码目录），找不到就用系统默认图标。 */
function resolveTrayIconPath(): string | undefined {
  const candidates: string[] = [];
  // 首选：内嵌的托盘专用图标（透明底、无方砖，16px 下最清楚）
  const embedded = ensureTrayIconFile();
  if (embedded) candidates.push(embedded);
  // 备选：产物目录里 deno desktop 生成的应用图标（方砖版，缩到 16px 会糊一点）
  try {
    candidates.push(p(dirname(Deno.execPath()), "AppIcon.ico"));
  } catch { /* 取不到 exe 路径就算了 */ }
  candidates.push(p(Deno.cwd(), "icons", "tray.ico"));
  for (const c of candidates) {
    try {
      if (Deno.statSync(c).isFile) return c;
    } catch { /* 试下一个 */ }
  }
  return undefined;
}

export function createTray(o: CreateTrayOptions): TrayHandle {
  // 【Windows 用自己的实现】实测：deno desktop 的 Deno.Tray 在这个平台上
  // 只画图标、不派发任何点击/菜单事件（addEventListener 与 on* prop 都试过）。
  // 用户看到的就是"托盘图标没有用"。所以这里优先走 Win32 FFI 自绘实现。
  if (Deno.build.os === "windows") {
    const win32 = createWin32Tray({
      tooltip: o.tooltip,
      menu: o.menu.map((m) =>
        m === "separator" ? "separator" as const : { id: m.item.id, label: m.item.label }
      ),
      onSelect: (id) => o.onMenuClick(id),
      onLeftClick: () => o.onClick?.(),
      ...(resolveTrayIconPath() ? { iconPath: resolveTrayIconPath()! } : {}),
    });
    if (win32.ok) {
      // 把图标位置打一次日志：用户报"找不到图标"时，有它才能确定图标落在哪
      setTimeout(() => {
        const b = win32.getBounds();
        log.info(
          "tray",
          b
            ? `托盘图标位置：${b.x},${b.y}（${b.width}×${b.height}）—— 若任务栏没看到，点任务栏的 ^ 在隐藏区里找`
            : "取不到托盘图标位置（图标可能收在隐藏区）",
        );
      }, 1500);
      return {
        trayId: 1,
        ok: true,
        source: "win32",
        setTooltip: (t) => win32.setTooltip(t ?? ""),
        destroy: () => win32.destroy(),
      };
    }
    log.warn("desktop", "Win32 托盘不可用，回退到 Deno.Tray（该平台可能不派发点击事件）");
  }

  const Ctor = trayCtor();
  const dead: TrayHandle = { trayId: 0, ok: false, setTooltip: () => {}, destroy: () => {} };
  if (!Ctor) {
    log.info("desktop", "当前环境没有托盘能力（非桌面态或运行时未提供 Deno.Tray）");
    return dead;
  }
  try {
    const tray = new Ctor();
    // 文档：后端建不出图标时 trayId 为 0，后续调用静默无效 —— 必须显式判它
    if (!tray.trayId) {
      log.warn("desktop", "托盘后端没有创建出图标（trayId=0），跳过托盘常驻");
      return dead;
    }
    try {
      tray.setIcon(trayIconBytes());
    } catch (e) {
      log.warn("desktop", `设置托盘图标失败（不影响托盘其它功能）：${(e as Error).message}`);
    }
    try {
      tray.setTooltip(o.tooltip);
    } catch { /* 可选能力 */ }
    try {
      tray.setMenu(o.menu);
    } catch (e) {
      log.warn("desktop", `设置托盘菜单失败：${(e as Error).message}`);
    }
    // 【两条路都试】官方文档写的是 addEventListener，但实测（2026-09-24）这个运行时
    // 的 Windows 托盘后端对 addEventListener 完全没反应；原型上还有 on* 属性赋值这条路，
    // 所以两种都挂上，谁先通就用谁 —— 事件日志会告诉我们到底是哪条。
    tray.addEventListener("click", () => log.info("desktop", "托盘事件[listen]：左键单击"));
    tray.addEventListener("dblclick", () => log.info("desktop", "托盘事件[listen]：左键双击"));
    tray.addEventListener("menuclick", (e) => {
      const id = e?.detail?.id;
      log.info("desktop", `托盘事件：菜单项 ${String(id)}`);
      if (typeof id === "string") {
        try {
          o.onMenuClick(id);
        } catch (err) {
          log.warn("desktop", `托盘菜单项 ${id} 处理失败：${(err as Error).message}`);
        }
      }
    });
    // on* 属性赋值（与上面的 addEventListener 并存，哪条通都行）
    const trayProps = tray as unknown as Record<string, unknown>;
    const safeCall = (fn: () => void) => {
      try {
        fn();
      } catch { /* 忽略 */ }
    };
    if (typeof trayProps.onclick === "function") {
      (trayProps.onclick as (cb: () => void) => void)(() => {
        log.info("desktop", "托盘事件[prop]：左键单击");
        if (o.onClick) safeCall(o.onClick);
      });
    }
    if (typeof trayProps.ondblclick === "function") {
      (trayProps.ondblclick as (cb: () => void) => void)(() =>
        log.info("desktop", "托盘事件[prop]：左键双击")
      );
    }
    if (typeof trayProps.onmenuclick === "function") {
      (trayProps.onmenuclick as (cb: (e: { detail?: { id?: string } }) => void) => void)((e) => {
        const id = e?.detail?.id;
        log.info("desktop", `托盘事件[prop]：菜单项 ${String(id)}`);
        if (typeof id === "string") safeCall(() => o.onMenuClick(id));
      });
    }
    if (o.onClick) {
      tray.addEventListener("click", () => {
        try {
          o.onClick!();
        } catch { /* 忽略 */ }
      });
    }
    log.info("desktop", `托盘已就绪（trayId=${tray.trayId}，菜单 ${o.menu.length} 项）`);
    // 诊断：把图标在屏幕上的位置打出来（拿不到就是 null，说明这个平台不报位置）。
    // 有它才能自动化验证"点托盘到底有没有反应"。
    for (const delay of [1000, 3000, 6000]) {
      setTimeout(() => {
        try {
          const b = tray.getBounds();
          log.info("desktop", `托盘图标位置（${delay}ms）：${b ? JSON.stringify(b) : "null"}`);
        } catch (e) {
          log.warn("desktop", `取托盘位置失败：${(e as Error).message}`);
        }
      }, delay);
    }
    return {
      trayId: tray.trayId,
      ok: true,
      setTooltip: (t) => {
        try {
          tray.setTooltip(t);
        } catch { /* 忽略 */ }
      },
      destroy: () => {
        try {
          tray.destroy();
        } catch { /* 忽略 */ }
      },
    };
  } catch (e) {
    log.warn("desktop", `创建托盘失败：${(e as Error).message}`);
    return dead;
  }
}
