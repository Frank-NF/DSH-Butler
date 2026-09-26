/**
 * 认证工具：JWT 签发/校验、密码哈希、请求身份解析
 */
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { getDB } from './db'

const JWT_SECRET =
  process.env.DSH_JWT_SECRET || randomBytes(32).toString('hex')
// 注意：不设环境变量时每次重启会换密钥（所有登录态失效）。
// 生产部署必须在 systemd 里固定 DSH_JWT_SECRET；未设时 fail-fast 防止 session 劫持。
// fallback 随机值仅允许开发环境使用。
if (process.env.NODE_ENV === 'production' && !process.env.DSH_JWT_SECRET) {
  console.error('[auth] FAILFAST: NODE_ENV=production 但 DSH_JWT_SECRET 未设置，已阻止服务启动')
  throw new Error('DSH_JWT_SECRET must be set in production environment')
}

export interface AuthUser {
  id: number
  email: string | null
  display_name: string
  avatar_url: string | null
  role: string
}

const TOKEN_TTL = '7d'

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, name: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  )
}

export function verifyToken(token: string): { sub: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: number }
  } catch {
    return null
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10)
}

export function checkPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

/** 从请求解析当前用户（Authorization: Bearer xxx 或 cookie），未登录返回 null */
export function getAuthUser(event: H3Event): AuthUser | null {
  const auth = getHeader(event, 'authorization')
  let token: string | undefined

  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7)
  } else {
    token = getCookie(event, 'dsh_token')
  }

  if (!token) return null
  const payload = verifyToken(token)
  if (!payload) return null

  const db = getDB()
  const row = db
    .prepare(
      'SELECT id, email, display_name, avatar_url, role FROM users WHERE id = ?'
    )
    .get(payload.sub) as AuthUser | undefined

  return row ?? null
}

/** 要求登录，未登录抛 401 */
export function requireAuth(event: H3Event): AuthUser {
  const user = getAuthUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: '请先登录' })
  }
  return user
}
