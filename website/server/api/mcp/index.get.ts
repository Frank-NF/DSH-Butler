/**
 * GET /api/mcp
 * MCP 服务模板索引（V2 §8 P1）：聚合 bundle_mcp_servers，只读。
 * 环境变量只列键名（required_env_keys），值一律由用户本地填写，服务端不存不传。
 */
import { seedBundles } from '../../utils/bundles'

interface McpRow {
  server_id: string
  bundle_id: string
  name: string
  transport: string
  command: string
  args: string
  env_keys: string
  optional: number
  description: string | null
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  const db = getDB()
  seedBundles(db)
  const rows = db
    .prepare(
      'SELECT server_id, bundle_id, name, transport, command, args, env_keys, optional, description FROM bundle_mcp_servers ORDER BY server_id'
    )
    .all() as unknown as McpRow[]

  const servers = rows.map((r) => ({
    serverId: r.server_id,
    name: r.name,
    transport: r.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: r.command,
    args: parseJsonArray(r.args),
    requiredEnvKeys: parseJsonArray(r.env_keys),
    optional: !!r.optional,
    description: r.description || '',
    bundles: [r.bundle_id],
  }))

  const etag = '"' + servers.length + '-' + (servers[0]?.serverId || 'none') + '"'
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Cache-Control', 'public, max-age=600')
  const inm = getHeader(event, 'if-none-match')
  if (inm && inm === etag) {
    setResponseStatus(event, 304)
    return null
  }

  return { total: servers.length, servers }
})
