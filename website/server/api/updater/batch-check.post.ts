/**
 * 批量检查插件更新（客户端性能优化：一次请求替代逐插件串行 npm 查询）
 *
 * POST /api/updater/batch-check
 * body: { items: [{ id: string, npm: string, version: string }] }
 *   - id:      本地插件 id（原样回传，用于客户端对位）
 *   - npm:     npm 包名（客户端目录索引解析出的名字）
 *   - version: 本地当前版本
 * resp: { results: [{ id, latest, tarball?, sha?, update_available }] }
 *
 * 服务端机房访问 npm registry 直连快，客户端只需一次国内请求。
 */
interface CheckItem {
  id: string
  npm: string
  version: string
}

interface NpmLatestMeta {
  version?: string
  dist?: { tarball?: string; shasum?: string }
}

function versionNewer(latest: string, current: string): boolean {
  // 与客户端同口径：semver 可解析则三段数值+prerelease 比较，否则按不等即新
  const lv = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(latest)
  const cv = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(current)
  if (!lv || !cv) return latest !== current
  for (let i = 1; i <= 3; i++) {
    const l = Number(lv[i]); const c = Number(cv[i])
    if (l !== c) return l > c
  }
  // 数值相同：无预发布 > 有预发布；两个预发布按字符串比较
  const lp = lv[4]; const cp = cv[4]
  if (!lp && !cp) return false
  if (!lp) return false
  if (!cp) return true
  return lp > cp
}

async function fetchLatest(npm: string): Promise<NpmLatestMeta | null> {
  try {
    return await $fetch<NpmLatestMeta>(`https://registry.npmjs.org/${encodeURIComponent(npm)}/latest`, {
      timeout: 8000,
      retry: 1,
      headers: { 'User-Agent': 'dsh-plugin-updater-batch' },
    })
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ items?: CheckItem[] }>(event)
  const items = Array.isArray(body?.items) ? body.items.slice(0, 200) : []
  if (!items.length) {
    return { results: [] }
  }

  // 并发查 npm（服务端直连 registry，10 路并发足够温和）
  const results = await Promise.all(items.map(async (item) => {
    const npm = String(item.npm || '').trim()
    const id = String(item.id || '')
    const version = String(item.version || '')
    // 防御：伪包名（monorepo 子目录引用，含 '#' 或路径分隔符）绝不能进 registry 查询
    const invalid = !npm || npm.includes('#') || npm.includes('\\') || npm.includes(' ')
    if (invalid || !id) {
      return { id, latest: null as string | null, tarball: null as string | null, sha: null as string | null, update_available: false }
    }
    const meta = await fetchLatest(npm)
    if (!meta?.version) {
      return { id, latest: null, tarball: null, sha: null, update_available: false }
    }
    return {
      id,
      latest: meta.version,
      tarball: meta.dist?.tarball ?? null,
      sha: meta.dist?.shasum ?? null,
      update_available: versionNewer(meta.version, version),
    }
  }))

  return { results }
})
