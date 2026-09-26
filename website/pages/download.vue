<template>
  <div class="download-page">
    <section class="page-head">
      <div class="container">
        <h1>下载</h1>
        <p>桌面客户端 · Windows 10/11 x64 · v{{ winVersion }}</p>
      </div>
    </section>

    <section class="download-body">
      <div class="container">
        <div class="download-grid">
          <div class="download-card card">
            <div class="platform-head">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 5.5 10.5 4v7.3L3 11.8zM12 3.8 21 2.5v9.3l-9 .1zM3 13l7.5.1v7L3 18.8zM12 13.2l9-.1v9l-9-1.3z"/></svg>
              <h3>Windows</h3>
              <span class="badge badge-primary mono">v{{ winVersion }}</span>
            </div>
            <ul class="download-info">
              <li>Windows 10 1903+ / Windows 11，x64</li>
              <li>NSIS 安装包，安装后自动创建快捷方式</li>
              <li>约 {{ winSizeMB }} MB</li>
            </ul>
            <a :href="winUrl" download class="btn btn-primary download-btn">
              下载安装包
            </a>
            <p class="download-hash mono" :title="winSha256">SHA256 {{ winSha256Short }}</p>
          </div>

          <div class="download-card card">
            <div class="platform-head">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m4 15 7-11 1 6h7l-7 11-1-6z"/></svg>
              <h3>Linux</h3>
              <span class="badge badge-muted mono">AppImage</span>
            </div>
            <template v-if="linuxReady">
              <ul class="download-info">
                <li>Ubuntu 20.04+ / Debian 11+，x86_64</li>
                <li>AppImage 格式，chmod +x 后直接运行</li>
                <li>约 {{ linuxSizeMB }} MB</li>
              </ul>
              <a :href="linuxUrl" download class="btn btn-outline download-btn">下载 .AppImage</a>
              <p class="download-hash mono" :title="linuxSha256">SHA256 {{ linuxSha256Short }}</p>
            </template>
            <template v-else>
              <ul class="download-info">
                <li>Ubuntu 20.04+ / Debian 11+，x86_64</li>
                <li>AppImage 格式，chmod +x 后直接运行</li>
              </ul>
              <a class="btn btn-outline download-btn is-disabled" aria-disabled="true">暂未提供</a>
              <p class="download-hash mono">可先使用 Windows 版</p>
            </template>
          </div>
        </div>

        <!-- 一键唤起（dshupdater:// 协议） -->
        <div class="online-banner card">
          <div class="online-info">
            <div>
              <h3>已装过客户端？</h3>
              <p>从这里直接唤起（需已安装最新版，协议随客户端自动注册）</p>
            </div>
          </div>
          <div class="online-actions">
            <a href="dshupdater://open" class="btn btn-outline btn-sm">打开工具</a>
            <a href="dshupdater://check-updates" class="btn btn-outline btn-sm">检查插件更新</a>
            <NuxtLink to="/offline" class="btn btn-outline btn-sm">离线部署 →</NuxtLink>
          </div>
        </div>

        <!-- 安装说明 -->
        <div class="install-guide">
          <h3>安装说明</h3>
          <div class="guide-grid">
            <div class="guide-item card">
              <h4>Windows</h4>
              <ol>
                <li>下载 .exe 安装包</li>
                <li>双击运行安装程序</li>
                <li>按向导完成安装</li>
                <li>从开始菜单启动</li>
              </ol>
            </div>
            <div class="guide-item card">
              <h4>Linux</h4>
              <ol>
                <li>下载 .AppImage 文件</li>
                <li>
                  添加执行权限：<code>chmod +x DSH-*.AppImage</code>
                </li>
                <li>命令行或双击运行</li>
              </ol>
            </div>
            <div class="guide-item card">
              <h4>首次使用</h4>
              <ol>
                <li>「自动扫描」定位插件目录</li>
                <li>「组合包」标签页按行业安装套件</li>
                <li>检查并更新插件（先看清更新日志，再决定要不要升；更新前自动备份）</li>
                <li>「设置」里集中配置 MCP 服务（服务器同步默认留空，按需自填）</li>
              </ol>
            </div>
          </div>
        </div>

        <!-- 系统要求（id=security：首页深链至此） -->
        <div id="security" class="sys-req card">
          <h3>系统要求</h3>
          <div class="req-grid">
            <div class="req-item">
              <span class="req-label">Windows</span>
              <span>Windows 10 1903+ / Windows 11，x64</span>
            </div>
            <div class="req-item">
              <span class="req-label">Linux</span>
              <span>Ubuntu 20.04+ / Debian 11+，x86_64</span>
            </div>
            <div class="req-item">
              <span class="req-label">内存</span>
              <span>≥ 4GB RAM</span>
            </div>
            <div class="req-item">
              <span class="req-label">磁盘</span>
              <span>≥ 500MB 可用空间</span>
            </div>
            <div class="req-item">
              <span class="req-label">网络</span>
              <span>需访问 GitHub 与 npm 源（客户端支持代理与国内镜像）</span>
            </div>
            <div class="req-item">
              <span class="req-label">安全</span>
              <span>目录 / 自更新清单 Ed25519 验签，更新包 SHA256 校验</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
