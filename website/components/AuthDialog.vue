<template>
  <Teleport to="body">
    <Transition name="auth-fade">
      <div
        v-if="dialog.open"
        class="auth-overlay"
        @click.self="close"
      >
        <div class="auth-dialog glass" role="dialog" aria-modal="true" aria-label="账号登录">
          <button class="dialog-close" aria-label="关闭" @click="close">×</button>

          <!-- 品牌头 -->
          <div class="auth-head">
            <div class="auth-logo">DSH</div>
            <h3>{{ isLogin ? '欢迎回来' : '创建账号' }}</h3>
            <p>{{ isLogin ? '登录后可收藏插件、发表评论、同步互动数据' : '注册后即可收藏插件、发表评论，全程免费' }}</p>
          </div>

          <!-- 第三方登录 -->
          <a href="/api/auth/github" class="github-btn" @click="githubLoading = true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.04.77 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/>
            </svg>
            使用 GitHub 继续
          </a>

          <div class="divider"><span>或使用邮箱</span></div>

          <!-- 表单 -->
          <form class="auth-form" @submit.prevent="submit">
            <label v-if="!isLogin" class="field">
              <span>昵称</span>
              <input
                v-model="displayName"
                type="text"
                placeholder="怎么称呼你？"
                maxlength="30"
                autocomplete="nickname"
              />
            </label>

            <label class="field">
              <span>邮箱</span>
              <input
                v-model="email"
                type="email"
                placeholder="you@example.com"
                autocomplete="email"
                required
              />
            </label>

            <label class="field">
              <span>密码</span>
              <input
                v-model="password"
                type="password"
                :placeholder="isLogin ? '你的密码' : '至少 8 位'"
                :autocomplete="isLogin ? 'current-password' : 'new-password'"
                :minlength="isLogin ? undefined : 8"
                required
              />
            </label>

            <p v-if="error" class="form-error">{{ error }}</p>

            <button type="submit" class="btn btn-primary submit-btn" :disabled="loading">
              {{ loading ? '处理中…' : isLogin ? '登 录' : '注 册' }}
            </button>
          </form>

          <p class="switch-row">
            <template v-if="isLogin">还没有账号？</template>
            <template v-else>已有账号？</template>
            <button class="switch-btn" @click="toggleMode">
              {{ isLogin ? '立即注册' : '直接登录' }}
            </button>
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const { login, register, openAuthDialog } = useAuth()

const dialog = useState<{ open: boolean; mode: 'login' | 'register' }>('dsh-auth-dialog', () => ({
  open: false,
  mode: 'login',
}))

const email = ref('')
const password = ref('')
const displayName = ref('')
const error = ref('')
const loading = ref(false)
const githubLoading = ref(false)

const isLogin = computed(() => dialog.value.mode === 'login')

function close() {
  dialog.value.open = false
  error.value = ''
}

function toggleMode() {
  dialog.value.mode = isLogin.value ? 'register' : 'login'
  error.value = ''
}

async function submit() {
  error.value = ''
  loading.value = true
  try {
    if (isLogin.value) {
      await login(email.value.trim(), password.value)
    } else {
      await register(email.value.trim(), password.value, displayName.value.trim())
    }
    close()
    // 刷新页面数据（收藏状态等）
    refreshNuxtData()
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || '操作失败，请重试'
  } finally {
    loading.value = false
    githubLoading.value = false
  }
}

function refreshNuxtData() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nuxtApp = useNuxtApp() as any
  nuxtApp.refreshNuxtData?.()
}

// Esc 关闭
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.auth-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.auth-dialog {
  position: relative;
  width: 400px;
  max-width: 100%;
  padding: 30px 28px 24px;
  border-radius: var(--radius-xl);
  background: var(--bg-secondary);
  max-height: 90vh;
  overflow-y: auto;
}

/* 过渡动画 */
.auth-fade-enter-active,
.auth-fade-leave-active {
  transition: opacity var(--dur) var(--ease);
}
.auth-fade-enter-active .auth-dialog {
  transition: transform 0.25s var(--ease);
}
.auth-fade-enter-from,
.auth-fade-leave-to {
  opacity: 0;
}
.auth-fade-enter-from .auth-dialog {
  transform: translateY(16px) scale(0.97);
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

.auth-head {
  text-align: center;
  margin-bottom: 20px;
}

.auth-logo {
  width: 46px;
  height: 46px;
  margin: 0 auto 12px;
  border-radius: 11px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  color: #fff;
}

.auth-head h3 {
  font-size: 19px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.auth-head p {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* GitHub 按钮 */
.github-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 11px;
  border-radius: var(--radius-md);
  background: #fff;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  transition: all var(--dur) var(--ease);
}
.github-btn:hover {
  background: #e2e8f0;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0;
  color: var(--text-muted);
  font-size: 12px;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--glass-border);
}

/* 表单 */
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field input {
  padding: 10px 13px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}

.field input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(244, 97, 35, 0.15);
}

.field input::placeholder {
  color: var(--text-muted);
}

.form-error {
  font-size: 12px;
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}

.submit-btn {
  width: 100%;
  padding: 11px;
  font-size: 14px;
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.switch-row {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.switch-btn {
  margin-left: 6px;
  background: none;
  border: none;
  color: var(--primary-light);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.switch-btn:hover {
  text-decoration: underline;
}
</style>
