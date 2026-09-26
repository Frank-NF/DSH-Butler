/**
 * GET /api/plugin?id=xxx
 * 单插件详情（查询参数形式，避免 [id] 路由兼容问题）
 * 返回：插件元数据 + _source（npm 版本聚合/changelog）
 */
import { getPlugins } from '~/server/utils/github'

const NPM_REGISTRY = 'https://registry.npmjs.org'
let npmVersionCache: Map<string, { data: any[]; at: number }> = new Map()
const NPM_CACHE_TTL = 10 * 60 * 1000

async function fetchNpmVersions(npmName: string): Promise<any[] | null> {
  if (!npmName) return null
  const cached = npmVersionCache.get(npmName)
  if (cached && Date.now() - cached.at < NPM_CACHE_TTL) return cached.data
  try {
    const res = await $fetch(`${NPM_REGISTRY}/${encodeURIComponent(npmName)}`, { timeout: 8000, retry: 1 })
    const versions = Object.entries(res?.versions || {})
      .map(([v, meta]: [string, any]) => ({
        version: v,
        published_at: meta?.time?.publish_time || null,
        dist: meta?.dist?.tarball || null,
        shasum: meta?.dist?.shasum || null,
      }))
      .sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }))
      .slice(0, 10)
    npmVersionCache.set(npmName, { data: versions, at: Date.now() })
    return versions
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = (query.id as string) || ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: '缺少 id 参数' })
  }
  const plugins = await getPlugins()
  const plugin = plugins.find((p) => p.id === id)
  if (!plugin) {
    throw createError({ statusCode: 404, statusMessage: 'Plugin Not Found' })
  }

  const db = getDB()
  const counts = db
    .prepare(
      'SELECT' +
      ' (SELECT COUNT(*) FROM favorites WHERE plugin_id = ?) AS favorites,' +
      ' (SELECT COUNT(*) FROM comments  WHERE plugin_id = ? AND deleted = 0) AS comments,' +
      ' (SELECT COUNT(*) FROM shares    WHERE plugin_id = ?) AS shares,' +
      ' (SELECT COUNT(*) FROM feedback  WHERE plugin_id = ?) AS feedback'
    )
    .get(id, id, id, id) as { favorites: number; comments: number; shares: number; feedback: number }

  const npmName = plugin.topics?.find((t) => t.startsWith('@')) || (plugin.id.includes('/') ? plugin.id : null)
  const versions = await fetchNpmVersions(npmName || plugin.id)

  const _source = {
    registry: 'official',
    npm: npmName || plugin.id,
    latest_version: versions?.[0]?.version || null,
    versions: versions || [],
    changelog: versions?.slice(0, 5).map((v) => ({ version: v.version, published_at: v.published_at, notes: null })),
  }

  return {
    ...plugin,
    favorite_count: counts.favorites,
    comment_count: counts.comments,
    share_count: counts.shares,
    feedback_count: counts.feedback,
    _source,
  }
})
