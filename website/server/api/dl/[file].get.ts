/**
 * GET /api/dl/[file] —— 下载计数 + 302 跳转到 nginx 静态文件
 * 例：/api/dl/dsh-plugin-updater-1.15.0.exe → 302 /dsh-plugin-updater-1.15.0.exe
 * 仅放行版本化安装包文件名（防目录遍历/滥用）；
 * 桌面端自更新走此 URL 时 reqwest 自动跟随 302，SHA256 校验不受影响
 */
import { getDB } from '../../utils/db'
import { rateLimit } from '../../utils/rateLimit'

const ALLOWED = /^dsh-plugin-updater-\d+\.\d+\.\d+\.exe$/

export default defineEventHandler((event) => {
  const file = getRouterParam(event, 'file') || ''

  if (!ALLOWED.test(file)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  // 限频：单 IP 每分钟 10 次足够正常使用
  const ip = getHeader(event, 'x-real-ip') || getHeader(event, 'x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  if (!rateLimit(`dl:${ip}`, 60_000, 10)) {
    throw createError({ statusCode: 429, statusMessage: '请求过于频繁' })
  }

  try {
    getDB()
      .prepare(
        `INSERT INTO stats_downloads(day, file, count) VALUES(date('now'), ?, 1)
         ON CONFLICT(day, file) DO UPDATE SET count = count + 1`
      )
      .run(file)
  } catch {
    // 统计失败不阻塞下载
  }

  return sendRedirect(event, `/${file}`, 302)
})
