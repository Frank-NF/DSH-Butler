/**
 * POST /api/manifest/sign
 * 对原始 body 字符串作 Ed25519 签名，返回 hex 签名 + meta
 *
 * 安全：
 *  1. 使用 node:crypto.sign(null, data, key) 原生 API（与桌面端 dalek::PublicKey
 *     verify_strict 对齐），不再使用 createSign('SHA256') —— Ed25519 密钥不兼容该 wrapper。
 *  2. 本接口会用**私钥**签名，属于高危操作，因此：
 *     - 必须管理员登录（未登录 401 / 非管理员 403）
 *     - 单 IP 每分钟最多 5 次，防止把私钥当签名机滥用（签名 oracle / CPU 打满）
 *  3. 出错信息不回显私钥路径等本地文件系统信息。
 */
import { getPlugins } from '~/server/utils/github'
import { requireAuth } from '~/server/utils/auth'
import { rateLimit } from '~/server/utils/rateLimit'
import { sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const PRIVATE_KEY_PATH = process.env.DSH_SIGNING_KEY_PATH || '/var/www/dsh-updater/ed25519-private.pem'
const PUBLIC_KEY_PATH = process.env.DSH_SIGNING_PUB_KEY || '/var/www/dsh-updater/ed25519-public.pem'

function clientIp(event: any): string {
  return (
    getHeader(event, 'x-forwarded-for')?.split(',')[0].trim() ||
    getHeader(event, 'x-real-ip') ||
    'unknown'
  )
}

export default defineEventHandler(async (event) => {
  // ① 鉴权：仅管理员
  const user = requireAuth(event)
  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: '需要管理员权限' })
  }

  // ② 限频：单 IP 每分钟 5 次
  if (!rateLimit(`sign:${clientIp(event)}`, 60_000, 5)) {
    throw createError({ statusCode: 429, statusMessage: '请求过于频繁' })
  }

  const plugins = await getPlugins()

  // 构建与 /api/plugins 一致的 canonical 投影（便于跨接口校验）
  const canonical = JSON.stringify(
    plugins.map(p => ({ id: p.id, repo: p.repo, name: p.name, category: p.category })).sort((a, b) => a.id.localeCompare(b.id))
  )

  try {
    // Ed25519 原生签名：sign(null, data, privateKey) = Go crypto/ed25519.Sign
    const sigHex = sign(null, Buffer.from(canonical), readFileSync(PRIVATE_KEY_PATH)).toString('hex')
    // 附带公钥 PEM 用于第三方验证（无需本地文件系统读取）
    const pubPem = (() => { try { return readFileSync(PUBLIC_KEY_PATH, 'utf8').trim() } catch { return '' } })()
    return {
      signature: sigHex,
      count: plugins.length,
      signed_at: new Date().toISOString(),
      public_key_pem: pubPem,
    }
  } catch (e) {
    // 详情只写服务端日志，不回显给客户端（避免泄露私钥路径等本机信息）
    console.error('[manifest/sign] Ed25519 签名失败:', e)
    throw createError({ statusCode: 500, statusMessage: 'Ed25519 签名失败，请联系管理员' })
  }
})
