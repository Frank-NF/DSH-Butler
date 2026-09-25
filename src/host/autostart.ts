/**
 * 开机自动启动（用户级 Run 注册表项）。
 *
 * 只动 HKCU，不碰 HKLM —— 不需要管理员权限，也不影响其它用户；
 * 值名固定，卸载/关掉时按同一个名字删。
 */

import { run } from "./shell.ts";
import { log } from "../util/log.ts";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "DSH Butler";

/** 当前是否已经设了自启。 */
export async function autostartEnabled(): Promise<boolean> {
  if (Deno.build.os !== "windows") return false;
  const r = await run("reg", ["query", RUN_KEY, "/v", VALUE_NAME], { timeoutMs: 8000 });
  return r.code === 0;
}

/** 读回自启项里记的命令行（没有就 null）。 */
export async function autostartCommand(): Promise<string | null> {
  if (Deno.build.os !== "windows") return null;
  const r = await run("reg", ["query", RUN_KEY, "/v", VALUE_NAME], { timeoutMs: 8000 });
  if (r.code !== 0) return null;
  const m = r.stdout.match(/REG_SZ\s+(.+)/);
  return m ? m[1]!.trim() : null;
}

/**
 * 打开/关闭自启。exePath 只在打开时用（默认当前进程的可执行文件）。
 * 返回人话结果，界面直接显示。
 */
export async function setAutostart(
  on: boolean,
  exePath: string = Deno.execPath(),
): Promise<{ ok: boolean; message: string }> {
  if (Deno.build.os !== "windows") {
    return { ok: false, message: "当前系统不支持（只实现了 Windows）" };
  }
  try {
    if (on) {
      const r = await run(
        "reg",
        ["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", `"${exePath}"`, "/f"],
        { timeoutMs: 8000 },
      );
      if (r.code !== 0) return { ok: false, message: `写入注册表失败：${r.stderr || r.stdout}` };
      return { ok: true, message: `已设为开机自启：${exePath}` };
    }
    const r = await run("reg", ["delete", RUN_KEY, "/v", VALUE_NAME, "/f"], { timeoutMs: 8000 });
    // 本来就没有这项时 reg 会返回非 0 —— 那不是失败
    if (r.code !== 0 && !/unable to find|cannot find|找不到/i.test(r.stderr + r.stdout)) {
      return { ok: false, message: `删除注册表项失败：${r.stderr || r.stdout}` };
    }
    return { ok: true, message: "已关闭开机自启" };
  } catch (e) {
    log.warn("autostart", `设置自启失败：${(e as Error).message}`);
    return { ok: false, message: `设置自启失败：${(e as Error).message}` };
  }
}
