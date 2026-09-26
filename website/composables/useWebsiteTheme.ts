/**
 * 主题 composable：dark / light 切换，持久化到 localStorage
 * 服务端渲染时 SSR-safe（typeof window 检查）
 */
const THEME_KEY = 'dsh-website-theme'

export type ThemeMode = 'dark' | 'light'

function loadTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'light' ? 'light' : 'dark'
}

export function useWebsiteTheme() {
  const theme = ref<ThemeMode>(loadTheme())

  function setTheme(mode: ThemeMode) {
    theme.value = mode
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_KEY, mode)
      document.documentElement.setAttribute('data-theme', mode)
    }
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  // 初始化：SSR 后同步到 DOM
  onMounted(() => {
    document.documentElement.setAttribute('data-theme', theme.value)
  })

  return { theme, setTheme, toggleTheme }
}
