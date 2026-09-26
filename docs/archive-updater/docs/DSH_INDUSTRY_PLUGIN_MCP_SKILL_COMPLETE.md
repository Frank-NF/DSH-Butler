# DSH 各行业插件 / MCP / Skill 组合包大全（完整版）

> 版本：v2.0.0（完整版）  
> 日期：2026-09-04  
> 说明：本文档按行业分类整理 DSH Agent 生态所需的插件（Plugin）、MCP 服务器（Model Context Protocol）和技能包（Skill），覆盖 30 个行业、94 个组合包。每个组合包可独立安装使用，也可组合叠加。

---

## 目录

- [通用基础组合包（所有行业必备）](#通用基础组合包所有行业必备)
- [1. 医疗健康行业](#1-医疗健康行业)
- [2. 法律合规行业](#2-法律合规行业)
- [3. 金融财经行业](#3-金融财经行业)
- [4. 教育培训行业](#4-教育培训行业)
- [5. 电商零售行业](#5-电商零售行业)
- [6. 制造业 / 工业](#6-制造业--工业)
- [7. 房地产 / 建筑](#7-房地产--建筑)
- [8. 媒体 / 内容创作](#8-媒体--内容创作)
- [9. 政府 / 公共服务](#9-政府--公共服务)
- [10. IT / 软件开发](#10-it--软件开发)
- [11. 农业](#11-农业)
- [12. 物流 / 供应链](#12-物流--供应链)
- [13. 旅游 / 酒店](#13-旅游--酒店)
- [14. 餐饮行业](#14-餐饮行业)
- [15. 人力资源](#15-人力资源)
- [16. 汽车行业](#16-汽车行业)
- [17. 能源与公用事业](#17-能源与公用事业)
- [18. 体育与健身](#18-体育与健身)
- [19. 文化艺术与文博](#19-文化艺术与文博)
- [20. 游戏与电竞](#20-游戏与电竞)
- [21. 环保与碳中和](#21-环保与碳中和)
- [22. 宠物行业](#22-宠物行业)
- [23. 母婴与育儿](#23-母婴与育儿)
- [24. 养老与康养](#24-养老与康养)
- [25. 咨询与专业服务](#25-咨询与专业服务)
- [26. 会计审计与税务](#26-会计审计与税务)
- [27. 翻译与本地化](#27-翻译与本地化)
- [28. 婚庆与礼仪](#28-婚庆与礼仪)
- [29. 美容美业](#29-美容美业)
- [30. 殡葬与生命服务](#30-殡葬与生命服务)
- [组合包安装配置指南](#组合包安装配置指南)
- [全行业组合包总览](#全行业组合包总览)

---
# DSH 各行业插件 / MCP / Skill 组合包大全

> 版本：v1.0.0  
> 日期：2026-09-04  
> 说明：本文档按行业分类整理 DSH Agent 生态所需的插件（Plugin）、MCP 服务器（Model Context Protocol）和技能包（Skill），每个组合包可独立安装使用，也可组合叠加。

---

## 目录

- [通用基础组合包（所有行业必备）](#通用基础组合包所有行业必备)
- [1. 医疗健康行业](#1-医疗健康行业)
- [2. 法律合规行业](#2-法律合规行业)
- [3. 金融财经行业](#3-金融财经行业)
- [4. 教育培训行业](#4-教育培训行业)
- [5. 电商零售行业](#5-电商零售行业)
- [6. 制造业 / 工业](#6-制造业--工业)
- [7. 房地产 / 建筑](#7-房地产--建筑)
- [8. 媒体 / 内容创作](#8-媒体--内容创作)
- [9. 政府 / 公共服务](#9-政府--公共服务)
- [10. IT / 软件开发](#10-it--软件开发)
- [11. 农业](#11-农业)
- [12. 物流 / 供应链](#12-物流--供应链)
- [13. 旅游 / 酒店](#13-旅游--酒店)
- [14. 餐饮行业](#14-餐饮行业)
- [15. 人力资源](#15-人力资源)
- [组合包安装配置指南](#组合包安装配置指南)

---

## 通用基础组合包（所有行业必备）

### 组合包 G-01：文件与办公基础包

**适用场景：** 所有行业的日常办公、文档处理、数据表格操作

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-filesystem` | 本地文件系统操作，文件读写、目录管理、搜索 |
| 插件 | `dsh-plugin-office` | Office 文档处理（Word/Excel/PPT/PDF） |
| 插件 | `dsh-plugin-clipboard` | 剪贴板管理，文本/图片/文件复制粘贴 |
| MCP | `filesystem` | 官方文件系统 MCP，安全的文件读写访问 |
| MCP | `excel-mcp` | Excel 工作簿读写、公式计算、图表生成、数据透视 |
| MCP | `pptx-mcp` | PowerPoint 演示文稿创建与编辑 |
| MCP | `pdf-mcp` | PDF 读取、提取、合并、拆分、表单填写 |
| Skill | `document-processing` | 文档解析、格式转换、内容提取、摘要生成 |
| Skill | `data-analysis-basic` | 表格数据清洗、统计分析、图表生成 |
| Skill | `report-generation` | 报告模板填充、自动排版、导出多格式 |

---

### 组合包 G-02：网络与信息检索包

**适用场景：** 所有行业的信息搜集、网页浏览、数据采集

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-browser` | 浏览器自动化，网页操作、表单填写、截图 |
| 插件 | `dsh-plugin-web-search` | 多搜索引擎集成（百度/谷歌/Bing） |
| 插件 | `dsh-plugin-rss` | RSS 订阅管理，资讯聚合 |
| MCP | `firecrawl-mcp` | 网页爬取、站点地图、结构化数据提取 |
| MCP | `fetch-mcp` | 网页内容获取，转 Markdown 格式 |
| MCP | `brave-search-mcp` | Brave 搜索引擎 API 集成 |
| Skill | `web-research` | 主题研究、多源信息整合、来源标注 |
| Skill | `data-scraping` | 网页数据采集、结构化提取、去重清洗 |
| Skill | `competitor-monitor` | 竞品网站监控、变更检测、差异报告 |

---

### 组合包 G-03：通信与协作包

**适用场景：** 所有行业的团队协作、消息通知、会议管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-email` | 邮件收发、模板管理、自动回复、附件处理 |
| 插件 | `dsh-plugin-calendar` | 日历管理、日程安排、会议预约、提醒 |
| 插件 | `dsh-plugin-notification` | 系统通知、桌面弹窗、声音提醒 |
| MCP | `gmail-mcp` | Gmail 邮件操作（读取/发送/搜索/标签） |
| MCP | `slack-mcp` | Slack 消息发送、频道管理、文件分享 |
| MCP | `notion-mcp` | Notion 页面/数据库读写、内容管理 |
| MCP | `google-calendar-mcp` | Google 日历事件管理 |
| Skill | `meeting-notes` | 会议记录整理、待办提取、行动项分配 |
| Skill | `email-drafting` | 邮件撰写、语气调整、多语言翻译 |
| Skill | `task-management` | 任务创建、优先级排序、进度跟踪、到期提醒 |

---

### 组合包 G-04：数据与数据库包

**适用场景：** 所有行业的数据存储、查询、分析、可视化

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-database` | 多数据库连接管理，SQL 执行，数据浏览 |
| 插件 | `dsh-plugin-chart` | 数据可视化，图表生成（柱状/折线/饼图/热力图） |
| MCP | `postgres-mcp` | PostgreSQL 数据库连接、Schema 检查、安全查询 |
| MCP | `sqlite-mcp` | SQLite 数据库操作，内置分析功能 |
| MCP | `duckdb-mcp` | DuckDB 列式数据库，高性能分析查询 |
| MCP | `mysql-mcp` | MySQL 数据库连接与操作 |
| MCP | `bigquery-mcp` | Google BigQuery 数据仓库查询 |
| Skill | `sql-generation` | 自然语言转 SQL，查询优化，结果解释 |
| Skill | `data-modeling` | 表结构设计、ER 图生成、索引优化建议 |
| Skill | `etl-pipeline` | 数据抽取、转换、加载，数据清洗流水线 |

---

## 1. 医疗健康行业

### 组合包 MED-01：临床文档与病历管理包

**适用场景：** 医院、诊所、口腔门诊的病历书写、临床文档管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-medical-record` | 电子病历模板管理，病历书写辅助，结构化录入 |
| 插件 | `dsh-plugin-medical-terminology` | 医学术语库，ICD-10/CPT 编码查询，术语标准化 |
| 插件 | `dsh-plugin-voice-input` | 语音转文字，门诊对话录音，实时转写 |
| MCP | `fhir-mcp` | FHIR 医疗数据标准接口，患者数据查询 |
| MCP | `medical-literature-mcp` | PubMed/医学文献检索，论文摘要获取 |
| MCP | `ehr-mcp` | 电子健康记录系统集成，患者信息读取 |
| Skill | `clinical-note-generation` | 门诊病历自动生成，SOAP 格式整理，主诉/现病史/查体/诊断 |
| Skill | `medical-coding` | ICD-10 诊断编码、CPT 操作编码自动匹配 |
| Skill | `dental-chart` | 口腔牙位图记录，治疗计划生成，收费项目关联 |

---

### 组合包 MED-02：健康管理与慢病跟踪包

**适用场景：** 健康管理公司、体检中心、慢病管理机构

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-health-data` | 健康数据采集，体检报告解析，指标跟踪 |
| 插件 | `dsh-plugin-wearable` | 可穿戴设备数据同步（手环/血压计/血糖仪） |
| 插件 | `dsh-plugin-diet-nutrition` | 饮食记录，营养计算，膳食建议 |
| MCP | `health-kit-mcp` | 健康数据平台接口，体检数据导入 |
| MCP | `drug-database-mcp` | 药品数据库查询，说明书获取，相互作用检查 |
| MCP | `lab-result-mcp` | 检验报告解析，指标异常标记，参考范围对比 |
| Skill | `health-assessment` | 健康风险评估，体检报告解读，异常指标分析 |
| Skill | `chronic-disease-management` | 高血压/糖尿病/高血脂慢病管理计划，用药提醒，复查跟踪 |
| Skill | `diet-plan-generation` | 个性化饮食方案生成，营养配比计算，食谱推荐 |

---

### 组合包 MED-03：医疗营销与患者运营包

**适用场景：** 民营医院、口腔门诊、医美机构的患者获客与运营

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-patient-crm` | 患者客户管理，就诊记录，消费历史，跟进记录 |
| 插件 | `dsh-plugin-medical-marketing` | 医疗营销内容生成，科普文章，短视频脚本 |
| 插件 | `dsh-plugin-appointment` | 预约挂号管理，排班设置，到诊提醒 |
| MCP | `wechat-mcp` | 微信公众号/企业微信消息推送，客户管理 |
| MCP | `douyin-mcp` | 抖音短视频发布，评论管理，数据统计 |
| MCP | `xiaohongshu-mcp` | 小红书笔记发布，互动管理 |
| Skill | `patient-follow-up` | 术后/治疗后随访，恢复情况跟踪，满意度调查 |
| Skill | `medical-content-marketing` | 医疗科普内容创作，选题策划，多平台分发 |
| Skill | `conversion-optimization` | 咨询到诊转化分析，话术优化，复购提升方案 |

---

## 2. 法律合规行业

### 组合包 LAW-01：合同审查与起草包

**适用场景：** 律师事务所、企业法务部门的合同管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-contract-review` | 合同审查，风险条款识别，修改建议，批注生成 |
| 插件 | `dsh-plugin-contract-template` | 合同模板库管理，模板填充，版本对比 |
| 插件 | `dsh-plugin-legal-research` | 法律检索，法条查询，案例检索 |
| MCP | `westlaw-mcp` | Westlaw 法律数据库检索（英美法） |
| MCP | `pku-law-mcp` | 北大法宝法律数据库（中国法） |
| MCP | `sec-edgar-mcp` | SEC EDGAR 上市公司文件检索 |
| Skill | `contract-risk-assessment` | 合同风险评级，风险点清单，修改建议优先级 |
| Skill | `contract-drafting` | 根据交易要点起草合同，条款生成，风险规避 |
| Skill | `contract-comparison` | 合同版本对比，变更点识别，差异分析报告 |

---

### 组合包 LAW-02：诉讼与案件管理包

**适用场景：** 诉讼律师、律所案件管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-case-management` | 案件管理，当事人信息，证据目录，时间线 |
| 插件 | `dsh-plugin-legal-document` | 法律文书生成，起诉状/答辩状/代理词模板 |
| 插件 | `dsh-plugin-evidence` | 证据管理，证据编号，证明目的，质证意见 |
| MCP | `court-document-mcp` | 裁判文书网检索，判例查询 |
| MCP | `docket-mcp` | 案件 docket 查询，开庭信息，法院公告 |
| Skill | `legal-research-deep` | 类案检索，裁判规则提炼，胜诉率分析 |
| Skill | `legal-document-drafting` | 法律文书起草，事实陈述，法律适用，论证逻辑 |
| Skill | `trial-preparation` | 庭审准备，争议焦点归纳，质证提纲，辩论要点 |

---

### 组合包 LAW-03：合规与风控包

**适用场景：** 企业合规部门、风控部门、合规咨询

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-compliance-check` | 合规检查清单，合规风险识别，整改建议 |
| 插件 | `dsh-plugin-policy-management` | 公司政策制度管理，制度起草，版本控制 |
| 插件 | `dsh-plugin-risk-assessment` | 风险评估矩阵，风险等级评定，应对措施 |
| MCP | `regulation-mcp` | 监管法规数据库，新规监测，合规要求提取 |
| MCP | `sanction-list-mcp` | 制裁名单筛查，反洗钱名单查询 |
| MCP | `gdpr-mcp` | GDPR 数据保护合规检查 |
| Skill | `compliance-audit` | 合规审计执行，问题发现，整改跟踪，审计报告 |
| Skill | `policy-drafting` | 合规政策起草，制度体系设计，流程优化 |
| Skill | `regulatory-monitoring` | 监管动态跟踪，新规影响评估，合规更新建议 |

---

## 3. 金融财经行业

### 组合包 FIN-01：投资研究与分析包

**适用场景：** 券商、基金、投资机构的投研工作

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-stock-analysis` | 股票分析，行情数据，技术指标，基本面分析 |
| 插件 | `dsh-plugin-financial-data` | 财务数据获取，三大报表，财务比率计算 |
| 插件 | `dsh-plugin-research-report` | 研报管理，研报解析，观点提取 |
| MCP | `yfinance-mcp` | Yahoo Finance 行情数据获取 |
| MCP | `sec-edgar-mcp` | SEC EDGAR 财报检索，10-K/10-Q 读取 |
| MCP | `alpha-vantage-mcp` | Alpha Vantage 金融数据 API |
| MCP | `bloomberg-mcp` | Bloomberg 终端数据接口 |
| Skill | `equity-research` | 个股深度研究，估值建模，投资建议，目标价 |
| Skill | `financial-statement-analysis` | 财务报表分析，盈利质量，偿债能力，运营效率 |
| Skill | `industry-research` | 行业研究，竞争格局，产业链分析，趋势预测 |

---

### 组合包 FIN-02：银行与信贷包

**适用场景：** 银行、信贷机构、小贷公司的信贷业务

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-credit-assessment` | 信用评估，征信报告解析，授信额度测算 |
| 插件 | `dsh-plugin-loan-management` | 贷款管理，还款计划，逾期跟踪，催收管理 |
| 插件 | `dsh-plugin-risk-pricing` | 风险定价，利率测算，违约概率模型 |
| MCP | `credit-bureau-mcp` | 征信机构数据接口，个人/企业征信查询 |
| MCP | `bank-statement-mcp` | 银行流水解析，收支分析，现金流评估 |
| MCP | `business-registry-mcp` | 工商登记信息查询，企业股权结构，司法风险 |
| Skill | `credit-application-review` | 信贷申请审查，资料核验，风险点识别，审批意见 |
| Skill | `loan-document-generation` | 贷款合同生成，借款协议，担保合同，还款计划 |
| Skill | `collection-strategy` | 催收策略制定，话术生成，催收记录，回款跟踪 |

---

### 组合包 FIN-03：保险业务包

**适用场景：** 保险公司、保险代理、保险经纪

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-insurance-product` | 保险产品管理，条款解析，费率计算，方案对比 |
| 插件 | `dsh-plugin-policy-management` | 保单管理，承保流程，批改理赔，续保提醒 |
| 插件 | `dsh-plugin-claims` | 理赔管理，报案登记，定损核赔，赔付计算 |
| MCP | `insurance-database-mcp` | 保险产品数据库，条款库，费率表查询 |
| MCP | `medical-claim-mcp` | 医保对接，医疗理赔数据接口 |
| Skill | `insurance-scheme-design` | 保险方案设计，需求分析，产品组合，保费测算 |
| Skill | `underwriting-assessment` | 核保评估，风险分类，承保决策，条件设定 |
| Skill | `claims-processing` | 理赔处理，责任认定，损失核定，赔付计算，纠纷处理 |

---

## 4. 教育培训行业

### 组合包 EDU-01：课程设计与教学包

**适用场景：** 学校、培训机构、在线教育的课程开发与教学

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-course-design` | 课程设计，大纲生成，教案编写，课件制作 |
| 插件 | `dsh-plugin-question-bank` | 题库管理，题目生成，组卷系统，自动批改 |
| 插件 | `dsh-plugin-knowledge-graph` | 知识图谱构建，知识点关联，学习路径规划 |
| MCP | `canvas-lms-mcp` | Canvas LMS 学习管理系统集成 |
| MCP | `moodle-mcp` | Moodle 学习平台接口 |
| MCP | `youtube-mcp` | YouTube 视频搜索，教育视频获取 |
| Skill | `lesson-plan-generation` | 教案生成，教学目标，教学过程，板书设计，作业布置 |
| Skill | `question-generation` | 题目自动生成，难度分级，答案解析，知识点标注 |
| Skill | `knowledge-explanation` | 知识点讲解，类比举例，易错点提示，拓展延伸 |

---

### 组合包 EDU-02：学生管理与辅导包

**适用场景：** 学校班主任、培训机构教务、一对一辅导

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-student-management` | 学生档案管理，成绩跟踪，出勤记录，表现评价 |
| 插件 | `dsh-plugin-parent-communication` | 家长沟通，家校联系，成长报告，通知推送 |
| 插件 | `dsh-plugin-tutoring` | 一对一辅导，答疑解惑，学习诊断，个性化指导 |
| MCP | `student-info-system-mcp` | 学生信息系统接口，学籍管理 |
| MCP | `gradebook-mcp` | 成绩册管理，分数录入，统计分析 |
| Skill | `student-assessment` | 学情分析，学习诊断，薄弱环节识别，提升建议 |
| Skill | `parent-report` | 家长报告生成，学习情况总结，进步亮点，改进建议 |
| Skill | `tutoring-session` | 辅导课准备，知识点讲解，例题设计，课后练习，效果评估 |

---

### 组合包 EDU-03：升学规划与志愿填报包

**适用场景：** 升学规划机构、高中学校、学生家长

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-college-planning` | 升学规划，目标设定，时间线管理，背景提升 |
| 插件 | `dsh-plugin-volunteer-filling` | 志愿填报，院校推荐，专业选择，录取概率 |
| 插件 | `dsh-plugin-exam-prep` | 考试备考，复习计划，真题解析，模考分析 |
| MCP | `college-database-mcp` | 院校数据库，招生计划，历年分数线，专业介绍 |
| MCP | `gaokao-mcp` | 高考数据接口，一分一段表，录取数据 |
| Skill | `academic-planning` | 学业规划，选科建议，竞赛规划，课外活动设计 |
| Skill | `volunteer-strategy` | 志愿填报策略，冲稳保梯度设计，院校专业匹配，风险评估 |
| Skill | `exam-preparation-plan` | 备考计划制定，知识点梳理，薄弱环节突破，时间管理 |

---

## 5. 电商零售行业

### 组合包 EC-01：商品运营与 listing 优化包

**适用场景：** 电商卖家、运营团队的商品管理与优化

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-product-management` | 商品管理，SKU 管理，库存同步，价格调整 |
| 插件 | `dsh-plugin-listing-optimization` | Listing 优化，标题生成，关键词布局，详情页设计 |
| 插件 | `dsh-plugin-keyword-research` | 关键词研究，搜索量分析，竞争度评估，选词建议 |
| MCP | `amazon-sp-mcp` | Amazon SP-API 卖家平台接口 |
| MCP | `shopify-mcp` | Shopify 电商平台接口 |
| MCP | `taobao-mcp` | 淘宝/天猫开放平台接口 |
| MCP | `jd-mcp` | 京东开放平台接口 |
| Skill | `listing-copywriting` | 商品文案撰写，卖点提炼，标题优化，描述生成 |
| Skill | `keyword-strategy` | 关键词策略制定，词库构建，排名跟踪，SEO 优化 |
| Skill | `product-photography-guidance` | 商品拍摄指导，场景设计，修图建议，A+ 内容规划 |

---

### 组合包 EC-02：客服与售后包

**适用场景：** 电商客服团队、售后部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-customer-service` | 客服管理，话术库，快捷回复，会话记录 |
| 插件 | `dsh-plugin-after-sales` | 售后管理，退换货处理，退款审核，纠纷处理 |
| 插件 | `dsh-plugin-review-management` | 评价管理，好评维护，差评处理，追评引导 |
| MCP | `customer-service-mcp` | 客服系统接口，消息收发，工单管理 |
| MCP | `order-management-mcp` | 订单系统接口，订单查询，状态更新 |
| Skill | `customer-inquiry-response` | 客户咨询回复，产品答疑，物流查询，优惠说明 |
| Skill | `complaint-handling` | 投诉处理，情绪安抚，问题诊断，解决方案，补偿方案 |
| Skill | `review-response` | 评价回复撰写，差评挽回，好评感谢，品牌形象维护 |

---

### 组合包 EC-03：营销与推广包

**适用场景：** 电商营销团队、推广部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-ad-management` | 广告管理，投放计划，出价优化，效果分析 |
| 插件 | `dsh-plugin-promotion` | 促销活动策划，优惠券设计，满减规则，活动执行 |
| 插件 | `dsh-plugin-livestream` | 直播带货，脚本撰写，话术设计，数据复盘 |
| MCP | `facebook-ads-mcp` | Facebook 广告管理接口 |
| MCP | `google-ads-mcp` | Google Ads 广告接口 |
| MCP | `tiktok-ads-mcp` | TikTok 广告接口 |
| Skill | `ad-copywriting` | 广告文案撰写，创意生成，A/B 测试方案，落地页优化 |
| Skill | `promotion-planning` | 促销活动策划，节奏安排，利益点设计，预算分配，效果预估 |
| Skill | `livestream-script` | 直播脚本撰写，产品讲解，互动设计，逼单话术，复盘分析 |

---

## 6. 制造业 / 工业

### 组合包 MFG-01：生产管理与排程包

**适用场景：** 制造企业生产部门、计划部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-production-planning` | 生产计划，排程优化，产能平衡，交期管理 |
| 插件 | `dsh-plugin-work-order` | 工单管理，生产指令，进度跟踪，报工记录 |
| 插件 | `dsh-plugin-equipment-management` | 设备管理，台账维护，保养计划，故障记录 |
| MCP | `erp-mcp` | ERP 系统接口（SAP/Oracle/用友/金蝶） |
| MCP | `mes-mcp` | MES 制造执行系统接口 |
| MCP | `iot-mcp` | IoT 设备数据采集，传感器数据接口 |
| Skill | `production-scheduling` | 生产排程优化，工序安排，资源分配，瓶颈识别 |
| Skill | `work-order-management` | 工单全流程管理，下达，执行，报工，完工，异常处理 |
| Skill | `oee-analysis` | 设备综合效率 OEE 分析，停机原因，稼动率提升方案 |

---

### 组合包 MFG-02：质量管理与控制包

**适用场景：** 制造企业质量部门、QC/QA 团队

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-quality-control` | 质量控制，检验标准，抽样方案，判定规则 |
| 插件 | `dsh-plugin-nonconformance` | 不合格品管理，8D 报告，纠正预防措施 |
| 插件 | `dsh-plugin-quality-certification` | 质量认证管理，ISO 体系，审核准备，证书维护 |
| MCP | `qms-mcp` | QMS 质量管理系统接口 |
| MCP | `lab-information-mcp` | LIMS 实验室信息管理系统接口 |
| Skill | `quality-inspection` | 质量检验执行，检验记录，缺陷分类，判定结论 |
| Skill | `problem-solving-8d` | 8D 问题解决，根因分析，纠正措施，效果验证，预防措施 |
| Skill | `quality-system-audit` | 质量体系审核，内审执行，不符合项，整改跟踪，管理评审 |

---

### 组合包 MFG-03：供应链与采购包

**适用场景：** 制造企业采购部门、供应链管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-procurement` | 采购管理，供应商管理，询价比价，采购订单 |
| 插件 | `dsh-plugin-inventory` | 库存管理，库存预警，安全库存，盘点管理 |
| 插件 | `dsh-plugin-supplier-evaluation` | 供应商评估，绩效考核，分级管理，淘汰机制 |
| MCP | `srm-mcp` | SRM 供应商关系管理系统接口 |
| MCP | `wms-mcp` | WMS 仓库管理系统接口 |
| MCP | `logistics-mcp` | 物流跟踪接口，运输状态查询 |
| Skill | `procurement-strategy` | 采购策略制定，品类管理，成本分析，谈判方案，合同条款 |
| Skill | `inventory-optimization` | 库存优化，ABC 分类，安全库存计算，周转率提升，呆滞处理 |
| Skill | `supplier-development` | 供应商开发，准入评估，能力提升，绩效改进，战略合作 |

---

## 7. 房地产 / 建筑

### 组合包 REAL-01：房产销售与经纪包

**适用场景：** 房产中介、售楼处、房产经纪公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-property-management` | 房源管理，房源录入，图片管理，房源匹配 |
| 插件 | `dsh-plugin-customer-followup` | 客户管理，需求分析，带看记录，跟进跟踪 |
| 插件 | `dsh-plugin-transaction` | 交易管理，合同签订，贷款办理，过户流程 |
| MCP | `mls-mcp` | MLS 多重上市服务系统接口（房产 listing） |
| MCP | `property-tax-mcp` | 房产税查询，评估价值接口 |
| MCP | `mortgage-calculator-mcp` | 房贷计算接口，利率查询，还款计划 |
| Skill | `property-listing-writing` | 房源描述撰写，卖点提炼，标题优化，文案生成 |
| Skill | `customer-needs-analysis` | 客户需求分析，购房预算，区域偏好，户型需求，匹配推荐 |
| Skill | `transaction-coordination` | 交易流程协调，合同准备，贷款协助，过户安排，交房验房 |

---

### 组合包 REAL-02：建筑工程管理包

**适用场景：** 建筑公司、工程管理、施工项目部

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-project-management` | 工程项目管理，进度计划，里程碑，关键路径 |
| 插件 | `dsh-plugin-construction-drawing` | 施工图纸管理，图纸会审，设计变更，图纸版本 |
| 插件 | `dsh-plugin-safety-management` | 安全管理，安全检查，隐患排查，事故处理 |
| MCP | `bim-mcp` | BIM 建筑信息模型接口 |
| MCP | `project-management-mcp` | 工程项目管理系统接口（Primavera/MS Project） |
| MCP | `construction-cost-mcp` | 工程造价接口，定额库，清单计价 |
| Skill | `construction-schedule` | 施工进度计划编制，工序安排，资源配置，进度跟踪，偏差分析 |
| Skill | `quality-inspection-construction` | 施工质量检查，分部分项验收，隐蔽工程，质量评定，资料整理 |
| Skill | `safety-inspection` | 安全检查执行，隐患识别，风险分级，整改通知，复查验收，教育交底 |

---

### 组合包 REAL-03：物业管理包

**适用场景：** 物业公司、物业项目部、社区管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-property-service` | 物业服务管理，报修处理，投诉建议，满意度调查 |
| 插件 | `dsh-plugin-fee-collection` | 收费管理，物业费，水电费，停车费，催缴通知 |
| 插件 | `dsh-plugin-facility-maintenance` | 设施设备维护，保养计划，维修记录，备件管理 |
| MCP | `property-management-system-mcp` | 物业管理系统接口 |
| MCP | `iot-smart-building-mcp` | 智慧楼宇 IoT 接口，设备状态监控 |
| Skill | `resident-communication` | 业主沟通，通知公告，活动组织，关系维护，纠纷调解 |
| Skill | `maintenance-work-order` | 维修工单处理，派单调度，进度跟踪，完工验收，满意度回访 |
| Skill | `property-financial-report` | 物业财务报告，收支分析，预算执行，成本控制，经营建议 |

---

## 8. 媒体 / 内容创作

### 组合包 MEDIA-01：短视频创作包

**适用场景：** 短视频创作者、MCN 机构、自媒体团队

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-video-script` | 视频脚本撰写，分镜设计，台词生成，节奏规划 |
| 插件 | `dsh-plugin-video-editing` | 视频剪辑辅助，剪辑建议，转场设计，字幕生成 |
| 插件 | `dsh-plugin-content-calendar` | 内容日历，选题规划，发布排期，热点跟踪 |
| MCP | `tiktok-mcp` | TikTok/抖音数据接口，视频管理，评论互动 |
| MCP | `youtube-mcp` | YouTube 视频管理，数据分析，评论回复 |
| MCP | `bilibili-mcp` | B站视频接口，弹幕管理，数据统计 |
| Skill | `short-video-script` | 短视频脚本创作，黄金3秒，钩子设计，剧情结构，结尾引导 |
| Skill | `video-title-thumbnail` | 视频标题优化，封面设计建议，关键词布局，点击率提升 |
| Skill | `content-strategy` | 内容策略制定，账号定位，选题库构建，爆款分析，增长方案 |

---

### 组合包 MEDIA-02：图文内容创作包

**适用场景：** 公众号、小红书、知乎、博客等图文创作者

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-article-writing` | 文章撰写，结构规划，内容填充，风格调整 |
| 插件 | `dsh-plugin-image-generation` | AI 图片生成，封面设计，配图制作，风格统一 |
| 插件 | `dsh-plugin-seo-optimization` | SEO 优化，关键词布局，meta 标签，内链策略 |
| MCP | `wordpress-mcp` | WordPress 博客接口，文章发布，媒体管理 |
| MCP | `wechat-mcp` | 微信公众号接口，图文发布，数据统计 |
| MCP | `xiaohongshu-mcp` | 小红书笔记接口，发布管理，互动数据 |
| Skill | `long-form-article` | 长文写作，深度报道，研究文章，结构设计，论证逻辑 |
| Skill | `social-media-post` | 社交媒体帖子撰写，平台适配，语气调整，话题标签，互动引导 |
| Skill | `content-repurposing` | 内容复用，一鱼多吃，跨平台改编，格式转换，系列衍生 |

---

### 组合包 MEDIA-03：品牌营销与公关包

**适用场景：** 品牌方、营销公司、公关团队

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-brand-strategy` | 品牌策略，定位分析，品牌故事，视觉规范 |
| 插件 | `dsh-plugin-campaign-management` | 营销活动管理，策划执行，效果追踪，复盘总结 |
| 插件 | `dsh-plugin-pr-crisis` | 公关危机管理，舆情监控，声明起草，应对方案 |
| MCP | `social-listening-mcp` | 社交聆听接口，品牌提及，舆情监控 |
| MCP | `media-database-mcp` | 媒体数据库，记者联系，发稿管理 |
| MCP | `influencer-mcp` | KOL/KOC 数据库，达人合作，效果评估 |
| Skill | `brand-storytelling` | 品牌故事创作，价值主张，品牌人格，传播话术，内容体系 |
| Skill | `marketing-campaign` | 营销活动策划，目标设定，创意概念，执行方案，预算分配，KPI |
| Skill | `crisis-communication` | 危机公关应对，舆情分析，声明撰写，媒体沟通，善后处理，品牌修复 |

---

## 9. 政府 / 公共服务

### 组合包 GOV-01：政务办公与公文包

**适用场景：** 政府机关、事业单位、公共服务部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-official-document` | 公文写作，格式规范，文种选择，行文规则 |
| 插件 | `dsh-plugin-meeting-management` | 会议管理，会议通知，纪要整理，决议跟踪 |
| 插件 | `dsh-plugin-government-affairs` | 政务管理，政策研究，文件流转，审批办理 |
| MCP | `government-portal-mcp` | 政府门户网站接口，信息发布，办事指南 |
| MCP | `oa-system-mcp` | OA 办公系统接口，流程审批，公文流转 |
| Skill | `official-document-drafting` | 公文起草，通知/报告/请示/批复/函，格式规范，语言风格，审核要点 |
| Skill | `policy-research` | 政策研究，文件解读，背景分析，影响评估，实施建议 |
| Skill | `meeting-minutes` | 会议纪要整理，议题记录，发言摘要，决议事项，待办分解 |

---

### 组合包 GOV-02：公共服务与民生包

**适用场景：** 街道社区、政务服务中心、民生服务部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-resident-service` | 居民服务，办事指南，政策咨询，预约办理 |
| 插件 | `dsh-plugin-community-management` | 社区管理，网格管理，居民档案，活动组织 |
| 插件 | `dsh-plugin-social-assistance` | 社会救助，低保管理，临时救助，特殊群体 |
| MCP | `citizen-service-mcp` | 市民服务接口，办事预约，进度查询 |
| MCP | `social-security-mcp` | 社保接口，医保查询，养老金，失业金 |
| MCP | `housing-fund-mcp` | 公积金接口，查询提取，贷款计算 |
| Skill | `policy-explanation` | 政策解读，办事指南，条件说明，材料清单，流程指引 |
| Skill | `resident-communication` | 居民沟通，通知发布，意见收集，纠纷调解，关怀慰问 |
| Skill | `social-work-case` | 社工个案管理，需求评估，服务计划，资源链接，跟进记录，效果评估 |

---

### 组合包 GOV-03：城市管理与应急包

**适用场景：** 城管部门、应急管理局、城市运行管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-city-management` | 城市管理，市容巡查，问题上报，处置跟踪 |
| 插件 | `dsh-plugin-emergency-response` | 应急响应，预案管理，事件处置，资源调度 |
| 插件 | `dsh-plugin-risk-monitoring` | 风险监测，隐患排查，预警发布，趋势分析 |
| MCP | `iot-city-mcp` | 城市 IoT 接口，摄像头，传感器，环境监测 |
| MCP | `emergency-alert-mcp` | 应急预警接口，气象预警，地质灾害，公共安全 |
| MCP | `gis-mcp` | GIS 地理信息系统接口，地图服务，空间分析 |
| Skill | `incident-reporting` | 事件上报，情况描述，位置标注，照片记录，等级评定 |
| Skill | `emergency-plan-execution` | 应急预案执行，响应启动，指挥协调，物资调配，信息发布，善后恢复 |
| Skill | `risk-assessment-public` | 公共安全风险评估，隐患识别，等级划分，管控措施，应急预案 |

---

## 10. IT / 软件开发

### 组合包 IT-01：代码开发与调试包

**适用场景：** 软件开发者、程序员、开发团队

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-code-editor` | 代码编辑，语法高亮，代码补全，重构支持 |
| 插件 | `dsh-plugin-debugger` | 调试辅助，断点管理，变量查看，调用栈分析 |
| 插件 | `dsh-plugin-code-review` | 代码审查，规范检查，安全扫描，优化建议 |
| MCP | `github-mcp` | GitHub 接口，代码仓库，Issue/PR，CI/CD |
| MCP | `gitlab-mcp` | GitLab 接口，仓库管理，CI/CD 流水线 |
| MCP | `context7-mcp` | 库文档检索，版本特定 API 文档注入 |
| MCP | `sequential-thinking-mcp` | 结构化思考，复杂问题分解，推理过程 |
| Skill | `code-generation` | 代码生成，需求分析，架构设计，编码实现，单元测试 |
| Skill | `bug-fixing` | Bug 修复，错误分析，根因定位，修复方案，回归验证 |
| Skill | `code-refactoring` | 代码重构，结构优化，设计模式应用，性能改进，可维护性提升 |

---

### 组合包 IT-02：DevOps 与运维包

**适用场景：** 运维工程师、DevOps 团队、SRE

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-server-management` | 服务器管理，远程连接，命令执行，状态监控 |
| 插件 | `dsh-plugin-deployment` | 部署管理，CI/CD 流水线，发布管理，回滚操作 |
| 插件 | `dsh-plugin-monitoring-alert` | 监控告警，指标采集，日志分析，告警通知 |
| MCP | `kubernetes-mcp` | Kubernetes 集群管理，Pod/Deployment/Service 操作 |
| MCP | `docker-mcp` | Docker 容器管理，镜像构建，容器操作 |
| MCP | `terraform-mcp` | Terraform 基础设施即代码，资源管理 |
| MCP | `prometheus-mcp` | Prometheus 监控指标查询 |
| MCP | `sentry-mcp` | Sentry 错误追踪，性能监控，问题管理 |
| Skill | `incident-response-it` | IT 事件响应，故障诊断，影响评估，处置方案，恢复验证，复盘总结 |
| Skill | `deployment-pipeline` | 部署流水线设计，CI/CD 配置，自动化测试，发布策略，灰度发布 |
| Skill | `infrastructure-management` | 基础设施管理，资源规划，成本优化，安全加固，高可用设计 |

---

### 组合包 IT-03：数据库与数据分析包

**适用场景：** 数据工程师、数据分析师、DBA

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-dba-tools` | DBA 工具，性能调优，索引优化，备份恢复 |
| 插件 | `dsh-plugin-data-analysis` | 数据分析，探索性分析，统计建模，洞察提取 |
| 插件 | `dsh-plugin-data-visualization` | 数据可视化，图表设计，仪表盘搭建，报告生成 |
| MCP | `postgres-mcp` | PostgreSQL 数据库操作 |
| MCP | `mysql-mcp` | MySQL 数据库操作 |
| MCP | `mongodb-mcp` | MongoDB 文档数据库操作 |
| MCP | `redis-mcp` | Redis 缓存操作 |
| MCP | `snowflake-mcp` | Snowflake 数据仓库查询 |
| Skill | `sql-optimization` | SQL 优化，执行计划分析，索引建议，查询改写，性能调优 |
| Skill | `exploratory-data-analysis` | 探索性数据分析，数据清洗，特征工程，统计检验，可视化探索 |
| Skill | `dashboard-design` | 仪表盘设计，指标体系，图表选择，布局规划，交互设计，故事线 |

---

## 11. 农业

### 组合包 AGR-01：种植管理与精准农业包

**适用场景：** 农场、种植基地、农业合作社

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-crop-management` | 作物管理，种植计划，农事记录，生长跟踪 |
| 插件 | `dsh-plugin-precision-agriculture` | 精准农业，变量施肥，灌溉控制，产量预测 |
| 插件 | `dsh-plugin-pest-disease` | 病虫害管理，识别诊断，防治方案，用药记录 |
| MCP | `weather-mcp` | 气象数据接口，天气预报，历史气象，农业气象指标 |
| MCP | `soil-mcp` | 土壤数据接口，养分检测，墒情监测，pH 值 |
| MCP | `drone-mcp` | 无人机接口，航拍图像，NDVI 植被指数，植保作业 |
| Skill | `planting-plan` | 种植计划制定，品种选择，茬口安排，播期确定，密度设计 |
| Skill | `pest-diagnosis` | 病虫害诊断，症状识别，发生规律，防治时机，药剂选择，安全用药 |
| Skill | `yield-optimization` | 产量优化，水肥管理，群体调控，逆境应对，收获时机，品质提升 |

---

### 组合包 AGR-02：农产品销售与溯源包

**适用场景：** 农产品销售、农业电商、食品企业

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-agri-product-sales` | 农产品销售，订单管理，客户管理，渠道拓展 |
| 插件 | `dsh-plugin-traceability` | 溯源管理，生产记录，质量检测，溯源码生成 |
| 插件 | `dsh-plugin-agri-brand` | 农业品牌，品牌故事，包装设计，营销推广 |
| MCP | `ecommerce-platform-mcp` | 电商平台接口，农产品上架，订单同步 |
| MCP | `food-safety-mcp` | 食品安全接口，检测报告，合格证，追溯查询 |
| Skill | `agri-product-marketing` | 农产品营销，卖点提炼，产地故事，内容创作，渠道选择 |
| Skill | `traceability-system` | 溯源体系建设，信息采集，区块链存证，溯源查询，消费者信任 |
| Skill | `agri-supply-chain` | 农产品供应链，采收管理，冷链物流，仓储保鲜，损耗控制，品质保障 |

---

### 组合包 AGR-03：畜牧养殖包

**适用场景：** 养殖场、畜牧企业、养殖合作社

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-livestock-management` | 畜牧管理，个体档案，繁殖记录，生长性能 |
| 插件 | `dsh-plugin-feed-management` | 饲料管理，配方设计，饲喂记录，成本核算 |
| 插件 | `dsh-plugin-animal-health` | 动物健康，免疫程序，疾病防治，用药记录 |
| MCP | `iot-livestock-mcp` | 畜牧 IoT 接口，耳标数据，环境监测，体重采集 |
| MCP | `veterinary-drug-mcp` | 兽药数据库，说明书，休药期，相互作用 |
| Skill | `breeding-management` | 育种管理，选种选配，繁殖计划，妊娠诊断，产仔护理，断奶管理 |
| Skill | `feed-formulation` | 饲料配方设计，营养需求，原料选择，成本优化，阶段饲喂，效果评估 |
| Skill | `biosecurity` | 生物安全，消毒程序，免疫规划，疫病监测，应急处置，隔离检疫 |

---

## 12. 物流 / 供应链

### 组合包 LOG-01：运输与配送包

**适用场景：** 物流公司、运输企业、配送团队

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-transport-planning` | 运输计划，路线规划，车辆调度，配载优化 |
| 插件 | `dsh-plugin-delivery-management` | 配送管理，订单分配，路径优化，签收管理 |
| 插件 | `dsh-plugin-fleet-management` | 车队管理，车辆档案，司机管理，油耗监控 |
| MCP | `gps-tracking-mcp` | GPS 定位接口，车辆追踪，轨迹回放，电子围栏 |
| MCP | `map-navigation-mcp` | 地图导航接口，路径规划，实时路况，地理编码 |
| MCP | `express-mcp` | 快递接口，运单查询，物流轨迹，电子面单 |
| Skill | `route-optimization` | 路径优化，VRP 问题求解，时间窗约束，车辆容量，成本最小化 |
| Skill | `delivery-execution` | 配送执行，订单分拣，装车清单，配送顺序，异常处理，客户签收 |
| Skill | `fleet-efficiency` | 车队效率分析，油耗管理，维保计划，司机绩效，安全管理，成本控制 |

---

### 组合包 LOG-02：仓储与库存包

**适用场景：** 仓储企业、物流中心、仓库管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-warehouse-layout` | 仓库布局，库位规划，动线设计，容量优化 |
| 插件 | `dsh-plugin-inbound-outbound` | 出入库管理，收货质检，上架拣货，盘点调拨 |
| 插件 | `dsh-plugin-stock-control` | 库存控制，安全库存，补货策略，周转率 |
| MCP | `wms-mcp` | WMS 仓库管理系统接口 |
| MCP | `barcode-rfid-mcp` | 条码/RFID 接口，扫码操作，标签打印 |
| MCP | `automated-storage-mcp` | 自动化立体仓库接口，AGV，堆垛机 |
| Skill | `warehouse-operations` | 仓储作业优化，收货流程，存储策略，拣货路径，发货流程，退货处理 |
| Skill | `inventory-accuracy` | 库存准确率提升，循环盘点，差异处理，系统调整，防错机制，绩效考核 |
| Skill | `space-utilization` | 空间利用率提升，库位优化，ABC 分类，动态调整，扩容方案，成本分析 |

---

### 组合包 LOG-03：供应链协同包

**适用场景：** 供应链管理、采购物流、供应链协同

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-supply-chain-planning` | 供应链计划，需求预测，库存策略，协同计划 |
| 插件 | `dsh-plugin-procurement-logistics` | 采购物流，供应商交付，在途跟踪，入库协同 |
| 插件 | `dsh-plugin-supply-chain-risk` | 供应链风险，风险识别，中断预警，应急方案 |
| MCP | `scm-system-mcp` | SCM 供应链管理系统接口 |
| MCP | `edi-mcp` | EDI 电子数据交换接口，订单/发票/发货通知 |
| MCP | `trade-customs-mcp` | 国际贸易海关接口，报关单，关税，原产地 |
| Skill | `demand-forecasting` | 需求预测，历史分析，季节性，趋势判断，促销影响，预测准确率 |
| Skill | `supply-chain-collaboration` | 供应链协同，信息共享，联合计划，VMI 管理，CPFR 流程，绩效评估 |
| Skill | `supply-chain-resilience` | 供应链韧性，风险地图，多源采购，安全库存，应急物流，业务连续性 |

---

## 13. 旅游 / 酒店

### 组合包 TRAV-01：旅行社与行程规划包

**适用场景：** 旅行社、旅游顾问、定制游公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-itinerary-design` | 行程设计，路线规划，景点安排，时间管理 |
| 插件 | `dsh-plugin-tour-product` | 旅游产品管理，产品打包，定价策略，库存管理 |
| 插件 | `dsh-plugin-tour-guide` | 导游辅助，讲解词，景点介绍，应急处理 |
| MCP | `flight-mcp` | 机票接口，航班查询，价格对比，预订管理 |
| MCP | `hotel-booking-mcp` | 酒店预订接口，房态查询，价格比较，预订确认 |
| MCP | `attraction-ticket-mcp` | 景点门票接口，票务查询，在线预订，核销管理 |
| MCP | `travel-review-mcp` | 旅游评价接口，景点评分，游客评论，攻略推荐 |
| Skill | `custom-itinerary` | 定制行程设计，需求分析，预算控制，兴趣匹配，节奏安排，特色体验 |
| Skill | `tour-costing` | 旅游成本核算，分项报价，利润分析，价格策略，成本控制，报价单生成 |
| Skill | `tour-guide-script` | 导游词撰写，景点讲解，历史文化，故事传说，互动设计，应急话术 |

---

### 组合包 TRAV-02：酒店运营与管理包

**适用场景：** 酒店、民宿、度假村的运营管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-hotel-front-desk` | 前台管理，入住退房，房态管理，客人服务 |
| 插件 | `dsh-plugin-revenue-management` | 收益管理，动态定价，房量控制，渠道管理 |
| 插件 | `dsh-plugin-hotel-housekeeping` | 客房管理，清洁计划，查房标准，布草管理 |
| MCP | `pms-mcp` | PMS 酒店管理系统接口 |
| MCP | `ota-mcp` | OTA 渠道接口（携程/美团/Booking/Agoda） |
| MCP | `channel-manager-mcp` | 渠道管理器接口，房态同步，价格同步 |
| Skill | `front-desk-operations` | 前台操作，入住办理，退房结算，投诉处理，升级销售，客人关系 |
| Skill | `dynamic-pricing` | 动态定价策略，需求预测，竞争分析，价格调整，库存分配，收益最大化 |
| Skill | `guest-experience` | 客人体验提升，服务标准，个性化服务，惊喜设计，满意度调查，差评挽回 |

---

### 组合包 TRAV-03：旅游营销与获客包

**适用场景：** 旅游营销、目的地推广、旅游电商

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-travel-marketing` | 旅游营销，内容创作，活动策划，获客转化 |
| 插件 | `dsh-plugin-destination-promotion` | 目的地推广，形象塑造，资源整合，品牌传播 |
| 插件 | `dsh-plugin-travel-crm` | 旅游 CRM，客户管理，会员体系，复购营销 |
| MCP | `social-media-travel-mcp` | 社交媒体旅游接口，小红书/抖音/马蜂窝 |
| MCP | `travel-kol-mcp` | 旅游 KOL 数据库，达人合作，内容种草 |
| Skill | `travel-content-marketing` | 旅游内容营销，攻略撰写，游记创作，短视频脚本，图片规划 |
| Skill | `travel-campaign` | 旅游活动策划，主题设计，优惠方案，传播路径，效果追踪，ROI 分析 |
| Skill | `travel-member-operations` | 旅游会员运营，会员分层，权益设计，积分体系，召回策略，LTV 提升 |

---

## 14. 餐饮行业

### 组合包 FOOD-01：餐厅运营与管理包

**适用场景：** 餐厅、快餐店、餐饮连锁的运营管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-restaurant-pos` | 收银管理，点餐下单，结账支付，交班对账 |
| 插件 | `dsh-plugin-kitchen-management` | 厨房管理，出品管理，出餐节奏，菜品标准 |
| 插件 | `dsh-plugin-restaurant-service` | 服务管理，服务标准，桌台管理，客人体验 |
| MCP | `pos-system-mcp` | POS 收银系统接口 |
| MCP | `restaurant-order-mcp` | 点餐系统接口，外卖平台对接 |
| MCP | `kitchen-display-mcp` | KDS 厨房显示系统接口 |
| Skill | `restaurant-operations` | 餐厅运营管理，排班计划，流程优化，成本控制，质量标准，现场管理 |
| Skill | `menu-engineering` | 菜单工程，菜品分析，明星/瘦狗/问题/耕牛分类，定价策略，菜单优化 |
| Skill | `customer-service-restaurant` | 餐饮服务，迎客入座，点餐推荐，上菜服务，投诉处理，送客关怀 |

---

### 组合包 FOOD-02：菜品研发与供应链包

**适用场景：** 餐饮研发、中央厨房、食材采购

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-menu-development` | 菜品研发，菜谱管理，标准配方，成本核算 |
| 插件 | `dsh-plugin-central-kitchen` | 中央厨房，生产计划，半成品加工，配送管理 |
| 插件 | `dsh-plugin-food-purchasing` | 食材采购，供应商管理，询价比价，库存管理 |
| MCP | `food-cost-mcp` | 食材成本数据库，价格行情，供应商报价 |
| MCP | `food-safety-mcp` | 食品安全接口，检测报告，溯源查询，证照管理 |
| MCP | `recipe-database-mcp` | 菜谱数据库，菜品配方，烹饪方法，营养成分 |
| Skill | `recipe-development` | 菜品研发，口味设计，配方调试，标准化，成本控制，上市测试 |
| Skill | `food-cost-control` | 食材成本控制，标准成本，实际成本，差异分析，损耗管理，采购优化 |
| Skill | `central-kitchen-production` | 中央厨房生产，产能规划，生产排程，质量控制，冷链配送，门店对接 |

---

### 组合包 FOOD-03：餐饮营销与外卖包

**适用场景：** 餐饮营销、外卖运营、会员管理

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-food-marketing` | 餐饮营销，活动策划，优惠券，会员营销 |
| 插件 | `dsh-plugin-delivery-operations` | 外卖运营，平台管理，菜品优化，评价管理 |
| 插件 | `dsh-plugin-restaurant-crm` | 餐饮 CRM，会员管理，储值卡，积分体系 |
| MCP | `meituan-mcp` | 美团外卖接口，店铺管理，订单处理，评价回复 |
| MCP | `eleme-mcp` | 饿了么外卖接口，店铺运营，订单管理，数据统计 |
| MCP | `dianping-mcp` | 大众点评接口，评价管理，团购套餐，数据统计 |
| Skill | `restaurant-promotion` | 餐饮促销活动，节日营销，新品推广，套餐设计，满减策略，复购提升 |
| Skill | `delivery-store-optimization` | 外卖店铺优化，菜单结构，菜品图片，标题关键词，评分维护，转化率提升 |
| Skill | `restaurant-member-operations` | 餐饮会员运营，会员分层，权益设计，储值营销，生日关怀，私域运营 |

---

## 15. 人力资源

### 组合包 HR-01：招聘与人才获取包

**适用场景：** 企业 HR、招聘专员、猎头顾问

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-recruitment` | 招聘管理，职位发布，简历筛选，面试安排 |
| 插件 | `dsh-plugin-talent-search` | 人才搜索，候选人画像，能力评估，匹配推荐 |
| 插件 | `dsh-plugin-interview` | 面试管理，面试题库，评估表，面试反馈 |
| MCP | `linkedin-mcp` | LinkedIn 接口，人才搜索，职位发布 |
| MCP | `boss-zhipin-mcp` | BOSS直聘接口，候选人沟通，职位管理 |
| MCP | `ats-mcp` | ATS 招聘管理系统接口 |
| Skill | `job-description-writing` | 职位描述撰写，岗位职责，任职要求，薪酬范围，雇主品牌，吸引点 |
| Skill | `resume-screening` | 简历筛选，关键词匹配，经历分析，能力评估，候选人分级，面试推荐 |
| Skill | `interview-question-design` | 面试题设计，结构化面试，行为面试，技术面试，评估标准，打分表 |

---

### 组合包 HR-02：员工管理与发展包

**适用场景：** 企业 HR、人事部门、培训部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-employee-management` | 员工管理，人事档案，入转调离，合同管理 |
| 插件 | `dsh-plugin-performance` | 绩效管理，目标设定，考核评估，反馈辅导 |
| 插件 | `dsh-plugin-training-development` | 培训发展，培训计划，课程管理，效果评估 |
| MCP | `hris-mcp` | HRIS 人力资源信息系统接口 |
| MCP | `performance-system-mcp` | 绩效管理系统接口 |
| MCP | `lms-mcp` | LMS 学习管理系统接口 |
| Skill | `employee-onboarding` | 员工入职，入职准备，欢迎流程，培训计划，导师分配，试用期管理，融入跟踪 |
| Skill | `performance-management` | 绩效管理，OKR/KPI 设定，过程跟踪，绩效评估，反馈面谈，改进计划，结果应用 |
| Skill | `training-needs-analysis` | 培训需求分析，能力差距，发展计划，课程设计，培训实施，效果评估，ROI 分析 |

---

### 组合包 HR-03：薪酬福利与员工关系包

**适用场景：** 企业薪酬福利、员工关系、工会工作

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-compensation` | 薪酬管理，薪资核算，社保公积金，个税计算 |
| 插件 | `dsh-plugin-benefits` | 福利管理，福利方案，员工关怀，弹性福利 |
| 插件 | `dsh-plugin-employee-relations` | 员工关系，沟通管理，冲突调解，离职管理 |
| MCP | `payroll-mcp` | 薪资系统接口，工资核算，发放管理 |
| MCP | `social-security-mcp` | 社保公积金接口，基数申报，缴纳管理 |
| MCP | `tax-mcp` | 个税接口，专项附加扣除，汇算清缴 |
| Skill | `salary-calculation` | 薪资核算，考勤统计，绩效奖金，补贴扣款，社保个税，工资条生成 |
| Skill | `benefit-program-design` | 福利方案设计，需求调研，预算分配，项目选择，供应商管理，满意度调查 |
| Skill | `employee-relation-management` | 员工关系管理，沟通机制，满意度调查，冲突调解，违纪处理，离职面谈，法律合规 |

---

## 16. 汽车行业

### 组合包 AUTO-01：汽车销售与 4S 店运营包

**适用场景：** 汽车 4S 店、汽车经销商、二手车商

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-auto-sales` | 汽车销售管理，客户跟进，试驾预约，报价单生成 |
| 插件 | `dsh-plugin-vehicle-inventory` | 车辆库存管理，在库车辆，VIN 管理，进销存跟踪 |
| 插件 | `dsh-plugin-after-sales` | 售后服务管理，维修预约，保养提醒，客户回访 |
| MCP | `automotive-database-mcp` | 汽车数据库接口，车型参数，配置对比，价格查询 |
| MCP | `dealer-management-mcp` | 经销商管理系统 DMS 接口 |
| MCP | `used-car-valuation-mcp` | 二手车估值接口，车况评估，残值计算 |
| Skill | `customer-follow-up-auto` | 汽车销售客户跟进，需求分析，报价方案，谈判策略，成交促进 |
| Skill | `vehicle-comparison` | 车型对比分析，参数对比，优劣势分析，推荐理由，客户匹配 |
| Skill | `after-sales-service` | 售后服务流程，维修接待，估价说明，保养建议，增值服务推荐，客户满意度 |

---

### 组合包 AUTO-02：汽车维修与保养包

**适用场景：** 汽车维修厂、快修店、保养连锁、轮胎店

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-repair-management` | 维修管理，工单创建，故障诊断，维修记录 |
| 插件 | `dsh-plugin-parts-management` | 配件管理，库存查询，采购申请，出入库管理 |
| 插件 | `dsh-plugin-vehicle-diagnosis` | 车辆诊断辅助，故障码解析，维修方案，工时估算 |
| MCP | `obd2-diagnostic-mcp` | OBD-II 诊断接口，故障码读取，实时数据，车辆状态 |
| MCP | `parts-catalog-mcp` | 配件目录接口，OE 号查询，配件适配，价格库存 |
| MCP | `repair-manual-mcp` | 维修手册接口，拆装步骤，扭矩参数，电路图 |
| Skill | `fault-diagnosis` | 故障诊断辅助，症状分析，故障码解读，排查步骤，维修方案，配件清单 |
| Skill | `repair-quote` | 维修报价生成，工时计算，配件价格，管理费，利润分析，报价单 |
| Skill | `maintenance-plan` | 保养计划制定，保养项目，周期建议，油品选择，易损件更换，费用预估 |

---

### 组合包 AUTO-03：汽车制造与供应链包

**适用场景：** 汽车制造厂、零部件供应商、汽车电子企业

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-auto-manufacturing` | 汽车制造管理，生产计划，装配线管理，质量追溯 |
| 插件 | `dsh-plugin-auto-parts-supply` | 零部件供应链管理，供应商管理，JIT 配送，库存协同 |
| 插件 | `dsh-plugin-automotive-qa` | 汽车质量管理，IATF 16949，APQP/PPAP，8D 报告 |
| MCP | `mes-automotive-mcp` | 汽车行业 MES 系统接口 |
| MCP | `plm-mcp` | PLM 产品生命周期管理接口，BOM 管理，图纸管理 |
| MCP | `supply-chain-auto-mcp` | 汽车供应链接口，订单协同，发货通知，在途跟踪 |
| Skill | `production-planning-auto` | 汽车生产计划编制，产能平衡，物料需求，排程优化，在制品管理 |
| Skill | `quality-control-auto` | 汽车质量控制，检验标准，抽样方案，缺陷分类，SPC 统计，整改跟踪 |
| Skill | `supplier-quality-management` | 供应商质量管理，准入审核，绩效评估，质量协议，问题整改，年度评审 |

---

## 17. 能源与公用事业

### 组合包 ENERGY-01：电力运营与电网包

**适用场景：** 电力公司、电网企业、供电所、新能源电站

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-power-grid` | 电网运营管理，调度运行，设备监控，故障处理 |
| 插件 | `dsh-plugin-meter-reading` | 抄表管理，电费核算，账单生成，欠费催缴 |
| 插件 | `dsh-plugin-power-customer` | 电力客户服务，报装接电，故障报修，咨询投诉 |
| MCP | `scada-mcp` | SCADA 数据采集与监控系统接口，实时数据，告警信息 |
| MCP | `smart-meter-mcp` | 智能电表接口，用电数据，远程抄表，负荷控制 |
| MCP | `gis-power-mcp` | 电力 GIS 接口，电网拓扑，设备定位，线路管理 |
| Skill | `grid-dispatch` | 电网调度运行，负荷预测，发电计划，潮流计算，安全校核，应急处置 |
| Skill | `power-billing` | 电费核算管理，电价政策，阶梯电价，力调电费，账单生成，对账核对 |
| Skill | `power-outage-management` | 停电管理，计划停电，故障停电，影响分析，通知发布，复电跟踪，满意度调查 |

---

### 组合包 ENERGY-02：新能源与可再生能源包

**适用场景：** 光伏电站、风电场、储能电站、新能源企业

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-renewable-plant` | 新能源电站管理，发电监控，设备运维，性能分析 |
| 插件 | `dsh-plugin-energy-storage` | 储能系统管理，充放电调度，SOC 管理，寿命评估 |
| 插件 | `dsh-plugin-carbon-accounting` | 碳核算管理，碳排放计算，碳足迹追踪，碳减排量 |
| MCP | `pv-monitoring-mcp` | 光伏监控接口，逆变器数据，发电量，组件状态 |
| MCP | `wind-scada-mcp` | 风电 SCADA 接口，风机数据，风速风向，发电量 |
| MCP | `weather-forecast-mcp` | 气象预报接口，辐照度，风速，温度，发电预测 |
| MCP | `carbon-market-mcp` | 碳市场接口，碳价查询，碳交易，CCER |
| Skill | `renewable-performance` | 新能源电站性能分析，PR 计算，可利用率，故障统计，损失分析，优化建议 |
| Skill | `energy-storage-dispatch` | 储能调度优化，充放电策略，峰谷套利，需求响应，SOC 管理，寿命优化 |
| Skill | `carbon-footprint-calculation` | 碳足迹计算，排放因子，活动数据，范围一二三，碳减排量，碳报告生成 |

---

### 组合包 ENERGY-03：石油天然气与公用事业包

**适用场景：** 石油公司、天然气公司、水务公司、燃气公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-oil-gas-operations` | 油气运营管理，生产运行，管道输送，场站管理 |
| 插件 | `dsh-plugin-water-utility` | 水务管理，供水调度，水质监测，管网管理 |
| 插件 | `dsh-plugin-gas-utility` | 燃气管理，输配调度，安全监控，客户服务 |
| MCP | `pipeline-scada-mcp` | 管道 SCADA 接口，压力流量，温度，泄漏检测 |
| MCP | `water-quality-mcp` | 水质监测接口，pH，浊度，余氯，微生物 |
| MCP | `gas-leak-detection-mcp` | 燃气泄漏检测接口，浓度监测，报警定位 |
| Skill | `oil-gas-production` | 油气生产管理，产量分析，井口管理，注水注气，增产措施，成本核算 |
| Skill | `water-supply-management` | 供水运营管理，水源调度，水厂运行，管网压力，漏损控制，水质保障 |
| Skill | `gas-safety-management` | 燃气安全管理，隐患排查，泄漏应急，入户安检，用户宣传，事故预案 |

---

## 18. 体育与健身

### 组合包 SPORT-01：健身俱乐部与私教包

**适用场景：** 健身房、健身工作室、私教团队、瑜伽馆

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-gym-management` | 健身房管理，会员管理，课程排期，场地预约 |
| 插件 | `dsh-plugin-personal-training` | 私教管理，训练计划，动作库，训练记录，效果跟踪 |
| 插件 | `dsh-plugin-fitness-assessment` | 体测管理，体成分分析，体能测试，健康评估 |
| MCP | `fitness-tracker-mcp` | 健身追踪设备接口（Apple Health/Google Fit/华为运动健康） |
| MCP | `exercise-database-mcp` | 动作库数据库接口，动作图解，肌肉群，难度等级 |
| MCP | `nutrition-database-mcp` | 营养数据库接口，食物热量，营养素，饮食记录 |
| Skill | `training-plan-design` | 训练计划设计，目标设定，周期划分，动作选择，组数次数，进阶调整 |
| Skill | `fitness-assessment-report` | 体测报告生成，体成分分析，体态评估，体能评级，风险提示，改进建议 |
| Skill | `member-retention-fitness` | 会员留存运营，到店提醒，训练激励，效果展示，续费沟通，转介绍激励 |

---

### 组合包 SPORT-02：体育赛事与运营包

**适用场景：** 体育赛事公司、赛事运营方、体育协会、俱乐部

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-event-planning` | 赛事策划，方案设计，预算编制，流程安排 |
| 插件 | `dsh-plugin-registration` | 报名管理，选手注册，报名费，分组编排 |
| 插件 | `dsh-plugin-scoring-timing` | 计时计分，成绩记录，排名计算，证书生成 |
| MCP | `timing-system-mcp` | 计时系统接口，芯片计时，终点摄像，分段成绩 |
| MCP | `sports-data-mcp` | 体育数据接口，选手数据，历史成绩，统计分析 |
| MCP | `venue-booking-mcp` | 场馆预订接口，场地查询，预约管理，费用结算 |
| Skill | `event-planning-sports` | 赛事策划方案，赛事定位，赛程设计，场地规划，人员配置，预算明细，风险预案 |
| Skill | `competition-management` | 竞赛组织管理，报名审核，分组抽签，赛程编排，裁判安排，成绩处理，颁奖组织 |
| Skill | `sports-marketing` | 体育赛事营销，赞助招商，媒体宣传，票务销售，观众体验，品牌曝光，商业开发 |

---

### 组合包 SPORT-03：运动康复与运动医学包

**适用场景：** 运动康复中心、康复诊所、运动队医、物理治疗师

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-sports-rehab` | 运动康复管理，评估诊断，康复计划，治疗记录 |
| 插件 | `dsh-plugin-injury-management` | 损伤管理，损伤评估，恢复跟踪，回归运动 |
| 插件 | `dsh-plugin-physiotherapy` | 物理治疗管理，治疗方案，手法记录，设备使用 |
| MCP | `rehab-equipment-mcp` | 康复设备接口，治疗设备数据，训练参数，效果记录 |
| MCP | `medical-imaging-mcp` | 医学影像接口，X光/MRI/CT，影像查看，报告读取 |
| MCP | `pain-assessment-mcp` | 疼痛评估接口，VAS 评分，疼痛地图，功能评分 |
| Skill | `injury-assessment` | 运动损伤评估，病史采集，体格检查，特殊试验，影像学解读，诊断意见 |
| Skill | `rehabilitation-program` | 康复方案制定，分期目标，治疗手段，训练动作，进阶标准，回归运动评估 |
| Skill | `return-to-sport` | 回归运动决策，功能测试，心理评估，运动专项测试，风险评估，逐步回归计划 |

---

## 19. 文化艺术与文博

### 组合包 CULTURE-01：博物馆与文博包

**适用场景：** 博物馆、纪念馆、美术馆、文博机构

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-collection-management` | 藏品管理，藏品登记，编目著录，库房管理 |
| 插件 | `dsh-plugin-exhibition` | 展览管理，策展方案，展品组织，展陈设计 |
| 插件 | `dsh-plugin-museum-education` | 社教活动，教育项目，导览讲解，研学课程 |
| MCP | `collection-database-mcp` | 藏品数据库接口，文物信息，图片，检索查询 |
| MCP | `museum-ticketing-mcp` | 博物馆票务接口，预约参观，门票销售，客流统计 |
| MCP | `audio-guide-mcp` | 语音导览接口，讲解内容，定位讲解，多语言 |
| Skill | `artifact-research` | 文物研究，断代辨伪，价值评估，历史考证，学术论文，展览说明 |
| Skill | `exhibition-curating` | 展览策划，主题定位，叙事结构，展品选择，空间设计，互动体验，教育活动 |
| Skill | `museum-public-education` | 博物馆社教，课程设计，活动策划，导览词撰写，研学方案，志愿者培训 |

---

### 组合包 CULTURE-02：艺术创作与画廊包

**适用场景：** 艺术家、画廊、艺术机构、拍卖行

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-artist-studio` | 艺术家工作室管理，作品管理，创作记录，素材库 |
| 插件 | `dsh-plugin-gallery-management` | 画廊管理，展览策划，作品销售，艺术家代理 |
| 插件 | `dsh-plugin-art-auction` | 拍卖管理，拍品征集，图录制作，拍卖执行 |
| MCP | `art-market-mcp` | 艺术市场数据接口，成交价，艺术家指数，市场趋势 |
| MCP | `artwork-registry-mcp` | 艺术品登记接口，作品溯源，真伪鉴定，所有权 |
| MCP | `image-generation-mcp` | AI 图像生成接口，创作辅助，风格迁移，概念图 |
| Skill | `art-creation-assistance` | 艺术创作辅助，灵感搜集，概念发展，构图建议，色彩方案，技法探索，批评反思 |
| Skill | `artwork-pricing` | 艺术品定价，市场分析，可比成交，艺术家定位，尺寸媒介，稀缺性，增值预期 |
| Skill | `exhibition-installation` | 展览布展，空间规划，作品排布，灯光设计，标签制作，开幕活动，媒体宣传 |

---

### 组合包 CULTURE-03：演出与演艺包

**适用场景：** 演出公司、剧院、剧团、演艺经纪

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-production-management` | 剧目制作管理，剧本管理，排练计划，制作预算 |
| 插件 | `dsh-plugin-theater-operations` | 剧院运营管理，演出排期，票务销售，场务管理 |
| 插件 | `dsh-plugin-performance-marketing` | 演出营销，宣传推广，媒体合作，观众运营 |
| MCP | `ticketing-system-mcp` | 票务系统接口，选座购票，票房统计，退票管理 |
| MCP | `script-database-mcp` | 剧本数据库接口，剧目信息，演职员，演出资料 |
| MCP | `venue-management-mcp` | 场馆管理接口，场地信息，设备清单，档期管理 |
| Skill | `script-analysis` | 剧本分析，主题解读，人物分析，结构梳理，舞台提示，导演阐述，排练计划 |
| Skill | `production-budget` | 制作预算编制，人员费用，场地设备，宣传营销，不可预见费，成本控制，结算审计 |
| Skill | `performance-marketing-plan` | 演出营销方案，目标受众，卖点提炼，渠道选择，内容策划，预售策略，口碑运营 |

---

## 20. 游戏与电竞

### 组合包 GAME-01：游戏开发与设计包

**适用场景：** 游戏开发团队、独立游戏开发者、游戏设计工作室

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-game-design` | 游戏设计，GDD 撰写，系统设计，数值设计，关卡设计 |
| 插件 | `dsh-plugin-game-development` | 游戏开发，代码管理，版本控制，Bug 跟踪 |
| 插件 | `dsh-plugin-game-asset` | 游戏资源管理，美术资源，音频资源，动画资源 |
| MCP | `unity-mcp` | Unity 引擎接口，场景操作，对象管理，脚本执行 |
| MCP | `unreal-mcp` | Unreal Engine 接口，蓝图操作，关卡编辑，资产管理 |
| MCP | `git-game-mcp` | Git 版本控制接口，代码仓库，分支管理，代码审查 |
| Skill | `gdd-writing` | 游戏设计文档撰写，核心玩法，系统设计，数值框架，经济系统，成长曲线，UI/UX |
| Skill | `game-balancing` | 游戏数值平衡，角色数值，装备数值，经济系统，难度曲线，PVP 平衡，数据驱动调整 |
| Skill | `level-design` | 关卡设计，关卡流程，空间布局，敌人配置，谜题设计，难度递进，玩家体验曲线 |

---

### 组合包 GAME-02：电竞俱乐部与赛事包

**适用场景：** 电竞俱乐部、电竞战队、电竞赛事方、电竞场馆

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-esports-team` | 电竞战队管理，选手管理，训练计划，比赛分析 |
| 插件 | `dsh-plugin-esports-event` | 电竞赛事管理，赛事策划，赛程编排，直播制作 |
| 插件 | `dsh-plugin-esports-venue` | 电竞场馆管理，场地运营，设备维护，赛事承办 |
| MCP | `game-data-mcp` | 游戏数据接口，比赛数据，选手数据，战术分析 |
| MCP | `streaming-platform-mcp` | 直播平台接口（斗鱼/虎牙/B站/Twitch），直播管理，弹幕互动 |
| MCP | `tournament-platform-mcp` | 赛事平台接口，报名管理，赛程管理，成绩统计 |
| Skill | `esports-training` | 电竞训练计划，战术训练，个人技术，团队配合，复盘分析，心理训练，体能管理 |
| Skill | `match-analysis` | 比赛复盘分析，数据统计，战术解读，失误分析，对手研究，改进方案，训练重点 |
| Skill | `esports-event-production` | 电竞赛事制作，赛事策划，赛程设计，OB 导播，解说安排，舞美灯光，互动环节 |

---

### 组合包 GAME-03：游戏运营与社区包

**适用场景：** 游戏运营团队、社区运营、玩家社区、游戏发行

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-game-operations` | 游戏运营管理，活动策划，版本更新，数据监控 |
| 插件 | `dsh-plugin-game-community` | 游戏社区管理，玩家互动，内容审核，社区活动 |
| 插件 | `dsh-plugin-game-customer-service` | 游戏客服，工单处理，BUG 反馈，玩家咨询 |
| MCP | `game-analytics-mcp` | 游戏数据分析接口，DAU/MAU，留存率，付费率，LTV |
| MCP | `discord-mcp` | Discord 社区接口，频道管理，消息发送，机器人 |
| MCP | `game-cs-mcp` | 游戏客服系统接口，工单管理，知识库，玩家信息 |
| Skill | `game-event-planning` | 游戏活动策划，节日活动，版本活动，付费活动，社交活动，奖励设计，数据预估 |
| Skill | `game-data-analysis` | 游戏数据分析，用户行为，留存分析，付费分析，流失预警，AB 测试，优化建议 |
| Skill | `community-operations-game` | 游戏社区运营，内容生态，KOL 培养，话题运营，活动策划，危机公关，社区氛围 |

---

## 21. 环保与碳中和

### 组合包 ENV-01：环境监测与治理包

**适用场景：** 环保公司、环境监测站、污染治理企业、环评机构

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-environmental-monitoring` | 环境监测管理，监测计划，数据采集，报告生成 |
| 插件 | `dsh-plugin-pollution-control` | 污染治理管理，治理方案，设备运行，效果评估 |
| 插件 | `dsh-plugin-eia` | 环境影响评价，报告编制，工程分析，环保措施 |
| MCP | `air-quality-mcp` | 空气质量监测接口，PM2.5/PM10，SO2/NOx/O3，AQI |
| MCP | `water-quality-monitoring-mcp` | 水质监测接口，COD/BOD，氨氮，总磷，重金属 |
| MCP | `noise-monitoring-mcp` | 噪声监测接口，声级计数据，频谱分析，达标判断 |
| Skill | `monitoring-report` | 环境监测报告，监测方案，数据整理，统计分析，达标评价，结论建议 |
| Skill | `pollution-treatment-design` | 污染治理方案设计，工艺选择，参数计算，设备选型，投资估算，运行成本，效果预测 |
| Skill | `eia-report-writing` | 环评报告编制，工程分析，现状调查，影响预测，环保措施，公众参与，结论建议 |

---

### 组合包 ENV-02：碳管理与碳中和包

**适用场景：** 企业碳管理部门、碳咨询公司、碳中和服务机构

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-carbon-management` | 碳管理体系，碳盘查，碳核算，减排目标 |
| 插件 | `dsh-plugin-carbon-consulting` | 碳咨询服务，碳战略，碳路径，碳资产开发 |
| 插件 | `dsh-plugin-esg-reporting` | ESG 报告，ESG 管理，指标体系，信息披露 |
| MCP | `carbon-factor-mcp` | 碳排放因子数据库接口，国家因子，区域因子，行业因子 |
| MCP | `carbon-market-data-mcp` | 碳市场数据接口，碳价行情，成交量，CCER 价格 |
| MCP | `esg-database-mcp` | ESG 数据库接口，评级数据，指标体系，行业基准 |
| Skill | `carbon-inventory` | 碳盘查执行，组织边界，运营边界，数据收集，排放计算，不确定性分析，盘查报告 |
| Skill | `carbon-neutrality-roadmap` | 碳中和路径规划，基线设定，情景分析，减排措施，成本效益，时间表，里程碑 |
| Skill | `esg-report-writing` | ESG 报告撰写，治理结构，环境绩效，社会影响，指标体系，案例故事，数据图表 |

---

### 组合包 ENV-03：循环经济与废弃物管理包

**适用场景：** 废弃物处理企业、回收公司、环卫企业、循环经济园区

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-waste-management` | 废弃物管理，收运计划，处理处置，台账记录 |
| 插件 | `dsh-plugin-recycling` | 资源回收，分类回收，再生利用，回收网络 |
| 插件 | `dsh-plugin-circular-economy` | 循环经济，产业链设计，资源效率，模式创新 |
| MCP | `waste-facility-mcp` | 废弃物处理设施接口，焚烧厂，填埋场，生化处理 |
| MCP | `recycling-market-mcp` | 再生资源市场接口，回收价格，供需信息，交易数据 |
| MCP | `hazardous-waste-mcp` | 危废管理接口，危废申报，转移联单，处置跟踪 |
| Skill | `waste-collection-route` | 废弃物收运路线优化，收集点规划，车辆调度，路径优化，成本分析，效率提升 |
| Skill | `recycling-business-model` | 回收商业模式设计，回收品类，定价策略，渠道建设，增值服务，盈利模式，扩张计划 |
| Skill | `circular-economy-design` | 循环经济方案设计，产业链分析，资源循环，产品生态设计，共享经济，产业共生，政策建议 |

---

## 22. 宠物行业

### 组合包 PET-01：宠物医院与诊疗包

**适用场景：** 宠物医院、动物诊所、兽医诊疗机构

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-veterinary-clinic` | 宠物诊疗管理，病历管理，处方开具，诊疗记录 |
| 插件 | `dsh-plugin-pet-health-record` | 宠物健康档案，疫苗记录，驱虫记录，体检报告 |
| 插件 | `dsh-plugin-veterinary-pharmacy` | 宠物药房管理，药品库存，处方审核，用药指导 |
| MCP | `veterinary-database-mcp` | 兽医数据库接口，疾病库，药品库，诊疗指南 |
| MCP | `lab-result-mcp` | 检验结果接口，血常规，生化，影像，病理 |
| MCP | `pet-microchip-mcp` | 宠物芯片接口，芯片登记，信息查询，失宠寻找 |
| Skill | `veterinary-diagnosis` | 宠物疾病诊断，病史采集，体格检查，实验室检查，鉴别诊断，治疗方案，预后判断 |
| Skill | `treatment-plan-pet` | 宠物治疗方案，用药计划，护理要求，复诊安排，费用预估，主人沟通，注意事项 |
| Skill | `pet-surgery` | 宠物手术管理，术前评估，麻醉方案，手术记录，术后护理，疼痛管理，并发症预防 |

---

### 组合包 PET-02：宠物美容与寄养包

**适用场景：** 宠物美容店、宠物寄养酒店、宠物生活馆

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-pet-grooming` | 宠物美容管理，预约管理，美容项目，造型设计 |
| 插件 | `dsh-plugin-pet-boarding` | 宠物寄养管理，房间管理，寄养计划，日常护理 |
| 插件 | `dsh-plugin-pet-retail` | 宠物用品零售，商品管理，库存管理，会员销售 |
| MCP | `pet-grooming-schedule-mcp` | 美容排期接口，预约管理，技师分配，服务记录 |
| MCP | `pet-hotel-mcp` | 宠物酒店接口，房间管理，入住登记，护理记录 |
| MCP | `pos-pet-mcp` | POS 收银接口，商品销售，会员积分，优惠券 |
| Skill | `pet-grooming-design` | 宠物美容造型设计，品种标准，客户需求，毛发状况，造型方案，护理建议，产品推荐 |
| Skill | `pet-boarding-care` | 宠物寄养护理，入住评估，喂养计划，运动安排，健康监测，行为观察，主人汇报 |
| Skill | `pet-retail-merchandising` | 宠物用品零售运营，选品策略，陈列设计，促销活动，会员运营，库存管理，销售分析 |

---

### 组合包 PET-03：宠物训练与行为包

**适用场景：** 宠物训练师、行为咨询师、训犬学校、宠物学校

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-pet-training` | 宠物训练管理，训练计划，课程安排，训练记录 |
| 插件 | `dsh-plugin-pet-behavior` | 宠物行为咨询，行为评估，行为矫正，主人指导 |
| 插件 | `dsh-plugin-pet-competition` | 宠物赛事管理，比赛报名，训练备战，成绩记录 |
| MCP | `dog-training-mcp` | 训犬接口，训练方法，指令库，行为记录 |
| MCP | `pet-behavior-mcp` | 宠物行为数据库，行为学资料，案例库，评估量表 |
| MCP | `pet-competition-mcp` | 宠物赛事接口，比赛信息，报名管理，成绩查询 |
| Skill | `dog-training-plan` | 训犬计划制定，基础服从，技能训练，行为塑造，训练方法，进度跟踪，主人配合 |
| Skill | `pet-behavior-correction` | 宠物行为矫正，行为评估，问题分析，矫正方案，环境管理，主人培训，效果评估 |
| Skill | `pet-competition-prep` | 宠物赛事备战，比赛项目，训练重点，体能管理，心理调节，赛场适应，比赛策略 |

---

## 23. 母婴与育儿

### 组合包 BABY-01：母婴护理与月子包

**适用场景：** 月子中心、母婴护理机构、产后康复中心、月嫂公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-postpartum-care` | 产后护理管理，产妇护理，月子餐，康复计划 |
| 插件 | `dsh-plugin-newborn-care` | 新生儿护理，喂养记录，睡眠记录，发育监测 |
| 插件 | `dsh-plugin-maternal-health` | 产妇健康管理，产后复查，心理评估，康复训练 |
| MCP | `maternal-health-mcp` | 产妇健康数据接口，体检数据，康复记录，心理评估 |
| MCP | `baby-growth-mcp` | 婴儿生长发育接口，身高体重，头围，发育里程碑 |
| MCP | `nutrition-maternal-mcp` | 母婴营养数据库，月子餐谱，哺乳期营养，辅食添加 |
| Skill | `postpartum-care-plan` | 产后护理计划，伤口护理，子宫恢复，恶露观察，乳房护理，康复训练，心理关怀 |
| Skill | `newborn-care-guide` | 新生儿护理指导，喂养指导，睡眠管理，脐带护理，黄疸观察，抚触按摩，早教启蒙 |
| Skill | `confinement-meal-planning` | 月子餐计划，排期调理，营养搭配，食材选择，烹饪方法，饮食禁忌，个性化调整 |

---

### 组合包 BABY-02：早教与亲子包

**适用场景：** 早教中心、亲子园、托育机构、儿童成长中心

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-early-education` | 早教管理，课程管理，教案设计，教学记录 |
| 插件 | `dsh-plugin-parent-child` | 亲子活动管理，活动策划，亲子课程，家庭指导 |
| 插件 | `dsh-plugin-child-development` | 儿童发展评估，发育测评，能力分析，成长档案 |
| MCP | `early-childhood-mcp` | 早教课程数据库，教案库，活动方案，教具清单 |
| MCP | `child-assessment-mcp` | 儿童评估量表接口，发育筛查，能力评估，气质类型 |
| MCP | `parenting-resource-mcp` | 育儿资源接口，育儿知识，家长课程，专家问答 |
| Skill | `early-education-curriculum` | 早教课程设计，年龄段划分，发展目标，活动方案，教具准备，观察记录，家园共育 |
| Skill | `child-development-assessment` | 儿童发展评估，大运动精细动作，语言认知，社会情绪，适应性，发展商数，干预建议 |
| Skill | `parenting-guidance` | 育儿指导，喂养睡眠，行为习惯，情绪管理，亲子沟通，家庭环境，常见问题 |

---

### 组合包 BABY-03：母婴零售与电商包

**适用场景：** 母婴店、母婴电商、母婴品牌、孕婴童连锁

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-maternity-retail` | 母婴零售管理，商品管理，库存管理，会员管理 |
| 插件 | `dsh-plugin-baby-products` | 母婴产品管理，产品库，产品评测，推荐方案 |
| 插件 | `dsh-plugin-maternity-marketing` | 母婴营销，内容营销，社群运营，活动策划 |
| MCP | `maternity-ecommerce-mcp` | 母婴电商接口，商品上架，订单管理，客户服务 |
| MCP | `baby-product-database-mcp` | 母婴产品数据库，产品信息，成分分析，安全评级 |
| MCP | `maternity-community-mcp` | 母婴社区接口，用户内容，问答互动，专家入驻 |
| Skill | `maternity-product-selection` | 母婴选品策略，品类规划，品牌选择，质量把控，价格带，利润分析，差异化竞争 |
| Skill | `maternity-content-marketing` | 母婴内容营销，育儿知识，产品测评，种草文案，短视频脚本，直播话术，KOL 合作 |
| Skill | `maternity-member-operations` | 母婴会员运营，会员分层，权益设计，成长体系，社群运营，复购提升，转介绍激励 |

---

## 24. 养老与康养

### 组合包 ELDER-01：养老机构与照护包

**适用场景：** 养老院、护理院、养老社区、长者照护中心

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-elderly-care` | 养老照护管理，老人档案，照护计划，护理记录 |
| 插件 | `dsh-plugin-nursing-management` | 护理管理，护理等级，护理排班，护理质量 |
| 插件 | `dsh-plugin-elderly-health` | 老人健康管理，健康档案，慢病管理，用药管理 |
| MCP | `ehr-elderly-mcp` | 老人电子健康档案接口，病历数据，体检报告，用药记录 |
| MCP | `care-plan-mcp` | 照护计划接口，评估量表，照护等级，服务清单 |
| MCP | `smart-elderly-mcp` | 智慧养老接口，智能床垫，跌倒检测，定位手环，紧急呼叫 |
| Skill | `elderly-care-assessment` | 老人照护评估，自理能力，认知功能，营养状况，心理状态，照护等级，服务计划 |
| Skill | `nursing-care-plan` | 护理计划制定，生活照料，医疗护理，康复训练，心理慰藉，临终关怀，质量标准 |
| Skill | `elderly-chronic-disease` | 老人慢病管理，高血压糖尿病，用药管理，饮食指导，运动建议，监测指标，急性事件预防 |

---

### 组合包 ELDER-02：居家养老与社区养老包

**适用场景：** 居家养老服务公司、社区养老服务中心、养老驿站

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-home-care` | 居家养老管理，上门服务，服务计划，服务记录 |
| 插件 | `dsh-plugin-community-elderly` | 社区养老管理，日间照料，助餐助浴，文娱活动 |
| 插件 | `dsh-plugin-elderly-family` | 家属沟通，远程探视，健康汇报，紧急通知 |
| MCP | `home-care-schedule-mcp` | 居家养老排期接口，服务人员，服务项目，时间安排 |
| MCP | `community-center-mcp` | 社区养老中心接口，场地管理，活动管理，助餐管理 |
| MCP | `family-communication-mcp` | 家属沟通接口，视频探视，消息推送，健康报告 |
| Skill | `home-care-service` | 居家养老服务，需求评估，服务设计，人员匹配，服务标准，质量监控，满意度调查 |
| Skill | `community-elderly-activities` | 社区养老活动，文娱活动，健康讲座，兴趣小组，节日庆祝，志愿者服务，社会参与 |
| Skill | `elderly-family-communication` | 老人家属沟通，健康汇报，生活照料，心理状态，紧急事件，沟通技巧，矛盾调解 |

---

### 组合包 ELDER-03：康复理疗与适老化包

**适用场景：** 康复中心、老年康复机构、适老化改造公司、辅具公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-elderly-rehab` | 老年康复管理，康复评估，康复计划，康复训练 |
| 插件 | `dsh-plugin-aging-in-place` | 适老化改造，居家评估，改造方案，产品推荐 |
| 插件 | `dsh-plugin-assistive-device` | 辅具管理，辅具评估，辅具适配，使用指导 |
| MCP | `rehab-equipment-elderly-mcp` | 老年康复设备接口，训练设备，评估设备，数据记录 |
| MCP | `home-assessment-mcp` | 居家环境评估接口，评估量表，风险识别，改造建议 |
| MCP | `assistive-technology-mcp` | 辅助技术数据库，辅具产品，适配指南，使用说明 |
| Skill | `elderly-rehabilitation` | 老年康复方案，功能评估，康复目标，训练计划，物理治疗，作业治疗，言语治疗 |
| Skill | `aging-in-place-design` | 适老化改造设计，居家评估，风险识别，空间改造，卫浴改造，厨房改造，智能设备，成本预算 |
| Skill | `assistive-device-prescription` | 辅具适配处方，功能评估，需求分析，辅具选择，适配调整，使用训练，维护保养，费用报销 |

---

## 25. 咨询与专业服务

### 组合包 CONSULT-01：管理咨询与战略包

**适用场景：** 管理咨询公司、战略咨询顾问、企业顾问

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-strategy-consulting` | 战略咨询管理，项目管理，分析框架，报告撰写 |
| 插件 | `dsh-plugin-management-consulting` | 管理咨询，组织设计，流程优化，绩效提升 |
| 插件 | `dsh-plugin-consulting-research` | 咨询研究，行业研究，市场调研，数据分析 |
| MCP | `consulting-framework-mcp` | 咨询框架数据库，分析模型，方法论，工具模板 |
| MCP | `industry-research-mcp` | 行业研究数据库，行业报告，市场数据，竞争情报 |
| MCP | `consulting-document-mcp` | 咨询文档接口，报告模板，PPT 模板，图表工具 |
| Skill | `strategy-analysis` | 战略分析，外部环境，内部能力，SWOT 分析，竞争格局，战略选择，实施路径 |
| Skill | `organizational-design` | 组织设计，组织结构，部门职责，岗位编制，管理幅度，汇报关系，变革管理 |
| Skill | `business-process-optimization` | 业务流程优化，流程梳理，瓶颈识别，价值流分析，流程再造，系统支撑，效果评估 |

---

### 组合包 CONSULT-02：IT 咨询与数字化包

**适用场景：** IT 咨询公司、数字化转型顾问、信息化规划专家

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-digital-transformation` | 数字化转型咨询，转型规划，能力评估，路线图 |
| 插件 | `dsh-plugin-it-consulting` | IT 咨询，IT 规划，系统选型，架构设计 |
| 插件 | `dsh-plugin-it-governance` | IT 治理，IT 管控，IT 审计，信息安全 |
| MCP | `enterprise-architecture-mcp` | 企业架构框架接口，TOGAF，业务架构，应用架构，数据架构，技术架构 |
| MCP | `it-system-database-mcp` | IT 系统数据库，系统清单，功能对比，厂商信息，价格参考 |
| MCP | `cybersecurity-framework-mcp` | 网络安全框架接口，等保 2.0，ISO 27001，NIST，控制措施 |
| Skill | `digital-transformation-roadmap` | 数字化转型路线图，现状评估，愿景目标，能力差距，优先级，项目组合，实施节奏，价值衡量 |
| Skill | `it-system-selection` | IT 系统选型，需求分析，功能清单，厂商调研，方案对比，POC 测试，商务谈判，决策建议 |
| Skill | `it-governance-design` | IT 治理设计，治理组织，决策机制，流程制度，绩效管理，风险管理，合规审计，持续改进 |

---

### 组合包 CONSULT-03：人力资源咨询包

**适用场景：** HR 咨询公司、组织发展顾问、人才管理专家

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-hr-consulting` | HR 咨询管理，HR 诊断，体系设计，项目实施 |
| 插件 | `dsh-plugin-talent-management` | 人才管理咨询，人才盘点，胜任力模型，发展通道 |
| 插件 | `dsh-plugin-od-consulting` | 组织发展咨询，组织诊断，文化建设，变革管理 |
| MCP | `hr-benchmark-mcp` | HR 基准数据接口，薪酬调研，组织效能，人才指标 |
| MCP | `competency-database-mcp` | 胜任力数据库，胜任力模型，行为指标，评估工具 |
| MCP | `org-diagnosis-mcp` | 组织诊断工具接口，诊断问卷，分析模型，报告模板 |
| Skill | `hr-system-design` | HR 体系设计，招聘体系，培训体系，薪酬体系，绩效体系，员工关系，制度流程 |
| Skill | `talent-review` | 人才盘点，九宫格，潜力评估，绩效评估，关键人才，继任计划，发展建议，人才地图 |
| Skill | `organizational-culture` | 组织文化建设，文化诊断，文化定位，价值观提炼，行为准则，文化落地，效果评估 |

---

## 26. 会计审计与税务

### 组合包 ACCT-01：会计核算与财务包

**适用场景：** 会计师事务所、代理记账公司、企业财务部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-accounting` | 会计核算管理，凭证管理，账簿管理，报表生成 |
| 插件 | `dsh-plugin-financial-reporting` | 财务报告管理，财报编制，附注披露，财报分析 |
| 插件 | `dsh-plugin-bookkeeping` | 代理记账管理，客户管理，票据处理，纳税申报 |
| MCP | `accounting-software-mcp` | 财务软件接口（用友/金蝶/SAP/Oracle），凭证，账簿，报表 |
| MCP | `invoice-mcp` | 发票接口，发票识别，验真查重，进项销项，电子发票 |
| MCP | `bank-statement-mcp` | 银行流水接口，对账单，交易明细，对账核销 |
| Skill | `financial-statement-preparation` | 财务报表编制，资产负债表，利润表，现金流量表，所有者权益变动表，附注，合并报表 |
| Skill | `month-end-close` | 月末结账流程，凭证审核，计提摊销，结转损益，对账调账，结账检查，报表出具 |
| Skill | `financial-analysis` | 财务分析，比率分析，趋势分析，结构分析，杜邦分析，预算差异，经营建议 |

---

### 组合包 ACCT-02：审计与内控包

**适用场景：** 审计师事务所、内部审计部门、内控咨询公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-audit-management` | 审计项目管理，审计计划，审计程序，工作底稿 |
| 插件 | `dsh-plugin-internal-control` | 内部控制管理，内控评价，风险评估，控制测试 |
| 插件 | `dsh-plugin-audit-reporting` | 审计报告管理，报告撰写，意见类型，管理建议 |
| MCP | `audit-working-paper-mcp` | 审计工作底稿接口，底稿模板，索引编号，复核记录 |
| MCP | `internal-control-framework-mcp` | 内控框架接口，COSO，企业内部控制基本规范，控制矩阵 |
| MCP | `audit-evidence-mcp` | 审计证据接口，函证，盘点，检查，观察，询问，分析程序 |
| Skill | `audit-planning` | 审计计划编制，业务了解，风险评估，重要性水平，审计策略，审计程序，时间预算，人员安排 |
| Skill | `substantive-testing` | 实质性测试，细节测试，分析程序，抽样方法，证据评价，差异调查，审计调整，结论形成 |
| Skill | `internal-control-evaluation` | 内部控制评价，控制设计，控制运行，缺陷识别，缺陷评级，整改建议，内控报告，管理建议书 |

---

### 组合包 ACCT-03：税务筹划与合规包

**适用场景：** 税务师事务所、税务咨询公司、企业税务部门

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-tax-planning` | 税务筹划管理，筹划方案，税负测算，风险评估 |
| 插件 | `dsh-plugin-tax-compliance` | 税务合规管理，纳税申报，发票管理，税务档案 |
| 插件 | `dsh-plugin-tax-consulting` | 税务咨询，政策解读，实务操作，争议解决 |
| MCP | `tax-policy-mcp` | 税收政策数据库接口，法律法规，政策文件，解读分析 |
| MCP | `tax-filing-mcp` | 纳税申报接口，电子税务局，申报表单，申报数据 |
| MCP | `transfer-pricing-mcp` | 转让定价接口，可比性分析，基准研究，文档要求 |
| Skill | `tax-planning-scheme` | 税务筹划方案，业务分析，政策适用，方案设计，税负测算，风险分析，实施步骤，效果预估 |
| Skill | `tax-risk-assessment` | 税务风险评估，风险识别，风险评级，风险矩阵，应对措施，内控建议，自查报告，整改方案 |
| Skill | `tax-dispute-resolution` | 税务争议解决，案情分析，法律依据，证据组织，沟通策略，听证申辩，行政复议，行政诉讼 |

---

## 27. 翻译与本地化

### 组合包 TRANS-01：翻译服务与项目包

**适用场景：** 翻译公司、翻译团队、自由译者、本地化公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-translation-project` | 翻译项目管理，项目报价，任务分配，进度跟踪 |
| 插件 | `dsh-plugin-translation-memory` | 翻译记忆管理，TM 库，术语库，重复利用 |
| 插件 | `dsh-plugin-translation-quality` | 翻译质量管理，QA 检查，错误统计，质量评分 |
| MCP | `cat-tool-mcp` | CAT 工具接口（Trados/memoQ/Wordfast），项目文件，翻译记忆，术语库 |
| MCP | `machine-translation-mcp` | 机器翻译接口（DeepL/Google/百度/有道），MT 翻译，译后编辑 |
| MCP | `terminology-mcp` | 术语库接口，术语管理，术语提取，术语一致性 |
| Skill | `translation-project-management` | 翻译项目管理，需求分析，字数统计，报价方案，团队组建，排期计划，质量控制，交付验收 |
| Skill | `translation-quality-assurance` | 翻译质量保证，QA 检查清单，错误分类，抽样检查，评分标准，反馈机制，改进措施，译者评估 |
| Skill | `localization-engineering` | 本地化工程，文件解析，格式处理，资源提取，翻译集成，编译测试，缺陷修复，交付打包 |

---

### 组合包 TRANS-02：本地化与国际化包

**适用场景：** 软件本地化公司、游戏本地化、网站本地化、产品国际化团队

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-software-localization` | 软件本地化，资源文件，界面翻译，测试验证 |
| 插件 | `dsh-plugin-website-localization` | 网站本地化，多语言网站，SEO 本地化，内容翻译 |
| 插件 | `dsh-plugin-game-localization` | 游戏本地化，文本翻译，文化适配，配音字幕，LQA |
| MCP | `i18n-framework-mcp` | 国际化框架接口（i18next/react-intl/vue-i18n），资源管理，语言切换 |
| MCP | `cms-multilingual-mcp` | 多语言 CMS 接口，内容管理，多语言发布，翻译工作流 |
| MCP | `game-localization-mcp` | 游戏本地化接口，文本提取，字符串管理，文化适配检查 |
| Skill | `software-localization-process` | 软件本地化流程，资源提取，翻译管理，UI 适配，功能测试，Bug 修复，多语言发布，持续维护 |
| Skill | `cultural-adaptation` | 文化适配，文化差异分析，内容调整，禁忌规避，本地化创意，用户体验，市场接受度，品牌一致性 |
| Skill | `multilingual-seo` | 多语言 SEO，关键词研究，元数据优化，URL 结构，hreflang 标签，内容本地化，链接建设，排名跟踪 |

---

### 组合包 TRANS-03：口译与会议服务包

**适用场景：** 口译公司、会议服务公司、同传译员、交传译员

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-consecutive-interpreting` | 交替传译管理，会议准备，术语准备，口译记录 |
| 插件 | `dsh-plugin-simultaneous-interpreting` | 同声传译管理，同传设备，同传箱，同传团队 |
| 插件 | `dsh-plugin-conference-services` | 会议服务管理，会议策划，设备租赁，人员安排 |
| MCP | `conference-management-mcp` | 会议管理接口，会议日程，参会人员，会议资料 |
| MCP | `interpreting-equipment-mcp` | 口译设备接口，同传设备，导览设备，投票设备 |
| MCP | `speech-to-text-mcp` | 语音转文字接口，实时转写，会议记录，字幕生成 |
| Skill | `conference-preparation` | 会议口译准备，背景调研，术语准备，资料预读，演讲者分析，场景模拟，团队协调，应急预案 |
| Skill | `simultaneous-interpreting` | 同声传译执行，听辨理解，记忆转换，表达输出，团队配合，设备操作，质量监控，应急处理 |
| Skill | `conference-service-planning` | 会议服务策划，会议方案，场地选择，设备配置，人员安排，流程设计，预算编制，现场执行 |

---

## 28. 婚庆与礼仪

### 组合包 WED-01：婚礼策划与执行包

**适用场景：** 婚礼策划公司、婚礼策划师、婚庆工作室

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-wedding-planning` | 婚礼策划管理，方案设计，预算编制，流程安排 |
| 插件 | `dsh-plugin-wedding-execution` | 婚礼执行管理，当天流程，人员调度，现场协调 |
| 插件 | `dsh-plugin-wedding-vendor` | 婚礼供应商管理，场地，摄影，化妆，花艺，司仪 |
| MCP | `wedding-venue-mcp` | 婚礼场地接口，场地信息，档期查询，价格查询，预订管理 |
| MCP | `wedding-vendor-mcp` | 婚礼供应商数据库，供应商信息，服务项目，评价评分，案例展示 |
| MCP | `wedding-inspiration-mcp` | 婚礼灵感库，风格参考，配色方案，花艺设计，布置案例 |
| Skill | `wedding-concept-design` | 婚礼概念设计，新人故事，主题定位，风格选择，色彩搭配，空间设计，仪式流程，情感表达 |
| Skill | `wedding-budget-planning` | 婚礼预算编制，预算分配，项目明细，供应商报价，成本控制，超支预警，结算管理，性价比分析 |
| Skill | `wedding-day-coordination` | 婚礼当天执行，流程把控，人员调度，供应商协调，突发处理，时间管理，新人关怀，完美交付 |

---

### 组合包 WED-02：婚纱摄影与影像包

**适用场景：** 婚纱摄影工作室、摄影团队、影像制作公司

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-wedding-photography` | 婚纱摄影管理，拍摄计划，拍摄流程，选片管理 |
| 插件 | `dsh-plugin-photo-retouching` | 照片修图管理，修图标准，修图流程，质量检查 |
| 插件 | `dsh-plugin-wedding-video` | 婚礼视频管理，视频拍摄，剪辑制作，成品交付 |
| MCP | `photo-management-mcp` | 照片管理接口，图库管理，相册制作，在线选片 |
| MCP | `photo-editing-mcp` | 照片编辑接口，批量处理，滤镜预设，AI 修图 |
| MCP | `video-editing-mcp` | 视频编辑接口，剪辑软件，素材管理，特效模板 |
| Skill | `wedding-photography-plan` | 婚纱摄影方案，风格定位，场景选择，服装搭配，拍摄流程，光线设计，姿势引导，情感捕捉 |
| Skill | `photo-retouching-workflow` | 照片修图流程，初修精修，调色风格，皮肤处理，身材修饰，背景优化，批量处理，质量标准 |
| Skill | `wedding-film-production` | 婚礼影片制作，拍摄脚本，镜头设计，素材整理，剪辑节奏，音乐选择，调色包装，情感叙事 |

---

### 组合包 WED-03：庆典礼仪与活动包

**适用场景：** 庆典公司、礼仪公司、活动策划公司、商业活动团队

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-ceremony-planning` | 庆典策划管理，方案设计，流程编排，仪式设计 |
| 插件 | `dsh-plugin-protocol-etiquette` | 礼仪管理，礼仪规范，人员培训，现场执行 |
| 插件 | `dsh-plugin-corporate-event` | 企业活动管理，年会，发布会，颁奖典礼，团建 |
| MCP | `event-venue-mcp` | 活动场地接口，酒店，会议中心，展览场馆，户外场地 |
| MCP | `event-supplier-mcp` | 活动供应商数据库，搭建，灯光音响，演艺，主持 |
| MCP | `event-registration-mcp` | 活动报名接口，签到管理，票务销售，嘉宾管理 |
| Skill | `ceremony-ritual-design` | 庆典仪式设计，仪式流程，环节设计，象征意义，文化内涵，情感升华，视觉呈现，音乐配合 |
| Skill | `corporate-annual-meeting` | 企业年会策划，主题设计，节目编排，流程安排，互动环节，颁奖设计，预算管理，执行保障 |
| Skill | `product-launch-event` | 产品发布会策划，发布会主题，场地选择，舞台设计，流程安排，媒体邀请，传播策略，效果评估 |

---

## 29. 美容美业

### 组合包 BEAUTY-01：美容护肤与皮肤管理包

**适用场景：** 美容院、皮肤管理中心、医美机构、护肤工作室

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-skin-management` | 皮肤管理，皮肤检测，护理方案，疗程管理 |
| 插件 | `dsh-plugin-beauty-treatment` | 美容项目管理，项目库，操作流程，效果跟踪 |
| 插件 | `dsh-plugin-skincare-product` | 护肤产品管理，产品库，成分分析，产品推荐 |
| MCP | `skin-analysis-mcp` | 皮肤检测接口，皮肤检测仪，AI 肤诊，检测报告 |
| MCP | `skincare-ingredient-mcp` | 护肤成分数据库，成分功效，安全性，搭配禁忌，敏感风险 |
| MCP | `beauty-device-mcp` | 美容设备接口，光电设备，射频仪，水光仪，操作记录 |
| Skill | `skin-analysis-report` | 皮肤检测报告，肤质类型，问题分析，成因解读，严重程度，护理重点，产品建议，生活方式 |
| Skill | `facial-treatment-plan` | 面部护理方案，项目选择，疗程设计，操作步骤，产品搭配，居家护理，效果预期，注意事项 |
| Skill | `skincare-product-recommendation` | 护肤产品推荐，肤质匹配，成分分析，功效需求，预算范围，产品组合，使用顺序，替代方案 |

---

### 组合包 BEAUTY-02：美发造型与美甲包

**适用场景：** 美发沙龙、美甲店、美睫店、造型工作室

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-hair-salon` | 美发管理，发型设计，烫染管理，造型记录 |
| 插件 | `dsh-plugin-nail-art` | 美甲管理，款式设计，美甲记录，作品管理 |
| 插件 | `dsh-plugin-beauty-booking` | 美业预约管理，预约排期，技师分配，到店管理 |
| MCP | `hair-color-mcp` | 染发配方接口，色板，配方库，调色计算，效果预览 |
| MCP | `nail-design-mcp` | 美甲设计库，款式图库，教程，素材，灵感 |
| MCP | `salon-booking-mcp` | 美业预约系统接口，在线预约，排班管理，会员管理 |
| Skill | `hair-style-design` | 发型设计，脸型分析，发质评估，风格匹配，发型建议，发色推荐，烫染方案，日常打理 |
| Skill | `nail-art-design` | 美甲款式设计，甲型选择，配色方案，图案设计，风格定位，季节主题，场合适配，操作步骤 |
| Skill | `salon-operations` | 美发沙龙运营，排班管理，技师绩效，客户管理，库存管理，促销活动，服务流程，客户体验 |

---

### 组合包 BEAUTY-03：医美与轻医美包

**适用场景：** 医美机构、轻医美诊所、皮肤医美中心、医疗美容医院

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-medical-aesthetics` | 医美管理，咨询设计，项目管理，诊疗记录 |
| 插件 | `dsh-plugin-aesthetics-consultation` | 医美咨询，面诊设计，方案制定，客户沟通 |
| 插件 | `dsh-plugin-aesthetics-aftercare` | 医美术后管理，恢复跟踪，护理指导，效果评估 |
| MCP | `aesthetics-project-mcp` | 医美项目数据库，项目信息，适应症，禁忌症，价格，恢复期 |
| MCP | `before-after-photo-mcp` | 术前术后照片接口，照片管理，对比分析，效果评估 |
| MCP | `medical-record-mcp` | 医美病历接口，电子病历，诊疗记录，知情同意，处方管理 |
| Skill | `aesthetics-consultation-design` | 医美咨询设计，需求分析，美学评估，方案设计，项目组合，价格方案，风险告知，预期管理 |
| Skill | `aesthetics-treatment-plan` | 医美治疗方案，项目选择，治疗顺序，参数设置，操作规范，麻醉管理，应急处理，质量控制 |
| Skill | `aesthetics-post-care` | 医美术后护理，恢复指导，护理产品，注意事项，复查安排，并发症预防，效果评估，满意度管理 |

---

## 30. 殡葬与生命服务

### 组合包 FUNERAL-01：殡葬服务与礼仪包

**适用场景：** 殡仪馆、殡葬服务公司、礼仪服务公司、陵园

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-funeral-service` | 殡葬服务管理，服务套餐，流程安排，人员调度 |
| 插件 | `dsh-plugin-funeral-ritual` | 殡葬礼仪管理，仪式设计，流程编排，礼仪执行 |
| 插件 | `dsh-plugin-funeral-products` | 殡葬用品管理，寿衣，骨灰盒，花圈，随葬品 |
| MCP | `funeral-home-mcp` | 殡仪馆接口，厅房管理，火化预约，服务项目，价格查询 |
| MCP | `cemetery-mcp` | 陵园接口，墓位管理，选墓系统，价格查询，预约祭扫 |
| MCP | `funeral-product-mcp` | 殡葬用品数据库，产品信息，材质工艺，价格，定制服务 |
| Skill | `funeral-service-planning` | 殡葬服务方案，需求了解，服务选择，流程安排，人员配置，物品准备，预算编制，家属沟通 |
| Skill | `memorial-ceremony-design` | 告别仪式设计，仪式主题，流程编排，音乐选择，视频制作，花艺布置，悼词撰写，情感表达 |
| Skill | `funeral-ritual-etiquette` | 殡葬礼仪规范，传统礼仪，现代礼仪，宗教礼仪，地域习俗，亲属礼节，吊唁礼节，谢礼流程 |

---

### 组合包 FUNERAL-02：陵园与墓地管理包

**适用场景：** 陵园公司、公墓管理处、墓地销售、殡葬地产

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-cemetery-sales` | 陵园销售管理，墓位销售，客户跟进，合同签订 |
| 插件 | `dsh-plugin-cemetery-management` | 陵园运营管理，墓位管理，维护管理，祭扫管理 |
| 插件 | `dsh-plugin-memorial-architecture` | 纪念建筑设计，墓碑设计，家族墓，艺术墓 |
| MCP | `cemetery-gis-mcp` | 陵园 GIS 接口，墓区地图，墓位定位，选墓可视化 |
| MCP | `tombstone-design-mcp` | 墓碑设计库，款式图库，材质工艺，雕刻图案，定制设计 |
| MCP | `cemetery-maintenance-mcp` | 陵园维护接口，绿化养护，清洁管理，维修记录，巡检管理 |
| Skill | `cemetery-sales-consultation` | 陵园销售咨询，需求分析，风水介绍，墓位推荐，价格方案，合同条款，售后服务，客户维护 |
| Skill | `tombstone-custom-design` | 墓碑定制设计，风格定位，材质选择，尺寸规格，雕刻内容，碑文撰写，工艺说明，效果预览 |
| Skill | `cemetery-operations-management` | 陵园运营管理，墓区规划，销售管理，维护管理，祭扫管理，安全管理，环境管理，品牌建设 |

---

### 组合包 FUNERAL-03：生命教育与哀伤辅导包

**适用场景：** 生命教育机构、哀伤辅导中心、心理咨询机构、临终关怀机构

| 类型 | 名称 | 功能说明 |
|------|------|----------|
| 插件 | `dsh-plugin-life-education` | 生命教育管理，课程设计，活动策划，教材管理 |
| 插件 | `dsh-plugin-grief-counseling` | 哀伤辅导管理，个案管理，辅导计划，团体辅导 |
| 插件 | `dsh-plugin-hospice-care` | 临终关怀管理，安宁疗护，心理支持，家属陪伴 |
| MCP | `grief-assessment-mcp` | 哀伤评估接口，评估量表，阶段判断，风险筛查 |
| MCP | `life-education-resource-mcp` | 生命教育资源库，课程教案，活动方案，绘本影视 |
| MCP | `hospice-care-mcp` | 临终关怀接口，安宁疗护指南，疼痛管理，心理支持 |
| Skill | `life-education-curriculum` | 生命教育课程设计，年龄分段，主题设计，教学目标，活动方案，教学方法，评估方式，家校协同 |
| Skill | `grief-counseling-session` | 哀伤辅导个案，初次访谈，哀伤评估，阶段判断，辅导目标，干预方法，家庭支持，转介机制，效果评估 |
| Skill | `hospice-care-plan` | 临终关怀计划，需求评估，疼痛管理，症状控制，心理支持，灵性关怀，家属陪伴，临终准备，哀伤随访 |

---

## 组合包安装配置指南

### 安装方式

#### 1. 插件安装

```bash
# 通过 DSH 插件管理器安装
dsh plugin install dsh-plugin-filesystem

# 从 GitHub 安装
dsh plugin install https://github.com/DSH-Team/dsh-plugin-filesystem

# 本地安装
dsh plugin install ./path/to/plugin
```

#### 2. MCP 服务器配置

在 DSH 配置文件中添加 MCP 服务器：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost:5432/db"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token"
      }
    }
  }
}
```

#### 3. Skill 安装

```bash
# 安装技能包
dsh skill install document-processing

# 从市场安装
dsh skill install --market dsh-skill-market

# 启用技能
dsh skill enable data-analysis-basic
```

### 组合包推荐配置

#### 初创企业最小配置

| 组合包 | 说明 |
|--------|------|
| G-01 文件与办公基础包 | 日常办公必备 |
| G-02 网络与信息检索包 | 信息搜集必备 |
| G-03 通信与协作包 | 团队协作必备 |
| 行业专属组合包 × 1 | 根据行业选择 |

#### 中型企业标准配置

| 组合包 | 说明 |
|--------|------|
| G-01 ~ G-04 全部通用包 | 完整基础能力 |
| 行业专属组合包 × 2-3 | 核心业务场景 |
| IT-01 代码开发包（如有技术团队） | 内部开发支持 |

#### 大型企业完整配置

| 组合包 | 说明 |
|--------|------|
| 全部通用基础包 | G-01 ~ G-04 |
| 行业专属组合包 × 3-5 | 覆盖主要业务线 |
| IT 运维组合包 | IT-01 ~ IT-03 |
| 人力资源组合包 | HR-01 ~ HR-03 |
| 定制开发 | 根据特殊需求定制 |

### 注意事项

1. **数据安全**：涉及敏感数据的 MCP 服务器（如数据库、文件系统）必须配置访问权限控制，限制可访问的目录和数据库
2. **API 密钥**：需要 API 密钥的 MCP 服务器（如 GitHub、Slack）请妥善保管密钥，不要提交到代码仓库
3. **性能考虑**：同时启用过多 MCP 服务器可能影响性能，建议根据实际需求启用，不需要的及时禁用
4. **版本兼容**：不同版本的 MCP 服务器可能存在接口差异，建议使用经过测试的稳定版本
5. **网络要求**：部分 MCP 服务器需要访问外部 API，请确保网络连通性，必要时配置代理

---

**文档结束**

> 本文档为 DSH 各行业插件/MCP/Skill 组合包参考目录，实际使用时请根据具体业务需求选择和定制。组合包列表将持续更新，建议定期查看最新版本。

---

## 全行业组合包总览

### 覆盖行业与组合包统计

| 序号 | 行业 | 组合包数 | 核心场景 |
|------|------|----------|----------|
| - | 通用基础 | 4 | 文件办公、网络检索、通信协作、数据数据库 |
| 1 | 医疗健康 | 3 | 临床病历、健康管理、医疗营销 |
| 2 | 法律合规 | 3 | 合同审查、诉讼案件、合规风控 |
| 3 | 金融财经 | 3 | 投资研究、银行信贷、保险业务 |
| 4 | 教育培训 | 3 | 课程教学、学生管理、升学规划 |
| 5 | 电商零售 | 3 | 商品运营、客服售后、营销推广 |
| 6 | 制造业/工业 | 3 | 生产排程、质量控制、供应链采购 |
| 7 | 房地产/建筑 | 3 | 房产销售、工程管理、物业管理 |
| 8 | 媒体/内容 | 3 | 短视频、图文创作、品牌营销 |
| 9 | 政府/公共服务 | 3 | 政务公文、民生服务、城市应急 |
| 10 | IT/软件开发 | 3 | 代码开发、DevOps运维、数据库分析 |
| 11 | 农业 | 3 | 种植精准农业、农产品销售、畜牧养殖 |
| 12 | 物流/供应链 | 3 | 运输配送、仓储库存、供应链协同 |
| 13 | 旅游/酒店 | 3 | 旅行社行程、酒店运营、旅游营销 |
| 14 | 餐饮 | 3 | 餐厅运营、菜品研发、营销外卖 |
| 15 | 人力资源 | 3 | 招聘人才、员工发展、薪酬福利 |
| 16 | 汽车行业 | 3 | 汽车销售、维修保养、制造供应链 |
| 17 | 能源与公用事业 | 3 | 电力电网、新能源、油气水务燃气 |
| 18 | 体育与健身 | 3 | 健身俱乐部、体育赛事、运动康复 |
| 19 | 文化艺术与文博 | 3 | 博物馆、艺术画廊、演出演艺 |
| 20 | 游戏与电竞 | 3 | 游戏开发、电竞俱乐部、游戏运营 |
| 21 | 环保与碳中和 | 3 | 环境监测、碳管理、循环经济 |
| 22 | 宠物行业 | 3 | 宠物医院、美容寄养、训练行为 |
| 23 | 母婴与育儿 | 3 | 月子护理、早教亲子、母婴零售 |
| 24 | 养老与康养 | 3 | 养老机构、居家社区、康复适老 |
| 25 | 咨询与专业服务 | 3 | 管理咨询、IT咨询、HR咨询 |
| 26 | 会计审计与税务 | 3 | 会计核算、审计内控、税务筹划 |
| 27 | 翻译与本地化 | 3 | 翻译服务、软件本地化、口译会议 |
| 28 | 婚庆与礼仪 | 3 | 婚礼策划、婚纱摄影、庆典活动 |
| 29 | 美容美业 | 3 | 皮肤管理、美发美甲、医美轻医美 |
| 30 | 殡葬与生命服务 | 3 | 殡葬礼仪、陵园墓地、生命教育 |

**合计：30 个行业 × 3 个组合包 + 4 个通用基础包 = 94 个组合包**

### 每个组合包包含

| 类型 | 说明 | 平均数量 |
|------|------|----------|
| 插件 (Plugin) | DSH 生态功能扩展模块 | 3 个 |
| MCP 服务器 | Model Context Protocol 外部工具连接 | 3-4 个 |
| Skill 技能包 | 可复用的业务能力/工作流 | 3 个 |

---

**文档结束**

> 本文档为 DSH 各行业插件/MCP/Skill 组合包大全完整版，覆盖 30 个行业、94 个组合包。组合包列表将持续更新，建议定期查看最新版本。
