/**
 * GET /api/stats（旧端点，保留兼容；新数据见 /api/plugins/stats）
 */
export default defineEventHandler(async () => {
  const plugins = await getPlugins()
  const totalStars = plugins.reduce((sum, p) => sum + p.stars, 0)
  const latestPush = plugins.map((p) => p.pushed_at).filter(Boolean).sort().reverse()[0] as string | undefined
  return {
    total_plugins: plugins.length,
    total_stars: totalStars,
    latest_push: latestPush ?? null,
    github_data_ok: plugins.some((p) => p.fetched),
  }
})
