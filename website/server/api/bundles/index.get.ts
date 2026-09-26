/**
 * GET /api/bundles
 * 组合包全量索引（官网权威源，供桌面端 / 官网消费）
 *
 * 查询参数：
 * - q=xxx          关键词搜索（名称 / 描述 / 标签）
 * - sort=create_time|name  排序（默认 create_time 倒序）
 * - page=1&page_size=50    分页（page_size<=200）
 *
 * 缓存：支持 ETag / If-None-Match 增量拉取
 */
import { seedBundles, buildBundle, type BundleRow } from '../../utils/bundles'

export default defineEventHandler(async (event) => {
  const db = getDB()
  seedBundles(db)

  const rows = db.prepare('SELECT * FROM bundles').all() as unknown as BundleRow[]
  let list = rows.map((row) => buildBundle(db, row))

  const query = getQuery(event)
  const q = ((query.q as string) || '').trim().toLowerCase()
  const deep = query.deep === '1' || query.deep === 'true'
  if (q) {
    list = list.filter((b) => {
      // 基础命中：名称 / 描述 / 标签
      if (
        b.name.toLowerCase().includes(q) ||
        (b.description || '').toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
      ) {
        return true
      }
      // Market V3 §3：deep=1 时额外命中内含插件 / MCP / 技能名称与简介
      if (deep) {
        if (
          b.plugins.some(
            (p) =>
              p.pluginRef.toLowerCase().includes(q) ||
              ((p as any).description ?? '').toLowerCase().includes(q)
          ) ||
          b.mcpServers.some(
            (m) =>
              m.name.toLowerCase().includes(q) ||
              ((m as any).brief ?? m.description ?? '').toLowerCase().includes(q)
          ) ||
          b.skills.some(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              ((s as any).description ?? '').toLowerCase().includes(q)
          )
        ) {
          return true
        }
      }
      return false
    })
  }

  // Market V3 §5：来源过滤 + 上架态过滤（默认只返回官方包 + 已审核社区包）
  const scope = (query.scope as string) || ''
  const review = (query.review as string) || 'reviewed'
  if (scope === 'official') {
    list = list.filter((b) => b.source !== 'community')
  } else if (scope === 'community') {
    list = list.filter((b) => b.source === 'community')
  }
  if (scope !== 'all' && review) {
    list = list.filter((b) => {
      // 官方包恒可展示；社区包需 reviewStatus === review
      if (b.source === 'community') return b.reviewStatus === review
      return true
    })
  }

  const sort = (query.sort as string) || 'create_time'
  if (sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } else {
    list.sort((a, b) => b.createTime.localeCompare(a.createTime) || a.id.localeCompare(b.id))
  }

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.page_size) || 50))
  const total = list.length
  const paged = list.slice((page - 1) * pageSize, page * pageSize)

  // ETag：基于总数 + 最新创建时间，支持增量拉取（与 /api/plugins 同风格）
  const latestCreate = rows
    .map((r) => r.create_time)
    .filter(Boolean)
    .sort()
    .reverse()[0]
  const etag = '"' + total + '-' + (latestCreate || 'none') + '"'
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Cache-Control', 'public, max-age=600')
  const inm = getHeader(event, 'if-none-match')
  if (inm && inm === etag) {
    setResponseStatus(event, 304)
    return null
  }

  return {
    total,
    page,
    page_size: pageSize,
    updated_at: new Date().toISOString(),
    bundles: paged
  }
})
