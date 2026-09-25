/**
 * 单实例保护。
 *
 * 【2026-09-25 实测事故 —— 用户报「软件白屏起不来了」】
 * 管家已经在跑的时候再启动一次，第二个进程会出现两个致命问题：
 *   1) 两个实例共用同一份 WebView2 用户数据目录（dist/dsh-butler/dsh-butler.exe.WebView2），
 *      后开的那个拿不到可用的渲染环境 —— 窗口在那里、画面全白，日志里是
 *      「悬浮条注入超时（页面一直没就绪）—— 最后一次探测结果：null」；
 *   2) 两个实例还会互相抢同一个窗口（窗口查找按进程号匹配，但 deno desktop 的隐式窗口
 *      在第二个进程里并不存在），把前一个实例的窗口也弄没。
 *
 * 所以：启动时先抢锁；发现已有活着的实例 → 把它的窗口拿到前台，然后自己退出。
 * 注意 headless 与 CLI 模式**不参与**这套保护 —— 脚本本来就可能同时起多个。
 */
import { APP_VERSION } from "../version.ts";
import { log } from "../util/log.ts";
import { butlerRoot, p } from "../util/paths.ts";
import { readJson, writeJsonAtomic } from "./fs.ts";
import { isAlive } from "./process.ts";

export interface InstanceHolder {
  pid: number;
  startedAt: string;
  version: string;
}

export function instanceFile(): string {
  return p(butlerRoot(), "instance.json");
}

export function readHolder(file = instanceFile()): InstanceHolder | null {
  const j = readJson<InstanceHolder>(file);
  return j && typeof j.pid === "number" ? j : null;
}

/**
 * 抢单实例锁。
 * 返回 ok=false 代表「已经有一个活着的实例」，holderPid 是它的进程号。
 * 锁文件里的进程号已经死掉时会被接管（崩溃/强杀留下的陈旧锁不会把用户关在门外）。
 */
export async function claimSingleInstance(
  file = instanceFile(),
): Promise<{ ok: boolean; holderPid?: number }> {
  const prev = readHolder(file);
  if (prev && prev.pid !== Deno.pid && await isAlive(prev.pid)) {
    return { ok: false, holderPid: prev.pid };
  }
  try {
    const holder: InstanceHolder = {
      pid: Deno.pid,
      startedAt: new Date().toISOString(),
      version: APP_VERSION,
    };
    writeJsonAtomic(file, holder);
  } catch (e) {
    // 写不进去也不能挡启动：最坏结果是这次没有保护
    log.warn("instance", `单实例锁写不进去（不影响启动）：${(e as Error).message}`);
  }
  return { ok: true };
}

/**
 * 「请把窗口叫出来」的请求文件。
 *
 * 【为什么需要它】只有单实例锁还不够：用户可能已经把窗口关了（进程靠锚窗口留在后台），
 * 这时第二次启动若只是「找不到窗口就退出」，用户面前会什么都不出现 —— 比白屏更让人困惑。
 * 于是第二个实例留一个请求文件，正在运行的那个在保活定时器里看到后把窗口重建/前置。
 */
export function showRequestFile(): string {
  return p(butlerRoot(), "show-request");
}

export function requestShow(file = showRequestFile()): void {
  try {
    Deno.writeTextFileSync(file, new Date().toISOString());
  } catch { /* 写不进去也不影响退出 */ }
}

/** 有请求就消费掉（删除并返回 true）。 */
export function consumeShowRequest(file = showRequestFile()): boolean {
  try {
    if (!Deno.statSync(file).isFile) return false;
  } catch {
    return false;
  }
  try {
    Deno.removeSync(file);
  } catch { /* 已经没了 */ }
  return true;
}

/** 退出时释放。只删属于自己的锁，绝不误删别人的。 */
export function releaseSingleInstance(file = instanceFile()): void {
  const cur = readHolder(file);
  if (!cur || cur.pid !== Deno.pid) return;
  try {
    Deno.removeSync(file);
  } catch { /* 已经不在了 */ }
}
