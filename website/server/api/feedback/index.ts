/**
 * 插件反馈 API
 *
 * POST /api/feedback                   提交反馈（游客可提交，限频 60s/IP）
 *   body: { plugin_id, plugin_name, type, content, contact? }
 *   type: bug | suggestion | experience | question | other
 *
 * GET /api/feedback?plugin_id=xxx      某插件的公开反馈列表（已解决/已处理 + 最新，分页）
 * GET /api/feedback?all=1&status=open  管理员全量列表（需 admin 角色）
 *
 * PATCH /api/feedback?id=xxx           更新状态（open/processing/resolved/closed；提交者或 admin）
 *   body: { status }
 */
import { createHash } from 'node:crypto'

const FEEDBACK_TYPES = ['bug', 'suggestion', 'experience', 'question', 'other'] as const
const FEEDBACK_STATUS = ['open', 'processing', 'resolved', 'closed'] as const
const RATE_LIMIT_SECONDS = 60

function clientIp(event: any): string {
  return (
    getHeader(event, 'x-forwarded-for')?.split(',')[0].trim() ||
    getHeader(event, 'x-real-ip') ||
    'unknown'
  )
}

function hashIp(ip: string): string {
  return createHash('sha256').update('dsh-fb:' + ip).digest('hex').slice(0, 16)
}

export default defineEventHandler(async (event) => {
  const db = getDB()
  const method = event.method

  /* ============ GET：列表 ============ */
  if (method === 'GET') {
    const query = getQuery(event)

    // 管理员全量列表
    if (query.all === '1') {
      const user = getAuthUser(event)
      if (!user || user.role !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: '需要管理员权限' })
      }
      const status = query.status as string | undefined
      const page = Math.max(1, Number(query.page) || 1)
      const pageSize = 50

      let where = 'WHERE 1=1'
      const params: any[] = []
      if (status && FEEDBACK_STATUS.includes(status as any)) {
        where += ' AND f.status = ?'
        params.push(status)
      }
      if (query.plugin_id) {
        where += ' AND f.plugin_id = ?'
        params.push(query.plugin_id)
      }

      const total = (
        db.prepare(`SELECT COUNT(*) AS c FROM feedback f ${where}`).get(...params) as { c: number }
      ).c

      const rows = db
        .prepare(
          `SELECT f.id, f.plugin_id, f.plugin_name, f.type, f.content, f.contact,
                  f.status, f.created_at, f.updated_at,
                  u.display_name, u.avatar_url
           FROM feedback f
           LEFT JOIN users u ON u.id = f.user_id
           ${where}
           ORDER BY f.created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, pageSize, (page - 1) * pageSize)

      return { total, page, page_size: pageSize, feedback: rows }
    }

    // 某插件的公开反馈列表（脱敏）
    const pluginId = query.plugin_id as string | undefined
    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = 10

    const total = (
      db
        .prepare("SELECT COUNT(*) AS c FROM feedback WHERE plugin_id = ? AND status IN ('resolved', 'processing')")
        .get(pluginId) as { c: number }
    ).c

    const rows = db
      .prepare(
        `SELECT id, plugin_id, plugin_name, type, content,
                status, created_at,
                CASE WHEN contact IS NULL OR contact = '' THEN NULL ELSE '已提供联系方式' END AS has_contact
         FROM feedback
         WHERE plugin_id = ? AND status IN ('resolved', 'processing')
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(pluginId, pageSize, (page - 1) * pageSize)

    return { total, page, page_size: pageSize, feedback: rows }
  }

  /* ============ POST：提交反馈 ============ */
  if (method === 'POST') {
    const body = await readBody<{
      plugin_id?: string
      plugin_name?: string
      type?: string
      content?: string
      contact?: string
    }>(event)

    const pluginId = body.plugin_id?.trim()
    const content = body.content?.trim()
    const type = body.type as (typeof FEEDBACK_TYPES)[number]

    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少插件标识' })
    }
    if (!FEEDBACK_TYPES.includes(type)) {
      throw createError({ statusCode: 400, statusMessage: '反馈类型无效' })
    }
    if (!content) {
      throw createError({ statusCode: 400, statusMessage: '反馈内容不能为空' })
    }
    if (content.length < 5) {
      throw createError({ statusCode: 400, statusMessage: '反馈内容至少 5 个字' })
    }
    if (content.length > 2000) {
      throw createError({ statusCode: 400, statusMessage: '反馈内容最多 2000 字' })
    }
    const contact = body.contact?.trim().slice(0, 200) || null

    const user = getAuthUser(event)
    const ip = clientIp(event)
    const ipHash = user ? null : hashIp(ip)

    // 限频：同 IP 或同用户 60 秒内只能提交一条
    const recent = user
      ? db
          .prepare(
            `SELECT 1 FROM feedback WHERE user_id = ? AND created_at > datetime('now', '-60 seconds')`
          )
          .get(user.id)
      : db
          .prepare(
            `SELECT 1 FROM feedback WHERE ip_hash = ? AND created_at > datetime('now', '-60 seconds')`
          )
          .get(ipHash)
    if (recent) {
      throw createError({ statusCode: 429, statusMessage: '提交太频繁，请稍后再试' })
    }

    const result = db
      .prepare(
        `INSERT INTO feedback (plugin_id, plugin_name, type, content, contact, user_id, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(pluginId, body.plugin_name?.trim()?.slice(0, 200) || '', type, content, contact, user?.id ?? null, ipHash)

    return {
      ok: true,
      feedback: {
        id: Number(result.lastInsertRowid),
        plugin_id: pluginId,
        type,
        content,
        status: 'open',
        created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      },
    }
  }

  /* ============ PATCH：更新状态 ============ */
  if (method === 'PATCH') {
    const query = getQuery(event)
    const id = Number(query.id)
    if (!id) {
      throw createError({ statusCode: 400, statusMessage: '缺少反馈 id' })
    }
    const body = await readBody<{ status?: string }>(event)
    const status = body.status as (typeof FEEDBACK_STATUS)[number]
    if (!FEEDBACK_STATUS.includes(status)) {
      throw createError({ statusCode: 400, statusMessage: '状态无效' })
    }

    const row = db.prepare('SELECT id, user_id FROM feedback WHERE id = ?').get(id) as
      | { id: number; user_id: number | null }
      | undefined
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: '反馈不存在' })
    }

    const user = getAuthUser(event)
    if (!user) {
      throw createError({ statusCode: 401, statusMessage: '请先登录' })
    }
    if (row.user_id !== user.id && user.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: '无权操作此反馈' })
    }

    db.prepare(`UPDATE feedback SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id)
    return { ok: true }
  }

  throw createError({ statusCode: 405 })
})
