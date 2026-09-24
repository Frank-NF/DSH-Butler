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
      <span class="brand-mark">DSH</span>
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
