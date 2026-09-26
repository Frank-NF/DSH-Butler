/**
 * 全局认证状态 composable
 * - useAuthUser(): 当前登录用户（null = 未登录）
 * - 首次访问时从 /api/auth/me 拉取
 * - login/register/logout 后调用 refresh() 同步
 */
interface AuthUser {
  id: number
  email: string | null
  display_name: string
  avatar_url: string | null
  role: string
}

let authUser: Ref<AuthUser | null> | null = null
let initialized = false

export function useAuth() {
  if (!authUser) {
    authUser = useState<AuthUser | null>('dsh-auth-user', () => null)
  }

  async function refresh() {
    try {
      const res = await $fetch<{ user: AuthUser | null }>('/api/auth/me')
      authUser!.value = res.user
    } catch {
      authUser!.value = null
    }
    initialized = true
  }

  // 首次进入页面拉取一次（客户端）
  if (import.meta.client && !initialized) {
    initialized = true
    refresh()
  }

  function openAuthDialog(mode: 'login' | 'register' = 'login') {
    useState<{ open: boolean; mode: 'login' | 'register' }>('dsh-auth-dialog', () => ({
      open: false,
      mode: 'login',
    })).value = { open: true, mode }
  }

  async function login(email: string, password: string) {
    const res = await $fetch<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    authUser!.value = res.user
    return res.user
  }

  async function register(email: string, password: string, displayName: string) {
    const res = await $fetch<{ user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: { email, password, display_name: displayName },
    })
    authUser!.value = res.user
    return res.user
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    authUser!.value = null
  }

  return {
    user: readonly(authUser),
    refresh,
    login,
    register,
    logout,
    openAuthDialog,
  }
}
