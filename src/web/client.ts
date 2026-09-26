/**
 * 客户端脚本（内嵌字符串）。
 *
 * 约束（原样注入 <script>，违反即全站白屏）：
 *   - 不使用反引号；不出现 美元符加大括号 的插值写法；字符串一律用单引号拼接。
 *   - JS 里需要换行符的地方（如 join 的实参）在本文件里写成双反斜杠 n：
 *     TS 模板串吃掉一层，发出的 JS 里是标准的反斜杠 n。
 *
 * 令牌怎么来的：桌面态下【不能】依赖 URL —— 窗口是 deno desktop 运行时自己导航的，
 * 我们塞不进 query。服务端会在响应里下发一个 HttpOnly 的同源 cookie，浏览器自动携带
 * （EventSource 也一样），所以这里根本不需要知道令牌是什么。只有用浏览器打开
 * ?t=<令牌> 的开发场景才回退到读 query 并手动加请求头。
 *
 * 视觉与交互规范见 docs/UI-DESIGN-SYSTEM.md（v1.0）：
 *   - 写操作一律先 POST /api/plan 拿计划 → 弹窗摊开步骤与写前检查 → 勾选确认才执行；
 *   - 状态永远「色 + 字」双重编码，不靠颜色单独表意；
 *   - 空态 / 加载态 / 错误态三态齐全。
 */

