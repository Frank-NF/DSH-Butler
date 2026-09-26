/**
 * POST /api/shares   记录分享行为 { plugin_id, channel? }（登录与否均可，登录则关联用户）
 * GET  /api/shares?plugin_id=xxx   查询某插件的分享次数
 */
export default defineEventHandler(async (event) => {
  const db = getDB()
  const method = event.method

  if (method === 'GET') {
    const pluginId = getQuery(event).plugin_id as string | undefined
    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM shares WHERE plugin_id = ?')
      .get(pluginId) as { c: number }
    return { share_count: row.c }
  }

  if (method === 'POST') {
    const user = getAuthUser(event)
    const body = await readBody<{ plugin_id?: string; channel?: string }>(event)
    const pluginId = body.plugin_id?.trim()
    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }
    db.prepare('INSERT INTO shares (user_id, plugin_id, channel) VALUES (?, ?, ?)').run(
      user?.id ?? null,
      pluginId,
      body.channel?.slice(0, 30) || null
    )
    return { ok: true }
  }

  throw createError({ statusCode: 405 })
})
