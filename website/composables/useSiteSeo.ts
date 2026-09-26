/**
 * 全站 SEO 组合式函数：统一 title/description/OG/Twitter/canonical
 * 用法：useSiteSeo({ title, description, path })
 * og:image / site_name 由 nuxt.config 全局提供，这里不重复设置
 */
export function useSiteSeo(options: { title: string; description: string; path: string }) {
  const site = 'https://dsh.huilinsh.cn'
  const fullTitle = `${options.title} - DSH插件管家`

  useHead({
    title: fullTitle,
    link: [{ rel: 'canonical', href: `${site}${options.path}` }],
  })

  useSeoMeta({
    description: options.description,
    ogTitle: fullTitle,
    ogDescription: options.description,
    ogUrl: `${site}${options.path}`,
    twitterTitle: fullTitle,
    twitterDescription: options.description,
    twitterCard: 'summary_large_image',
  })
}
