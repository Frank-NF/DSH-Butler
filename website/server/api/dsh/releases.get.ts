/**
 * GET /api/dsh/releases
 * DSH 本体（@deepseek-ai/dsh）历史版本发布说明
 *
 * 数据源：/var/www/dsh-updater/dsh-releases.json
 *   —— 由服务器上的 /root/sync-dsh-releases.py 定时从 GitHub Releases 抓取落盘。
 *   之所以要在服务端做缓存：客户端（国内）连不上 GitHub，只能读这个静态 JSON。
 *
 * 安全：与 /api/updater/latest 一致，私钥可用时对原始 body 作 Ed25519 签名，
 *       通过 X-DSH-SIGNATURE 返回；客户端验签失败则拒绝使用。
 */
import { readFile } from 'node:fs/promises'

const RELEASES_FILE = '/var/www/dsh-updater/dsh-releases.json'
const FALLBACK = {
  synced_at: null,
  source: null,
  stable_exists: false,
  releases: [],
}

export default defineEventHandler(async (event) => {
  let payload: Record<string, unknown>
  try {
    const raw = await readFile(RELEASES_FILE, 'utf8')
    const data = JSON.parse(raw)
    payload = {
      synced_at: data.synced_at || null,
      source: data.source || null,
      stable_exists: !!data.stable_exists,
      releases: Array.isArray(data.releases) ? data.releases : [],
    }
  } catch {
    payload = FALLBACK
  }

  // Ed25519 签名：仅当私钥可用且文件可读时注入 X-DSH-SIGNATURE
  try {
    const { sign } = await import('node:crypto')
    const { readFileSync } = await import('node:fs')
    const keyPath =
      process.env.DSH_SIGNING_KEY_PATH || '/var/www/dsh-updater/ed25519-private.pem'
    const bodyStr = JSON.stringify(payload)
    const sigHex = sign(null, Buffer.from(bodyStr), readFileSync(keyPath)).toString('hex')
    event.node.res.setHeader('X-DSH-SIGNATURE', sigHex)
    event.node.res.setHeader('Content-Type', 'application/json')
    event.node.res.end(bodyStr)
    return
  } catch {
    // 私钥不可用 → 不发签名头，客户端 fail-open
  }

  return payload
})
