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

import { hasDesktopRuntime } from "../util/runtime-kind.ts";
import { log } from "../util/log.ts";

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
  setTitle?(t: string): void;
  addEventListener?(type: string, cb: (e: unknown) => void): void;
}

let mainWindow: DesktopWindow | null = null;

/** 登记主窗口（由 main.ts 在接管隐式窗口后调用）。 */
export function setMainWindow(win: DesktopWindow | null): void {
  mainWindow = win;
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
export function navigateMain(url: string, opts: { title?: string } = {}): boolean {
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
    return true;
  } catch (e) {
    log.warn("desktop", `窗口导航失败：${(e as Error).message}`);
    return false;
  }
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

export interface TrayHandle {
  trayId: number;
  ok: boolean;
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
export function createTray(o: CreateTrayOptions): TrayHandle {
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
    tray.addEventListener("menuclick", (e) => {
      const id = e?.detail?.id;
      if (typeof id === "string") {
        try {
          o.onMenuClick(id);
        } catch (err) {
          log.warn("desktop", `托盘菜单项 ${id} 处理失败：${(err as Error).message}`);
        }
      }
    });
    if (o.onClick) {
      tray.addEventListener("click", () => {
        try {
          o.onClick!();
        } catch { /* 忽略 */ }
      });
    }
    log.info("desktop", `托盘已就绪（trayId=${tray.trayId}，菜单 ${o.menu.length} 项）`);
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
