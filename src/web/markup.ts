/**
 * 界面骨架（内嵌字符串）。
 *
 * 注意：不要在本文件里写 ${ 这样的插值 —— 会被原样注入 HTML。
 * token 由客户端脚本从 URL query 读取。
 */

export const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Butler</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">DSH</span>
      <span>DSH Butler</span>
      <span class="brand-sub" id="app-version"></span>
    </div>
    <div class="topbar-right">
      <span class="badge" id="badge-dsh"><span class="dot"></span><span>检测中</span></span>
      <span class="badge" id="badge-service"><span class="dot"></span><span>检测中</span></span>
      <button class="btn" id="btn-refresh">刷新状态</button>
    </div>
  </header>

  <div class="body">
    <nav class="nav" id="nav">
      <button class="nav-item active" data-page="overview">总览</button>
      <button class="nav-item" data-page="env">环境与配置</button>
      <button class="nav-item" data-page="core">DSH 本体</button>
      <button class="nav-item" data-page="runtime">运行状态</button>
      <button class="nav-item" data-page="logs">日志</button>
      <div class="nav-sep"></div>
      <button class="nav-item" data-page="report">体检报告</button>
      <div class="nav-sep"></div>
      <div class="nav-hint">当前为只读版本（S1）：只检测、不修改。所有写操作将在后续阶段开放。</div>
    </nav>

    <main class="main" id="main">
      <div class="empty"><span class="spinner"></span> 正在加载…</div>
    </main>
  </div>
</div>

<div class="progress-wrap" id="progress-wrap">
  <div class="progress-head">
    <span class="spinner"></span>
    <strong id="progress-title">任务进行中</strong>
    <span id="progress-detail" style="color:var(--text-3)"></span>
    <button class="btn" id="btn-cancel" style="margin-left:auto">取消</button>
  </div>
  <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
  <div class="progress-steps" id="progress-steps"></div>
</div>

<div class="toast-host" id="toast-host"></div>
<script src="/app.js"></script>
</body>
</html>`;
