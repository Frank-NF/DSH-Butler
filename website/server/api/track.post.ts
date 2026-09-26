/**
 * POST /api/track —— 自建轻量统计打点
 * body: { kind: 'page' | 'app', path?: string, version?: string, install_id?: string }
 * - page: 页面浏览（日+路径聚合计数）
 * - app:  桌面端启动 ping（日+匿名安装 id 去重，用于活跃安装量）
 * 隐私：不记录 IP 原文、不记录任何个人数据；install_id 为客户端本地随机生成、可关闭
 * 下载计数走 GET /api/dl/[file]（真实下载完成量），不在此端点
 */
import { getDB } from '../utils/db'
import { rateLimit } from '../utils/rateLimit'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 尽力读取客户端 IP（限频用，不入库）：Nginx 注入的 X-Real-IP 优先 */
function clientKey(event: Parameters<typeof getHeader>[0]): string {
  const real = getHeader(event, 'x-real-ip')
  if (real) return real
  const xff = getHeader(event, 'x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return 'unknown'
}

export default defineEventHandler(async (event) => {
  if (!rateLimit(`track:${clientKey(event)}`, 60_000, 30)) {
    throw createError({ statusCode: 429, statusMessage: '请求过于频繁' })
  }

  const body = await readBody<Record<string, unknown>>(event).catch(() => null)
  if (!body) throw createError({ statusCode: 400, statusMessage: '参数无效' })

  const kind = String(body.kind || '')
  const db = getDB()
  const day = today()

  if (kind === 'page') {
    // 路径白名单化：只收站内路径，截断防滥用
    const raw = String(body.path || '/')
    const path = raw.startsWith('/') ? raw.slice(0, 200) : '/'
    db.prepare(
      `INSERT INTO stats_page_views(day, path, views) VALUES(?, ?, 1)
       ON CONFLICT(day, path) DO UPDATE SET views = views + 1`
    ).run(day, path)
    return { ok: true }
  }

  if (kind === 'app') {
    // 匿名安装 id：客户端本地生成的随机 UUID（v4 格式校验放宽为长度+字符集）
    const installId = String(body.install_id || '')
    if (!/^[a-f0-9-]{8,64}$/i.test(installId)) {
      throw createError({ statusCode: 400, statusMessage: 'install_id 无效' })
    }
    const version = String(body.version || '').slice(0, 32)
    db.prepare(
      `INSERT INTO stats_app_pings(day, install_id, version) VALUES(?, ?, ?)
       ON CONFLICT(day, install_id) DO NOTHING`
    ).run(day, installId, version)
    return { ok: true }
  }

  throw createError({ statusCode: 400, statusMessage: 'kind 必须是 page 或 app' })
})
