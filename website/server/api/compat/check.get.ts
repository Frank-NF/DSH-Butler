/**
 * GET /api/compat/check?plugin_id=xxx&dsh_ver=1.x
 * 兼容性预检：精确规则 > 通配规则 > 默认兼容，附带冲突清单
 */
export default defineEventHandler(async (event) => {
  const db = getDB()
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
    has_blocking_conflict: conflicts.some((c) => c.severity === 'block'),
  }
})
