/**
 * 验收脚本共用的常量与工具。
 *
 * 刻意与 src/ 分开：scripts/ 里放的是"验证与运维"用的东西，
 * 不进桌面产物（deno desktop 只打包 src/main.ts 可达的模块）。
 */

/** DSH 源码树的候选根目录（与 src/util/paths.ts 的探测顺序保持一致）。 */
export const DSH_ROOT_CANDIDATES = [
  (Deno.env.get("USERPROFILE") ?? "") + "\\DeepSeek_Harness",
  "G:\\DeepSeek_Harness",
  "D:\\DeepSeek_Harness",
  "E:\\DeepSeek_Harness",
].filter((s) => s.length > 16);
