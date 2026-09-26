<template>
  <div class="app">
    <SiteHeader />
    <main class="main-content">
      <NuxtPage />
    </main>
    <SiteFooter />
    <AuthDialog />
  </div>
</template>

<script setup lang="ts">
</script>

<style>
/* 页面骨架：深色主题由 assets/css/main.css 统一提供 */
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-primary);
}

.main-content {
  flex: 1;
}
</style>
