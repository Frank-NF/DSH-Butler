<template>
  <div>
    <section class="docs-section">
      <div class="container docs-container">
        <aside class="docs-sidebar">
          <h3>用户手册</h3>
          <ul>
            <li><a href="#intro" class="active">产品简介</a></li>
            <li><a href="#features">核心功能</a></li>
            <li><a href="#ui">界面概览</a></li>
            <li><a href="#market">插件市场</a></li>
            <li><a href="#bundles">组合包</a></li>
            <li><a href="#installed">已安装插件管理</a></li>
            <li><a href="#mcp">MCP 服务管理</a></li>
            <li><a href="#snapshot">快照与离线打包</a></li>
            <li><a href="#server">DSH 服务器管理</a></li>
            <li><a href="#settings">设置与配置</a></li>
            <li><a href="#troubleshoot">故障排查</a></li>
            <li><a href="#faq">常见问题</a></li>
            <li><a href="#glossary">术语表</a></li>
            <li><a href="#shortcuts">快捷键</a></li>
          </ul>
        </aside>

        <div class="docs-content">
          <article id="intro">
            <h1>产品简介</h1>
            <p><strong>DSH插件管家</strong>（原名 DSH 插件升级管理）是一款独立运行的桌面应用，用于管理 DeepSeek Harness（DSH）生态下的插件。</p>

            <h2>关键特性</h2>
            <ul>
              <li><strong>独立运行</strong>：不依赖 DSH Agent 本体进程，纯桌面工具</li>
              <li><strong>智能扫描</strong>：自动识别插件目录下所有已安装插件</li>
              <li><strong>插件市场</strong>：内置官方插件目录（2189+ 款插件），支持分类筛选、关键词搜索、排序、一键安装</li>
              <li><strong>组合包</strong>：99 个行业预制组合包（医疗/法律/金融/教育/电商等），一键部署整套解决方案</li>
              <li><strong>一键更新</strong>：通过 npm registry 检测最新版本，快速下载更新；点「更新」先弹本次更新日志，没有日志会明确提示</li>
              <li><strong>本体自修复</strong>：「完成更新」会自动隔离源码树里的残留文件再全量重建，构建失败也能一键修好</li>
              <li><strong>启停管理</strong>：轻松启用/禁用插件，无需删除文件</li>
              <li><strong>安全卸载</strong>：卸载前自动备份，支持随时回滚</li>
              <li><strong>MCP 服务管理</strong>：集中查看与管控本地 MCP 配置，支持连通性预检</li>
              <li><strong>快照与离线打包</strong>：导出/导入插件清单，支持无网络环境还原</li>
              <li><strong>双语界面</strong>：中文/英文一键切换</li>
            </ul>

            <h2>技术架构</h2>
            <ul>
              <li><strong>前端</strong>：Vue 3 + TypeScript（WeUI 封装层）</li>
              <li><strong>后端</strong>：Rust（Tauri 2.0）</li>
              <li><strong>UI 库</strong>：WeUI 2.6 + 自定义 W* 组件</li>
              <li><strong>动效引擎</strong>：GSAP 3.15</li>
              <li><strong>主题</strong>：深色/浅色双主题</li>
            </ul>

            <h2>系统要求</h2>
            <ul>
              <li><strong>操作系统</strong>：Windows 10/11 或 Linux</li>
              <li><strong>内存</strong>：≥ 4GB RAM</li>
              <li><strong>磁盘</strong>：≥ 500MB 可用空间</li>
              <li><strong>网络</strong>：需要访问 GitHub 和 npm registry（可通过代理配置解决）</li>
            </ul>
          </article>

          <article id="features">
            <h1>核心功能</h1>

            <h2>插件扫描</h2>
            <p>启动时自动扫描已配置的插件目录。扫描结果包括：</p>
            <ul>
              <li>插件名称、版本、描述</li>
              <li>是否启用</li>
              <li>是否有可用更新</li>
              <li>插件类型（用户插件/内置插件/系统组件）</li>
            </ul>

            <h2>插件安装</h2>
            <p>支持两种方式安装插件：</p>
            <ol>
              <li><strong>从市场安装</strong>：在「插件市场」标签页中点击「安装」按钮</li>
              <li><strong>从目录安装</strong>：通过安装对话框选择目标 profile 目录</li>
            </ol>

            <h2>插件更新</h2>
            <ul>
              <li>自动检测更新：启动时或手动点击「检查更新」</li>
              <li>批量更新：一键更新所有可更新插件</li>
              <li>单插件更新：针对特定插件执行更新</li>
              <li>更新前自动备份：确保可回滚</li>
              <li>
                <strong>先看更新日志再决定</strong>：点「更新」会先弹出本次更新说明——
                优先展示该插件 Release Notes；若 Release 没有正文，会自动去仓库取
                <code>CHANGELOG.md</code> 并截取最新版本段落；两者都没有时，弹窗会明确提示
                <strong>「未发现更新日志」</strong>，不会让你在不知道改了什么的情况下点升级
              </li>
            </ul>

            <h2>插件卸载</h2>
            <ul>
              <li>卸载前自动备份</li>
              <li>稳健删除：处理只读文件、长路径、占用文件</li>
              <li>备份管理：可查看和恢复历史备份</li>
            </ul>
          </article>

          <article id="ui">
            <h1>界面概览</h1>

            <h2>主界面布局</h2>
            <p>主界面由顶部工具栏、标签页切换区与插件列表区组成。顶部工具栏承载全局操作，标签页在「插件市场 / 组合包 / 已安装」三个视图间切换。</p>

            <h2>顶部工具栏</h2>
            <table class="field-table">
              <thead>
                <tr><th>图标</th><th>功能</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>Logo</td><td>返回主页</td><td>点击刷新插件列表</td></tr>
                <tr><td>齿轮</td><td>打开设置</td><td>进入设置对话框</td></tr>
                <tr><td>zap</td><td>MCP 管理</td><td>打开 MCP 服务管理面板</td></tr>
                <tr><td>电脑</td><td>DSH 服务器</td><td>管理 DSH Web 服务状态</td></tr>
              </tbody>
            </table>

            <h2>标签页说明</h2>
            <table class="field-table">
              <thead>
                <tr><th>标签</th><th>内容</th><th>数量来源</th></tr>
              </thead>
              <tbody>
                <tr><td>插件市场</td><td>官方插件目录</td><td>官网接口实时拉取</td></tr>
                <tr><td>组合包</td><td>行业预制方案包</td><td>官网接口 + 本地缓存</td></tr>
                <tr><td>已安装</td><td>本地已安装插件</td><td>扫描本地目录</td></tr>
              </tbody>
            </table>
          </article>

          <article id="market">
            <h1>插件市场</h1>

            <h2>功能特性</h2>
            <ul>
              <li><strong>全量数据</strong>：循环分页拉取完整官方目录（2189+ 款插件）</li>
              <li><strong>分类筛选</strong>：按行业/类型筛选（医疗、法律、金融、教育等）</li>
              <li><strong>关键词搜索</strong>：支持插件名、描述、分类关键词搜索</li>
              <li><strong>排序方式</strong>：默认排序 / Star 数 / 下载量 / 最新</li>
              <li><strong>视图切换</strong>：网格视图 / 列表视图（记忆用户偏好）</li>
            </ul>

            <h2>卡片信息</h2>
            <p>每张插件卡片显示：</p>
            <ul>
              <li>插件名称（带来源标识）</li>
              <li>插件描述（最多两行）</li>
              <li>分类标签（彩色徽章）</li>
              <li>Star 数量</li>
              <li>下载量</li>
              <li>状态标签：「已安装」/「可更新」</li>
            </ul>

            <h2>操作按钮</h2>
            <table class="field-table">
              <thead>
                <tr><th>按钮</th><th>功能</th></tr>
              </thead>
              <tbody>
                <tr><td>安装</td><td>从市场安装到指定目录</td></tr>
                <tr><td>链接</td><td>查看 GitHub 仓库 / npm 页面 / 镜像页面</td></tr>
                <tr><td>更新</td><td>更新已有插件</td></tr>
                <tr><td>禁用</td><td>临时禁用插件</td></tr>
                <tr><td>卸载</td><td>删除插件（带备份）</td></tr>
                <tr><td>打开文件夹</td><td>定位插件所在目录</td></tr>
              </tbody>
            </table>

            <h2>市场分类</h2>
            <p>官方目录包含以下主要分类：</p>
            <ul>
              <li>通用工具（基础能力）</li>
              <li>医疗行业 / 法律行业 / 金融行业 / 教育行业</li>
              <li>电商行业 / 制造业 / 房地产 / 媒体·内容</li>
              <li>政务 / IT 服务 / 农业 / 物流 / 旅游</li>
              <li>殡葬与生命服务</li>
            </ul>
          </article>

          <article id="bundles">
            <h1>组合包</h1>
            <p>组合包是一套预配置的插件集合，包含一组相关插件、MCP 服务模板（含环境变量键名说明）与技能（Skill）定义。官网可在 <a href="/bundles">组合包页</a> 浏览，安装动作在客户端内完成。</p>

            <h2>组合包类型</h2>
            <table class="field-table">
              <thead>
                <tr><th>类型</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>通用基础</td><td>基础能力组合，适合所有用户</td></tr>
                <tr><td>行业预制</td><td>针对特定行业的完整解决方案</td></tr>
                <tr><td>预设模式</td><td>不写入全局配置，生成会话预设建议文件</td></tr>
              </tbody>
            </table>

            <h2>组合包安装流程</h2>
            <ol>
              <li><strong>浏览</strong>：在「组合包」标签页点击卡片查看详情</li>
              <li><strong>预检</strong>：自动比对当前已安装插件，标注冲突项</li>
              <li><strong>确认</strong>：查看即将安装/覆盖/跳过的插件清单</li>
              <li><strong>安装</strong>：一键安装，事务保障（失败自动回滚）</li>
              <li><strong>完成</strong>：自动合并 MCP 服务模板到本地配置</li>
            </ol>

            <h2>安装事务保障</h2>
            <ul>
              <li><strong>自动备份</strong>：安装前备份将被覆盖的插件</li>
              <li><strong>失败回滚</strong>：任一步骤失败自动恢复到安装前状态</li>
              <li><strong>半装恢复</strong>：中断后重启自动检测并恢复</li>
              <li><strong>冲突预警</strong>：安装前标注已知冲突插件</li>
            </ul>
          </article>

          <article id="installed">
            <h1>已安装插件管理</h1>

            <h2>插件状态标识</h2>
            <table class="field-table">
              <thead>
                <tr><th>状态</th><th>标识</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>最新</td><td>绿色「✓ 最新」</td><td>已是最新版本</td></tr>
                <tr><td>可更新</td><td>橙色「↑ 可更新」</td><td>有新版本可用</td></tr>
                <tr><td>检查失败</td><td>红色「✗ 错误」</td><td>无法检测版本</td></tr>
                <tr><td>已禁用</td><td>灰色「— 已禁用」</td><td>当前未启用</td></tr>
                <tr><td>内置</td><td>白色「内置」</td><td>DSH 本体预装插件</td></tr>
                <tr><td>系统</td><td>白色「系统」</td><td>DSH 系统组件</td></tr>
              </tbody>
            </table>

            <h2>批量操作</h2>
            <ul>
              <li><strong>全选更新</strong>：一键更新所有可更新插件</li>
              <li><strong>全选禁用</strong>：批量禁用插件</li>
              <li><strong>过滤查看</strong>：只显示可更新插件</li>
            </ul>

            <h2>单个插件操作</h2>
            <table class="field-table">
              <thead>
                <tr><th>操作</th><th>图标</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>更新</td><td>向上箭头</td><td>检查并更新到最新版本</td></tr>
                <tr><td>启用/禁用</td><td>电源图标</td><td>切换插件状态</td></tr>
                <tr><td>打开文件夹</td><td>文件夹图标</td><td>在资源管理器中打开</td></tr>
                <tr><td>更多</td><td>三点菜单</td><td>查看发行说明 / 卸载</td></tr>
              </tbody>
            </table>
          </article>

          <article id="mcp">
            <h1>MCP 服务管理</h1>
            <p>MCP（Model Context Protocol）是 DSH 生态中的模型上下文协议，用于连接 AI 模型与外部工具和服务。MCP 面板用于集中管理本地 MCP 配置（<code>~/.dsh/dsh-mcp.json</code>）。</p>

            <h2>管理功能</h2>
            <ol>
              <li><strong>服务列表</strong>：查看所有已配置和已禁用的 MCP 服务</li>
              <li><strong>连通性预检</strong>：一键测试服务是否可达
                <ul>
                  <li>stdio 模式：启动探活</li>
                  <li>streamable-http 模式：发送探测请求</li>
                </ul>
              </li>
              <li><strong>环境变量配置</strong>：填写 Token/密钥等敏感信息
                <ul>
                  <li>加密存储在系统凭据库（Windows 凭据管理器）</li>
                  <li>面板中掩码显示</li>
                </ul>
              </li>
              <li><strong>启用/禁用</strong>：安全移除或恢复服务配置</li>
              <li><strong>写入配置</strong>：将修改应用到运行配置</li>
            </ol>

            <h2>使用步骤</h2>
            <ol>
              <li>打开设置 → 底部「MCP 服务管理」（仅桌面客户端可用）</li>
              <li>首次使用：到「组合包」标签页安装含 MCP 模板的组合包，自动生成配置文件</li>
              <li>为各服务填入所需环境变量并保存（密值加密入库，配置文件不留明文）</li>
              <li>点击「探活」确认服务可达（401/403 表示服务在、需配置鉴权）</li>
              <li>点击「写入配置」应用修改，重启 DSH 生效</li>
            </ol>
          </article>

          <article id="snapshot">
            <h1>快照与离线打包</h1>

            <h2>快照功能</h2>
            <p><strong>用途</strong>：导出/导入当前已安装插件的清单（名称、版本、npm 包名）。</p>
            <ul>
              <li><strong>导出</strong>：生成 JSON 文件，包含所有插件信息，可用于备份或迁移</li>
              <li><strong>导入</strong>：预览与当前目录的差异，标注缺失插件和版本不一致项，一键在线安装缺失插件</li>
            </ul>

            <h2>离线打包</h2>
            <p><strong>用途</strong>：在无网络环境下还原插件环境。</p>
            <ul>
              <li><strong>导出打包</strong>：将全部插件目录打包为 ZIP 文件，包含所有依赖</li>
              <li><strong>离线还原</strong>：导入 ZIP 文件，按快照记录版本精确还原，同名文件覆盖</li>
            </ul>

            <h2>使用场景</h2>
            <ul>
              <li>内网环境部署</li>
              <li>跨机器迁移插件配置</li>
              <li>系统重装后快速恢复</li>
              <li>版本备份与回退</li>
            </ul>
            <p>详见官网<a href="/offline">离线部署指引</a>。</p>
          </article>

          <article id="server">
            <h1>DSH 服务器管理</h1>

            <h2>功能说明</h2>
            <p>管理本地 DSH Web 服务的启动、停止、重启。入口：顶部工具栏「电脑」图标。</p>

            <h2>操作步骤</h2>
            <ol>
              <li>点击工具栏「电脑」图标</li>
              <li>查看服务状态（运行状态、监听地址与端口）</li>
              <li>点击「启动」/「停止」/「重启」按钮</li>
              <li>按需输入必要的环境变量（如 API Key）</li>
            </ol>
            <p>启动成功后可直接复制带 token 的访问地址在浏览器中打开；服务器崩溃后可从面板一键重启。</p>
            <div class="warning-box">
              <strong>注意：</strong>面板只做进程级启停，不修改 DSH 自身配置。安装目录与 Node 运行时可通过环境变量 <code>DSH_WEB_DIR</code>、<code>DSH_NODE_PATH</code> 显式指定。
            </div>
          </article>

          <article id="settings">
            <h1>设置与配置</h1>

            <h2>网络设置</h2>
            <table class="field-table">
              <thead>
                <tr><th>配置项</th><th>说明</th><th>默认值</th></tr>
              </thead>
              <tbody>
                <tr><td>代理地址</td><td>GitHub 请求代理</td><td>空（直连）</td></tr>
                <tr><td>安装源</td><td>npm registry 地址（只允许 https，明文 http 仅限本机 127.0.0.1 / localhost）</td><td>官方源</td></tr>
                <tr><td>默认插件目录</td><td>启动时自动扫描的目录</td><td>空</td></tr>
              </tbody>
            </table>

            <h2>更新设置</h2>
            <table class="field-table">
              <thead>
                <tr><th>配置项</th><th>说明</th><th>默认值</th></tr>
              </thead>
              <tbody>
                <tr><td>扫描后自动检查更新</td><td>扫描完成后自动检测版本</td><td>开启</td></tr>
                <tr><td>更新前自动备份</td><td>更新前先备份当前版本</td><td>开启</td></tr>
              </tbody>
            </table>

            <h2>服务器同步设置</h2>
            <p>
              用于将安装包、目录、更新元数据同步到远程服务器。
              <strong>全部字段默认为空</strong>——软件不预填任何服务器地址、账号或路径，
              需要用到时由你自己填写（填写后只保存在本机配置文件里，不会上传、不会打包进发行版）。
            </p>
            <table class="field-table">
              <thead>
                <tr><th>配置项</th><th>说明</th><th>默认值</th></tr>
              </thead>
              <tbody>
                <tr><td>服务器主机</td><td>SSH 主机地址</td><td>空</td></tr>
                <tr><td>服务器端口</td><td>SSH 端口</td><td>22</td></tr>
                <tr><td>服务器用户</td><td>SSH 用户名</td><td>空</td></tr>
                <tr><td>SSH 私钥</td><td>私钥文件路径</td><td>空</td></tr>
                <tr><td>远程目录</td><td>同步目标目录</td><td>空</td></tr>
                <tr><td>DSH 目录</td><td>DSH 安装目录</td><td>空</td></tr>
                <tr><td>更新命令</td><td>服务器端更新命令</td><td>空</td></tr>
              </tbody>
            </table>

            <h2>关于</h2>
            <ul>
              <li>当前版本号</li>
              <li>检查更新</li>
              <li>访问官网</li>
            </ul>
          </article>

          <article id="troubleshoot">
            <h1>故障排查</h1>
            <p>本章来自长期使用中实际踩到的 26 类 DSH 故障，按「症状 → 根因 → 处置」整理。软件内也有同一套指南：<strong>顶部工具栏「扳手」图标 → 环境修复 → 常见报错修复指南</strong>（支持关键词搜索，中英双语）。</p>

            <h2>一、快速对照表</h2>
            <table class="field-table">
              <thead>
                <tr><th>症状</th><th>根因</th><th>处置</th></tr>
              </thead>
              <tbody>
                <tr><td>启动报 <code>cannot resolve package "X"</code></td><td>自动更新把插件挪进 <code>.updater_backups/</code> 后未还原</td><td>把最新备份目录改回 <code>node_modules/X</code>；根治见下方第 1 条</td></tr>
                <tr><td>同一插件反复 <code>cannot resolve</code></td><td>profile 里的 <code>github:</code> 依赖构建被 pnpm 拦截，整 profile 安装中止</td><td>写 profile <code>.npmrc</code> 放行构建；或关闭自动更新 / 移除 <code>github:</code> 依赖</td></tr>
                <tr><td>安装/卸载报 <code>Permission denied (publickey)</code></td><td><code>github:</code> 被解析成 <code>git+ssh</code>，本机 SSH 密钥未登记 GitHub</td><td>全局 <code>git insteadOf</code> 把 ssh 改写成 https</td></tr>
                <tr><td>启动报 <code>duplicate loader entry id</code></td><td>包自带 patch 与 profile 级 patch 重复 insert 同一 entry</td><td>删 profile 级冗余 insert；并检查插件是否已被自动移除</td></tr>
                <tr><td>会话打不开：<code>preset "X" not found</code></td><td>自定义 preset 目录被清空</td><td>在 <code>~/.dsh/.agent-presets/X/</code> 建空 <code>agent.cordis.yml</code>（内容 <code>[]</code>）</td></tr>
                <tr><td>启动卡死：<code>ctx is not defined</code></td><td>插件构建产物缺 Cordis 必需的 <code>apply(ctx)</code>，还在顶层用 ctx</td><td>从 profile <code>dsh.profile.bundles</code> 摘掉该插件</td></tr>
                <tr><td>升级某插件后起不来：<code>without inject</code></td><td>插件新版回归：用了服务却没声明 inject</td><td>回退旧版 + 把依赖改为精确版本锁死</td></tr>
                <tr><td>插件装了却完全没反应</td><td>不在 <code>dsh.profile.bundles</code> 启用列表（装 ≠ 启用）</td><td>把插件名追加进 <code>bundles</code>；先冻结代次迁移再改</td></tr>
                <tr><td>插件莫名消失</td><td>DSH 恢复机制检测到启动崩溃后自动移除插件</td><td>查 <code>plugin-removals.json</code> 台账，走 restore/重装；先修根因</td></tr>
                <tr><td>插件已加载但功能无反应（零报错）</td><td>客户端半导出形态错误致 <code>inject</code> 被丢弃；或注册了不存在的槽位</td><td>改用对象形态 <code>{name, inject, apply}</code>；核对槽位名</td></tr>
                <tr><td>启动进恢复模式 <code>Renderer boot failed</code></td><td>插件渲染阶段崩溃（多为重型原生依赖）</td><td>把插件名加入 <code>state.json</code> 的 <code>disabled</code> 临时规避</td></tr>
                <tr><td>插件被自动升到有 bug 的版本</td><td>依赖写了 <code>^</code> 范围符</td><td>改为精确版本；治本仍是关闭自动更新</td></tr>
              </tbody>
            </table>

            <h2>二、三个最值得根治的问题</h2>

            <h3>1. 自动更新连坐（反复 cannot resolve 的真正元凶）</h3>
            <p><strong>机制</strong>：DSH 自动更新会先把要更新的插件目录重命名进 <code>.updater_backups/&lt;插件名&gt;_&lt;时间戳&gt;</code>，再跑<strong>整 profile 一次 pnpm</strong>。只要这次 pnpm 因任一依赖失败而整体中止（常见 <code>ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED</code>、<code>ERR_PNPM_PREPARE_PACKAGE</code>），更新器的「还原」步骤就不会执行——所有被挪走的兄弟插件永久留在备份里，正式目录消失。DSH 启动按加载清单逐项找目录，缺一项即报错；即使插件在 disabled 列表也躲不过。</p>
            <p><strong>两步处置</strong>：</p>
            <ol>
              <li><strong>兜底</strong>：在 profile 目录写 <code>.npmrc</code>，加入 <code>dangerously-allow-all-builds=true</code> 与 <code>enable-pre-post-scripts=true</code>，允许 git 托管依赖执行构建脚本</li>
              <li><strong>根治</strong>：在 DSH 设置里关闭「自动更新」（推荐）；或把非必需的 <code>github:</code> 依赖从 profile 的 <code>dependencies</code> 与 <code>dsh.profile.bundles</code> 中移除</li>
            </ol>
            <div class="warning-box"><strong>注意：</strong>手动把备份目录搬回去只是应急——更新器下次启动仍会再挪一次，必须配合上面的根治手段。</div>

            <h3>2. git 通道选错（安装/卸载时的公钥拒绝）</h3>
            <p><strong>机制</strong>：插件以 <code>github:owner/repo</code> 形式声明依赖时，pnpm 会把它解析成 <code>git+ssh://git@github.com/…</code>，安装/卸载时要 <code>git ls-remote</code> 校验远端。本机 SSH 私钥通常只对某台服务器有效、并未登记到 GitHub，于是公钥被拒、进程以 exit 128 失败。这是「传输通道选错」，不是插件损坏。</p>
            <p><strong>处置</strong>：把 ssh 协议全局改写为 https（匿名公开访问，无需公钥）：</p>
            <pre><code>git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/"</code></pre>
            <p>用 <code>git config --global --get-all "url.https://github.com/.insteadOf"</code> 确认两条都已写入，然后回软件重试。</p>

            <h3>3. 静默失败（插件「活着但不干活」）</h3>
            <p>最阴险的一类：插件列表正常、样式已注入、宿主 API 也通，就是功能没反应，控制台还干干净净。已知三种成因：</p>
            <ul>
              <li><strong>导出形态错误</strong>：静态包客户端半用「函数 + 挂静态属性」导出，被运行时当动态插件处理，<code>inject</code> 声明被整体丢弃 → <code>ctx.slots</code> 为 undefined → <code>apply</code> 里提前 return。改用官方对象形态 <code>{ name, inject, apply }</code></li>
              <li><strong>槽位不存在</strong>：注册的槽位名在该版本 DSH 的声明表里没有，注册即抛 <code>slot "X" is not declared</code>；注册前先确认槽位名</li>
              <li><strong>根作用域 hook 用在会话槽位</strong>：会话作用域槽位只提供 <code>useSession / useInput / useProjection / sessionId / inputActions</code> 等，调用根作用域专属 hook（如 <code>useSessions</code>）会首渲染抛错、被错误边界静默卸载，连监听都不会挂上</li>
            </ul>
            <p>排查提示：先给 <code>window.onerror</code> 与 <code>console.error</code> 挂钩再重放操作，否则报错会被错误边界吞掉；不要相信「没报错就是没病」。</p>
          </article>

          <article id="faq">
            <h1>常见问题</h1>

            <h3>Q1: 插件扫描后列表为空？</h3>
            <p><strong>原因</strong>：未配置插件目录或目录路径不正确。</p>
            <p><strong>解决</strong>：</p>
            <ol>
              <li>打开「设置」→ 配置「默认插件目录」</li>
              <li>点击「扫描」重新加载</li>
            </ol>

            <h3>Q2: 检查更新失败？</h3>
            <p><strong>原因</strong>：网络问题或 npm registry 不可达。</p>
            <p><strong>解决</strong>：</p>
            <ol>
              <li>检查网络连接</li>
              <li>配置代理地址</li>
              <li>或切换到国内镜像源</li>
            </ol>

            <h3>Q3: 更新时提示「文件被占用」？</h3>
            <p><strong>原因</strong>：DSH Agent 本体正在运行，锁定了插件文件。</p>
            <p><strong>解决</strong>：关闭 DSH Agent 本体后重新执行更新操作。</p>

            <h3>Q4: 如何恢复误删的插件？</h3>
            <p><strong>方法</strong>：</p>
            <ol>
              <li>打开「设置」→「快照与离线包」</li>
              <li>查看历史备份</li>
              <li>选择备份进行恢复</li>
            </ol>

            <h3>Q5: 组合包安装失败？</h3>
            <p><strong>可能原因</strong>：网络问题导致下载中断；插件冲突未解决；环境变量未配置。</p>
            <p><strong>解决</strong>：</p>
            <ol>
              <li>查看错误提示</li>
              <li>检查冲突项</li>
              <li>重试安装（支持断点续传）</li>
            </ol>

            <h3>Q6: MCP 服务连通性测试失败？</h3>
            <p><strong>排查步骤</strong>：</p>
            <ol>
              <li>检查 URL 路径是否正确（参考服务提供方文档）</li>
              <li>检查鉴权配置（401/403 需配置 Token）</li>
              <li>检查服务是否正常运行</li>
            </ol>
          </article>

          <article id="glossary">
            <h1>术语表</h1>
            <table class="field-table">
              <thead>
                <tr><th>术语</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>DSH</td><td>DeepSeek Harness，AI 助手框架</td></tr>
                <tr><td>Agent</td><td>DSH 的本体进程，提供 AI 对话能力</td></tr>
                <tr><td>插件</td><td>扩展 DSH 功能的模块，以 npm 包形式分发</td></tr>
                <tr><td>MCP</td><td>Model Context Protocol，模型上下文协议</td></tr>
                <tr><td>Skill</td><td>技能定义，Agent 可调用的能力单元</td></tr>
                <tr><td>组合包</td><td>预配置的插件集合，含 MCP 和 Skill</td></tr>
                <tr><td>Profile</td><td>DSH 配置文件目录，包含插件和配置</td></tr>
                <tr><td>Bundle</td><td>随 DSH 本体分发的预装插件</td></tr>
                <tr><td>快照</td><td>插件清单的 JSON 导出文件</td></tr>
              </tbody>
            </table>
          </article>

          <article id="shortcuts">
            <h1>附录：快捷键</h1>
            <table class="field-table">
              <thead>
                <tr><th>快捷键</th><th>功能</th></tr>
              </thead>
              <tbody>
                <tr><td>F5</td><td>刷新插件列表</td></tr>
                <tr><td>Ctrl+/</td><td>切换到搜索框</td></tr>
                <tr><td>1-3</td><td>切换标签页（市场/组合包/已安装）</td></tr>
              </tbody>
            </table>
            <p style="margin-top:24px; opacity:.65; font-size:13px;">本文档随客户端持续更新 · 以实际界面为准</p>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
