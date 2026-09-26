/**
 * GET /api/plugins/:id（兼容旧路径，内部转发到 /api/plugin?id=xxx 逻辑）
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || (event.context?.params?.id as string) || ''
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: '缺少 id' })
  }
  const plugins = await getPlugins()
  const plugin = plugins.find((p) => p.id === id)
  if (!plugin) {
    throw createError({ statusCode: 404, statusMessage: 'Plugin Not Found' })
  }
  const detail = await $fetch('/api/plugin?id=' + encodeURIComponent(id))
  return detail
})
