/**
 * Bundle 协议 V2：官方组合包种子数据 + 行聚合（V2 §2）
 * 种子幂等（INSERT OR IGNORE），由 API 模块懒加载调用。
 * 枚举白名单：mode=preset、scope=user、transport=stdio；env_keys 仅键名永不存值。
 */
import Database from 'better-sqlite3'

interface SeedMcpServer {
  serverId: string
  name: string
  transport: string
  command: string
  args: string[]
  envKeys: string[]
  optional: boolean
  description: string
}

interface SeedSkill {
  skillId: string
  name: string
  source: string
  scope: string
  optional: boolean
}

interface SeedBundle {
  id: string
  name: string
  description: string
  tags: string[]
  mode: string
  minDshVersion: string
  maxDshVersion: string
  recommendPreset: string
  version: string
  createTime: string
  plugins: string[]
  mcpServers: SeedMcpServer[]
  skills: SeedSkill[]
}

const OFFICIAL_BUNDLES: SeedBundle[] = [
  {
    id: 'bundle-starter',
    name: '小白入门包',
    description: '新手友好的一键入门组合：Markdown 速投、视觉路由、用量统计与历史树，开箱即用。',
    tags: ['入门', '基础'],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-08-31',
    plugins: ['dsh-drop-md', 'dsh-vision-router', 'dsh-cost-meter', 'dsh-history-tree'],
    mcpServers: [],
    skills: []
  },
  {
    id: 'bundle-dev-full',
    name: 'AI 开发者包',
    description: '面向 AI 开发者的完整工具链：MCP 服务管理、逻辑探针、LSP 动作、多模态识图与浏览器驾驶舱。',
    tags: ['开发', '工具'],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-08-31',
    plugins: [
      'dsh-mcp-manager',
      'dsh-logicprobe',
      'dsh-lsp-actions',
      '@liustack/modlens',
      'dsh-pilot',
      'dsh-cost-meter'
    ],
    mcpServers: [
      {
        serverId: 'mcp-github',
        name: 'GitHub MCP',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        envKeys: ['GITHUB_TOKEN'],
        optional: false,
        description: 'GitHub 官方 MCP 服务：仓库 / Issue / PR 操作'
      }
    ],
    skills: [
      {
        skillId: 'skill-logicprobe',
        name: '逻辑探针技能',
        source: 'dsh-logicprobe',
        scope: 'user',
        optional: false
      }
    ]
  },
  {
    id: 'bundle-content',
    name: '内容创作包',
    description: '内容创作场景组合：视觉路由、在线表格文档、Markdown 投放与生成式 UI。',
    tags: ['创作', '效率'],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-08-31',
    plugins: [
      'dsh-vision-router',
      'dsh-univer-office',
      'dsh-drop-md',
      '@changfenhuang/dsh-genui'
    ],
    mcpServers: [],
    skills: []
  },
  {
    id: 'bundle-research',
    name: '学术 RAG 包',
    description: '学术研究场景组合：文档表格处理、上下文管理与记忆留存，构建轻量 RAG 工作流。',
    tags: ['学术', '资料'],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-08-31',
    plugins: ['dsh-univer-office', 'dsh-context', 'dsh-memoir'],
    mcpServers: [],
    skills: []
  },
  {
    id: 'bundle-enterprise',
    name: '企业安全包',
    description: '企业安全基线组合：内置开关管控、用量成本计量与上下文治理，适合团队统一配置。',
    tags: ['企业', '安全'],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-08-31',
    plugins: ['dsh-builtin-toggles', 'dsh-cost-meter', 'dsh-context'],
    mcpServers: [],
    skills: [],
  },
  {
    id: 'bundle-g-01',
    name: "文件与办公基础包",
    description: "所有行业的日常办公、文档处理、数据表格操作",
    tags: ["通用"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-filesystem", "dsh-plugin-office", "dsh-plugin-clipboard"],
    mcpServers: [
      { serverId: "filesystem", name: "filesystem", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "官方文件系统 MCP，安全的文件读写访问" },
      { serverId: "excel-mcp", name: "excel-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Excel 工作簿读写、公式计算、图表生成、数据透视" },
      { serverId: "pptx-mcp", name: "pptx-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "PowerPoint 演示文稿创建与编辑" },
      { serverId: "pdf-mcp", name: "pdf-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "PDF 读取、提取、合并、拆分、表单填写" },
    ],
    skills: [
      { skillId: 'skill-g-01-document-processing', name: "document-processing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-01-data-analysis-basic', name: "data-analysis-basic", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-01-report-generation', name: "report-generation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-g-02',
    name: "网络与信息检索包",
    description: "所有行业的信息搜集、网页浏览、数据采集",
    tags: ["通用"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-browser", "dsh-plugin-web-search", "dsh-plugin-rss"],
    mcpServers: [
      { serverId: "firecrawl-mcp", name: "firecrawl-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "网页爬取、站点地图、结构化数据提取" },
      { serverId: "fetch-mcp", name: "fetch-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "网页内容获取，转 Markdown 格式" },
      { serverId: "brave-search-mcp", name: "brave-search-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Brave 搜索引擎 API 集成" },
    ],
    skills: [
      { skillId: 'skill-g-02-web-research', name: "web-research", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-02-data-scraping', name: "data-scraping", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-02-competitor-monitor', name: "competitor-monitor", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-g-03',
    name: "通信与协作包",
    description: "所有行业的团队协作、消息通知、会议管理",
    tags: ["通用"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-email", "dsh-plugin-calendar", "dsh-plugin-notification"],
    mcpServers: [
      { serverId: "gmail-mcp", name: "gmail-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Gmail 邮件操作（读取/发送/搜索/标签）" },
      { serverId: "slack-mcp", name: "slack-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Slack 消息发送、频道管理、文件分享" },
      { serverId: "notion-mcp", name: "notion-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Notion 页面/数据库读写、内容管理" },
      { serverId: "google-calendar-mcp", name: "google-calendar-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Google 日历事件管理" },
    ],
    skills: [
      { skillId: 'skill-g-03-meeting-notes', name: "meeting-notes", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-03-email-drafting', name: "email-drafting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-03-task-management', name: "task-management", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-g-04',
    name: "数据与数据库包",
    description: "所有行业的数据存储、查询、分析、可视化",
    tags: ["通用"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-database", "dsh-plugin-chart"],
    mcpServers: [
      { serverId: "postgres-mcp", name: "postgres-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "PostgreSQL 数据库连接、Schema 检查、安全查询" },
      { serverId: "sqlite-mcp", name: "sqlite-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "SQLite 数据库操作，内置分析功能" },
      { serverId: "duckdb-mcp", name: "duckdb-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "DuckDB 列式数据库，高性能分析查询" },
      { serverId: "mysql-mcp", name: "mysql-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "MySQL 数据库连接与操作" },
      { serverId: "bigquery-mcp", name: "bigquery-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Google BigQuery 数据仓库查询" },
    ],
    skills: [
      { skillId: 'skill-g-04-sql-generation', name: "sql-generation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-04-data-modeling', name: "data-modeling", source: '', scope: 'user', optional: true },
      { skillId: 'skill-g-04-etl-pipeline', name: "etl-pipeline", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-med-01',
    name: "临床文档与病历管理包",
    description: "医院、诊所、口腔门诊的病历书写、临床文档管理",
    tags: ["医疗健康"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-medical-record", "dsh-plugin-medical-terminology", "dsh-plugin-voice-input"],
    mcpServers: [
      { serverId: "fhir-mcp", name: "fhir-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "FHIR 医疗数据标准接口，患者数据查询" },
      { serverId: "medical-literature-mcp", name: "medical-literature-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "PubMed/医学文献检索，论文摘要获取" },
      { serverId: "ehr-mcp", name: "ehr-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "电子健康记录系统集成，患者信息读取" },
    ],
    skills: [
      { skillId: 'skill-med-01-clinical-note-generation', name: "clinical-note-generation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-med-01-medical-coding', name: "medical-coding", source: '', scope: 'user', optional: true },
      { skillId: 'skill-med-01-dental-chart', name: "dental-chart", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-med-02',
    name: "健康管理与慢病跟踪包",
    description: "健康管理公司、体检中心、慢病管理机构",
    tags: ["医疗健康"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-health-data", "dsh-plugin-wearable", "dsh-plugin-diet-nutrition"],
    mcpServers: [
      { serverId: "health-kit-mcp", name: "health-kit-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "健康数据平台接口，体检数据导入" },
      { serverId: "drug-database-mcp", name: "drug-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "药品数据库查询，说明书获取，相互作用检查" },
      { serverId: "lab-result-mcp", name: "lab-result-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "检验报告解析，指标异常标记，参考范围对比" },
    ],
    skills: [
      { skillId: 'skill-med-02-health-assessment', name: "health-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-med-02-chronic-disease-management', name: "chronic-disease-management", source: '', scope: 'user', optional: true },
      { skillId: 'skill-med-02-diet-plan-generation', name: "diet-plan-generation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-med-03',
    name: "医疗营销与患者运营包",
    description: "民营医院、口腔门诊、医美机构的患者获客与运营",
    tags: ["医疗健康"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-patient-crm", "dsh-plugin-medical-marketing", "dsh-plugin-appointment"],
    mcpServers: [
      { serverId: "wechat-mcp", name: "wechat-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "微信公众号/企业微信消息推送，客户管理" },
      { serverId: "douyin-mcp", name: "douyin-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "抖音短视频发布，评论管理，数据统计" },
      { serverId: "xiaohongshu-mcp", name: "xiaohongshu-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "小红书笔记发布，互动管理" },
    ],
    skills: [
      { skillId: 'skill-med-03-patient-follow-up', name: "patient-follow-up", source: '', scope: 'user', optional: true },
      { skillId: 'skill-med-03-medical-content-marketing', name: "medical-content-marketing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-med-03-conversion-optimization', name: "conversion-optimization", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-law-01',
    name: "合同审查与起草包",
    description: "律师事务所、企业法务部门的合同管理",
    tags: ["法律合规"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-contract-review", "dsh-plugin-contract-template", "dsh-plugin-legal-research"],
    mcpServers: [
      { serverId: "westlaw-mcp", name: "westlaw-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Westlaw 法律数据库检索（英美法）" },
      { serverId: "pku-law-mcp", name: "pku-law-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "北大法宝法律数据库（中国法）" },
      { serverId: "sec-edgar-mcp", name: "sec-edgar-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "SEC EDGAR 上市公司文件检索" },
    ],
    skills: [
      { skillId: 'skill-law-01-contract-risk-assessment', name: "contract-risk-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-law-01-contract-drafting', name: "contract-drafting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-law-01-contract-comparison', name: "contract-comparison", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-law-02',
    name: "诉讼与案件管理包",
    description: "诉讼律师、律所案件管理",
    tags: ["法律合规"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-case-management", "dsh-plugin-legal-document", "dsh-plugin-evidence"],
    mcpServers: [
      { serverId: "court-document-mcp", name: "court-document-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "裁判文书网检索，判例查询" },
      { serverId: "docket-mcp", name: "docket-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "案件 docket 查询，开庭信息，法院公告" },
    ],
    skills: [
      { skillId: 'skill-law-02-legal-research-deep', name: "legal-research-deep", source: '', scope: 'user', optional: true },
      { skillId: 'skill-law-02-legal-document-drafting', name: "legal-document-drafting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-law-02-trial-preparation', name: "trial-preparation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-law-03',
    name: "合规与风控包",
    description: "企业合规部门、风控部门、合规咨询",
    tags: ["法律合规"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-compliance-check", "dsh-plugin-policy-management", "dsh-plugin-risk-assessment"],
    mcpServers: [
      { serverId: "regulation-mcp", name: "regulation-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "监管法规数据库，新规监测，合规要求提取" },
      { serverId: "sanction-list-mcp", name: "sanction-list-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "制裁名单筛查，反洗钱名单查询" },
      { serverId: "gdpr-mcp", name: "gdpr-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "GDPR 数据保护合规检查" },
    ],
    skills: [
      { skillId: 'skill-law-03-compliance-audit', name: "compliance-audit", source: '', scope: 'user', optional: true },
      { skillId: 'skill-law-03-policy-drafting', name: "policy-drafting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-law-03-regulatory-monitoring', name: "regulatory-monitoring", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-fin-01',
    name: "投资研究与分析包",
    description: "券商、基金、投资机构的投研工作",
    tags: ["金融财经"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-stock-analysis", "dsh-plugin-financial-data", "dsh-plugin-research-report"],
    mcpServers: [
      { serverId: "yfinance-mcp", name: "yfinance-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Yahoo Finance 行情数据获取" },
      { serverId: "sec-edgar-mcp", name: "sec-edgar-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "SEC EDGAR 财报检索，10-K/10-Q 读取" },
      { serverId: "alpha-vantage-mcp", name: "alpha-vantage-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Alpha Vantage 金融数据 API" },
      { serverId: "bloomberg-mcp", name: "bloomberg-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Bloomberg 终端数据接口" },
    ],
    skills: [
      { skillId: 'skill-fin-01-equity-research', name: "equity-research", source: '', scope: 'user', optional: true },
      { skillId: 'skill-fin-01-financial-statement-analysis', name: "financial-statement-analysis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-fin-01-industry-research', name: "industry-research", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-fin-02',
    name: "银行与信贷包",
    description: "银行、信贷机构、小贷公司的信贷业务",
    tags: ["金融财经"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-credit-assessment", "dsh-plugin-loan-management", "dsh-plugin-risk-pricing"],
    mcpServers: [
      { serverId: "credit-bureau-mcp", name: "credit-bureau-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "征信机构数据接口，个人/企业征信查询" },
      { serverId: "bank-statement-mcp", name: "bank-statement-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "银行流水解析，收支分析，现金流评估" },
      { serverId: "business-registry-mcp", name: "business-registry-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "工商登记信息查询，企业股权结构，司法风险" },
    ],
    skills: [
      { skillId: 'skill-fin-02-credit-application-review', name: "credit-application-review", source: '', scope: 'user', optional: true },
      { skillId: 'skill-fin-02-loan-document-generation', name: "loan-document-generation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-fin-02-collection-strategy', name: "collection-strategy", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-fin-03',
    name: "保险业务包",
    description: "保险公司、保险代理、保险经纪",
    tags: ["金融财经"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-insurance-product", "dsh-plugin-policy-management", "dsh-plugin-claims"],
    mcpServers: [
      { serverId: "insurance-database-mcp", name: "insurance-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "保险产品数据库，条款库，费率表查询" },
      { serverId: "medical-claim-mcp", name: "medical-claim-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "医保对接，医疗理赔数据接口" },
    ],
    skills: [
      { skillId: 'skill-fin-03-insurance-scheme-design', name: "insurance-scheme-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-fin-03-underwriting-assessment', name: "underwriting-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-fin-03-claims-processing', name: "claims-processing", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-edu-01',
    name: "课程设计与教学包",
    description: "学校、培训机构、在线教育的课程开发与教学",
    tags: ["教育培训"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-course-design", "dsh-plugin-question-bank", "dsh-plugin-knowledge-graph"],
    mcpServers: [
      { serverId: "canvas-lms-mcp", name: "canvas-lms-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Canvas LMS 学习管理系统集成" },
      { serverId: "moodle-mcp", name: "moodle-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Moodle 学习平台接口" },
      { serverId: "youtube-mcp", name: "youtube-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "YouTube 视频搜索，教育视频获取" },
    ],
    skills: [
      { skillId: 'skill-edu-01-lesson-plan-generation', name: "lesson-plan-generation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-edu-01-question-generation', name: "question-generation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-edu-01-knowledge-explanation', name: "knowledge-explanation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-edu-02',
    name: "学生管理与辅导包",
    description: "学校班主任、培训机构教务、一对一辅导",
    tags: ["教育培训"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-student-management", "dsh-plugin-parent-communication", "dsh-plugin-tutoring"],
    mcpServers: [
      { serverId: "student-info-system-mcp", name: "student-info-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "学生信息系统接口，学籍管理" },
      { serverId: "gradebook-mcp", name: "gradebook-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "成绩册管理，分数录入，统计分析" },
    ],
    skills: [
      { skillId: 'skill-edu-02-student-assessment', name: "student-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-edu-02-parent-report', name: "parent-report", source: '', scope: 'user', optional: true },
      { skillId: 'skill-edu-02-tutoring-session', name: "tutoring-session", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-edu-03',
    name: "升学规划与志愿填报包",
    description: "升学规划机构、高中学校、学生家长",
    tags: ["教育培训"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-college-planning", "dsh-plugin-volunteer-filling", "dsh-plugin-exam-prep"],
    mcpServers: [
      { serverId: "college-database-mcp", name: "college-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "院校数据库，招生计划，历年分数线，专业介绍" },
      { serverId: "gaokao-mcp", name: "gaokao-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "高考数据接口，一分一段表，录取数据" },
    ],
    skills: [
      { skillId: 'skill-edu-03-academic-planning', name: "academic-planning", source: '', scope: 'user', optional: true },
      { skillId: 'skill-edu-03-volunteer-strategy', name: "volunteer-strategy", source: '', scope: 'user', optional: true },
      { skillId: 'skill-edu-03-exam-preparation-plan', name: "exam-preparation-plan", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-ec-01',
    name: "商品运营与 listing 优化包",
    description: "电商卖家、运营团队的商品管理与优化",
    tags: ["电商零售"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-product-management", "dsh-plugin-listing-optimization", "dsh-plugin-keyword-research"],
    mcpServers: [
      { serverId: "amazon-sp-mcp", name: "amazon-sp-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Amazon SP-API 卖家平台接口" },
      { serverId: "shopify-mcp", name: "shopify-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Shopify 电商平台接口" },
      { serverId: "taobao-mcp", name: "taobao-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "淘宝/天猫开放平台接口" },
      { serverId: "jd-mcp", name: "jd-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "京东开放平台接口" },
    ],
    skills: [
      { skillId: 'skill-ec-01-listing-copywriting', name: "listing-copywriting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-ec-01-keyword-strategy', name: "keyword-strategy", source: '', scope: 'user', optional: true },
      { skillId: 'skill-ec-01-product-photography-guidance', name: "product-photography-guidance", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-ec-02',
    name: "客服与售后包",
    description: "电商客服团队、售后部门",
    tags: ["电商零售"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-customer-service", "dsh-plugin-after-sales", "dsh-plugin-review-management"],
    mcpServers: [
      { serverId: "customer-service-mcp", name: "customer-service-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "客服系统接口，消息收发，工单管理" },
      { serverId: "order-management-mcp", name: "order-management-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "订单系统接口，订单查询，状态更新" },
    ],
    skills: [
      { skillId: 'skill-ec-02-customer-inquiry-response', name: "customer-inquiry-response", source: '', scope: 'user', optional: true },
      { skillId: 'skill-ec-02-complaint-handling', name: "complaint-handling", source: '', scope: 'user', optional: true },
      { skillId: 'skill-ec-02-review-response', name: "review-response", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-ec-03',
    name: "营销与推广包",
    description: "电商营销团队、推广部门",
    tags: ["电商零售"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-ad-management", "dsh-plugin-promotion", "dsh-plugin-livestream"],
    mcpServers: [
      { serverId: "facebook-ads-mcp", name: "facebook-ads-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Facebook 广告管理接口" },
      { serverId: "google-ads-mcp", name: "google-ads-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Google Ads 广告接口" },
      { serverId: "tiktok-ads-mcp", name: "tiktok-ads-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "TikTok 广告接口" },
    ],
    skills: [
      { skillId: 'skill-ec-03-ad-copywriting', name: "ad-copywriting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-ec-03-promotion-planning', name: "promotion-planning", source: '', scope: 'user', optional: true },
      { skillId: 'skill-ec-03-livestream-script', name: "livestream-script", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-mfg-01',
    name: "生产管理与排程包",
    description: "制造企业生产部门、计划部门",
    tags: ["制造业 / 工业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-production-planning", "dsh-plugin-work-order", "dsh-plugin-equipment-management"],
    mcpServers: [
      { serverId: "erp-mcp", name: "erp-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "ERP 系统接口（SAP/Oracle/用友/金蝶）" },
      { serverId: "mes-mcp", name: "mes-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "MES 制造执行系统接口" },
      { serverId: "iot-mcp", name: "iot-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "IoT 设备数据采集，传感器数据接口" },
    ],
    skills: [
      { skillId: 'skill-mfg-01-production-scheduling', name: "production-scheduling", source: '', scope: 'user', optional: true },
      { skillId: 'skill-mfg-01-work-order-management', name: "work-order-management", source: '', scope: 'user', optional: true },
      { skillId: 'skill-mfg-01-oee-analysis', name: "oee-analysis", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-mfg-02',
    name: "质量管理与控制包",
    description: "制造企业质量部门、QC/QA 团队",
    tags: ["制造业 / 工业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-quality-control", "dsh-plugin-nonconformance", "dsh-plugin-quality-certification"],
    mcpServers: [
      { serverId: "qms-mcp", name: "qms-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "QMS 质量管理系统接口" },
      { serverId: "lab-information-mcp", name: "lab-information-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "LIMS 实验室信息管理系统接口" },
    ],
    skills: [
      { skillId: 'skill-mfg-02-quality-inspection', name: "quality-inspection", source: '', scope: 'user', optional: true },
      { skillId: 'skill-mfg-02-problem-solving-8d', name: "problem-solving-8d", source: '', scope: 'user', optional: true },
      { skillId: 'skill-mfg-02-quality-system-audit', name: "quality-system-audit", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-mfg-03',
    name: "供应链与采购包",
    description: "制造企业采购部门、供应链管理",
    tags: ["制造业 / 工业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-procurement", "dsh-plugin-inventory", "dsh-plugin-supplier-evaluation"],
    mcpServers: [
      { serverId: "srm-mcp", name: "srm-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "SRM 供应商关系管理系统接口" },
      { serverId: "wms-mcp", name: "wms-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "WMS 仓库管理系统接口" },
      { serverId: "logistics-mcp", name: "logistics-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "物流跟踪接口，运输状态查询" },
    ],
    skills: [
      { skillId: 'skill-mfg-03-procurement-strategy', name: "procurement-strategy", source: '', scope: 'user', optional: true },
      { skillId: 'skill-mfg-03-inventory-optimization', name: "inventory-optimization", source: '', scope: 'user', optional: true },
      { skillId: 'skill-mfg-03-supplier-development', name: "supplier-development", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-real-01',
    name: "房产销售与经纪包",
    description: "房产中介、售楼处、房产经纪公司",
    tags: ["房地产 / 建筑"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-property-management", "dsh-plugin-customer-followup", "dsh-plugin-transaction"],
    mcpServers: [
      { serverId: "mls-mcp", name: "mls-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "MLS 多重上市服务系统接口（房产 listing）" },
      { serverId: "property-tax-mcp", name: "property-tax-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "房产税查询，评估价值接口" },
      { serverId: "mortgage-calculator-mcp", name: "mortgage-calculator-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "房贷计算接口，利率查询，还款计划" },
    ],
    skills: [
      { skillId: 'skill-real-01-property-listing-writing', name: "property-listing-writing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-real-01-customer-needs-analysis', name: "customer-needs-analysis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-real-01-transaction-coordination', name: "transaction-coordination", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-real-02',
    name: "建筑工程管理包",
    description: "建筑公司、工程管理、施工项目部",
    tags: ["房地产 / 建筑"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-project-management", "dsh-plugin-construction-drawing", "dsh-plugin-safety-management"],
    mcpServers: [
      { serverId: "bim-mcp", name: "bim-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "BIM 建筑信息模型接口" },
      { serverId: "project-management-mcp", name: "project-management-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "工程项目管理系统接口（Primavera/MS Project）" },
      { serverId: "construction-cost-mcp", name: "construction-cost-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "工程造价接口，定额库，清单计价" },
    ],
    skills: [
      { skillId: 'skill-real-02-construction-schedule', name: "construction-schedule", source: '', scope: 'user', optional: true },
      { skillId: 'skill-real-02-quality-inspection-construction', name: "quality-inspection-construction", source: '', scope: 'user', optional: true },
      { skillId: 'skill-real-02-safety-inspection', name: "safety-inspection", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-real-03',
    name: "物业管理包",
    description: "物业公司、物业项目部、社区管理",
    tags: ["房地产 / 建筑"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-property-service", "dsh-plugin-fee-collection", "dsh-plugin-facility-maintenance"],
    mcpServers: [
      { serverId: "property-management-system-mcp", name: "property-management-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "物业管理系统接口" },
      { serverId: "iot-smart-building-mcp", name: "iot-smart-building-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "智慧楼宇 IoT 接口，设备状态监控" },
    ],
    skills: [
      { skillId: 'skill-real-03-resident-communication', name: "resident-communication", source: '', scope: 'user', optional: true },
      { skillId: 'skill-real-03-maintenance-work-order', name: "maintenance-work-order", source: '', scope: 'user', optional: true },
      { skillId: 'skill-real-03-property-financial-report', name: "property-financial-report", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-media-01',
    name: "短视频创作包",
    description: "短视频创作者、MCN 机构、自媒体团队",
    tags: ["媒体 / 内容创作"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-video-script", "dsh-plugin-video-editing", "dsh-plugin-content-calendar"],
    mcpServers: [
      { serverId: "tiktok-mcp", name: "tiktok-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "TikTok/抖音数据接口，视频管理，评论互动" },
      { serverId: "youtube-mcp", name: "youtube-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "YouTube 视频管理，数据分析，评论回复" },
      { serverId: "bilibili-mcp", name: "bilibili-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "B站视频接口，弹幕管理，数据统计" },
    ],
    skills: [
      { skillId: 'skill-media-01-short-video-script', name: "short-video-script", source: '', scope: 'user', optional: true },
      { skillId: 'skill-media-01-video-title-thumbnail', name: "video-title-thumbnail", source: '', scope: 'user', optional: true },
      { skillId: 'skill-media-01-content-strategy', name: "content-strategy", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-media-02',
    name: "图文内容创作包",
    description: "公众号、小红书、知乎、博客等图文创作者",
    tags: ["媒体 / 内容创作"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-article-writing", "dsh-plugin-image-generation", "dsh-plugin-seo-optimization"],
    mcpServers: [
      { serverId: "wordpress-mcp", name: "wordpress-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "WordPress 博客接口，文章发布，媒体管理" },
      { serverId: "wechat-mcp", name: "wechat-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "微信公众号接口，图文发布，数据统计" },
      { serverId: "xiaohongshu-mcp", name: "xiaohongshu-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "小红书笔记接口，发布管理，互动数据" },
    ],
    skills: [
      { skillId: 'skill-media-02-long-form-article', name: "long-form-article", source: '', scope: 'user', optional: true },
      { skillId: 'skill-media-02-social-media-post', name: "social-media-post", source: '', scope: 'user', optional: true },
      { skillId: 'skill-media-02-content-repurposing', name: "content-repurposing", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-media-03',
    name: "品牌营销与公关包",
    description: "品牌方、营销公司、公关团队",
    tags: ["媒体 / 内容创作"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-brand-strategy", "dsh-plugin-campaign-management", "dsh-plugin-pr-crisis"],
    mcpServers: [
      { serverId: "social-listening-mcp", name: "social-listening-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "社交聆听接口，品牌提及，舆情监控" },
      { serverId: "media-database-mcp", name: "media-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "媒体数据库，记者联系，发稿管理" },
      { serverId: "influencer-mcp", name: "influencer-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "KOL/KOC 数据库，达人合作，效果评估" },
    ],
    skills: [
      { skillId: 'skill-media-03-brand-storytelling', name: "brand-storytelling", source: '', scope: 'user', optional: true },
      { skillId: 'skill-media-03-marketing-campaign', name: "marketing-campaign", source: '', scope: 'user', optional: true },
      { skillId: 'skill-media-03-crisis-communication', name: "crisis-communication", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-gov-01',
    name: "政务办公与公文包",
    description: "政府机关、事业单位、公共服务部门",
    tags: ["政府 / 公共服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-official-document", "dsh-plugin-meeting-management", "dsh-plugin-government-affairs"],
    mcpServers: [
      { serverId: "government-portal-mcp", name: "government-portal-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "政府门户网站接口，信息发布，办事指南" },
      { serverId: "oa-system-mcp", name: "oa-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "OA 办公系统接口，流程审批，公文流转" },
    ],
    skills: [
      { skillId: 'skill-gov-01-official-document-drafting', name: "official-document-drafting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-gov-01-policy-research', name: "policy-research", source: '', scope: 'user', optional: true },
      { skillId: 'skill-gov-01-meeting-minutes', name: "meeting-minutes", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-gov-02',
    name: "公共服务与民生包",
    description: "街道社区、政务服务中心、民生服务部门",
    tags: ["政府 / 公共服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-resident-service", "dsh-plugin-community-management", "dsh-plugin-social-assistance"],
    mcpServers: [
      { serverId: "citizen-service-mcp", name: "citizen-service-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "市民服务接口，办事预约，进度查询" },
      { serverId: "social-security-mcp", name: "social-security-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "社保接口，医保查询，养老金，失业金" },
      { serverId: "housing-fund-mcp", name: "housing-fund-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "公积金接口，查询提取，贷款计算" },
    ],
    skills: [
      { skillId: 'skill-gov-02-policy-explanation', name: "policy-explanation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-gov-02-resident-communication', name: "resident-communication", source: '', scope: 'user', optional: true },
      { skillId: 'skill-gov-02-social-work-case', name: "social-work-case", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-gov-03',
    name: "城市管理与应急包",
    description: "城管部门、应急管理局、城市运行管理",
    tags: ["政府 / 公共服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-city-management", "dsh-plugin-emergency-response", "dsh-plugin-risk-monitoring"],
    mcpServers: [
      { serverId: "iot-city-mcp", name: "iot-city-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "城市 IoT 接口，摄像头，传感器，环境监测" },
      { serverId: "emergency-alert-mcp", name: "emergency-alert-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "应急预警接口，气象预警，地质灾害，公共安全" },
      { serverId: "gis-mcp", name: "gis-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "GIS 地理信息系统接口，地图服务，空间分析" },
    ],
    skills: [
      { skillId: 'skill-gov-03-incident-reporting', name: "incident-reporting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-gov-03-emergency-plan-execution', name: "emergency-plan-execution", source: '', scope: 'user', optional: true },
      { skillId: 'skill-gov-03-risk-assessment-public', name: "risk-assessment-public", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-it-01',
    name: "代码开发与调试包",
    description: "软件开发者、程序员、开发团队",
    tags: ["IT / 软件开发"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-code-editor", "dsh-plugin-debugger", "dsh-plugin-code-review"],
    mcpServers: [
      { serverId: "github-mcp", name: "github-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "GitHub 接口，代码仓库，Issue/PR，CI/CD" },
      { serverId: "gitlab-mcp", name: "gitlab-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "GitLab 接口，仓库管理，CI/CD 流水线" },
      { serverId: "context7-mcp", name: "context7-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "库文档检索，版本特定 API 文档注入" },
      { serverId: "sequential-thinking-mcp", name: "sequential-thinking-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "结构化思考，复杂问题分解，推理过程" },
    ],
    skills: [
      { skillId: 'skill-it-01-code-generation', name: "code-generation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-it-01-bug-fixing', name: "bug-fixing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-it-01-code-refactoring', name: "code-refactoring", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-it-02',
    name: "DevOps 与运维包",
    description: "运维工程师、DevOps 团队、SRE",
    tags: ["IT / 软件开发"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-server-management", "dsh-plugin-deployment", "dsh-plugin-monitoring-alert"],
    mcpServers: [
      { serverId: "kubernetes-mcp", name: "kubernetes-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Kubernetes 集群管理，Pod/Deployment/Service 操作" },
      { serverId: "docker-mcp", name: "docker-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Docker 容器管理，镜像构建，容器操作" },
      { serverId: "terraform-mcp", name: "terraform-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Terraform 基础设施即代码，资源管理" },
      { serverId: "prometheus-mcp", name: "prometheus-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Prometheus 监控指标查询" },
      { serverId: "sentry-mcp", name: "sentry-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Sentry 错误追踪，性能监控，问题管理" },
    ],
    skills: [
      { skillId: 'skill-it-02-incident-response-it', name: "incident-response-it", source: '', scope: 'user', optional: true },
      { skillId: 'skill-it-02-deployment-pipeline', name: "deployment-pipeline", source: '', scope: 'user', optional: true },
      { skillId: 'skill-it-02-infrastructure-management', name: "infrastructure-management", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-it-03',
    name: "数据库与数据分析包",
    description: "数据工程师、数据分析师、DBA",
    tags: ["IT / 软件开发"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-dba-tools", "dsh-plugin-data-analysis", "dsh-plugin-data-visualization"],
    mcpServers: [
      { serverId: "postgres-mcp", name: "postgres-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "PostgreSQL 数据库操作" },
      { serverId: "mysql-mcp", name: "mysql-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "MySQL 数据库操作" },
      { serverId: "mongodb-mcp", name: "mongodb-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "MongoDB 文档数据库操作" },
      { serverId: "redis-mcp", name: "redis-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Redis 缓存操作" },
      { serverId: "snowflake-mcp", name: "snowflake-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Snowflake 数据仓库查询" },
    ],
    skills: [
      { skillId: 'skill-it-03-sql-optimization', name: "sql-optimization", source: '', scope: 'user', optional: true },
      { skillId: 'skill-it-03-exploratory-data-analysis', name: "exploratory-data-analysis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-it-03-dashboard-design', name: "dashboard-design", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-agr-01',
    name: "种植管理与精准农业包",
    description: "农场、种植基地、农业合作社",
    tags: ["农业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-crop-management", "dsh-plugin-precision-agriculture", "dsh-plugin-pest-disease"],
    mcpServers: [
      { serverId: "weather-mcp", name: "weather-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "气象数据接口，天气预报，历史气象，农业气象指标" },
      { serverId: "soil-mcp", name: "soil-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "土壤数据接口，养分检测，墒情监测，pH 值" },
      { serverId: "drone-mcp", name: "drone-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "无人机接口，航拍图像，NDVI 植被指数，植保作业" },
    ],
    skills: [
      { skillId: 'skill-agr-01-planting-plan', name: "planting-plan", source: '', scope: 'user', optional: true },
      { skillId: 'skill-agr-01-pest-diagnosis', name: "pest-diagnosis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-agr-01-yield-optimization', name: "yield-optimization", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-agr-02',
    name: "农产品销售与溯源包",
    description: "农产品销售、农业电商、食品企业",
    tags: ["农业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-agri-product-sales", "dsh-plugin-traceability", "dsh-plugin-agri-brand"],
    mcpServers: [
      { serverId: "ecommerce-platform-mcp", name: "ecommerce-platform-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "电商平台接口，农产品上架，订单同步" },
      { serverId: "food-safety-mcp", name: "food-safety-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "食品安全接口，检测报告，合格证，追溯查询" },
    ],
    skills: [
      { skillId: 'skill-agr-02-agri-product-marketing', name: "agri-product-marketing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-agr-02-traceability-system', name: "traceability-system", source: '', scope: 'user', optional: true },
      { skillId: 'skill-agr-02-agri-supply-chain', name: "agri-supply-chain", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-agr-03',
    name: "畜牧养殖包",
    description: "养殖场、畜牧企业、养殖合作社",
    tags: ["农业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-livestock-management", "dsh-plugin-feed-management", "dsh-plugin-animal-health"],
    mcpServers: [
      { serverId: "iot-livestock-mcp", name: "iot-livestock-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "畜牧 IoT 接口，耳标数据，环境监测，体重采集" },
      { serverId: "veterinary-drug-mcp", name: "veterinary-drug-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "兽药数据库，说明书，休药期，相互作用" },
    ],
    skills: [
      { skillId: 'skill-agr-03-breeding-management', name: "breeding-management", source: '', scope: 'user', optional: true },
      { skillId: 'skill-agr-03-feed-formulation', name: "feed-formulation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-agr-03-biosecurity', name: "biosecurity", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-log-01',
    name: "运输与配送包",
    description: "物流公司、运输企业、配送团队",
    tags: ["物流 / 供应链"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-transport-planning", "dsh-plugin-delivery-management", "dsh-plugin-fleet-management"],
    mcpServers: [
      { serverId: "gps-tracking-mcp", name: "gps-tracking-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "GPS 定位接口，车辆追踪，轨迹回放，电子围栏" },
      { serverId: "map-navigation-mcp", name: "map-navigation-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "地图导航接口，路径规划，实时路况，地理编码" },
      { serverId: "express-mcp", name: "express-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "快递接口，运单查询，物流轨迹，电子面单" },
    ],
    skills: [
      { skillId: 'skill-log-01-route-optimization', name: "route-optimization", source: '', scope: 'user', optional: true },
      { skillId: 'skill-log-01-delivery-execution', name: "delivery-execution", source: '', scope: 'user', optional: true },
      { skillId: 'skill-log-01-fleet-efficiency', name: "fleet-efficiency", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-log-02',
    name: "仓储与库存包",
    description: "仓储企业、物流中心、仓库管理",
    tags: ["物流 / 供应链"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-warehouse-layout", "dsh-plugin-inbound-outbound", "dsh-plugin-stock-control"],
    mcpServers: [
      { serverId: "wms-mcp", name: "wms-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "WMS 仓库管理系统接口" },
      { serverId: "barcode-rfid-mcp", name: "barcode-rfid-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "条码/RFID 接口，扫码操作，标签打印" },
      { serverId: "automated-storage-mcp", name: "automated-storage-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "自动化立体仓库接口，AGV，堆垛机" },
    ],
    skills: [
      { skillId: 'skill-log-02-warehouse-operations', name: "warehouse-operations", source: '', scope: 'user', optional: true },
      { skillId: 'skill-log-02-inventory-accuracy', name: "inventory-accuracy", source: '', scope: 'user', optional: true },
      { skillId: 'skill-log-02-space-utilization', name: "space-utilization", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-log-03',
    name: "供应链协同包",
    description: "供应链管理、采购物流、供应链协同",
    tags: ["物流 / 供应链"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-supply-chain-planning", "dsh-plugin-procurement-logistics", "dsh-plugin-supply-chain-risk"],
    mcpServers: [
      { serverId: "scm-system-mcp", name: "scm-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "SCM 供应链管理系统接口" },
      { serverId: "edi-mcp", name: "edi-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "EDI 电子数据交换接口，订单/发票/发货通知" },
      { serverId: "trade-customs-mcp", name: "trade-customs-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "国际贸易海关接口，报关单，关税，原产地" },
    ],
    skills: [
      { skillId: 'skill-log-03-demand-forecasting', name: "demand-forecasting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-log-03-supply-chain-collaboration', name: "supply-chain-collaboration", source: '', scope: 'user', optional: true },
      { skillId: 'skill-log-03-supply-chain-resilience', name: "supply-chain-resilience", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-trav-01',
    name: "旅行社与行程规划包",
    description: "旅行社、旅游顾问、定制游公司",
    tags: ["旅游 / 酒店"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-itinerary-design", "dsh-plugin-tour-product", "dsh-plugin-tour-guide"],
    mcpServers: [
      { serverId: "flight-mcp", name: "flight-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "机票接口，航班查询，价格对比，预订管理" },
      { serverId: "hotel-booking-mcp", name: "hotel-booking-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "酒店预订接口，房态查询，价格比较，预订确认" },
      { serverId: "attraction-ticket-mcp", name: "attraction-ticket-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "景点门票接口，票务查询，在线预订，核销管理" },
      { serverId: "travel-review-mcp", name: "travel-review-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "旅游评价接口，景点评分，游客评论，攻略推荐" },
    ],
    skills: [
      { skillId: 'skill-trav-01-custom-itinerary', name: "custom-itinerary", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trav-01-tour-costing', name: "tour-costing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trav-01-tour-guide-script', name: "tour-guide-script", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-trav-02',
    name: "酒店运营与管理包",
    description: "酒店、民宿、度假村的运营管理",
    tags: ["旅游 / 酒店"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-hotel-front-desk", "dsh-plugin-revenue-management", "dsh-plugin-hotel-housekeeping"],
    mcpServers: [
      { serverId: "pms-mcp", name: "pms-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "PMS 酒店管理系统接口" },
      { serverId: "ota-mcp", name: "ota-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "OTA 渠道接口（携程/美团/Booking/Agoda）" },
      { serverId: "channel-manager-mcp", name: "channel-manager-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "渠道管理器接口，房态同步，价格同步" },
    ],
    skills: [
      { skillId: 'skill-trav-02-front-desk-operations', name: "front-desk-operations", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trav-02-dynamic-pricing', name: "dynamic-pricing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trav-02-guest-experience', name: "guest-experience", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-trav-03',
    name: "旅游营销与获客包",
    description: "旅游营销、目的地推广、旅游电商",
    tags: ["旅游 / 酒店"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-travel-marketing", "dsh-plugin-destination-promotion", "dsh-plugin-travel-crm"],
    mcpServers: [
      { serverId: "social-media-travel-mcp", name: "social-media-travel-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "社交媒体旅游接口，小红书/抖音/马蜂窝" },
      { serverId: "travel-kol-mcp", name: "travel-kol-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "旅游 KOL 数据库，达人合作，内容种草" },
    ],
    skills: [
      { skillId: 'skill-trav-03-travel-content-marketing', name: "travel-content-marketing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trav-03-travel-campaign', name: "travel-campaign", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trav-03-travel-member-operations', name: "travel-member-operations", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-food-01',
    name: "餐厅运营与管理包",
    description: "餐厅、快餐店、餐饮连锁的运营管理",
    tags: ["餐饮"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-restaurant-pos", "dsh-plugin-kitchen-management", "dsh-plugin-restaurant-service"],
    mcpServers: [
      { serverId: "pos-system-mcp", name: "pos-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "POS 收银系统接口" },
      { serverId: "restaurant-order-mcp", name: "restaurant-order-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "点餐系统接口，外卖平台对接" },
      { serverId: "kitchen-display-mcp", name: "kitchen-display-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "KDS 厨房显示系统接口" },
    ],
    skills: [
      { skillId: 'skill-food-01-restaurant-operations', name: "restaurant-operations", source: '', scope: 'user', optional: true },
      { skillId: 'skill-food-01-menu-engineering', name: "menu-engineering", source: '', scope: 'user', optional: true },
      { skillId: 'skill-food-01-customer-service-restaurant', name: "customer-service-restaurant", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-food-02',
    name: "菜品研发与供应链包",
    description: "餐饮研发、中央厨房、食材采购",
    tags: ["餐饮"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-menu-development", "dsh-plugin-central-kitchen", "dsh-plugin-food-purchasing"],
    mcpServers: [
      { serverId: "food-cost-mcp", name: "food-cost-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "食材成本数据库，价格行情，供应商报价" },
      { serverId: "food-safety-mcp", name: "food-safety-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "食品安全接口，检测报告，溯源查询，证照管理" },
      { serverId: "recipe-database-mcp", name: "recipe-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "菜谱数据库，菜品配方，烹饪方法，营养成分" },
    ],
    skills: [
      { skillId: 'skill-food-02-recipe-development', name: "recipe-development", source: '', scope: 'user', optional: true },
      { skillId: 'skill-food-02-food-cost-control', name: "food-cost-control", source: '', scope: 'user', optional: true },
      { skillId: 'skill-food-02-central-kitchen-production', name: "central-kitchen-production", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-food-03',
    name: "餐饮营销与外卖包",
    description: "餐饮营销、外卖运营、会员管理",
    tags: ["餐饮"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-food-marketing", "dsh-plugin-delivery-operations", "dsh-plugin-restaurant-crm"],
    mcpServers: [
      { serverId: "meituan-mcp", name: "meituan-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "美团外卖接口，店铺管理，订单处理，评价回复" },
      { serverId: "eleme-mcp", name: "eleme-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "饿了么外卖接口，店铺运营，订单管理，数据统计" },
      { serverId: "dianping-mcp", name: "dianping-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "大众点评接口，评价管理，团购套餐，数据统计" },
    ],
    skills: [
      { skillId: 'skill-food-03-restaurant-promotion', name: "restaurant-promotion", source: '', scope: 'user', optional: true },
      { skillId: 'skill-food-03-delivery-store-optimization', name: "delivery-store-optimization", source: '', scope: 'user', optional: true },
      { skillId: 'skill-food-03-restaurant-member-operations', name: "restaurant-member-operations", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-hr-01',
    name: "招聘与人才获取包",
    description: "企业 HR、招聘专员、猎头顾问",
    tags: ["人力资源"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-recruitment", "dsh-plugin-talent-search", "dsh-plugin-interview"],
    mcpServers: [
      { serverId: "linkedin-mcp", name: "linkedin-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "LinkedIn 接口，人才搜索，职位发布" },
      { serverId: "boss-zhipin-mcp", name: "boss-zhipin-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "BOSS直聘接口，候选人沟通，职位管理" },
      { serverId: "ats-mcp", name: "ats-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "ATS 招聘管理系统接口" },
    ],
    skills: [
      { skillId: 'skill-hr-01-job-description-writing', name: "job-description-writing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-hr-01-resume-screening', name: "resume-screening", source: '', scope: 'user', optional: true },
      { skillId: 'skill-hr-01-interview-question-design', name: "interview-question-design", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-hr-02',
    name: "员工管理与发展包",
    description: "企业 HR、人事部门、培训部门",
    tags: ["人力资源"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-employee-management", "dsh-plugin-performance", "dsh-plugin-training-development"],
    mcpServers: [
      { serverId: "hris-mcp", name: "hris-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "HRIS 人力资源信息系统接口" },
      { serverId: "performance-system-mcp", name: "performance-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "绩效管理系统接口" },
      { serverId: "lms-mcp", name: "lms-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "LMS 学习管理系统接口" },
    ],
    skills: [
      { skillId: 'skill-hr-02-employee-onboarding', name: "employee-onboarding", source: '', scope: 'user', optional: true },
      { skillId: 'skill-hr-02-performance-management', name: "performance-management", source: '', scope: 'user', optional: true },
      { skillId: 'skill-hr-02-training-needs-analysis', name: "training-needs-analysis", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-hr-03',
    name: "薪酬福利与员工关系包",
    description: "企业薪酬福利、员工关系、工会工作",
    tags: ["人力资源"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-compensation", "dsh-plugin-benefits", "dsh-plugin-employee-relations"],
    mcpServers: [
      { serverId: "payroll-mcp", name: "payroll-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "薪资系统接口，工资核算，发放管理" },
      { serverId: "social-security-mcp", name: "social-security-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "社保公积金接口，基数申报，缴纳管理" },
      { serverId: "tax-mcp", name: "tax-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "个税接口，专项附加扣除，汇算清缴" },
    ],
    skills: [
      { skillId: 'skill-hr-03-salary-calculation', name: "salary-calculation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-hr-03-benefit-program-design', name: "benefit-program-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-hr-03-employee-relation-management', name: "employee-relation-management", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-auto-01',
    name: "汽车销售与 4S 店运营包",
    description: "汽车 4S 店、汽车经销商、二手车商",
    tags: ["汽车"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-auto-sales", "dsh-plugin-vehicle-inventory", "dsh-plugin-after-sales"],
    mcpServers: [
      { serverId: "automotive-database-mcp", name: "automotive-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "汽车数据库接口，车型参数，配置对比，价格查询" },
      { serverId: "dealer-management-mcp", name: "dealer-management-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "经销商管理系统 DMS 接口" },
      { serverId: "used-car-valuation-mcp", name: "used-car-valuation-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "二手车估值接口，车况评估，残值计算" },
    ],
    skills: [
      { skillId: 'skill-auto-01-customer-follow-up-auto', name: "customer-follow-up-auto", source: '', scope: 'user', optional: true },
      { skillId: 'skill-auto-01-vehicle-comparison', name: "vehicle-comparison", source: '', scope: 'user', optional: true },
      { skillId: 'skill-auto-01-after-sales-service', name: "after-sales-service", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-auto-02',
    name: "汽车维修与保养包",
    description: "汽车维修厂、快修店、保养连锁、轮胎店",
    tags: ["汽车"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-repair-management", "dsh-plugin-parts-management", "dsh-plugin-vehicle-diagnosis"],
    mcpServers: [
      { serverId: "obd2-diagnostic-mcp", name: "obd2-diagnostic-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "OBD-II 诊断接口，故障码读取，实时数据，车辆状态" },
      { serverId: "parts-catalog-mcp", name: "parts-catalog-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "配件目录接口，OE 号查询，配件适配，价格库存" },
      { serverId: "repair-manual-mcp", name: "repair-manual-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "维修手册接口，拆装步骤，扭矩参数，电路图" },
    ],
    skills: [
      { skillId: 'skill-auto-02-fault-diagnosis', name: "fault-diagnosis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-auto-02-repair-quote', name: "repair-quote", source: '', scope: 'user', optional: true },
      { skillId: 'skill-auto-02-maintenance-plan', name: "maintenance-plan", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-auto-03',
    name: "汽车制造与供应链包",
    description: "汽车制造厂、零部件供应商、汽车电子企业",
    tags: ["汽车"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-auto-manufacturing", "dsh-plugin-auto-parts-supply", "dsh-plugin-automotive-qa"],
    mcpServers: [
      { serverId: "mes-automotive-mcp", name: "mes-automotive-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "汽车行业 MES 系统接口" },
      { serverId: "plm-mcp", name: "plm-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "PLM 产品生命周期管理接口，BOM 管理，图纸管理" },
      { serverId: "supply-chain-auto-mcp", name: "supply-chain-auto-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "汽车供应链接口，订单协同，发货通知，在途跟踪" },
    ],
    skills: [
      { skillId: 'skill-auto-03-production-planning-auto', name: "production-planning-auto", source: '', scope: 'user', optional: true },
      { skillId: 'skill-auto-03-quality-control-auto', name: "quality-control-auto", source: '', scope: 'user', optional: true },
      { skillId: 'skill-auto-03-supplier-quality-management', name: "supplier-quality-management", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-energy-01',
    name: "电力运营与电网包",
    description: "电力公司、电网企业、供电所、新能源电站",
    tags: ["能源与公用事业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-power-grid", "dsh-plugin-meter-reading", "dsh-plugin-power-customer"],
    mcpServers: [
      { serverId: "scada-mcp", name: "scada-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "SCADA 数据采集与监控系统接口，实时数据，告警信息" },
      { serverId: "smart-meter-mcp", name: "smart-meter-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "智能电表接口，用电数据，远程抄表，负荷控制" },
      { serverId: "gis-power-mcp", name: "gis-power-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "电力 GIS 接口，电网拓扑，设备定位，线路管理" },
    ],
    skills: [
      { skillId: 'skill-energy-01-grid-dispatch', name: "grid-dispatch", source: '', scope: 'user', optional: true },
      { skillId: 'skill-energy-01-power-billing', name: "power-billing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-energy-01-power-outage-management', name: "power-outage-management", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-energy-02',
    name: "新能源与可再生能源包",
    description: "光伏电站、风电场、储能电站、新能源企业",
    tags: ["能源与公用事业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-renewable-plant", "dsh-plugin-energy-storage", "dsh-plugin-carbon-accounting"],
    mcpServers: [
      { serverId: "pv-monitoring-mcp", name: "pv-monitoring-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "光伏监控接口，逆变器数据，发电量，组件状态" },
      { serverId: "wind-scada-mcp", name: "wind-scada-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "风电 SCADA 接口，风机数据，风速风向，发电量" },
      { serverId: "weather-forecast-mcp", name: "weather-forecast-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "气象预报接口，辐照度，风速，温度，发电预测" },
      { serverId: "carbon-market-mcp", name: "carbon-market-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "碳市场接口，碳价查询，碳交易，CCER" },
    ],
    skills: [
      { skillId: 'skill-energy-02-renewable-performance', name: "renewable-performance", source: '', scope: 'user', optional: true },
      { skillId: 'skill-energy-02-energy-storage-dispatch', name: "energy-storage-dispatch", source: '', scope: 'user', optional: true },
      { skillId: 'skill-energy-02-carbon-footprint-calculation', name: "carbon-footprint-calculation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-energy-03',
    name: "石油天然气与公用事业包",
    description: "石油公司、天然气公司、水务公司、燃气公司",
    tags: ["能源与公用事业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-oil-gas-operations", "dsh-plugin-water-utility", "dsh-plugin-gas-utility"],
    mcpServers: [
      { serverId: "pipeline-scada-mcp", name: "pipeline-scada-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "管道 SCADA 接口，压力流量，温度，泄漏检测" },
      { serverId: "water-quality-mcp", name: "water-quality-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "水质监测接口，pH，浊度，余氯，微生物" },
      { serverId: "gas-leak-detection-mcp", name: "gas-leak-detection-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "燃气泄漏检测接口，浓度监测，报警定位" },
    ],
    skills: [
      { skillId: 'skill-energy-03-oil-gas-production', name: "oil-gas-production", source: '', scope: 'user', optional: true },
      { skillId: 'skill-energy-03-water-supply-management', name: "water-supply-management", source: '', scope: 'user', optional: true },
      { skillId: 'skill-energy-03-gas-safety-management', name: "gas-safety-management", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-sport-01',
    name: "健身俱乐部与私教包",
    description: "健身房、健身工作室、私教团队、瑜伽馆",
    tags: ["体育与健身"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-gym-management", "dsh-plugin-personal-training", "dsh-plugin-fitness-assessment"],
    mcpServers: [
      { serverId: "fitness-tracker-mcp", name: "fitness-tracker-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "健身追踪设备接口（Apple Health/Google Fit/华为运动健康）" },
      { serverId: "exercise-database-mcp", name: "exercise-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "动作库数据库接口，动作图解，肌肉群，难度等级" },
      { serverId: "nutrition-database-mcp", name: "nutrition-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "营养数据库接口，食物热量，营养素，饮食记录" },
    ],
    skills: [
      { skillId: 'skill-sport-01-training-plan-design', name: "training-plan-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-sport-01-fitness-assessment-report', name: "fitness-assessment-report", source: '', scope: 'user', optional: true },
      { skillId: 'skill-sport-01-member-retention-fitness', name: "member-retention-fitness", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-sport-02',
    name: "体育赛事与运营包",
    description: "体育赛事公司、赛事运营方、体育协会、俱乐部",
    tags: ["体育与健身"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-event-planning", "dsh-plugin-registration", "dsh-plugin-scoring-timing"],
    mcpServers: [
      { serverId: "timing-system-mcp", name: "timing-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "计时系统接口，芯片计时，终点摄像，分段成绩" },
      { serverId: "sports-data-mcp", name: "sports-data-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "体育数据接口，选手数据，历史成绩，统计分析" },
      { serverId: "venue-booking-mcp", name: "venue-booking-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "场馆预订接口，场地查询，预约管理，费用结算" },
    ],
    skills: [
      { skillId: 'skill-sport-02-event-planning-sports', name: "event-planning-sports", source: '', scope: 'user', optional: true },
      { skillId: 'skill-sport-02-competition-management', name: "competition-management", source: '', scope: 'user', optional: true },
      { skillId: 'skill-sport-02-sports-marketing', name: "sports-marketing", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-sport-03',
    name: "运动康复与运动医学包",
    description: "运动康复中心、康复诊所、运动队医、物理治疗师",
    tags: ["体育与健身"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-sports-rehab", "dsh-plugin-injury-management", "dsh-plugin-physiotherapy"],
    mcpServers: [
      { serverId: "rehab-equipment-mcp", name: "rehab-equipment-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "康复设备接口，治疗设备数据，训练参数，效果记录" },
      { serverId: "medical-imaging-mcp", name: "medical-imaging-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "医学影像接口，X光/MRI/CT，影像查看，报告读取" },
      { serverId: "pain-assessment-mcp", name: "pain-assessment-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "疼痛评估接口，VAS 评分，疼痛地图，功能评分" },
    ],
    skills: [
      { skillId: 'skill-sport-03-injury-assessment', name: "injury-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-sport-03-rehabilitation-program', name: "rehabilitation-program", source: '', scope: 'user', optional: true },
      { skillId: 'skill-sport-03-return-to-sport', name: "return-to-sport", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-culture-01',
    name: "博物馆与文博包",
    description: "博物馆、纪念馆、美术馆、文博机构",
    tags: ["文化艺术与文博"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-collection-management", "dsh-plugin-exhibition", "dsh-plugin-museum-education"],
    mcpServers: [
      { serverId: "collection-database-mcp", name: "collection-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "藏品数据库接口，文物信息，图片，检索查询" },
      { serverId: "museum-ticketing-mcp", name: "museum-ticketing-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "博物馆票务接口，预约参观，门票销售，客流统计" },
      { serverId: "audio-guide-mcp", name: "audio-guide-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "语音导览接口，讲解内容，定位讲解，多语言" },
    ],
    skills: [
      { skillId: 'skill-culture-01-artifact-research', name: "artifact-research", source: '', scope: 'user', optional: true },
      { skillId: 'skill-culture-01-exhibition-curating', name: "exhibition-curating", source: '', scope: 'user', optional: true },
      { skillId: 'skill-culture-01-museum-public-education', name: "museum-public-education", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-culture-02',
    name: "艺术创作与画廊包",
    description: "艺术家、画廊、艺术机构、拍卖行",
    tags: ["文化艺术与文博"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-artist-studio", "dsh-plugin-gallery-management", "dsh-plugin-art-auction"],
    mcpServers: [
      { serverId: "art-market-mcp", name: "art-market-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "艺术市场数据接口，成交价，艺术家指数，市场趋势" },
      { serverId: "artwork-registry-mcp", name: "artwork-registry-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "艺术品登记接口，作品溯源，真伪鉴定，所有权" },
      { serverId: "image-generation-mcp", name: "image-generation-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "AI 图像生成接口，创作辅助，风格迁移，概念图" },
    ],
    skills: [
      { skillId: 'skill-culture-02-art-creation-assistance', name: "art-creation-assistance", source: '', scope: 'user', optional: true },
      { skillId: 'skill-culture-02-artwork-pricing', name: "artwork-pricing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-culture-02-exhibition-installation', name: "exhibition-installation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-culture-03',
    name: "演出与演艺包",
    description: "演出公司、剧院、剧团、演艺经纪",
    tags: ["文化艺术与文博"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-production-management", "dsh-plugin-theater-operations", "dsh-plugin-performance-marketing"],
    mcpServers: [
      { serverId: "ticketing-system-mcp", name: "ticketing-system-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "票务系统接口，选座购票，票房统计，退票管理" },
      { serverId: "script-database-mcp", name: "script-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "剧本数据库接口，剧目信息，演职员，演出资料" },
      { serverId: "venue-management-mcp", name: "venue-management-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "场馆管理接口，场地信息，设备清单，档期管理" },
    ],
    skills: [
      { skillId: 'skill-culture-03-script-analysis', name: "script-analysis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-culture-03-production-budget', name: "production-budget", source: '', scope: 'user', optional: true },
      { skillId: 'skill-culture-03-performance-marketing-plan', name: "performance-marketing-plan", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-game-01',
    name: "游戏开发与设计包",
    description: "游戏开发团队、独立游戏开发者、游戏设计工作室",
    tags: ["游戏与电竞"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-game-design", "dsh-plugin-game-development", "dsh-plugin-game-asset"],
    mcpServers: [
      { serverId: "unity-mcp", name: "unity-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Unity 引擎接口，场景操作，对象管理，脚本执行" },
      { serverId: "unreal-mcp", name: "unreal-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Unreal Engine 接口，蓝图操作，关卡编辑，资产管理" },
      { serverId: "git-game-mcp", name: "git-game-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Git 版本控制接口，代码仓库，分支管理，代码审查" },
    ],
    skills: [
      { skillId: 'skill-game-01-gdd-writing', name: "gdd-writing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-game-01-game-balancing', name: "game-balancing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-game-01-level-design', name: "level-design", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-game-02',
    name: "电竞俱乐部与赛事包",
    description: "电竞俱乐部、电竞战队、电竞赛事方、电竞场馆",
    tags: ["游戏与电竞"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-esports-team", "dsh-plugin-esports-event", "dsh-plugin-esports-venue"],
    mcpServers: [
      { serverId: "game-data-mcp", name: "game-data-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "游戏数据接口，比赛数据，选手数据，战术分析" },
      { serverId: "streaming-platform-mcp", name: "streaming-platform-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "直播平台接口（斗鱼/虎牙/B站/Twitch），直播管理，弹幕互动" },
      { serverId: "tournament-platform-mcp", name: "tournament-platform-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "赛事平台接口，报名管理，赛程管理，成绩统计" },
    ],
    skills: [
      { skillId: 'skill-game-02-esports-training', name: "esports-training", source: '', scope: 'user', optional: true },
      { skillId: 'skill-game-02-match-analysis', name: "match-analysis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-game-02-esports-event-production', name: "esports-event-production", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-game-03',
    name: "游戏运营与社区包",
    description: "游戏运营团队、社区运营、玩家社区、游戏发行",
    tags: ["游戏与电竞"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-game-operations", "dsh-plugin-game-community", "dsh-plugin-game-customer-service"],
    mcpServers: [
      { serverId: "game-analytics-mcp", name: "game-analytics-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "游戏数据分析接口，DAU/MAU，留存率，付费率，LTV" },
      { serverId: "discord-mcp", name: "discord-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "Discord 社区接口，频道管理，消息发送，机器人" },
      { serverId: "game-cs-mcp", name: "game-cs-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "游戏客服系统接口，工单管理，知识库，玩家信息" },
    ],
    skills: [
      { skillId: 'skill-game-03-game-event-planning', name: "game-event-planning", source: '', scope: 'user', optional: true },
      { skillId: 'skill-game-03-game-data-analysis', name: "game-data-analysis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-game-03-community-operations-game', name: "community-operations-game", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-env-01',
    name: "环境监测与治理包",
    description: "环保公司、环境监测站、污染治理企业、环评机构",
    tags: ["环保与碳中和"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-environmental-monitoring", "dsh-plugin-pollution-control", "dsh-plugin-eia"],
    mcpServers: [
      { serverId: "air-quality-mcp", name: "air-quality-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "空气质量监测接口，PM2.5/PM10，SO2/NOx/O3，AQI" },
      { serverId: "water-quality-monitoring-mcp", name: "water-quality-monitoring-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "水质监测接口，COD/BOD，氨氮，总磷，重金属" },
      { serverId: "noise-monitoring-mcp", name: "noise-monitoring-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "噪声监测接口，声级计数据，频谱分析，达标判断" },
    ],
    skills: [
      { skillId: 'skill-env-01-monitoring-report', name: "monitoring-report", source: '', scope: 'user', optional: true },
      { skillId: 'skill-env-01-pollution-treatment-design', name: "pollution-treatment-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-env-01-eia-report-writing', name: "eia-report-writing", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-env-02',
    name: "碳管理与碳中和包",
    description: "企业碳管理部门、碳咨询公司、碳中和服务机构",
    tags: ["环保与碳中和"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-carbon-management", "dsh-plugin-carbon-consulting", "dsh-plugin-esg-reporting"],
    mcpServers: [
      { serverId: "carbon-factor-mcp", name: "carbon-factor-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "碳排放因子数据库接口，国家因子，区域因子，行业因子" },
      { serverId: "carbon-market-data-mcp", name: "carbon-market-data-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "碳市场数据接口，碳价行情，成交量，CCER 价格" },
      { serverId: "esg-database-mcp", name: "esg-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "ESG 数据库接口，评级数据，指标体系，行业基准" },
    ],
    skills: [
      { skillId: 'skill-env-02-carbon-inventory', name: "carbon-inventory", source: '', scope: 'user', optional: true },
      { skillId: 'skill-env-02-carbon-neutrality-roadmap', name: "carbon-neutrality-roadmap", source: '', scope: 'user', optional: true },
      { skillId: 'skill-env-02-esg-report-writing', name: "esg-report-writing", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-env-03',
    name: "循环经济与废弃物管理包",
    description: "废弃物处理企业、回收公司、环卫企业、循环经济园区",
    tags: ["环保与碳中和"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-waste-management", "dsh-plugin-recycling", "dsh-plugin-circular-economy"],
    mcpServers: [
      { serverId: "waste-facility-mcp", name: "waste-facility-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "废弃物处理设施接口，焚烧厂，填埋场，生化处理" },
      { serverId: "recycling-market-mcp", name: "recycling-market-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "再生资源市场接口，回收价格，供需信息，交易数据" },
      { serverId: "hazardous-waste-mcp", name: "hazardous-waste-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "危废管理接口，危废申报，转移联单，处置跟踪" },
    ],
    skills: [
      { skillId: 'skill-env-03-waste-collection-route', name: "waste-collection-route", source: '', scope: 'user', optional: true },
      { skillId: 'skill-env-03-recycling-business-model', name: "recycling-business-model", source: '', scope: 'user', optional: true },
      { skillId: 'skill-env-03-circular-economy-design', name: "circular-economy-design", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-pet-01',
    name: "宠物医院与诊疗包",
    description: "宠物医院、动物诊所、兽医诊疗机构",
    tags: ["宠物"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-veterinary-clinic", "dsh-plugin-pet-health-record", "dsh-plugin-veterinary-pharmacy"],
    mcpServers: [
      { serverId: "veterinary-database-mcp", name: "veterinary-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "兽医数据库接口，疾病库，药品库，诊疗指南" },
      { serverId: "lab-result-mcp", name: "lab-result-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "检验结果接口，血常规，生化，影像，病理" },
      { serverId: "pet-microchip-mcp", name: "pet-microchip-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "宠物芯片接口，芯片登记，信息查询，失宠寻找" },
    ],
    skills: [
      { skillId: 'skill-pet-01-veterinary-diagnosis', name: "veterinary-diagnosis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-pet-01-treatment-plan-pet', name: "treatment-plan-pet", source: '', scope: 'user', optional: true },
      { skillId: 'skill-pet-01-pet-surgery', name: "pet-surgery", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-pet-02',
    name: "宠物美容与寄养包",
    description: "宠物美容店、宠物寄养酒店、宠物生活馆",
    tags: ["宠物"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-pet-grooming", "dsh-plugin-pet-boarding", "dsh-plugin-pet-retail"],
    mcpServers: [
      { serverId: "pet-grooming-schedule-mcp", name: "pet-grooming-schedule-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "美容排期接口，预约管理，技师分配，服务记录" },
      { serverId: "pet-hotel-mcp", name: "pet-hotel-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "宠物酒店接口，房间管理，入住登记，护理记录" },
      { serverId: "pos-pet-mcp", name: "pos-pet-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "POS 收银接口，商品销售，会员积分，优惠券" },
    ],
    skills: [
      { skillId: 'skill-pet-02-pet-grooming-design', name: "pet-grooming-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-pet-02-pet-boarding-care', name: "pet-boarding-care", source: '', scope: 'user', optional: true },
      { skillId: 'skill-pet-02-pet-retail-merchandising', name: "pet-retail-merchandising", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-pet-03',
    name: "宠物训练与行为包",
    description: "宠物训练师、行为咨询师、训犬学校、宠物学校",
    tags: ["宠物"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-pet-training", "dsh-plugin-pet-behavior", "dsh-plugin-pet-competition"],
    mcpServers: [
      { serverId: "dog-training-mcp", name: "dog-training-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "训犬接口，训练方法，指令库，行为记录" },
      { serverId: "pet-behavior-mcp", name: "pet-behavior-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "宠物行为数据库，行为学资料，案例库，评估量表" },
      { serverId: "pet-competition-mcp", name: "pet-competition-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "宠物赛事接口，比赛信息，报名管理，成绩查询" },
    ],
    skills: [
      { skillId: 'skill-pet-03-dog-training-plan', name: "dog-training-plan", source: '', scope: 'user', optional: true },
      { skillId: 'skill-pet-03-pet-behavior-correction', name: "pet-behavior-correction", source: '', scope: 'user', optional: true },
      { skillId: 'skill-pet-03-pet-competition-prep', name: "pet-competition-prep", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-baby-01',
    name: "母婴护理与月子包",
    description: "月子中心、母婴护理机构、产后康复中心、月嫂公司",
    tags: ["母婴与育儿"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-postpartum-care", "dsh-plugin-newborn-care", "dsh-plugin-maternal-health"],
    mcpServers: [
      { serverId: "maternal-health-mcp", name: "maternal-health-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "产妇健康数据接口，体检数据，康复记录，心理评估" },
      { serverId: "baby-growth-mcp", name: "baby-growth-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "婴儿生长发育接口，身高体重，头围，发育里程碑" },
      { serverId: "nutrition-maternal-mcp", name: "nutrition-maternal-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "母婴营养数据库，月子餐谱，哺乳期营养，辅食添加" },
    ],
    skills: [
      { skillId: 'skill-baby-01-postpartum-care-plan', name: "postpartum-care-plan", source: '', scope: 'user', optional: true },
      { skillId: 'skill-baby-01-newborn-care-guide', name: "newborn-care-guide", source: '', scope: 'user', optional: true },
      { skillId: 'skill-baby-01-confinement-meal-planning', name: "confinement-meal-planning", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-baby-02',
    name: "早教与亲子包",
    description: "早教中心、亲子园、托育机构、儿童成长中心",
    tags: ["母婴与育儿"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-early-education", "dsh-plugin-parent-child", "dsh-plugin-child-development"],
    mcpServers: [
      { serverId: "early-childhood-mcp", name: "early-childhood-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "早教课程数据库，教案库，活动方案，教具清单" },
      { serverId: "child-assessment-mcp", name: "child-assessment-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "儿童评估量表接口，发育筛查，能力评估，气质类型" },
      { serverId: "parenting-resource-mcp", name: "parenting-resource-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "育儿资源接口，育儿知识，家长课程，专家问答" },
    ],
    skills: [
      { skillId: 'skill-baby-02-early-education-curriculum', name: "early-education-curriculum", source: '', scope: 'user', optional: true },
      { skillId: 'skill-baby-02-child-development-assessment', name: "child-development-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-baby-02-parenting-guidance', name: "parenting-guidance", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-baby-03',
    name: "母婴零售与电商包",
    description: "母婴店、母婴电商、母婴品牌、孕婴童连锁",
    tags: ["母婴与育儿"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-maternity-retail", "dsh-plugin-baby-products", "dsh-plugin-maternity-marketing"],
    mcpServers: [
      { serverId: "maternity-ecommerce-mcp", name: "maternity-ecommerce-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "母婴电商接口，商品上架，订单管理，客户服务" },
      { serverId: "baby-product-database-mcp", name: "baby-product-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "母婴产品数据库，产品信息，成分分析，安全评级" },
      { serverId: "maternity-community-mcp", name: "maternity-community-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "母婴社区接口，用户内容，问答互动，专家入驻" },
    ],
    skills: [
      { skillId: 'skill-baby-03-maternity-product-selection', name: "maternity-product-selection", source: '', scope: 'user', optional: true },
      { skillId: 'skill-baby-03-maternity-content-marketing', name: "maternity-content-marketing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-baby-03-maternity-member-operations', name: "maternity-member-operations", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-elder-01',
    name: "养老机构与照护包",
    description: "养老院、护理院、养老社区、长者照护中心",
    tags: ["养老与康养"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-elderly-care", "dsh-plugin-nursing-management", "dsh-plugin-elderly-health"],
    mcpServers: [
      { serverId: "ehr-elderly-mcp", name: "ehr-elderly-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "老人电子健康档案接口，病历数据，体检报告，用药记录" },
      { serverId: "care-plan-mcp", name: "care-plan-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "照护计划接口，评估量表，照护等级，服务清单" },
      { serverId: "smart-elderly-mcp", name: "smart-elderly-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "智慧养老接口，智能床垫，跌倒检测，定位手环，紧急呼叫" },
    ],
    skills: [
      { skillId: 'skill-elder-01-elderly-care-assessment', name: "elderly-care-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-elder-01-nursing-care-plan', name: "nursing-care-plan", source: '', scope: 'user', optional: true },
      { skillId: 'skill-elder-01-elderly-chronic-disease', name: "elderly-chronic-disease", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-elder-02',
    name: "居家养老与社区养老包",
    description: "居家养老服务公司、社区养老服务中心、养老驿站",
    tags: ["养老与康养"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-home-care", "dsh-plugin-community-elderly", "dsh-plugin-elderly-family"],
    mcpServers: [
      { serverId: "home-care-schedule-mcp", name: "home-care-schedule-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "居家养老排期接口，服务人员，服务项目，时间安排" },
      { serverId: "community-center-mcp", name: "community-center-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "社区养老中心接口，场地管理，活动管理，助餐管理" },
      { serverId: "family-communication-mcp", name: "family-communication-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "家属沟通接口，视频探视，消息推送，健康报告" },
    ],
    skills: [
      { skillId: 'skill-elder-02-home-care-service', name: "home-care-service", source: '', scope: 'user', optional: true },
      { skillId: 'skill-elder-02-community-elderly-activities', name: "community-elderly-activities", source: '', scope: 'user', optional: true },
      { skillId: 'skill-elder-02-elderly-family-communication', name: "elderly-family-communication", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-elder-03',
    name: "康复理疗与适老化包",
    description: "康复中心、老年康复机构、适老化改造公司、辅具公司",
    tags: ["养老与康养"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-elderly-rehab", "dsh-plugin-aging-in-place", "dsh-plugin-assistive-device"],
    mcpServers: [
      { serverId: "rehab-equipment-elderly-mcp", name: "rehab-equipment-elderly-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "老年康复设备接口，训练设备，评估设备，数据记录" },
      { serverId: "home-assessment-mcp", name: "home-assessment-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "居家环境评估接口，评估量表，风险识别，改造建议" },
      { serverId: "assistive-technology-mcp", name: "assistive-technology-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "辅助技术数据库，辅具产品，适配指南，使用说明" },
    ],
    skills: [
      { skillId: 'skill-elder-03-elderly-rehabilitation', name: "elderly-rehabilitation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-elder-03-aging-in-place-design', name: "aging-in-place-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-elder-03-assistive-device-prescription', name: "assistive-device-prescription", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-consult-01',
    name: "管理咨询与战略包",
    description: "管理咨询公司、战略咨询顾问、企业顾问",
    tags: ["咨询与专业服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-strategy-consulting", "dsh-plugin-management-consulting", "dsh-plugin-consulting-research"],
    mcpServers: [
      { serverId: "consulting-framework-mcp", name: "consulting-framework-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "咨询框架数据库，分析模型，方法论，工具模板" },
      { serverId: "industry-research-mcp", name: "industry-research-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "行业研究数据库，行业报告，市场数据，竞争情报" },
      { serverId: "consulting-document-mcp", name: "consulting-document-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "咨询文档接口，报告模板，PPT 模板，图表工具" },
    ],
    skills: [
      { skillId: 'skill-consult-01-strategy-analysis', name: "strategy-analysis", source: '', scope: 'user', optional: true },
      { skillId: 'skill-consult-01-organizational-design', name: "organizational-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-consult-01-business-process-optimization', name: "business-process-optimization", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-consult-02',
    name: "IT 咨询与数字化包",
    description: "IT 咨询公司、数字化转型顾问、信息化规划专家",
    tags: ["咨询与专业服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-digital-transformation", "dsh-plugin-it-consulting", "dsh-plugin-it-governance"],
    mcpServers: [
      { serverId: "enterprise-architecture-mcp", name: "enterprise-architecture-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "企业架构框架接口，TOGAF，业务架构，应用架构，数据架构，技术架构" },
      { serverId: "it-system-database-mcp", name: "it-system-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "IT 系统数据库，系统清单，功能对比，厂商信息，价格参考" },
      { serverId: "cybersecurity-framework-mcp", name: "cybersecurity-framework-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "网络安全框架接口，等保 2.0，ISO 27001，NIST，控制措施" },
    ],
    skills: [
      { skillId: 'skill-consult-02-digital-transformation-roadmap', name: "digital-transformation-roadmap", source: '', scope: 'user', optional: true },
      { skillId: 'skill-consult-02-it-system-selection', name: "it-system-selection", source: '', scope: 'user', optional: true },
      { skillId: 'skill-consult-02-it-governance-design', name: "it-governance-design", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-consult-03',
    name: "人力资源咨询包",
    description: "HR 咨询公司、组织发展顾问、人才管理专家",
    tags: ["咨询与专业服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-hr-consulting", "dsh-plugin-talent-management", "dsh-plugin-od-consulting"],
    mcpServers: [
      { serverId: "hr-benchmark-mcp", name: "hr-benchmark-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "HR 基准数据接口，薪酬调研，组织效能，人才指标" },
      { serverId: "competency-database-mcp", name: "competency-database-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "胜任力数据库，胜任力模型，行为指标，评估工具" },
      { serverId: "org-diagnosis-mcp", name: "org-diagnosis-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "组织诊断工具接口，诊断问卷，分析模型，报告模板" },
    ],
    skills: [
      { skillId: 'skill-consult-03-hr-system-design', name: "hr-system-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-consult-03-talent-review', name: "talent-review", source: '', scope: 'user', optional: true },
      { skillId: 'skill-consult-03-organizational-culture', name: "organizational-culture", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-acct-01',
    name: "会计核算与财务包",
    description: "会计师事务所、代理记账公司、企业财务部门",
    tags: ["会计审计与税务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-accounting", "dsh-plugin-financial-reporting", "dsh-plugin-bookkeeping"],
    mcpServers: [
      { serverId: "accounting-software-mcp", name: "accounting-software-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "财务软件接口（用友/金蝶/SAP/Oracle），凭证，账簿，报表" },
      { serverId: "invoice-mcp", name: "invoice-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "发票接口，发票识别，验真查重，进项销项，电子发票" },
      { serverId: "bank-statement-mcp", name: "bank-statement-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "银行流水接口，对账单，交易明细，对账核销" },
    ],
    skills: [
      { skillId: 'skill-acct-01-financial-statement-preparation', name: "financial-statement-preparation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-acct-01-month-end-close', name: "month-end-close", source: '', scope: 'user', optional: true },
      { skillId: 'skill-acct-01-financial-analysis', name: "financial-analysis", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-acct-02',
    name: "审计与内控包",
    description: "审计师事务所、内部审计部门、内控咨询公司",
    tags: ["会计审计与税务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-audit-management", "dsh-plugin-internal-control", "dsh-plugin-audit-reporting"],
    mcpServers: [
      { serverId: "audit-working-paper-mcp", name: "audit-working-paper-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "审计工作底稿接口，底稿模板，索引编号，复核记录" },
      { serverId: "internal-control-framework-mcp", name: "internal-control-framework-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "内控框架接口，COSO，企业内部控制基本规范，控制矩阵" },
      { serverId: "audit-evidence-mcp", name: "audit-evidence-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "审计证据接口，函证，盘点，检查，观察，询问，分析程序" },
    ],
    skills: [
      { skillId: 'skill-acct-02-audit-planning', name: "audit-planning", source: '', scope: 'user', optional: true },
      { skillId: 'skill-acct-02-substantive-testing', name: "substantive-testing", source: '', scope: 'user', optional: true },
      { skillId: 'skill-acct-02-internal-control-evaluation', name: "internal-control-evaluation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-acct-03',
    name: "税务筹划与合规包",
    description: "税务师事务所、税务咨询公司、企业税务部门",
    tags: ["会计审计与税务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-tax-planning", "dsh-plugin-tax-compliance", "dsh-plugin-tax-consulting"],
    mcpServers: [
      { serverId: "tax-policy-mcp", name: "tax-policy-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "税收政策数据库接口，法律法规，政策文件，解读分析" },
      { serverId: "tax-filing-mcp", name: "tax-filing-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "纳税申报接口，电子税务局，申报表单，申报数据" },
      { serverId: "transfer-pricing-mcp", name: "transfer-pricing-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "转让定价接口，可比性分析，基准研究，文档要求" },
    ],
    skills: [
      { skillId: 'skill-acct-03-tax-planning-scheme', name: "tax-planning-scheme", source: '', scope: 'user', optional: true },
      { skillId: 'skill-acct-03-tax-risk-assessment', name: "tax-risk-assessment", source: '', scope: 'user', optional: true },
      { skillId: 'skill-acct-03-tax-dispute-resolution', name: "tax-dispute-resolution", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-trans-01',
    name: "翻译服务与项目包",
    description: "翻译公司、翻译团队、自由译者、本地化公司",
    tags: ["翻译与本地化"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-translation-project", "dsh-plugin-translation-memory", "dsh-plugin-translation-quality"],
    mcpServers: [
      { serverId: "cat-tool-mcp", name: "cat-tool-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "CAT 工具接口（Trados/memoQ/Wordfast），项目文件，翻译记忆，术语库" },
      { serverId: "machine-translation-mcp", name: "machine-translation-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "机器翻译接口（DeepL/Google/百度/有道），MT 翻译，译后编辑" },
      { serverId: "terminology-mcp", name: "terminology-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "术语库接口，术语管理，术语提取，术语一致性" },
    ],
    skills: [
      { skillId: 'skill-trans-01-translation-project-management', name: "translation-project-management", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trans-01-translation-quality-assurance', name: "translation-quality-assurance", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trans-01-localization-engineering', name: "localization-engineering", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-trans-02',
    name: "本地化与国际化包",
    description: "软件本地化公司、游戏本地化、网站本地化、产品国际化团队",
    tags: ["翻译与本地化"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-software-localization", "dsh-plugin-website-localization", "dsh-plugin-game-localization"],
    mcpServers: [
      { serverId: "i18n-framework-mcp", name: "i18n-framework-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "国际化框架接口（i18next/react-intl/vue-i18n），资源管理，语言切换" },
      { serverId: "cms-multilingual-mcp", name: "cms-multilingual-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "多语言 CMS 接口，内容管理，多语言发布，翻译工作流" },
      { serverId: "game-localization-mcp", name: "game-localization-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "游戏本地化接口，文本提取，字符串管理，文化适配检查" },
    ],
    skills: [
      { skillId: 'skill-trans-02-software-localization-process', name: "software-localization-process", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trans-02-cultural-adaptation', name: "cultural-adaptation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trans-02-multilingual-seo', name: "multilingual-seo", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-trans-03',
    name: "口译与会议服务包",
    description: "口译公司、会议服务公司、同传译员、交传译员",
    tags: ["翻译与本地化"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-consecutive-interpreting", "dsh-plugin-simultaneous-interpreting", "dsh-plugin-conference-services"],
    mcpServers: [
      { serverId: "conference-management-mcp", name: "conference-management-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "会议管理接口，会议日程，参会人员，会议资料" },
      { serverId: "interpreting-equipment-mcp", name: "interpreting-equipment-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "口译设备接口，同传设备，导览设备，投票设备" },
      { serverId: "speech-to-text-mcp", name: "speech-to-text-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "语音转文字接口，实时转写，会议记录，字幕生成" },
    ],
    skills: [
      { skillId: 'skill-trans-03-conference-preparation', name: "conference-preparation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trans-03-simultaneous-interpreting', name: "simultaneous-interpreting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-trans-03-conference-service-planning', name: "conference-service-planning", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-wed-01',
    name: "婚礼策划与执行包",
    description: "婚礼策划公司、婚礼策划师、婚庆工作室",
    tags: ["婚庆与礼仪"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-wedding-planning", "dsh-plugin-wedding-execution", "dsh-plugin-wedding-vendor"],
    mcpServers: [
      { serverId: "wedding-venue-mcp", name: "wedding-venue-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "婚礼场地接口，场地信息，档期查询，价格查询，预订管理" },
      { serverId: "wedding-vendor-mcp", name: "wedding-vendor-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "婚礼供应商数据库，供应商信息，服务项目，评价评分，案例展示" },
      { serverId: "wedding-inspiration-mcp", name: "wedding-inspiration-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "婚礼灵感库，风格参考，配色方案，花艺设计，布置案例" },
    ],
    skills: [
      { skillId: 'skill-wed-01-wedding-concept-design', name: "wedding-concept-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-wed-01-wedding-budget-planning', name: "wedding-budget-planning", source: '', scope: 'user', optional: true },
      { skillId: 'skill-wed-01-wedding-day-coordination', name: "wedding-day-coordination", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-wed-02',
    name: "婚纱摄影与影像包",
    description: "婚纱摄影工作室、摄影团队、影像制作公司",
    tags: ["婚庆与礼仪"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-wedding-photography", "dsh-plugin-photo-retouching", "dsh-plugin-wedding-video"],
    mcpServers: [
      { serverId: "photo-management-mcp", name: "photo-management-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "照片管理接口，图库管理，相册制作，在线选片" },
      { serverId: "photo-editing-mcp", name: "photo-editing-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "照片编辑接口，批量处理，滤镜预设，AI 修图" },
      { serverId: "video-editing-mcp", name: "video-editing-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "视频编辑接口，剪辑软件，素材管理，特效模板" },
    ],
    skills: [
      { skillId: 'skill-wed-02-wedding-photography-plan', name: "wedding-photography-plan", source: '', scope: 'user', optional: true },
      { skillId: 'skill-wed-02-photo-retouching-workflow', name: "photo-retouching-workflow", source: '', scope: 'user', optional: true },
      { skillId: 'skill-wed-02-wedding-film-production', name: "wedding-film-production", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-wed-03',
    name: "庆典礼仪与活动包",
    description: "庆典公司、礼仪公司、活动策划公司、商业活动团队",
    tags: ["婚庆与礼仪"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-ceremony-planning", "dsh-plugin-protocol-etiquette", "dsh-plugin-corporate-event"],
    mcpServers: [
      { serverId: "event-venue-mcp", name: "event-venue-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "活动场地接口，酒店，会议中心，展览场馆，户外场地" },
      { serverId: "event-supplier-mcp", name: "event-supplier-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "活动供应商数据库，搭建，灯光音响，演艺，主持" },
      { serverId: "event-registration-mcp", name: "event-registration-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "活动报名接口，签到管理，票务销售，嘉宾管理" },
    ],
    skills: [
      { skillId: 'skill-wed-03-ceremony-ritual-design', name: "ceremony-ritual-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-wed-03-corporate-annual-meeting', name: "corporate-annual-meeting", source: '', scope: 'user', optional: true },
      { skillId: 'skill-wed-03-product-launch-event', name: "product-launch-event", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-beauty-01',
    name: "美容护肤与皮肤管理包",
    description: "美容院、皮肤管理中心、医美机构、护肤工作室",
    tags: ["美容美业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-skin-management", "dsh-plugin-beauty-treatment", "dsh-plugin-skincare-product"],
    mcpServers: [
      { serverId: "skin-analysis-mcp", name: "skin-analysis-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "皮肤检测接口，皮肤检测仪，AI 肤诊，检测报告" },
      { serverId: "skincare-ingredient-mcp", name: "skincare-ingredient-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "护肤成分数据库，成分功效，安全性，搭配禁忌，敏感风险" },
      { serverId: "beauty-device-mcp", name: "beauty-device-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "美容设备接口，光电设备，射频仪，水光仪，操作记录" },
    ],
    skills: [
      { skillId: 'skill-beauty-01-skin-analysis-report', name: "skin-analysis-report", source: '', scope: 'user', optional: true },
      { skillId: 'skill-beauty-01-facial-treatment-plan', name: "facial-treatment-plan", source: '', scope: 'user', optional: true },
      { skillId: 'skill-beauty-01-skincare-product-recommendation', name: "skincare-product-recommendation", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-beauty-02',
    name: "美发造型与美甲包",
    description: "美发沙龙、美甲店、美睫店、造型工作室",
    tags: ["美容美业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-hair-salon", "dsh-plugin-nail-art", "dsh-plugin-beauty-booking"],
    mcpServers: [
      { serverId: "hair-color-mcp", name: "hair-color-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "染发配方接口，色板，配方库，调色计算，效果预览" },
      { serverId: "nail-design-mcp", name: "nail-design-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "美甲设计库，款式图库，教程，素材，灵感" },
      { serverId: "salon-booking-mcp", name: "salon-booking-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "美业预约系统接口，在线预约，排班管理，会员管理" },
    ],
    skills: [
      { skillId: 'skill-beauty-02-hair-style-design', name: "hair-style-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-beauty-02-nail-art-design', name: "nail-art-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-beauty-02-salon-operations', name: "salon-operations", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-beauty-03',
    name: "医美与轻医美包",
    description: "医美机构、轻医美诊所、皮肤医美中心、医疗美容医院",
    tags: ["美容美业"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-medical-aesthetics", "dsh-plugin-aesthetics-consultation", "dsh-plugin-aesthetics-aftercare"],
    mcpServers: [
      { serverId: "aesthetics-project-mcp", name: "aesthetics-project-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "医美项目数据库，项目信息，适应症，禁忌症，价格，恢复期" },
      { serverId: "before-after-photo-mcp", name: "before-after-photo-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "术前术后照片接口，照片管理，对比分析，效果评估" },
      { serverId: "medical-record-mcp", name: "medical-record-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "医美病历接口，电子病历，诊疗记录，知情同意，处方管理" },
    ],
    skills: [
      { skillId: 'skill-beauty-03-aesthetics-consultation-design', name: "aesthetics-consultation-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-beauty-03-aesthetics-treatment-plan', name: "aesthetics-treatment-plan", source: '', scope: 'user', optional: true },
      { skillId: 'skill-beauty-03-aesthetics-post-care', name: "aesthetics-post-care", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-funeral-01',
    name: "殡葬服务与礼仪包",
    description: "殡仪馆、殡葬服务公司、礼仪服务公司、陵园",
    tags: ["殡葬与生命服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-funeral-service", "dsh-plugin-funeral-ritual", "dsh-plugin-funeral-products"],
    mcpServers: [
      { serverId: "funeral-home-mcp", name: "funeral-home-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "殡仪馆接口，厅房管理，火化预约，服务项目，价格查询" },
      { serverId: "cemetery-mcp", name: "cemetery-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "陵园接口，墓位管理，选墓系统，价格查询，预约祭扫" },
      { serverId: "funeral-product-mcp", name: "funeral-product-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "殡葬用品数据库，产品信息，材质工艺，价格，定制服务" },
    ],
    skills: [
      { skillId: 'skill-funeral-01-funeral-service-planning', name: "funeral-service-planning", source: '', scope: 'user', optional: true },
      { skillId: 'skill-funeral-01-memorial-ceremony-design', name: "memorial-ceremony-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-funeral-01-funeral-ritual-etiquette', name: "funeral-ritual-etiquette", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-funeral-02',
    name: "陵园与墓地管理包",
    description: "陵园公司、公墓管理处、墓地销售、殡葬地产",
    tags: ["殡葬与生命服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-cemetery-sales", "dsh-plugin-cemetery-management", "dsh-plugin-memorial-architecture"],
    mcpServers: [
      { serverId: "cemetery-gis-mcp", name: "cemetery-gis-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "陵园 GIS 接口，墓区地图，墓位定位，选墓可视化" },
      { serverId: "tombstone-design-mcp", name: "tombstone-design-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "墓碑设计库，款式图库，材质工艺，雕刻图案，定制设计" },
      { serverId: "cemetery-maintenance-mcp", name: "cemetery-maintenance-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "陵园维护接口，绿化养护，清洁管理，维修记录，巡检管理" },
    ],
    skills: [
      { skillId: 'skill-funeral-02-cemetery-sales-consultation', name: "cemetery-sales-consultation", source: '', scope: 'user', optional: true },
      { skillId: 'skill-funeral-02-tombstone-custom-design', name: "tombstone-custom-design", source: '', scope: 'user', optional: true },
      { skillId: 'skill-funeral-02-cemetery-operations-management', name: "cemetery-operations-management", source: '', scope: 'user', optional: true },
    ]
  },
  {
    id: 'bundle-funeral-03',
    name: "生命教育与哀伤辅导包",
    description: "生命教育机构、哀伤辅导中心、心理咨询机构、临终关怀机构",
    tags: ["殡葬与生命服务"],
    mode: 'preset',
    minDshVersion: '*',
    maxDshVersion: '',
    recommendPreset: '',
    version: '1.0.0',
    createTime: '2026-09-04',
    plugins: ["dsh-plugin-life-education", "dsh-plugin-grief-counseling", "dsh-plugin-hospice-care"],
    mcpServers: [
      { serverId: "grief-assessment-mcp", name: "grief-assessment-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "哀伤评估接口，评估量表，阶段判断，风险筛查" },
      { serverId: "life-education-resource-mcp", name: "life-education-resource-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "生命教育资源库，课程教案，活动方案，绘本影视" },
      { serverId: "hospice-care-mcp", name: "hospice-care-mcp", transport: 'stdio', command: '', args: [], envKeys: [], optional: true, description: "临终关怀接口，安宁疗护指南，疼痛管理，心理支持" },
    ],
    skills: [
      { skillId: 'skill-funeral-03-life-education-curriculum', name: "life-education-curriculum", source: '', scope: 'user', optional: true },
      { skillId: 'skill-funeral-03-grief-counseling-session', name: "grief-counseling-session", source: '', scope: 'user', optional: true },
      { skillId: 'skill-funeral-03-hospice-care-plan', name: "hospice-care-plan", source: '', scope: 'user', optional: true },
    ]
  },

]

let seeded = false

/** 幂等写入 5 个官方组合包（重复调用零副作用） */
export function seedBundles(db: Database.Database): void {
  if (seeded) return
  const insertBundle = db.prepare(
    'INSERT OR IGNORE INTO bundles ' +
    '(id, name, description, tags, mode, min_dsh_version, max_dsh_version, recommend_preset, version, create_time) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const insertPlugin = db.prepare(
    'INSERT OR IGNORE INTO bundle_plugins (bundle_id, plugin_ref, required) VALUES (?, ?, ?)'
  )
  const insertMcp = db.prepare(
    'INSERT OR IGNORE INTO bundle_mcp_servers ' +
    '(bundle_id, server_id, name, transport, command, args, env_keys, optional, description) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const insertSkill = db.prepare(
    'INSERT OR IGNORE INTO bundle_skills (bundle_id, skill_id, name, source, scope, optional) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const run = db.transaction(() => {
    for (const b of OFFICIAL_BUNDLES) {
      insertBundle.run(
        b.id,
        b.name,
        b.description,
        JSON.stringify(b.tags),
        b.mode,
        b.minDshVersion,
        b.maxDshVersion,
        b.recommendPreset,
        b.version,
        b.createTime
      )
      for (const p of b.plugins) insertPlugin.run(b.id, p, 1)
      for (const m of b.mcpServers) {
        insertMcp.run(
          b.id,
          m.serverId,
          m.name,
          m.transport,
          m.command,
          JSON.stringify(m.args),
          JSON.stringify(m.envKeys),
          m.optional ? 1 : 0,
          m.description
        )
      }
      for (const s of b.skills) {
        insertSkill.run(b.id, s.skillId, s.name, s.source, s.scope, s.optional ? 1 : 0)
      }
    }
  })
  run()
  seeded = true
}

// ---------- 行类型与聚合（DB snake_case → API camelCase） ----------

export interface BundleRow {
  id: string
  name: string
  description: string
  tags: string
  mode: string
  min_dsh_version: string
  max_dsh_version: string
  recommend_preset: string
  version: string
  create_time: string
  /* Market V3：社区化 + 计费 + 审核（ALTER TABLE 补列后才有，老库可能为 undefined） */
  source?: string
  author?: string | null
  author_id?: string | null
  share_time?: string | null
  base_bundle_id?: string | null
  review_status?: string
  package_price_cents?: number | null
  commission_rate?: number | null
  pay_channel?: string | null
}

export interface BundlePluginRow {
  plugin_ref: string
  required: number
  description?: string | null
  billing?: 'free' | 'paid'
  price_cents?: number | null
}

export interface BundleMcpServerRow {
  server_id: string
  name: string
  transport: string
  command: string
  args: string
  env_keys: string
  optional: number
  description: string
  brief?: string | null
  billing?: 'free' | 'paid'
  price_cents?: number | null
  billing_cycle?: string
}

export interface BundleSkillRow {
  skill_id: string
  name: string
  source: string
  scope: string
  optional: number
  description?: string | null
  billing?: 'free' | 'paid'
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** 把 bundles 主表行 + 三张子表聚合成一个完整的 Bundle 对象（camelCase） */
export function buildBundle(db: Database.Database, row: BundleRow) {
  const plugins = db.prepare(
    'SELECT plugin_ref, required, description, billing, price_cents FROM bundle_plugins WHERE bundle_id = ? ORDER BY rowid ASC'
  ).all(row.id) as unknown as BundlePluginRow[]
  const mcpServers = db.prepare(
    'SELECT server_id, name, transport, command, args, env_keys, optional, description, brief, billing, price_cents, billing_cycle FROM bundle_mcp_servers WHERE bundle_id = ? ORDER BY rowid ASC'
  ).all(row.id) as unknown as BundleMcpServerRow[]
  const skills = db.prepare(
    'SELECT skill_id, name, source, scope, optional, description, billing FROM bundle_skills WHERE bundle_id = ? ORDER BY rowid ASC'
  ).all(row.id) as unknown as BundleSkillRow[]

  const paidCount =
    plugins.filter((p) => p.billing === 'paid').length +
    mcpServers.filter((m) => m.billing === 'paid').length +
    skills.filter((s) => s.billing === 'paid').length

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: parseJsonArray(row.tags),
    mode: row.mode,
    minDshVersion: row.min_dsh_version,
    maxDshVersion: row.max_dsh_version,
    recommendPreset: row.recommend_preset,
    version: row.version,
    createTime: row.create_time,
    plugins: plugins.map((p) => ({
      pluginRef: p.plugin_ref,
      required: !!p.required,
      description: (p as any).description ?? null,
      billing: ((p as any).billing as 'free' | 'paid') ?? 'free',
      priceCents: (p as any).price_cents ?? null,
    })),
    mcpServers: mcpServers.map((m) => ({
      serverId: m.server_id,
      name: m.name,
      transport: m.transport,
      command: m.command,
      args: parseJsonArray(m.args),
      envKeys: parseJsonArray(m.env_keys),
      optional: !!m.optional,
      description: m.description,
      brief: (m as any).brief ?? m.description ?? null,
      billing: ((m as any).billing as 'free' | 'paid') ?? 'free',
      priceCents: (m as any).price_cents ?? null,
      billingCycle: (m as any).billing_cycle ?? undefined,
    })),
    skills: skills.map((s) => ({
      skillId: s.skill_id,
      name: s.name,
      source: s.source,
      scope: s.scope,
      optional: !!s.optional,
      description: (s as any).description ?? null,
      billing: ((s as any).billing as 'free' | 'paid') ?? 'free',
    })),
    /* ---- Market V3：社区化 + 计费预留（官方包缺省值） ---- */
    source: row.source || 'official',
    author: row.author ?? null,
    authorId: row.author_id ?? null,
    shareTime: row.share_time ?? null,
    baseBundleId: row.base_bundle_id ?? null,
    paidCount,
    reviewStatus: row.review_status || 'reviewed',
    pricing: row.package_price_cents
      ? {
          hasPaidItems: paidCount > 0,
          packagePriceCents: row.package_price_cents,
          cycle: 'once' as const,
          commissionRate: row.commission_rate ?? null,
          channel: row.pay_channel ?? null,
        }
      : null,
  }
}
