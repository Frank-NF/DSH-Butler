<template>
  <Teleport to="body">
    <div v-if="pluginId" class="fb-overlay" @click.self="$emit('close')">
      <div class="fb-dialog glass" role="dialog" aria-modal="true" aria-label="插件反馈">
        <button class="dialog-close" aria-label="关闭" @click="$emit('close')">×</button>

        <h3 class="fb-title">
          反馈「{{ pluginName }}」
          <span class="fb-total">共 {{ total }} 条</span>
        </h3>

        <!-- ============ 提交表单 ============ -->
        <div class="fb-form">
          <div class="fb-types">
            <button
              v-for="t in typeOptions"
              :key="t.value"
              class="fb-type"
              :class="{ active: type === t.value }"
              @click="type = t.value"
            >
              <span class="fb-type-icon">{{ t.icon }}</span>
              {{ t.label }}
            </button>
          </div>

          <textarea
            v-model="draft"
            class="fb-input"
            rows="3"
            :placeholder="placeholderFor(type)"
            maxlength="2000"
          ></textarea>

          <div class="fb-contact-row">
            <input
              v-model="contact"
              class="fb-contact"
              type="text"
              placeholder="联系方式（选填，方便开发者回复你）"
              maxlength="200"
            />
            <button
              class="btn btn-primary btn-sm fb-send"
              :disabled="posting || !draft.trim() || draft.trim().length < 5"
              @click="post"
            >
              {{ posting ? '提交中…' : '提交反馈' }}
            </button>
          </div>
          <p v-if="error" class="fb-error">{{ error }}</p>
        </div>

        <!-- ============ 公开反馈列表 ============ -->
        <div class="fb-list-head">
          <span>开发进度（已处理 / 已解决）</span>
          <button
            v-if="user?.role === 'admin'"
            class="fb-admin-link"
            @click="openAdmin"
          >管理全部反馈 →</button>
        </div>
        <div class="fb-list">
          <div v-if="pending && page === 1" class="fb-loading">加载中…</div>
          <div v-else-if="!feedback.length" class="fb-empty">
            <div class="fb-empty-icon">📮</div>
            <p>还没有已处理的反馈，来提交第一条吧</p>
          </div>

          <article v-for="f in feedback" :key="f.id" class="fb-item">
            <div class="fb-item-head">
              <span class="fb-type-tag" :class="'fb-type-' + f.type">{{ typeLabel(f.type) }}</span>
              <span class="fb-status" :class="'fb-status-' + f.status">{{ statusLabel(f.status) }}</span>
              <span class="fb-time">{{ formatTime(f.created_at) }}</span>
            </div>
            <p class="fb-content">{{ f.content }}</p>
          </article>

          <button
            v-if="feedback.length < total"
            class="fb-more"
            :disabled="pending"
            @click="page++; load()"
          >
            {{ pending ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  pluginId: string | null
  pluginName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const { user } = useAuth()

const typeOptions = [
  { value: 'bug', label: '问题反馈', icon: '🐞' },
  { value: 'suggestion', label: '功能建议', icon: '💡' },
  { value: 'experience', label: '体验优化', icon: '✨' },
  { value: 'question', label: '使用疑问', icon: '❓' },
  { value: 'other', label: '其他', icon: '📝' },
]

interface FeedbackItem {
  id: number
  plugin_id: string
  type: string
  content: string
  status: string
  created_at: string
  has_contact?: string | null
}

const type = ref('bug')
const draft = ref('')
const contact = ref('')
const posting = ref(false)
const error = ref('')

const feedback = ref<FeedbackItem[]>([])
const total = ref(0)
const page = ref(1)
const pending = ref(false)

watch(
  () => props.pluginId,
  (id) => {
    if (id) {
      feedback.value = []
      total.value = 0
      page.value = 1
      error.value = ''
      type.value = 'bug'
      draft.value = ''
      contact.value = ''
      load()
    }
  }
)

async function load() {
  if (!props.pluginId) return
  pending.value = true
  try {
    const res = await $fetch<{ total: number; feedback: FeedbackItem[] }>('/api/feedback', {
      query: { plugin_id: props.pluginId, page: page.value },
    })
    total.value = res.total
    feedback.value.push(...res.feedback)
  } catch {
    error.value = '反馈加载失败'
  } finally {
    pending.value = false
  }
}

async function post() {
  const content = draft.value.trim()
  if (!content || !props.pluginId) return
  posting.value = true
  error.value = ''
  try {
    await $fetch('/api/feedback', {
      method: 'POST',
      body: {
        plugin_id: props.pluginId,
        plugin_name: props.pluginName,
        type: type.value,
        content,
        contact: contact.value.trim() || undefined,
      },
    })
    draft.value = ''
    contact.value = ''
    emit('changed')
    // 提交后刷新列表（可能显示处理中）
    feedback.value = []
    total.value = 0
    page.value = 1
    await load()
    error.value = ''
  } catch (e: any) {
    error.value = e?.data?.statusMessage || '提交失败，请重试'
  } finally {
    posting.value = false
  }
}

function openAdmin() {
  emit('close')
  window.location.href = '/feedback'
}

function placeholderFor(t: string): string {
  const map: Record<string, string> = {
    bug: '描述你遇到的问题：复现步骤、报错信息、DSH 版本等…（至少 5 字）',
    suggestion: '说说你希望新增的功能：使用场景、预期效果…',
    experience: '哪些地方用起来不顺手？如何优化更好？',
    question: '描述你的疑问，我们会尽快回复…',
    other: '任何想说的都可以写在这里…',
  }
  return map[t] || map.bug
}

function typeLabel(t: string): string {
  return typeOptions.find((x) => x.value === t)?.label || t
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    open: '待处理',
    processing: '处理中',
    resolved: '已解决',
    closed: '已关闭',
  }
  return map[s] || s
}

function formatTime(s: string): string {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return s
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return s.slice(0, 10)
}
</script>

<style scoped>
.fb-overlay {
  position: fixed;
  inset: 0;
  z-index: 260;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.fb-dialog {
  position: relative;
  width: 600px;
  max-width: 100%;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  padding: 24px;
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

.fb-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
  padding-right: 40px;
}

.fb-total {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

/* ---------- 表单 ---------- */
.fb-form {
  padding: 14px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  margin-bottom: 16px;
}

.fb-types {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.fb-type {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 18px;
  font-size: 12px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  transition: all var(--dur) var(--ease);
}

.fb-type:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.fb-type.active {
  background: rgba(244, 97, 35, 0.18);
  border-color: rgba(244, 97, 35, 0.5);
  color: var(--primary-light);
}

.fb-type-icon {
  font-size: 13px;
}

.fb-input {
  width: 100%;
  resize: none;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color var(--dur) var(--ease);
  box-sizing: border-box;
}

.fb-input:focus {
  border-color: var(--primary);
}

.fb-contact-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.fb-contact {
  flex: 1;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color var(--dur) var(--ease);
}

.fb-contact:focus {
  border-color: var(--primary);
}

.fb-send {
  flex-shrink: 0;
}

.fb-error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--danger);
}

/* ---------- 列表 ---------- */
.fb-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.fb-admin-link {
  background: none;
  border: none;
  font-size: 12px;
  color: var(--primary-light);
  cursor: pointer;
}
.fb-admin-link:hover {
  text-decoration: underline;
}

.fb-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 4px;
  min-height: 80px;
}

.fb-loading,
.fb-empty {
  text-align: center;
  padding: 26px 0;
  color: var(--text-muted);
  font-size: 13px;
}

.fb-empty-icon {
  font-size: 30px;
  margin-bottom: 6px;
  opacity: 0.6;
}

.fb-item {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
}

.fb-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.fb-type-tag {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  background: rgba(244, 97, 35, 0.14);
  color: var(--primary-light);
  border: 1px solid rgba(244, 97, 35, 0.3);
}

.fb-type-bug { background: rgba(239, 68, 68, 0.14); color: #f87171; border-color: rgba(239, 68, 68, 0.3); }
.fb-type-suggestion { background: rgba(245, 158, 11, 0.14); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3); }
.fb-type-experience { background: rgba(16, 185, 129, 0.14); color: #34d399; border-color: rgba(16, 185, 129, 0.3); }
.fb-type-question { background: rgba(59, 130, 246, 0.14); color: #60a5fa; border-color: rgba(59, 130, 246, 0.3); }
.fb-type-other { background: rgba(148, 163, 184, 0.14); color: #94a3b8; border-color: rgba(148, 163, 184, 0.3); }

.fb-status {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
}

.fb-status-processing {
  background: rgba(245, 158, 11, 0.14);
  color: #fbbf24;
}

.fb-status-resolved {
  background: rgba(16, 185, 129, 0.14);
  color: #34d399;
}

.fb-status-closed {
  background: rgba(148, 163, 184, 0.14);
  color: #94a3b8;
}

.fb-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}

.fb-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  word-break: break-word;
}

.fb-more {
  align-self: center;
  padding: 6px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--dur) var(--ease);
}
.fb-more:hover {
  border-color: rgba(99, 102, 241, 0.5);
  color: var(--primary-light);
}
</style>
