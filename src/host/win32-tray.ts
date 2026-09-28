/**
 * 自己实现的 Windows 托盘图标（Win32 FFI）。
 *
 * 【为什么不用 Deno.Tray】实测（2026-09-24，deno 2.9.7 + Windows 11）：
 * deno desktop 的 Deno.Tray 只把图标画出来，**点击/菜单事件一个都不派发** ——
 * addEventListener 与 on* 属性两条路都试过，左右键、双击全无反应；
 * 用户看到的就是"这个托盘图标没有用"。而 Win32 的 Shell_NotifyIcon 是可靠的，
 * 用 FFI 直连就能拿到回调消息（同款探针实测：左键、右键、菜单项全部收到）。
 *
 * 【实现要点】
 *   - 建一个隐藏窗口收 Shell_NotifyIcon 的回调消息（WM_APP+1）；
 *   - 用 PeekMessage 轮询（50ms）而不是 GetMessage 阻塞循环 —— 主线程不能被卡住；
 *   - 右键弹 TrackPopupMenu：它是模态的，会短暂阻塞 Deno 线程（WebView2 窗口在
 *     另一个进程里，照常渲染），菜单关掉就恢复，实测心跳照常；
 *   - 图标优先从磁盘上的 .ico 加载，失败就用系统默认图标（绝不因为图标缺失而没托盘）。
 *
 * 【Explorer 重启 = 所有托盘图标消失】这是 Win32 托盘的经典坑：Explorer 崩溃或被重启后，
 * 通知区域会被整个重建，**所有应用之前挂上去的图标都不再存在**，而进程还活着 ——
 * 用户看到的就是"用着用着托盘图标就丢了"。系统为此提供了标准补救：向所有顶层窗口广播一条
 * 注册消息「TaskbarCreated」，应用收到就重新 Shell_NotifyIcon(NIM_ADD)。
 * 本机实测（2026-09-28）：这台机器的 Explorer 一天崩了十几次（7:40 那波每 2 秒一次），
 * 用户反复找不到托盘图标就反复双击 exe 重新启动 —— 所以这里既处理那条消息，
 * 又留了一个「每 20 秒自检一次」的兜底（消息可能收不到：重启过快、消息窗口刚建好）。
 *
 * 只在本平台可用；其它平台返回 ok=false，由调用方回退到 Deno.Tray。
 */

import { log } from "../util/log.ts";

const IS_WINDOWS = Deno.build.os === "windows";

export interface Win32TrayMenuItem {
  id: string;
  label: string;
}

export interface Win32TrayOptions {
  tooltip: string;
  /** 菜单项；字符串 "separator" 表示分隔线。 */
  menu: Array<Win32TrayMenuItem | "separator">;
  onSelect(id: string): void;
  onLeftClick(): void;
  /** 可选的 .ico 路径（找不到就用系统默认图标）。 */
  iconPath?: string;
}

export interface Win32TrayHandle {
  ok: boolean;
  /** 图标在屏幕上的位置（拿不到为 null）—— 诊断用。 */
  getBounds(): { x: number; y: number; width: number; height: number } | null;
  setTooltip(text: string): void;
  destroy(): void;
}

const DEAD: Win32TrayHandle = {
  ok: false,
  getBounds: () => null,
  setTooltip: () => {},
  destroy: () => {},
};

// ── Win32 常量 ──────────────────────────────────────────────────────

const WM_APP = 0x8000;
const WM_TRAY_CALLBACK = WM_APP + 1;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONUP = 0x0205;
const WM_DESTROY = 0x0002;
const WM_COMMAND = 0x0111;
const WM_NULL = 0x0000;

const NIM_ADD = 0;
const NIM_MODIFY = 1;
const NIM_DELETE = 2;
const NIF_MESSAGE = 0x01;
const NIF_ICON = 0x02;
const NIF_TIP = 0x04;
const NIF_GUID = 0x20;

const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const LR_DEFAULTSIZE = 0x0040;
const IDI_APPLICATION = 32512;

const MF_STRING = 0x0000;
const MF_SEPARATOR = 0x0800;
const TPM_RIGHTBUTTON = 0x0002;
const TPM_RETURNCMD = 0x0100;
const PM_REMOVE = 0x0001;

/** 宽字符串（UTF-16LE，带结尾 0）。 */
function wide(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return buf;
}

function ptrValue(p: Deno.PointerValue): bigint {
  return p === null ? 0n : BigInt(Deno.UnsafePointer.value(p));
}

/** 创建托盘。失败返回 ok=false（调用方回退或降级，绝不抛）。 */
export function createWin32Tray(opts: Win32TrayOptions): Win32TrayHandle {
  if (!IS_WINDOWS) return DEAD;
  try {
    return buildTray(opts);
  } catch (e) {
    log.warn("tray", `Win32 托盘创建失败：${(e as Error).message}`);
    return DEAD;
  }
}

