/**
 * POST /api/bundles/pricing
 * Market V3 §5.3：预留计费设置（本期只存档不触发支付）。
 * body { id, pricing: { hasPaidItems, packagePriceCents, cycle, commissionRate, channel } }
 * 仅管理员可操作。
 */
import { requireAuth } from '../../utils/auth'
import { seedBundles } from '../../utils/bundles'

interface PricingReq {
  id: string
  pricing: {
    hasPaidItems?: boolean
    packagePriceCents?: number | null
    cycle?: 'free' | 'month' | 'year' | 'once'
    commissionRate?: number | null
    channel?: 'wechat' | 'alipay' | null
  }
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: '仅支持 POST' })
  }
  const admin = requireAuth(event)
  if (admin.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: '需管理员权限' })
  }

  const body = await readBody<PricingReq>(event)
  if (!body?.id) {
    throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  }

  const db = getDB()
  seedBundles(db)

  db.prepare(
    'UPDATE bundles SET package_price_cents = ?, commission_rate = ?, pay_channel = ? WHERE id = ?'
  ).run(
    body.pricing?.packagePriceCents ?? null,
    body.pricing?.commissionRate ?? null,
    body.pricing?.channel ?? null,
    body.id
  )

  return {
    ok: true,
    id: body.id,
    note: '计费已存档（预留态，未接资金流）',
  }
})
