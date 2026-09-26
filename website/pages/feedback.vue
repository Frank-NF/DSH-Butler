<template>
  <div class="fb-admin-page">
    <section class="page-head">
      <div class="container">
        <h1>反馈管理</h1>
        <p>查看所有插件的用户反馈 · 共 {{ total }} 条</p>
      </div>
    </section>

    <section class="content">
      <div class="container">
        <!-- 状态筛选 -->
        <div class="filter-row">
          <button
            v-for="s in statusTabs"
            :key="s.value"
            class="filter-tab"
            :class="{ active: status === s.value }"
            @click="setStatus(s.value)"
          >
            {{ s.label }}
            <span v-if="statusCounts[s.value] != null" class="filter-count">{{ statusCounts[s.value] }}</span>
          </button>
        </div>

        <!-- 加载中 -->
        <div v-if="pending" class="empty">加载中…</div>

        <!-- 空状态 -->
        <div v-else-if="!items.length" class="empty">
          <h3>暂无反馈</h3>
          <p>当前筛选条件下没有反馈记录</p>
        </div>

        <!-- 列表 -->
        <div v-else class="fb-list">
          <article v-for="f in items" :key="f.id" class="fb-card card">
            <div class="fb-card-head">
              <span class="fb-plugin">{{ f.plugin_name || f.plugin_id }}</span>
              <span class="fb-type-tag" :class="'fb-type-' + f.type">{{ typeLabel(f.type) }}</span>
              <select
                class="fb-status-select"
                :value="f.status"
                :class="'fb-status-' + f.status"
                @change="changeStatus(f, ($event.target as HTMLSelectElement).value)"
              >
                <option value="open">待处理</option>
                <option value="processing">处理中</option>
                <option value="resolved">已解决</option>
                <option value="closed">已关闭</option>
              </select>
              <span class="fb-time">{{ f.created_at }}</span>
            </div>

            <p class="fb-content">{{ f.content }}</p>

            <div class="fb-card-meta">
              <span v-if="f.display_name" class="fb-author">
                <img v-if="f.avatar_url" :src="f.avatar_url" :alt="f.display_name" class="fb-avatar" referrerpolicy="no-referrer" />
                <span v-else class="fb-avatar fb-avatar-fallback">{{ f.display_name.charAt(0).toUpperCase() }}</span>
                {{ f.display_name }}
              </span>
              <span v-else class="fb-author">匿名用户</span>
              <span v-if="f.contact" class="fb-contact">{{ f.contact }}</span>
            </div>
          </article>
        </div>

        <!-- 分页 -->
        <div v-if="totalPages > 1" class="pager">
          <button class="page-btn" :disabled="page <= 1" @click="gotoPage(page - 1)">← 上一页</button>
          <span class="page-info">第 {{ page }} / {{ totalPages }} 页</span>
          <button class="page-btn" :disabled="page >= totalPages" @click="gotoPage(page + 1)">下一页 →</button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
useSiteSeo({
  title: '反馈管理',
  description: '提交使用反馈与功能建议：bug 报告、体验反馈、使用问题，帮助 DSH插件管家持续改进。',
  path: '/feedback',
})

interface FeedbackRow {
  id: number
  plugin_id: string
  plugin_name: string
  type: string
  content: string
  contact: string | null
  status: string
  created_at: string
  display_name: string | null
  avatar_url: string | null
}

const { user } = useAuth()

