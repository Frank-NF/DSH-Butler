/**
 * GET /api/bundles/compat/check?id=<bundle_id>&installed=a,b,c
 * 组合包整包预检（V2 §8 P1）：一次返回组合包内全部插件的兼容性与冲突结果。
 * installed 为客户端当前已安装的插件 id 列表（逗号分隔），用于冲突匹配。
 * 知识库复用 plugin_compat + plugin_conflicts；不传 id 返回 400，未知 id 返回 404。
 */
export default defineEventHandler(async (event) => {
  const db = getDB()
  const query = getQuery(event)
  const bundleId = query.id as string | undefined
  const installedRaw = (query.installed as string | undefined) || ''
  if (!bundleId) {
    throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  }

  const bundle = db.prepare('SELECT id FROM bundles WHERE id = ?').get(bundleId)
  if (!bundle) {
    throw createError({ statusCode: 404, statusMessage: '组合包不存在' })
  }

  const installedSet = new Set(
    installedRaw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )

  const plugins = db
    .prepare('SELECT plugin_ref, required FROM bundle_plugins WHERE bundle_id = ? ORDER BY plugin_ref')
    .all(bundleId) as unknown as { plugin_ref: string; required: number }[]

  // dsh_version 相关兼容规则由客户端单插件预检链路覆盖，此处只查通配规则
  const stmtCompatWildcard = db.prepare(
    "SELECT compatible, note FROM plugin_compat WHERE plugin_id = ? AND dsh_version = '*'"
  )
  const stmtConflicts = db.prepare(
    'SELECT conflict_with, reason, severity FROM plugin_conflicts WHERE plugin_id = ?'
  )

  const items = plugins.map((p) => {
    const ref = p.plugin_ref
    const rule = stmtCompatWildcard.get(ref)
    const allConflicts = stmtConflicts.all(ref) as unknown as {
      conflict_with: string
      reason: string | null
      severity: string | null
    }[]
    const conflicts = allConflicts.filter((c) =>
      installedSet.has(c.conflict_with.toLowerCase())
    )
    return {
      plugin_ref: ref,
      required: !!p.required,
      compatible: rule ? !!rule.compatible : true,
      note: rule?.note || null,
      conflicts,
      has_blocking_conflict: conflicts.some((c) => c.severity === 'block'),
    }
  })

  return {
    bundle_id: bundleId,
    items,
    has_blocking_conflict: items.some((i) => i.has_blocking_conflict),
    all_compatible: items.every((i) => i.compatible),
  }
})
