/**
 * GET /api/health
 * 健康检查（负载均衡/监控/状态看板用）
 * 返回：服务状态、数据库状态、数据源同步时间、uptime
 */
import { getDB } from '~/server/utils/db'

const startedAt = Date.now()

export default defineEventHandler(async () => {
  let dbOk = false
  let dbError: string | null = null
  try {
    const db = getDB()
    db.prepare('SELECT 1').get()
    dbOk = true
  } catch (e: any) {
    dbError = e?.message || String(e)
  }

  let pluginsOk = false
  let pluginsTotal = 0
  try {
    const plugins = await getPlugins()
    pluginsTotal = plugins.length
    pluginsOk = pluginsTotal > 0
  } catch {
    /* 数据源不可用 */
  }

  const status = dbOk && pluginsOk ? 'ok' : 'degraded'

  return {
    status,
    service: 'dsh-website',
    version: '1.0.0',
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    db: { ok: dbOk, error: dbError },
    data_source: { ok: pluginsOk, total_plugins: pluginsTotal },
    timestamp: new Date().toISOString(),
  }
})