const statusTabs = [
  { value: '', label: '全部' },
  { value: 'open', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
]

const status = ref('')
const page = ref(1)
const pageSize = 50
const items = ref<FeedbackRow[]>([])
const total = ref(0)
const pending = ref(true)
const statusCounts = ref<Record<string, number>>({})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

// 非管理员跳回首页
onMounted(async () => {
  if (!user.value) {
    const { refresh } = useAuth()
    await refresh()
  }
  if (user.value?.role !== 'admin') {
    window.location.href = '/'
    return
  }
  await loadCounts()
  await load()
})

async function load() {
  pending.value = true
  try {
    const res = await $fetch<{ total: number; feedback: FeedbackRow[] }>('/api/feedback', {
      query: { all: 1, status: status.value || undefined, page: page.value },
    })
    total.value = res.total
    items.value = res.feedback
  } catch (e: any) {
    if (e?.statusCode === 403 || e?.statusCode === 401) {
      window.location.href = '/'
    }
  } finally {
    pending.value = false
  }
}

async function loadCounts() {
  try {
    const res = await $fetch<{ feedback: FeedbackRow[] }>('/api/feedback', { query: { all: 1 } })
    const counts: Record<string, number> = { '': res.feedback.length }
    for (const f of res.feedback) {
      counts[f.status] = (counts[f.status] || 0) + 1
    }
    statusCounts.value = counts
  } catch {
    /* 静默 */
  }
}

function setStatus(s: string) {
  status.value = s
  page.value = 1
  load()
}

async function changeStatus(f: FeedbackRow, next: string) {
  const prev = f.status
  f.status = next
  try {
    await $fetch('/api/feedback', {
      method: 'PATCH',
      query: { id: f.id },
      body: { status: next },
    })
    await loadCounts()
  } catch {
    f.status = prev
    alert('状态更新失败')
  }
}

function gotoPage(n: number) {
  page.value = Math.min(Math.max(1, n), totalPages.value)
  load()
}

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    bug: '问题反馈',
    suggestion: '功能建议',
    experience: '体验优化',
    question: '使用疑问',
    other: '其他',
  }
  return map[t] || t
}
</script>

<style scoped>
.fb-admin-page {
  position: relative;
  overflow-x: hidden;
  min-height: 70vh;
}

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

.content {
  padding-bottom: 40px;
}

/* ---------- 筛选 ---------- */
.filter-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 24px;
  justify-content: center;
}

.filter-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--line-strong);
  color: var(--text-secondary);
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

.filter-tab:hover {
  color: var(--text-primary);
  border-color: #454b55;
}

.filter-tab.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.filter-count {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  background: rgba(255, 255, 255, 0.12);
}

.filter-tab.active .filter-count {
  background: rgba(0, 0, 0, 0.25);
}

/* ---------- 列表 ---------- */
.fb-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fb-card {
  padding: 20px;
}

.fb-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.fb-plugin {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.fb-type-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
}

.fb-type-bug { background: rgba(214, 95, 95, 0.12); color: #e08585; border: 1px solid rgba(214, 95, 95, 0.28); }
.fb-type-suggestion { background: rgba(217, 160, 60, 0.12); color: var(--warning); border: 1px solid rgba(217, 160, 60, 0.28); }
.fb-type-experience { background: rgba(63, 178, 127, 0.12); color: #5cc394; border: 1px solid rgba(63, 178, 127, 0.28); }
.fb-type-question { background: rgba(88, 166, 201, 0.12); color: #7db9d6; border: 1px solid rgba(88, 166, 201, 0.28); }
.fb-type-other { background: rgba(113, 119, 127, 0.12); color: var(--text-muted); border: 1px solid var(--line-strong); }

.fb-status-select {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--line-strong);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
}

.fb-status-open { color: #e08585; border-color: rgba(214, 95, 95, 0.4); }
.fb-status-processing { color: var(--warning); border-color: rgba(217, 160, 60, 0.4); }
.fb-status-resolved { color: #5cc394; border-color: rgba(63, 178, 127, 0.4); }
.fb-status-closed { color: var(--text-muted); border-color: var(--line-strong); }

.fb-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.fb-content {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-secondary);
  word-break: break-word;
  margin-bottom: 14px;
}

.fb-card-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.fb-author {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-muted);
}

.fb-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
}

.fb-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-dim);
  color: var(--brand-light);
  font-size: 11px;
  font-weight: 700;
}

.fb-contact {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ---------- 空状态 ---------- */
.empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-muted);
  font-size: 14px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.6;
}

.empty h3 {
  font-size: 17px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.empty p {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 20px;
}

/* ---------- 分页 ---------- */
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
.page-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.page-info { color: var(--text-muted); font-size: 13px; }
</style>
