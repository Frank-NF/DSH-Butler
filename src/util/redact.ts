/**
 * 敏感信息脱敏。【安全 · 2026-09-25 审计 SEC-10】
 *
 * 日志导出会把日志全文写到下载目录，而 DSH 的进程访问令牌正是从 dsh-server-*.out.log 里
 * 捞出来的（见 src/domains/runtime/dsh-url.ts）。健康报告早就有这套正则，导出却没有 ——
 * 这里收敛成一个共用实现，两处都走它，避免再漂移。
 */

const SECRET_RE = /(token|secret|password|passwd|key)\s*[=:]\s*\S+/gi;

export function maskSecrets(text: string): string {
  return text.replace(SECRET_RE, "$1=***");
}
