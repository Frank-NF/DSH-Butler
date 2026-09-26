<template>
  <div class="plugins-page">
    <section class="page-head">
      <div class="container">
        <h1>插件市场</h1>
        <p>数据实时同步自 GitHub · 共 {{ total }} 个插件 · 每 10 分钟自动刷新</p>
      </div>
    </section>

    <section class="market">
      <div class="container">
        <!-- 工具栏：搜索 + 分类 + 排序 -->
        <div class="market-toolbar">
          <div class="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              v-model="search"
              type="search"
              placeholder="搜索插件名称或功能…"
              aria-label="搜索插件"
            />
          </div>

          <div class="toolbar-right">
            <div class="category-tabs" role="tablist" aria-label="分类筛选">
              <button
                v-for="cat in categories"
                :key="cat"
                class="cat-tab"
                :class="{ active: activeCategory === cat }"
                role="tab"
                :aria-selected="activeCategory === cat"
                @click="activeCategory = cat"
              >
                {{ cat }}
              </button>
            </div>

            <div class="sort-group" role="group" aria-label="排序方式">
              <button
                class="sort-btn"
                :class="{ active: sort === 'stars' }"
                @click="sort = 'stars'"
              >
                Star
              </button>
              <button
                class="sort-btn"
                :class="{ active: sort === 'hot' }"
                @click="sort = 'hot'"
              >
                热度
              </button>
              <button
                class="sort-btn"
                :class="{ active: sort === 'name' }"
                @click="sort = 'name'"
              >
                名称
              </button>
            </div>
          </div>
        </div>

        <!-- 我的收藏筛选提示条 -->
        <div v-if="onlyFavorites" class="fav-banner">
          <span>⭐ 正在浏览我的收藏（{{ filtered.length }} 个）</span>
          <button class="fav-banner-close" @click="onlyFavorites = false">显示全部插件</button>
        </div>

        <!-- 加载骨架 -->
        <div v-if="pending" class="plugins-grid">
          <div v-for="i in 6" :key="i" class="plugin-card card">
            <div class="skeleton sk-line-title"></div>
            <div class="skeleton sk-line-desc"></div>
            <div class="skeleton sk-line-desc short"></div>
            <div class="skeleton sk-line-foot"></div>
          </div>
        </div>

        <!-- 插件网格 -->
        <div v-else-if="filtered.length" class="plugins-grid">
          <article
            v-for="(plugin, index) in paged"
            :key="plugin.id"
            class="plugin-card card"
          >
            <div class="card-head">
              <div class="rank-num num" :class="{ 'top3': globalIndex(index) < 3 && sort === 'stars' }">
                {{ globalIndex(index) + 1 }}
              </div>
              <div class="card-title">
                <h3>{{ plugin.name }}</h3>
                <span class="badge" :class="plugin.type === 'agent-core' ? 'badge-primary' : 'badge-muted'">
                  {{ plugin.type === 'agent-core' ? '本体' : plugin.category }}
                </span>
              </div>
              <div class="card-stars" :title="`${plugin.stars} Stars`">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {{ plugin.stars }}
              </div>
            </div>

            <p class="card-desc">{{ plugin.description }}</p>

            <div class="card-meta">
              <span v-if="plugin.language" class="meta-item">
                <span class="lang-dot" :style="{ background: langColor(plugin.language) }"></span>
                {{ plugin.language }}
              </span>
              <span v-if="plugin.pushed_at" class="meta-item">
                更新于 {{ formatTime(plugin.pushed_at) }}
              </span>
              <span class="meta-item">
                {{ plugin.type === 'agent-core' ? '核心组件' : '即装即用' }}
              </span>
            </div>

            <div class="card-actions">
              <a
                :href="plugin.github_url"
                target="_blank"
                rel="noopener"
                class="btn btn-outline btn-sm"
              >
                GitHub
              </a>
              <button
                class="btn btn-sm install-btn"
                :class="plugin.type === 'agent-core' ? 'btn-outline' : 'btn-primary'"
                :disabled="plugin.type === 'agent-core'"
                :title="plugin.type === 'agent-core' ? 'Agent 本体随客户端分发' : '在桌面客户端中一键安装'"
                @click="openInstall(plugin)"
              >
                {{ plugin.type === 'agent-core' ? '随客户端分发' : '安装' }}
              </button>
            </div>

            <!-- 互动栏：收藏 / 评论 / 分享 -->
            <div class="card-social">
              <button
                class="social-btn"
                :class="{ active: favIds.has(plugin.id) }"
                :aria-pressed="favIds.has(plugin.id)"
                :title="user ? (favIds.has(plugin.id) ? '取消收藏' : '收藏') : '登录后收藏'"
                @click="toggleFav(plugin)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" :fill="favIds.has(plugin.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {{ plugin.favorite_count || 0 }}
              </button>
              <button class="social-btn" title="查看评论" @click="openComments(plugin)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {{ plugin.comment_count || 0 }}
              </button>
              <button class="social-btn" title="复制链接分享" @click="share(plugin)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <path d="m8.59 13.51 6.83 3.98m-.01-10.98-6.82 3.98" />
                </svg>
                {{ plugin.share_count || 0 }}
              </button>
              <button class="social-btn fb-btn" title="提交反馈 / 查看进度" @click="openFeedback(plugin)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <path d="M8 9h8M8 13h5" />
                </svg>
                {{ plugin.feedback_count || 0 }}
              </button>
            </div>
          </article>
        </div>

        <!-- 分页 -->
        <div v-if="totalPages > 1" class="pager">
          <button class="page-btn" :disabled="page <= 1" @click="gotoPage(page - 1)">← 上一页</button>
          <span class="page-info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ filtered.length }} 款</span>
          <button class="page-btn" :disabled="page >= totalPages" @click="gotoPage(page + 1)">下一页 →</button>
        </div>

        <!-- 空状态 -->
        <div v-else class="empty">
          <div class="empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
          </div>
          <h3>没有找到匹配的插件</h3>
          <p>换个关键词试试，或清除筛选条件</p>
          <button class="btn btn-outline btn-sm" @click="clearFilters">清除筛选</button>
        </div>
      </div>
    </section>

    <!-- 安装引导弹窗 -->
    <Teleport to="body">
      <div v-if="installPlugin" class="install-overlay" @click.self="installPlugin = null">
        <div class="install-dialog glass" role="dialog" aria-modal="true" :aria-label="`安装 ${installPlugin.name}`">
          <button class="dialog-close" aria-label="关闭" @click="installPlugin = null">×</button>
          <h3>安装「{{ installPlugin.name }}」</h3>
          <p class="dialog-desc">选择一种方式完成安装：</p>

          <div class="install-options">
            <NuxtLink to="/download" class="install-option" @click="installPlugin = null">
              <div class="option-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              </div>
              <div class="option-info">
                <strong>客户端安装</strong>
                <span>下载桌面客户端，扫描目录后一键安装</span>
              </div>
              <span class="option-arrow">→</span>
            </NuxtLink>

            <NuxtLink to="/bundles" class="install-option" @click="installPlugin = null">
              <div class="option-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 8v8l-9 5-9-5V8l9-5 9 5z"/><path d="m3.3 7.3 8.7 5 8.7-5M12 22V12"/></svg>
              </div>
              <div class="option-info">
                <strong>按行业整套安装</strong>
                <span>浏览行业组合包，插件 + MCP + Skill 一键装齐</span>
              </div>
              <span class="option-arrow">→</span>
            </NuxtLink>
          </div>

          <div class="install-cmd">
            <span class="cmd-label">命令行安装（客户端内置终端可用）：</span>
            <code>dsh install {{ installPlugin.id }}</code>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 评论弹窗 -->
    <CommentDialog
      :plugin-id="commentPlugin?.id || null"
      :plugin-name="commentPlugin?.name || ''"
      @close="commentPlugin = null"
      @need-login="openAuthDialog('login')"
      @changed="refreshCounts"
    />

    <!-- 反馈弹窗 -->
    <FeedbackDialog
      :plugin-id="feedbackPlugin?.id || null"
      :plugin-name="feedbackPlugin?.name || ''"
      @close="feedbackPlugin = null"
      @changed="refreshCounts"
    />

    <!-- 轻提示 Toast -->
    <Transition name="toast-fade">
      <div v-if="toast" class="toast glass" role="status">{{ toast }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
useSiteSeo({
  title: '插件市场',
  description: '浏览 2189+ DSH 社区插件：按行业分类筛选、关键词搜索，支持 Star 与下载数排序。插件以 npm 包分发，在 DSH插件管家客户端一键安装与更新。',
  path: '/plugins',
})

interface PluginData {
  id: string
  repo: string
  name: string
  description: string
  category: string
  type: 'agent-core' | 'plugin'
  stars: number
  forks: number
  language: string | null
  pushed_at: string | null
  github_url: string
  fetched: boolean
  favorite_count?: number
  comment_count?: number
  share_count?: number
  hot_score?: number
}

const route = useRoute()
const search = ref('')
const activeCategory = ref('全部')
const sort = ref<'stars' | 'name' | 'hot'>('stars')
const installPlugin = ref<PluginData | null>(null)

// ---------- 认证与互动 ----------
const { user, openAuthDialog } = useAuth()

const commentPlugin = ref<PluginData | null>(null)
const feedbackPlugin = ref<PluginData | null>(null)

// 当前用户收藏的插件 id 集合
const favIds = ref<Set<string>>(new Set())
const favPending = ref<Set<string>>(new Set())
const toast = ref('')

let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}

