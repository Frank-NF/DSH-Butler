<template>
  <div class="offline-page">
    <section class="page-head">
      <div class="container">
        <h1>离线部署</h1>
        <p>把插件组合包带到无外网的环境：导出离线包 → 离线机导入，两步完成</p>
      </div>
    </section>

    <section class="offline-body">
      <div class="container">
        <div class="hero-actions card">
          <div class="online-info">
            <div>
              <h3>需要先在联网机器上打包</h3>
              <p>客户端内置「快照与离线打包」：扫描已安装插件，生成自包含离线包（含全部插件文件与依赖清单），无需手动收集目录</p>
            </div>
          </div>
          <div class="hero-btns">
            <a href="dshupdater://offline" class="btn btn-primary">打开离线打包</a>
            <a href="dshupdater://open" class="btn btn-outline">打开工具</a>
          </div>
        </div>

        <div class="section-title">
          <h2>三步完成</h2>
          <p>全程不需要离线机访问外网</p>
        </div>

        <div class="steps-grid">
          <div class="step-card card">
            <div class="step-no num">1</div>
            <h3>联网机：生成离线包</h3>
            <p>在装有客户端的联网机器上，进入「快照与离线打包」→「离线部署」→ 选择要带走的插件 → 生成 <code>.zip</code> 离线包（含依赖清单与校验信息）</p>
          </div>
          <div class="step-card card">
            <div class="step-no num">2</div>
            <h3>物理转移</h3>
            <p>通过 U 盘 / 内网共享等方式把离线包复制到目标机器。包内自包含，转移过程零外网依赖</p>
          </div>
          <div class="step-card card">
            <div class="step-no num">3</div>
            <h3>离线机：一键导入</h3>
            <p>目标机器安装客户端后，打开「快照与离线打包」→「导入离线包」→ 选择 zip 即可还原全部插件，逐项校验完整性</p>
          </div>
        </div>

        <div class="note-card card">
          <h3>适用场景</h3>
          <ul>
            <li>企业内网 / 隔离区机器需要统一的插件环境</li>
            <li>一次打包，多台同构机器批量分发</li>
            <li>外网受限环境下的插件升级接力（联网机代拉新版本 → 离线包中转）</li>
          </ul>
          <p class="note-foot">需要先安装桌面客户端最新版（协议唤起与导入功能随客户端提供）。</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
useSiteSeo({
  title: '离线部署',
  description: '无网络环境还原插件方案：导出插件快照清单、打包离线安装包，跨机器迁移与版本回退一步完成。',
  path: '/offline',
})
</script>

<style scoped>
.page-head {
  padding: 72px 0 40px;
}

.offline-body {
  padding-bottom: 40px;
}

/* ---------- 打包引导横幅 ---------- */
.hero-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 28px;
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
  max-width: 520px;
}

.hero-btns {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* ---------- 三步 ---------- */
.section-title {
  margin-top: 56px;
  margin-bottom: 28px;
}

.steps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.step-card {
  padding: 24px;
}

.step-no {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
  color: var(--brand-light);
  background: var(--brand-dim);
  border: 1px solid rgba(244, 97, 35, 0.28);
  margin-bottom: 14px;
}

.step-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.step-card p {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.step-card code {
  font-size: 12px;
  color: var(--brand-light);
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
}

/* ---------- 适用场景 ---------- */
.note-card {
  margin-top: 40px;
  padding: 26px 28px;
}

.note-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
}

.note-card ul {
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.9;
  margin-bottom: 14px;
}

.note-foot {
  font-size: 12.5px;
  color: var(--text-muted);
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
</style>
