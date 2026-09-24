/**
 * 注入到 DSH 页面里的「管家悬浮条」（由 host 层的 injectOverlay 注入）。
 *
 * 【为什么要注入】改成单窗口外壳之后，DSH 界面会把管家界面顶掉 —— 用户手里只剩托盘
 * 一条回程路，而 Windows 的托盘图标常被折叠进隐藏区、右键菜单也未必可靠。于是在 DSH
 * 自己的页面里放一个我们的小悬浮条：回管家、看服务状态、启停、重启。
 *
 * 【与 Deno 侧怎么通信】不用 fetch（跨源 + CSP 都会挡），走 win.bind 暴露的原生绑定
 * bindings.butlerCmd(cmd) —— 同进程内的桥，不受 CSP / CORS 约束。
 *
 * 约束：本文件内容是原样注入的字符串 —— 不许出现反引号与插值写法（见 client.ts 同类注释）。
 */
export const BUTLER_BAR_JS = `(function () {
  'use strict';
  // DSH 是 SPA，路由切换不重载页面；这里再防一手重复注入
  if (document.getElementById('dsh-butler-dock')) return;

  var CSS = [
    '#dsh-butler-dock{position:fixed;right:16px;bottom:16px;z-index:2147483000;',
    'font-family:"Segoe UI Variable Text","Microsoft YaHei UI","PingFang SC",system-ui,sans-serif;',
    'font-size:12.5px;line-height:1.4;-webkit-font-smoothing:antialiased}',
    '#dsh-butler-dock *{box-sizing:border-box}',
    '.dbb-pill{display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;',
    'background:rgba(24,22,18,.86);color:#EDEBE6;border:1px solid rgba(255,255,255,.14);',
    'box-shadow:0 6px 24px rgba(0,0,0,.28);backdrop-filter:blur(8px)}',
    '.dbb-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;',
    'border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer;',
    'font:inherit;white-space:nowrap;transition:background .12s ease}',
    '.dbb-btn:hover{background:rgba(255,255,255,.12)}',
    '.dbb-btn:focus-visible{outline:2px solid #FF8A5B;outline-offset:2px}',
    '.dbb-btn[disabled]{opacity:.5;cursor:default}',
    '.dbb-btn.dbb-primary{background:#C2410C;color:#fff;font-weight:500}',
    '.dbb-btn.dbb-primary:hover{background:#D9520F}',
    '.dbb-btn.dbb-danger{color:#F08A8A}',
    '.dbb-dot{width:7px;height:7px;border-radius:50%;background:#918E85;flex:none}',
    '.dbb-dot.ok{background:#8FBF5A}.dbb-dot.err{background:#F08A8A}',
    '.dbb-sep{width:1px;height:18px;background:rgba(255,255,255,.16);margin:0 3px}',
    '.dbb-msg{max-width:260px;padding:0 8px;color:#BDBAB2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dbb-mini{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;',
    'background:rgba(24,22,18,.86);color:#EDEBE6;border:1px solid rgba(255,255,255,.14);',
    'box-shadow:0 6px 24px rgba(0,0,0,.28);backdrop-filter:blur(8px);cursor:pointer;font:inherit}',
    '.dbb-mini:hover{background:rgba(24,22,18,.95)}',
    // 【必须放最后】.dbb-hide 与 .dbb-mini 同为单类选择器，谁在后面谁赢；
    // 放前面会让"收起"失效（实测：两个胶囊同时挂在右下角）。
    '.dbb-hide{display:none}',
  ].join('');  var style = document.createElement('style');
  style.id = 'dsh-butler-dock-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  var host = document.createElement('div');
  host.id = 'dsh-butler-dock';
  host.setAttribute('data-state', 'expanded');
  // 管家标志：橙红小鲸鱼（与图标同源，用 currentColor 跟着按钮配色走）
  var ICO_HOME = '<svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true"><path d="M2.6 18.8c0-4.7 4-7.9 9.1-7.9 4.3 0 7.9 1.7 9.7 4.4l4.7-3.2c.4-.3.9 0 .9.5v3.1c0 .3-.1.6-.4.8l-1.9 1.5 1.9 1.5c.3.2.4.5.4.8v3.1c0 .5-.5.8-.9.5l-4.7-3.2c-1.8 2.7-5.4 4.4-9.7 4.4-5.1 0-9.1-3.2-9.1-7.9z" fill="currentColor"/></svg>';
  var ICO_DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  host.innerHTML = [
    '<button class="dbb-mini dbb-hide" id="dbb-mini" title="管家工具箱">',
    '<span class="dbb-dot" id="dbb-mini-dot"></span><span>管家</span>',
    '</button>',
    '<div class="dbb-pill" id="dbb-pill">',
    '<button class="dbb-btn dbb-primary" id="dbb-back" title="回到管家界面（Ctrl+Shift+B）">',
    ICO_HOME + '<span>管家</span>',
    '</button>',
    '<span class="dbb-sep"></span>',
    '<button class="dbb-btn" id="dbb-state" title="点一下刷新服务状态">',
    '<span class="dbb-dot" id="dbb-dot"></span><span id="dbb-state-text">读取中…</span>',
    '</button>',
    '<button class="dbb-btn" id="dbb-toggle" title="启动 / 停止 DSH 服务"><span id="dbb-toggle-text">停止</span></button>',
    '<button class="dbb-btn" id="dbb-restart" title="重启 DSH 服务">重启</button>',
    '<span class="dbb-sep"></span>',
    '<span class="dbb-msg" id="dbb-msg"></span>',
    '<button class="dbb-btn" id="dbb-collapse" title="收起（只留一个小状态钮）">',
    ICO_DOWN,
    '</button>',
    '</div>',
  ].join('');
  document.body.appendChild(host);

  /*
   * 定位在右下角：DSH 左侧是会话栏、中间是输入区、右上角有它自己的折叠按钮，
   * 右下角是唯一"怎么排都不会压到别人控件"的地方。默认展开成一条胶囊，
   * 点收起会变成一个小状态钮（展开/收起状态存 localStorage）。
   */

  function $(id) { return document.getElementById(id); }
  var busy = false;
  function say(text) { $('dbb-msg').textContent = text || ''; }
  function setBusy(on) {
    busy = on;
    $('dbb-toggle').disabled = on;
    $('dbb-restart').disabled = on;
  }
  function call(cmd, arg) {
    try {
      if (typeof bindings === 'undefined' || !bindings || typeof bindings.butlerCmd !== 'function') {
        return Promise.resolve({ ok: false, error: '与管家通信的通道不可用' });
      }
      return bindings.butlerCmd(cmd, arg || null);
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  $('dbb-toggle').addEventListener('click', function () {
    var running = host.getAttribute('data-running') === '1';
    if (running) { act('stop', '停止'); } else { act('start', '启动'); }
  });
  function renderState(st) {
    var dot = $('dbb-dot');
    var mini = $('dbb-mini-dot');
    var running = !!(st && st.running);
    var healthy = !!(st && st.healthy);
    var cls = running ? (healthy ? 'ok' : 'warn') : '';
    dot.className = 'dbb-dot' + (cls ? ' ' + cls : '');
    mini.className = 'dbb-dot' + (cls ? ' ' + cls : '');
    var label = !running ? '已停止' : (healthy ? '运行中' : '已启动·未就绪');
    $('dbb-state-text').textContent = label + (st && st.port ? ' · ' + st.port : '');
    $('dbb-toggle-text').textContent = running ? '停止' : '启动';
    $('dbb-toggle').className = 'dbb-btn' + (running ? ' dbb-danger' : '');
    host.setAttribute('data-running', running ? '1' : '0');
  }

  function refresh() {
    return call('status').then(function (st) {
      if (st && st.ok !== false) renderState(st);
      return st;
    });
  }

  function act(cmd, label) {
    if (busy) return;
    setBusy(true);
    say(label + '中…');
    call(cmd).then(function (r) {
      setBusy(false);
      if (r && r.ok === false) { say(r.error || (label + '失败')); return; }
      say(label + '完成');
      setTimeout(function () { say(''); }, 2500);
      return refresh();
    }).catch(function (e) {
      setBusy(false);
      say(label + '失败：' + (e && e.message ? e.message : e));
    });
  }

  function setCollapsed(collapsed) {
    host.setAttribute('data-state', collapsed ? 'collapsed' : 'expanded');
    $('dbb-pill').className = collapsed ? 'dbb-pill dbb-hide' : 'dbb-pill';
    $('dbb-mini').className = collapsed ? 'dbb-mini' : 'dbb-mini dbb-hide';
    try { localStorage.setItem('dsh-butler-dock', collapsed ? 'collapsed' : 'expanded'); } catch (e) { /* 忽略 */ }
  }
  $('dbb-back').addEventListener('click', function () { call('back'); });
  $('dbb-state').addEventListener('click', function () { say('刷新中…'); refresh().then(function () { say(''); }); });
  $('dbb-collapse').addEventListener('click', function () { setCollapsed(true); });
  $('dbb-mini').addEventListener('click', function () { setCollapsed(false); });
  var saved = null;
  try { saved = localStorage.getItem('dsh-butler-dock'); } catch (e) { saved = null; }
  setCollapsed(saved === 'collapsed');
  refresh();
  setInterval(refresh, 15000);})();`;
