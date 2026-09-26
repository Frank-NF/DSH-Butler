<template>
  <Teleport to="body">
    <div v-if="pluginId" class="cmt-overlay" @click.self="$emit('close')">
      <div class="cmt-dialog glass" role="dialog" aria-modal="true" aria-label="插件评论">
        <button class="dialog-close" aria-label="关闭" @click="$emit('close')">×</button>

        <h3 class="cmt-title">
          「{{ pluginName }}」的评论
          <span class="cmt-total">{{ total }} 条</span>
        </h3>

        <!-- 评论列表 -->
        <div class="cmt-list" ref="listEl">
          <div v-if="pending && page === 1" class="cmt-loading">加载中…</div>
          <div v-else-if="!comments.length" class="cmt-empty">
            <div class="cmt-empty-icon">💬</div>
            <p>还没有评论，来抢沙发吧</p>
          </div>

          <article v-for="c in comments" :key="c.id" class="cmt-item">
            <img
              v-if="c.avatar_url"
              :src="c.avatar_url"
              :alt="c.display_name"
              class="cmt-avatar"
              referrerpolicy="no-referrer"
            />
            <span v-else class="cmt-avatar cmt-avatar-fallback">{{ c.display_name.charAt(0).toUpperCase() }}</span>
            <div class="cmt-body">
              <div class="cmt-head">
                <span class="cmt-name">{{ c.display_name }}</span>
                <span v-if="c.role === 'admin'" class="badge badge-primary cmt-badge">官方</span>
                <span class="cmt-time">{{ formatTime(c.created_at) }}</span>
                <button
                  v-if="canDelete(c)"
                  class="cmt-del"
                  title="删除"
                  @click="del(c)"
                >删除</button>
              </div>
              <p class="cmt-content">{{ c.content }}</p>
            </div>
          </article>

          <button
            v-if="comments.length < total"
            class="cmt-more"
            :disabled="pending"
            @click="page++; load()"
          >
            {{ pending ? '加载中…' : '加载更多' }}
          </button>
        </div>

        <!-- 输入区 -->
        <div class="cmt-input-area">
          <template v-if="user">
            <img
              v-if="user.avatar_url"
              :src="user.avatar_url"
              :alt="user.display_name"
              class="cmt-avatar"
              referrerpolicy="no-referrer"
            />
            <span v-else class="cmt-avatar cmt-avatar-fallback">{{ user.display_name.charAt(0).toUpperCase() }}</span>
            <textarea
              v-model="draft"
              class="cmt-input"
              rows="2"
              placeholder="说说你的使用体验…（最多 1000 字）"
              maxlength="1000"
              @keydown.enter.exact.prevent="post"
            ></textarea>
            <button class="btn btn-primary btn-sm cmt-send" :disabled="posting || !draft.trim()" @click="post">
              {{ posting ? '…' : '发送' }}
            </button>
          </template>
          <button v-else class="cmt-login-hint" @click="$emit('need-login')">
            登录后即可发表评论 →
          </button>
        </div>
        <p v-if="error" class="cmt-error">{{ error }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
interface CommentItem {
  id: number
  content: string
  created_at: string
  user_id: number
  display_name: string
  avatar_url: string | null
  role: string
}

const props = defineProps<{
  pluginId: string | null
  pluginName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'need-login'): void
  (e: 'changed'): void
}>()

const { user } = useAuth()

const comments = ref<CommentItem[]>([])
const total = ref(0)
const page = ref(1)
const pending = ref(false)
const draft = ref('')
const posting = ref(false)
const error = ref('')

watch(
  () => props.pluginId,
  (id) => {
    if (id) {
      comments.value = []
      total.value = 0
      page.value = 1
      error.value = ''
      load()
    }
  }
)

async function load() {
  if (!props.pluginId) return
  pending.value = true
  try {
    const res = await $fetch<{ total: number; comments: CommentItem[] }>('/api/comments', {
      query: { plugin_id: props.pluginId, page: page.value },
    })
    total.value = res.total
    comments.value.push(...res.comments)
  } catch {
    error.value = '评论加载失败'
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
    const res = await $fetch<{ comment: CommentItem }>('/api/comments', {
      method: 'POST',
      body: { plugin_id: props.pluginId, content },
    })
    comments.value.unshift(res.comment)
    total.value++
    draft.value = ''
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || '发布失败，请重试'
  } finally {
    posting.value = false
  }
}

async function del(c: CommentItem) {
  if (!confirm('确定删除这条评论吗？')) return
  try {
    await $fetch('/api/comments', { method: 'DELETE', query: { id: c.id } })
    comments.value = comments.value.filter((x) => x.id !== c.id)
    total.value--
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || '删除失败'
  }
}

function canDelete(c: CommentItem): boolean {
  return !!user.value && (user.value.id === c.user_id || user.value.role === 'admin')
}

function formatTime(s: string): string {
  // 服务端是 "YYYY-MM-DD HH:MM:SS"，按本地时间粗略显示
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
.cmt-overlay {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.cmt-dialog {
  position: relative;
  width: 560px;
  max-width: 100%;
  max-height: 82vh;
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

.cmt-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  padding-right: 40px;
}

.cmt-total {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.cmt-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
  min-height: 120px;
}

.cmt-loading,
.cmt-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--text-muted);
  font-size: 13px;
}

.cmt-empty-icon {
  font-size: 34px;
  margin-bottom: 8px;
  opacity: 0.6;
}

.cmt-item {
  display: flex;
  gap: 10px;
}

.cmt-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.cmt-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-dim);
  color: var(--brand-light);
  font-size: 13px;
  font-weight: 700;
}

.cmt-body {
  flex: 1;
  min-width: 0;
}

.cmt-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.cmt-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.cmt-badge {
  font-size: 10px;
  padding: 1px 7px;
}

.cmt-time {
  font-size: 11px;
  color: var(--text-muted);
}

.cmt-del {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.cmt-item:hover .cmt-del {
  opacity: 1;
}
.cmt-del:hover {
  color: var(--danger);
}

.cmt-content {
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-secondary);
  word-break: break-word;
}

.cmt-more {
  align-self: center;
  padding: 7px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--dur) var(--ease);
}
.cmt-more:hover {
  border-color: rgba(244, 97, 35, 0.5);
  color: var(--primary-light);
}

/* 输入区 */
.cmt-input-area {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--glass-border);
}

.cmt-input {
  flex: 1;
  resize: none;
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
.cmt-input:focus {
  border-color: var(--primary);
}

.cmt-send {
  flex-shrink: 0;
}

.cmt-login-hint {
  width: 100%;
  padding: 11px;
  border-radius: var(--radius-md);
  background: rgba(244, 97, 35, 0.1);
  border: 1px dashed rgba(244, 97, 35, 0.4);
  color: var(--primary-light);
  font-size: 13px;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}
.cmt-login-hint:hover {
  background: rgba(244, 97, 35, 0.18);
}

.cmt-error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--danger);
}
</style>
