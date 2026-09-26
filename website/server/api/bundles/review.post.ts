/**
 * POST /api/bundles/review
 * Market V3 §5：平台审核组合包。body { id, status: 'reviewed'|'rejected', note? }
 * 仅管理员（role=admin）可操作。
 */
import { requireAuth } from '../../utils/auth'
import { seedBundles } from '../../utils/bundles'

interface ReviewReq {
  id: string
  status: 'reviewed' | 'rejected'
  note?: string
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: '仅支持 POST' })
  }
  const admin = requireAuth(event)
  if (admin.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: '需管理员权限' })
  }

  const body = await readBody<ReviewReq>(event)
  if (!body?.id || !['reviewed', 'rejected'].includes(body.status)) {
    throw createError({ statusCode: 400, statusMessage: '参数缺失或非法' })
  }

  const db = getDB()
  seedBundles(db)

  const row = db.prepare('SELECT id, review_status FROM bundles WHERE id = ?').get(body.id) as
    | { id: string; review_status: string }
    | undefined
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '组合包不存在' })
  }

  db.prepare('UPDATE bundles SET review_status = ? WHERE id = ?').run(body.status, body.id)

  return { ok: true, id: body.id, reviewStatus: body.status, note: body.note ?? null }
})
