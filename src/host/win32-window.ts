/**
 * 给窗口换图标（Win32 FFI）。
 *
 * 【为什么需要】deno desktop 打包时会按 deno.json 的 icons 配置生成 AppIcon.ico，
 * 但**不会把它嵌进 exe**（实测：ExtractAssociatedIcon 取出来的是系统默认图标）——
 * 于是标题栏和任务栏显示的是个白板图标，品牌标志根本没上。
 * 这里在运行时用 WM_SETICON 自己把图标塞进去：小图标给标题栏，大图标给任务栏与 Alt-Tab。
 *
 * 只在本平台有效；其它平台返回 false，调用方忽略即可。
 */

import { log } from "../util/log.ts";

const IS_WINDOWS = Deno.build.os === "windows";

const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const LR_DEFAULTSIZE = 0x0040;
const GW_OWNER = 4;

/** UTF-16LE 宽字符串（带结尾 0）。 */
function wide(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return buf;
}

/**
 * 把 icoPath 里的图标设成窗口图标（小图标给标题栏，大图标给任务栏 / Alt-Tab）。
 * 成功返回 true；任何一步失败都返回 false 并记一条日志，绝不影响主流程。
 */
export function setWindowIcon(icoPath: string | undefined): boolean {
  if (!IS_WINDOWS || !icoPath) return false;
  try {
    if (!Deno.statSync(icoPath).isFile) return false;
  } catch {
    return false;
  }
  try {
    const sys32 = "C:\\Windows\\System32\\";
    const user32 = Deno.dlopen(sys32 + "user32.dll", {
      EnumWindows: { parameters: ["pointer", "i64"], result: "i32" },
      GetWindowThreadProcessId: { parameters: ["pointer", "pointer"], result: "u32" },
      GetWindowTextLengthW: { parameters: ["pointer"], result: "i32" },
      IsWindowVisible: { parameters: ["pointer"], result: "i32" },
      GetWindow: { parameters: ["pointer", "u32"], result: "pointer" },
      GetWindowRect: { parameters: ["pointer", "pointer"], result: "i32" },
      LoadImageW: {
        parameters: ["pointer", "pointer", "u32", "i32", "i32", "u32"],
        result: "pointer",
      },
      SendMessageW: { parameters: ["pointer", "u32", "u64", "i64"], result: "i64" },
    });

    // 找自己的主窗口：本进程 + 有标题 + 可见 + 无属主（挑面积最大的那个）。
    // 不按标题找 —— 标题里带标语，将来还会变。
    const pidBuf = new Uint32Array(1);
    const rect = new Int32Array(4);
    let best = 0n;
    let bestArea = 0;
    const cb = new Deno.UnsafeCallback(
      { parameters: ["pointer", "i64"], result: "i32" },
      (hwnd: Deno.PointerValue) => {
        user32.symbols.GetWindowThreadProcessId(hwnd, Deno.UnsafePointer.of(pidBuf));
        if (pidBuf[0] !== Deno.pid) return 1;
        if (user32.symbols.GetWindowTextLengthW(hwnd) <= 0) return 1;
        if (!user32.symbols.IsWindowVisible(hwnd)) return 1;
        if (user32.symbols.GetWindow(hwnd, GW_OWNER)) return 1;
        user32.symbols.GetWindowRect(hwnd, Deno.UnsafePointer.of(rect));
        const area = (rect[2]! - rect[0]!) * (rect[3]! - rect[1]!);
        if (area > bestArea) {
          bestArea = area;
          best = BigInt(Deno.UnsafePointer.value(hwnd));
        }
        return 1;
      },
    );
    user32.symbols.EnumWindows(cb.pointer, 0n);
    cb.close();
    if (best === 0n) {
      log.warn("window", "没找到自己的窗口，跳过窗口图标设置");
      return false;
    }
    const hwnd = Deno.UnsafePointer.create(best);
    const pathPtr = Deno.UnsafePointer.of(wide(icoPath));
    const small = user32.symbols.LoadImageW(null, pathPtr, IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
    let big = user32.symbols.LoadImageW(null, pathPtr, IMAGE_ICON, 32, 32, LR_LOADFROMFILE);
    if (!big) {
      big = user32.symbols.LoadImageW(
        null,
        pathPtr,
        IMAGE_ICON,
        0,
        0,
        LR_LOADFROMFILE | LR_DEFAULTSIZE,
      );
    }
    if (!small && !big) {
      log.warn("window", "图标文件加载失败，跳过窗口图标设置");
      return false;
    }
    if (big) {
      user32.symbols.SendMessageW(
        hwnd,
        WM_SETICON,
        BigInt(ICON_BIG),
        BigInt(Deno.UnsafePointer.value(big)),
      );
    }
    if (small) {
      user32.symbols.SendMessageW(
        hwnd,
        WM_SETICON,
        BigInt(ICON_SMALL),
        BigInt(Deno.UnsafePointer.value(small)),
      );
    }
    log.info("window", "窗口图标已设置（标题栏 + 任务栏）");
    return true;
  } catch (e) {
    log.warn("window", `设置窗口图标失败：${(e as Error).message}`);
    return false;
  }
}
