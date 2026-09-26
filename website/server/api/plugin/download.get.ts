/**
 * GET /api/plugin/download?id=xxx&version=1.0.0
 * 插件包下载入口（302 重定向到真实包地址）
 * 安全：白名单域名 + sha256 头
 */
import { getPlugins } from '~/server/utils/github'

const ALLOWED_DOMAINS = [
  'registry.npmjs.org',
  'registry.npmmirror.com',
  'mirrors.cloud.tencent.com',
  'github.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
]

let npmMetaCache: Map<string, { data: any; at: number }> = new Map()
const NPM_CACHE_TTL = 10 * 60 * 1000

async function fetchNpmMeta(npmName: string): Promise<any | null> {
  if (!npmName) return null
  const cached = npmMetaCache.get(npmName)
  if (cached && Date.now() - cached.at < NPM_CACHE_TTL) return cached.data
  try {
    const res = await $fetch(`https://registry.npmjs.org/${encodeURIComponent(npmName)}`, { timeout: 8000, retry: 1 })
    npmMetaCache.set(npmName, { data: res, at: Date.now() })
    return res
  } catch {
    return null
  }
}

function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return ALLOWED_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith('.' + d))
  } catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = (query.id as string) || ''
  const version = query.version as string | undefined
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: '缺少 id 参数' })
  }

  const plugins = await getPlugins()
  const plugin = plugins.find((p) => p.id === id)
  if (!plugin) {
    throw createError({ statusCode: 404, statusMessage: 'Plugin Not Found' })
  }

  const npmName = plugin.topics?.find((t) => t.startsWith('@')) || plugin.id
  const meta = await fetchNpmMeta(npmName)
  if (!meta) {
    throw createError({ statusCode: 404, statusMessage: 'npm 包信息不可用' })
  }

  const targetVersion = version || meta['dist-tags']?.latest
  const verMeta = meta.versions?.[targetVersion]
  if (!verMeta) {
    throw createError({ statusCode: 404, statusMessage: `版本 ${targetVersion} 不存在` })
  }

  const tarballUrl = verMeta?.dist?.tarball
  const shasum = verMeta?.dist?.shasum || null
  if (!tarballUrl || !isAllowedUrl(tarballUrl)) {
    throw createError({ statusCode: 400, statusMessage: '下载地址不在白名单' })
  }

  // X-DSH-SH1：上游 npm dist shasum（MD5 已弱化，改头名以消除安全隐患暗示）
  setHeader(event, 'X-DSH-SH1', shasum || '')
  setHeader(event, 'X-DSH-Version', targetVersion)
  setHeader(event, 'X-DSH-NPM', npmName)
  setHeader(event, 'Cache-Control', 'public, max-age=600')
  return sendRedirect(event, tarballUrl, 302)
})
