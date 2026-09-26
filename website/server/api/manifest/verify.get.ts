/**
 * GET /api/manifest/verify?signature=xxx&body=...
 * 验证插件目录 Ed25519 签名（返回 body 原文，避免 hash-only 方案被重放）
 *
 * 签名原语：node:crypto.verify(null, data, publicKey, sig) — Ed25519 原生 API
 */
import { verify, createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'

const PUBLIC_KEY_PATH = process.env.DSH_SIGNING_PUB_KEY || '/var/www/dsh-updater/ed25519-public.pem'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const signature = (query.signature as string) || ''
  // body 以 base64url 编码传入（避免 URL 非法字符），服务端解码后验证
  const bodyB64 = (query.body as string) || ''
  const body = (() => {
    try { return Buffer.from(bodyB64, 'base64url') } catch { return Buffer.from(bodyB64, 'base64') }
  })()
  if (!signature || body.length === 0) {
    throw createError({ statusCode: 400, statusMessage: '缺少 signature 或 body 参数' })
  }
  try {
    const pubKey = createPublicKey(readFileSync(PUBLIC_KEY_PATH))
    const sigBytes = Buffer.from(signature, 'hex')
    const valid = verify(null, body, pubKey, sigBytes)
    return { valid, sig_len: sigBytes.length, body_len: body.length }
  } catch (e) {
    return { valid: false, error: (e as Error).message }
  }
})
