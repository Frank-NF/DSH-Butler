/**
 * 界面样式（内嵌字符串）。
 *
 * 规范见 docs/UI-DESIGN-SYSTEM.md（v1.0，2026-09-24 定稿）。
 * 三条硬约束：
 *   1) 此文件内容会被原样注入 <style> —— 不许出现反引号与 ${ ；
 *   2) 组件里不许写死十六进制颜色，一律用语义令牌；
 *   3) 正文与次要文字在浅/深两套配色下对比度都要 ≥ 4.5:1。
 *
 * 深色模式由客户端脚本写入 <html data-theme="light|dark"> 决定（见 client.ts 的
 * applyTheme）：只有这一处选择器，不在 CSS 里重复第二套深色令牌。
 */

export const STYLE_CSS = `
/* ── 令牌 ───────────────────────────────────────────────────────── */

:root {
  --bg: #F6F5F2;
  --surface: #FFFFFF;
  --surface-2: #F1EFE9;
  --surface-3: #E9E6DE;
  --text: #232220;
  --text-2: #575652;
  --text-3: #6B6A64;
  --border: #DAD7CD;
  --border-strong: #B9B6AB;
  --brand: #F06A3D;          /* VI 主橙红（装饰用，不承载正文）*/
  --brand-text: #C24A1E;     /* 浅底上的品牌文字（4.6:1）*/
  --brand-fill: #C94A20;     /* 按钮实底：白字 4.7:1，过 AA */
  --brand-fill-hover: #B23C0B;
  --brand-weak: #FBEDE6;
  --ok: #3B6D11;
  --ok-weak: #EAF3DE;
  --warn: #8A5A0B;
  --warn-weak: #FAEEDA;
  --err: #A32D2D;
  --err-weak: #FCEBEB;
  --info: #17548C;
  --info-weak: #E6F1FB;
  --focus: #C94A20;
  --shadow-1: 0 1px 2px rgba(24, 22, 18, .05);
  --shadow-2: 0 18px 48px rgba(24, 22, 18, .18);
  --radius: 10px;
  --radius-sm: 8px;
  --dur-1: 120ms;
  --dur-2: 200ms;
  --ease: cubic-bezier(.2, .7, .3, 1);
  --font-ui: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, "SF Mono", "Courier New", monospace;
  --sidebar-w: 200px;
  --topbar-h: 52px;
}

:root[data-theme="dark"] {
  --bg: #171614;
  --surface: #1F1E1B;
  --surface-2: #262521;
  --surface-3: #2E2D28;
  --text: #EDEBE6;
  --text-2: #BDBAB2;
  --text-3: #918E85;
  --border: #35332E;
  --border-strong: #4A4740;
  --brand: #F0894E;          /* 暗底上用 VI 浅橙（6.7:1）*/
  --brand-text: #F0894E;
  --brand-fill: #C94A20;
  --brand-fill-hover: #B23C0B;
  --brand-weak: #3A2416;
  --ok: #8FBF5A;
  --ok-weak: #22301A;
  --warn: #E0A03C;
  --warn-weak: #33260F;
  --err: #F08A8A;
  --err-weak: #3A1F1F;
  --info: #7FB2E8;
  --info-weak: #16283C;
  --focus: #FF8A5B;
  --shadow-1: none;
  --shadow-2: 0 18px 48px rgba(0, 0, 0, .55);
}

/* ── 基础 ───────────────────────────────────────────────────────── */

* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { margin: 0; font-weight: 600; }
button, input, select, textarea { font-family: inherit; font-size: inherit; color: inherit; }
button { cursor: pointer; }
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 4px;
}
.tabular, .stat-value, .pill-count { font-variant-numeric: tabular-nums; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--text-3); }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: var(--text-3); background-clip: content-box; }
::-webkit-scrollbar-track { background: transparent; }

/* ── 骨架 ───────────────────────────────────────────────────────── */

.app { display: grid; grid-template-rows: var(--topbar-h) 1fr; height: 100vh; }

.topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 0 18px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14px; }
.brand-mark {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  flex: none;
}
.brand-mark img { width: 26px; height: 26px; display: block; }
/* 深色下浅橙底会发灰，换更淡的暖底，让橙红鲸鱼保持对比 */
:root[data-theme="dark"] .brand-mark { background: rgba(240, 106, 61, .16); }
.brand-tagline { color: var(--text-3); font-size: 12.5px; font-weight: 400; }
.brand-tagline::before { content: "·"; margin: 0 6px; color: var(--border-strong); }
.brand-sub { color: var(--text-3); font-size: 12.5px; font-weight: 400; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.body { display: grid; grid-template-columns: var(--sidebar-w) 1fr; min-height: 0; }

.nav { padding: 12px 10px 20px; border-right: 1px solid var(--border); background: var(--surface); overflow-y: auto; }
.nav-group { padding: 12px 10px 6px; font-size: 12px; font-weight: 600; color: var(--text-3); letter-spacing: .03em; }
.nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 10px; border-radius: var(--radius-sm);
  color: var(--text-2); user-select: none;
  border: none; background: none; width: 100%; text-align: left;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}
.nav-item svg { flex: none; }
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.active { background: var(--brand-weak); color: var(--brand-text); font-weight: 500; }
.nav-item .nav-count { margin-left: auto; font-size: 12px; color: var(--text-3); }
.nav-foot { margin-top: 16px; padding: 10px; border-top: 1px solid var(--border); color: var(--text-3); font-size: 12px; line-height: 1.55; }

.main { overflow-y: auto; padding: 22px 26px 96px; }
.wrap { max-width: 1040px; }

.page-head { margin-bottom: 18px; display: flex; align-items: flex-start; gap: 16px; }
.page-title { font-size: 18px; letter-spacing: -.01em; }
.page-desc { color: var(--text-2); margin: 4px 0 0; font-size: 13px; }
.page-tools { margin-left: auto; display: flex; gap: 8px; flex: none; }

/* ── 卡片 ───────────────────────────────────────────────────────── */

.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 18px; margin-bottom: 14px;
  box-shadow: var(--shadow-1);
}
.card-title { font-size: 13px; font-weight: 600; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
.card-title .sub { font-weight: 400; color: var(--text-3); font-size: 12.5px; overflow-wrap: anywhere; }
.card-title .spacer { margin-left: auto; }

.hero { border-left: 3px solid var(--border-strong); }
.hero.ok { border-left-color: var(--ok); }
.hero.warn { border-left-color: var(--warn); }
.hero.err { border-left-color: var(--err); }
.hero-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.hero-desc { color: var(--text-2); font-size: 13px; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.stat { padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
.stat-label { font-size: 12.5px; color: var(--text-3); }
.stat-value { font-size: 20px; font-weight: 600; margin-top: 2px; }
.stat-value.sm { font-size: 14px; font-weight: 500; padding-top: 4px; }
.stat-note { font-size: 12px; color: var(--text-3); margin-top: 2px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.kv { display: grid; grid-template-columns: 108px 1fr; gap: 8px; font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.kv:last-child { border-bottom: none; }
.kv .k { color: var(--text-3); }
.kv .v { color: var(--text); word-break: break-word; }

/* ── 按钮 ───────────────────────────────────────────────────────── */

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 13px; border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong); background: var(--surface); color: var(--text);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
  white-space: nowrap;
}
.btn:hover { background: var(--surface-2); }
.btn:active { background: var(--surface-3); }
.btn.primary { background: var(--brand-fill); border-color: var(--brand-fill); color: #fff; }
.btn.primary:hover { background: var(--brand-fill-hover); border-color: var(--brand-fill-hover); }
.btn.danger { background: var(--err-weak); border-color: var(--err); color: var(--err); }
.btn.danger:hover { background: var(--err); color: #fff; }
.btn.danger-solid { background: var(--err); border-color: var(--err); color: #fff; }
:root[data-theme="dark"] .btn.danger-solid { color: #1F1E1B; }
.btn.danger-solid:hover { filter: brightness(1.08); }
.btn.ghost { border-color: transparent; background: none; color: var(--text-2); }
.btn.ghost:hover { background: var(--surface-2); color: var(--text); }
.btn.sm { height: 26px; padding: 0 9px; font-size: 12.5px; }
.btn.icon { width: 32px; padding: 0; justify-content: center; }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn-note { color: var(--text-3); font-size: 12.5px; }

/* ── 列表行 ─────────────────────────────────────────────────────── */

.rows { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
  background: var(--surface);
  transition: background var(--dur-1) var(--ease);
}
.row:last-child { border-bottom: none; }
.row:hover { background: var(--surface-2); }
.row-main { min-width: 0; flex: 1; }
.row-name { font-weight: 500; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row-meta { color: var(--text-3); font-size: 12.5px; margin-top: 2px; display: flex; gap: 10px; flex-wrap: wrap; }
.row-actions { display: flex; gap: 6px; flex: none; }
.row-actions .btn { flex: none; }
.row.is-selected { background: var(--brand-weak); }

/* ── 状态徽章 ───────────────────────────────────────────────────── */

.badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 12px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text-2);
}
.badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); flex: none; }
.badge.ok { background: var(--ok-weak); border-color: var(--ok); color: var(--ok); }
.badge.ok .dot { background: var(--ok); }
.badge.warn { background: var(--warn-weak); border-color: var(--warn); color: var(--warn); }
.badge.warn .dot { background: var(--warn); }
.badge.err { background: var(--err-weak); border-color: var(--err); color: var(--err); }
.badge.err .dot { background: var(--err); }
.badge.info { background: var(--info-weak); border-color: var(--info); color: var(--info); }
.badge.info .dot { background: var(--info); }
.badge.plain { background: none; }
.badge.ok .dot.shape-ok { border-radius: 2px; }

.pill-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
  background: var(--surface-2); border: 1px solid var(--border);
  font-size: 12px; color: var(--text-2);
}

/* ── 问题条目（四要素） ──────────────────────────────────────────── */

.finding { border: 1px solid var(--border); border-left: 3px solid var(--border-strong); padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); margin-bottom: 8px; }
.finding.error { border-left-color: var(--err); }
.finding.warn { border-left-color: var(--warn); }
.finding.info { border-left-color: var(--info); }
.finding.ok { border-left-color: var(--ok); }
.finding-title { font-weight: 500; margin-bottom: 5px; display: flex; align-items: center; gap: 8px; }
.finding-row { color: var(--text-2); font-size: 12.5px; }
.finding-row b { color: var(--text); font-weight: 500; }
.finding-evidence {
  margin-top: 6px; padding: 6px 9px; border-radius: 6px;
  background: var(--surface-3); font-family: var(--font-mono);
  font-size: 11.5px; color: var(--text-2); max-height: 140px; overflow: auto;
  white-space: pre-wrap; word-break: break-all;
}
.tag { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 12px; border: 1px solid currentColor; flex: none; }
.tag.error { color: var(--err); }
.tag.warn { color: var(--warn); }
.tag.info { color: var(--info); }
.tag.ok { color: var(--ok); }

/* ── 日志/代码块 ────────────────────────────────────────────────── */

.logbox {
  background: #211F1C; color: #E8E6E1; border-radius: var(--radius-sm);
  padding: 10px 12px; font-family: var(--font-mono);
  font-size: 12px; line-height: 1.65; max-height: 420px; overflow: auto;
  white-space: pre-wrap; word-break: break-all;
}
:root[data-theme="dark"] .logbox { background: #100F0E; border: 1px solid var(--border); }
.logbox .ln { color: #6B6862; margin-right: 8px; user-select: none; }
:root[data-theme="dark"] .logbox .ln { color: #7A766E; }
.logbox .hit { background: rgba(244, 97, 35, .3); }

/* ── 计划弹窗 ───────────────────────────────────────────────────── */

.modal-backdrop {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(20, 18, 15, .45);
  display: none; align-items: center; justify-content: center; padding: 24px;
}
.modal-backdrop.show { display: flex; animation: fade var(--dur-2) var(--ease); }
.modal {
  width: 560px; max-width: 100%; max-height: 84vh;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: var(--shadow-2);
  display: flex; flex-direction: column;
  animation: rise var(--dur-2) var(--ease);
}
.modal-head { padding: 16px 18px 12px; border-bottom: 1px solid var(--border); }
.modal-title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.modal-sub { color: var(--text-2); font-size: 12.5px; margin-top: 4px; }
.modal-body { padding: 16px 18px; overflow-y: auto; }
.modal-foot { padding: 12px 18px 16px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
.modal-foot .spacer { margin-left: auto; }

.steps-ol { margin: 0; padding: 0; list-style: none; counter-reset: s; }
.steps-ol li {
  counter-increment: s; position: relative; padding: 0 0 12px 34px; font-size: 13px;
}
.steps-ol li::before {
  content: counter(s);
  position: absolute; left: 0; top: 0;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--brand-weak); color: var(--brand-text);
  display: grid; place-items: center; font-size: 12px; font-weight: 600;
}
.steps-ol li::after {
  content: ""; position: absolute; left: 11px; top: 24px; bottom: 2px; width: 1px; background: var(--border);
}
.steps-ol li:last-child { padding-bottom: 0; }
.steps-ol li:last-child::after { display: none; }
.steps-ol .step-desc { color: var(--text-3); font-size: 12.5px; }

.check {
  display: flex; align-items: flex-start; gap: 9px; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2);
  font-size: 13px; cursor: pointer;
}
.check input { margin: 3px 0 0; width: 15px; height: 15px; accent-color: var(--brand-fill); flex: none; }
.gate-note { color: var(--err); font-size: 12.5px; margin-top: 8px; }

/* ── 表单 ───────────────────────────────────────────────────────── */

.field { margin-bottom: 12px; }
.field-label { display: block; font-size: 12.5px; color: var(--text-2); margin-bottom: 5px; }
.input, .select, .textarea {
  width: 100%; padding: 7px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong); background: var(--surface); color: var(--text);
}
.textarea { font-family: var(--font-mono); font-size: 12.5px; min-height: 84px; resize: vertical; }
.field-help { color: var(--text-3); font-size: 12px; margin-top: 4px; }

/* ── 底部任务条 ─────────────────────────────────────────────────── */

.progress-wrap {
  position: fixed; left: var(--sidebar-w); right: 0; bottom: 0; z-index: 40;
  background: var(--surface); border-top: 1px solid var(--border);
  padding: 10px 26px 12px; display: none;
}
.progress-wrap.show { display: block; }
.progress-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.progress-head strong { font-size: 13px; }
.progress-bar { height: 4px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--brand); width: 0%; transition: width 250ms var(--ease); }
.progress-steps { display: flex; gap: 6px; margin-top: 9px; flex-wrap: wrap; }
.step {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: 999px; font-size: 12px;
  background: var(--surface-2); color: var(--text-3); border: 1px solid var(--border);
}
.step.done { color: var(--ok); border-color: var(--ok); background: var(--ok-weak); }
.step.running { color: var(--brand-text); border-color: var(--brand); background: var(--brand-weak); font-weight: 500; }
.step.failed { color: var(--err); border-color: var(--err); background: var(--err-weak); }
.step.skipped, .step.undone { color: var(--text-3); text-decoration: line-through; }

/* ── 空态 / 加载 / 提示 ─────────────────────────────────────────── */

.empty { padding: 30px 20px; text-align: center; color: var(--text-3); }
.empty .empty-title { color: var(--text-2); font-weight: 500; margin-bottom: 4px; }
.empty .btn { margin-top: 12px; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--brand);
  animation: spin .7s linear infinite; display: inline-block; vertical-align: -2px;
}
.toast-host { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 70; }
.toast {
  background: var(--text); color: var(--bg); padding: 10px 14px; border-radius: var(--radius-sm);
  font-size: 13px; max-width: 440px; box-shadow: var(--shadow-2);
  animation: rise var(--dur-2) var(--ease);
}
.toast.err { background: var(--err); color: #fff; }
.toast.warn { background: var(--warn); color: #fff; }
:root[data-theme="dark"] .toast { background: var(--surface-3); color: var(--text); border: 1px solid var(--border-strong); }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rise { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}

@media (max-width: 900px) {
  :root { --sidebar-w: 60px; }
  .nav-group, .nav-item span.label, .nav-count, .nav-foot { display: none; }
  .nav-item { justify-content: center; padding: 9px 0; }
  .brand-sub { display: none; }
}
`.trim();
