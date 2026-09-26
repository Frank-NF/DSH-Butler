/**
 * GET /api/creators/ledger?authorId=xxx
 * Market V3 §5.3：创作者结算账（预留）。
 * 返回 CreatorLedger[]：按周期聚合该创作者的订单总额/平台抽成/到手。
 * 本期只读已落库订单做聚合展示，无资金结算动作。
 *
 * 安全：结算账是**收入数据**，必须登录；普通用户只能看自己的账（authorId 必须等于自己的
 * 用户 id），管理员可查任意作者。未登录 401，越权 403。
 */
import { seedBundles } from '../../utils/bundles'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const authorId = ((getQuery(event).authorId as string) || '').trim()
  if (!authorId) {
    setResponseStatus(event, 400)
    return { error: '缺少 authorId' }
  }

  const user = requireAuth(event)
  if (user.role !== 'admin' && authorId !== String(user.id)) {
    setResponseStatus(event, 403)
    return { error: '无权查看他人结算账' }
  }

  const db = getDB()
  seedBundles(db)

  // 按「月」聚合该创作者名下订单
  const rows = db
    .prepare(
      "SELECT strftime('%Y-%m', created_at) AS period, " +
      'SUM(gross_cents) AS gross, SUM(commission_cents) AS commission, ' +
      'SUM(author_cents) AS settled, COUNT(*) AS orders ' +
      'FROM bundle_orders WHERE author_id = ? AND status IN (?, ?) ' +
      "GROUP BY period ORDER BY period DESC"
    )
    .all(authorId, 'paid', 'settled') as unknown as Array<{
    period: string
    gross: number
    commission: number
    settled: number
    orders: number
  }>

  setHeader(event, 'Cache-Control', 'public, max-age=60')
  return {
    authorId,
    ledgers: rows.map((r) => ({
      authorId,
      period: r.period,
      grossCents: r.gross ?? 0,
      commissionCents: r.commission ?? 0,
      settledCents: r.settled ?? 0,
      orderCount: r.orders,
      status: 'open' as const,
    })),
    note: '预留结算账（未接资金流）',
  }
})