useSiteSeo({
  title: '用户手册',
  description: 'DSH插件管家用户手册：插件市场、组合包、已安装管理、MCP 服务、快照与离线打包、DSH 服务器管理全功能图文说明，含常见问题与快捷键。',
  path: '/docs',
})
</script>

<style scoped>
.docs-section {
  padding: 40px 0;
  min-height: calc(100vh - 64px);
}

.docs-container {
  display: flex;
  gap: 40px;
  align-items: flex-start;
}

.docs-sidebar {
  width: 240px;
  flex-shrink: 0;
  position: sticky;
  top: 100px;
}

.docs-sidebar h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--primary);
}

.docs-sidebar ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.docs-sidebar a {
  display: block;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--text-secondary);
  transition: all 0.18s ease;
}

.docs-sidebar a:hover,
.docs-sidebar a.active {
  color: var(--primary-light);
  background: rgba(244, 97, 35, 0.1);
}

.docs-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 56px;
}

.docs-content article {
  scroll-margin-top: 90px;
}

.docs-content h1 {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.docs-content h2 {
  font-size: 19px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 28px 0 12px;
}

.docs-content h3 {
  font-size: 15.5px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 20px 0 8px;
}

.docs-content p {
  font-size: 14.5px;
  color: var(--text-secondary);
  line-height: 1.85;
  margin-bottom: 12px;
}

.docs-content ul,
.docs-content ol {
  padding-left: 24px;
  color: var(--text-secondary);
  line-height: 1.9;
  font-size: 14.5px;
  margin-bottom: 14px;
}

.docs-content ul ul {
  margin: 4px 0 4px;
}

.docs-content a {
  color: var(--primary-light);
}

.docs-content code {
  font-size: 13px;
  color: var(--primary-light);
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 7px;
  border-radius: 5px;
}

.docs-content pre {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 18px;
  overflow-x: auto;
  margin: 10px 0 16px;
}

.docs-content pre code {
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.7;
}

.field-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  margin: 12px 0 18px;
}

.field-table th,
.field-table td {
  padding: 9px 12px;
  border: 1px solid var(--border);
  text-align: left;
  color: var(--text-secondary);
  vertical-align: top;
}

.field-table th {
  color: var(--text-primary);
  background: rgba(244, 97, 35, 0.08);
  font-weight: 600;
}

.warning-box {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin: 12px 0 16px;
}

@media (max-width: 900px) {
  .docs-container {
    flex-direction: column;
  }
  .docs-sidebar {
    width: 100%;
    position: static;
  }
  .docs-sidebar ul {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
  }
}
</style>
