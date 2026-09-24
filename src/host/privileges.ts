/**
 * 权限探测与提权引导。
 *
 * 原则（方案 §9.4）：权限问题必须在【动手之前】发现，不允许"干到一半才发现没权限"。
 * 所有输出都带四要素：原因 / 影响 / 建议动作 / 一键执行入口。
 */

import { isWritable } from "./fs.ts";
import { hostFacts } from "./windows-facts.ts";
import { type Finding, finding } from "../util/result.ts";

/** 当前进程是否具备管理员/root 权限。 */
export async function isElevated(): Promise<boolean> {
  if (Deno.build.os === "windows") {
    // 与 CPU 型号 / 系统版本 / 磁盘容量共用同一次 PowerShell 调用（见 windows-facts.ts），
    // 不再单独为此启动一次进程 —— 那要额外花 1.5~2.5 秒。
    return (await hostFacts()).elevated;
  }
  try {
    // 注：Deno.getUid 不存在，正确 API 是 Deno.uid()（Windows 上返回 null）。
    return Deno.uid() === 0;
  } catch {
    return false;
  }
}

export interface WriteCheck {
  path: string;
  writable: boolean;
  error?: string;
}

/** 批量检查多个目录的写权限。 */
export function checkWritable(paths: string[]): WriteCheck[] {
  return paths.map((path) => {
    const r = isWritable(path);
    const item: WriteCheck = { path, writable: r.writable };
    if (r.error) item.error = r.error;
    return item;
  });
}

/** 把「不可写」转成带四要素的 finding。 */
export function writabilityFinding(check: WriteCheck, what: string, fixAction?: string): Finding {
  const f: Finding = finding(
    "env.dir-not-writable",
    "error",
    `${what}目录不可写`,
    {
      cause: check.error ?? "当前用户对该目录没有写权限（可能是受保护目录，或目录被其它程序占用）",
      impact: `无法${what}，相关操作会中途失败`,
      action: Deno.build.os === "windows"
        ? "以管理员身份重新启动本程序，或把 DSH 装到用户目录下（如 D:\\DeepSeek_Harness）"
        : "用 sudo 重新运行，或调整该目录的属主与权限",
      evidence: [check.path],
    },
  );
  if (fixAction) f.fixAction = fixAction;
  return f;
}

/** 提权状态摘要，用于界面顶部提示条。 */
export interface ElevationStatus {
  elevated: boolean;
  /** 需要提权的建议文案（未提权时给）。 */
  hint?: string;
}

export async function elevationStatus(): Promise<ElevationStatus> {
  const elevated = await isElevated();
  if (elevated) return { elevated };
  return {
    elevated,
    hint: Deno.build.os === "windows"
      ? "当前以普通用户权限运行。仅当 DSH 装在 Program Files 等受保护目录、或需要结束后台进程时才需要管理员权限。"
      : "当前以普通用户权限运行。仅当需要写入系统目录或结束其它用户的进程时才需要 root。",
  };
}