async function loadFavorites() {
  if (!user.value) {
    favIds.value = new Set()
    return
  }
  try {
    const res = await $fetch<{ favorites: { plugin_id: string }[] }>('/api/favorites')
    favIds.value = new Set(res.favorites.map((f) => f.plugin_id))
  } catch {
    /* 静默失败 */
  }
}

watch(user, () => loadFavorites(), { immediate: true })

async function toggleFav(plugin: PluginData) {
  if (!user.value) {
    openAuthDialog('login')
    return
  }
  if (favPending.value.has(plugin.id)) return
  const wasFav = favIds.value.has(plugin.id)
  // 乐观更新
  const next = new Set(favIds.value)
  if (wasFav) next.delete(plugin.id)
  else next.add(plugin.id)
  favIds.value = next
  favPending.value = new Set(favPending.value).add(plugin.id)

  try {
    const res = await $fetch<{ favorited: boolean; favorite_count: number }>('/api/favorites', {
      method: wasFav ? 'DELETE' : 'POST',
      body: { plugin_id: plugin.id },
    })
    plugin.favorite_count = res.favorite_count
    showToast(res.favorited ? '⭐ 已加入收藏' : '已取消收藏')
  } catch {
    // 回滚
    const rollback = new Set(favIds.value)
    if (wasFav) rollback.add(plugin.id)
    else rollback.delete(plugin.id)
    favIds.value = rollback
    showToast('操作失败，请重试')
  } finally {
    const p = new Set(favPending.value)
    p.delete(plugin.id)
    favPending.value = p
  }
}

