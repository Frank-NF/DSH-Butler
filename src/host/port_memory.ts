/**
 * 端口记忆（2026-09-30 新增）。
 *
 * 用户原话：「这个自动换端口太烦了……用着用着就页面拒绝访问了。
 * 我是开发者我知道原因，用户不知道啊，两次就弃用了。」
 *
 * 漂移的根因不是"顺延"本身，而是"每次都重新挑一个"：上次 8731 用得好好的，
 * 这次被占了换 8742，下次 8731 空了又换回来 —— 用户刚记住的地址说废就废。
 * 所以把"上次真的用起来的那个端口"记下来，下次优先沿用。
 *
 * 顺带解释一下为什么不能"在旧端口留个跳转页"：旧端口要是空着我们本就会去占它；
 * 换了端口，恰恰说明旧端口已经被别人（多半是上一个没退干净的实例）占着 ——
 * 想留跳转页也留不了。能做的只有：端口粘住 + 两端自愈（看护带回、页面自己找人）。
 */

import { butlerRoot } from "../util/paths.ts";

/** 记忆文件名（与 config.json、logs/ 同级）。 */
const FILE = "last-port.json";

/** 一次成功用起来的端口。 */
export interface PortRecord {
  port: number;
  at: string;
}

function portFile(dir?: string): string {
  return `${dir ?? butlerRoot()}/${FILE}`;
}

/** 合法端口号；0、越界、非整数一律当"没记过"。 */
function validPort(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return null;
  return n;
}

/**
 * 端口候选顺序：首选 → 上次用起来的 → 首选 +1..+span。
 *
 * 粘住端口排在顺延前面（用户上次就在这个地址上，浏览器书签也在这儿）；
 * 超出顺延范围也照样保留 —— 那个端口"上次能用"本身就是最有力的证据。
 * 全程去重：同一个端口试两次没有意义。
 */
export function portCandidates(
  preferred: number,
  sticky: number | null,
  span: number,
): number[] {
  const out: number[] = [];
  const push = (p: number | null) => {
    if (p === null) return;
    if (out.indexOf(p) >= 0) return;
    out.push(p);
  };
  const first = validPort(preferred);
  if (first === null) return [];
  push(first);
  push(validPort(sticky));
  for (let i = 1; i <= Math.max(0, span); i++) {
    const next = first + i;
    if (next > 65535) break;
    push(next);
  }
  return out;
}

/** 读上次用起来的端口。没记过 / 记坏了 / 读不了，一律 null —— 绝不让它把启动搞挂。 */
export function readLastPort(dir?: string): number | null {
  try {
    const raw = Deno.readTextFileSync(portFile(dir));
    const j = JSON.parse(raw) as { port?: unknown } | null;
    return validPort(j?.port);
  } catch {
    return null;
  }
}

/** 记下这次真正用起来的端口（写不了就算了：粘住是锦上添花，不值得为此拒绝启动）。 */
export function rememberPort(port: number, dir?: string): void {
  const p = validPort(port);
  if (p === null) return;
  const rec: PortRecord = { port: p, at: new Date().toISOString() };
  try {
    const file = portFile(dir);
    Deno.mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(file, JSON.stringify(rec));
  } catch {
    // 目录不可写等情形：静默跳过
  }
}
