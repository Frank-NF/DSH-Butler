/**
 * 把「已在运行的那个管家进程」的主窗口拿到前台。
 *
 * 用途：单实例保护（见 host/single-instance.ts）—— 用户重复启动管家时，
 * 与其起第二个（会白屏、会抢窗口），不如把已经开着的那个叫到前面来。
 *
 * 只在本平台有效；任何一步失败都返回 false，由调用方给出「可能收进了托盘」的提示。
 */
import { log } from "../util/log.ts";

const IS_WINDOWS = Deno.build.os === "windows";
const GW_OWNER = 4;
const SW_RESTORE = 9;

export function focusWindowOfProcess(pid: number): boolean {
  if (!IS_WINDOWS || !pid || pid <= 0) return false;
  try {
    const sys32 = "C:\\Windows\\System32\\";
    const user32 = Deno.dlopen(sys32 + "user32.dll", {
      EnumWindows: { parameters: ["pointer", "i64"], result: "i32" },
      GetWindowThreadProcessId: { parameters: ["pointer", "pointer"], result: "u32" },
      GetWindowTextLengthW: { parameters: ["pointer"], result: "i32" },
      IsWindowVisible: { parameters: ["pointer"], result: "i32" },
      GetWindow: { parameters: ["pointer", "u32"], result: "pointer" },
      GetWindowRect: { parameters: ["pointer", "pointer"], result: "i32" },
      ShowWindow: { parameters: ["pointer", "i32"], result: "i32" },
      BringWindowToTop: { parameters: ["pointer"], result: "i32" },
      SetForegroundWindow: { parameters: ["pointer"], result: "i32" },
    });

    // 挑目标进程里「可见 + 有标题 + 无属主」面积最大的那个窗口（与设图标同一套判据）
    const pidBuf = new Uint32Array(1);
    const rect = new Int32Array(4);
    let best = 0n;
    let bestArea = 0;
    const cb = new Deno.UnsafeCallback(
      { parameters: ["pointer", "i64"], result: "i32" },
      (hwnd: Deno.PointerValue) => {
        user32.symbols.GetWindowThreadProcessId(hwnd, Deno.UnsafePointer.of(pidBuf));
        if (pidBuf[0] !== pid) return 1;
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
    if (best === 0n) return false;

    const hwnd = Deno.UnsafePointer.create(best);
    user32.symbols.ShowWindow(hwnd, SW_RESTORE);
    user32.symbols.BringWindowToTop(hwnd);
    user32.symbols.SetForegroundWindow(hwnd);
    return true;
  } catch (e) {
    log.warn("window", `唤醒已有实例的窗口失败：${(e as Error).message}`);
    return false;
  }
}
