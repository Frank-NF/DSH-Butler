/**
 * 界面骨架（内嵌字符串）。
 *
 * 注意：不要在本文件里写 ${ 这样的插值 —— 会被原样注入 HTML。
 * token 由客户端脚本从 URL query 读取。
 *
 * 侧栏条目、弹窗内容、任务条内容都由 client.ts 动态填充，这里只留骨架与锚点。
 */

import { STAGE_LABEL, UI_WRITE_ENABLED } from "../version.ts";

/**
 * 侧栏底部那行提示语。
 *
 * 单独抽出来，是因为它必须跟着版本阶段常量走：写死「只读版本（S1）」会与启动日志、
 * 总览接口对不上。用拼接而不是把变量塞进 INDEX_HTML —— 后者是原样注入的模板串，
 * 里面不能出现 ${（会连同表达式一起注进 HTML）。
 */
const NAV_HINT = UI_WRITE_ENABLED
  ? `${STAGE_LABEL}：写操作已开放，动手前会先把计划摊给你确认。`
  : `${STAGE_LABEL}：界面上只检测、不修改；写操作目前只在命令行可用。`;

export const INDEX_HTML = `<!doctype html>
<html lang="zh-CN" data-theme="light">
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
      <span class="brand-mark"><svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><path d="M2.6 18.8c0-4.7 4-7.9 9.1-7.9 4.3 0 7.9 1.7 9.7 4.4l4.7-3.2c.4-.3.9 0 .9.5v3.1c0 .3-.1.6-.4.8l-1.9 1.5 1.9 1.5c.3.2.4.5.4.8v3.1c0 .5-.5.8-.9.5l-4.7-3.2c-1.8 2.7-5.4 4.4-9.7 4.4-5.1 0-9.1-3.2-9.1-7.9z" fill="#F46123"/><circle cx="10.3" cy="16.6" r="1.7" fill="#201D1A"/><circle cx="10.9" cy="15.9" r=".6" fill="#FFF0E8"/><circle cx="15.4" cy="6.2" r="2" fill="#F46123" opacity=".3"/><circle cx="19.4" cy="4" r="1.4" fill="#F46123" opacity=".3"/></svg></span>
      <span>DSH Butler</span>
      <span class="brand-sub" id="app-version"></span>
    </div>
    <div class="topbar-right">
      <span class="badge" id="badge-dsh"><span class="dot"></span><span>检测中</span></span>
      <span class="badge" id="badge-service"><span class="dot"></span><span>检测中</span></span>
      <button class="btn icon ghost" id="btn-theme" aria-label="切换深浅色" title="切换深浅色"></button>
      <button class="btn" id="btn-refresh">刷新</button>
    </div>
  </header>

  <div class="body">
    <nav class="nav" aria-label="主导航">
      <div id="nav-items"></div>
      <div class="nav-foot">` + NAV_HINT + `</div>
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
