/**
 * POST /api/auth/register
 * 邮箱注册：{ email, password, display_name }
 * 安全：
 * - IP 限频：1 小时最多 5 次注册（防批量注册）
 * - 一次性邮箱域名黑名单拦截
 * - 密码最短 8 位
 */
import { rateLimit } from '~/server/utils/rateLimit'

const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 小时
const RATE_MAX = 5
// 一次性邮箱 / 高风险域名黑名单（避免垃圾注册）
const BLOCKED_DOMAINS = [
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'sharklasers.com',
  'yopmail.com', 'temp-mail.org', 'tempmail.com', 'throwawaymail.com',
  'dispostable.com', 'maildrop.cc', 'getnada.com', 'burnermail.io',
  'trashmail.com', 'mailnesia.com', 'mytemp.email', 'fakeinbox.com',
]

function clientIp(event: any): string {
  return (
    getHeader(event, 'x-forwarded-for')?.split(',')[0].trim() ||
    getHeader(event, 'x-real-ip') ||
    'unknown'
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    email?: string
    password?: string
    display_name?: string
  }>(event)

  const email = body.email?.trim().toLowerCase()
  const password = body.password || ''
  const displayName = body.display_name?.trim() || email?.split('@')[0]

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: '邮箱格式不正确' })
  }

  // IP 限频：防批量注册
  const ip = clientIp(event)
  if (!rateLimit('reg:' + ip, RATE_WINDOW_MS, RATE_MAX)) {
    throw createError({ statusCode: 429, statusMessage: '注册太频繁，请稍后再试' })
  }

  // 邮箱域名黑名单
  const domain = email.split('@')[1] || ''
  if (BLOCKED_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) {
    throw createError({ statusCode: 400, statusMessage: '该邮箱域名不支持注册' })
  }

  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: '密码至少 8 位' })
  }
  if (!displayName || displayName.length > 30) {
    throw createError({ statusCode: 400, statusMessage: '昵称需 1-30 个字符' })
  }

  const db = getDB()
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists) {
    throw createError({ statusCode: 409, statusMessage: '该邮箱已注册，请直接登录' })
  }

  const result = db
    .prepare(
      'INSERT INTO users (email, password_hash, display_name, last_login_at) VALUES (?, ?, ?, datetime(\'now\'))'
    )
    .run(email, hashPassword(password), displayName)

  const user: AuthUser = {
    id: Number(result.lastInsertRowid),
    email,
    display_name: displayName,
    avatar_url: null,
    role: 'user',
  }

  setCookie(event, 'dsh_token', signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: 7 * 24 * 3600,
    path: '/',
  })

  return { user }
})
