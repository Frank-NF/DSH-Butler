/**
 * 与官方桌面端共存 / 降级（P2-5）。
 *
 * 【为什么要降级】官方桌面端把窗口、托盘、单实例、自动更新都做完了（我们早先的调研结论）。
 * 两个程序都抢托盘、都抢窗口，用户看到的就是「托盘里两个图标、窗口乱跳」。
 * 所以检测到官方桌面端在跑时，管家主动退成【运维/急救】角色：不注入悬浮条、不抢前台，
 * 只保留体检、修复、回滚、备份这些官方不会做的事。
 *
 * 【两种模式】
 *   full         —— 完整模式：正常注入悬浮条、正常抢前台（默认，也是没装官方桌面端时的行为）
 *   service-only —— 运维模式：不注入悬浮条、不抢前台，界面顶部明说为什么
 *
 * 【反悔开关】配置里 coexistMode = "full" 可以强制完整模式 —— 误判永远可能，
 * 用户必须能一句话关掉这个自动行为。
 */

import { listProcesses } from "../../host/process.ts";
import { loadConfig } from "../state/config.ts";

export type CoexistMode = "full" | "service-only";

/** 明显属于管家自己或运行时的进程名：绝不能被当成官方桌面端。 */
const OWN_NAMES = ["dsh-butler", "dshbutler", "deno", "node", "pwsh", "powershell", "cmd", "conhost", "tasklist"];

/**
 * 这个进程像不像官方桌面端（纯函数，便于测试）。
 * 判据保守优先：宁可漏判（用户自己关悬浮条）也不要误判（把正常使用搞坏）。
 */
export function isOfficialDesktopProcess(p: { name?: string; path?: string; cmdline?: string }): boolean {
  const rawName = (p.name ?? "").toLowerCase().replace(/\.exe$/, "").trim();
  const blob = ((p.path ?? "") + " " + (p.cmdline ?? "")).toLowerCase();
  if (!rawName) return false;
  // 自己人一律排除（管家自己的 exe 名字里也带 dsh）
  if (OWN_NAMES.some((o) => rawName === o || rawName.startsWith(o + "-"))) return false;
  if (blob.includes("dsh-butler")) return false;
  if (rawName === "dsh" || rawName === "dsh-desktop" || rawName === "deepseek-harness") return true;
  // Electron 壳：路径里同时有 dsh 与 desktop/electron 特征
  return blob.includes("dsh") && (blob.includes("desktop") || blob.includes("electron"));
}

export interface CoexistDetection {
  detected: boolean;
  /** 命中的进程名（最多几个）。 */
  names: string[];
  /** 人话证据（给界面显示「凭什么这么判断」）。 */
  evidence: string[];
}

/** 当前的探测结果（异步枚举进程；失败一律当作「没检测到」，绝不因检测失败改变行为）。 */
export async function detectOfficialDesktop(): Promise<CoexistDetection> {
  try {
    const procs = await listProcesses();
    const hits = procs.filter((p) =>
      isOfficialDesktopProcess(p as { name?: string; path?: string; cmdline?: string })
    );
    return {
      detected: hits.length > 0,
      names: hits.slice(0, 3).map((p) => (p as { name?: string }).name ?? "?"),
      evidence: hits.slice(0, 3).map((p) =>
        `${(p as { name?: string }).name ?? "?"}　${(p as { path?: string }).path ?? (p as { cmdline?: string }).cmdline ?? ""}`.trim()
      ),
    };
  } catch (e) {
    return { detected: false, names: [], evidence: [`进程枚举失败，按未检测到处理：${(e as Error).message}`] };
  }
}

/** 模式决策（纯函数）：配置里强制 full 就一定 full。 */
export function decideMode(
  detected: boolean,
  cfg: { coexistMode?: "auto" | "full" },
): CoexistMode {
  if ((cfg.coexistMode ?? "auto") === "full") return "full";
  return detected ? "service-only" : "full";
}

/** 进程里缓存的模式（启动时算一次，避免每次问都枚举进程）。 */
let cachedMode: CoexistMode | null = null;
let cachedDetection: CoexistDetection | null = null;

/** 启动时调用一次：算出本次运行的模式并记下证据。 */
export async function initCoexist(): Promise<{ mode: CoexistMode; detection: CoexistDetection }> {
  const detection = await detectOfficialDesktop();
  const mode = decideMode(detection.detected, loadConfig());
  cachedMode = mode;
  cachedDetection = detection;
  return { mode, detection };
}

export function currentMode(): CoexistMode {
  if (cachedMode) return cachedMode;
  // 还没初始化过（例如 CLI 路径）：按配置判断，不猜进程
  return decideMode(false, loadConfig());
}

export function currentDetection(): CoexistDetection | null {
  return cachedDetection;
}

/** 运维模式 = 不抢窗口/托盘、不注入悬浮条。 */
export function isServiceOnly(): boolean {
  return currentMode() === "service-only";
}

/** 给界面用的一句话说明。 */
export function modeNote(): string {
  const d = cachedDetection;
  if (currentMode() === "full") {
    return loadConfig().coexistMode === "full"
      ? "完整模式（设置里强制指定）"
      : "完整模式：没检测到官方桌面端";
  }
  return `运维模式：检测到官方桌面端在运行${d && d.names.length ? "（" + d.names.join("、") + "）" : ""}，管家不抢窗口与托盘，只做体检/修复/回滚/备份`;
}
