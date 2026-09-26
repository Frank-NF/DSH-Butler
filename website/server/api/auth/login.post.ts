/**
 * POST /api/auth/login
 * 邮箱登录：{ email, password }
 * 安全：IP + 邮箱双维度限频（15 分钟 10 次），防暴力破解
 */
import { rateLimit } from '~/server/utils/rateLimit'

const RATE_WINDOW_MS = 15 * 60 * 1000
const RATE_MAX = 10

function clientIp(event: any): string {
  // 优先读 Nginx 注入的 X-Real-IP（不可伪造，来源是 TCP peer），再 fallback 到 XFF 最左侧（信任反向代理）
  const realIp = getHeader(event, 'x-real-ip')
  if (realIp) return realIp.trim()
  const xff = getHeader(event, 'x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return 'unknown'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event)

  const email = body.email?.trim().toLowerCase()
  const password = body.password || ''

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: '请输入邮箱和密码' })
  }

  // 限频：IP 与邮箱任一超限即拒绝（防分布式爆破）
  const ip = clientIp(event)
  if (!rateLimit('login:ip:' + ip, RATE_WINDOW_MS, RATE_MAX)) {
    throw createError({ statusCode: 429, statusMessage: '尝试次数过多，请 15 分钟后再试' })
  }
  if (!rateLimit('login:email:' + email, RATE_WINDOW_MS, RATE_MAX)) {
    throw createError({ statusCode: 429, statusMessage: '尝试次数过多，请 15 分钟后再试' })
  }

  const db = getDB()
  const row = db
    .prepare('SELECT * FROM users WHERE email = ? AND password_hash IS NOT NULL')
    .get(email) as
    | { id: number; email: string; display_name: string; avatar_url: string | null; role: string; password_hash: string }
    | undefined

  if (!row || !checkPassword(password, row.password_hash)) {
    throw createError({ statusCode: 401, statusMessage: '邮箱或密码错误' })
  }

  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(row.id)

  const user: AuthUser = {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    role: row.role,
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
