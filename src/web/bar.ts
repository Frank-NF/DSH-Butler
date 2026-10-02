/**
 * 注入到页面里的「管家悬浮条」（由 host 层的 injectOverlay 注入，DSH 页与管家页都注入）。
 *
 * 【为什么要注入】改成单窗口外壳之后，DSH 界面会把管家界面顶掉 —— 用户手里只剩托盘
 * 一条回程路，而 Windows 的托盘图标常被折叠进隐藏区、右键菜单也未必可靠。于是在 DSH
 * 自己的页面里放一个我们的小悬浮条：回管家、看服务状态、启停、重启。
 *
 * 【为什么管家自己的页面也要注入】以前认为"管家页面上本来就有这些按钮"，事实是用户
 * 找不到「关闭 DSH 服务」——首页那张状态卡只给一个主行动（进入/启动），停止服务要翻到
 * 运行状态页才有。现在两个界面都有这条悬浮条，启停/重启在哪都能点（2026-09-27 用户反馈）。
 * 管家页上「回管家」那颗按钮没有意义，所以按注入时给的 __DSH_BUTLER_HOME__ 判断是否已在
 * 管家页，在的话直接不生成它。
 *
 * 【别压住管家页自己的东西】管家页底部有一条任务进度条、右下角还有提示气泡，
 * 悬浮条按它们的实际高度把自己抬上去；打开确认弹窗时先把自己藏起来。
 *
 * 【与 Deno 侧怎么通信】不用 fetch（跨源 + CSP 都会挡），走 win.bind 暴露的原生绑定
 * bindings.butlerCmd(cmd) —— 同进程内的桥，不受 CSP / CORS 约束。
 *
 * 约束：本文件内容是原样注入的字符串 —— 不许出现反引号与插值写法（见 client.ts 同类注释）。
 */