function openComments(plugin: PluginData) {
  commentPlugin.value = plugin
}

function openFeedback(plugin: PluginData) {
  feedbackPlugin.value = plugin
}

async function share(plugin: PluginData) {
  const url = `${window.location.origin}/plugins?plugin=${plugin.id}`
  try {
    await navigator.clipboard.writeText(url)
    showToast('🔗 链接已复制，快去分享吧')
  } catch {
    showToast(url)
  }
  try {
    await $fetch('/api/shares', {
      method: 'POST',
      body: { plugin_id: plugin.id, channel: 'copy-link' },
    })
    plugin.share_count = (plugin.share_count || 0) + 1
  } catch {
    /* 分享计数失败不影响体验 */
  }
}

// 支持 ?tab=favorites（导航栏"我的收藏"入口）
const onlyFavorites = ref(route.query.tab === 'favorites')

watch(
  () => route.query.tab,
  (tab) => {
    onlyFavorites.value = tab === 'favorites'
  }
)

// 支持从分享链接直达 ?plugin=xxx → 打开评论
watch(
  () => route.query.plugin,
  (pid) => {
    if (pid && data.value?.plugins.length) {
      const p = data.value.plugins.find((x) => x.id === pid)
      if (p) openComments(p)
    }
  },
  { immediate: true }
)

