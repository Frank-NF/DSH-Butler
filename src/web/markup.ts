/**
 * 界面骨架（内嵌字符串）。
 *
 * 注意：不要在本文件里写 ${ 这样的插值 —— 会被原样注入 HTML。
 * token 由客户端脚本从 URL query 读取。
 *
 * 侧栏条目、弹窗内容、任务条内容都由 client.ts 动态填充，这里只留骨架与锚点。
 */

import { NAV_TIPS, OFFICIAL_SITE, STAGE_LABEL } from "../version.ts";

/** 侧栏底部官网链接（需求 10：加入官网地址入口；地址统一来自 version.ts）。 */
const OFFICIAL_SITE_URL = OFFICIAL_SITE;

/**
 * 阶段标签（⑨）：只检测/写开放这类开发阶段说明不再向普通用户展示，
 * 但 version_test 钉住「界面必须引用 STAGE_LABEL 这一唯一来源」——
 * 所以在 nav-foot 里保留一个 display:none 的 <span class="nav-stage">，
 * DOM 有值（测试可验证单一来源），界面上看不到（用户只看使用小技巧）。
 */
const NAV_STAGE = STAGE_LABEL;

export const INDEX_HTML = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Butler</title>
<link rel="stylesheet" href="/style.css">
<script>window.__NAV_TIPS__ = ${JSON.stringify(NAV_TIPS)};</script>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark"><img src="data:image/png;base64,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" width="26" height="26" alt="DSH管家"></span>
      <span>DSH管家</span>
      <span class="brand-tagline">让 DSH 始终好用</span>
      <span class="brand-sub" id="app-version"></span>
    </div>
    <div class="topbar-right">
      <span class="badge" id="badge-dsh"><span class="dot"></span><span>检测中</span></span>
      <span class="badge" id="badge-service"><span class="dot"></span><span>检测中</span></span>
      <button class="btn icon ghost" id="btn-theme" aria-label="切换深浅色" title="切换深浅色"></button>
      <button class="btn" id="btn-refresh">刷新</button>
      <button class="btn primary" id="btn-enter-dsh" data-enter-dsh data-enter-label="进入 DSH">
        <span>进入 DSH</span>
      </button>
    </div>
  </header>

  <div class="body">
    <nav class="nav" aria-label="主导航">
      <div id="nav-items"></div>
      <div class="nav-foot">
        <span class="nav-stage" aria-hidden="true">${NAV_STAGE}</span>
        <a class="nav-link" href="${OFFICIAL_SITE_URL}" target="_blank" rel="noreferrer noopener">DSH 官网</a>
        <div class="nav-tip" id="nav-tip" title="点一下换一条"></div>
        <button class="btn sm nav-settings" data-page="settings" aria-label="打开设置">设置</button>
      </div>
    </nav>
    <main class="main" id="main" tabindex="-1"></main>
  </div>
</div>

<div class="progress-wrap" id="progress-wrap">
  <div class="progress-head">
    <span class="spinner"></span>
    <strong id="progress-title">任务进行中</strong>
    <span id="progress-detail" style="color:var(--text-3)"></span>
    <button class="btn sm" id="btn-cancel" style="margin-left:auto">取消任务</button>
  </div>
  <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
  <div class="progress-steps" id="progress-steps"></div>
</div>

<div class="modal-backdrop" id="modal-backdrop">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head">
      <div class="modal-title" id="modal-title"></div>
      <div class="modal-sub" id="modal-sub"></div>
    </div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-foot" id="modal-foot"></div>
  </div>
</div>

<div class="toast-host" id="toast-host"></div>
<script src="/app.js"></script>
</body>
</html>`;
