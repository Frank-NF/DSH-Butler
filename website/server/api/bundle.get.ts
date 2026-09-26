/**
 * GET /api/bundle?id=xxx
 * 组合包详情（查询参数风格，规避 Nuxt [id] 路由已知坑，见 V2 §4 / F4）
 */
import { seedBundles, buildBundle, type BundleRow } from '../utils/bundles'

export default defineEventHandler(async (event) => {
  const id = ((getQuery(event).id as string) || '').trim()
  if (!id) {
    setResponseStatus(event, 400)
    return { error: '缺少 id 查询参数' }
  }

  const db = getDB()
  seedBundles(db)

  const row = db.prepare('SELECT * FROM bundles WHERE id = ?').get(id) as unknown as
    | BundleRow
    | undefined
  if (!row) {
    setResponseStatus(event, 404)
    return { error: '组合包不存在' }
  }

  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return buildBundle(db, row)
})