// SSR 时服务端直接取数
const { data, pending, refresh: refreshNuxtData } = await useFetch<{
  total: number
  plugins: PluginData[]
}>('/api/plugins', {
  query: { sort },
  default: () => ({ total: 0, plugins: [] }),
}).catch(() => ({
  data: ref({ total: 0, plugins: [] }),
  pending: ref(false),
  refresh: async () => {},
})) as any

const total = computed(() => data.value?.total ?? 0)

const categories = computed(() => {
  const cats = new Set<string>(['全部'])
  for (const p of data.value?.plugins ?? []) {
    cats.add(p.category)
  }
  return Array.from(cats)
})

const filtered = computed(() => {
  let list = data.value?.plugins ?? []
  if (onlyFavorites.value) {
    list = list.filter((p) => favIds.value.has(p.id))
  }
  if (activeCategory.value !== '全部') {
    list = list.filter((p) => p.category === activeCategory.value)
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.repo.toLowerCase().includes(q)
    )
  }
  return list
})

// ===== 分页（2189+ 条全量渲染会卡，每页 48 条）=====
const PAGE_SIZE = 48
const page = ref(1)
// 全局序号：跨分页连续（第 2 页从 49 开始，而不是重复 1-48）
function globalIndex(i: number): number {
  return i + (page.value - 1) * PAGE_SIZE
}
const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filtered.value.slice(start, start + PAGE_SIZE)
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
watch([search, activeCategory, onlyFavorites], () => { page.value = 1 })
function gotoPage(n: number) {
  page.value = Math.min(Math.max(1, n), totalPages.value)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function clearFilters() {
  search.value = ''
  activeCategory.value = '全部'
}

// 评论变动后重新拉列表，刷新计数
async function refreshCounts() {
  try {
    await refreshNuxtData()
  } catch {
    /* 静默 */
  }
}

function openInstall(plugin: PluginData) {
  installPlugin.value = plugin
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return '今天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

const LANG_COLORS: Record<string, string> = {
  Rust: '#dea584',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Go: '#00ADD8',
  Vue: '#41b883',
  Shell: '#89e051',
  C: '#555555',
  'C++': '#f34b7d',
}

function langColor(lang: string): string {
  return LANG_COLORS[lang] || '#94a3b8'
}
</script>

<style scoped>
.plugins-page {
  position: relative;
  overflow-x: hidden;
}

/* ---------- 页头 ---------- */
.page-head {
  padding: 72px 0 40px;
}

.page-head h1 {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.page-head p {
  font-size: 14px;
  color: var(--text-muted);
}

/* ---------- 工具栏 ---------- */
.market {
  padding-bottom: 40px;
}

.market-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
  flex-wrap: wrap;
}

.search-box {
  flex: 1;
  min-width: 240px;
  max-width: 380px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  border: 1px solid var(--line-strong);
  color: var(--text-muted);
  transition: border-color var(--dur) var(--ease);
}

.search-box:focus-within {
  border-color: var(--brand);
}

.search-box input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 14px;
}

.search-box input::placeholder {
  color: var(--text-muted);
}

.category-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cat-tab {
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--line-strong);
  color: var(--text-secondary);
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease), background-color var(--dur) var(--ease);
}

.cat-tab:hover {
  color: var(--text-primary);
  border-color: #454b55;
}

.cat-tab.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* 排序组：紧贴分类右侧，一体分段控件 */
.sort-group {
  display: inline-flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.sort-btn {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  border: none;
  color: var(--text-muted);
  transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease);
}

.sort-btn:hover {
  color: var(--text-primary);
}

.sort-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

/* ---------- 插件网格 ---------- */
.plugins-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}

.plugin-card {
  display: flex;
  flex-direction: column;
  padding: 22px;
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.rank-num {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--line);
}

