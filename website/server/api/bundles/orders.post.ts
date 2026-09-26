/**
 * POST /api/bundles/orders
 * Market V3 §5.3：预留下单（本期只建单不落资金流，status='created'）。
 * 入参：{ bundleId, buyerId, channel? }
 * 生成 BundleOrder（含 commissionCents = gross * commissionRate），写 bundle_orders。
 */
import { getAuthUser } from '../../utils/auth'
import { seedBundles } from '../../utils/bundles'

interface OrderReq {
  bundleId: string
  buyerId?: string
  channel?: 'wechat' | 'alipay' | string
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: '仅支持 POST' })
  }
  const user = getAuthUser(event)
  const body = await readBody<OrderReq>(event)
  if (!body?.bundleId) {
    throw createError({ statusCode: 400, statusMessage: '缺少 bundleId' })
  }

  const db = getDB()
  seedBundles(db)

  const b = db
    .prepare('SELECT id, author_id, package_price_cents, commission_rate, pay_channel FROM bundles WHERE id = ?')
    .get(body.bundleId) as unknown as
    | { id: string; author_id: string | null; package_price_cents: number | null; commission_rate: number | null; pay_channel: string | null }
    | undefined
  if (!b) {
    throw createError({ statusCode: 404, statusMessage: '组合包不存在' })
  }

  const grossCents = b.package_price_cents ?? 0
  const commissionRate = b.commission_rate ?? 0
  const commissionCents = Math.round(grossCents * commissionRate)
  const authorCents = grossCents - commissionCents

  const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  db.prepare(
    'INSERT INTO bundle_orders (order_id, bundle_id, buyer_id, author_id, gross_cents, commission_cents, author_cents, status, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    orderId,
    b.id,
    body.buyerId ?? String(user?.id ?? 'anonymous'),
    b.author_id ?? null,
    grossCents,
    commissionCents,
    authorCents,
    'created',
    new Date().toISOString()
  )

  return {
    ok: true,
    order: {
      orderId,
      bundleId: b.id,
      grossCents,
      commissionCents,
      authorCents,
      status: 'created',
      channel: body.channel ?? b.pay_channel ?? null,
    },
    note: '订单已创建（预留态，资金流未开通）',
  }
})
