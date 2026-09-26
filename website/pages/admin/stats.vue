<template>
  <div>
    <section class="stats-section">
      <div class="container">
        <h1>站点统计</h1>
        <p class="stats-sub">近 {{ data?.window_days || 30 }} 天 · 仅管理员可见 · 数据匿名聚合</p>

        <div v-if="pending" class="stats-loading">加载中…</div>

        <template v-else-if="data">
          <div class="stat-cards">
            <div class="stat-card card">
              <span class="stat-num">{{ fmt(data.totals.page_views) }}</span>
              <span class="stat-label">页面浏览</span>
            </div>
            <div class="stat-card card">
              <span class="stat-num">{{ fmt(data.totals.downloads) }}</span>
              <span class="stat-label">安装包下载</span>
            </div>
            <div class="stat-card card">
              <span class="stat-num">{{ fmt(data.totals.active_installs) }}</span>
              <span class="stat-label">活跃安装（去重）</span>
            </div>
          </div>

          <div class="trend-grid">
            <div v-for="(t, key) in trends" :key="key" class="trend card">
              <h3>{{ t.label }}</h3>
              <div class="bars">
                <div
                  v-for="row in t.rows"
                  :key="row.day"
                  class="bar-item"
                  :title="`${row.day}: ${row.n}`"
                >
                  <div
                    class="bar"
                    :style="{ height: barHeight(row.n, t.max) + '%' }"
                  />
                </div>
                <div v-if="!t.rows.length" class="bars-empty">暂无数据</div>
              </div>
              <p class="trend-range">{{ t.rows[0]?.day || '—' }} ~ {{ t.rows[t.rows.length - 1]?.day || '—' }}</p>
            </div>
          </div>

          <div class="card top-pages">
            <h3>热门页面 Top 10</h3>
            <table class="field-table">
              <thead>
                <tr><th>路径</th><th>浏览量</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in data.top_pages" :key="p.path">
                  <td>{{ p.path }}</td>
                  <td>{{ p.n }}</td>
                </tr>
                <tr v-if="!data.top_pages.length">
                  <td colspan="2" style="opacity:.6">暂无数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
useSiteSeo({
  title: '站点统计',
  description: 'DSH插件管家站点访问/下载/活跃安装统计（管理员）。',
  path: '/admin/stats',
})
// robots.txt 已 Disallow /admin，这里再加 noindex 双保险
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const { user } = useAuth()

interface TrendRow { day: string; n: number }
interface Overview {
  window_days: number
  totals: { page_views: number; downloads: number; active_installs: number }
  trends: { page_views: TrendRow[]; downloads: TrendRow[]; active_installs: TrendRow[] }
  top_pages: { path: string; n: number }[]
}

const data = ref<Overview | null>(null)
const pending = ref(true)

const fmt = (n: number) => (n ?? 0).toLocaleString('zh-CN')

const trends = computed(() => {
  if (!data.value) return {}
  const mk = (label: string, rows: TrendRow[]) => ({
    label,
    rows,
    max: Math.max(1, ...rows.map((r) => r.n)),
  })
  return {
    pv: mk('页面浏览', data.value.trends.page_views),
    dl: mk('安装包下载', data.value.trends.downloads),
    ai: mk('活跃安装', data.value.trends.active_installs),
  }
})

const barHeight = (n: number, max: number) => Math.max(4, Math.round((n / max) * 100))

onMounted(async () => {
  if (!user.value) {
    const { refresh } = useAuth()
    await refresh()
  }
  if (user.value?.role !== 'admin') {
    window.location.href = '/'
    return
  }
  try {
    data.value = await $fetch<Overview>('/api/stats/overview')
  } catch {
    window.location.href = '/'
  } finally {
    pending.value = false
  }
})
</script>

<style scoped>
.stats-section { padding: 40px 0 80px; min-height: 100vh; }
.stats-section h1 { font-size: 26px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; }
.stats-sub { font-size: 13px; color: var(--text-secondary); opacity: .7; margin-bottom: 24px; }
.stats-loading { color: var(--text-secondary); padding: 48px 0; }
.stat-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card { padding: 22px; display: flex; flex-direction: column; gap: 6px; }
.stat-num { font-size: 30px; font-weight: 700; color: var(--text-primary); font-family: 'JetBrains Mono', 'Consolas', monospace; font-variant-numeric: tabular-nums; }
.stat-label { font-size: 13px; color: var(--text-secondary); }
.trend-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.trend { padding: 18px; }
.trend h3 { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px; }
.bars { display: flex; align-items: flex-end; gap: 3px; height: 110px; }
.bar-item { flex: 1; display: flex; align-items: flex-end; height: 100%; }
.bar { width: 100%; background: var(--brand); border-radius: 2px 2px 0 0; min-height: 2px; opacity: .85; }
.bars-empty { color: var(--text-secondary); opacity: .6; font-size: 12px; }
.trend-range { font-size: 11.5px; color: var(--text-secondary); opacity: .7; margin-top: 10px; }
.top-pages { padding: 18px; }
.top-pages h3 { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px; }
.field-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.field-table th, .field-table td { padding: 8px 12px; border: 1px solid var(--border); text-align: left; color: var(--text-secondary); }
.field-table th { color: var(--text-primary); font-weight: 600; background: rgba(244,97,35,.06); }
@media (max-width: 900px) {
  .stat-cards, .trend-grid { grid-template-columns: 1fr; }
}
</style>