.rank-num.top3 {
  color: var(--warning);
  background: rgba(217, 160, 60, 0.08);
  border-color: rgba(217, 160, 60, 0.35);
}

.card-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-title h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-stars {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--warning);
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.card-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.65;
  margin-bottom: 14px;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
}

.lang-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.card-actions {
  display: flex;
  gap: 10px;
}

.card-actions .btn {
  flex: 1;
}

.install-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.install-btn:disabled:hover {
  transform: none;
  box-shadow: none;
}

/* 骨架屏 */
.sk-line-title {
  height: 16px;
  width: 55%;
  margin-bottom: 14px;
}

.sk-line-desc {
  height: 12px;
  width: 90%;
  margin-bottom: 8px;
}

.sk-line-desc.short {
  width: 65%;
}

.sk-line-foot {
  height: 30px;
  width: 100%;
  margin-top: 16px;
  border-radius: var(--radius-sm);
}

/* ---------- 空状态 ---------- */
.empty {
  text-align: center;
  padding: 80px 20px;
}

.empty-icon {
  color: var(--text-muted);
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.empty p {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 18px;
}

/* ---------- 安装弹窗 ---------- */
.install-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.install-dialog {
  position: relative;
  width: 480px;
  max-width: 100%;
  padding: 28px;
  border-radius: var(--radius-xl);
  background: var(--bg-secondary);
}

.dialog-close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  color: var(--text-muted);
  font-size: 17px;
  cursor: pointer;
  transition: all var(--dur) var(--ease);
}

.dialog-close:hover {
  background: rgba(239, 68, 68, 0.2);
  color: var(--danger);
}

.install-dialog h3 {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.dialog-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.install-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.install-option {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: transparent;
  border: 1px solid var(--line-strong);
  color: inherit;
  transition: border-color var(--dur) var(--ease);
}

.install-option:hover {
  border-color: #454b55;
}

.option-icon {
  width: 40px;
  height: 40px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--brand-light);
  background: var(--brand-dim);
  border: 1px solid rgba(244, 97, 35, 0.28);
}

.option-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-info strong {
  font-size: 14px;
  color: var(--text-primary);
}

.option-info span {
  font-size: 12px;
  color: var(--text-muted);
}

.option-arrow {
  color: var(--text-muted);
  font-size: 16px;
}

.install-cmd {
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  border: 1px solid var(--line);
}

.cmd-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.install-cmd code {
  font-size: 13px;
  color: var(--brand-light);
}

/* ---------- 收藏筛选条 ---------- */
.fav-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  margin-bottom: 20px;
  border-radius: var(--radius-md);
  background: rgba(217, 160, 60, 0.08);
  border: 1px solid rgba(217, 160, 60, 0.3);
  font-size: 13px;
  color: var(--warning);
}

.fav-banner-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.fav-banner-close:hover {
  color: var(--text-primary);
}

/* ---------- 互动栏 ---------- */
.card-social {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.social-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  cursor: pointer;
  transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease);
}

.social-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.social-btn.active {
  color: var(--warning);
  background: rgba(217, 160, 60, 0.1);
  border-color: rgba(217, 160, 60, 0.35);
}

.fb-btn:hover {
  color: var(--brand-light);
  background: var(--brand-dim);
}

/* ---------- Toast ---------- */
.toast {
  position: fixed;
  bottom: 36px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 400;
  padding: 10px 22px;
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  border: 1px solid var(--line-strong);
  font-size: 13px;
  color: var(--text-primary);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: all 0.22s var(--ease);
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

/* ---------- 响应式 ---------- */
@media (max-width: 640px) {
  .page-head h1 {
    font-size: 28px;
  }
  .market-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .search-box {
    max-width: none;
  }
  .toolbar-right {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin-top: 34px;
}
.page-btn {
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: border-color var(--dur) var(--ease);
}
.page-btn:hover:not(:disabled) { border-color: #454b55; }
.page-btn:disabled { opacity: .35; cursor: not-allowed; }
.page-info { color: var(--text-muted); font-size: 13px; }
</style>
