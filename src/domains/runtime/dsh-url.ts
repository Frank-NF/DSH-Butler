/**
 * 找出「带令牌的 DSH 界面地址」。
 *
 * 【为什么必须带令牌】DSH 的 web 界面不是公开的：直接 GET http://127.0.0.1:3081/ 会拿到
 * 401 与一句 "dsh web authentication required; reopen the URL printed by dsh web."
 * 它要求访问的是**启动时打印的那个带 token 的地址**（浏览器拿它换一次签名 cookie，
 * 之后才放行）。实测 2026-09-24：独立窗口按裸地址打开就是一片白 —— 根因就在这。
 *
 * 令牌从哪来：DSH 的令牌是**每次启动随机生成**的进程级令牌（源码：
 * packages/client/connection/src/browser-auth.ts 的 launchToken），没有落盘，
 * 因此只能从它的启动输出里捞。管家自己启动的服务，stdout 落在
 * ~/.dsh-butler/logs/dsh-server-*.out.log —— 就近取最新那份。
 *
 * 拿不到就老实说拿不到（返回 null），绝不猜一个地址糊弄用户。
 */

import { isFile } from "../../host/fs.ts";
import { butlerLogsDir, p } from "../../util/paths.ts";

export interface DshUrlLookup {
  url: string | null;
  /** 人话解释，界面直接展示。 */
  note: string;
  /** 是从哪个文件的哪一行捞到的（便于排查）。 */
  source?: string;
}

/** 从一段文本里捞出该端口的带令牌地址。 */
export function extractAuthUrl(text: string, port: number): string | null {
  const re = new RegExp(
    `https?://(?:127\\.0\\.0\\.1|localhost):${port}/[^\\s"'<>]*(?:\\?|&)token=[A-Za-z0-9._~-]+`,
    "g",
  );
  const hits = text.match(re);
  if (!hits || hits.length === 0) return null;
  // 取最后一个：DSH 重启过的话，最新的那份才是有效的
  return hits[hits.length - 1]!.replace(/[).,;，。；]+$/, "");
}

/** 扫描管家日志目录里最新的几份 DSH 启动输出，找带令牌的地址。 */
export function findDshAuthUrl(port: number, opts: { maxFiles?: number } = {}): DshUrlLookup {
  const dir = butlerLogsDir();
  let names: string[] = [];
  try {
    names = Array.from(Deno.readDirSync(dir))
      .filter((e) => e.isFile && /^dsh-server-.*\.out\.log$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return {
      url: null,
      note: "管家日志目录还没有 DSH 的启动输出（说明服务不是管家启动的）",
    };
  }
  if (names.length === 0) {
    return { url: null, note: "管家没有启动过 DSH 服务，因此拿不到它的访问令牌" };
  }

  // 文件名里带时间戳（yyyymmdd-hhmmss），倒序即最新在前
  names.sort().reverse();
  const limit = Math.max(1, Math.min(opts.maxFiles ?? 3, names.length));
  for (const name of names.slice(0, limit)) {
    const file = p(dir, name);
    if (!isFile(file)) continue;
    let text = "";
    try {
      text = Deno.readTextFileSync(file);
    } catch {
      continue;
    }
    const hit = extractAuthUrl(text, port);
    if (hit) {
      return { url: hit, note: "已从 DSH 启动输出里取到带令牌的地址", source: file };
    }
  }
  return {
    url: null,
    note: "没有在 DSH 的启动输出里找到带令牌的地址（服务可能是上次启动的，令牌已失效）",
  };
}
