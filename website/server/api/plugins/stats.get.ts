/**
 * GET /api/plugins/stats
 * 插件统计（官网权威源，供首页/看板/桌面端）
 * 新增：分类计数、类型分布、最近更新 TOP
 */
export default defineEventHandler(async () => {
  const plugins = await getPlugins()

  const totalStars = plugins.reduce((sum, p) => sum + (p.stars || 0), 0)
  const latestPush = plugins
    .map((p) => p.pushed_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] as string | undefined

  // 分类计数
  const categoryCounts: Record<string, number> = {}
  for (const p of plugins) {
    const c = p.category || '其他'
    categoryCounts[c] = (categoryCounts[c] || 0) + 1
  }

  // 类型分布
  const typeCounts: Record<string, number> = {}
  for (const p of plugins) {
    const t = p.type || 'plugin'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  }

  // 最近更新 TOP 5
  const recent = [...plugins]
    .filter((p) => p.pushed_at)
    .sort((a, b) => (b.pushed_at as string).localeCompare(a.pushed_at as string))
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, pushed_at: p.pushed_at }))

  return {
    total_plugins: plugins.length,
    total_stars: totalStars,
    latest_push: latestPush ?? null,
    github_data_ok: plugins.some((p) => p.fetched),
    categories: categoryCounts,
    types: typeCounts,
    recent_updates: recent,
    updated_at: new Date().toISOString(),
  }
})
