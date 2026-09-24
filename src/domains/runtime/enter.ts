/**
 * 单一窗口外壳的「进入 DSH」编排。
 *
 * 产品形态（2026-09-24 改版）：这个程序就是桌面版 DSH，一个窗口。
 *   没装本体 → 窗口里是部署向导；装好了 → 同一个窗口换成 DSH 界面。
 * 于是"进入 DSH"要回答三个问题，这个模块把它们收在一处：
 *   ① 装没装（没装就别说进入，去部署）；
 *   ② 服务在不在跑（不在跑就起来）；
 *   ③ 拿不拿得到"带令牌的地址"（这是最容易被忽略的一环 —— DSH 界面不是公开页面，
 *      裸地址会 401 一片白；令牌是进程级的，只有管家自己启动的那次才有记录）。
 *
 * 只在"该换窗口了"这件事上做决定，具体 navigate 由调用方（主进程 / 接口层）执行 ——
 * 领域层不碰窗口，保持可测。
 */

import { DSH_PORT_DEFAULT } from "../../version.ts";
import { resolveDshSourceRoot } from "../../util/paths.ts";
import { log } from "../../util/log.ts";
import { loadConfig } from "../state/config.ts";
import { startDshServer, stopDshServer } from "../core/finish_update.ts";
import { collectRuntimeStatus } from "./status.ts";
import { findDshAuthUrl } from "./dsh-url.ts";

export interface ShellState {
  /** 本机装没装 DSH 本体。 */
  installed: boolean;
  installedPath: string | null;
  /** 服务进程在不在。 */
  serviceRunning: boolean;
  /** HTTP 真的能通。 */
  healthy: boolean;
  port: number | null;
  /** 有没有"带令牌的地址"（能真正走进 DSH 界面的凭据）。 */
  tokenAvailable: boolean;
  url: string | null;
  /** 建议的下一步：部署 / 直接进入 / 先启动再进入 / 先接管（重启）再进入。 */
  next: "deploy" | "enter" | "start" | "takeover";
  /** 给界面看的一句话解释。 */
  note: string;
}

/** 当前"该怎么进 DSH"的完整现状。只读。 */
export async function collectShellState(): Promise<ShellState> {
  const probe = resolveDshSourceRoot();
  const st = await collectRuntimeStatus().catch(() => null);
  const port = st?.port ?? loadConfig().dshPort ?? DSH_PORT_DEFAULT;
  const healthy = Boolean(st?.running && st.health?.reachable);
  const found = probe ? findDshAuthUrl(port) : { url: null as string | null, note: "" };

  if (!probe) {
    return {
      installed: false,
      installedPath: null,
      serviceRunning: Boolean(st?.running),
      healthy,
      port: st?.port ?? null,
      tokenAvailable: false,
      url: null,
      next: "deploy",
      note: "本机还没装 DSH 本体 —— 先用「一键部署」装好（约 15 分钟），装完这个窗口就是 DSH。",
    };
  }
  if (healthy && found.url) {
    return {
      installed: true,
      installedPath: probe.path,
      serviceRunning: true,
      healthy: true,
      port,
      tokenAvailable: true,
      url: found.url,
      next: "enter",
      note: "DSH 已就绪，可以直接进去使用。",
    };
  }
  if (st?.running) {
    return {
      installed: true,
      installedPath: probe.path,
      serviceRunning: true,
      healthy,
      port,
      tokenAvailable: Boolean(found.url),
      url: found.url,
      next: "takeover",
      note: "DSH 正在运行，但它不是管家启动的，管家拿不到进入令牌 —— " +
        "点「接管并进入」会由管家重启一次服务，之后就能直接在窗口里使用。",
    };
  }
  return {
    installed: true,
    installedPath: probe.path,
    serviceRunning: false,
    healthy: false,
    port,
    tokenAvailable: Boolean(found.url),
    url: found.url,
    next: "start",
    note: "DSH 已装好但服务没在运行 —— 点「启动并进入」会把它起起来。",
  };
}

export interface EnterResult {
  ok: boolean;
  /** 成功时：主窗口应当导航到的地址。 */
  url?: string;
  state: ShellState;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 确保 DSH 可用并返回"该导航到哪"。
 *
 * @param opts.restartIfNeeded 允许为了拿到令牌而重启一次服务。
 *   为什么需要这个开关：服务是**别人**启动的时候，令牌在它的终端里，管家看不到；
 *   唯一拿到令牌的办法是由管家自己重新启动一次。这属于有副作用的动作，
 *   所以只有"用户明确点了进入"或"刚刚部署完"这两条路径才传 true。
 */
export async function enterDsh(opts: { restartIfNeeded?: boolean } = {}): Promise<EnterResult> {
  let state = await collectShellState();

  if (!state.installed) {
    return { ok: false, state, error: "本机还没装 DSH 本体，先在「一键部署」里装好再来" };
  }

  const needStart = !state.healthy;
  const needTakeover = state.healthy && !state.tokenAvailable;

  if (needStart || needTakeover) {
    if (!opts.restartIfNeeded) {
      return {
        ok: false,
        state,
        error: needTakeover ? "DSH 是别的程序启动的，管家拿不到进入令牌" : "DSH 服务没有在运行",
      };
    }
    const probe = resolveDshSourceRoot();
    if (!probe) return { ok: false, state, error: "找不到 DSH 本体目录" };

    const port = state.port ?? DSH_PORT_DEFAULT;
    log.info("runtime", needTakeover ? "接管 DSH 服务（重启一次以取得进入令牌）" : "启动 DSH 服务");
    await stopDshServer();
    const started = await startDshServer(probe.path, port);
    if (!started.ok) {
      return { ok: false, state, error: `启动 DSH 失败：${started.message}` };
    }
    // 起来之后再确认一次：端口通了 + 日志里出现了带令牌的地址（最多等 10 秒）
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      state = await collectShellState();
      if (state.healthy && state.tokenAvailable) break;
    }
  }

  if (!state.tokenAvailable || !state.url) {
    return {
      ok: false,
      state,
      error: "进不去：没能从 DSH 的启动输出里取到带令牌的地址。" +
        "可以在「运行状态」页点「重启服务」再试一次。",
    };
  }
  return { ok: true, url: state.url, state };
}
