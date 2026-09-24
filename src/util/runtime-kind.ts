/**
 * 运行形态判据。
 *
 * Deno 应用有三种跑法，行为必须分开，否则会出「编译态又弹一个系统浏览器」这种怪事。
 * 三种形态的实测特征（2026-09-24 用 tmp/probe-desktop.ts 在 deno 2.9.7 上逐一验证）：
 *
 * | 形态                  | build.standalone | desktopVersion | Deno.BrowserWindow |
 * |-----------------------|------------------|----------------|--------------------|
 * | `deno run`            | false            | 不存在          | 无                 |
 * | `deno desktop` 编译态  | true             | **null**       | 有                 |
 * | `deno desktop --hmr`  | true             | **null**       | 有                 |
 *
 * ⚠️ 两个都别踩的坑：
 *  1. `Deno.desktopVersion` 的值是 **`null`**（不是字符串！），所以
 *     `typeof Deno.desktopVersion === "string"` 恒为 false —— 编译态会被误判成开发态。
 *     这个判据曾导致编译后的 exe 额外弹出一次系统浏览器。
 *  2. `build.standalone` 对 **HMR 开发态也为 true**，所以它只能回答
 *     「是不是独立二进制」，不能回答「有没有桌面窗口」。
 *
 * 因此本站只用 `"BrowserWindow" in Deno` 回答「有没有桌面窗口」——
 * 这是唯一能把「hmr/编译态」与「deno run」分开的判据，且不依赖任何未公开字段。
 */

/** 是否由 deno desktop 运行时驱动（编译态或 --hmr 开发态都算）——即"已经有窗口了"。 */
export function hasDesktopRuntime(): boolean {
  return "BrowserWindow" in Deno;
}

/** 是否为独立二进制（deno compile / deno desktop 产物）。 */
export function isStandaloneBinary(): boolean {
  return Deno.build.standalone === true;
}

/** deno desktop 运行时版本号；非桌面态返回 null。 */
export function desktopRuntimeVersion(): string | null {
  const v = (Deno as unknown as { desktopVersion?: unknown }).desktopVersion;
  return typeof v === "string" ? v : null;
}

/**
 * 日志要不要打到控制台。
 *
 * 判据是「有没有人在看控制台」，而不是「是不是编译态」——
 * 因为 `--hmr` 既满足 standalone、又确实开着终端，按 standalone 判会把它误伤成静默。
 * 所以直接问「stdout 是不是终端」：双击 exe 时不是（打了也没人看），
 * 终端里跑 `deno run` / `deno task dev` 时是（照常打）。
 *
 * 注意：`deno ... > file 2>&1` 重定向时也不是终端，控制台不会重复打 ——
 * 这是对的，此时该看的是落盘日志。
 */
export function shouldLogToConsole(): boolean {
  try {
    return Deno.stdout.isTerminal();
  } catch {
    // 某些桌面/无 stdio 环境下取不到，保守当作「没有终端」，宁可少打不可乱打。
    return false;
  }
}

/**
 * 桌面态启动前的适配措施。**必须在创建服务/窗口之前调用**。
 *
 * 现状：只做一件事 —— 关掉 WebView2 的进程沙箱。
 *
 * 为什么必须关：本机上 WebView2 的 Chromium 沙箱初始化会失败，触发内部的
 * `CHECK()` 断言，异常码 `0x80000003`（BREAKPOINT —— Chromium 断言失败时会调
 * DebugBreak 主动自杀）。现场表现为「窗口出来了，页面也发过请求、跑过一次 JS，
 * 约 2 秒后画面变全白，且再无任何子进程」。
 *
 * 证据链（2026-09-24，deno 2.9.7 + WebView2 153.0.4234.48 + Windows 10.0.26200）：
 *   基线                    → 4 次请求后于 ~1.7s 断流（可复现）
 *   --disable-gpu           → 同样断流（排除 GPU）
 *   --no-sandbox            → 全程存活 ✅
 *   --single-process        → 全程存活 ✅（同指多进程沙箱）
 *   Crashpad 转储解析        → 异常码 0x80000003，落在 msedge.dll
 *
 * 机制：WebView2 环境是在**窗口创建时**才建立的（实测约 1.7~2.2 秒后），
 * 而我们的入口 JS 在 ~12ms 就跑起来了，所以从 JS 里设环境变量来得及被读到
 * （已实测验证：不依赖任何外部启动脚本）。
 *
 * 代价评估：关掉的是**渲染进程**的沙箱。本工具的界面只加载自己本地 HTTP 服务
 * 返回的自家 HTML，且 Deno 侧本就全权（`-A`，权限编译期烘焙）。所以这里少掉的
 * 保护是边际的，换来的是「在这台机器上真的能显示」。若将来要分发且在意这点，
 * 可设环境变量 `DSH_BUTLER_KEEP_WEBVIEW_SANDBOX=1` 保留沙箱。
 *
 * @returns 说明字符串，供日志记录（便于以后排查"到底有没有生效"）。
 */
export function applyDesktopWorkarounds(): string {
  if (!hasDesktopRuntime()) return "非桌面态，无需适配";

  const KEY = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
  const existing = Deno.env.get(KEY);

  if (Deno.env.get("DSH_BUTLER_KEEP_WEBVIEW_SANDBOX") === "1") {
    return "已按用户要求保留 WebView2 沙箱（若窗口空白，取消该环境变量）";
  }

  // 已经有人设过就不覆盖 —— 外部显式配置优先，可能有我们不知道的理由。
  if (existing && existing.trim().length > 0) {
    return `沿用外部已设的 ${KEY}=${existing}`;
  }

  Deno.env.set(KEY, "--no-sandbox");
  return `已关闭 WebView2 沙箱（${KEY}=--no-sandbox）`;
}
