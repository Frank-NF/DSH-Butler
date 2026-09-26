/**
 * GET /sitemap.xml
 * 静态路由全量列出（站点无动态详情页路由，bundles 为单页列表）
 */
const SITE = 'https://dsh.huilinsh.cn'

const ROUTES = ['/', '/download', '/docs', '/bundles', '/plugins', '/offline', '/feedback']

export default defineEventHandler((event) => {
  const today = new Date().toISOString().slice(0, 10)
  const urls = ROUTES.map(
    (r) =>
      `  <url><loc>${SITE}${r === '/' ? '' : r}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${r === '/' ? '1.0' : '0.8'}</priority></url>`
  ).join('\n')
  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
})
