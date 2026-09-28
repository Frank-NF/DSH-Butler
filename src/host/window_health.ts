/**
 * 窗口健康判据（纯函数，便于单测）。
 *
 * 【为什么单独一个文件】2026-09-28 用户实测：管家窗口停在 Edge 的「127.0.0.1 拒绝连接」
 * 错误页（ERR_CONNECTION_REFUSED），而管家与 DSH 服务都活着。要能自动发现这种事，
 * 判据必须足够准（不能把"正在导航中""用户点开了外部网站"误判成卡死），
 * 所以把它抽成纯函数，用测试把每种情形钉死。
 */

/** 页面对窗口自报的三件事（由主程序注入脚本取回）。 */
export interface WindowProbe {
  href?: string;
  origin?: string;
  title?: string;
  /** 页面里有没有 Chromium 错误页的标记。 */
  error?: boolean;
}

export interface WindowHealthOptions {
  /** 距离上一次导航过了多少毫秒（页面加载中会出现短暂的空白，别当成卡死）。 */
  msSinceNavigation?: number;
  /** 刚导航完的宽限期（默认 60 秒）。 */
  blankGraceMs?: number;
}

/** 日志里只留"协议 + 主机 + 端口 + 路径"：地址里可能带令牌。 */
export function redactUrl(u: string): string {
  const q = u.indexOf("?");
  if (q < 0) return u;
  return u.slice(0, q) + "?…";
}

/** 这个源是不是本机回环地址（本地服务没了才会出现的那种）。 */
export function isLoopbackOrigin(origin: string): boolean {
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) return false;
  const rest = origin.slice(origin.indexOf("://") + 3);
  const host = rest.split(":")[0] ?? "";
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/**
 * 窗口是不是废了。
 *
 * 命中任意一条就算：
 *   1) 页面源不是"我们最后指过去的那个源"，且跑偏到的是本机回环地址
 *      —— 本地服务没了 / 地址指错了，真正出事那次就是这种；
 *   2) 页面带 Chromium 错误页标记（连我们自己的地址都没打开、源却一样的情形）；
 *   3) 页面是空白（about:blank / origin = "null"），**但刚导航完的宽限期内不算**
 *      —— 实测：启动后第一次探测正好落在页面还没加载完的时候，报的就是 origin=null。
 * 用户自己点开的外部网站不算 —— 别去打断他。
 */
export function windowLooksStuck(
  p: WindowProbe,
  expectedOrigin: string | null,
  opts: WindowHealthOptions = {},
): boolean {
  const origin = typeof p.origin === "string" ? p.origin : "";
  const since = opts.msSinceNavigation;
  const grace = opts.blankGraceMs ?? 60_000;
  const inGrace = since !== undefined && since >= 0 && since < grace;
  // 错误页标记最强：它是页面加载失败后的终态，不会出现在"正在加载"的过程中，
  // 所以不受宽限期约束（真实错误页的 origin 也是 "null"，先判它才不会被空白规则吃掉）
  if (p.error === true) return true;
  const blank = origin === "null" || p.href === "about:blank" || origin === "";
  if (blank) return !inGrace;
  if (expectedOrigin === null) return false;
  return origin !== expectedOrigin && isLoopbackOrigin(origin);
}