function buildTray(opts: Win32TrayOptions): Win32TrayHandle {
  const sys32 = "C:\\Windows\\System32\\";
  const user32 = Deno.dlopen(sys32 + "user32.dll", {
    RegisterClassExW: { parameters: ["pointer"], result: "u16" },
    UnregisterClassW: { parameters: ["pointer", "pointer"], result: "i32" },
    CreateWindowExW: {
      parameters: [
        "u32",
        "pointer",
        "pointer",
        "u32",
        "i32",
        "i32",
        "i32",
        "i32",
        "pointer",
        "pointer",
        "pointer",
        "pointer",
      ],
      result: "pointer",
    },
    DefWindowProcW: { parameters: ["pointer", "u32", "u64", "i64"], result: "i64" },
    DestroyWindow: { parameters: ["pointer"], result: "i32" },
    PeekMessageW: { parameters: ["pointer", "pointer", "u32", "u32", "u32"], result: "i32" },
    TranslateMessage: { parameters: ["pointer"], result: "i32" },
    DispatchMessageW: { parameters: ["pointer"], result: "i64" },
    CreatePopupMenu: { parameters: [], result: "pointer" },
    AppendMenuW: { parameters: ["pointer", "u32", "u64", "pointer"], result: "i32" },
    TrackPopupMenu: {
      parameters: ["pointer", "u32", "i32", "i32", "i32", "pointer", "pointer"],
      result: "i32",
    },
    DestroyMenu: { parameters: ["pointer"], result: "i32" },
    SetForegroundWindow: { parameters: ["pointer"], result: "i32" },
    PostMessageW: { parameters: ["pointer", "u32", "u64", "i64"], result: "i32" },
    GetCursorPos: { parameters: ["pointer"], result: "i32" },
    LoadImageW: {
      parameters: ["pointer", "pointer", "u32", "i32", "i32", "u32"],
      result: "pointer",
    },
    LoadIconW: { parameters: ["pointer", "pointer"], result: "pointer" },
    RegisterWindowMessageW: { parameters: ["pointer"], result: "u32" },
  });
  // GetModuleHandleW 在 kernel32 里（不属 user32）—— 放错库会报"找不到指定的程序"
  const kernel32 = Deno.dlopen(sys32 + "kernel32.dll", {
    GetModuleHandleW: { parameters: ["pointer"], result: "pointer" },
  });
  const shell32 = Deno.dlopen(sys32 + "shell32.dll", {
    Shell_NotifyIconW: { parameters: ["u32", "pointer"], result: "i32" },
    Shell_NotifyIconGetRect: { parameters: ["pointer", "pointer"], result: "i32" },
  });

  const hInstance = kernel32.symbols.GetModuleHandleW(null);

  // Explorer 重启后通知区域重建时，系统会向所有顶层窗口广播这条注册消息。
  // 必须在建窗口之前注册（消息号是进程内全局的，早注册早安心）。
  const taskbarCreatedMsg = user32.symbols.RegisterWindowMessageW(
    Deno.UnsafePointer.of(wide("TaskbarCreated")),
  );

  // 菜单项 id → 命令号（1..n）
  const commands = new Map<number, string>();
  let nextCmd = 1;
  const menuPlan: Array<{ cmd: number; label: string } | "separator"> = opts.menu.map((m) => {
    if (m === "separator") return "separator";
    const cmd = nextCmd++;
    commands.set(cmd, m.id);
    return { cmd, label: m.label };
  });

  const showMenu = (hwnd: Deno.PointerValue) => {
    const menu = user32.symbols.CreatePopupMenu();
    if (!menu) return;
    for (const item of menuPlan) {
      if (item === "separator") {
        user32.symbols.AppendMenuW(menu, MF_SEPARATOR, 0n, null);
      } else {
        user32.symbols.AppendMenuW(
          menu,
          MF_STRING,
          BigInt(item.cmd),
          Deno.UnsafePointer.of(wide(item.label)),
        );
      }
    }
    const pt = new Int32Array(2);
    user32.symbols.GetCursorPos(Deno.UnsafePointer.of(pt));
    // 经典要求：弹菜单前把我们的窗口设为前台，弹完补一条空消息，否则菜单不会自动消失
    user32.symbols.SetForegroundWindow(hwnd);
    const cmd = user32.symbols.TrackPopupMenu(
      menu,
      TPM_RIGHTBUTTON | TPM_RETURNCMD,
      pt[0]!,
      pt[1]!,
      0,
      hwnd,
      null,
    );
    user32.symbols.DestroyMenu(menu);
    user32.symbols.PostMessageW(hwnd, WM_NULL, 0n, 0n);
    if (cmd > 0) {
      const id = commands.get(cmd);
      if (id) {
        try {
          opts.onSelect(id);
        } catch (e) {
          log.warn("tray", `菜单项 ${id} 处理失败：${(e as Error).message}`);
        }
      }
    }
  };

  // nid（图标描述结构）要到后面才建好，这里先占个位；窗口过程收到消息时它早已就绪
  let ensureIcon: (why: string) => void = () => { /* 建好 nid 后赋真身 */ };

  const wndProc = new Deno.UnsafeCallback(
    { parameters: ["pointer", "u32", "u64", "i64"], result: "i64" },
    (hwnd: Deno.PointerValue, msg: number, wParam: bigint, lParam: bigint) => {
      // Explorer 重启：通知区域是全新的，得自己把图标挂回去（这就是"图标用着用着丢了"的根因）
      if (taskbarCreatedMsg !== 0 && msg === taskbarCreatedMsg) {
        ensureIcon("Explorer 重启");
        return 0n;
      }
      if (msg === WM_TRAY_CALLBACK) {
        const evt = Number(lParam) & 0xffff;
        if (evt === WM_LBUTTONUP) {
          try {
            opts.onLeftClick();
          } catch (e) {
            log.warn("tray", `左键处理失败：${(e as Error).message}`);
          }
        } else if (evt === WM_RBUTTONUP) {
          showMenu(hwnd);
        }
        // 其余（鼠标移动等）直接忽略，别刷日志
        return 0n;
      }
      if (msg === WM_COMMAND) {
        const id = commands.get(Number(wParam & 0xffffn));
        if (id) {
          try {
            opts.onSelect(id);
          } catch (e) {
            log.warn("tray", `菜单项 ${id} 处理失败：${(e as Error).message}`);
          }
        }
        return 0n;
      }
      if (msg === WM_DESTROY) return 0n;
      return user32.symbols.DefWindowProcW(hwnd, msg, wParam, lParam);
    },
  );

  const className = wide(`DshButlerTray_${Date.now()}`);
  const wndClass = new Uint8Array(80);
  {
    const dv = new DataView(wndClass.buffer);
    dv.setUint32(0, 80, true);
    dv.setBigUint64(8, ptrValue(wndProc.pointer), true);
    dv.setBigUint64(24, ptrValue(hInstance), true);
    dv.setBigUint64(64, ptrValue(Deno.UnsafePointer.of(className)), true);
  }
  if (!user32.symbols.RegisterClassExW(Deno.UnsafePointer.of(wndClass))) {
    log.warn("tray", "RegisterClassExW 失败，Win32 托盘不可用");
    return DEAD;
  }

  const hwnd = user32.symbols.CreateWindowExW(
    0,
    Deno.UnsafePointer.of(className),
    Deno.UnsafePointer.of(wide("dsh-butler-tray")),
    0,
    0,
    0,
    0,
    0,
    null,
    null,
    hInstance,
    null,
  );
  if (!hwnd) {
    log.warn("tray", "CreateWindowExW 失败，Win32 托盘不可用");
    return DEAD;
  }

  // 图标：优先磁盘上的 .ico，失败退系统默认图标
  let hIcon: Deno.PointerValue = null;
  if (opts.iconPath) {
    try {
      Deno.statSync(opts.iconPath);
      hIcon = user32.symbols.LoadImageW(
        null,
        Deno.UnsafePointer.of(wide(opts.iconPath)),
        IMAGE_ICON,
        0,
        0,
        LR_LOADFROMFILE | LR_DEFAULTSIZE,
      );
    } catch { /* 用默认图标 */ }
  }
  if (!hIcon) {
    hIcon = user32.symbols.LoadIconW(null, Deno.UnsafePointer.create(BigInt(IDI_APPLICATION)));
  }

  // NOTIFYICONDATAW（v1 尺寸：cbSize=168，szTip 64 个宽字符）
  const nid = new Uint8Array(168);
  {
    const dv = new DataView(nid.buffer);
    dv.setUint32(0, 168, true);
    dv.setBigUint64(8, ptrValue(hwnd), true);
    dv.setUint32(16, 1, true); // uID
    dv.setUint32(20, NIF_MESSAGE | NIF_ICON | NIF_TIP, true);
    dv.setUint32(24, WM_TRAY_CALLBACK, true);
    dv.setBigUint64(32, ptrValue(hIcon), true);
    const tip = wide(opts.tooltip.slice(0, 63));
    for (let i = 0; i < 128 && i < tip.length; i++) nid[40 + i] = tip[i]!;
  }
  /** 当前图标在屏幕上的位置（拿不到 = 没有图标，或它在隐藏区里）。 */
  const boundsOf = (): { x: number; y: number; width: number; height: number } | null => {
    const id = new Uint8Array(40);
    const idv = new DataView(id.buffer);
    idv.setUint32(0, 40, true);
    idv.setBigUint64(8, ptrValue(hwnd), true);
    idv.setUint32(16, 1, true);
    const rect = new Int32Array(4);
    const hr = shell32.symbols.Shell_NotifyIconGetRect(
      Deno.UnsafePointer.of(id),
      Deno.UnsafePointer.of(rect),
    );
    if (hr !== 0) return null;
    return {
      x: rect[0]!,
      y: rect[1]!,
      width: rect[2]! - rect[0]!,
      height: rect[3]! - rect[1]!,
    };
  };

  /** 把图标（连同提示）挂上去；启动时用它，Explorer 重启后补挂也用它。 */
  const addIcon = (why: string): boolean => {
    const dv = new DataView(nid.buffer);
    dv.setUint32(20, NIF_MESSAGE | NIF_ICON | NIF_TIP, true);
    const ok = shell32.symbols.Shell_NotifyIconW(NIM_ADD, Deno.UnsafePointer.of(nid)) !== 0;
    if (ok) {
      // 位置只是"顺带看一眼"：刚挂上时系统可能还没排好版，取不到就不写，免得误报
      const b = boundsOf();
      log.info(
        "tray",
        `托盘图标已挂上（${why}）` + (b ? ` · 位置 ${b.x},${b.y}（${b.width}×${b.height}）` : ""),
      );
    } else {
      log.warn("tray", `托盘图标挂不上（${why}）`);
    }
    return ok;
  };

  /**
   * 自愈：先问一句"图标还在不在"（NIM_MODIFY 失败 = 被系统清掉了），不在就重新挂。
   *
   * 主路是 TaskbarCreated 消息，这里是兜底：消息可能收不到（Explorer 重启过快、
   * 消息窗口刚建好还没进消息循环），而"图标没了"这件事用户在托盘上是看得见的。
   */
  ensureIcon = (why: string) => {
    try {
      const dv = new DataView(nid.buffer);
      dv.setUint32(20, NIF_MESSAGE | NIF_ICON | NIF_TIP, true);
      if (shell32.symbols.Shell_NotifyIconW(NIM_MODIFY, Deno.UnsafePointer.of(nid)) !== 0) return;
      addIcon(why);
    } catch (e) {
      log.warn("tray", `托盘自检失败：${(e as Error).message}`);
    }
  };

  if (!addIcon("启动")) {
    user32.symbols.DestroyWindow(hwnd);
    return DEAD;
  }

  // 定时自检：窗口收进托盘时主程序的保活循环会跳过刷新提示（见 main.ts），所以这里自己盯着
  const selfCheck = setInterval(() => ensureIcon("定时自检"), 20_000);

  // 消息泵：50ms 轮询，绝不阻塞主线程
  const msgBuf = new Uint8Array(64);
  const pump = setInterval(() => {
    try {
      while (
        user32.symbols.PeekMessageW(Deno.UnsafePointer.of(msgBuf), null, 0, 0, PM_REMOVE) > 0
      ) {
        user32.symbols.TranslateMessage(Deno.UnsafePointer.of(msgBuf));
        user32.symbols.DispatchMessageW(Deno.UnsafePointer.of(msgBuf));
      }
    } catch (e) {
      log.warn("tray", `消息泵异常：${(e as Error).message}`);
    }
  }, 50);

  log.info("tray", `Win32 托盘已就绪（自绘实现，菜单 ${opts.menu.length} 项）`);

  return {
    ok: true,
    setTooltip: (text: string) => {
      try {
        const tip = wide(text.slice(0, 63));
        for (let i = 0; i < 128; i++) nid[40 + i] = i < tip.length ? tip[i]! : 0;
        const dv = new DataView(nid.buffer);
        dv.setUint32(20, NIF_TIP, true); // 只改提示时标明只动 TIP，避免重复设置图标
        shell32.symbols.Shell_NotifyIconW(NIM_MODIFY, Deno.UnsafePointer.of(nid));
        dv.setUint32(20, NIF_MESSAGE | NIF_ICON | NIF_TIP, true); // 复位，后续 modify 语义一致
      } catch { /* 改提示失败不影响托盘 */ }
    },
    getBounds: boundsOf,
    destroy: () => {
      clearInterval(pump);
      clearInterval(selfCheck);
      try {
        shell32.symbols.Shell_NotifyIconW(NIM_DELETE, Deno.UnsafePointer.of(nid));
        user32.symbols.DestroyWindow(hwnd);
        user32.symbols.UnregisterClassW(Deno.UnsafePointer.of(className), hInstance);
      } catch { /* 忽略 */ }
    },
  };
}
