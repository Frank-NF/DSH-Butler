/**
 * GET /api/auth/me
 * 返回当前登录用户（未登录返回 { user: null }，不报错）
 */
export default defineEventHandler((event) => {
  const user = getAuthUser(event)
  return { user }
})
