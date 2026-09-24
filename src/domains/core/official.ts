/**
 * 复用 DSH 官方脚本做校验，而不是自己复刻算法。
 *
 * 为什么这么做（这是本模块存在的唯一理由）：
 *   "产物是否完整、是否就是当前源码构建出来的"，官方定义在
 *   <dshRoot>/scripts/client-build-environment.ts 里 —— 它规定了产物集合
 *   （apps/web/dist/** + 各包 lib/client*.js(.map)）以及摘要算法
 *   （按路径排序后，逐个 update "路径长度:路径内容长度:内容"）。
 *   自己复刻一份的结局必然是【慢慢漂移】：官方改一次产物集合或算法，
 *   我们就会拿着一份过时的判据给出错误结论，而错误结论比不给结论更糟。
 *
 *   DSH 的这个脚本本身就是 TypeScript，而 Deno 原生能执行 TS，
 *   所以可以直接 import 它的 readClientBuildRecord —— 那是 DSH 启动前
 *   自己做的同一个校验。同样的思路也是项目里既有的铁律：
 *   重建必须走官方 pnpm run build，不要自己拼 tsc/tsdown。
 *
 * 失败安全：动态 import 与调用各自独立 try/catch。
 *   - 加载不了官方模块（本体没有这个脚本 / 未来版本改名或改签名）
 *     → official=false，只当"无法校验"，降级为提示，绝不算错误
 *   - 官方模块加载成功但判定不一致
 *     → official=true, verified=false，这才是真错误
 *   两种情况的处理必须分开，否则升级一次 DSH 就会满屏假报警。
 */

import { pathToFileURL } from "node:url";
import { isFile } from "../../host/fs.ts";
import { p } from "../../util/paths.ts";
import { log } from "../../util/log.ts";

/** 官方校验脚本相对本体根的路径。 */
const OFFICIAL_MODULE_REL = "scripts/client-build-environment.ts";

export interface BuildIntegrity {
  /** 是否成功调用了官方校验。false = 无法校验（不等于失败）。 */
  official: boolean;
  /** 官方判定产物与构建记录一致。 */
  verified: boolean;
  /** 产物文件数（官方口径）。 */
  fileCount: number | null;
  /** 产物摘要（官方口径）。 */
  sha256: string | null;
  /** 构建记录里的公开环境变量（DSH_CLIENT_*）。 */
  environment: Record<string, string>;
  /** 失败原因（保留官方原始消息，不要改写，以免丢失定位线索）。 */
  error: string | null;
  /** 官方脚本路径，便于在界面上解释"凭什么这么判"。 */
  modulePath: string | null;
}

interface OfficialModule {
  readClientBuildRecord(root: string): {
    formatVersion: number;
    environment: Record<string, string>;
    artifacts: { fileCount: number; sha256: string };
  };
}

const UNVERIFIABLE = (error: string, modulePath: string | null): BuildIntegrity => ({
  official: false,
  verified: false,
  fileCount: null,
  sha256: null,
  environment: {},
  error,
  modulePath,
});

/** 同一进程内缓存结果，避免每次状态刷新都重新编译一遍官方脚本。 */
let cache: { at: number; key: string; value: BuildIntegrity } | null = null;
const CACHE_TTL_MS = 15_000;

/**
 * 校验本体产物的完整性（走官方算法）。
 * @param root - 本体源码根目录。
 * @param opts.fresh - 忽略缓存，强制重新校验（重建之后必须用）。
 */
export async function verifyBuildIntegrity(
  root: string,
  opts: { fresh?: boolean } = {},
): Promise<BuildIntegrity> {
  const modulePath = p(root, OFFICIAL_MODULE_REL);

  if (!isFile(modulePath)) {
    return UNVERIFIABLE(
      `本体里没有找到官方校验脚本 ${OFFICIAL_MODULE_REL}（该版本可能尚未提供，或不是完整源码树）`,
      null,
    );
  }

  const now = Date.now();
  if (!opts.fresh && cache && cache.key === root && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  // 第一步：只负责加载。加载失败属于"环境不支持"，不是"产物有问题"。
  let mod: OfficialModule;
  try {
    mod = (await import(pathToFileURL(modulePath).href)) as OfficialModule;
  } catch (e) {
    const msg = (e as Error).message;
    log.warn("official", `无法加载官方校验脚本：${msg}`);
    const value = UNVERIFIABLE(`无法加载官方校验脚本：${msg}`, modulePath);
    cache = { at: now, key: root, value };
    return value;
  }

  // 第二步：官方判据。这里抛错就意味着产物真的对不上（或记录本身坏了）。
  try {
    const rec = mod.readClientBuildRecord(root);
    const value: BuildIntegrity = {
      official: true,
      verified: true,
      fileCount: rec.artifacts.fileCount,
      sha256: rec.artifacts.sha256,
      environment: rec.environment ?? {},
      error: null,
      modulePath,
    };
    cache = { at: now, key: root, value };
    return value;
  } catch (e) {
    const msg = (e as Error).message;
    const value: BuildIntegrity = {
      official: true,
      verified: false,
      fileCount: null,
      sha256: null,
      environment: {},
      error: msg,
      modulePath,
    };
    cache = { at: now, key: root, value };
    return value;
  }
}

/** 清缓存（重建完成后必须调用，否则会拿到旧结论）。 */
export function invalidateBuildIntegrityCache(): void {
  cache = null;
}