export const BUTLER_BAR_JS = `(function () {
  'use strict';
  // DSH 是 SPA，路由切换不重载页面；这里再防一手重复注入。
  //
  // 【2026-10-02 修的根因】样式表挂在 head、宿主 div 挂在 body，是两次 append。
  // 页面侧重建 head（换主题、重建客户端 bundle）会只抹掉样式表、留下一条没样式的裸 div；
  // 而旧写法只查宿主 div，宿主还在就整段 return —— 样式表永远补不回来
  // （用户反馈：「右下角管家小图标总丢失，要不就是样式表没了」）。
  // 所以改成：两样都在才算注入过，只缺哪样就补哪样。
  var HOST_ID = 'dsh-butler-dock';
  var STYLE_ID = 'dsh-butler-dock-style';
  var host = document.getElementById(HOST_ID);
  var style = document.getElementById(STYLE_ID);
  if (host && style) return;

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
    // 【2026-09-25 审计 Q-11】脚本会输出 dbb-dot warn 这个类，但样式表里从来没定义过它 ——
    // 「服务已启动但还没就绪」于是显示成默认灰，和「已停止」看不出区别。
    '.dbb-dot.warn{background:#E0A03C}',
    '.dbb-sep{width:1px;height:18px;background:rgba(255,255,255,.16);margin:0 3px}',
    '.dbb-msg{max-width:260px;padding:0 8px;color:#BDBAB2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dbb-mini{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;',
    'background:rgba(24,22,18,.9);color:#EDEBE6;border:1px solid rgba(255,255,255,.14);',
    'box-shadow:0 6px 24px rgba(0,0,0,.28);backdrop-filter:blur(8px);cursor:pointer;font:inherit}',
    '.dbb-mini:hover{background:rgba(24,22,18,.95)}',
    // 【必须放最后】.dbb-hide 与 .dbb-mini 同为单类选择器，谁在后面谁赢；
    // 放前面会让"收起"失效（实测：两个胶囊同时挂在右下角）。
    '.dbb-hide{display:none}',
  ].join('');
  // 只缺样式表（宿主还在）：事件与定时器都绑在那个 div 上，补完样式就收手 ——
  // 继续往下走会把事件再绑一遍，点一下就多响应一次。
  if (host) {
    var s0 = document.createElement('style');
    s0.id = STYLE_ID;
    s0.textContent = CSS;
    document.head.appendChild(s0);
    return;
  }
  // 宿主没了、样式表还在：别再塞一个同 id 的 style（重复 id 谁也没法管）
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // 自动收起的时长由管家注入（设置里可调）；没有就用 3 秒
  var DBB_IDLE_MS = (typeof window.__DSH_BUTLER_IDLE_MS__ === 'number' && window.__DSH_BUTLER_IDLE_MS__ > 0)
    ? window.__DSH_BUTLER_IDLE_MS__ : 3000;
  // 管家界面的地址前缀（同样是管家注入的）：现在就在管家界面上时，不需要"回管家"这颗按钮
  var DBB_HOME = (typeof window.__DSH_BUTLER_HOME__ === 'string') ? window.__DSH_BUTLER_HOME__ : '';
  var AT_HOME = DBB_HOME !== '' && location.href.indexOf(DBB_HOME) === 0;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-state', 'expanded');
  // 管家标志：橙红小鲸鱼（与图标同源，用 currentColor 跟着按钮配色走）
  // 官方标志（橙红 D + 鲸鱼）：压在橙底按钮上看不清，所以垫一块奶白小方片
  var MARK = 'data:image/png;base64,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';
  var ICO_HOME = '<span class="dbb-chip"><img id="dbb-chip-img" src="' + MARK + '" width="13" height="13" alt=""></span>';
  var ICO_DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  // 已经在管家界面上时"回管家"是空动作，别摆一颗点不出反应的按钮
  var HOME_BTN = AT_HOME ? '' : [
    '<button class="dbb-btn dbb-primary" id="dbb-back" title="回到管家界面（Ctrl+Shift+B）">',
    ICO_HOME + '<span>管家</span>',
    '</button>',
    '<span class="dbb-sep"></span>',
  ].join('');
  host.innerHTML = [
    '<button class="dbb-mini dbb-hide" id="dbb-mini" title="管家工具箱">',
    '<span class="dbb-dot" id="dbb-mini-dot"></span><span>管家</span>',
    '</button>',
    '<div class="dbb-pill" id="dbb-pill">',
    HOME_BTN,
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

  /*
   * 【这一页如果是 Chromium 的错误页，立刻请宿主把界面救回去】
   *
   * 用户根本不该看到「127.0.0.1 拒绝连接」这种页面 —— 实测多半是页面上某条指向本机
   * 某个已经没在跑的服务地址的链接被点了一下（聊天里到处都是 127.0.0.1:端口 这种字样），
   * 一点就把整个界面顶掉，而 WebView2 里没有"后退"按钮，用户只能靠托盘或重开程序。
   * 宿主收到 recover 会重新导航（回到他原来待的那个界面）；真接不上时宿主那边还有
   * 30 秒一轮的看护兜底。这条检测放在最前面：晚一瞬用户就看见那张错误页了。
   */
  if (document.querySelector('#main-frame-error,#error-code,.neterror')) {
    // 真机实测（无头 Edge + 死端口）：错误页也在会话历史里，history.back() 能**秒回**
    // 被顶掉之前那一页，而且不用重刷 —— DSH 里的对话、输入框草稿都还在。
    //
    // 但不能只靠它：连续两次失败时，退回上一页可能落到的还是错误页（实测过），
    // 所以 1.2 秒后再看一眼 —— 还在错误页上就请宿主重新导航。
    // 退回成功的话，这个定时器随页面一起消失，宿主那边一点动静都不需要。
    try {
      if (history.length > 1) history.back();
    } catch (e) { /* 退回失败就等下面那次兜底 */ }
    setTimeout(function () {
      try {
        if (document.querySelector('#main-frame-error,#error-code,.neterror')) call('recover');
      } catch (e) { /* 通道不可用就算了，宿主 30 秒看护兜底 */ }
    }, 1200);
  }

  /*
   * 【点开"别的地址"时别把整个界面顶掉】—— 交给系统浏览器打开。
   *
   * 现场（2026-09-28 抓到实据）：日志里那次失败"想去的是 http://127.0.0.1:64119/"，
   * 上一站是 DSH（3081）—— 就是这个壳被一条本机链接顶掉了。聊天与插件面板里到处都是
   * 本机开发服务的地址（AI 五笔的 ui-host 就是随机端口，重启一次端口就变），
   * 点一下过期的链接，整个界面就变成「127.0.0.1 拒绝连接」，而 WebView2 没有后退按钮。
   * 同源链接一律放行（那是 DSH 自己的页面跳转），只有跨源才拦下来交给宿主。
   */
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el.tagName !== 'A') el = el.parentNode;
    if (!el || !el.getAttribute) return;
    var href = el.getAttribute('href') || '';
    if (href.slice(0, 6).toLowerCase() !== 'http:/' && href.slice(0, 7).toLowerCase() !== 'https:/') return;
    var u;
    try { u = new URL(el.href, location.href); } catch (e) { return; }
    if (u.origin === location.origin) return;             // 同源：DSH 自己的跳转，放行
    if (el.target && el.target !== '_self') return;       // 本来就开新窗口的，交给宿主
    ev.preventDefault();
    ev.stopPropagation();
    try { call('open-external', { url: u.href }); } catch (e) { /* 宿主不在就算了，还有救援兜底 */ }
  }, true);

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
    // 停止时把"我现在就在管家界面上"一并报上去：宿主据此决定还要不要切页面
    // （在管家页上再切一次等于把页面重刷，用户刚点的东西全没了）
    if (running) { act('stop', '停止', AT_HOME ? { atHome: true } : null); } else { act('start', '启动'); }
  });
  // 重启同理：在管家界面上点就不该被拽到 DSH 界面去
  $('dbb-restart').addEventListener('click', function () {
    act('restart', '重启', AT_HOME ? { atHome: true } : null);
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

  function act(cmd, label, arg) {
    if (busy) return;
    setBusy(true);
    say(label + '中…');
    call(cmd, arg).then(function (r) {
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

  // ── 在管家界面上躲开"本来就占着右下角"的东西 ──────────────────────
  //
  // DSH 页面里这些元素都不存在，量出来是 0，位置就是默认的右下角；
  // 管家页面上底部有任务进度条、右下角有提示气泡，悬浮条按它们的实际高度抬上去，
  // 免得"点一下按钮，弹出的提示被自己挡住"。
  function layout() {
    var bottom = 16;
    var pw = $('progress-wrap');
    if (pw && pw.className.indexOf('show') >= 0) bottom += pw.offsetHeight + 10;
    var th = $('toast-host');
    if (th) { var h = th.offsetHeight || 0; if (h > 0) bottom += h + 8; }
    host.style.bottom = bottom + 'px';
    // 确认弹窗打开时先藏起来：弹窗是来要答复的，悬浮条不该还浮在它上面
    var bd = $('modal-backdrop');
    host.style.display = (bd && bd.className.indexOf('show') >= 0) ? 'none' : '';
  }
  function watchDom(el) {
    if (!el || typeof MutationObserver === 'undefined') return;
    try {
      new MutationObserver(layout).observe(el, { attributes: true, childList: true, subtree: true });
    } catch (e) { /* 观察不了就算了：位置退回默认值 */ }
  }
  layout();
  watchDom($('progress-wrap'));
  watchDom($('toast-host'));
  watchDom($('modal-backdrop'));

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
    }, DBB_IDLE_MS);
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
  // 管家页上不生成这颗按钮（见 HOME_BTN），所以绑之前先判存在
  var backBtn = $('dbb-back');
  if (backBtn) backBtn.addEventListener('click', function () { call('back'); });
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
