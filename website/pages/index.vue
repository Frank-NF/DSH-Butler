<template>
  <div class="home">
    <!-- Hero：左对齐，石墨底 + 橙红强调，无鲸鱼图 -->
    <section class="hero">
      <div class="container hero-content">
        <p class="hero-kicker mono">
          <span class="kicker-dot" aria-hidden="true"></span>
          <template v-if="latestVersion">v{{ latestVersion }} 已发布 · </template>开源 MIT
        </p>
        <h1>
          管 DeepSeek Harness 的插件，<br />
          用一件顺手的工具。
        </h1>
        <p class="hero-desc">
          插件市场 {{ stats?.total_plugins ?? '—' }} 款，按行业一键装组合包；
          扫描、更新、启停、卸载与 MCP 服务管理都在一个桌面客户端里完成。
          目录与自更新清单经 Ed25519 签名，验签失败拒绝消费。
        </p>
        <div class="hero-buttons">
          <NuxtLink to="/download" class="btn btn-primary">下载 Windows 客户端</NuxtLink>
          <NuxtLink to="/plugins" class="btn btn-outline">浏览插件市场</NuxtLink>
        </div>

        <!-- 数据行：等宽数字，hairline 分隔 -->
        <div class="stats-line">
          <div class="stat">
            <span class="stat-value num">{{ stats?.total_plugins ?? '—' }}</span>
            <span class="stat-label">收录插件</span>
          </div>
          <span class="stat-sep" aria-hidden="true"></span>
          <div class="stat">
            <span class="stat-value num">{{ stats ? formatStars(stats.total_stars) : '—' }}</span>
            <span class="stat-label">社区 Stars</span>
          </div>
          <span class="stat-sep" aria-hidden="true"></span>
          <div class="stat">
            <span class="stat-value num">{{ bundleTotal }}</span>
            <span class="stat-label">行业组合包</span>
          </div>
          <span class="stat-sep" aria-hidden="true"></span>
          <div class="stat">
            <span class="stat-value mono">Ed25519</span>
            <span class="stat-label">目录与自更新验签</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 社区热门：左对齐标题，3列 grid -->
    <section class="section">
      <div class="container">
        <div class="section-title">
          <h2>社区热门</h2>
          <p>按 GitHub Star 排名 · 数据每 10 分钟同步</p>
        </div>

        <div v-if="pending" class="rank-grid">
          <div v-for="i in 6" :key="i" class="rank-card card">
            <div class="skeleton rank-skeleton-icon"></div>
            <div class="rank-info">
              <div class="skeleton rank-skeleton-line"></div>
              <div class="skeleton rank-skeleton-line short"></div>
            </div>
            <div class="skeleton rank-skeleton-star"></div>
          </div>
        </div>

        <div v-else class="rank-grid">
          <a
            v-for="(plugin, index) in topPlugins"
            :key="plugin.id"
            :href="plugin.github_url"
            target="_blank"
            rel="noopener"
            class="rank-card card"
          >
            <div class="rank-num num" :class="`rank-${index + 1}`">{{ index + 1 }}</div>
            <div class="rank-info">
              <h3>{{ plugin.name }}</h3>
              <p>{{ plugin.description }}</p>
            </div>
            <div class="rank-stars" title="GitHub Stars">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              <span class="num">{{ plugin.stars }}</span>
            </div>
          </a>
        </div>

        <div class="section-more">
          <NuxtLink to="/plugins" class="btn btn-outline btn-sm">查看全部插件 →</NuxtLink>
        </div>
      </div>
    </section>

    <!-- 桌面客户端：两栏非对称，功能 + 安全 -->
    <section class="section section-features">
      <div class="container">
        <div class="section-title">
          <h2>桌面客户端</h2>
          <p>Windows 10/11 · 独立运行，不依赖 DSH Agent 本体进程</p>
        </div>
        <div class="modes-grid">
          <div class="mode-card card">
            <div class="mode-head">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              <h3>装完就能做的事</h3>
            </div>
            <ul class="mode-features">
              <li>扫描本机插件目录，识别已装插件与 Agent 本体</li>
              <li>从市场安装/更新插件，更新前自动备份可回滚</li>
              <li>点「更新」先弹更新日志：有 CHANGELOG 就展示本次改了什么，没有会明确提示</li>
              <li>本体更新「完成更新」自动深度清理残留文件，构建失败也能一键修好</li>
              <li>按行业装组合包：插件 + MCP 模板 + Skill 一次装齐</li>
              <li>MCP 服务集中配置，密钥存系统凭据库</li>
              <li>导出插件快照、打包离线安装包，隔离环境两步部署</li>
              <li>启停本地 DSH Web 服务器，一键打开面板</li>
            </ul>
            <NuxtLink to="/download" class="btn btn-primary mode-btn">
              下载客户端 · v{{ latestVersion }}
            </NuxtLink>
          </div>

          <div class="mode-card card">
            <div class="mode-head">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <h3>为什么可以直接信</h3>
            </div>
            <ul class="mode-features">
              <li>插件目录与自更新清单逐字节 Ed25519 验签</li>
              <li>验签失败拒绝消费，自动降级本地缓存；无签名 / 无校验值一律拒绝，不放行</li>
              <li>更新包下载后校验 SHA256，不匹配即中止</li>
              <li>自定义安装源只允许 https（明文 http 仅限本机 127.0.0.1）</li>
              <li>客户端内置 CSP：只允许加载本机与官方资源</li>
              <li>「服务器同步」默认留空，不预填任何服务器地址；私钥/凭据不随包分发</li>
            </ul>
            <NuxtLink to="/download#security" class="btn btn-outline mode-btn">
              查看安全细节 →
            </NuxtLink>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