interface PlatformAsset {
  version?: string
  url?: string
  sha256?: string
  size_bytes?: number
}
interface LatestInfo {
  version: string
  platforms: Record<string, PlatformAsset>
  changelog: string[]
  published_at: string | null
}

// 最新发布信息：单一权威源 /api/updater/latest（服务器 version.json）
const { data: latest } = await useFetch<LatestInfo>('/api/updater/latest')

const win = computed(() => latest.value?.platforms?.windows || null)
const linux = computed(() => latest.value?.platforms?.linux || null)

const winVersion = computed(() => win.value?.version || latest.value?.version || '')
const winUrl = computed(() => win.value?.url || '/dsh-plugin-updater.exe')
const winSha256 = computed(() => win.value?.sha256 || '')
const winSha256Short = computed(() => (win.value?.sha256 || '').slice(0, 16) + '…')
const winSizeMB = computed(() =>
  win.value?.size_bytes ? Math.round((win.value.size_bytes / 1024 / 1024) * 10) / 10 : '—'
)

const linuxReady = computed(() => !!linux.value?.url)
const linuxVersion = computed(() => linux.value?.version || latest.value?.version || '')
const linuxUrl = computed(() => linux.value?.url || '#')
const linuxSha256 = computed(() => linux.value?.sha256 || '')
const linuxSha256Short = computed(() => (linux.value?.sha256 || '').slice(0, 16) + '…')
const linuxSizeMB = computed(() =>
  linux.value?.size_bytes ? Math.round((linux.value.size_bytes / 1024 / 1024) * 10) / 10 : '—'
)

useSiteSeo({
  title: '下载',
  description: '下载 DSH插件管家 Windows 安装包：独立运行、2189+ 插件市场、行业组合包一键安装。提供官方 SHA256 校验值，下载前可验证文件完整性。',
  path: '/download',
})

// SoftwareApplication 结构化数据：搜索引擎富摘要（版本/价格/评分）
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'DSH插件管家',
        operatingSystem: 'Windows 10/11, Linux',
        applicationCategory: 'DeveloperApplication',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
        description: 'DeepSeek Harness 生态插件管理桌面工具：2189+ 插件市场、行业组合包、MCP 服务管理、快照与离线部署。',
      }),
    },
  ],
})
</script>

<style scoped>
.page-head {
  padding: 72px 0 40px;
}

.download-body {
  padding-bottom: 40px;
}

/* ---------- 唤起横幅 ---------- */
.online-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px;
  margin-top: 56px;
  flex-wrap: wrap;
}

.online-info h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.online-info p {
  font-size: 13px;
  color: var(--text-secondary);
}

.online-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* ---------- 下载卡片 ---------- */
.download-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  max-width: 760px;
}

.download-card {
  padding: 28px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.platform-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
  margin-bottom: 18px;
}

.platform-head h3 {
  font-size: 17px;
  font-weight: 600;
}

.download-info {
  list-style: none;
  margin-bottom: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.download-info li {
  font-size: 13px;
  color: var(--text-secondary);
  padding-left: 18px;
  position: relative;
}

.download-info li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 8px;
  width: 5px;
  height: 5px;
  border-radius: 1.5px;
  background: var(--brand);
  opacity: 0.85;
}

.download-btn {
  margin-top: auto;
}

.download-btn.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.download-hash {
  margin-top: 14px;
  font-size: 11px;
  color: var(--text-muted);
}

/* ---------- 安装说明 ---------- */
.install-guide {
  margin-top: 56px;
}

.install-guide h3 {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 20px;
}

.guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.guide-item {
  padding: 22px;
}

.guide-item h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.guide-item ol {
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.guide-item li {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.guide-item code {
  font-size: 12px;
  color: var(--brand-light);
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
}

/* ---------- 系统要求 ---------- */
.sys-req {
  margin-top: 40px;
  padding: 26px 28px;
}

.sys-req h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.req-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.req-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.req-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.req-item span:last-child {
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
