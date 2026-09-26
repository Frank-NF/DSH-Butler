/**
 * GET /api/auth/github
 * 跳转到 GitHub 授权页（带随机 state 防 CSRF）
 */
import { randomBytes } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const clientId = config.public.githubClientId

  if (!clientId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'GitHub 登录未配置，请在服务器设置 GITHUB_CLIENT_ID',
    })
  }

  const state = randomBytes(16).toString('hex')
  // state 存 httpOnly cookie，回调时校验
  setCookie(event, 'dsh_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const redirectUri = `${getConfigBase(event)}/api/auth/github/callback`
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', 'read:user user:email')

  return sendRedirect(event, url.toString())
})

/** 推断站点基础地址（反代/直连都兼容） */
function getConfigBase(event: H3Event): string {
  const host = getHeader(event, 'host') || 'localhost:8072'
  const proto = getHeader(event, 'x-forwarded-proto') || 'http'
  return `${proto}://${host}`
}
