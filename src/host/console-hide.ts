/**
 * 静默执行的核心：让主进程持有一个【隐藏的控制台】。
 *
 * 为什么需要（2026-09-24 实测定论）：
 *   `deno desktop` 产物是 GUI 子系统（Subsystem=2，双击本身零黑窗），但它派生的
 *   控制台子进程（git / powershell / node…）因为父进程没有控制台，Windows 会给
 *   每个子进程【新开一个控制台窗口】—— 页面一加载的总览探针就弹 4~5 个
 *   WindowsTerminal 窗口，体检任务执行期间更是连环弹（实测一次 22 个）。
 *
 * 解法（实测有效且无副作用）：
 *   启动最早期 AllocConsole() 给自己创建控制台 → 立刻 ShowWindow(SW_HIDE) 藏掉。
 *   之后所有控制台子进程默认【继承父进程的控制台】，不再各自开新窗 ——
 *   这是 Windows 的原生继承语义，因此：
 *     - 退出码原样透传（成败判定不受影响）；
 *     - stdout/stderr 管道捕获原样；
 *     - 不需要包装子命令、不引入中间进程。
 *
 * 路线取舍（都实测过，别走回头路）：
 *   - PE 头 CUI→GUI 补丁：deno desktop 产物本来就是 GUI；且旧版常量表写反
 *     （1=NATIVE/2=GUI/3=CUI），把 2 改成 1 会把 exe 改成 NATIVE 态，
 *     Win32 拒绝运行（错误 193「应用程序无法在 Win32 模式中运行」）。
 *   - `conhost.exe --headless` 包装每个子命令：能隐藏窗口，但【退出码丢失】
 *     （git 失败 128 → 包装后 0；node exit 7 → 0），体检判不了成败，死刑。
 *   - `Deno.Command` 没有 windowsHide / CREATE_NO_WINDOW 选项（deno types 已核）。
 *
 * 开发态（终端里 `deno run` / `deno desktop --hmr`）：
 *   进程已有控制台 → AllocConsole() 返回 0（ERROR_ACCESS_DENIED），不隐藏、
 *   不影响终端可见性 —— 正是想要的行为。
 *
 * FFI 归属：AllocConsole/GetConsoleWindow 在 kernel32.dll，ShowWindow 在 user32.dll
 * （写在同一个 dlopen 里会报 error 127「找不到指定的程序」，踩过）。
 */

let applied = false;

/**
 * 创建并隐藏自己的控制台。幂等；任何失败都只影响美观不影响功能。
 * @returns 说明字符串（进日志，方便以后排查「到底藏没藏」）。
 */
export function hideOwnConsole(): string {
  if (Deno.build.os !== "windows") return "非 Windows，跳过控制台隐藏";
  if (applied) return "控制台隐藏已执行过（幂等跳过）";
  applied = true;

  let kernel: Deno.DynamicLibrary<typeof KERNEL_API> | null = null;
  let user32: Deno.DynamicLibrary<typeof USER_API> | null = null;
  try {
    kernel = Deno.dlopen("kernel32.dll", KERNEL_API);
    user32 = Deno.dlopen("user32.dll", USER_API);

    const created = kernel.symbols.AllocConsole();
    if (created === 0) {
      // 已有控制台（开发态从终端启动）：保持原样，子进程继承可见终端 —— 符合预期。
      return "已有控制台（开发态），不隐藏";
    }

    const hwnd = kernel.symbols.GetConsoleWindow();
    if (hwnd !== null) {
      user32.symbols.ShowWindow(hwnd, SW_HIDE); // 返回值是旧可见状态，无需判断
    }
    return "已创建并隐藏控制台：子进程将继承此隐藏控制台，不再弹新窗口";
  } catch (e) {
    // FFI 不可用等极端情况：功能照常，只是子进程可能闪窗（可接受降级）。
    return `隐藏控制台失败（不影响功能）：${(e as Error).message}`;
  } finally {
    // 句柄用完即关：控制台的存活与库句柄无关，这里只关 FFI 库。
    try {
      kernel?.close();
    } catch { /* ignore */ }
    try {
      user32?.close();
    } catch { /* ignore */ }
  }
}

const SW_HIDE = 0;

const KERNEL_API = {
  AllocConsole: { parameters: [] as const, result: "i32" },
  GetConsoleWindow: { parameters: [] as const, result: "pointer" },
} as const;

const USER_API = {
  ShowWindow: { parameters: ["pointer", "i32"] as const, result: "i32" },
} as const;
