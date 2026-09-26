/**
 * GET /api/stats/overview —— 站点统计总览（仅 admin 可见）
 * 返回：近 30 天页面浏览/下载/活跃安装趋势 + 汇总数字
 */
import { getDB } from '../../utils/db'
import { requireAuth } from '../../utils/auth'

interface TrendRow {
  day: string
  n: number
}

function trend(db: ReturnType<typeof getDB>, table: string, col: string, days: number): TrendRow[] {
  // 表名/列名来自代码内常量白名单，非用户输入
  const rows = db
    .prepare(
      `SELECT day, SUM(${col}) AS n FROM ${table}
       WHERE day >= date('now', ?) GROUP BY day ORDER BY day`
    )
    .all(`-${days} days`) as TrendRow[]
  return rows
}

export default defineEventHandler((event) => {
  const user = requireAuth(event)
  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: '需要管理员权限' })
  }

  const db = getDB()
  const DAYS = 30

  const pageViews = trend(db, 'stats_page_views', 'views', DAYS)
  const downloads = trend(db, 'stats_downloads', 'count', DAYS)

  // 活跃安装：按日去重 install_id；总安装量：全表去重
  const activeInstalls = db
    .prepare(
      `SELECT day, COUNT(DISTINCT install_id) AS n FROM stats_app_pings
       WHERE day >= date('now', ?) GROUP BY day ORDER BY day`
    )
    .all(`-${DAYS} days`) as TrendRow[]
  const totalInstalls = (
    db.prepare('SELECT COUNT(DISTINCT install_id) AS n FROM stats_app_pings').get() as { n: number }
  ).n

  const sum = (rows: TrendRow[]) => rows.reduce((s, r) => s + (r.n || 0), 0)

  // 热门页面 Top 10（30 天）
  const topPages = db
    .prepare(
      `SELECT path, SUM(views) AS n FROM stats_page_views
       WHERE day >= date('now', ?) GROUP BY path ORDER BY n DESC LIMIT 10`
    )
    .all(`-${DAYS} days`) as { path: string; n: number }[]

  return {
    window_days: DAYS,
    totals: {
      page_views: sum(pageViews),
      downloads: sum(downloads),
      active_installs: totalInstalls,
    },
    trends: {
      page_views: pageViews,
      downloads,
      active_installs: activeInstalls,
    },
    top_pages: topPages,
  }
})
