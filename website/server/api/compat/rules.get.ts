/**
 * GET /api/compat/rules
 * 列出所有兼容规则（公开，用于前端管理界面）
 */
export default defineEventHandler(async () => {
  const db = getDB()
  return db.prepare('SELECT * FROM plugin_compat ORDER BY plugin_id, dsh_version').all()
})
