/**
 * POST /api/bundles
 * Market V3 §5：创建/分享社区组合包。需登录（写入 author/author_id，落 shares 审计）。
 *
 * 入参：{ id?, name, description, tags[], plugins[], mcpServers[], skills[],
 *         baseBundleId?, pricing? }
 * 返回：{ ok, id, reviewStatus: 'pending' }
 *
 * 说明：新社区包 reviewStatus='pending'，需平台审核（POST /api/bundles/review）通过后
 * 才在列表默认出现（官方包恒 reviewed）。
 */
import { getAuthUser } from '../../utils/auth'
import { seedBundles } from '../../utils/bundles'

interface ShareReq {
  id?: string
  name: string
  description?: string
  tags?: string[]
  plugins?: Array<{ pluginRef: string; required: boolean; description?: string; billing?: string; priceCents?: number | null }>
  mcpServers?: Array<{ serverId: string; name: string; transport?: string; command?: string; args?: string[]; envKeys?: string[]; optional?: boolean; description?: string; brief?: string; billing?: string; priceCents?: number | null; billingCycle?: string }>
  skills?: Array<{ skillId: string; name: string; source?: string; scope?: string; optional?: boolean; description?: string; billing?: string }>
  baseBundleId?: string | null
  pricing?: { hasPaidItems?: boolean; packagePriceCents?: number | null; cycle?: string; commissionRate?: number | null; channel?: string | null }
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: '仅支持 POST' })
  }

  const user = getAuthUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: '分享组合包需先登录' })
  }
  const body = await readBody<ShareReq>(event)
  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: '缺少组合包名称' })
  }

  const db = getDB()
  seedBundles(db)

  const id = body.id?.trim() || `community-${Date.now()}`
  const now = new Date().toISOString()

  const insertBundle = db.prepare(
    'INSERT INTO bundles ' +
    '(id, name, description, tags, mode, min_dsh_version, max_dsh_version, recommend_preset, version, create_time, ' +
    'source, author, author_id, share_time, base_bundle_id, review_status, package_price_cents, commission_rate, pay_channel) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ' +
    "'community', ?, ?, ?, ?, 'pending', ?, ?, ?" +
    'ON CONFLICT(id) DO UPDATE SET ' +
    'name=excluded.name, description=excluded.description, tags=excluded.tags, ' +
    'author=excluded.author, share_time=excluded.share_time, review_status=excluded.review_status'
  )

  const tx = db.transaction(() => {
    insertBundle.run(
      id,
      body.name.trim(),
      body.description?.trim() || '',
      JSON.stringify(body.tags ?? []),
      'standard',
      null,
      null,
      null,
      '1.0.0',
      now,
      user.display_name,
      String(user.id),
      now,
      body.baseBundleId ?? null,
      body.pricing?.packagePriceCents ?? null,
      body.pricing?.commissionRate ?? null,
      body.pricing?.channel ?? null
    )

    // 子表：先清旧（覆盖式分享），再插入
    db.prepare('DELETE FROM bundle_plugins WHERE bundle_id = ?').run(id)
    db.prepare('DELETE FROM bundle_mcp_servers WHERE bundle_id = ?').run(id)
    db.prepare('DELETE FROM bundle_skills WHERE bundle_id = ?').run(id)

    for (const p of body.plugins ?? []) {
      db.prepare(
        'INSERT OR IGNORE INTO bundle_plugins (bundle_id, plugin_ref, required, description, billing, price_cents) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, p.pluginRef, p.required ? 1 : 0, p.description ?? null, p.billing === 'paid' ? 'paid' : 'free', p.priceCents ?? null)
    }
    for (const m of body.mcpServers ?? []) {
      db.prepare(
        'INSERT OR IGNORE INTO bundle_mcp_servers ' +
        '(bundle_id, server_id, name, transport, command, args, env_keys, optional, description, brief, billing, price_cents, billing_cycle) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, m.serverId, m.name, m.transport || 'stdio', m.command || '',
        JSON.stringify(m.args ?? []), JSON.stringify(m.envKeys ?? []), m.optional ? 1 : 0,
        m.description ?? '', m.brief ?? m.description ?? null,
        m.billing === 'paid' ? 'paid' : 'free', m.priceCents ?? null, m.billingCycle ?? null
      )
    }
    for (const s of body.skills ?? []) {
      db.prepare(
        'INSERT OR IGNORE INTO bundle_skills (bundle_id, skill_id, name, source, scope, optional, description, billing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, s.skillId, s.name, s.source ?? '', s.scope ?? 'user', s.optional ? 1 : 0, s.description ?? null, s.billing === 'paid' ? 'paid' : 'free')
    }

    // 落 shares 审计（关联用户，channel=bundle）
    try {
      db.prepare('INSERT INTO shares (user_id, plugin_id, channel) VALUES (?, ?, ?)').run(user.id, id, 'bundle')
    } catch {
      /* shares 表不存在则忽略审计失败（不影响主流程） */
    }
  })
  tx()

  return { ok: true, id, reviewStatus: 'pending' }
})
