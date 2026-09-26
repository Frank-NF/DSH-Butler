export default defineNuxtConfig({
  devtools: { enabled: true },

  app: {
    head: {
      title: 'DSH 插件管家 - 官方网站',
      htmlAttrs: {
        lang: 'zh-CN',
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'DSH 插件管家：2189+ 插件市场、行业组合包一键安装、MCP 服务管理、快照与离线部署、本地 DSH Web 服务器面板。全链路 Ed25519 签名验证，密钥三次轮换，防篡改安全体系。',
        },
        {
          name: 'keywords',
          content:
            'DSH,插件管理,插件市场,组合包,MCP管理,离线部署,Ed25519签名,自动更新,快照',
        },
        { property: 'og:title', content: 'DSH 插件管家 - 官方网站' },
        {
          property: 'og:description',
          content: '2189+ 插件市场 · 行业组合包 · MCP 管理 · 离线部署 · 全链路签名验证',
        },
        { property: 'og:type', content: 'website' },
        { property: 'og:image', content: 'https://dsh.huilinsh.cn/og.png' },
        { property: 'og:site_name', content: 'DSH插件管家' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: 'https://dsh.huilinsh.cn/og.png' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
        { rel: 'icon', type: 'image/png', sizes: '180x180', href: '/favicon-180.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },

  css: [
    '~/assets/css/main.css',
  ],

  // 旧路由整理：/updater 为 1.0 时代遗留营销页（假统计），重定向到首页
  // 安全响应头：全站生效（XSS/点击劫持/MIME 嗅探/降级劫持 的基础防护）
  routeRules: {
    '/updater': { redirect: '/' },
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        // 全站 HTTPS（nginx 已强制跳转），预加载 1 年
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        // 站点为纯自托管资源（无 CDN/外链脚本），因此可收紧到 'self'
        // 注：Nuxt 水合载荷是内联 script，暂保留 'unsafe-inline'；后续可换 nonce 进一步收紧
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      },
    },
  },

  runtimeConfig: {
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    // 超级管理员邮箱白名单（逗号分隔），GitHub 登录时匹配则自动提升为 admin
    superAdminEmails: process.env.SUPER_ADMIN_EMAILS || '',
    public: {
      proxyBaseUrl: process.env.PROXY_BASE_URL || '',
      appVersion: '1.18.15',
      githubClientId: process.env.GITHUB_CLIENT_ID || '',
      // 在线版已于 v1.13.15 下线；保留空值占位避免旧引用报错（页面上已全部移除入口）
      previewUrl: '',
    },
  },

  nitro: {
    preset: 'node-server',
    // 原生/CJS 包强制外部化：内联进 ESM chunk 会让 require 崩溃（服务器实测）
    externals: {
      external: ['better-sqlite3', 'bcryptjs', 'jsonwebtoken'],
    },
  },
})
