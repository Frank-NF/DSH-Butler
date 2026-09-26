/**
 * GET /api/skills
 * 技能（Skill）模板索引（V2 §8 P1）：聚合 bundle_skills，只读。
 * 说明：P0 阶段 Skill 以插件形态分发（source=插件 npm 名），此处仅做模板展示。
 */
import { seedBundles } from '../../utils/bundles'

interface SkillRow {
  skill_id: string
  bundle_id: string
  name: string
  source: string
  scope: string
  optional: number
}

export default defineEventHandler(async (event) => {
  const db = getDB()
  seedBundles(db)
  const rows = db
    .prepare(
      'SELECT skill_id, bundle_id, name, source, scope, optional FROM bundle_skills ORDER BY skill_id'
    )
    .all() as unknown as SkillRow[]

  const skills = rows.map((r) => ({
    skillId: r.skill_id,
    name: r.name,
    source: r.source,
    scope: r.scope === 'project' ? 'project' : 'user',
    optional: !!r.optional,
    bundles: [r.bundle_id],
  }))

  const etag = '"' + skills.length + '-' + (skills[0]?.skillId || 'none') + '"'
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Cache-Control', 'public, max-age=600')
  const inm = getHeader(event, 'if-none-match')
  if (inm && inm === etag) {
    setResponseStatus(event, 304)
    return null
  }

  return { total: skills.length, skills }
})
