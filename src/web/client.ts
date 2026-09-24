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
    job: null,
    es: null,
    modalOpen: false,
    lastFocus: null,
    pendingPlan: null,
    logFilter: ''
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
    deploy: SVG_OPEN + '<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>'
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
    'plugin.scan': '插件扫描', 'plugin.diagnose': '插件诊断', 'plugin.install': '安装插件',
    'plugin.uninstall': '卸载插件', 'plugin.repair': '修复插件', 'plugin.cleanResidue': '清理安装残留',
    'backup.list': '回滚点列表', 'backup.create': '创建回滚点', 'backup.apply': '回滚到该点',
    'backup.delete': '删除回滚点', 'backup.verify': '校验回滚点'
  };
  var ACT_DANGER = {
    'plugin.uninstall': true, 'plugin.cleanResidue': true, 'core.update': true,
    'core.finishUpdate': true, 'core.rollback': true, 'backup.apply': true,
    'backup.delete': true, 'runtime.repair': true
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
    if (action === 'plugin.install' || action === 'plugin.uninstall' || action === 'plugin.repair') return { name: name };
    if (action === 'backup.apply' || action === 'backup.delete' || action === 'backup.verify') return { id: id };
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
    return '<button class="btn ' + (cls || 'sm') + '"' + attrs + ' title="' + esc(label) + '">' + icon(iconName) + '<span>' + esc(label) + '</span></button>';
  }
  function navBtn(iconName, label, page, cls) {
    return '<button class="btn ' + (cls || 'sm') + '" data-page="' + esc(page) + '">' + icon(iconName) + '<span>' + esc(label) + '</span></button>';
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

  function waitJob(jobId, title) {
    showProgress(title || '任务进行中');
    return new Promise(function (resolve, reject) {
      var url = '/api/jobs/' + jobId + '/events' + (TOKEN ? '?t=' + encodeURIComponent(TOKEN) : '');
      var es = new EventSource(url);
      state.es = es;
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        try { es.close(); } catch (e) { /* 已关闭 */ }
        state.es = null;
        state.job = null;
        hideProgress();
        api('/api/jobs/' + jobId).then(function (job) {
          if (job.status === 'succeeded') resolve(job.result);
          else reject(new Error(job.error || ('任务' + (STATUS_LABEL[job.status] || job.status))));
        }, reject);
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
      es.onerror = function () { if (!done) setTimeout(finish, 300); };
    });
  }

  function runAction(action, params, title) {
    return api('/api/jobs', { method: 'POST', body: { action: action, params: params || {} } })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '无法创建任务');
        // 记下正在跑的任务：进度条上的「取消」按钮靠它才能找到要取消谁。
        state.job = res.jobId;
        return waitJob(res.jobId, title);
      });
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
      body: '<div class="finding error"><div class="finding-title"><span class="tag error">失败</span>操作未完成</div><div class="finding-row">' + esc(msg) + '</div></div>',
      foot: '<span class="spacer"></span><button class="btn" id="modal-close">知道了</button>'
    });
    $('modal-close').addEventListener('click', closeModal);
  }

  function confirmPlan(plan, danger) {
    return new Promise(function (resolve) {
      var findings = plan.findings || [];
      var errors = findings.filter(function (f) { return f.severity === 'error'; });
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
        body += '<div class="gate-note">有 ' + errors.length + ' 项错误级问题，执行入口已阻止。请先按「建议」处理后再来。</div>';
      } else {
        body += '<div style="height:14px"></div>';
        body += '<label class="check"><input type="checkbox" id="plan-ack"><span>我已了解上述步骤与影响，确认现在执行。</span></label>';
      }
      var foot = '<button class="btn" id="modal-cancel">取消</button>';
      if (!blocked) {
        foot += '<span class="spacer"></span><button class="btn ' + (danger ? 'danger-solid' : 'primary') + '" id="modal-exec" disabled>' + (danger ? '确认执行（有风险）' : '确认执行') + '</button>';
      }
      openModal({ title: esc(plan.title || '执行计划'), sub: plan.description || '', body: body, foot: foot });
      state.pendingPlan = resolve;
      var ack = $('plan-ack');
      if (ack) ack.addEventListener('change', function () { $('modal-exec').disabled = !ack.checked; });
      $('modal-cancel').addEventListener('click', closeModal);
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

  // 写操作：plan → 确认 → apply
  function startWrite(action, el) {
    if (action === 'backup.create') { openBackupForm(); return; }
    if (action === 'bootstrap.apply') { openBootstrapForm(); return; }
    if (action === 'plugin.install') { openInstallForm(); return; }
    var params = paramsFor(action, el);
    var label = ACT_TITLE[action] || action;
    return api('/api/plan', { method: 'POST', body: { action: action, params: params } })
      .then(function (plan) {
        if (!plan || !plan.ok) throw new Error((plan && plan.error) || '无法生成执行计划');
        return confirmPlan(plan, !!ACT_DANGER[action]);
      })
      .then(function (ok) {
        if (!ok) return null;
        return runAction(action, params, label).then(function (result) {
          state.cache = {};
          return result;
        });
      })
      .then(function (result) {
        if (!result) return;
        toast(label + '：已完成');
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
        return confirmPlan(plan, !!ACT_DANGER[action]);
      })
      .then(function (ok) {
        if (!ok) return null;
        return runAction(action, params, label).then(function (result) { state.cache = {}; return result; });
      })
      .then(function (result) {
        if (!result) return;
        toast(label + '：已完成');
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

  function pageOverview() {
    return api('/api/state/overview').then(function (ov) {
      var html = pageHead('总览', 'DSH 本体、服务与插件的当前状况。', '<button class="btn sm" id="btn-refresh-page">' + icon('refresh') + '<span>刷新</span></button>');
      html += '<div class="card"><div class="stats">'
        + stat('本体', ov.dsh.installed ? (ov.dsh.version || '已安装') : '未安装', ov.dsh.headShort ? '提交 ' + ov.dsh.headShort : '', true)
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
      html += '<div class="card"><div class="card-title">问题概览<span class="sub">来自最近一次体检</span></div><div id="overview-findings">'
        + (state.cache.report && state.cache.report.findings ? renderFindings(state.cache.report.findings) : emptyBox('还没有体检结果', '点上面的「运行全面体检」开始检查。'))
        + '</div></div>';
      setMain(html);
      setBadge('badge-dsh', ov.dsh.installed ? (ov.dsh.needsFinishUpdate ? 'warn' : 'ok') : 'err',
        ov.dsh.installed ? (ov.dsh.needsFinishUpdate ? '本体待完成更新' : '本体正常') : '未安装本体');
      setBadge('badge-service', ov.runtime.running ? 'ok' : '', ov.runtime.running ? '服务运行中' : '服务未运行');
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

  // ── 页面：运行状态 ───────────────────────────────────────────────

  function renderRuntime(r) {
    var tools = actBtn('activity', '运行时诊断', 'runtime.diagnose') + writeBtn('wrench', '修复僵尸锁', 'runtime.repair');
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
    var html = pageHead('日志', '自动从最近的启动日志里挑出真正的错误行。');
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
      if (job.error) body += '<div style="height:12px"></div><div class="finding error"><div class="finding-title"><span class="tag error">错误</span>任务没有成功</div><div class="finding-row">' + esc(job.error) + '</div></div>';
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
    html += '<div class="card"><div class="card-title">回滚点列表</div><div class="rows">';
    for (var i = 0; i < pt.length; i++) {
      var p = pt[i];
      var files = (p.artifacts || []).length;
      html += '<div class="row"><div class="row-main">'
        + '<div class="row-name">' + esc(KIND_LABEL[p.kind] || p.kind) + '<span class="mono muted">' + esc(p.id) + '</span>'
        + (p.verified ? badge('ok', '已验证') : badge('warn', '未验证')) + '</div>'
        + '<div class="row-meta"><span>' + esc(p.trigger || '') + '</span><span>' + fmtTime(p.createdAt) + '</span><span>' + files + ' 个文件</span><span>' + humanSize(p.sizeBytes) + '</span></div>'
        + '</div><div class="row-actions">'
        + writeBtn('history', '还原', 'backup.apply', { id: p.id }, 'sm danger')
        + '<button class="btn sm" data-act="backup.verify" data-id="' + esc(p.id) + '">' + icon('shield') + '<span>校验</span></button>'
        + writeBtn('trash', '删除', 'backup.delete', { id: p.id }, 'sm')
        + '</div></div>';
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
    { id: 'env', label: '环境与配置', group: '诊断', icon: 'sliders', action: 'env.probe', render: renderEnv, title: '环境体检' },
    { id: 'core', label: 'DSH 本体', group: '诊断', icon: 'box', action: 'core.status', render: renderCore, title: '本体状态' },
    { id: 'runtime', label: '运行状态', group: '诊断', icon: 'activity', action: 'runtime.status', render: renderRuntime, title: '服务状态' },
    { id: 'plugins', label: '插件', group: '诊断', icon: 'puzzle', action: 'plugin.scan', render: renderPlugins, title: '插件扫描' },
    { id: 'logs', label: '日志', group: '诊断', icon: 'terminal', action: 'runtime.logs', render: renderLogs, title: '日志收集' },
    { id: 'report', label: '体检报告', group: '诊断', icon: 'clipboard', action: 'diag.healthCheck', render: renderReport, title: '全面体检' },
    { id: 'jobs', label: '任务', group: '记录', icon: 'list', load: loadJobs, render: renderJobs },
    { id: 'backups', label: '回滚点', group: '记录', icon: 'history', action: 'backup.list', render: renderBackups, title: '回滚点列表' }
  ];

  function pageById(id) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === id) return PAGES[i];
    return null;
  }

  function buildNav() {
    var html = '';
    var lastGroup = '';
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      if (p.group !== lastGroup) {
        html += '<div class="nav-group">' + esc(p.group) + '</div>';
        lastGroup = p.group;
      }
      var countId = (p.id === 'plugins' || p.id === 'jobs' || p.id === 'backups') ? '<span class="nav-count" id="nav-count-' + p.id + '"></span>' : '';
      html += '<button class="nav-item" data-page="' + p.id + '" title="' + esc(p.label) + '">' + icon(p.icon) + '<span class="label">' + esc(p.label) + '</span>' + countId + '</button>';
    }
    $('nav-items').innerHTML = html;
  }

  function afterRender(page) {
    if (page === 'plugins' && state.cache.plugins) setNavCount('plugins', state.cache.plugins.summary.deps);
    if (page === 'backups' && state.cache.backups) setNavCount('backups', (state.cache.backups.points || []).length);
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
    if (hit('#btn-refresh') || hit('#btn-refresh-page')) { state.cache = {}; state.extra = {}; go(state.page, true); return; }
    if (hit('#btn-theme')) { toggleTheme(); return; }
    if (hit('#btn-cancel')) { cancelJob(); return; }
    if (hit('#btn-copy-report')) { copyReport(); return; }
    if (hit('#btn-bootstrap-form')) { openBootstrapForm(); return; }
    if (hit('#modal-cancel') || hit('#modal-close')) { closeModal(); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.modalOpen) { closeModal(); return; }
    // 任务行是 role="button"：键盘上的 Enter / 空格也要能打开详情 —— 只用鼠标才算"能用"是不合格的。
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest) {
      var row = e.target.closest('.row[data-job]');
      if (row && e.target === row) {
        e.preventDefault();
        openJob(row.getAttribute('data-job'));
      }
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
  api('/api/state/overview').then(function (ov) {
    $('app-version').textContent = 'v' + (ov.app.version || '');
    go('overview', false);
  }).catch(function (e) { showError(e); });
})();`;
