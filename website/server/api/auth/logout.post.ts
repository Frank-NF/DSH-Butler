/**
 * POST /api/auth/logout
 * 清除登录 cookie
 */
export default defineEventHandler((event) => {
  setCookie(event, 'dsh_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: 0,
    path: '/',
  })
  return { ok: true }
})