export const CLIENT_JS = `(function () {
  'use strict';

  var TOKEN = new URLSearchParams(location.search).get('t') || '';
  var state = {
    page: 'overview',
    cache: {},
    extra: {},
    /** 外壳状态（能不能直接进 DSH）—— 由总览页填充。 */
    shell: null,
    job: null,
    es: null,
    modalOpen: false,
    lastFocus: null,
    pendingPlan: null,
    logFilter: '',
    /** 插件市场：搜索词、分类、排序、状态筛选与页码（界面上切换时只改这里再重渲染）。 */
    market: { q: '', cat: '', sort: 'downloads', state: 'all', page: 1, force: false, picked: [], view: 'list' }
  };

  // ── 基础工具 ─────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function humanSize(b) {
    if (b === null || b === undefined) return '-';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], v = b, i = 0;
    while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtDur(ms) {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) return ms + ' ms';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + ' 秒';
    return Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒';
  }
  function tail(p) { var a = String(p || '').split(/[\\\\/]/); return a[a.length - 1] || p; }
  // 相对时间：时间线上「2 小时前」比裸时间戳好扫（绝对时间同时显示，两者不冲突）
  function fmtAgo(iso) {
    var t = new Date(iso).getTime();
    if (!t || isNaN(t)) return '';
    var d = Date.now() - t;
    if (d < 60000) return '刚刚';
    var m = Math.floor(d / 60000);
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var dd = Math.floor(h / 24);
    if (dd < 30) return dd + ' 天前';
    return Math.floor(dd / 30) + ' 个月前';
  }
  function healthText(h) { return h === 'error' ? '发现错误' : h === 'warn' ? '发现警告' : '一切正常'; }
  function healthClass(h) { return h === 'error' ? 'err' : h === 'warn' ? 'warn' : 'ok'; }

  // ── 主题（唯一决定 <html data-theme> 的地方） ─────────────────────

  var THEME_KEY = 'butler-theme';
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme() {
    var pref = '';
    try { pref = localStorage.getItem(THEME_KEY) || ''; } catch (e) { pref = ''; }
    var dark = pref === 'dark' || (pref !== 'light' && !!(mql && mql.matches));
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var b = $('btn-theme');
    if (b) {
      b.innerHTML = dark ? ICON.sun : ICON.moon;
      var tip = dark ? '切换到浅色' : '切换到深色';
      b.title = tip;
      b.setAttribute('aria-label', tip);
    }
  }
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function toggleTheme() {
    try { localStorage.setItem(THEME_KEY, isDark() ? 'light' : 'dark'); } catch (e) { /* 忽略 */ }
    applyTheme();
  }
  if (mql && mql.addEventListener) mql.addEventListener('change', applyTheme);

  // ── 图标（内联 SVG，16px，不用 emoji、不用图标字体） ──────────────

  var SVG_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    grid: SVG_OPEN + '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    sliders: SVG_OPEN + '<path d="M4 6h9M18 6h2M4 12h4M13 12h7M4 18h9M18 18h2"/><circle cx="15" cy="6" r="2"/><circle cx="11" cy="12" r="2"/><circle cx="15" cy="18" r="2"/></svg>',
    box: SVG_OPEN + '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
    activity: SVG_OPEN + '<path d="M3 12h4l2.5-6 4.5 12 2.5-6H21"/></svg>',
    puzzle: SVG_OPEN + '<path d="M9 4a2 2 0 0 1 4 0v1h4a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v4a1 1 0 0 1-1 1h-4v1a2 2 0 0 1-4 0v-1H5a1 1 0 0 1-1-1v-4H3a2 2 0 0 1 0-4h1V6a1 1 0 0 1 1-1h4z"/></svg>',
    terminal: SVG_OPEN + '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9.5 10 12l-3 2.5M13 15h4"/></svg>',
    clipboard: SVG_OPEN + '<path d="M9 4h6v3H9z"/><path d="M15 5.5h2a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h2"/><path d="M9 13.5l2 2 4-4"/></svg>',
    list: SVG_OPEN + '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
    history: SVG_OPEN + '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v4h4"/><path d="M12 8v4.5l3 1.5"/></svg>',
    sun: SVG_OPEN + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>',
    moon: SVG_OPEN + '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
    refresh: SVG_OPEN + '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
    plus: SVG_OPEN + '<path d="M12 5v14M5 12h14"/></svg>',
    trash: SVG_OPEN + '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
    wrench: SVG_OPEN + '<path d="M15 3a5 5 0 0 0-4.5 7.2L4 16.7V20h3.3l6.5-6.5A5 5 0 0 0 21 9l-3 2-2-2z"/></svg>',
    shield: SVG_OPEN + '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    play: SVG_OPEN + '<path d="M7 4.5 19 12 7 19.5z"/></svg>',
    upload: SVG_OPEN + '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
    check: SVG_OPEN + '<path d="M5 13l4 4L19 7"/></svg>',
    chevron: SVG_OPEN + '<path d="M9 6l6 6-6 6"/></svg>',
    deploy: SVG_OPEN + '<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    store: SVG_OPEN + '<path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M3.2 10 5 5.2A1 1 0 0 1 5.9 4.5h12.2a1 1 0 0 1 .9.7L20.8 10"/><path d="M9.5 14h5"/></svg>',
    search: SVG_OPEN + '<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.6-3.6"/></svg>',
    external: SVG_OPEN + '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
  };
  function icon(name) { return ICON[name] || ''; }

  // ── 提示 / 请求 ──────────────────────────────────────────────────

  function toast(msg, kind) {
    var host = $('toast-host');
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    d.title = '点击关闭';
    d.addEventListener('click', function () { d.remove(); });
    host.appendChild(d);
    setTimeout(function () { d.remove(); }, kind === 'err' ? 9000 : 5200);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'content-type': 'application/json' };
    if (TOKEN) headers['x-butler-token'] = TOKEN;
    var init = { method: opts.method || 'GET', headers: headers };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) {
          var msg = t;
          try { var j = JSON.parse(t); if (j && j.error) msg = j.error; } catch (e) { /* 非 JSON */ }
          throw new Error(msg || ('HTTP ' + r.status));
        }
        try { return JSON.parse(t); } catch (e) { return t; }
      });
    });
  }

  // ── 动作元数据 ───────────────────────────────────────────────────

  var ACT_TITLE = {
    'diag.healthCheck': '全面体检', 'env.probe': '环境体检', 'core.status': '本体状态',
    'core.verify': '本体校验', 'core.update': '更新 DSH 本体', 'core.finishUpdate': '完成更新',
    'core.rollback': '回滚本体', 'runtime.status': '服务状态', 'runtime.logs': '日志收集',
    'runtime.diagnose': '运行时诊断', 'runtime.repair': '修复僵尸锁',
    'runtime.start': '启动 DSH 服务', 'runtime.stop': '停止 DSH 服务', 'runtime.restart': '重启 DSH 服务',
    'plugin.scan': '插件扫描', 'plugin.diagnose': '插件诊断', 'plugin.install': '安装插件',
    'plugin.uninstall': '卸载插件', 'plugin.repair': '修复插件', 'plugin.cleanResidue': '清理安装残留',
    'plugin.cleanBackups': '清理历史备份',
    'plugin.deps': '依赖冲突体检', 'plugin.syncLock': '重建锁文件',
    'plugin.batchUpdate': '批量更新插件',
    'data.export': '导出搬移包', 'data.inspect': '检查搬移包',
    'data.restore': '从搬移包恢复', 'data.backup': '立即备份一次', 'data.backups': '备份列表',
    'bootstrap.plan': '一键部署', 'bootstrap.apply': '开始部署',
    'bootstrap.verify': '部署校验', 'bootstrap.discard': '放弃部署',
    'backup.list': '回滚点列表', 'backup.create': '创建回滚点', 'backup.apply': '回滚到该点',
    'backup.preview': '影响预览',
    'backup.delete': '删除回滚点', 'backup.verify': '校验回滚点'
  };
  var ACT_DANGER = {
    'plugin.uninstall': true, 'plugin.cleanResidue': true, 'core.update': true,
    'core.finishUpdate': true, 'core.rollback': true, 'backup.apply': true,
    'backup.delete': true, 'runtime.repair': true,
    'runtime.stop': true, 'runtime.start': true, 'runtime.restart': true
  };
  var KIND_LABEL = {
    'core-build': '本体构建', 'plugin-set': '插件集', 'config': '配置', 'snapshot': '快照', 'env': '环境'
  };
  var STATUS_LABEL = {
    queued: '排队中', running: '进行中', succeeded: '成功', failed: '失败',
    cancelled: '已取消', timeout: '超时'
  };

  function paramsFor(action, el) {
    var name = el && el.getAttribute ? (el.getAttribute('data-name') || '') : '';
    var id = el && el.getAttribute ? (el.getAttribute('data-id') || '') : '';
    // 先看有没有传现成的参数（一键修会带），有就以它为准
    var raw = el && el.getAttribute ? (el.getAttribute('data-params') || '') : '';
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (e) { /* 解析不了就走下面的按动作取参 */ }
    }
    if (action === 'plugin.install' || action === 'plugin.uninstall' || action === 'plugin.repair') return { name: name };
    // 带 id 的动作必须在这里登记 —— 漏登记的表现是「按钮看着正常，点下去说没给参数」
    // （2026-09-26：backup.preview 就漏过，点了报「未指定要预览哪个回滚点」）。
    if (action === 'backup.apply' || action === 'backup.delete' || action === 'backup.verify' ||
      action === 'backup.preview') return { id: id };
    if (action === 'core.rollback') return id ? { id: id } : {};
    return {};
  }

  // ── 渲染小工具 ───────────────────────────────────────────────────

  function badge(kind, text, title) {
    return '<span class="badge ' + kind + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><span class="dot"></span>' + esc(text) + '</span>';
  }
  function kv(k, v, mono) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v' + (mono ? ' mono' : '') + '">' + esc(v) + '</span></div>';
  }
  function stat(label, value, note, small) {
    return '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value' + (small ? ' sm' : '') + '">' + esc(value) + '</div>' + (note ? '<div class="stat-note">' + esc(note) + '</div>' : '') + '</div>';
  }
  function pageHead(title, desc, tools) {
    return '<div class="page-head"><div><h1 class="page-title">' + esc(title) + '</h1><p class="page-desc">' + esc(desc) + '</p></div>' + (tools ? '<div class="page-tools">' + tools + '</div>' : '') + '</div>';
  }
  function setMain(html) { $('main').innerHTML = '<div class="wrap">' + html + '</div>'; }
  function loading(text) {
    setMain('<div class="empty"><span class="spinner"></span> ' + esc(text || '正在检测…') + '</div>');
  }
  function emptyBox(title, desc, extra) {
    return '<div class="empty"><div class="empty-title">' + esc(title) + '</div><div>' + esc(desc || '') + '</div>' + (extra || '') + '</div>';
  }
  function actBtn(iconName, label, action, cls) {
    return '<button class="btn ' + (cls || 'sm') + '" data-act="' + esc(action) + '">' + icon(iconName) + '<span>' + esc(label) + '</span></button>';
  }
  function writeBtn(iconName, label, action, opts, cls) {
    opts = opts || {};
    var attrs = ' data-write="' + esc(action) + '"';
    if (opts.name) attrs += ' data-name="' + esc(opts.name) + '"';
    if (opts.id) attrs += ' data-id="' + esc(opts.id) + '"';
    // 任意参数（体检结论上的一键修会用）：JSON 塞进属性，读回来再解析。
    // esc() 会把引号转成实体，HTML 解析时自动还原，不会破坏属性。
    if (opts.params && Object.keys(opts.params).length) {
      attrs += ' data-params="' + esc(JSON.stringify(opts.params)) + '"';
    }
    return '<button class="btn ' + (cls || 'sm') + '"' + attrs + ' title="' + esc(label) + '">' + icon(iconName) + '<span>' + esc(label) + '</span></button>';
  }
  function navBtn(iconName, label, page, cls) {
    return '<button class="btn ' + (cls || 'sm') + '" data-page="' + esc(page) + '">' + icon(iconName) + '<span>' + esc(label) + '</span></button>';
  }
  /**
   * 「进入 DSH」——同一个窗口从管家界面换成 DSH 界面（不是另开一扇窗）。
   *
   * 成功的标志是页面被整个换掉，所以别指望成功提示能被看到：
   * 只有失败时才留在原地报错，并把可能的原因刷新出来。
   */
  function enterDsh(el) {
    var label = el && el.getAttribute ? (el.getAttribute('data-enter-label') || '进入 DSH') : '进入 DSH';
    if (el) {
      el.disabled = true;
      el.innerHTML = '<span class="spinner"></span><span>正在进入 DSH…</span>';
    }
    toast('正在进入 DSH（首次要把服务起起来，可能要十几秒）');
    return api('/api/dsh/enter', { method: 'POST' }).then(function () {
      if (el) { el.disabled = false; el.innerHTML = icon('external') + '<span>' + esc(label) + '</span>'; }
      toast('已进入 DSH');
    }).catch(function (e) {
      if (el) { el.disabled = false; el.innerHTML = icon('external') + '<span>' + esc(label) + '</span>'; }
      toast('进不去：' + (e && e.message ? e.message : e), 'err');
      state.cache = {};
      go(state.page, true);
    });
  }

  /**
   * 外壳状态卡 —— 打开程序第一眼看到的东西。
   *
   * 这一屏只允许有一个主行动：能进就直接进 DSH；没装就去部署；服务没起就起了再进。
   * 四种状态各对应一句人话 + 一个按钮，别让用户自己想"我该点哪"。
   */
  function shellCard() {
    var s = state.shell;
    var kind = s && s.next === 'enter' ? 'ok' : 'warn';
    var html = '<div class="card hero ' + kind + '">';
    if (!s || s.next === 'deploy') {
      html += '<div class="hero-title">这台机器还没装 DSH</div>'
        + '<div class="hero-desc">' + esc(s ? s.note : '先做一次一键部署；装完之后这个窗口就是 DSH 本体。') + '</div>'
        + '<div class="btn-row" style="margin-top:12px">' + navBtn('deploy', '去一键部署', 'bootstrap', 'primary') + '</div>';
    } else if (s.next === 'enter') {
      html += '<div class="hero-title">DSH 已就绪</div><div class="hero-desc">' + esc(s.note) + '</div>'
        + '<div class="btn-row" style="margin-top:12px">'
        + '<button class="btn primary" data-enter-dsh data-enter-label="进入 DSH">' + icon('external') + '<span>进入 DSH</span></button>'
        + '</div>';
    } else if (s.next === 'start') {
      html += '<div class="hero-title">DSH 已装好，服务没在跑</div><div class="hero-desc">' + esc(s.note) + '</div>'
        + '<div class="btn-row" style="margin-top:12px">'
        + '<button class="btn primary" data-enter-dsh data-enter-label="启动并进入">' + icon('play') + '<span>启动并进入</span></button>'
        + '</div>';
    } else {
      html += '<div class="hero-title">DSH 已经在外面运行</div><div class="hero-desc">' + esc(s.note) + '</div>'
        + '<div class="btn-row" style="margin-top:12px">'
        + '<button class="btn primary" data-enter-dsh data-enter-label="接管并进入">' + icon('refresh') + '<span>接管并进入</span></button>'
        + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderFindings(findings) {
    if (!findings || findings.length === 0) return '<div class="empty"><div class="empty-title">未发现问题</div><div>所有检查项都通过了。</div></div>';
    var order = { error: 0, warn: 1, info: 2 };
    var list = findings.slice().sort(function (a, b) { return (order[a.severity] || 9) - (order[b.severity] || 9); });
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var tag = f.severity === 'error' ? '错误' : f.severity === 'warn' ? '警告' : '提示';
      html += '<div class="finding ' + esc(f.severity) + '">';
      html += '<div class="finding-title"><span class="tag ' + esc(f.severity) + '">' + tag + '</span>' + esc(f.title) + '</div>';
      if (f.cause) html += '<div class="finding-row"><b>原因：</b>' + esc(f.cause) + '</div>';
      if (f.impact) html += '<div class="finding-row"><b>影响：</b>' + esc(f.impact) + '</div>';
      if (f.action) html += '<div class="finding-row"><b>建议：</b>' + esc(f.action) + '</div>';
      // 【P0-1 · 2026-09-25】结论上自带修复入口时，直接给一个按钮 ——
      // 以前只印一句「建议…」，用户得自己找地方点；现在点下去就走 plan→确认→执行，
      // 执行完本页会自动重载并重新体检（复检），形成「发现问题 → 一键修 → 再看一遍」的闭环。
      if (f.fixAction) {
        html += '<div class="finding-fix">' + writeBtn(
          'wrench',
          f.fixLabel || ACT_TITLE[f.fixAction] || '一键修',
          f.fixAction,
          { params: f.fixParams || {} },
          'sm primary',
        ) + '</div>';
      }
      if (f.evidence && f.evidence.length) html += '<div class="finding-evidence">' + esc(f.evidence.slice(0, 8).join('\\n')) + '</div>';
      html += '</div>';
    }
    return html;
  }

  function diagCard(title, r) {
    return '<div class="card hero ' + healthClass(r.health) + '">'
      + '<div class="card-title">' + esc(title) + '<span class="sub">规则 ' + (r.rulesRun || 0) + ' 条 · ' + fmtTime(r.checkedAt) + '</span></div>'
      + renderFindings(r.findings) + '</div>';
  }

  // ── 任务与进度 ───────────────────────────────────────────────────

  function showProgress(title) {
    $('progress-wrap').classList.add('show');
    $('progress-title').textContent = title;
    $('progress-detail').textContent = '';
    $('progress-fill').style.width = '0%';
    $('progress-steps').innerHTML = '';
  }
  function hideProgress() { $('progress-wrap').classList.remove('show'); }
  function renderSteps(steps) {
    var html = '';
    for (var i = 0; i < steps.length; i++) {
      html += '<span class="step ' + esc(steps[i].status) + '">' + esc(steps[i].title) + '</span>';
    }
    $('progress-steps').innerHTML = html;
  }

  /**
   * 订阅任务事件流。
   *
   * 【2026-09-25 审计 Q-10】SSE 的 onerror 只代表「这条连接断了」——刷新页面、瞬时网络抖动、
   * 服务重启都会触发它，**不等于任务失败**。旧实现 300ms 后直接按「已结束」收尾，任务其实还在跑，
   * 界面却弹「失败：任务进行中」，进度条也消失不再恢复。
   * 现在的做法：断线先问一次任务真实状态 —— 还在跑就重连（指数退避，最多 5 次），只有终态才收尾。
   */
  function waitJob(jobId, title) {
    showProgress(title || '任务进行中');
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      var MAX_ATTEMPTS = 5;

      function connect() {
        var url = '/api/jobs/' + jobId + '/events' + (TOKEN ? '?t=' + encodeURIComponent(TOKEN) : '');
        var es = new EventSource(url);
        state.es = es;
        var closed = false;

        function drop() {
          closed = true;
          try { es.close(); } catch (e) { /* 已关闭 */ }
          if (state.es === es) state.es = null;
        }

        function finish() {
          if (closed) return;
          drop();
          state.job = null;
          hideProgress();
          api('/api/jobs/' + jobId).then(function (job) {
            if (job.status === 'succeeded') resolve(job.result);
            else reject(new Error(job.error || ('任务' + (STATUS_LABEL[job.status] || job.status))));
          }, reject);
        }

        function retry() {
          attempts++;
          if (attempts > MAX_ATTEMPTS) { finish(); return; }
          var wait = Math.min(1000 * Math.pow(2, attempts - 1), 8000);
          setTimeout(function () { if (!closed) connect(); }, wait);
        }

        es.onmessage = function (e) {
          var ev;
          try { ev = JSON.parse(e.data); } catch (err) { return; }
          if (ev.data && Array.isArray(ev.data.steps)) {
            renderSteps(ev.data.steps);
            $('progress-fill').style.width = Math.round((ev.data.progress || 0) * 100) + '%';
          }
          if (ev.type === 'step-log' && ev.message) $('progress-detail').textContent = ev.message;
          if (ev.type === 'step-start') $('progress-detail').textContent = ev.message || '';
          if (ev.type === 'step-done') {
            var pct = Math.round((ev.progress || 0) * 100);
            if (pct) $('progress-fill').style.width = pct + '%';
          }
          if (ev.type === 'done') finish();
        };
        es.onerror = function () {
          if (closed) return;
          drop();
          api('/api/jobs/' + jobId).then(function (job) {
            if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'timeout') {
              closed = false;
              finish();
              return;
            }
            closed = false;
            retry();
          }, function () {
            closed = false;
            retry();
          });
        };
      }

      connect();
    });
  }

  function runAction(action, params, title) {
    return api('/api/jobs', { method: 'POST', body: { action: action, params: params || {} } })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '无法创建任务');
        // 记下正在跑的任务：进度条上的「取消」按钮靠它才能找到要取消谁。
        state.job = res.jobId;
        return waitJob(res.jobId, title);
      })
      .catch(function (e) {
        // ④ 同域互斥（典型：卸载在跑时又去装/卸）—— 错误文案已带当前步骤，
        // 这里再引导一次：进度条就显示那个任务，别傻等。
        var msg = e && e.message ? e.message : String(e);
        if (msg.indexOf('正在进行中') >= 0) {
          toast(msg, 'warn');
          adoptRunningJob();
        }
        throw e;
      });
  }

  // ④ 后台还有任务在跑时（窗口刚打开 / 切页回来 / 任务页重渲染），把进度条挂回去：
  // 拉一次任务列表找 running/queued 的，重新订阅它的 SSE 并显示当前步骤链。
  function adoptRunningJob() {
    if (state.job) return; // 自己发起的还在跟踪
    api('/api/jobs?limit=50').then(function (list) {
      var running = null;
      for (var i = 0; i < (list || []).length; i++) {
        if (list[i].status === 'running' || list[i].status === 'queued') { running = list[i]; break; }
      }
      if (!running) return;
      state.job = running.id;
      waitJob(running.id, running.actionTitle || '任务进行中').then(function () {
        state.cache = {}; // 结果落地了：缓存作废，回到页面时重新取
      }, function () { /* 任务失败：错误已经由各弹窗报告过，这里不再重复 */ });
    }).catch(function () { /* 拉不到任务列表就不打扰 */ });
  }

  function cancelJob() {
    if (!state.job) { toast('当前没有可取消的任务', 'warn'); return; }
    var id = state.job;
    api('/api/jobs/' + id + '/cancel', { method: 'POST' })
      .then(function () { toast('已请求取消，正在收尾'); })
      .catch(function (e) { toast('取消失败：' + (e.message || e), 'err'); });
  }

  // ── 弹窗 ─────────────────────────────────────────────────────────

  function openModal(o) {
    state.lastFocus = document.activeElement;
    $('modal-title').innerHTML = o.title || '';
    var sub = $('modal-sub');
    sub.textContent = o.sub || '';
    sub.style.display = o.sub ? '' : 'none';
    $('modal-body').innerHTML = o.body || '';
    $('modal-foot').innerHTML = o.foot || '';
    $('modal-backdrop').classList.add('show');
    state.modalOpen = true;
    var focusable = $('modal-body').querySelector('input, textarea, select, button') || $('modal-foot').querySelector('button');
    if (focusable) { try { focusable.focus(); } catch (e) { /* 忽略 */ } }
  }

  function closeModal() {
    $('modal-backdrop').classList.remove('show');
    state.modalOpen = false;
    // 关窗即视为「不执行」：否则计划确认的 Promise 会永远悬着（Esc / 点遮罩都会走到这里）。
    if (state.pendingPlan) {
      var resolve = state.pendingPlan;
      state.pendingPlan = null;
      resolve(false);
    }
    if (state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus(); } catch (e) { /* 忽略 */ } }
  }

  function errorModal(title, msg, sub) {
    openModal({
      title: esc(title),
      sub: sub || '',
      body: '<div class="finding error"><div class="finding-title"><span class="tag error">失败</span>操作未完成</div><div class="finding-row explain-text">' + esc(msg) + '</div></div>',
      foot: '<span class="spacer"></span><button class="btn" id="modal-close">知道了</button>'
    });
    $('modal-close').addEventListener('click', closeModal);
  }

  /**
   * extras.action === 'plugin.install'，且错误级问题【只有】「插件已安装」时，
   * 弹窗额外给一个「卸载并安装」按钮（resolve('reinstall')）。
   * 用户点更新/安装就是想换成目标版本，被拦下后还得自己先去卸载再回来点一次，
   * 属于白跑一趟 —— 既然建议写的就是「先卸载再装」，那就直接给他一键做掉。
   */
  function confirmPlan(plan, danger, extras) {
    extras = extras || {};
    return new Promise(function (resolve) {
      var findings = plan.findings || [];
      var errors = findings.filter(function (f) { return f.severity === 'error'; });
      var onlyInstalled = errors.length > 0;
      for (var ei = 0; ei < errors.length; ei++) {
        if (errors[ei].id !== 'plugin.already-installed') onlyInstalled = false;
      }
      var canReinstall = onlyInstalled && extras.action === 'plugin.install' &&
        !!extras.params && !!extras.params.name;
      var steps = plan.steps || [];
      var body = '';
      if (steps.length) {
        body += '<div class="card-title">执行步骤<span class="sub">共 ' + steps.length + ' 步</span></div>';
        body += '<ol class="steps-ol">';
        for (var i = 0; i < steps.length; i++) body += '<li>' + esc(steps[i]) + '</li>';
        body += '</ol>';
      } else {
        body += '<div class="finding info"><div class="finding-title"><span class="tag info">提示</span>该动作没有细分的步骤</div></div>';
      }
      if (findings.length) {
        body += '<div class="card-title" style="margin-top:16px">写前检查<span class="sub">' + findings.length + ' 条</span></div>';
        body += renderFindings(findings);
      }
      var blocked = errors.length > 0;
      if (blocked) {
        body += '<div class="gate-note">有 ' + errors.length + ' 项错误级问题，执行入口已阻止。'
          + (canReinstall
            ? '这一条是「已经装过」—— 直接点右下角「卸载并安装」，会先卸载、再按上面的步骤装回来。'
            : '请先按「建议」处理后再来。')
          + '</div>';
      } else {
        body += '<div style="height:14px"></div>';
        body += '<label class="check"><input type="checkbox" id="plan-ack"><span>我已了解上述步骤与影响，确认现在执行。</span></label>';
      }
      var foot = '<button class="btn" id="modal-cancel">取消</button>';
      if (blocked && canReinstall) {
        foot += '<span class="spacer"></span><button class="btn primary" id="modal-reinstall">卸载并安装</button>';
      } else if (!blocked) {
        foot += '<span class="spacer"></span><button class="btn ' + (danger ? 'danger-solid' : 'primary') + '" id="modal-exec" disabled>' + (danger ? '确认执行（有风险）' : '确认执行') + '</button>';
      }
      openModal({ title: esc(plan.title || '执行计划'), sub: plan.description || '', body: body, foot: foot });
      state.pendingPlan = resolve;
      var ack = $('plan-ack');
      if (ack) ack.addEventListener('change', function () { $('modal-exec').disabled = !ack.checked; });
      $('modal-cancel').addEventListener('click', closeModal);
      var reinstall = $('modal-reinstall');
      if (reinstall) {
        reinstall.addEventListener('click', function () {
          state.pendingPlan = null;
          closeModal();
          resolve('reinstall');
        });
      }
      var exec = $('modal-exec');
      if (exec) {
        exec.addEventListener('click', function () {
          state.pendingPlan = null;
          closeModal();
          resolve(true);
        });
      }
    });
  }

  function showResult(action, result) {
    var body = '';
    var lines = result && result.lines;
    if (lines && lines.length) body += '<div class="logbox">' + esc(lines.join('\\n')) + '</div>';
    var warnings = result && result.warnings;
    if (warnings && warnings.length) {
      body += '<div style="height:12px"></div>';
      for (var i = 0; i < warnings.length; i++) {
        body += '<div class="finding warn"><div class="finding-title"><span class="tag warn">警告</span></div><div class="finding-row">' + esc(warnings[i]) + '</div></div>';
      }
    }
    if (!body) body = '<div class="logbox">' + esc(JSON.stringify(result, null, 2)) + '</div>';
    openModal({
      title: icon('shield') + '<span>' + esc(ACT_TITLE[action] || action) + ' · 已完成</span>',
      sub: '任务已成功结束，下面是结果摘要。',
      body: body,
      foot: '<span class="spacer"></span><button class="btn primary" id="modal-close">完成</button>'
    });
    $('modal-close').addEventListener('click', closeModal);
  }

  /**
   * 「已安装」被拦住后的一键覆盖：先卸载，再按原计划装回来。
   * 两个动作同属 plugin 域 —— runAction 要等任务真正结束（SSE done）才返回，
   * 而域锁是 done 之后同一拍就释放的，所以顺序串起来不会撞同域互斥。
   * 故意不做 deferRestart：卸载那步失败时服务已经自己拉回来了，不会把人晾在停服状态。
   */
  function runReinstall(params) {
    var name = params.name;
    return runAction('plugin.uninstall', { name: name }, '卸载 ' + name + '（覆盖安装：先卸载）')
      .then(function (unResult) {
        return runAction('plugin.install', params, '安装 ' + name + '（覆盖安装：装回来）')
          .then(function (ok) { return ok; }, function (e) {
            throw new Error('卸载成功，但安装没成功：' + ((e && e.message) || e) +
              '。插件现在是卸载状态，重新点「安装」就能补装回来。');
          });
      }, function (e) {
        throw new Error('卸载这一步就没成功：' + ((e && e.message) || e) +
          '。插件没被动过，可以直接重试。');
      });
  }
  // 写操作：plan → 确认 → apply
  function startWrite(action, el) {
    if (action === 'backup.create') { openBackupForm(); return; }
    if (action === 'bootstrap.apply') { openBootstrapForm(); return; }
    // 带 data-name 的安装按钮（插件页的行内按钮、插件市场的每个条目）直接拿这个名字去出计划，
    // 不再弹空表单让人重填一遍 —— 那既多一步，也容易填错。
    if (action === 'plugin.install') {
      var presetName = paramsFor(action, el).name;
      if (!presetName) { openInstallForm(); return; }
    }
    var params = paramsFor(action, el);
    var label = ACT_TITLE[action] || action;
    return api('/api/plan', { method: 'POST', body: { action: action, params: params } })
      .then(function (plan) {
        if (!plan || !plan.ok) throw new Error((plan && plan.error) || '无法生成执行计划');
        return confirmPlan(plan, !!ACT_DANGER[action], { action: action, params: params });
      })
      .then(function (ok) {
        if (!ok) return null;
        var work = ok === 'reinstall' ? runReinstall(params) : runAction(action, params, label);
        return work.then(function (result) {
          state.cache = {};
          return result;
        });
      })
      .then(function (result) {
        if (!result) return;
        toast(label + '：已完成');
        if (action === 'bootstrap.apply') {
          toast('部署完成，正在进入 DSH…');
          enterDsh(null);
          return;
        }
        showResult(action, result);
        go(state.page, true);
      })
      .catch(function (e) { errorModal(label + ' 失败', e && e.message ? e.message : String(e), label); });
  }

  // 只读动作：直接跑，不弹计划
  function startRead(action, el) {
    var label = ACT_TITLE[action] || action;
    if (el) el.disabled = true;
    return runAction(action, paramsFor(action, el), label).then(function (result) {
      if (el) el.disabled = false;
      handleReadResult(action, result);
    }).catch(function (e) {
      if (el) el.disabled = false;
      errorModal(label + ' 失败', e && e.message ? e.message : String(e), label);
    });
  }

  function handleReadResult(action, result) {
    if (action === 'diag.healthCheck') {
      state.cache.report = result;
      if (state.page === 'overview') {
        var host = $('overview-findings');
        if (host && result.findings) host.innerHTML = renderFindings(result.findings);
      }
      toast('体检完成：' + result.summary.errors + ' 项错误 / ' + result.summary.warns + ' 项警告',
        result.summary.errors ? 'err' : result.summary.warns ? 'warn' : '');
      return;
    }
    if (action === 'data.inspect') {
      var rows = '';
      for (var di = 0; di < (result.items || []).length; di++) {
        var it = result.items[di];
        rows += '<div class="finding ' + (it.overwrites ? 'warn' : 'info') + '">'
          + '<div class="finding-title"><span class="tag ' + (it.overwrites ? 'warn' : 'plain') + '">' + (it.overwrites ? '会覆盖' : '新增') + '</span>' + esc(it.label) + '</div>'
          + '<div class="finding-evidence">' + esc(it.target) + '</div></div>';
      }
      for (var bi = 0; bi < (result.blocked || []).length; bi++) {
        var bk = result.blocked[bi];
        rows += '<div class="finding error"><div class="finding-title"><span class="tag error">拦下</span>' + esc(bk.label) + '</div>'
          + '<div class="finding-row">' + esc(bk.reason) + '</div></div>';
      }
      openModal({
        title: '搬移包检查结果',
        sub: '共 ' + (result.summary ? result.summary.total : 0) + ' 项：会覆盖 ' + (result.summary ? result.summary.overwrites : 0)
          + '、新增 ' + (result.summary ? result.summary.news : 0) + '、拦下 ' + (result.summary ? result.summary.blocked : 0)
          + '｜来自 ' + esc(result.manifest ? result.manifest.hostname : '') + '，生成于 ' + esc(result.manifest ? fmtTime(result.manifest.createdAt) : ''),
        body: rows || emptyBox('包里没有可恢复的条目', '这份包的 MANIFEST 里没有任何条目。'),
        foot: '<span class="spacer"></span><button class="btn" id="modal-close">知道了</button>',
      });
      $('modal-close').addEventListener('click', closeModal);
      return;
    }
    if (action === 'plugin.deps') {
      state.extra.pluginDeps = result;
      toast(
        '依赖体检完成：' + result.summary.conflicts + ' 处版本冲突 / ' + result.summary.duplicates + ' 处重复安装',
        result.summary.conflicts ? 'err' : '',
      );
      go('plugins', false);
      return;
    }
    if (action === 'backup.preview') {
      var rows = '';
      for (var pi = 0; pi < (result.artifacts || []).length; pi++) {
        var a = result.artifacts[pi];
        var stateTag = a.state === 'to-overwrite' ? 'warn' : a.state === 'to-restore' ? 'ok' : 'error';
        var stateText = a.state === 'to-overwrite' ? '覆盖' : a.state === 'to-restore' ? '补回' : '缺失';
        rows += '<div class="finding ' + (a.state === 'backup-missing' ? 'error' : 'info') + '">'
          + '<div class="finding-title"><span class="tag ' + stateTag + '">' + stateText + '</span>' + esc(tail(a.path)) + '</div>'
          + '<div class="finding-row">' + esc(a.text) + '</div>'
          + '<div class="finding-evidence">' + esc(a.path) + '</div></div>';
      }
      openModal({
        title: '回滚影响预览',
        sub: esc(result.headline) + '｜' + esc(result.effect),
        body: rows || emptyBox('没有文件记录', '这个回滚点没有记录任何文件，回滚不会改动磁盘。'),
        foot: '<span class="spacer"></span><button class="btn" id="modal-close">知道了</button>',
      });
      $('modal-close').addEventListener('click', closeModal);
      return;
    }
    if (action === 'backup.verify') {
      var bad = (result.results || []).filter(function (x) { return !x.ok; });
      toast(result.allOk ? '回滚点全部校验通过' : ('有 ' + bad.length + ' 个回滚点校验未通过'), result.allOk ? '' : 'err');
      var body = '';
      for (var i = 0; i < (result.results || []).length; i++) {
        var x = result.results[i];
        body += '<div class="finding ' + (x.ok ? 'ok' : 'error') + '"><div class="finding-title"><span class="tag ' + (x.ok ? 'ok' : 'error') + '">' + (x.ok ? '通过' : '不通过') + '</span><span class="mono">' + esc(x.id) + '</span></div>'
          + (x.problems && x.problems.length ? '<div class="finding-evidence">' + esc(x.problems.join('\\n')) + '</div>' : '') + '</div>';
      }
      openModal({ title: esc(ACT_TITLE[action] || action), sub: '校验时间 ' + fmtTime(result.checkedAt), body: body || emptyBox('没有可校验的回滚点', ''), foot: '<span class="spacer"></span><button class="btn primary" id="modal-close">完成</button>' });
      $('modal-close').addEventListener('click', closeModal);
      return;
    }
    if (action === 'bootstrap.verify') {
      state.extra.bootstrapVerify = result;
      toast(result.ok ? '三连验证：全部通过' : '三连验证：有未通过项', result.ok ? '' : 'err');
      go(state.page, true);
      return;
    }
    if (action === 'core.verify') { state.extra.coreVerify = result; toast('本体校验：' + healthText(result.health), result.health === 'ok' ? '' : result.health === 'warn' ? 'warn' : 'err'); }
    else if (action === 'runtime.diagnose') { state.extra.runtimeDiag = result; toast('运行时诊断：' + healthText(result.health), result.health === 'ok' ? '' : result.health === 'warn' ? 'warn' : 'err'); }
    else if (action === 'plugin.diagnose') { state.extra.pluginDiag = result; toast('插件诊断：' + healthText(result.health), result.health === 'ok' ? '' : result.health === 'warn' ? 'warn' : 'err'); }
    else { toast('检测完成'); }
    go(state.page, true);
  }

  // ── 表单弹窗 ─────────────────────────────────────────────────────

  function openInstallForm() {
    openModal({
      title: esc('安装插件'),
      sub: '填 npm 包名，可带版本（例如 dsh-better-sidebar@0.18.0）。动手前会先把计划摊给你确认。',
      body: '<div class="field"><label class="field-label" for="install-name">包名</label>'
        + '<input class="input" id="install-name" placeholder="dsh-better-sidebar" spellcheck="false">'
        + '<div class="field-help">安装会先建回滚点，再改双名单；失败自动还原。</div></div>',
      foot: '<button class="btn" id="modal-cancel">取消</button><span class="spacer"></span><button class="btn primary" id="install-go">查看计划</button>'
    });
    $('modal-cancel').addEventListener('click', closeModal);
    $('install-go').addEventListener('click', function () {
      var name = ($('install-name').value || '').trim();
      if (!name) { toast('请先填包名', 'warn'); return; }
      closeModal();
      runWriteFlow('plugin.install', { name: name });
    });
  }

  function openBackupForm() {
    openModal({
      title: esc('创建回滚点'),
      sub: '把指定文件在动手前复制留底。至少要给一个存在的文件路径。',
      body: '<div class="field"><label class="field-label" for="bk-kind">类型</label>'
        + '<select class="select" id="bk-kind">'
        + '<option value="config">配置（config）</option>'
        + '<option value="plugin-set">插件集（plugin-set）</option>'
        + '<option value="core-build">本体构建（core-build）</option>'
        + '<option value="snapshot">快照（snapshot）</option>'
        + '<option value="env">环境（env）</option>'
        + '</select></div>'
        + '<div class="field"><label class="field-label" for="bk-paths">要备份的文件（一行一个）</label>'
        + '<textarea class="textarea" id="bk-paths" spellcheck="false"></textarea>'
        + '<div class="field-help" id="bk-help">正在取 profile 目录…</div></div>',
      foot: '<button class="btn" id="modal-cancel">取消</button><span class="spacer"></span><button class="btn primary" id="bk-go">查看计划</button>'
    });
    $('modal-cancel').addEventListener('click', closeModal);
    $('bk-go').addEventListener('click', function () {
      var kind = $('bk-kind').value;
      var raw = $('bk-paths').value || '';
      var paths = raw.split(/\\r?\\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
      if (!paths.length) { toast('至少填一个文件路径', 'warn'); return; }
      closeModal();
      runWriteFlow('backup.create', { kind: kind, paths: paths, trigger: '界面手动创建' });
    });
    // 预填 profile 下最值得留底的两个文件（拿不到目录就让用户自己填）
    var fill = function (dir) {
      var el = $('bk-paths');
      var help = $('bk-help');
      if (!el) return;
      el.value = dir + '/package.json' + '\\n' + dir + '/pnpm-lock.yaml';
      if (help) help.textContent = '已按 profile 目录（' + dir + '）预填，可自行修改。';
    };
    if (state.cache.env && state.cache.env.dsh && state.cache.env.dsh.profileDir) {
      fill(state.cache.env.dsh.profileDir);
    } else {
      runAction('env.probe', {}, '环境体检').then(function (r) {
        state.cache.env = r;
        fill(r.dsh.profileDir);
      }).catch(function () {
        var help = $('bk-help');
        if (help) help.textContent = '没能自动取到 profile 目录，请手动填绝对路径。';
      });
    }
  }

  // 表单弹窗里发起的写操作：与行内按钮走同一条 plan → confirm → apply 通道
  function runWriteFlow(action, params) {
    var label = ACT_TITLE[action] || action;
    return api('/api/plan', { method: 'POST', body: { action: action, params: params } })
      .then(function (plan) {
        if (!plan || !plan.ok) throw new Error((plan && plan.error) || '无法生成执行计划');
        return confirmPlan(plan, !!ACT_DANGER[action], { action: action, params: params });
      })
      .then(function (ok) {
        if (!ok) return null;
        var work = ok === 'reinstall' ? runReinstall(params) : runAction(action, params, label);
        return work.then(function (result) { state.cache = {}; return result; });
      })
      .then(function (result) {
        if (!result) return;
        toast(label + '：已完成');
        if (action === 'bootstrap.apply') {
          // 「装完即用」的最后一跳：部署成功后同一个窗口直接换成 DSH。
          // 不弹结果弹窗 —— 15 分钟的过程细节在「任务」页里都有，此刻用户只想开始用。
          toast('部署完成，正在进入 DSH…');
          enterDsh(null);
          return;
        }
        showResult(action, result);
        go(state.page, true);
      })
      .catch(function (e) { errorModal(label + ' 失败', e && e.message ? e.message : String(e), label); });
  }

  // ── 顶栏与导航 ───────────────────────────────────────────────────

  var NL = String.fromCharCode(10);

  function setBadge(id, kind, text) {
    var el = $(id);
    if (!el) return;
    el.className = 'badge' + (kind ? ' ' + kind : '');
    el.innerHTML = '<span class="dot"></span><span>' + esc(text) + '</span>';
  }
  function setNavCount(page, n) {
    var el = $('nav-count-' + page);
    if (el) el.textContent = (!n) ? '' : String(n);
  }

  // ⑤ 本体有新版本时，侧栏「DSH 本体」条目挂一个醒目的徽标（不是数字，是「↑ 可更新」）。
  function refreshCoreBadge(ov) {
    var el = $('nav-count-core');
    if (!el) return;
    if (!ov || !ov.dsh) { el.textContent = ''; el.classList.remove('warn'); return; }
    if (ov.dsh.updateAvailable) {
      el.textContent = '可更新';
      el.classList.add('warn');
      el.title = '本体有新版本 ' + (ov.dsh.latestVersion || '');
    } else if (ov.dsh.needsFinishUpdate) {
      el.textContent = '待完成更新';
      el.classList.add('warn');
      el.title = '本体停在旧提交上，需要完成一次更新';
    } else {
      el.textContent = '';
      el.classList.remove('warn');
      el.title = '';
    }
  }

  function verifyCard(v) {
    var html = '<div class="card hero ' + healthClass(v.health) + '"><div class="card-title">本体校验结论<span class="sub">耗时 ' + v.elapsedMs + ' ms · ' + fmtTime(v.checkedAt) + '</span></div>';
    if (v.libs) {
      html += '<div class="stats">'
        + stat('扫描候选包', v.libs.candidates)
        + stat('HEAD 记录包', v.libs.headPackages)
        + stat('僵尸 lib', v.libs.zombieLibs.length, '官方已删、目录还在')
        + stat('真缺失', v.libs.missingPackages.length, 'HEAD 有、磁盘没有')
        + '</div>';
      if (v.libs.zombieLibs.length) {
        html += '<div style="height:12px"></div><div class="finding warn"><div class="finding-title"><span class="tag warn">僵尸 lib</span>这两个筐是分开的，不会互相混报</div><div class="finding-evidence">' + esc(v.libs.zombieLibs.map(function (z) { return z.pkgDir; }).join(NL)) + '</div></div>';
      }
      if (v.libs.missingPackages.length) {
        html += '<div style="height:12px"></div><div class="finding error"><div class="finding-title"><span class="tag error">缺失包</span>构建记录里有、磁盘上没有</div><div class="finding-evidence">' + esc(v.libs.missingPackages.join(NL)) + '</div></div>';
      }
    }
    html += renderFindings(v.findings) + '</div>';
    return html;
  }

  // ── 页面：总览 ───────────────────────────────────────────────────

  /**
   * 管家提醒卡片：定时任务发现问题时留下的痕迹（体检有错误/警告、备份失败、有插件可更新）。
   * 全绿时这张卡不出现 —— 没事就别占用户的地方。
   */
  function noticesCard() {
    var list = state.notices || [];
    if (!list.length) return '';
    var unseen = 0;
    for (var i = 0; i < list.length; i++) if (!list[i].seen) unseen++;
    var html = '<div class="card"><div class="card-title">管家提醒'
      + '<span class="sub">' + (unseen ? unseen + ' 条未读' : '全部已读') + '</span></div>';
    html += '<div class="rows">';
    var show = Math.min(list.length, 5);
    for (var j = 0; j < show; j++) {
      var n = list[j];
      var tone = n.level === 'error' ? 'error' : n.level === 'warn' ? 'warn' : 'info';
      html += '<div class="finding ' + tone + '"><div class="finding-title">'
        + '<span class="tag ' + tone + '">' + (n.level === 'error' ? '错误' : n.level === 'warn' ? '警告' : '提示') + '</span>'
        + esc(n.title) + (n.seen ? '' : ' <span class="tag warn">新</span>') + '</div>'
        + '<div class="finding-row"><b>来自：</b>' + esc(n.source) + ' · ' + esc(fmtAgo(n.at)) + '</div>'
        + (n.detail ? '<div class="finding-row">' + esc(n.detail) + '</div>' : '')
        + '</div>';
    }
    html += '</div>';
    if (unseen) html += '<div class="btn-row" style="margin-top:10px"><button class="btn sm" id="btn-notices-seen">全部标记已读</button></div>';
    return html + '</div>';
  }

  function pageOverview() {
    // 两张卡并行取：管家自己的总览 + 外壳状态（该不该直接进 DSH）
    return Promise.all([
      api('/api/state/overview'),
      api('/api/shell/state').catch(function () { return null; }),
      api('/api/notices').catch(function () { return null; }),
    ]).then(function (res) {
      var ov = res[0];
      state.shell = res[1] && res[1].state ? res[1].state : null;
      if (res[2] && res[2].notices) state.notices = res[2].notices;
      var html = pageHead('总览', 'DSH 本体、服务与插件的当前状况。', '<button class="btn sm" id="btn-refresh-page">' + icon('refresh') + '<span>刷新</span></button>');
      // 第一眼就该看到"现在能不能直接用"——这一屏的主行动只有一件事
      html += shellCard();
      html += noticesCard();
      html += '<div class="card"><div class="stats">'
        + stat('本体', ov.dsh.installed ? (ov.dsh.version || '已安装') : '未安装', ov.dsh.headShort ? '提交 ' + ov.dsh.headShort : '', true)
        + stat('上游最新版', ov.dsh.latestVersion || '未查到',
          ov.dsh.latestChannel ? ('来自 ' + ov.dsh.latestChannel + ' 通道') : '网络不通或还没查', true)
        + stat('待完成更新', ov.dsh.needsFinishUpdate ? '是' : '否')
        + stat('服务', ov.runtime.running ? '运行中' : '未运行', ov.runtime.port ? '端口 ' + ov.runtime.port : '')
        + stat('插件（生效 / 已装）', ov.plugins.active + ' / ' + ov.plugins.declared)
        + '</div></div>';
      html += '<div class="card"><div class="card-title">快捷入口</div><div class="btn-row">'
        + actBtn('play', '运行全面体检', 'diag.healthCheck', 'primary')
        + navBtn('sliders', '环境与配置', 'env')
        + navBtn('box', 'DSH 本体', 'core')
        + navBtn('activity', '运行状态', 'runtime')
        + navBtn('puzzle', '插件', 'plugins')
        + '</div></div>';
      if (ov.dsh.updateAvailable) {
        html += '<div class="card">'
          + '<div class="finding warn"><div class="finding-title"><span class="tag warn">可更新</span>'
          + '本体有新版本：' + esc(ov.dsh.latestVersion || '') + '（本机 ' + esc(ov.dsh.version || '未知') + '）</div>'
          + '<div class="finding-cause">上游 ' + esc(ov.dsh.latestChannel || '') + ' 通道已经发到 '
          + esc(ov.dsh.latestVersion || '') + '，本机还是 ' + esc(ov.dsh.version || '未知')
          + '。更新会先停服、拉取新版本、重建产物；动手前会把步骤摊给你确认，你也可以先建个回滚点。</div>'
          + '<div class="btn-row" style="margin-top:10px">'
          + '<button class="btn primary" data-write="core.update">' + icon('upload') + '<span>去更新本体</span></button>'
          + '<button class="btn" data-page="core">' + icon('box') + '<span>先看本体状态</span></button>'
          + '</div></div></div>';
      }
      html += '<div class="card"><div class="card-title">问题概览<span class="sub">来自最近一次体检</span></div><div id="overview-findings">'
        + (state.cache.report && state.cache.report.findings ? renderFindings(state.cache.report.findings) : emptyBox('还没有体检结果', '点上面的「运行全面体检」开始检查。'))
        + '</div></div>';
      setMain(html);
      var dshBadge = !ov.dsh.installed
        ? { kind: 'err', text: '未安装本体' }
        : (ov.dsh.updateAvailable
          ? { kind: 'warn', text: '本体有新版本 ' + (ov.dsh.latestVersion || '') }
          : (ov.dsh.needsFinishUpdate
            ? { kind: 'warn', text: '本体待完成更新' }
            : { kind: 'ok', text: '本体正常' }));
      setBadge('badge-dsh', dshBadge.kind, dshBadge.text);
      setBadge('badge-service', ov.runtime.running ? 'ok' : '', ov.runtime.running ? '服务运行中' : '服务未运行');
      refreshCoreBadge(ov);
      setNavCount('plugins', ov.plugins.declared);
    });
  }

  // ── 页面：环境与配置 ─────────────────────────────────────────────

  function renderEnv(r) {
    var html = pageHead('环境与配置', '系统、运行时、目录、权限与端口状况。');
    html += '<div class="card"><div class="card-title">系统</div>'
      + kv('平台', r.system.platform + ' ' + r.system.arch)
      + kv('系统版本', r.system.osVersion)
      + kv('处理器', r.system.cpuModel + ' · ' + r.system.cpuCount + ' 核')
      + kv('内存', humanSize(r.system.memFreeBytes) + ' 可用 / ' + humanSize(r.system.memTotalBytes) + ' 总')
      + kv('当前用户', r.system.user)
      + kv('管理员权限', r.elevation.elevated ? '是' : '否')
      + (r.disk ? kv('磁盘可用', humanSize(r.disk.freeBytes) + ' / ' + humanSize(r.disk.totalBytes) + '（' + r.disk.path + '）') : '')
      + '</div>';
    html += '<div class="card"><div class="card-title">运行时</div>';
    for (var i = 0; i < r.runtime.length; i++) {
      var t = r.runtime[i];
      html += kv(t.label, t.found ? (t.version || '已安装') : (t.required ? '缺失（必需）' : '缺失（可选）'), true);
    }
    html += '</div>';
    html += '<div class="card"><div class="card-title">目录</div>'
      + kv('DSH 源码', r.dsh.sourceRoot || '未找到', true)
      + kv('发现方式', r.dsh.discoveredBy || '-')
      + kv('profile 目录', r.dsh.profileDir, true)
      + kv('隔离区', r.dsh.quarantineDir || '-', true)
      + kv('隔离区同盘', r.dsh.quarantineSameVolume ? '是' : '否（异常）')
      + kv('管家数据目录', r.paths.butlerRoot, true)
      + kv('旧版配置', r.paths.legacyConfigExists ? '存在（可迁移）' : '不存在', true)
      + '</div>';
    html += '<div class="card"><div class="card-title">写权限</div>';
    for (var j = 0; j < r.writable.length; j++) {
      html += kv(r.writable[j].label, r.writable[j].writable ? '可写' : ('不可写：' + (r.writable[j].error || '')));
    }
    html += '</div>';
    html += '<div class="card"><div class="card-title">端口</div>';
    for (var k = 0; k < r.ports.length; k++) {
      var pt = r.ports[k];
      html += kv(String(pt.port), pt.free ? '空闲' : (pt.isDsh ? 'DSH 服务占用' : ('被占用：' + pt.owners.join('、'))));
    }
    html += '</div>';
    html += '<div class="card"><div class="card-title">问题清单</div>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  // ── 页面：DSH 本体 ───────────────────────────────────────────────

  function renderCore(r) {
    var tools = actBtn('shield', '校验本体', 'core.verify')
      + writeBtn('check', '完成更新', 'core.finishUpdate')
      + writeBtn('upload', '更新本体', 'core.update')
      + writeBtn('history', '回滚本体', 'core.rollback');
    var html = pageHead('DSH 本体', '版本、源码提交与构建记录的一致性。写操作会先把计划摊给你确认。', tools);
    if (!r.sourceRoot) {
      html += '<div class="card hero err"><div class="hero-title">未找到 DSH 本体</div><div class="hero-desc">没有检测到 DSH 源码树（判据：目录下存在 apps/cli）。</div></div>';
      return html + '<div class="card"><div class="card-title">问题清单</div>' + renderFindings(r.findings) + '</div>';
    }
    if (state.extra.coreVerify) html += verifyCard(state.extra.coreVerify);

    html += '<div class="card"><div class="card-title">版本与源码</div>'
      + kv('位置', r.sourceRoot, true)
      + kv('版本', r.version || '未知');
    if (r.git) {
      html += kv('分支', r.git.branch || '-')
        + kv('提交', (r.git.headShort || '-') + ' （' + String(r.git.head || '').slice(0, 12) + '…）', true)
        + kv('已跟踪文件改动', String(r.git.dirtyTracked));
    }
    html += '</div>';

    // ③ 本体更新日志：最近 20 条提交（来自源码仓库 git log，异步拉取）
    html += '<div class="card"><div class="card-title">本体更新日志<span class="sub">最近 20 条提交 · 来自源码仓库</span>'
      + '<span class="spacer"></span><button class="btn sm" id="btn-refresh-changelog">' + icon('refresh') + '<span>刷新</span></button></div>'
      + '<div id="changelog-list"><div class="empty"><span class="spinner"></span> 正在读取提交记录…</div></div></div>';

    html += '<div class="card"><div class="card-title">构建记录对比</div>';
    if (r.build) {
      html += kv('记录中的提交', r.build.commit || '-', true)
        + kv('记录中的版本', r.build.version || '-')
        + kv('构建时是否脏工作区', r.build.dirty ? '是' : '否')
        + kv('产物文件数', r.build.fileCount === null ? '-' : String(r.build.fileCount))
        + kv('产物摘要', String(r.build.artifactsSha256 || '-').slice(0, 32) + '…', true);
    } else {
      html += '<div class="empty"><div class="empty-title">没有构建记录文件</div><div>还没在这台机器上构建过 DSH。</div></div>';
    }
    html += '<div class="finding ' + (r.needsFinishUpdate ? 'warn' : 'ok') + '" style="margin-top:10px">'
      + '<div class="finding-title"><span class="tag ' + (r.needsFinishUpdate ? 'warn' : 'ok') + '">' + (r.needsFinishUpdate ? '需要处理' : '一致') + '</span>'
      + (r.needsFinishUpdate ? '需要执行「完成更新」' : '源码与产物一致') + '</div>'
      + (r.finishReason ? '<div class="finding-row">' + esc(r.finishReason) + '</div>' : '')
      + '</div></div>';

    if (r.plugins) {
      html += '<div class="card"><div class="card-title">插件双名单<span class="sub">生效 = 依赖 ∩ 名单</span>'
        + '<span class="spacer"></span>' + navBtn('puzzle', '去插件页', 'plugins') + '</div>'
        + kv('依赖清单', String(r.plugins.dependencies.length))
        + kv('bundles 名单', String(r.plugins.bundles.length))
        + kv('实际生效', String(r.plugins.active.length))
        + kv('装了没生效', r.plugins.declaredButInactive.length ? r.plugins.declaredButInactive.join('、') : '无')
        + kv('本体自带基座包', r.plugins.inBox.length ? r.plugins.inBox.join('、') : '无')
        + kv('名单里但装不上', r.plugins.bundledButUndeclared.length ? r.plugins.bundledButUndeclared.join('、') : '无')
        + '</div>';
    }

    if (r.suspectedOrphans && r.suspectedOrphans.length) {
      html += '<div class="card"><div class="card-title">安装残留<span class="sub">' + r.suspectedOrphans.length + ' 处</span></div>'
        + '<div class="finding-evidence">' + esc(r.suspectedOrphans.map(function (x) { return x.name + '（' + x.kind + '）'; }).join(NL)) + '</div></div>';
    }

    html += '<div class="card"><div class="card-title">问题清单</div>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  // ③ 本体更新日志（最近 20 条提交）：渲染进 DSH 本体页的占位卡片里
  function fillChangelog() {
    var el = $('changelog-list');
    if (!el) return;
    el.innerHTML = '<div class="empty"><span class="spinner"></span> 正在读取提交记录…</div>';
    api('/api/changelog?limit=20').then(function (res) {
      if (state.page !== 'core') return; // 用户已经切走了，别覆盖新页面
      var box = $('changelog-list');
      if (!box) return;
      if (!res || res.error || !res.entries || !res.entries.length) {
        box.innerHTML = emptyBox('没有读到提交记录', res && res.error ? res.error : '本体源码目录不是一个 git 仓库？');
        return;
      }
      var rows = '';
      for (var i = 0; i < res.entries.length; i++) {
        var e = res.entries[i];
        rows += '<div class="row"><div class="row-main"><div class="row-name">' + esc(e.subject || '(无提交说明)')
          + '</div><div class="row-meta"><span class="mono">' + esc(e.sha) + '</span><span>' + esc(e.date || '') + '</span></div></div></div>';
      }
      box.innerHTML = '<div class="rows">' + rows + '</div>';
    }).catch(function (err) {
      var box = $('changelog-list');
      if (box) box.innerHTML = emptyBox('读取失败', err && err.message ? err.message : String(err));
    });
  }

  // ── 页面：运行状态 ───────────────────────────────────────────────

  function renderRuntime(r) {
    var tools = '<button class="btn sm" data-enter-dsh data-enter-label="进入 DSH">' + icon('external') + '<span>进入 DSH</span></button>'
      + actBtn('activity', '运行时诊断', 'runtime.diagnose')
      + writeBtn('wrench', '修复僵尸锁', 'runtime.repair')
      + writeBtn('play', '启动服务', 'runtime.start')
      + writeBtn('external', '停止服务', 'runtime.stop', {}, 'sm danger')
      + writeBtn('refresh', '重启服务', 'runtime.restart');
    var html = pageHead('运行状态', '服务进程、HTTP 健康检查、僵尸锁与 profile 残留物。', tools);
    if (state.extra.runtimeDiag) html += diagCard('运行时诊断结论', state.extra.runtimeDiag);
    html += '<div class="card"><div class="card-title">服务</div>'
      + kv('状态', r.running ? '运行中' : '未运行')
      + kv('进程 PID', r.pid === null ? '-' : String(r.pid))
      + kv('端口', r.port === null ? '-' : String(r.port))
      + kv('启动形态', r.launchForm === 'compiled' ? '编译版（lib/bin.js）' : r.launchForm === 'dev' ? '开发态（tsx 直跑）' : '-');
    if (r.health) {
      html += kv('HTTP 健康检查', r.health.reachable ? ('可访问 HTTP ' + r.health.status + ' · ' + r.health.latencyMs + ' ms') : ('不可访问：' + (r.health.error || '')));
    }
    if (r.cmdline) html += kv('命令行', r.cmdline, true);
    html += '</div>';

    if (r.duplicates && r.duplicates.length) {
      html += '<div class="card"><div class="card-title">其它同类进程<span class="sub">' + r.duplicates.length + ' 个</span></div>';
      for (var i = 0; i < r.duplicates.length; i++) {
        html += kv('PID ' + r.duplicates[i].pid, '端口 ' + (r.duplicates[i].port || '?'), true);
      }
      html += '</div>';
    }

    html += '<div class="card"><div class="card-title">写锁<span class="sub">共 ' + r.locks.length + ' 个</span></div>';
    if (!r.locks.length) {
      html += emptyBox('没有发现锁文件', '正常状态。');
    } else {
      for (var j = 0; j < r.locks.length; j++) {
        var l = r.locks[j];
        var verdict = l.verdict === 'stale' ? '僵尸（持有者已消失）' : l.verdict === 'keep' ? '正常' : '无法判定';
        html += kv(tail(l.file), verdict + ' · ' + l.note, true);
      }
    }
    html += '</div>';

    html += '<div class="card"><div class="card-title">profile 残留物</div>';
    if (!r.residue || !r.residue.length) {
      html += emptyBox('没有发现残留备份', '干净。');
    } else {
      for (var k = 0; k < r.residue.length; k++) {
        html += kv(r.residue[k].kind, r.residue[k].count + ' 项 · ' + humanSize(r.residue[k].sizeBytes));
      }
    }
    html += '</div>';

    html += '<div class="card"><div class="card-title">问题清单</div>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  // ── 页面：插件 ───────────────────────────────────────────────────

  function renderPlugins(r) {
    var tools = actBtn('shield', '插件诊断', 'plugin.diagnose')
      + actBtn('puzzle', '依赖冲突体检', 'plugin.deps')
      + writeBtn('upload', '批量更新（含验证）', 'plugin.batchUpdate')
      + writeBtn('plus', '安装插件', 'plugin.install')
      + writeBtn('wrench', '清理残留', 'plugin.cleanResidue');
    var html = pageHead('插件', '双名单（依赖 ∩ 生效名单）、包实体与作层资格。装/卸/修都会先摊开计划再执行。', tools);
    html += '<div class="card"><div class="stats">'
      + stat('依赖清单', r.summary.deps)
      + stat('生效名单', r.summary.bundles)
      + stat('实际生效', r.summary.active)
      + stat('装了没生效', r.summary.declaredButInactive, r.summary.declaredButInactive ? '可以点「修复」补登记' : '')
      + '</div></div>';
    if (state.extra.pluginDiag) html += diagCard('插件诊断结论', state.extra.pluginDiag);
    // 【P0-3】依赖冲突体检查询结果：列出「谁和谁要的版本不可能同时满足」+ 重复安装 + 锁文件状态
    if (state.extra.pluginDeps) {
      var dp = state.extra.pluginDeps;
      html += '<div class="card"><div class="card-title">依赖冲突体检'
        + '<span class="sub">' + dp.summary.conflicts + ' 处版本冲突 · ' + dp.summary.duplicates + ' 处重复安装 · '
        + esc(dp.lock && dp.lock.note ? dp.lock.note : '') + '</span></div>'
        + '<div class="rows"><div class="row"><div class="row-main"><div class="row-meta"><span>profile：' + esc(dp.profileDir) + '</span></div>'
        + '</div>' + writeBtn('wrench', '重建锁文件', 'plugin.syncLock', {}, 'sm') + '</div></div>'
        + renderFindings(dp.findings)
        + '</div>';
    }

    var names = [];
    var push = function (n) { if (n && names.indexOf(n) < 0) names.push(n); };
    var lists = r.lists || {};
    var i;
    for (i = 0; i < (lists.dependencies || []).length; i++) push(lists.dependencies[i]);
    for (i = 0; i < (lists.bundles || []).length; i++) push(lists.bundles[i]);
    for (i = 0; i < (lists.active || []).length; i++) push(lists.active[i]);
    names.sort();

    html += '<div class="card"><div class="card-title">插件清单<span class="sub">共 ' + names.length + ' 个 · profile：' + esc(r.profileDir) + '</span></div>';
    if (!names.length) {
      html += emptyBox('一个插件都没有', '这个 profile 还没装任何插件。点右上角「安装插件」开始。');
    } else {
      html += '<div class="rows">';
      for (i = 0; i < names.length; i++) {
        var n = names[i];
        var inDeps = (lists.dependencies || []).indexOf(n) >= 0;
        var inBundles = (lists.bundles || []).indexOf(n) >= 0;
        var active = (lists.active || []).indexOf(n) >= 0;
        var entity = r.entities ? r.entities[n] : null;
        var layer = null;
        for (var k = 0; k < (r.layers || []).length; k++) if (r.layers[k].name === n) layer = r.layers[k];
        // inBox = 本体自带基座包（名字解析得到，本就不该写进 profile 的 dependencies）；
        // bundledButUndeclared = 在生效名单里却解析不到包实体 —— 那才是真需要处理的情况。
        var inBox = (lists.inBox || []).indexOf(n) >= 0;
        var missing = (lists.bundledButUndeclared || []).indexOf(n) >= 0;
        var marks = '';
        marks += inDeps ? badge('ok', '依赖清单') : badge('plain', '不在依赖');
        marks += inBundles ? badge('ok', '生效名单') : badge('plain', '不在名单');
        marks += active ? badge('ok', '已生效') : badge('warn', '未生效');
        if (entity === false) marks += badge('err', '包实体缺失');
        if (inBox) marks += badge('info', '本体自带', '本体基座包：不是可安装的插件，也不该出现在依赖清单里');
        if (missing) marks += badge('err', '解析不到包实体', '在生效名单里但装不到包实体 —— 这种情况才需要安装');
        if (layer && !layer.canLayer) marks += badge('warn', '不可作层', layer.reason || '');
        var actions = '';
        if (!inBox) {
          // 本体自带基座包一律不给写操作入口：既不是"装了没生效"，也没法当普通插件装卸。
          if (inDeps && !active) actions += writeBtn('wrench', '修复', 'plugin.repair', { name: n });
          if (!inDeps && inBundles) actions += writeBtn('plus', '安装', 'plugin.install', { name: n });
          if (inDeps) actions += writeBtn('trash', '卸载', 'plugin.uninstall', { name: n }, 'sm danger');
        }
        html += '<div class="row"><div class="row-main"><div class="row-name">' + esc(n) + '</div><div class="row-meta">' + marks + '</div></div><div class="row-actions">' + actions + '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── 页面：日志 ───────────────────────────────────────────────────

  function renderLogs(r) {
    var kw = (state.logFilter || '').toLowerCase();
    var logTools = '<button class="btn sm" id="btn-export-logs">' + icon('upload') + '<span>导出日志</span></button>';
    var html = pageHead('日志', '自动从最近的启动日志里挑出真正的错误行。', logTools);
    html += '<div class="card"><div class="card-title">过滤</div><input class="input" id="log-filter" placeholder="只看含这个关键词的行（例如 error / 端口 / 插件名）" value="' + esc(state.logFilter) + '" spellcheck="false"><div class="field-help">过滤只作用于下面已经挑出来的错误摘录，不会重新读盘。</div></div>';
    html += '<div class="card"><div class="card-title">日志文件<span class="sub">共 ' + r.sources.length + ' 份 · ' + humanSize(r.totalBytes) + '</span></div>';
    if (!r.sources.length) {
      html += emptyBox('没有找到日志文件', 'DSH 还没在本机启动过？');
    } else {
      for (var i = 0; i < Math.min(r.sources.length, 20); i++) {
        var s = r.sources[i];
        html += kv(s.label, humanSize(s.sizeBytes) + ' · ' + fmtTime(s.mtime), true);
      }
    }
    html += '</div>';

    html += '<div class="card"><div class="card-title">错误摘录</div>';
    if (!r.recentErrors || !r.recentErrors.length) {
      html += emptyBox('未发现明显错误', '这次启动日志看起来很干净。');
    } else {
      for (var j = 0; j < r.recentErrors.length; j++) {
        var lines = r.recentErrors[j].lines || [];
        var shown = [];
        for (var k = 0; k < lines.length; k++) {
          if (!kw || String(lines[k]).toLowerCase().indexOf(kw) >= 0) shown.push(lines[k]);
        }
        if (kw && !shown.length) continue;
        html += '<div style="margin-bottom:12px"><div class="card-title" style="margin-bottom:6px">' + esc(r.recentErrors[j].source) + '<span class="sub">' + shown.length + ' / ' + lines.length + ' 行</span></div>';
        var body = '';
        for (var m = 0; m < shown.length; m++) body += '<span class="ln">' + (m + 1) + '</span>' + esc(shown[m]) + NL;
        html += '<div class="logbox">' + body + '</div></div>';
      }
    }
    html += '</div>';
    html += '<div class="card"><div class="card-title">问题清单</div>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  // ── 页面：体检报告 ───────────────────────────────────────────────

  function renderReport(r) {
    if (typeof r === 'string') {
      return pageHead('体检报告', '可直接复制分享（已自动脱敏用户名与路径）。')
        + '<div class="card"><div class="btn-row" style="margin-bottom:10px"><button class="btn primary" id="btn-copy-report">' + icon('clipboard') + '<span>复制报告</span></button></div>'
        + '<div class="logbox" id="report-text" style="background:var(--surface-2);color:var(--text);max-height:none">' + esc(r) + '</div></div>';
    }
    var v = r.verdict === 'error' ? '错误' : r.verdict === 'warn' ? '警告' : '正常';
    var html = pageHead('体检报告', '生成于 ' + fmtTime(r.generatedAt) + ' · 耗时 ' + r.durationMs + ' ms');
    html += '<div class="card hero ' + healthClass(r.verdict) + '"><div class="hero-title">结论：' + esc(v) + '</div><div class="hero-desc">错误 ' + r.summary.errors + ' 项 · 警告 ' + r.summary.warns + ' 项 · 提示 ' + r.summary.infos + ' 项</div>'
      + '<div class="btn-row" style="margin-top:12px"><button class="btn primary" id="btn-copy-report">' + icon('clipboard') + '<span>复制 Markdown 报告</span></button></div></div>';
    for (var i = 0; i < r.sections.length; i++) {
      var s = r.sections[i];
      html += '<div class="card"><div class="card-title">' + esc(s.label) + '</div>' + renderFindings(s.findings) + '</div>';
    }
    return html;
  }

  function copyReport() {
    var text = '';
    if (typeof state.cache.report === 'string') text = state.cache.report;
    else {
      var el = $('report-text');
      if (el) text = el.textContent;
    }
    if (!text) { toast('报告内容为空，先运行一次体检', 'warn'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('报告已复制'); }, function () { toast('复制失败，请手动选择文本', 'err'); });
    } else {
      toast('这个环境不支持自动复制，请手动选择文本', 'warn');
    }
  }

  // ── 页面：任务 ───────────────────────────────────────────────────

  // ── 设置 ─────────────────────────────────────────────────────────
  //
  // 只写管家自己的 config.json；唯一有系统副作用的是"开机自启"（写用户级 Run 注册表项），
  // 那一项由服务端执行并把结果回给界面，失败会把配置里的意愿回滚，不让设置骗人。

  function loadSettings() {
    return api('/api/settings');
  }

  function setRow(label, control, help) {
    return '<div class="set-row"><div class="set-label">' + esc(label) + '</div>'
      + '<div class="set-control">' + control + (help ? '<div class="field-help">' + esc(help) + '</div>' : '') + '</div></div>';
  }

  function checkBox(id, checked, label) {
    return '<label class="check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }

  function renderSettings(res) {
    if (!res || res.ok === false) {
      return pageHead('设置', '管家自己的偏好都在这儿。', '')
        + '<div class="card">' + emptyBox('读不到设置', (res && res.error) || '服务没有返回内容') + '</div>';
    }
    var c = res.config || {};
    var upd = state.extra.butlerUpdate;
    var tools = '<button class="btn sm" id="btn-check-butler-update">' + icon('refresh') + '<span>检查管家更新</span></button>';
    var html = pageHead('设置', '每一项都写在 ' + esc(res.configPath || '配置文件') + '，改完点最下面的保存。', tools);

    html += '<div class="card"><div class="card-title">外观与窗口</div>'
      + setRow('主题', '<select class="select" id="set-theme">'
        + '<option value="light"' + (c.theme === 'light' ? ' selected' : '') + '>浅色</option>'
        + '<option value="dark"' + (c.theme === 'dark' ? ' selected' : '') + '>深色</option>'
        + '<option value="auto"' + (c.theme === 'auto' ? ' selected' : '') + '>跟随系统</option>'
        + '</select>', '顶栏那个月亮按钮和这里是一回事，改哪边都生效。')
      + setRow('点关闭按钮时', checkBox('set-close-to-tray', c.closeToTray, '收进托盘继续跑（不勾就直接退出管家）'),
        '收进托盘时 DSH 服务照常运行，点托盘图标就能把窗口叫回来。')
      + setRow('开机自启', checkBox('set-autostart', c.autostart, '登录后自动启动管家'),
        res.autostartActual ? '注册表里已经有自启项' + (res.autostartCommand ? '：' + res.autostartCommand : '') : '注册表里还没有自启项')
      + '</div>';

    html += '<div class="card"><div class="card-title">DSH 页面里的浮动工具条</div>'
      + setRow('启用', checkBox('set-dock-enabled', c.dockEnabled, '在 DSH 页面右下角显示管家工具条'),
        '关掉之后 DSH 页面就干净了，回管家只能靠托盘图标或 Ctrl+Shift+B。')
      + setRow('自动收起', '<input class="input set-num" id="set-dock-idle" type="number" min="1" max="60" value="'
        + Math.round((c.dockIdleMs || 3000) / 1000) + '">', '展开后多少秒没动作就自动收起（秒）')
      + '</div>';

    html += '<div class="card"><div class="card-title">插件市场</div>'
      + setRow('目录缓存', '<select class="select" id="set-market-ttl">'
        + [['3600000','1 小时'],['21600000','6 小时'],['86400000','1 天'],['604800000','7 天']].map(function (o) {
            return '<option value="' + o[0] + '"' + (String(c.marketCatalogTtlMs) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('')
        + '</select>', '市场目录 2000 多条，缓存久一点更省流量；点「刷新目录」可以强制重拉。')
      + '</div>';

    html += '<div class="card"><div class="card-title">更新</div>'
      + setRow('自动检查本体更新', checkBox('set-auto-core', c.autoCheckCoreUpdate, '总览页自动显示"本体有新版本"'),
        '官方 npm 的 latest 通道可能落后于 next，管家会把三个通道都读回来取最新那个。')
      + setRow('自动检查管家更新', checkBox('set-auto-butler', c.autoCheckButlerUpdate, '启动时读一次官网版本清单'),
        '只提示、不自动替换：这是未签名程序，换自己比让用户下载一步要险得多。')
      + setRow('当前版本', '<span class="mono">' + esc(res.appName || '') + ' ' + esc(res.appVersion || '') + '</span>'
        + (upd
          ? '<div class="field-help">' + (upd.available
              ? '官网最新版是 ' + esc(upd.latest || '') + (upd.release && upd.release.notes ? '：' + esc(upd.release.notes) : '')
              : (upd.error ? '这次没查到（' + esc(upd.error) + '）' : '已是最新'))
          + (upd.available && upd.release && upd.release.url
              ? '　<a class="btn sm" href="' + esc(upd.release.url) + '" data-open-url="' + esc(upd.release.url) + '">' + icon('external') + '<span>下载新版</span></a>'
              : '')
          + '</div>'
          : ''))
      + '</div>';

    html += '<div class="card"><div class="card-title">网络与高级</div>'
      + setRow('npm 安装源', '<input class="input" id="set-npm-registry" value="' + esc(c.npmRegistry || '') + '" spellcheck="false">',
        '装插件时用哪个源；留空走官方源。')
      + setRow('网络代理', '<input class="input" id="set-proxy" value="' + esc(c.proxyUrl || '') + '" placeholder="留空 = 直连" spellcheck="false">')
      + setRow('DSH 服务端口', '<input class="input set-num" id="set-dsh-port" type="number" min="1" max="65535" value="'
        + esc(String(c.dshPort || '')) + '">', '改完要重启 DSH 服务才生效。')
      + '</div>';

    html += '<div class="card"><div class="card-title">关于</div>'
      + kv('管家版本', (res.appName || '') + ' ' + (res.appVersion || ''), true)
      + kv('可执行文件', res.exePath || '', true)
      + kv('配置文件', res.configPath || '', true)
      + setRow('官网', '<a class="btn sm" href="https://dsh.huilinsh.cn" data-open-url="https://dsh.huilinsh.cn">' + icon('external') + '<span>打开 DSH 管家官网</span></a>',
        '更新说明、下载与文档都在官网。')
      + setRow('使用指引', '<button class="btn sm" id="btn-see-onboarding">' + icon('clipboard') + '<span>再看一遍首次使用指引</span></button>',
        '忘了哪个入口干什么用的，点一下就弹出来。')
      + '</div>';

    html += '<div class="btn-row" style="margin-top:4px"><button class="btn primary" id="btn-save-settings">保存设置</button>'
      + '<button class="btn" id="btn-refresh-page">放弃修改</button></div>';
    return html;
  }

  function saveSettings() {
    var body = {
      theme: $('set-theme').value,
      closeToTray: $('set-close-to-tray').checked,
      autostart: $('set-autostart').checked,
      dockEnabled: $('set-dock-enabled').checked,
      dockIdleMs: (Number($('set-dock-idle').value) || 3) * 1000,
      marketCatalogTtlMs: Number($('set-market-ttl').value),
      autoCheckCoreUpdate: $('set-auto-core').checked,
      autoCheckButlerUpdate: $('set-auto-butler').checked,
      npmRegistry: $('set-npm-registry').value,
      proxyUrl: $('set-proxy').value,
      dshPort: Number($('set-dsh-port').value)
    };
    api('/api/settings', { method: 'POST', body: body }).then(function (r) {
      if (!r || r.ok === false) { toast((r && r.error) || '保存失败', 'err'); return; }
      toast('设置已保存' + (r.notes && r.notes.length ? '；' + r.notes.join('；') : ''), '');
      state.extra.settings = null;
      go('settings', true);
    }).catch(function (e) { toast('保存失败：' + (e && e.message ? e.message : e), 'err'); });
  }

  // ── 插件市场 ─────────────────────────────────────────────────────
  //
  // 目录来自线上（/api/market/catalog，服务端带缓存），本机已装状态由服务端
  // 用插件扫描的事实标好（installedVersion）。装/卸仍然走既有写流程
  // （data-write="plugin.install" / "plugin.uninstall"），也就是"先摊计划再动手"。

  function loadMarket() {
    var m = state.market;
    var qs = '/api/market/catalog?q=' + encodeURIComponent(m.q)
      + '&cat=' + encodeURIComponent(m.cat)
      + '&sort=' + encodeURIComponent(m.sort)
      + '&state=' + encodeURIComponent(m.state)
      + '&page=' + m.page + '&size=48'
      + (m.force ? '&refresh=1' : '');
    m.force = false;
    return api(qs);
  }

  function marketChips(p) {
    var m = state.market;
    var html = '<button class="chip' + (m.cat ? '' : ' on') + '" data-market-cat="">全部<span class="chip-n">' + p.total + '</span></button>';
    for (var i = 0; i < p.categories.length; i++) {
      var c = p.categories[i];
      html += '<button class="chip' + (m.cat === c.key ? ' on' : '') + '" data-market-cat="' + esc(c.key) + '">'
        + esc(c.label) + '<span class="chip-n">' + c.count + '</span></button>';
    }
    return '<div class="chips">' + html + '</div>';
  }

  function marketRow(it) {
    var zh = it.description.zh || it.description.en || '';
    var marks = '';
    if (it.installed) {
      marks += badge('ok', '已装 ' + (it.installedVersion || ''), '本机 profile 依赖清单里的版本');
      if (it.outdated && it.latestVersion) {
        marks += badge('warn', '可更新 → ' + it.latestVersion, 'registry 上的最新版本是 ' + it.latestVersion);
      } else if (it.latestVersion) {
        marks += badge('plain', '已是最新');
      }
    } else {
      marks += badge('plain', '未安装');
    }
    var meta = [];
    if (it.stars) meta.push('★ ' + it.stars);
    if (it.downloads) meta.push('↓ ' + it.downloads);
    if (it.added) meta.push(it.added);
    var actions = '';
    if (it.installed) {
      if (it.outdated && it.latestVersion) {
        actions += writeBtn('upload', '更新到 ' + it.latestVersion, 'plugin.install', { name: it.npm, version: it.latestVersion });
      }
      actions += writeBtn('trash', '卸载', 'plugin.uninstall', { name: it.npm }, 'sm danger');
    } else {
      actions += writeBtn('plus', '安装', 'plugin.install', { name: it.npm });
    }
    var link = it.page || it.url;
    var linkBtn = link
      ? '<a class="btn sm" href="' + esc(link) + '" target="_blank" rel="noreferrer noopener">' + icon('external') + '<span>主页</span></a>'
      : '';
    // 批量勾选只给"还没装"的：已装的那些在上面的按钮里单独处理，混在一起容易误操作
    var pick = it.installed
      ? '<span class="mkt-pick-space"></span>'
      : '<label class="mkt-pick" title="勾选后可一次装多个"><input type="checkbox" data-market-pick="' + esc(it.npm) + '"'
        + (state.market.picked.indexOf(it.npm) >= 0 ? ' checked' : '') + '></label>';
    return '<div class="row mkt-row' + (it.installed ? ' is-installed' : '') + '">' + pick + '<div class="row-main">'
      + '<div class="row-name">' + esc(it.name)
      + '<span class="mkt-owner">' + esc(it.owner ? '@' + it.owner : '') + '</span></div>'
      + '<div class="row-meta">' + marks + (meta.length ? badge('plain', meta.join(' · ')) : '') + '</div>'
      + '<div class="mkt-desc">' + esc(zh) + '</div>'
      + (it.install ? '<div class="mkt-cmd" title="上游给的安装命令">' + esc(it.install) + '</div>' : '')
      + '</div><div class="row-actions">' + actions + linkBtn + '</div></div>';
  }

  // 批量安装：一个一个装，每个都有自己的回滚点与事务日志 —— 不发明"一次改一堆"的新写路径，
  // 出问题时边界清楚：已经装好的留在那儿（各自可回滚），失败的那个停下等你处理。
  function openBatchInstall() {
    var picks = state.market.picked.slice();
    if (!picks.length) { toast('先勾选要装的插件', 'warn'); return; }
    var items = '';
    for (var i = 0; i < picks.length; i++) items += '<li>' + esc(picks[i]) + '</li>';
    openModal({
      title: '批量安装 ' + picks.length + ' 个插件',
      sub: '会一个接一个装：每个都先停服、建自己的回滚点、装完校验，再装下一个。中途失败就停在那里，'
        + '已经装好的保持原样（各自都能回滚）。',
      body: '<ul class="mkt-batch-list">' + items + '</ul>',
      foot: '<button class="btn" id="modal-cancel">取消</button><span class="spacer"></span>'
        + '<button class="btn primary" id="batch-go">开始安装</button>'
    });
    $('modal-cancel').addEventListener('click', closeModal);
    $('batch-go').addEventListener('click', function () {
      closeModal();
      runBatch(picks);
    });
  }

  function runBatch(names) {
    var queue = names.slice();
    var okCount = 0;
    var total = queue.length;
    var wasRunning = false;

    // 批量装的时候每个插件都"停服→装→重启"会白等 N-1 次启动，
    // 所以每个都带 deferRestart，最后按"开始时服务在不在跑"决定要不要统一重启一次。
    function finish(ok, msg) {
      function afterRestart() {
        toast(msg, ok ? '' : 'warn');
        state.market.picked = [];
        state.cache = {};
        go('market', true);
      }
      if (!wasRunning) {
        afterRestart();
        return;
      }
      toast('正在重启 DSH 服务…', '');
      runAction('runtime.restart', {}, '重启 DSH 服务').then(afterRestart, afterRestart);
    }

    api('/api/state/overview').then(function (ov) {
      wasRunning = Boolean(ov && ov.runtime && ov.runtime.running);
      next();
    }).catch(function () { next(); });

    function next() {
      if (!queue.length) {
        finish(true, '批量安装完成：成功 ' + okCount + ' / ' + total + ' 个');
        return;
      }
      var one = queue.shift();
      toast('正在安装 ' + one + '（还剩 ' + queue.length + ' 个）', '');
      runAction('plugin.install', { name: one, deferRestart: true }, '安装 ' + one)
        .then(function () {
          okCount++;
          state.market.picked = state.market.picked.filter(function (n) { return n !== one; });
          next();
        })
        .catch(function (e) {
          finish(false, one + ' 安装失败，已停下（成功 ' + okCount + ' 个）：' + (e && e.message ? e.message : e));
        });
    }
  }

  // 卡片视图：一屏能扫更多，适合"逛"；列表视图信息更全，适合"挑"。
  function marketCard(it) {
    var zh = it.description.zh || it.description.en || '';
    var marks = '';
    if (it.installed) {
      marks += badge('ok', '已装 ' + (it.installedVersion || ''));
      if (it.outdated && it.latestVersion) marks += badge('warn', '可更新 → ' + it.latestVersion);
    } else {
      marks += badge('plain', '未安装');
    }
    var meta = [];
    if (it.stars) meta.push('★ ' + it.stars);
    if (it.downloads) meta.push('↓ ' + it.downloads);
    var actions = '';
    if (it.installed) {
      if (it.outdated && it.latestVersion) {
        actions += writeBtn('upload', '更新', 'plugin.install', { name: it.npm, version: it.latestVersion });
      }
      actions += writeBtn('trash', '卸载', 'plugin.uninstall', { name: it.npm }, 'sm danger');
    } else {
      actions += writeBtn('plus', '安装', 'plugin.install', { name: it.npm });
    }
    var link = it.page || it.url;
    var pick = it.installed
      ? ''
      : '<input type="checkbox" data-market-pick="' + esc(it.npm) + '"'
        + (state.market.picked.indexOf(it.npm) >= 0 ? ' checked' : '') + '>';
    return '<div class="mkt-card' + (it.installed ? ' is-installed' : '') + '">'
      + '<div class="mkt-card-head"><label class="mkt-pick" title="勾选后可一次装多个">' + pick + '</label>'
      + '<div class="mkt-card-title"><div class="row-name">' + esc(it.name) + '</div>'
      + '<div class="mkt-owner">' + esc(it.owner ? '@' + it.owner : '') + '</div></div></div>'
      + '<div class="row-meta">' + marks + '</div>'
      + '<div class="mkt-desc">' + esc(zh) + '</div>'
      + (meta.length ? '<div class="mkt-card-meta">' + esc(meta.join(' · ')) + '</div>' : '')
      + '<div class="mkt-card-actions">' + actions
      + (link ? '<a class="btn sm" href="' + esc(link) + '" target="_blank" rel="noreferrer noopener">' + icon('external') + '<span>主页</span></a>' : '')
      + '</div></div>';
  }

  function marketBatchBar(p) {
    var n = state.market.picked.length;
    if (!n) return '';
    return '<div class="mkt-batch"><span>已选 <strong>' + n + '</strong> 个</span>'
      + '<button class="btn sm primary" id="market-batch-go">' + icon('plus') + '<span>批量安装</span></button>'
      + '<button class="btn sm" id="market-batch-clear">清空</button></div>';
  }

  function renderMarket(res) {
    var m = state.market;
    var head = pageHead('插件市场', '线上目录挑插件，装与卸都先摊开计划、你确认了才动手。', '');
    if (!res || (res.ok === false)) {
      var why = (res && res.error) || '市场没有返回内容';
      return head
        + '<div class="card">' + emptyBox('没能连上市场', why, '<div class="muted">检查网络或稍后再试；目录一旦拉到本地会缓存 6 小时。</div>') + '</div>';
    }
    var p = res.page;
    var tools = '<button class="btn sm" id="btn-market-refresh">' + icon('refresh') + '<span>刷新目录</span></button>';
    var html = pageHead('插件市场', '线上目录共 ' + res.total + ' 个插件，数据更新于 ' + esc(res.updated || '未知') + '。', tools);
    html += '<div class="card"><div class="stats">'
      + stat('目录插件', p.total)
      + stat('当前筛出', p.matched)
      + stat('本机已装', res.installedCount, '来自本机 profile 的依赖清单')
      + stat('可更新', res.outdatedCount || 0, res.outdatedCount ? '点「可更新」看是哪些' : '已装插件都是最新的')
      + stat('数据时间', res.cached ? '本地缓存' : '刚刚更新', res.cachedAt ? '缓存于 ' + res.cachedAt.slice(0, 16).replace('T', ' ') : '')
      + '</div>';
    if (res.note) html += '<div class="note-line">' + esc(res.note) + '</div>';
    html += '</div>';

    html += '<div class="card"><div class="market-bar">'
      + '<input class="input mkt-q" id="market-q" type="search" placeholder="搜插件名、作者或描述关键词" value="' + esc(m.q) + '">'
      + '<button class="btn sm" id="market-search">' + icon('search') + '<span>搜索</span></button>'
      + '<select class="select mkt-sort" id="market-sort">'
      + '<option value="downloads"' + (m.sort === 'downloads' ? ' selected' : '') + '>按下载量</option>'
      + '<option value="stars"' + (m.sort === 'stars' ? ' selected' : '') + '>按 star</option>'
      + '<option value="new"' + (m.sort === 'new' ? ' selected' : '') + '>最新上架</option>'
      + '<option value="name"' + (m.sort === 'name' ? ' selected' : '') + '>按名字</option>'
      + '</select>'
      + '<button class="btn sm' + (m.state === 'all' ? ' on' : '') + '" data-market-state="all">全部</button>'
      + '<button class="btn sm' + (m.state === 'missing' ? ' on' : '') + '" data-market-state="missing">未安装</button>'
      + '<button class="btn sm' + (m.state === 'installed' ? ' on' : '') + '" data-market-state="installed">已安装</button>'
      + '<button class="btn sm' + (m.state === 'outdated' ? ' on' : '') + '" data-market-state="outdated">可更新<span class="chip-n">' + (res.outdatedCount || 0) + '</span></button>'
      // 【2026-09-25 审计 Q-12】这里原本还多出一行孤立的 span 闭合标签（上一行已经闭合干净），
      // 它会把 .market-bar 的 DOM 结构推歪 —— 浏览器容错掩盖了这个问题。
      + '</div>' + marketChips(p) + '</div>';

    // ② 视图切换（列表/卡片）放在「插件列表」标题行最右侧，不进搜索栏
    var viewToggle = '<span class="seg mkt-view-toggle" title="切换列表/卡片视图">'
      + '<button class="btn icon' + (m.view === 'list' ? ' on' : '') + '" data-market-view="list" aria-label="列表视图" title="列表视图">' + icon('list') + '</button>'
      + '<button class="btn icon' + (m.view === 'card' ? ' on' : '') + '" data-market-view="card" aria-label="卡片视图" title="卡片视图">' + icon('grid') + '</button>'
      + '</span>';
    html += '<div class="card"><div class="card-title">插件列表<span class="sub">'
      + p.matched + ' 个结果 · 第 ' + p.page + '/' + p.pages + ' 页</span>'
      + '<button class="btn sm" id="market-pick-all">勾选本页未安装的</button>'
      + '<span id="market-batch-slot">' + marketBatchBar(p) + '</span>'
      + '<span class="spacer"></span>' + viewToggle + '</div>';
    var pagerHtml = '<div class="mkt-pager">'
      + '<button class="btn sm" data-market-page="' + (p.page - 1) + '"' + (p.page <= 1 ? ' disabled' : '') + '>上一页</button>'
      + '<span class="muted">第 ' + p.page + ' / ' + p.pages + ' 页</span>'
      + '<button class="btn sm" data-market-page="' + (p.page + 1) + '"' + (p.page >= p.pages ? ' disabled' : '') + '>下一页</button>'
      + '</div>';
    if (!p.items.length) {
      html += emptyBox('没有匹配的插件', '换个关键词，或点上面的「全部」清掉筛选。');
    } else if (m.view === 'card') {
      html += '<div class="mkt-cards">';
      for (var ci = 0; ci < p.items.length; ci++) html += marketCard(p.items[ci]);
      html += '</div>' + pagerHtml;
    } else {
      html += '<div class="rows">';
      for (var i = 0; i < p.items.length; i++) html += marketRow(p.items[i]);
      html += '</div>' + pagerHtml;
    }
    html += '</div>';
    return html;
  }

  function loadJobs() { return api('/api/jobs?limit=50'); }

  function renderJobs(list) {
    var tools = '<button class="btn sm" id="btn-refresh-page">' + icon('refresh') + '<span>刷新</span></button>';
    var html = pageHead('任务', '管家做过的每一件事都在这里，步骤、耗时与结果都可回看。', tools);
    if (!list || !list.length) {
      return html + '<div class="card">' + emptyBox('还没有任何任务', '跑一次体检或装一个插件，这里就有记录了。') + '</div>';
    }
    html += '<div class="card"><div class="card-title">历史任务<span class="sub">最近 ' + list.length + ' 条</span></div><div class="rows">';
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      var kind = j.status === 'succeeded' ? 'ok' : j.status === 'failed' || j.status === 'timeout' ? 'err' : j.status === 'running' ? 'warn' : 'plain';
      var dur = j.endedAt ? fmtDur(new Date(j.endedAt) - new Date(j.startedAt || j.createdAt)) : (j.status === 'running' ? '进行中' : '-');
      html += '<div class="row" data-job="' + esc(j.id) + '" role="button" tabindex="0" style="cursor:pointer">'
        + '<div class="row-main"><div class="row-name">' + esc(j.actionTitle) + '<span class="mono muted">' + esc(j.action) + '</span></div>'
        + '<div class="row-meta"><span>' + fmtTime(j.createdAt) + '</span><span>' + esc(dur) + '</span><span>' + esc(j.id) + '</span></div></div>'
        + '<div class="row-actions">' + badge(kind, STATUS_LABEL[j.status] || j.status) + '<button class="btn sm sticky" data-job="' + esc(j.id) + '">' + icon('chevron') + '<span>详情</span></button></div></div>';
    }
    html += '</div></div>';
    return html;
  }

  function openJob(id) {
    api('/api/jobs/' + encodeURIComponent(id)).then(function (job) {
      var body = '<div class="stats">'
        + stat('状态', STATUS_LABEL[job.status] || job.status)
        + stat('开始', fmtTime(job.startedAt || job.createdAt))
        + stat('耗时', job.endedAt ? fmtDur(new Date(job.endedAt) - new Date(job.startedAt || job.createdAt)) : '-')
        + '</div>';
      if (job.params && Object.keys(job.params).length) {
        body += '<div style="height:12px"></div>' + kv('参数', JSON.stringify(job.params), true);
      }
      body += '<div class="card-title" style="margin-top:16px">步骤</div>';
      if (job.steps && job.steps.length) {
        body += '<div class="rows">';
        for (var i = 0; i < job.steps.length; i++) {
          var s = job.steps[i];
          var tag = s.status === 'done' ? 'ok' : s.status === 'failed' ? 'err' : s.status === 'running' ? 'warn' : 'plain';
          body += '<div class="row"><div class="row-main"><div class="row-name">' + esc(s.title) + '</div>'
            + (s.error ? '<div class="row-meta">' + esc(s.error) + '</div>' : (s.detail ? '<div class="row-meta">' + esc(s.detail) + '</div>' : ''))
            + '</div>' + badge(tag, s.status === 'done' ? '完成' : s.status === 'failed' ? '失败' : s.status === 'running' ? '进行中' : s.status) + '</div>';
        }
        body += '</div>';
      } else {
        body += emptyBox('这个任务没有步骤记录', '');
      }
      if (job.error) body += '<div style="height:12px"></div><div class="finding error explain-text"><div class="finding-title"><span class="tag error">错误</span>任务没有成功</div><div class="finding-row">' + esc(job.error) + '</div></div>';
      if (job.result) body += '<div class="card-title" style="margin-top:16px">结果</div><div class="logbox">' + esc(JSON.stringify(job.result, null, 2)) + '</div>';
      openModal({
        title: esc(job.actionTitle) + '<span class="sub" style="font-size:12.5px;font-weight:400"> ' + esc(job.action) + '</span>',
        sub: '任务 ' + job.id,
        body: body,
        foot: '<span class="spacer"></span><button class="btn primary" id="modal-close">关闭</button>'
      });
      $('modal-close').addEventListener('click', closeModal);
    }).catch(function (e) { errorModal('打不开任务详情', e && e.message ? e.message : String(e), ''); });
  }

  // ── 页面：回滚点 ─────────────────────────────────────────────────

  function renderBackups(r) {
    var tools = writeBtn('plus', '创建回滚点', 'backup.create')
      + actBtn('shield', '校验全部', 'backup.verify');
    var pt = r.points || [];
    var html = pageHead('回滚点', '任何写操作动手前都会自动留一个回滚点；这里也能自己建、自己还原。', tools);
    html += '<div class="card"><div class="stats">'
      + stat('回滚点数量', pt.length)
      + stat('已验证', pt.filter(function (x) { return x.verified; }).length, '通过内容回读校验')
      + stat('占用空间', humanSize(pt.reduce(function (a, b) { return a + (b.sizeBytes || 0); }, 0)))
      + stat('保存位置', r.root || '-', '', true)
      + '</div></div>';
    if (!pt.length) {
      return html + '<div class="card">' + emptyBox('还没有回滚点', '写操作会自动创建；也可以点右上角「创建回滚点」手动留一个。') + '</div>';
    }
    // 【P0-4 · 2026-09-25】列表改成时间线：按时间倒序，一眼看出「谁在什么时候改了什么」；
    // 每条都能先点「影响预览」看清会覆盖什么，再决定要不要还原。
    html += '<div class="card"><div class="card-title">时间线'
      + '<span class="sub">按时间倒序 · 共 ' + pt.length + ' 个</span></div>'
      + '<div class="timeline">';
    for (var i = 0; i < pt.length; i++) {
      var p = pt[i];
      var files = (p.artifacts || []).length;
      html += '<div class="tl-item">'
        + '<span class="tl-dot ' + (p.verified ? 'ok' : 'warn') + '"></span>'
        + '<div class="tl-body">'
        + '<div class="tl-head"><b>' + esc(KIND_LABEL[p.kind] || p.kind) + '</b>'
        + (p.verified ? badge('ok', '已验证') : badge('warn', '未验证'))
        + '<span class="tl-when">' + esc(fmtAgo(p.createdAt)) + ' · ' + esc(fmtTime(p.createdAt)) + '</span></div>'
        + '<div class="tl-meta"><span>由「' + esc(p.trigger || '未知') + '」创建</span>'
        + '<span>' + files + ' 个文件</span>'
        + '<span>' + humanSize(p.sizeBytes) + '</span>'
        + '<span class="mono muted">' + esc(p.id) + '</span></div>'
        + '<div class="tl-actions">'
        + '<button class="btn sm" data-act="backup.preview" data-id="' + esc(p.id) + '">' + icon('search') + '<span>影响预览</span></button>'
        + writeBtn('history', '还原', 'backup.apply', { id: p.id }, 'sm danger')
        + '<button class="btn sm" data-act="backup.verify" data-id="' + esc(p.id) + '">' + icon('shield') + '<span>校验</span></button>'
        + writeBtn('trash', '删除', 'backup.delete', { id: p.id }, 'sm')
        + '</div></div></div>';
    }
    html += '</div></div>';
    return html;
  }

  // ── 页面：数据搬家（P1-2） ───────────────────────────────────────

  /** 带参数的只读按钮（检查某个搬移包）—— actBtn 不带参数，这里单独造。 */
  function packBtn(iconName, label, action, dir, cls) {
    return '<button class="btn ' + (cls || 'sm') + '" data-act="' + esc(action) + '" data-params="' +
      esc(JSON.stringify({ dir: dir })) + '" title="' + esc(label) + '">' + icon(iconName) + '<span>' + esc(label) + '</span></button>';
  }

  function renderData(r) {
    var tools = writeBtn('upload', '导出搬移包', 'data.export')
      + writeBtn('box', '立即备份一次', 'data.backup')
      + actBtn('shield', '检查最新包', 'data.inspect');
    var list = r.backups || [];
    var lim = r.limits || { maxBackups: 0, maxBackupBytes: 0 };
    var html = pageHead('数据搬家', '把配置、插件清单与技能打成搬移包，换机时拷过去就能恢复；备份目录里的旧包按保留策略自动清理。', tools);
    html += '<div class="card"><div class="stats">'
      + stat('备份数量', list.length)
      + stat('占用空间', humanSize(r.totalBytes || 0))
      + stat('保留策略', lim.maxBackups + ' 个 / ' + Math.round((lim.maxBackupBytes || 0) / 1024 / 1024) + ' MB', '超出的旧备份会在下次备份时清理')
      + stat('保存位置', r.root || '-', '', true)
      + '</div></div>';
    var plan = r.plan || { trim: [] };
    if (plan.trim && plan.trim.length) {
      html += '<div class="card"><div class="note-line">按当前保留策略，下次备份会清理 ' + plan.trim.length + ' 个最旧的包：'
        + esc(plan.trim.map(function (x) { return x.stamp; }).join('、')) + '</div></div>';
    }
    if (!list.length) {
      return html + '<div class="card">' + emptyBox('还没有备份', '点右上角「立即备份一次」做一份精简备份；或「导出搬移包」按预设导出到指定位置。') + '</div>';
    }
    html += '<div class="card"><div class="card-title">备份与搬移包<span class="sub">按时间倒序 · 共 ' + list.length + ' 个</span></div><div class="rows">';
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var presetLabel = b.preset === 'full' ? '完整' : b.preset === 'with-skills' ? '含技能' : '精简';
      html += '<div class="row"><div class="row-main">'
        + '<div class="row-name">' + esc(fmtAgo(b.createdAt || b.stamp)) + '<span class="mono muted">' + esc(b.stamp) + '</span>'
        + badge('plain', presetLabel) + '</div>'
        + '<div class="row-meta"><span>' + esc(fmtTime(b.createdAt)) + '</span><span>' + humanSize(b.bytes || 0) + '</span><span>' + (b.fileCount || 0) + ' 个文件</span></div>'
        + '<div class="row-actions">'
        + packBtn('search', '检查', 'data.inspect', b.dir)
        + writeBtn('history', '恢复', 'data.restore', { params: { dir: b.dir } }, 'sm danger')
        + '</div></div></div>';
    }
    html += '</div></div>';
    return html;
  }

  // ── 页面：一键部署 ───────────────────────────────────────────────

  function verifyChecksCard(title, v) {
    var passed = (v.checks || []).filter(function (c) { return c.ok; }).length;
    var html = '<div class="card hero ' + (v.ok ? 'ok' : 'err') + '"><div class="card-title">' + esc(title)
      + '<span class="sub">' + passed + '/' + (v.checks || []).length + ' 项通过 · ' + fmtTime(v.checkedAt) + '</span></div>';
    html += '<div class="rows">';
    for (var i = 0; i < (v.checks || []).length; i++) {
      var c = v.checks[i];
      html += '<div class="row"><div class="row-main"><div class="row-name">' + esc(c.label) + '</div>'
        + '<div class="row-meta">' + esc(c.detail) + '</div></div>'
        + badge(c.ok ? 'ok' : 'err', c.ok ? '通过' : '未通过') + '</div>';
    }
    html += '</div>';
    if (v.findings && v.findings.length) {
      html += '<div style="height:12px"></div>' + renderFindings(v.findings);
    }
    html += '</div>';
    return html;
  }

  function renderBootstrap(plan) {
    var tools = actBtn('shield', '校验当前部署', 'bootstrap.verify');
    var html = pageHead('一键部署', '从零装一台 DSH：先出计划、你确认之后才动手。', tools);

    if (plan.interrupted) {
      html += '<div class="card hero warn"><div class="hero-title">上次部署没跑完</div>'
        + '<div class="hero-desc">停在「' + esc(plan.interrupted.step) + '」（开始于 ' + fmtTime(plan.interrupted.startedAt) + '）。'
        + '可以继续 —— 每一步都会先看现场再动手，不会把已经做完的事重做一遍；也可以放弃回滚，半成品会被移进隔离区。</div>'
        + '<div class="btn-row" style="margin-top:12px">'
        + writeBtn('play', '继续部署', 'bootstrap.apply', {}, 'primary')
        + writeBtn('trash', '放弃并回滚', 'bootstrap.discard', {}, 'sm danger')
        + '</div></div>';
    }

    if (plan.verdict === 'already-installed') {
      html += '<div class="card hero warn"><div class="hero-title">这台机器已经装过 DSH</div>'
        + '<div class="hero-desc">本体在 ' + esc(plan.installed ? plan.installed.path : plan.targetRoot)
        + '。日常更新请用「DSH 本体 → 更新本体」；确实要从零重装，可以强制重装 —— 旧目录会先移进隔离区（不删除，可还原）。</div>'
        + '<div class="btn-row" style="margin-top:12px">' + navBtn('box', '去 DSH 本体页', 'core')
        + '<button class="btn" id="btn-bootstrap-form">' + icon('deploy') + '<span>强制重装…</span></button></div></div>';
    } else if (plan.blockers && plan.blockers.length) {
      html += '<div class="card hero err"><div class="hero-title">现在还不能开始</div>'
        + '<div class="hero-desc">有 ' + plan.blockers.length
        + ' 项阻碍需要先解决，见下面「阻碍项」。处理完点右上角刷新重新出计划。</div></div>';
    } else {
      html += '<div class="card hero ' + (plan.verdict === 'ready' ? 'ok' : 'warn') + '">'
        + '<div class="hero-title">可以开始部署</div>'
        + '<div class="hero-desc">预计下载 ' + humanSize(plan.estimates.downloadBytes) + ' · 占盘 '
        + humanSize(plan.estimates.diskBytes) + ' · 约 ' + plan.estimates.minutesMin + '-' + plan.estimates.minutesMax + ' 分钟。'
        + (plan.verdict === 'needs-setup' ? '（会顺带把 pnpm 装上）' : '') + '</div>'
        + '<div class="btn-row" style="margin-top:12px"><button class="btn primary" id="btn-bootstrap-form">'
        + icon('deploy') + '<span>开始部署…</span></button></div></div>';
    }

    html += '<div class="card"><div class="stats">'
      + stat('安装目录', plan.targetRoot, plan.targetExists ? '目录已存在' : '将新建', true)
      + stat('预计下载', humanSize(plan.estimates.downloadBytes))
      + stat('预计占盘', humanSize(plan.estimates.diskBytes))
      + stat('预计耗时', plan.estimates.minutesMin + '-' + plan.estimates.minutesMax + ' 分钟')
      + '</div></div>';

    html += '<div class="card"><div class="card-title">这台机器</div>'
      + kv('系统', plan.system.platform + ' ' + plan.system.arch + ' · ' + plan.system.osVersion)
      + kv('处理器', plan.system.cpuModel + ' · ' + plan.system.cpuCount + ' 核')
      + kv('内存', humanSize(plan.system.memFreeBytes) + ' 可用 / ' + humanSize(plan.system.memTotalBytes) + ' 总')
      + (plan.disk
        ? kv('目标盘可用', humanSize(plan.disk.freeBytes) + ' / ' + humanSize(plan.disk.totalBytes) + '（' + plan.disk.path + '）')
        : '')
      + '</div>';

    html += '<div class="card"><div class="card-title">运行时</div>';
    for (var i = 0; i < plan.runtime.length; i++) {
      var t = plan.runtime[i];
      html += kv(t.label + (t.required ? '（必需）' : '（可选）'), t.found ? (t.version || '已安装') : '缺失', true);
    }
    html += '</div>';

    html += '<div class="card"><div class="card-title">部署步骤<span class="sub">共 ' + plan.steps.length
      + ' 步 · 点「开始部署」之前可以先逐条看</span></div><div class="rows">';
    for (var j = 0; j < plan.steps.length; j++) {
      var s = plan.steps[j];
      var kind = s.status === 'ready' ? 'ok' : s.status === 'action' ? 'warn' : 'err';
      var label = s.status === 'ready' ? '可执行' : s.status === 'action' ? '需动作' : '被挡住';
      html += '<div class="row"><div class="row-main"><div class="row-name">' + (j + 1) + '. ' + esc(s.title) + '</div>'
        + '<div class="row-meta"><span>' + esc(s.detail) + '</span>'
        + (s.downloadBytes ? '<span>下载 ' + humanSize(s.downloadBytes) + '</span>' : '')
        + (s.estimateMs ? '<span>约 ' + fmtDur(s.estimateMs) + '</span>' : '')
        + '</div></div>' + badge(kind, label) + '</div>';
    }
    html += '</div></div>';

    if (plan.blockers && plan.blockers.length) {
      html += '<div class="card"><div class="card-title">阻碍项<span class="sub">共 ' + plan.blockers.length
        + ' 项</span></div>' + renderFindings(plan.blockers) + '</div>';
    }

    if (state.extra.bootstrapVerify) html += verifyChecksCard('部署后三连验证', state.extra.bootstrapVerify);
    return html;
  }

  function openBootstrapForm() {
    var plan = state.cache.bootstrap;
    var root = plan ? plan.targetRoot : '';
    var url = 'https://github.com/deepseek-ai/deepseek-harness.git';
    var installed = Boolean(plan && plan.verdict === 'already-installed');
    openModal({
      title: esc(installed ? '强制重装 DSH' : '开始部署 DSH'),
      sub: '下面是这次部署会用到的东西。点「查看计划」后还会再摊一次步骤表，勾选确认才真正动手。',
      body: '<div class="field"><label class="field-label" for="bs-root">安装目录</label>'
        + '<input class="input" id="bs-root" value="' + esc(root) + '" spellcheck="false">'
        + '<div class="field-help">源码会 clone 到这里，磁盘占用约 3.5 GB。</div></div>'
        + '<div class="field"><label class="field-label" for="bs-url">仓库地址</label>'
        + '<input class="input" id="bs-url" value="' + esc(url) + '" spellcheck="false">'
        + '<div class="field-help">默认走官方 GitHub；网络不通时可以换成内网镜像。</div></div>'
        + '<div class="field"><label class="field-label" for="bs-depth">克隆深度</label>'
        + '<input class="input" id="bs-depth" value="1" spellcheck="false">'
        + '<div class="field-help">1 = 浅克隆，只取最新一次提交，首次快很多。</div></div>'
        + (installed
          ? '<label class="check"><input type="checkbox" id="bs-force"><span>我确认要强制重装：现有安装会先被移进隔离区（不删除，可还原）。</span></label>'
          : ''),
      foot: '<button class="btn" id="modal-cancel">取消</button><span class="spacer"></span>'
        + '<button class="btn primary" id="bs-go">查看计划</button>',
    });
    $('modal-cancel').addEventListener('click', closeModal);
    $('bs-go').addEventListener('click', function () {
      var r = ($('bs-root') ? $('bs-root').value : '').trim();
      var u = ($('bs-url') ? $('bs-url').value : '').trim();
      var d = parseInt($('bs-depth') ? $('bs-depth').value : '1', 10);
      var forceEl = $('bs-force');
      var params = {};
      if (r) params.root = r;
      if (u) params.url = u;
      if (d > 0) params.depth = d;
      if (forceEl && forceEl.checked) params.force = true;
      if (installed && !params.force) { toast('强制重装必须先勾选确认', 'warn'); return; }
      closeModal();
      runWriteFlow('bootstrap.apply', params);
    });
  }

  // ── 路由 ─────────────────────────────────────────────────────────

  var PAGES = [
    { id: 'overview', label: '总览', group: '概览', icon: 'grid' },
    { id: 'bootstrap', label: '一键部署', group: '概览', icon: 'deploy', action: 'bootstrap.plan', render: renderBootstrap, title: '一键部署计划' },
    { id: 'market', label: '插件市场', group: '概览', icon: 'store', load: loadMarket, render: renderMarket, title: '插件市场' },
    // 设置不在左栏中间列表里 —— 它在侧栏最底部（markup.ts 的 nav-foot），
    // 但路由仍要注册：data-page="settings" 靠它解析。
    { id: 'settings', label: '设置', group: '记录', icon: 'sliders', load: loadSettings, render: renderSettings, title: '设置', hiddenFromNav: true },
    { id: 'env', label: '环境与配置', group: '诊断', icon: 'sliders', action: 'env.probe', render: renderEnv, title: '环境体检' },
    { id: 'core', label: 'DSH 本体', group: '诊断', icon: 'box', action: 'core.status', render: renderCore, title: '本体状态' },
    { id: 'runtime', label: '运行状态', group: '诊断', icon: 'activity', action: 'runtime.status', render: renderRuntime, title: '服务状态' },
    { id: 'plugins', label: '插件', group: '诊断', icon: 'puzzle', action: 'plugin.scan', render: renderPlugins, title: '插件扫描' },
    { id: 'logs', label: '日志', group: '诊断', icon: 'terminal', action: 'runtime.logs', render: renderLogs, title: '日志收集' },
    { id: 'report', label: '体检报告', group: '诊断', icon: 'clipboard', action: 'diag.healthCheck', render: renderReport, title: '全面体检' },
    { id: 'jobs', label: '任务', group: '记录', icon: 'list', load: loadJobs, render: renderJobs },
    { id: 'backups', label: '回滚点', group: '记录', icon: 'history', action: 'backup.list', render: renderBackups, title: '回滚点列表' },
    { id: 'data', label: '数据搬家', group: '记录', icon: 'box', action: 'data.backups', render: renderData, title: '数据搬家' }
  ];

  try {
    var savedView = localStorage.getItem('dsh-butler-market-view');
    if (savedView === 'card' || savedView === 'list') state.market.view = savedView;
  } catch (e) { /* 忽略 */ }

  function pageById(id) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === id) return PAGES[i];
    return null;
  }

  function buildNav() {
    var html = '';
    var lastGroup = '';
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      if (p.hiddenFromNav) continue; // 设置按钮固定在侧栏底部，不进中间列表
      if (p.group !== lastGroup) {
        html += '<div class="nav-group">' + esc(p.group) + '</div>';
        lastGroup = p.group;
      }
      // core 的徽标是「本体有新版本」时才亮（见 refreshCoreBadge），其余三个是计数。
      var countId = (p.id === 'plugins' || p.id === 'jobs' || p.id === 'backups' || p.id === 'core') ? '<span class="nav-count" id="nav-count-' + p.id + '"></span>' : '';
      html += '<button class="nav-item" data-page="' + p.id + '" title="' + esc(p.label) + '">' + icon(p.icon) + '<span class="label">' + esc(p.label) + '</span>' + countId + '</button>';
    }
    $('nav-items').innerHTML = html;
  }

  function afterRender(page) {
    if (page === 'plugins' && state.cache.plugins) setNavCount('plugins', state.cache.plugins.summary.deps);
    if (page === 'backups' && state.cache.backups) setNavCount('backups', (state.cache.backups.points || []).length);
    // ④ 切页后任务还在跑（如卸载）：进度条保持可见 —— go() 只重渲染主区，不碰固定底栏，
    // 但保险起见在每次重渲染后核对一次：有 running 任务却没挂 SSE 就重新挂上。
    adoptRunningJob();
  }

  function go(page, force) {
    var def = pageById(page);
    if (!def) return;
    state.page = page;
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].getAttribute('data-page') === page);
    }
    if (page === 'overview') {
      loading();
      pageOverview().catch(function (e) { showError(e); });
      return;
    }
    if (page === 'core') fillChangelog();
    if (!force && state.cache[page]) {
      setMain(def.render(state.cache[page]));
      afterRender(page);
      return;
    }
    loading();
    var job = def.load ? def.load() : runAction(def.action, {}, def.title);
    job.then(function (result) {
      state.cache[page] = result;
      setMain(def.render(result));
      afterRender(page);
    }).catch(function (e) { showError(e); });
  }

  function showError(e) {
    var msg = e && e.message ? e.message : String(e);
    setMain('<div class="page-head"><div><h1 class="page-title">出错了</h1><p class="page-desc">这一步没能完成。</p></div></div>'
      + '<div class="card hero err"><div class="hero-title">检测失败</div><div class="hero-desc">' + esc(msg) + '</div>'
      + '<div class="btn-row" style="margin-top:12px"><button class="btn primary" id="btn-refresh-page">' + icon('refresh') + '<span>重试</span></button></div></div>');
    toast('检测失败：' + msg, 'err');
  }

  // ── 事件绑定 ─────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    var hit = function (sel) { return t.closest ? t.closest(sel) : null; };

    var w = hit('[data-write]');
    if (w) { startWrite(w.getAttribute('data-write'), w); return; }
    var a = hit('[data-act]');
    if (a) { startRead(a.getAttribute('data-act'), a); return; }
    var jr = hit('[data-job]');
    if (jr) { openJob(jr.getAttribute('data-job')); return; }
    var nv = hit('[data-page]');
    if (nv) { go(nv.getAttribute('data-page'), false); return; }
    if (hit('#btn-refresh-changelog')) { fillChangelog(); return; }
    var seenBtn = hit('#btn-notices-seen');
    if (seenBtn) {
      api('/api/notices/seen', { method: 'POST' }).then(function (r) {
        state.notices = r && r.notices ? r.notices : [];
        toast('已全部标记为已读');
        go(state.page, true);
      }).catch(function (e) { toast('标记失败：' + (e && e.message ? e.message : e), 'err'); });
      return;
    }
    if (hit('#btn-refresh') || hit('#btn-refresh-page')) { state.cache = {}; state.extra = {}; go(state.page, true); return; }
    if (hit('#btn-theme')) { toggleTheme(); return; }
    if (hit('#market-pick-all')) {
      if (state.cache.market) {
        var pageItems = state.cache.market.page.items;
        for (var pi = 0; pi < pageItems.length; pi++) {
          if (pageItems[pi].installed) continue;
          if (state.market.picked.indexOf(pageItems[pi].npm) < 0) state.market.picked.push(pageItems[pi].npm);
        }
      }
      go('market', true);
      return;
    }
    var mview = hit('[data-market-view]');
    if (mview) {
      state.market.view = mview.getAttribute('data-market-view') || 'list';
      try { localStorage.setItem('dsh-butler-market-view', state.market.view); } catch (e) { /* 忽略 */ }
      go('market', true);
      return;
    }
    if (hit('#market-batch-go')) { openBatchInstall(); return; }
    if (hit('#market-batch-clear')) { state.market.picked = []; go('market', true); return; }
    if (hit('#btn-market-refresh')) { state.market.force = true; state.market.page = 1; go('market', true); return; }
    if (hit('#market-search')) { state.market.q = ($('market-q') ? $('market-q').value : ''); state.market.page = 1; go('market', true); return; }
    var mcat = hit('[data-market-cat]');
    if (mcat) { state.market.cat = mcat.getAttribute('data-market-cat') || ''; state.market.page = 1; go('market', true); return; }
    var mst = hit('[data-market-state]');
    if (mst) { state.market.state = mst.getAttribute('data-market-state') || 'all'; state.market.page = 1; go('market', true); return; }
    var mpg = hit('[data-market-page]');
    if (mpg) { state.market.page = parseInt(mpg.getAttribute('data-market-page'), 10) || 1; go('market', true); return; }
    if (hit('#btn-cancel')) { cancelJob(); return; }
    if (hit('#btn-save-settings')) { saveSettings(); return; }
    if (hit('#btn-check-butler-update')) {
      toast('正在检查管家更新…', '');
      api('/api/update/butler?force=1').then(function (r) {
        state.extra.butlerUpdate = r;
        toast(r && r.available ? ('管家有新版本 ' + r.latest) : (r && r.error ? ('没查到：' + r.error) : '已是最新'), r && r.available ? 'warn' : '');
        go('settings', true);
      }).catch(function (e) { toast('检查失败：' + (e && e.message ? e.message : e), 'err'); });
      return;
    }
    if (hit('#btn-export-logs')) {
      toast('正在打包日志…', '');
      api('/api/logs/export', { method: 'POST' }).then(function (r) {
        if (r && r.ok) toast('日志已导出：' + r.path, '');
        else toast((r && r.error) || '导出失败', 'err');
      }).catch(function (e) { toast('导出失败：' + (e && e.message ? e.message : e), 'err'); });
      return;
    }
    if (hit('#btn-copy-report')) { copyReport(); return; }
    if (hit('#btn-see-onboarding')) { showOnboarding(); return; }
    if (hit('#btn-bootstrap-form')) { openBootstrapForm(); return; }
    if (hit('[data-enter-dsh]')) { enterDsh(hit('[data-enter-dsh]')); return; }
    if (hit('#modal-cancel') || hit('#modal-close')) { closeModal(); return; }
    // ⑩ 外链（官网 / 插件主页 / 下载新版）：desktop WebView 里 target=_blank 不一定开得到系统浏览器，
    // 统一拦下来用 window.open 让宿主打开。
    var ou = hit('[data-open-url]');
    if (ou) {
      e.preventDefault();
      var url = ou.getAttribute('data-open-url') || ou.getAttribute('href');
      if (url) { try { window.open(url, '_blank'); } catch (err) { toast('打不开链接：' + (err && err.message ? err.message : err), 'warn'); } }
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.modalOpen) { closeModal(); return; }
    if (e.key === 'Enter' && e.target && e.target.id === 'market-q') { state.market.q = e.target.value; state.market.page = 1; go('market', true); return; }
    // 任务行是 role="button"：键盘上的 Enter / 空格也要能打开详情 —— 只用鼠标才算"能用"是不合格的。
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest) {
      var row = e.target.closest('.row[data-job]');
      if (row && e.target === row) {
        e.preventDefault();
        openJob(row.getAttribute('data-job'));
      }
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'market-sort') { state.market.sort = e.target.value; state.market.page = 1; go('market', true); return; }
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-market-pick')) {
      var pickedName = e.target.getAttribute('data-market-pick');
      if (e.target.checked) {
        if (state.market.picked.indexOf(pickedName) < 0) state.market.picked.push(pickedName);
      } else {
        state.market.picked = state.market.picked.filter(function (n) { return n !== pickedName; });
      }
      var slot = document.getElementById('market-batch-slot');
      if (slot) slot.innerHTML = marketBatchBar();
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'log-filter') {
      state.logFilter = e.target.value;
      if (state.cache.logs) {
        setMain(renderLogs(state.cache.logs));
        var el = $('log-filter');
        if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { /* ignore */ } }
      }
    }
  });

  var backdrop = $('modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'modal-backdrop') closeModal();
    });
  }

  // ── 启动 ─────────────────────────────────────────────────────────

  applyTheme();
  buildNav();
  applyNavTips();
  api('/api/state/overview').then(function (ov) {
    $('app-version').textContent = 'v' + (ov.app.version || '');
    go('overview', false);
    // ④ 窗口刚打开时，若后台还有在跑的任务（如上一轮没走完的卸载），把进度条挂回去
    adoptRunningJob();
    maybeOnboarding();
  }).catch(function (e) { showError(e); });

  // ⑨ 侧栏底部「使用小技巧」：随机取一条，点一下换下一条（纯本地轮换，不发请求）
  function applyNavTips() {
    var el = $('nav-tip');
    var tips = window.__NAV_TIPS__ || [];
    if (!el || !tips.length) return;
    el.dataset.index = String(Math.floor(Math.random() * tips.length));
    el.textContent = tips[Number(el.dataset.index)];
    el.addEventListener('click', function () {
      el.dataset.index = String((Number(el.dataset.index) + 1) % tips.length);
      el.textContent = tips[Number(el.dataset.index)];
    });
  }

  // ⑧ 首次使用：功能指引（只弹一次，config.onboardingDone 记住）
  function maybeOnboarding() {
    api('/api/settings').then(function (res) {
      if (!res || res.ok === false) return;
      if (res.config && res.config.onboardingDone) return;
      showOnboarding();
    }).catch(function () { /* 设置读不到就不打扰 */ });
  }

  function showOnboarding() {
    var body =
      '<div class="finding info"><div class="finding-title"><span class="tag info">欢迎</span>DSH管家 · 首次使用指引</div>'
      + '<ol class="steps-ol" style="margin:10px 0 0 18px;line-height:2">'
      + '<li><b>总览</b>：一眼看 DSH 本体、服务与插件的当前状况，异常会直接给出下一步动作。</li>'
      + '<li><b>一键部署</b>：从零装一台 DSH；先出计划、你确认之后才动手。</li>'
      + '<li><b>插件市场</b>：线上目录挑插件；装 / 卸 / 更新都先摊开计划再执行，勾选多个可一次装完。</li>'
      + '<li><b>体检报告</b>：全面检查并把结论 + 证据 + 建议整理成可复制的 Markdown。</li>'
      + '<li><b>回滚点</b>：每次写操作前自动留一个；出问题从这里一键还原。</li>'
      + '<li><b>底部任务条</b>：任务进行中实时显示步骤链与进度，可取消；切页也不丢。</li>'
      + '</ol></div>';
    openModal({
      title: '欢迎使用 DSH管家',
      sub: '让 DSH 始终好用 —— 一键部署、环境体检、插件管理、更新与回滚，都在一个窗口里。',
      body: body,
      foot: '<span class="spacer"></span><button class="btn" id="onboarding-later">稍后再说</button><button class="btn primary" id="onboarding-done">知道了</button>'
    });
    function done(save) {
      closeModal();
      if (save) api('/api/settings', { method: 'POST', body: { onboardingDone: true } }).catch(function () { /* 忽略 */ });
    }
    $('onboarding-later').addEventListener('click', function () { done(false); });
    $('onboarding-done').addEventListener('click', function () { done(true); });
  }
})();`;
