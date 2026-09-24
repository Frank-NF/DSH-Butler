/**
 * 界面样式（内嵌字符串）。
 *
 * 主题沿用旧版管家 v4.1 的视觉基因：橙红主色 #F46123、浅色默认、克制的中性灰阶。
 * S1 阶段用内嵌字符串，避免编译态资源路径问题；S3 接 Vue3 时改为构建产物。
 *
 * 注意：此文件内容会被原样注入 <style>，不要写反引号与 ${。
 */

export const STYLE_CSS = `
:root {
  --brand: #F46123;
  --brand-weak: #FAECE7;
  --bg: #F7F6F3;
  --surface: #FFFFFF;
  --surface-2: #F1EFE8;
  --text: #2C2C2A;
  --text-2: #5F5E5A;
  --text-3: #888780;
  --border: #D3D1C7;
  --border-2: #B4B2A9;
  --ok: #3B6D11;
  --ok-weak: #EAF3DE;
  --warn: #BA7517;
  --warn-weak: #FAEEDA;
  --err: #A32D2D;
  --err-weak: #FCEBEB;
  --info: #185FA5;
  --info-weak: #E6F1FB;
  --radius: 12px;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  font-family: "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
button { font-family: inherit; font-size: inherit; cursor: pointer; }

.app { display: grid; grid-template-rows: 52px 1fr; height: 100vh; }

.topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 0 18px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14px; }
.brand-mark {
  width: 24px; height: 24px; border-radius: 7px;
  background: var(--brand); color: #fff;
  display: grid; place-items: center;
  font-size: 12px; font-weight: 600;
}
.brand-sub { color: var(--text-3); font-size: 12px; font-weight: 400; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 12px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text-2);
}
.badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }
.badge.ok { background: var(--ok-weak); border-color: #C0DD97; color: var(--ok); }
.badge.ok .dot { background: var(--ok); }
.badge.warn { background: var(--warn-weak); border-color: #FAC775; color: var(--warn); }
.badge.warn .dot { background: var(--warn); }
.badge.err { background: var(--err-weak); border-color: #F7C1C1; color: var(--err); }
.badge.err .dot { background: var(--err); }

.body { display: grid; grid-template-columns: 188px 1fr; min-height: 0; }

.nav { padding: 12px 10px; border-right: 1px solid var(--border); background: var(--surface); overflow-y: auto; }
.nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 8px;
  color: var(--text-2); cursor: pointer; user-select: none;
  border: none; background: none; width: 100%; text-align: left;
}
.nav-item:hover { background: var(--surface-2); }
.nav-item.active { background: var(--brand-weak); color: var(--brand); font-weight: 500; }
.nav-sep { height: 1px; background: var(--border); margin: 10px 4px; }
.nav-hint { padding: 8px 10px; color: var(--text-3); font-size: 12px; }

.main { overflow-y: auto; padding: 20px 22px 40px; }
.page-head { margin-bottom: 16px; }
.page-title { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
.page-desc { color: var(--text-2); margin: 0; }

.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 18px; margin-bottom: 14px;
}
.card-title { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: var(--text); }
.card-title .sub { font-weight: 400; color: var(--text-3); margin-left: 8px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
.kv { display: flex; gap: 8px; font-size: 13px; padding: 5px 0; border-bottom: 1px dashed var(--border); }
.kv:last-child { border-bottom: none; }
.kv .k { color: var(--text-3); flex: none; width: 96px; }
.kv .v { color: var(--text); word-break: break-all; }
.mono { font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; }

.btn {
  padding: 7px 14px; border-radius: 8px;
  border: 1px solid var(--border-2); background: var(--surface); color: var(--text);
}
.btn:hover { background: var(--surface-2); }
.btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.btn.primary:hover { filter: brightness(1.06); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-row { display: flex; gap: 8px; flex-wrap: wrap; }

.finding { border-left: 3px solid var(--border-2); padding: 10px 12px; border-radius: 6px; background: var(--surface-2); margin-bottom: 8px; }
.finding.error { border-left-color: var(--err); background: var(--err-weak); }
.finding.warn { border-left-color: var(--warn); background: var(--warn-weak); }
.finding.info { border-left-color: var(--info); background: var(--info-weak); }
.finding-title { font-weight: 500; margin-bottom: 5px; display: flex; align-items: center; gap: 8px; }
.finding-row { color: var(--text-2); font-size: 12px; }
.finding-row b { color: var(--text); font-weight: 500; }
.finding-evidence {
  margin-top: 6px; padding: 6px 9px; border-radius: 6px;
  background: rgba(0,0,0,.04); font-family: Consolas, monospace;
  font-size: 11.5px; color: var(--text-2); max-height: 120px; overflow: auto;
  white-space: pre-wrap; word-break: break-all;
}
.tag { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; border: 1px solid currentColor; }
.tag.error { color: var(--err); }
.tag.warn { color: var(--warn); }
.tag.info { color: var(--info); }
.tag.ok { color: var(--ok); }

.logbox {
  background: #22201E; color: #E8E6E1; border-radius: 8px;
  padding: 10px 12px; font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 11.5px; line-height: 1.65; max-height: 440px; overflow: auto;
  white-space: pre-wrap; word-break: break-all;
}
.logbox .ln { color: #6B6862; margin-right: 8px; user-select: none; }
.logbox .hit { background: rgba(244,97,35,.28); }

.progress-wrap { position: fixed; left: 188px; right: 0; bottom: 0; background: var(--surface); border-top: 1px solid var(--border); padding: 10px 22px; display: none; }
.progress-wrap.show { display: block; }
.progress-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.progress-bar { height: 4px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--brand); width: 0%; transition: width .25s ease; }
.progress-steps { display: flex; gap: 14px; margin-top: 8px; flex-wrap: wrap; font-size: 12px; color: var(--text-3); }
.progress-steps .step.done { color: var(--ok); }
.progress-steps .step.running { color: var(--brand); font-weight: 500; }
.progress-steps .step.failed { color: var(--err); }

.empty { padding: 26px; text-align: center; color: var(--text-3); }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--brand);
  animation: spin .7s linear infinite; display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
.toast-host { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; z-index: 50; }
.toast { background: var(--text); color: #fff; padding: 9px 14px; border-radius: 8px; font-size: 12.5px; max-width: 420px; }
.toast.err { background: var(--err); }
.toast.warn { background: var(--warn); }
`.trim();