useSiteSeo({
  title: '插件市场 · 组合包 · 桌面客户端',
  description: 'DSH插件管家：2189+ 插件市场、行业组合包一键安装、MCP 服务管理、快照与离线部署。Windows 桌面客户端免费下载，目录与自更新清单 Ed25519 验签。',
  path: '/',
})

interface PluginData {
  id: string
  name: string
  description: string
  category: string
  stars: number
  github_url: string
}

interface Stats {
  total_plugins: number
  total_stars: number
  github_data_ok: boolean
}

const { data: pluginsData, pending } = await useFetch<{ plugins: PluginData[] }>('/api/plugins', {
  default: () => ({ plugins: [] }),
  lazy: false,
}).catch(() => ({ data: ref({ plugins: [] }), pending: ref(false) }))

const { data: stats } = await useFetch<Stats>('/api/stats', {
  default: () => null,
}).catch(() => ({ data: ref(null) }))

const { data: bundlesData } = await useFetch<{ total: number }>('/api/bundles?page_size=1', {
  default: () => ({ total: 0 }),
}).catch(() => ({ data: ref({ total: 0 }) }))
const bundleTotal = computed(() => bundlesData.value?.total ?? 0)

const { data: latest } = await useFetch<{ version: string }>('/api/updater/latest', {
  default: () => ({ version: '' }),
}).catch(() => ({ data: ref({ version: '' }) }))
const latestVersion = computed(() => {
  const v = latest.value?.version || ''
  return /^\d+\.\d+\.\d+$/.test(v) && v !== '0.0.0' ? v : ''
})

const topPlugins = computed(() => (pluginsData.value?.plugins ?? []).slice(0, 6))

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
</script>

<style scoped>
/* ========== Hero ========== */
.hero {
  padding: 88px 0 72px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-primary);
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

.hero-content {
  max-width: 720px;
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.kicker-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.hero h1 {
  font-size: 46px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.18;
  margin-bottom: 20px;
  color: var(--text-primary);
  max-width: 680px;
  text-wrap: balance;
}

.hero h1 span {
  color: var(--brand);
}

.hero-desc {
  font-size: 16px;
  color: var(--text-secondary);
  max-width: 560px;
  margin-bottom: 32px;
  line-height: 1.75;
  text-wrap: pretty;
}

.hero-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 48px;
}

/* ========== Stats Line ========== */
.stats-line {
  display: flex;
  align-items: center;
  gap: 32px;
  flex-wrap: wrap;
  padding-top: 24px;
  border-top: 1px solid var(--line);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.stat-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-value.mono {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.stat-sep {
  width: 1px;
  height: 28px;
  background: var(--line);
  flex-shrink: 0;
}

/* ========== Section ========== */
.section {
  padding: 72px 0;
  background: var(--bg-primary);
  transition: background var(--dur) var(--ease);
}

.section-features {
  border-top: 1px solid var(--line);
}

.section-title {
  margin-bottom: 36px;
}

.section-title h2 {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.section-title p {
  font-size: 14px;
  color: var(--text-muted);
}

.section-more {
  margin-top: 32px;
}

/* ========== Rank Grid ========== */
.rank-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 10px;
}

.rank-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  color: inherit;
  text-decoration: none;
}

.rank-num {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--line);
}

.rank-num.rank-1 {
  color: var(--warning);
  border-color: rgba(217, 160, 60, 0.4);
  background: rgba(217, 160, 60, 0.08);
}

.rank-num.rank-2 {
  color: #b9bec7;
  border-color: rgba(185, 190, 199, 0.35);
}

.rank-num.rank-3 {
  color: #c98d6b;
  border-color: rgba(201, 141, 107, 0.35);
}

.rank-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rank-info h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rank-info p {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rank-stars {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--text-secondary);
}

/* Skeleton */
.rank-skeleton-icon {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  flex-shrink: 0;
}

.rank-skeleton-line {
  height: 13px;
  width: 70%;
  border-radius: 4px;
}

.rank-skeleton-line.short {
  width: 90%;
}

.rank-skeleton-star {
  width: 44px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 4px;
}

/* ========== Feature Cards ========== */
.modes-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.mode-card {
  padding: 28px;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}

.mode-card:hover {
  border-color: var(--line-strong);
}

.mode-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
  margin-bottom: 20px;
}

.mode-head svg {
  color: var(--brand);
  flex-shrink: 0;
}

.mode-head h3 {
  font-size: 16px;
  font-weight: 600;
}

.mode-features {
  list-style: none;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 11px;
  margin-bottom: 24px;
}

.mode-features li {
  font-size: 13.5px;
  color: var(--text-secondary);
  padding-left: 18px;
  position: relative;
  line-height: 1.6;
}

.mode-features li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 9px;
  width: 5px;
  height: 5px;
  border-radius: 1.5px;
  background: var(--brand);
  opacity: 0.85;
}

.mode-btn {
  width: 100%;
  margin-top: auto;
}

/* ========== Responsive ========== */
@media (max-width: 900px) {
  .modes-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .hero {
    padding: 64px 0 48px;
  }
  .hero h1 {
    font-size: 30px;
  }
  .hero-desc {
    font-size: 15px;
  }
  .stats-line {
    gap: 18px;
  }
  .stat-sep {
    display: none;
  }
  .section {
    padding: 48px 0;
  }
  .rank-grid {
    grid-template-columns: 1fr;
  }
}
</style>
