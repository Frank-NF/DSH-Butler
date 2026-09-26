/**
 * 插件冲突知识库
 * GET    /api/conflicts?plugin_id=xxx   某插件冲突清单（公开）
 * GET    /api/conflicts                 全量冲突清单（公开）
 * POST   /api/conflicts                 Admin 新增/更新 { plugin_id, conflict_with, reason, severity }
 * DELETE /api/conflicts?id=xxx          Admin 删除
 */
export default defineEventHandler(async (event) => {
  const db = getDB()
  const method = event.method

  if (method === 'GET') {
    const query = getQuery(event)
    const pluginId = query.plugin_id as string | undefined
    if (pluginId) {
      return {
        plugin_id: pluginId,
        conflicts: db
          .prepare('SELECT conflict_with, reason, severity FROM plugin_conflicts WHERE plugin_id = ?')
          .all(pluginId),
      }
    }
    return {
      conflicts: db
        .prepare('SELECT plugin_id, conflict_with, reason, severity FROM plugin_conflicts ORDER BY plugin_id')
        .all(),
    }
  }

  const user = getAuthUser(event)
  if (!user || user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: '需要管理员权限' })
  }

  if (method === 'POST') {
    const body = await readBody<{ plugin_id?: string; conflict_with?: string; reason?: string; severity?: string }>(event)
    const pluginId = body.plugin_id?.trim()
    const conflictWith = body.conflict_with?.trim()
    if (!pluginId || !conflictWith) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id 或 conflict_with' })
    }
    db.prepare(
      `INSERT INTO plugin_conflicts (plugin_id, conflict_with, reason, severity, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(plugin_id, conflict_with) DO UPDATE SET
         reason = excluded.reason,
         severity = excluded.severity,
         updated_at = datetime('now')`
    ).run(pluginId, conflictWith, body.reason?.trim() || null, body.severity === 'block' ? 'block' : 'warn')
    return { ok: true }
  }

  if (method === 'DELETE') {
    const query = getQuery(event)
    const id = Number(query.id)
    if (!id) {
      throw createError({ statusCode: 400, statusMessage: '缺少冲突 id' })
    }
    db.prepare('DELETE FROM plugin_conflicts WHERE id = ?').run(id)
    return { ok: true }
  }

  throw createError({ statusCode: 405 })
})
