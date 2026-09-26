<template>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-content">
        <div class="footer-brand">
          <div class="brand-row">
            <div class="logo-mark">DSH</div>
            <h3>DSH插件管家</h3>
          </div>
          <p>
            独立运行的 DeepSeek Harness 插件管理工具：插件市场、行业组合包、
            MCP 服务管理、快照与离线部署，目录与自更新清单 Ed25519 验签。
          </p>
        </div>
        <div class="footer-column">
          <h4>产品</h4>
          <ul>
            <li><NuxtLink to="/plugins">插件市场</NuxtLink></li>
            <li><NuxtLink to="/bundles">行业组合包</NuxtLink></li>
            <li><NuxtLink to="/download">下载客户端</NuxtLink></li>
            <li><NuxtLink to="/offline">离线部署</NuxtLink></li>
          </ul>
        </div>
        <div class="footer-column">
          <h4>资源</h4>
          <ul>
            <li><NuxtLink to="/docs">用户手册</NuxtLink></li>
            <li>
              <a href="https://github.com/Frank-NF/DSH-PluginUpdater" target="_blank" rel="noopener">GitHub 源码</a>
            </li>
            <li>
              <a href="https://github.com/Frank-NF/DSH-PluginUpdater/releases" target="_blank" rel="noopener">版本发布记录</a>
            </li>
            <li>
              <a href="https://github.com/Frank-NF/DSH-PluginUpdater/issues" target="_blank" rel="noopener">问题反馈</a>
            </li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2026 DSH Plugin Updater · MIT License</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
</script>

<style scoped>
.site-footer {
  margin-top: 96px;
  border-top: 1px solid var(--line);
  background: var(--bg-secondary);
}

.footer-content {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 48px;
  padding: 56px 0 40px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 14px;
}

.logo-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 10px;
  color: #fff;
}

.footer-brand h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.footer-brand p {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.75;
  max-width: 360px;
}

.footer-column h4 {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 14px;
}

.footer-column ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.footer-column a {
  font-size: 13px;
  color: var(--text-secondary);
  transition: color var(--dur) var(--ease);
}

.footer-column a:hover {
  color: var(--text-primary);
}

.footer-bottom {
  border-top: 1px solid var(--line);
  padding: 18px 0;
}

.footer-bottom p {
  font-size: 12px;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .footer-content {
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
}
</style>
