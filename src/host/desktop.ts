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
    if (opts.title && win.setTitle) {
      try {
        win.setTitle(opts.title);
      } catch { /* 标题失败不影响使用 */ }
    }
    try {
      win.show();
      win.focus?.();
    } catch { /* 某些平台不支持 */ }
    // 页面换了，注入过的悬浮条也随之消失 —— 这里跟着重新注入一次。
    // 默认注入；切回管家自己的界面时调用方会显式关掉（我们自己页面不需要它）。
    if (opts.injectOverlay !== false) overlayInstaller?.();
    return true;
  } catch (e) {
    log.warn("desktop", `窗口导航失败：${(e as Error).message}`);
    return false;
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
   * 只在满足条件的页面上注入（拿到的是当前 location.href）。
   * 典型用法：管家自己的界面不需要悬浮条，只有 DSH 页面才需要。
   */
  shouldInject?: (href: string) => boolean;
}

/**
 * 在主窗口页面里注入悬浮条，并每 15 秒/每次导航后保证它在。
 *
 * 为什么不用 addEventListener("load")：官方事件表里没有 load，而且 SPA 内部跳转
 * 根本不会触发页面级 load。所以这里用"轮询 readyState + 探针 id"这种最笨也最稳的办法：
 * 页面就绪了、而且还没注入过，就注入一次。
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

  const inject = async () => {
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
          const existsRaw = await evalJs(
            w,
            `!!document.getElementById(${JSON.stringify(opts.probeId)})`,
          );
          // 不同运行时可能把布尔包一层（字符串 / 对象），两种形状都认
          const exists = existsRaw === true || String(existsRaw) === "true";
          if (!exists) {
            await evalJs(w, opts.script);
            log.info("desktop", `已注入页面悬浮条（${opts.probeId}）`);
          }
          return;
        }
      } catch (e) {
        // 页面正在切换时 executeJs 会抛（目标已销毁），等下一轮即可
        lastRaw = `抛出：${(e as Error).message}`;
      }
      await sleep(500);
    }
    log.warn("desktop", `悬浮条注入超时（页面一直没就绪）—— 最后一次探测结果：${lastRaw}`);
  };

  overlayInstaller = () => {
    void inject();
  };
  overlayInstaller();
  return true;
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
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAD70lEQVR4nO1WTWhcVRT+zrn3TebND01NW7GkxpJpxehGY39czUIq2P1k6U8SQ124yFIUpqELV4GCuimmBbUIxo2K6EIxcafUhYIRQ6YtFgtB2qbJ/L2fe4/cN5NSzcyQCt1oPnjwuPPOPd8953zfHWAHO9jB/x30b4LkH3GULN1HCEBSgpJiUff8vVzUUgZvaz/Z5uGlw4YyPeivvfrwbnHP9KDfjdB21qlX8o9LUGPzMO47mTp0Mrb2ZGxxzIg8SKAksZDUWWiVCMtK0Q+e5W9pbvnnO+RnIK5FLjG19oKMP5qvUpjJz11Z7UrABdMM7O2XHzmW0d5ZTTju6FoLGCuw7e9ceTQDxAQQoRFaqxnfWcjZ9HuVT903l6ZGvafP/RjdenGoP+fpaWKeDGP7h3+gcrwjgU22jYnCCc34TBOlN0Jr+lgksuCkfdSunrQGkAhWXGOJdNZzjIAolo+8Jk7RxZX16njhuT7Gu1pTwUXUAvtrdqjyBHWd8KnDA43YLHlMexuxxB6Lvh4qPNDHSNkIvWZIAAMRyWW1rjfMlwR87SmehQgasa3m0zrXCMz5zIXKxNaJLReV61kjNi/4fWpvPbJRxmO9fKuJsasP4RM+DBUHEOo+7AQoV4lq3ZgU0/O+5tnIWJcfeV/ngsjeJsZb7rBbZbW02NK04FkYEWJiF7w/7+PItSvI/s5QB3yEsXVl7wlHpBmLJRI3iM0YUlHGLhmxs9nzl1eSOevUAleB+vjw977io7XYGgGUJiCtCWKBmtmuiFvt0ARSTJeZMaPPrXyYrBehaRHx1jq2PU0EwabFuWSOxXooqMb3kFxgU0zKCNhaFBTog+iVwqXaSwePuOSuAlsIzI9tGo80gDtqS+CGo622hIQj182DRSTOesSxSEWAZiQi1cgaTTSqNX8TjBeedDLfQqA0UkwOqIAvoIkhEktbaptwM+G8QDMlz98PnRTL5DJaN4wsplimch6nlZOtiGyEJvCY85HYd5y1d5ZhGYSbBa9elc8zvjoRBAahgWUSG1vBL9duJM3Jpj0M5HwZyPmtOBGVcR6QkJT315t4bc/FlfX6xPDrmumMp0iZWKA8Rr1pVjOkD3U2ovYgSmkkFe8K3hBg0mPenzTHCn67fhPVZgRjW0roz/RhaM8uCKs6ExZI5G1vrvLV3Y5amxweTYFOxYKnUgproZEz/lxlobsVt0m4d2eh/Sn1TCB8VKwctMC+jXqYrgWhXWsEN9ZrAXLpVOaxwd1v5i5c/anXPXBPkC63Ws+YMrjjTXjXevLevmVpu0RQAmOkSAsLi/hzH6Q0DzkN4PFSa4/SCASnIUT3+c/JDnbwn8Nft5fusQvscO8AAAAASUVORK5CYII=";

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
