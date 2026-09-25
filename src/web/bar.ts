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
    'background:rgba(24,22,18,.9);color:#EDEBE6;border:1px solid rgba(255,255,255,.14);',
    'box-shadow:0 6px 24px rgba(0,0,0,.28);backdrop-filter:blur(8px)}',
    '.dbb-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;',
    'border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer;',
    'font:inherit;white-space:nowrap;transition:background .12s ease}',
    '.dbb-btn:hover{background:rgba(255,255,255,.12)}',
    '.dbb-btn:focus-visible{outline:2px solid #FF8A5B;outline-offset:2px}',
    '.dbb-btn[disabled]{opacity:.5;cursor:default}',
    '.dbb-chip{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:#FAF8F5;flex:none}',
    '.dbb-chip img{display:block}',
    '.dbb-btn.dbb-primary{background:#C94A20;color:#fff;font-weight:500}',
    '.dbb-btn.dbb-primary:hover{background:#D9520F}',
    '.dbb-btn.dbb-danger{color:#F08A8A}',
    '.dbb-dot{width:7px;height:7px;border-radius:50%;background:#918E85;flex:none}',
    '.dbb-dot.ok{background:#8FBF5A}.dbb-dot.err{background:#F08A8A}',
    '.dbb-sep{width:1px;height:18px;background:rgba(255,255,255,.16);margin:0 3px}',
    '.dbb-msg{max-width:260px;padding:0 8px;color:#BDBAB2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dbb-mini{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;',
    'background:rgba(24,22,18,.9);color:#EDEBE6;border:1px solid rgba(255,255,255,.14);',
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
  // 官方标志（橙红 D + 鲸鱼）：压在橙底按钮上看不清，所以垫一块奶白小方片
  var MARK = 'data:image/png;base64,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';
  var ICO_HOME = '<span class="dbb-chip"><img id="dbb-chip-img" src="' + MARK + '" width="13" height="13" alt=""></span>';
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

  // ── 展开后闲置 3 秒自动收起 ────────────────────────────────────────
  // 需求：点开之后 3 秒没有动作、且鼠标不在展开条上，就自己收起来。
  // 鼠标一旦停在上面就不收（否则正要点按钮时它自己没了）；鼠标离开重新计时。
  var idleTimer = null;
  var hovering = false;
  function armAutoCollapse() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (host.getAttribute('data-state') !== 'expanded') return;
      if (hovering) return;
      setCollapsed(true);
    }, 3000);
  }
  host.addEventListener('mouseenter', function () {
    hovering = true;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  });
  host.addEventListener('mouseleave', function () {
    hovering = false;
    armAutoCollapse();
  });
  // 点任何按钮、或用键盘操作，都算"有动作"，重新计时
  host.addEventListener('click', function () { armAutoCollapse(); });
  host.addEventListener('keydown', function () { armAutoCollapse(); });

  function setCollapsed(collapsed) {
    host.setAttribute('data-state', collapsed ? 'collapsed' : 'expanded');
    $('dbb-pill').className = collapsed ? 'dbb-pill dbb-hide' : 'dbb-pill';
    $('dbb-mini').className = collapsed ? 'dbb-mini' : 'dbb-mini dbb-hide';
    try { localStorage.setItem('dsh-butler-dock', collapsed ? 'collapsed' : 'expanded'); } catch (e) { /* 忽略 */ }
    if (collapsed) {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    } else {
      armAutoCollapse();
    }
  }
  $('dbb-back').addEventListener('click', function () { call('back'); });
  // 标志图是 data URI：万一 DSH 页面的 CSP 不让加载，就把小方片藏掉，按钮只剩"管家"两个字
  var chipImg = document.getElementById('dbb-chip-img');
  if (chipImg) {
    chipImg.addEventListener('error', function () {
      var chip = chipImg.parentNode;
      if (chip) chip.style.display = 'none';
    });
  }
  $('dbb-state').addEventListener('click', function () { say('刷新中…'); refresh().then(function () { say(''); }); });
  $('dbb-collapse').addEventListener('click', function () { setCollapsed(true); });
  $('dbb-mini').addEventListener('click', function () { setCollapsed(false); });
  var saved = null;
  try { saved = localStorage.getItem('dsh-butler-dock'); } catch (e) { saved = null; }
  setCollapsed(saved === 'collapsed');
  refresh();
  setInterval(refresh, 15000);})();`;
