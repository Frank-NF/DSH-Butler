<template>
  <header class="site-header">
    <div class="container header-inner">
      <NuxtLink to="/" class="logo">
        <div class="logo-mark">DSH</div>
        <div class="logo-text">
          <span class="logo-title">DSH插件管家<span class="logo-version">v{{ liveVersion || appVersion }}</span></span>
          <span class="logo-sub">DeepSeek Harness 插件管理</span>
        </div>
      </NuxtLink>

      <nav class="nav-links">
        <NuxtLink to="/" class="nav-link" active-class="active">首页</NuxtLink>
        <NuxtLink to="/plugins" class="nav-link" active-class="active">插件市场</NuxtLink>
        <NuxtLink to="/bundles" class="nav-link" active-class="active">组合包</NuxtLink>
        <NuxtLink to="/download" class="nav-link" active-class="active">下载</NuxtLink>
        <NuxtLink to="/docs" class="nav-link" active-class="active">文档</NuxtLink>
        <NuxtLink to="/offline" class="nav-link" active-class="active">离线部署</NuxtLink>
      </nav>

      <div class="header-actions">
        <!-- 主题切换按钮 -->
        <button
          class="theme-toggle"
          :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
          @click="toggleTheme"
        >
          <svg v-if="theme === 'dark'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>

        <NuxtLink to="/download" class="btn btn-primary btn-sm download-btn">下载客户端</NuxtLink>

        <!-- 未登录 -->
        <button v-if="!user" class="btn btn-outline btn-sm login-btn" @click="openAuthDialog('login')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          登录
        </button>

        <!-- 已登录：用户菜单 -->
        <div v-else class="user-wrap" ref="userWrap">
          <button class="user-btn" aria-label="用户菜单" @click="menuOpen = !menuOpen">
            <img v-if="user.avatar_url" :src="user.avatar_url" :alt="user.display_name" class="user-avatar" referrerpolicy="no-referrer" />
            <span v-else class="user-avatar user-avatar-fallback">{{ avatarLetter }}</span>
            <span class="user-name">{{ user.display_name }}</span>
            <svg class="chev" :class="{ open: menuOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <Transition name="menu-fade">
            <div v-if="menuOpen" class="user-menu">
              <div class="menu-head">
                <div class="menu-name">{{ user.display_name }}</div>
                <div class="menu-email">{{ user.email || 'GitHub 登录' }}</div>
              </div>
              <NuxtLink to="/plugins?tab=favorites" class="menu-item" @click="menuOpen = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                我的收藏
              </NuxtLink>
              <NuxtLink v-if="user.role === 'admin'" to="/feedback" class="menu-item" @click="menuOpen = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>
                反馈管理
              </NuxtLink>
              <NuxtLink v-if="user.role === 'admin'" to="/admin/stats" class="menu-item" @click="menuOpen = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>
                站点统计
              </NuxtLink>
              <button class="menu-item" @click="handleLogout">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
                退出登录
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { version as appVersion } from '~/package.json'
import { useWebsiteTheme } from '~/composables/useWebsiteTheme'

const { user, logout, openAuthDialog } = useAuth()
const { theme, toggleTheme } = useWebsiteTheme()

// 版本号统一动态源：与首页/下载页一致，读 /api/updater/latest（服务器 version.json）。
// 历史上 logo 旁的版本号写死在 package.json，发版漏改就会长期显示旧版（曾停在 v1.15.0）。
// 现改为动态拉取，package.json 的 appVersion 仅作 API 不可用时的兜底，避免头部闪空。
const { data: latest } = await useFetch<{ version: string }>('/api/updater/latest', {
  default: () => ({ version: '' }),
}).catch(() => ({ data: ref({ version: '' }) }))
const liveVersion = computed(() => {
  const v = latest.value?.version || ''
  return /^\d+\.\d+\.\d+$/.test(v) && v !== '0.0.0' ? v : ''
})

const menuOpen = ref(false)
const userWrap = ref<HTMLElement | null>(null)

const avatarLetter = computed(() => user.value?.display_name?.charAt(0).toUpperCase() || '?')

async function handleLogout() {
  menuOpen.value = false
  await logout()
}

function onDocClick(e: MouseEvent) {
  if (userWrap.value && !userWrap.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(14, 16, 19, 0.92);
  border-bottom: 1px solid var(--line);
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

[data-theme='light'] .site-header {
  background: rgba(250, 250, 250, 0.92);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 60px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 11px;
  flex-shrink: 0;
}

.logo-mark {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 11px;
  color: #fff;
  letter-spacing: 0.3px;
}

.logo-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.logo-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.logo-version {
  display: inline-block;
  margin-left: 7px;
  padding: 0 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.7;
  vertical-align: 1px;
  color: var(--brand-light);
  background: var(--brand-dim);
  border: 1px solid rgba(244, 97, 35, 0.25);
}

.logo-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 26px;
}

.nav-link {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: color var(--dur) var(--ease);
  position: relative;
}

.nav-link:hover {
  color: var(--text-primary);
}

.nav-link.active {
  color: var(--text-primary);
}

.nav-link.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -19px;
  height: 2px;
  background: var(--brand);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ---------- 主题切换按钮 ---------- */
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: transparent;
  border: 1px solid var(--line-strong);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--dur) var(--ease);
  flex-shrink: 0;
}

.theme-toggle:hover {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-dim);
}

.theme-toggle svg {
  display: block;
}

/* ---------- 用户菜单 ---------- */
.user-wrap {
  position: relative;
}

.user-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  border-radius: 20px;
  background: transparent;
  border: 1px solid var(--line-strong);
  cursor: pointer;
  color: var(--text-primary);
  transition: border-color var(--dur) var(--ease);
}

.user-btn:hover {
  border-color: #454b55;
}

.user-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
}

.user-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-dim);
  color: var(--brand-light);
  font-size: 12px;
  font-weight: 700;
}

.user-name {
  font-size: 13px;
  font-weight: 500;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chev {
  color: var(--text-muted);
  transition: transform var(--dur) var(--ease);
}
.chev.open {
  transform: rotate(180deg);
}

.user-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 210px;
  padding: 6px;
  border-radius: var(--radius-lg);
  background: var(--bg-tertiary);
  border: 1px solid var(--line-strong);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: all 0.15s var(--ease);
}
.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.menu-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 6px;
}

.menu-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-email {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease);
}

.menu-item:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-primary);
}

[data-theme='light'] .menu-item:hover {
  background: var(--bg-hover-light, rgba(0, 0, 0, 0.04));
}

@media (max-width: 900px) {
  .nav-links {
    gap: 16px;
  }
  .logo-sub,
  .user-name,
  .chev {
    display: none;
  }
}

@media (max-width: 640px) {
  .nav-links {
    display: none;
  }
  .download-btn {
    display: none;
  }
}
</style>
