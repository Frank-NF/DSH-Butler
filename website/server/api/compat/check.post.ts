/**
 * GET /api/compat/check?plugin_id=xxx&dsh_version=1.x
 * 兼容性预检
 * POST /api/compat/check - Admin 维护规则
 * DELETE /api/compat/check?plugin_id=xxx&dsh_version=xxx - Admin 删除规则
 */
import { getDB, migrate } from '~/server/utils/db'
import { getAuthUser } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const db = getDB()
  const method = event.method

  if (method === 'GET') {
    const query = getQuery(event)
    const pluginId = query.plugin_id as string | undefined
    const dshVer = (query.dsh_ver as string | undefined) || '*'
    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }

    const exact = db
      .prepare('SELECT * FROM plugin_compat WHERE plugin_id = ? AND dsh_version = ?')
      .get(pluginId, dshVer)
    const wildcard = db
      .prepare("SELECT * FROM plugin_compat WHERE plugin_id = ? AND dsh_version = '*'")
      .get(pluginId)
    const rule = exact || wildcard

    const conflicts = db
      .prepare('SELECT conflict_with, reason, severity FROM plugin_conflicts WHERE plugin_id = ?')
      .all(pluginId)

    return {
      plugin_id: pluginId,
      dsh_version: dshVer,
      compatible: rule ? !!rule.compatible : true,
      note: rule?.note || null,
      conflicts,
      has_blocking_conflict: conflicts.some((c: any) => c.severity === 'block'),
    }
  }

  if (method === 'DELETE') {
    const user = getAuthUser(event)
    if (!user || user.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: '需要管理员权限' })
    }
    const query = getQuery(event)
    const pluginId = query.plugin_id as string
    const dshVersion = (query.dsh_version as string) || '*'
    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }
    db.prepare('DELETE FROM plugin_compat WHERE plugin_id = ? AND dsh_version = ?').run(pluginId, dshVersion)
    return { ok: true }
  }

  if (method === 'POST') {
    const user = getAuthUser(event)
    if (!user || user.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: '需要管理员权限' })
    }
    const body = await readBody(event)
    const pluginId = body.plugin_id?.trim()
    const dshVersion = body.dsh_version?.trim() || '*'
    if (!pluginId) {
      throw createError({ statusCode: 400, statusMessage: '缺少 plugin_id' })
    }
    db.prepare(
      `INSERT INTO plugin_compat (plugin_id, dsh_version, compatible, note, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(plugin_id, dsh_version) DO UPDATE SET
         compatible = excluded.compatible,
         note = excluded.note,
         updated_at = datetime('now')`
    ).run(pluginId, dshVersion, body.compatible === false ? 0 : 1, body.note?.trim() || null)
    return { ok: true }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
})
