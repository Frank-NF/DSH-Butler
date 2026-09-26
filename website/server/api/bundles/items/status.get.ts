/**
 * GET /api/bundles/items/status?bundleId=xxx
 * Market V3 §2：组合包内单项安装态（供前端渲染每项「安装/已安装/更新」按钮）。
 * 返回 { bundleId, items: [{ itemType, itemRef, installed, currentVersion, latestVersion, billing }] }
 *
 * installed 判据：桌面端已装列表经前端同步写入（占位实现：按 bundle 子表返回 billing/占位 installed=false）。
 */
import { seedBundles } from '../../../utils/bundles'

export default defineEventHandler(async (event) => {
  const bundleId = ((getQuery(event).bundleId as string) || '').trim()
  if (!bundleId) {
    setResponseStatus(event, 400)
    return { error: '缺少 bundleId' }
  }

  const db = getDB()
  seedBundles(db)

  const plugins = db
    .prepare(
      'SELECT plugin_ref AS ref, billing FROM bundle_plugins WHERE bundle_id = ?'
    )
    .all(bundleId) as unknown as Array<{ ref: string; billing: string | null }>

  const skills = db
    .prepare(
      'SELECT skill_id AS ref, billing FROM bundle_skills WHERE bundle_id = ?'
    )
    .all(bundleId) as unknown as Array<{ ref: string; billing: string | null }>

  const items = [
    ...plugins.map((p) => ({
      itemType: 'plugin' as const,
      itemRef: p.ref,
      installed: false,
      currentVersion: null,
      latestVersion: null,
      billing: (p.billing as 'free' | 'paid') || 'free',
    })),
    ...skills.map((s) => ({
      itemType: 'skill' as const,
      itemRef: s.ref,
      installed: false,
      currentVersion: null,
      latestVersion: null,
      billing: (s.billing as 'free' | 'paid') || 'free',
    })),
  ]

  setHeader(event, 'Cache-Control', 'public, max-age=60')
  return { bundleId, items }
})
