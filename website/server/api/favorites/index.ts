/**
 * GET    /api/favorites?plugin_id=xxx   查询当前用户是否收藏了某插件
 * GET    /api/favorites                 当前用户收藏列表（含插件互动计数）
 * POST   /api/favorites                 收藏 { plugin_id }
 * DELETE /api/favorites                 取消收藏 { plugin_id }
 */
export default defineEventHandler(async (event) => {
  const db = getDB()
  const method = event.method

  // 收藏列表 / 状态查询允许未登录（返回空）
  if (method === 'GET') {
    const user = getAuthUser(event)
    if (!user) return { favorites: [], favorited: [] }

    const query = getQuery(event)
    if (query.plugin_id) {
      const row = db
        .prepare('SELECT 1 FROM favorites WHERE user_id = ? AND plugin_id = ?')
        .get(user.id, query.plugin_id)
      return { favorited: !!row }
    }

    const rows = db
      .prepare(
        `SELECT f.plugin_id, f.created_at,
                (SELECT COUNT(*) FROM favorites WHERE plugin_id = f.plugin_id) AS favorite_count,
                (SELECT COUNT(*) FROM comments WHERE plugin_id = f.plugin_id AND deleted = 0) AS comment_count
         FROM favorites f WHERE f.user_id = ? ORDER BY f.created_at DESC`
      )
      .all(user.id)
    return { favorites: rows }
  }

  // 写操作必须登录
  const user = requireAuth(event)
  const body = await readBody<{ plugin_id?: string }>(event)
  const pluginId = body.plugin_id?.trim()
  if (!pluginId) {
    throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
  }

  if (method === 'POST') {
    try {
      db.prepare('INSERT INTO favorites (user_id, plugin_id) VALUES (?, ?)').run(
        user.id,
        pluginId
      )
    } catch {
      // UNIQUE 冲突 = 已收藏，幂等处理
    }
    const count = countFavorites(db, pluginId)
    return { ok: true, favorited: true, favorite_count: count }
  }

  if (method === 'DELETE') {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND plugin_id = ?').run(
      user.id,
      pluginId
    )
    return { ok: true, favorited: false, favorite_count: countFavorites(db, pluginId) }
  }

  throw createError({ statusCode: 405 })
})

function countFavorites(db: any, pluginId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM favorites WHERE plugin_id = ?')
    .get(pluginId) as { c: number }
  return row.c
}
