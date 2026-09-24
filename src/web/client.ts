/**
 * 客户端脚本（内嵌字符串）。
 *
 * 约束：本文件内容会被原样注入 <script>，因此：
 *   - 不使用反引号
 *   - 不使用 ${ 插值
 *   - 字符串一律用单引号拼接
 *
 * 令牌怎么来的：桌面态下【不能】依赖 URL —— 窗口是 deno desktop 运行时自己导航的，
 * 我们塞不进 query。服务端会在响应里下发一个 HttpOnly 的同源 cookie，
 * 浏览器自动携带（EventSource 也一样），所以这里根本不需要知道令牌是什么。
 * 只有用浏览器打开 `?t=<令牌>` 的开发场景才回退到读 query 并手动加请求头。
 */

export const CLIENT_JS = `(function () {
  'use strict';

  var TOKEN = new URLSearchParams(location.search).get('t') || '';
  var state = { page: 'overview', cache: {}, job: null, es: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function humanSize(b) {
    if (!b) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], v = b, i = 0;
    while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
  }

  function toast(msg, kind) {
    var host = $('toast-host');
    var d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    host.appendChild(d);
    setTimeout(function () { d.remove(); }, 5200);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'content-type': 'application/json' };
    // 桌面态 TOKEN 为空：不发令牌头，靠同源 cookie（浏览器自动带）。
    // 开发态从 ?t= 读到了令牌才显式加头。
    if (TOKEN) headers['x-butler-token'] = TOKEN;
    var init = {
      method: opts.method || 'GET',
      headers: headers
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error(t || ('HTTP ' + r.status));
        try { return JSON.parse(t); } catch (e) { return t; }
      });
    });
  }

  var STEPS = {};

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
      var s = steps[i];
      html += '<span class="step ' + esc(s.status) + '">' + esc(s.title) + '</span>';
    }
    $('progress-steps').innerHTML = html;
  }

  function waitJob(jobId, title) {
    showProgress(title || '任务进行中');
    return new Promise(function (resolve, reject) {
      // 桌面态不拼 ?t=：同源 cookie 会由浏览器自动带上（SameSite=Strict 对同源照样生效）。
      var url = '/api/jobs/' + jobId + '/events' + (TOKEN ? '?t=' + encodeURIComponent(TOKEN) : '');
      var es = new EventSource(url);
      state.es = es;
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        try { es.close(); } catch (e) {}
        state.es = null;
        state.job = null;
        hideProgress();
        api('/api/jobs/' + jobId).then(function (job) {
          if (job.status === 'succeeded') resolve(job.result);
          else reject(new Error(job.error || ('任务' + job.status)));
        }, reject);
      }

      es.onmessage = function (e) {
        var ev;
        try { ev = JSON.parse(e.data); } catch (err) { return; }
        if (ev.data && ev.data.status) { /* status payload */ }
        if (ev.data && Array.isArray(ev.data.steps)) {
          renderSteps(ev.data.steps);
          $('progress-fill').style.width = Math.round((ev.data.progress || 0) * 100) + '%';
        }
        if (ev.message && ev.type === 'step-log') $('progress-detail').textContent = ev.message;
        if (ev.type === 'step-start') $('progress-detail').textContent = ev.message || '';
        if (ev.type === 'step-done') {
          var pct = Math.round((ev.progress || 0) * 100);
          if (pct) $('progress-fill').style.width = pct + '%';
        }
        if (ev.type === 'done') finish();
      };
      es.onerror = function () {
        // 服务端关闭流属正常；只有在未结束时才当失败
        if (!done) setTimeout(finish, 300);
      };
    });
  }

  function runAction(action, params, title) {
    return api('/api/jobs', { method: 'POST', body: { action: action, params: params || {} } })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '无法创建任务');
        // 记下正在跑的任务：进度条上的「取消」按钮靠它才能找到要取消谁。
        // 曾漏了这一步，导致按钮点了完全没反应（state.job 永远是 null）。
        state.job = res.jobId;
        return waitJob(res.jobId, title);
      });
  }

  function badge(elId, kind, text) {
    var el = $(elId);
    el.className = 'badge' + (kind ? ' ' + kind : '');
    el.innerHTML = '<span class="dot"></span><span>' + esc(text) + '</span>';
  }

  function kv(k, v, mono) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v' + (mono ? ' mono' : '') + '">' + esc(v) + '</span></div>';
  }

  function renderFindings(findings) {
    if (!findings || findings.length === 0) {
      return '<div class="empty">未发现问题</div>';
    }
    var order = { error: 0, warn: 1, info: 2 };
    findings = findings.slice().sort(function (a, b) { return (order[a.severity] || 9) - (order[b.severity] || 9); });
    var html = '';
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      var tag = f.severity === 'error' ? '错误' : f.severity === 'warn' ? '警告' : '提示';
      html += '<div class="finding ' + esc(f.severity) + '">';
      html += '<div class="finding-title"><span class="tag ' + esc(f.severity) + '">' + tag + '</span>' + esc(f.title) + '</div>';
      if (f.cause) html += '<div class="finding-row"><b>原因：</b>' + esc(f.cause) + '</div>';
      if (f.impact) html += '<div class="finding-row"><b>影响：</b>' + esc(f.impact) + '</div>';
      if (f.action) html += '<div class="finding-row"><b>建议：</b>' + esc(f.action) + '</div>';
      if (f.evidence && f.evidence.length) {
        html += '<div class="finding-evidence">' + esc(f.evidence.slice(0, 6).join('\\n')) + '</div>';
      }
      html += '</div>';
    }
    return html;
  }

  // ── 页面渲染 ───────────────────────────────────────────────

  function pageOverview() {
    return api('/api/state/overview').then(function (ov) {
      var html = '<div class="page-head"><h1 class="page-title">总览</h1><p class="page-desc">DSH 本体与服务的当前状况。只读检测，不会修改任何文件。</p></div>';

      html += '<div class="card"><h2 class="card-title">状态</h2><div class="grid">';
      html += '<div>' + kv('本体', ov.dsh.installed ? (ov.dsh.version || '已安装') : '未安装') + '</div>';
      html += '<div>' + kv('源码提交', ov.dsh.headShort || '-') + '</div>';
      html += '<div>' + kv('需要完成更新', ov.dsh.needsFinishUpdate ? '是' : '否') + '</div>';
      html += '<div>' + kv('服务', ov.runtime.running ? '运行中' : '未运行') + '</div>';
      html += '<div>' + kv('服务端口', ov.runtime.port ? String(ov.runtime.port) : '-') + '</div>';
      html += '<div>' + kv('插件（生效/已装）', ov.plugins.active + ' / ' + ov.plugins.declared) + '</div>';
      html += '</div></div>';

      html += '<div class="card"><h2 class="card-title">快捷操作</h2><div class="btn-row">';
      html += '<button class="btn primary" data-act="diag.healthCheck">运行全面体检</button>';
      html += '<button class="btn" data-act="env.probe">环境体检</button>';
      html += '<button class="btn" data-act="core.status">本体状态</button>';
      html += '<button class="btn" data-act="runtime.status">服务状态</button>';
      html += '</div></div>';

      html += '<div class="card"><h2 class="card-title">问题概览<span class="sub">来自最近一次体检</span></h2>';
      html += '<div id="overview-findings"><div class="empty">点上面的「运行全面体检」开始检查</div></div></div>';

      $('main').innerHTML = html;
      badge('badge-dsh', ov.dsh.installed ? (ov.dsh.needsFinishUpdate ? 'warn' : 'ok') : 'err',
        ov.dsh.installed ? (ov.dsh.needsFinishUpdate ? '本体待完成更新' : '本体正常') : '未安装本体');
      badge('badge-service', ov.runtime.running ? 'ok' : '', ov.runtime.running ? '服务运行中' : '服务未运行');
    });
  }

  function renderEnv(r) {
    var html = '<div class="page-head"><h1 class="page-title">环境与配置</h1><p class="page-desc">系统、运行时、目录、权限与端口状况。</p></div>';
    html += '<div class="card"><h2 class="card-title">系统</h2>';
    html += kv('平台', r.system.platform + ' ' + r.system.arch);
    html += kv('系统版本', r.system.osVersion);
    html += kv('处理器', r.system.cpuModel + ' · ' + r.system.cpuCount + ' 核');
    html += kv('内存', humanSize(r.system.memFreeBytes) + ' 可用 / ' + humanSize(r.system.memTotalBytes) + ' 总');
    html += kv('当前用户', r.system.user);
    html += kv('管理员权限', r.elevation.elevated ? '是' : '否');
    if (r.disk) html += kv('磁盘可用', humanSize(r.disk.freeBytes) + ' / ' + humanSize(r.disk.totalBytes) + '（' + r.disk.path + '）');
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">运行时</h2>';
    for (var i = 0; i < r.runtime.length; i++) {
      var t = r.runtime[i];
      html += kv(t.label, t.found ? (t.version || '已安装') : (t.required ? '缺失（必需）' : '缺失（可选）'), true);
    }
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">目录</h2>';
    html += kv('DSH 源码', r.dsh.sourceRoot || '未找到', true);
    html += kv('发现方式', r.dsh.discoveredBy || '-');
    html += kv('profile 目录', r.dsh.profileDir, true);
    html += kv('隔离区', r.dsh.quarantineDir || '-', true);
    html += kv('隔离区同盘', r.dsh.quarantineSameVolume ? '是' : '否（异常）');
    html += kv('管家数据目录', r.paths.butlerRoot, true);
    html += kv('旧版配置', r.paths.legacyConfigExists ? '存在（可迁移）' : '不存在', true);
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">写权限</h2>';
    for (var j = 0; j < r.writable.length; j++) {
      html += kv(r.writable[j].label, r.writable[j].writable ? '可写' : ('不可写：' + (r.writable[j].error || '')));
    }
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">端口</h2>';
    for (var k = 0; k < r.ports.length; k++) {
      var pt = r.ports[k];
      html += kv(String(pt.port), pt.free ? '空闲' : (pt.isDsh ? 'DSH 服务占用' : ('被占用：' + pt.owners.join('、'))));
    }
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">问题清单</h2>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  function renderCore(r) {
    var html = '<div class="page-head"><h1 class="page-title">DSH 本体</h1><p class="page-desc">版本、源码提交与构建记录的一致性。</p></div>';
    if (!r.sourceRoot) {
      return html + '<div class="card"><div class="empty">未找到 DSH 本体</div></div>' + '<div class="card">' + renderFindings(r.findings) + '</div>';
    }
    html += '<div class="card"><h2 class="card-title">版本与源码</h2>';
    html += kv('位置', r.sourceRoot, true);
    html += kv('版本', r.version || '未知');
    if (r.git) {
      html += kv('分支', r.git.branch || '-');
      html += kv('提交', (r.git.headShort || '-') + ' （' + (r.git.head || '').slice(0, 12) + '…）', true);
      html += kv('已跟踪文件改动', String(r.git.dirtyTracked));
    }
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">构建记录对比</h2>';
    if (r.build) {
      html += kv('记录中的提交', r.build.commit || '-', true);
      html += kv('记录中的版本', r.build.version || '-');
      html += kv('构建时是否脏工作区', r.build.dirty ? '是' : '否');
      html += kv('产物文件数', r.build.fileCount === null ? '-' : String(r.build.fileCount));
      html += kv('产物摘要', (r.build.artifactsSha256 || '-').slice(0, 32) + '…', true);
    } else {
      html += '<div class="empty">没有构建记录文件</div>';
    }
    html += '<div class="finding ' + (r.needsFinishUpdate ? 'warn' : 'info') + '" style="margin-top:10px">';
    html += '<div class="finding-title">结论：' + (r.needsFinishUpdate ? '需要「完成更新」' : '源码与产物一致') + '</div>';
    if (r.finishReason) html += '<div class="finding-row">' + esc(r.finishReason) + '</div>';
    html += '</div></div>';

    if (r.plugins) {
      html += '<div class="card"><h2 class="card-title">插件双名单<span class="sub">生效 = 依赖 ∩ 名单</span></h2>';
      html += kv('依赖清单', String(r.plugins.dependencies.length));
      html += kv('bundles 名单', String(r.plugins.bundles.length));
      html += kv('实际生效', String(r.plugins.active.length));
      html += kv('装了没生效', r.plugins.declaredButInactive.length ? r.plugins.declaredButInactive.join(', ') : '无');
      html += kv('本体自带基座包', r.plugins.inBox.length ? r.plugins.inBox.join(', ') : '无');
      html += kv('名单里但装不上', r.plugins.bundledButUndeclared.length ? r.plugins.bundledButUndeclared.join(', ') : '无');
      html += '</div>';
    }

    if (r.suspectedOrphans && r.suspectedOrphans.length) {
      html += '<div class="card"><h2 class="card-title">安装残留<span class="sub">' + r.suspectedOrphans.length + ' 处</span></h2>';
      html += '<div class="finding-evidence">' + esc(r.suspectedOrphans.map(function (x) { return x.name + '（' + x.kind + '）'; }).join('\\n')) + '</div></div>';
    }

    html += '<div class="card"><h2 class="card-title">问题清单</h2>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  function renderRuntime(r) {
    var html = '<div class="page-head"><h1 class="page-title">运行状态</h1><p class="page-desc">服务进程、健康检查、僵尸锁与残留物。</p></div>';
    html += '<div class="card"><h2 class="card-title">服务</h2>';
    html += kv('状态', r.running ? '运行中' : '未运行');
    html += kv('进程 PID', r.pid === null ? '-' : String(r.pid));
    html += kv('端口', r.port === null ? '-' : String(r.port));
    html += kv('启动形态', r.launchForm === 'compiled' ? '编译版（lib/bin.js）' : r.launchForm === 'dev' ? '开发态（tsx 直跑）' : '-');
    if (r.health) {
      html += kv('HTTP 健康检查', r.health.reachable ? ('可访问 HTTP ' + r.health.status + ' · ' + r.health.latencyMs + ' ms') : ('不可访问：' + (r.health.error || '')));
    }
    if (r.cmdline) html += kv('命令行', r.cmdline, true);
    html += '</div>';

    if (r.duplicates && r.duplicates.length) {
      html += '<div class="card"><h2 class="card-title">其它同类进程</h2>';
      for (var i = 0; i < r.duplicates.length; i++) {
        html += kv('PID ' + r.duplicates[i].pid, '端口 ' + (r.duplicates[i].port || '?'), true);
      }
      html += '</div>';
    }

    html += '<div class="card"><h2 class="card-title">写锁<span class="sub">共 ' + r.locks.length + ' 个</span></h2>';
    if (!r.locks.length) {
      html += '<div class="empty">没有发现锁文件</div>';
    } else {
      for (var j = 0; j < r.locks.length; j++) {
        var l = r.locks[j];
        var verdict = l.verdict === 'stale' ? '僵尸（持有者已消失）' : l.verdict === 'keep' ? '正常' : '无法判定';
        html += kv(l.file.split(/[\\\\/]/).pop(), verdict + ' · ' + l.note, true);
      }
    }
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">profile 残留物</h2>';
    if (!r.residue || !r.residue.length) {
      html += '<div class="empty">没有发现残留备份</div>';
    } else {
      for (var k = 0; k < r.residue.length; k++) {
        html += kv(r.residue[k].kind, r.residue[k].count + ' 项 · ' + humanSize(r.residue[k].sizeBytes));
      }
    }
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">问题清单</h2>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  function renderLogs(r) {
    var html = '<div class="page-head"><h1 class="page-title">日志</h1><p class="page-desc">自动从最近的启动日志中挑出真正的错误行。</p></div>';
    html += '<div class="card"><h2 class="card-title">日志文件<span class="sub">共 ' + r.sources.length + ' 份 · ' + humanSize(r.totalBytes) + '</span></h2>';
    if (!r.sources.length) {
      html += '<div class="empty">没有找到日志文件</div>';
    } else {
      for (var i = 0; i < Math.min(r.sources.length, 20); i++) {
        var s = r.sources[i];
        html += kv(s.label, humanSize(s.sizeBytes) + ' · ' + (s.mtime ? new Date(s.mtime).toLocaleString('zh-CN') : ''), true);
      }
    }
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">错误摘录</h2>';
    if (!r.recentErrors || !r.recentErrors.length) {
      html += '<div class="empty">未发现明显错误</div>';
    } else {
      for (var j = 0; j < r.recentErrors.length; j++) {
        html += '<div style="margin-bottom:12px"><div class="card-title" style="margin-bottom:6px">' + esc(r.recentErrors[j].source) + '</div>';
        var lines = r.recentErrors[j].lines;
        var body = '';
        for (var k = 0; k < lines.length; k++) {
          body += '<span class="ln">' + (k + 1) + '</span>' + esc(lines[k]) + '\\n';
        }
        html += '<div class="logbox">' + body + '</div></div>';
      }
    }
    html += '</div>';
    html += '<div class="card"><h2 class="card-title">问题清单</h2>' + renderFindings(r.findings) + '</div>';
    return html;
  }

  function renderReport(r) {
    if (typeof r === 'string') {
      return '<div class="page-head"><h1 class="page-title">体检报告</h1><p class="page-desc">可直接复制分享（已自动脱敏用户名与路径）。</p></div>'
        + '<div class="card"><div class="btn-row" style="margin-bottom:10px"><button class="btn primary" id="btn-copy-report">复制报告</button></div>'
        + '<div class="logbox" id="report-text" style="background:#fff;color:var(--text);max-height:none">' + esc(r) + '</div></div>';
    }
    var v = r.verdict === 'error' ? '错误' : r.verdict === 'warn' ? '警告' : '正常';
    var html = '<div class="page-head"><h1 class="page-title">体检报告</h1><p class="page-desc">生成于 ' + new Date(r.generatedAt).toLocaleString('zh-CN') + ' · 耗时 ' + r.durationMs + ' ms</p></div>';
    html += '<div class="card"><h2 class="card-title">结论：' + v + '</h2>';
    html += kv('错误', String(r.summary.errors));
    html += kv('警告', String(r.summary.warns));
    html += kv('提示', String(r.summary.infos));
    html += '<div class="btn-row" style="margin-top:12px"><button class="btn" id="btn-copy-report">复制 Markdown 报告</button></div></div>';

    for (var i = 0; i < r.sections.length; i++) {
      var s = r.sections[i];
      html += '<div class="card"><h2 class="card-title">' + esc(s.label) + '</h2>' + renderFindings(s.findings) + '</div>';
    }
    return html;
  }

  var PAGES = {
    overview: { title: '总览', render: null },
    env: { title: '环境体检', action: 'env.probe', render: renderEnv },
    core: { title: '本体状态', action: 'core.status', render: renderCore },
    runtime: { title: '服务状态', action: 'runtime.status', render: renderRuntime },
    logs: { title: '日志收集', action: 'runtime.logs', render: renderLogs },
    report: { title: '全面体检', action: 'diag.healthCheck', render: renderReport }
  };

  function loading() {
    $('main').innerHTML = '<div class="empty"><span class="spinner"></span> 正在检测…</div>';
  }

  function go(page, force) {
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

    var def = PAGES[page];
    if (!def || !def.render) return;

    if (!force && state.cache[page]) {
      $('main').innerHTML = def.render(state.cache[page]);
      return;
    }

    loading();
    runAction(def.action, {}, def.title)
      .then(function (result) {
        state.cache[page] = result;
        $('main').innerHTML = def.render(result);
      })
      .catch(function (e) { showError(e); });
  }

  function showError(e) {
    $('main').innerHTML = '<div class="page-head"><h1 class="page-title">出错了</h1></div>'
      + '<div class="card"><div class="finding error"><div class="finding-title">检测失败</div>'
      + '<div class="finding-row">' + esc(e && e.message ? e.message : String(e)) + '</div></div></div>';
    toast('检测失败：' + (e && e.message ? e.message : e), 'err');
  }

  // ── 事件绑定 ───────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.classList.contains('nav-item')) {
      go(t.getAttribute('data-page'), false);
      return;
    }
    if (t.id === 'btn-refresh') {
      state.cache = {};
      go(state.page, true);
      return;
    }
    if (t.id === 'btn-cancel' && state.job) {
      api('/api/jobs/' + state.job + '/cancel', { method: 'POST' }).catch(function () {});
      return;
    }
    if (t.id === 'btn-copy-report') {
      var text = '';
      if (typeof state.cache.report === 'string') text = state.cache.report;
      else {
        var el = $('report-text');
        if (el) text = el.textContent;
      }
      if (!text) { toast('报告内容为空', 'warn'); return; }
      navigator.clipboard.writeText(text).then(function () { toast('报告已复制'); }, function () { toast('复制失败，请手动选择文本', 'err'); });
      return;
    }
    var act = t.getAttribute && t.getAttribute('data-act');
    if (act) {
      t.disabled = true;
      var def = { 'diag.healthCheck': '全面体检', 'env.probe': '环境体检', 'core.status': '本体状态', 'runtime.status': '服务状态' };
      runAction(act, {}, def[act] || act)
        .then(function (result) {
          t.disabled = false;
          if (act === 'diag.healthCheck') {
            state.cache.report = result;
            var host = $('overview-findings');
            if (host && result.findings) host.innerHTML = renderFindings(result.findings);
            toast('体检完成：' + result.summary.errors + ' 项错误 / ' + result.summary.warns + ' 项警告',
              result.summary.errors ? 'err' : result.summary.warns ? 'warn' : '');
          } else {
            toast('检测完成');
            if (act === 'env.probe') state.cache.env = result;
            if (act === 'core.status') state.cache.core = result;
            if (act === 'runtime.status') state.cache.runtime = result;
          }
        })
        .catch(function (err) { t.disabled = false; toast('执行失败：' + err.message, 'err'); });
    }
  });

  api('/api/state/overview').then(function (ov) {
    $('app-version').textContent = 'v' + (ov.app.version || '');
    go('overview', false);
  }).catch(function (e) {
    showError(e);
  });
})();`;
