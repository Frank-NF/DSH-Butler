/**
 * GET    /api/comments?plugin_id=xxx   评论列表（含用户昵称头像，分页）
 * POST   /api/comments                 发表评论 { plugin_id, content }（需登录）
 * DELETE /api/comments?id=xxx          删除自己的评论（需登录）
 */
export default defineEventHandler(async (event) => {
  const db = getDB()
  const method = event.method

  if (method === 'GET') {
    const query = getQuery(event)
    const pluginId = query.plugin_id as string | undefined
    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = 20

    const total = (
      db
        .prepare('SELECT COUNT(*) AS c FROM comments WHERE plugin_id = ? AND deleted = 0')
        .get(pluginId) as { c: number }
    ).c

    const rows = db
      .prepare(
        `SELECT c.id, c.content, c.created_at, c.user_id,
                u.display_name, u.avatar_url, u.role
         FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.plugin_id = ? AND c.deleted = 0
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(pluginId, pageSize, (page - 1) * pageSize)

    return {
      total,
      page,
      page_size: pageSize,
      comments: rows,
    }
  }

  if (method === 'POST') {
    const user = requireAuth(event)
    const body = await readBody<{ plugin_id?: string; content?: string }>(event)
    const pluginId = body.plugin_id?.trim()
    const content = body.content?.trim()

    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }
    if (!content) {
      throw createError({ statusCode: 400, statusMessage: '评论内容不能为空' })
    }
    if (content.length > 1000) {
      throw createError({ statusCode: 400, statusMessage: '评论最多 1000 字' })
    }

    // 简单限频：同一用户 30 秒内只能发一条
    const recent = db
      .prepare(
        `SELECT 1 FROM comments WHERE user_id = ? AND created_at > datetime('now', '-30 seconds')`
      )
      .get(user.id)
    if (recent) {
      throw createError({ statusCode: 429, statusMessage: '发布太频繁，稍后再试' })
    }

    const result = db
      .prepare('INSERT INTO comments (user_id, plugin_id, content) VALUES (?, ?, ?)')
      .run(user.id, pluginId, content)

    return {
      ok: true,
      comment: {
        id: Number(result.lastInsertRowid),
        content,
        created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        user_id: user.id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role,
      },
    }
  }

  if (method === 'DELETE') {
    const user = requireAuth(event)
    const query = getQuery(event)
    const id = Number(query.id)
    if (!id) {
      throw createError({ statusCode: 400, statusMessage: '缺少评论 id' })
    }

    const row = db
      .prepare('SELECT user_id FROM comments WHERE id = ? AND deleted = 0')
      .get(id) as { user_id: number } | undefined
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: '评论不存在' })
    }
    if (row.user_id !== user.id && user.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: '只能删除自己的评论' })
    }

    db.prepare('UPDATE comments SET deleted = 1 WHERE id = ?').run(id)
    return { ok: true }
  }

  throw createError({ statusCode: 405 })
})
