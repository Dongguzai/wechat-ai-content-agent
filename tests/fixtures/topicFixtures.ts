export type ExpectedTopicDomain =
  | "model"
  | "product"
  | "tooling"
  | "research"
  | "business"
  | "policy"
  | "application"
  | "creator"
  | "security"
  | "other";

export type ExpectedTopicEventType =
  | "launch"
  | "update"
  | "benchmark"
  | "pricing"
  | "funding"
  | "acquisition"
  | "regulation"
  | "case_study"
  | "incident"
  | "opinion"
  | "tutorial"
  | "research_release";

export type ExpectedContentMode =
  | "news_analysis"
  | "comparison"
  | "explainer"
  | "trend_analysis"
  | "case_review"
  | "practical_guide";

export interface TopicFixture {
  id: string;
  category: string;
  inputTopic: {
    title: string;
    summary: string;
    sourceUrl: string;
    sourceName: string;
  };
  expectedPrimaryDomain: ExpectedTopicDomain;
  expectedEventTypes: ExpectedTopicEventType[];
  expectedRiskDimensions: string[];
  expectedContentMode: ExpectedContentMode;
  forbiddenUnrelatedConcepts: string[];
}

export const defaultLegacyCodingAgentPollution = [
  "Claude Code",
  "Goose",
  "Max 20x",
  "200 美元",
  "200美元",
  "$200",
  "免费平替",
  "工具锁定"
];

export const topicFixtures: TopicFixture[] = [
  {
    id: "model-launch-gpt-next",
    category: "新模型发布",
    inputTopic: {
      title: "OpenAI 发布新一代多模态模型，强调实时语音和长上下文能力",
      summary: "官方博客介绍新模型在语音、图像理解和工具调用上的升级，但部分功能分批开放。",
      sourceUrl: "https://openai.com/index/example-model-launch",
      sourceName: "OpenAI Blog"
    },
    expectedPrimaryDomain: "model",
    expectedEventTypes: ["launch"],
    expectedRiskDimensions: ["可用范围", "性能口径", "分批开放"],
    expectedContentMode: "news_analysis",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "product-update-workspace-agent",
    category: "产品功能更新",
    inputTopic: {
      title: "Notion 推出企业知识库 Agent，可跨页面检索并生成项目摘要",
      summary: "更新面向团队工作区开放，重点是权限继承、知识检索和项目状态同步。",
      sourceUrl: "https://www.notion.so/releases/example-workspace-agent",
      sourceName: "Notion Releases"
    },
    expectedPrimaryDomain: "product",
    expectedEventTypes: ["update"],
    expectedRiskDimensions: ["权限边界", "企业可用性", "数据隐私"],
    expectedContentMode: "practical_guide",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "pricing-ai-api",
    category: "AI 工具定价",
    inputTopic: {
      title: "某 AI 视频生成 API 调整价格，新增年付套餐和超额用量计费",
      summary: "厂商公告称新版价格下月生效，订阅、API 调用和团队席位采用不同计费方式。",
      sourceUrl: "https://example.ai/pricing-update",
      sourceName: "Example AI"
    },
    expectedPrimaryDomain: "tooling",
    expectedEventTypes: ["pricing", "update"],
    expectedRiskDimensions: ["币种", "生效日期", "免费层边界", "订阅与 API 差异"],
    expectedContentMode: "comparison",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "benchmark-agent-eval",
    category: "benchmark 对比",
    inputTopic: {
      title: "新企业 Agent benchmark 显示多款模型在跨系统 IT 任务上表现差异明显",
      summary: "论文和榜单披露测试环境、任务类型和评分口径，部分结果来自厂商自测。",
      sourceUrl: "https://arxiv.org/abs/2607.00001",
      sourceName: "arXiv"
    },
    expectedPrimaryDomain: "research",
    expectedEventTypes: ["benchmark", "research_release"],
    expectedRiskDimensions: ["指标定义", "测试条件", "厂商自测", "第三方复现"],
    expectedContentMode: "comparison",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "research-paper-robot-planning",
    category: "研究论文",
    inputTopic: {
      title: "研究团队提出用于机器人长程规划的新型世界模型方法",
      summary: "论文报告模拟环境和真实机器人任务结果，并讨论泛化限制。",
      sourceUrl: "https://arxiv.org/abs/2607.00002",
      sourceName: "arXiv"
    },
    expectedPrimaryDomain: "research",
    expectedEventTypes: ["research_release"],
    expectedRiskDimensions: ["实验设置", "样本规模", "泛化限制", "论文未同行评审"],
    expectedContentMode: "explainer",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "open-source-project-rag",
    category: "开源项目",
    inputTopic: {
      title: "开源 RAG 框架发布 1.0 版本，新增企业权限和评估模块",
      summary: "GitHub release 显示项目进入稳定版本，维护者列出迁移指南和破坏性变更。",
      sourceUrl: "https://github.com/example/rag-framework/releases/tag/v1.0.0",
      sourceName: "GitHub"
    },
    expectedPrimaryDomain: "tooling",
    expectedEventTypes: ["launch", "update"],
    expectedRiskDimensions: ["开源许可", "维护活跃度", "版本兼容", "安全依赖"],
    expectedContentMode: "practical_guide",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "startup-funding-ai-search",
    category: "创业融资",
    inputTopic: {
      title: "AI 搜索创业公司完成 B 轮融资，计划扩展企业知识检索产品",
      summary: "公司公告披露融资金额、投资方和资金用途，估值信息来自媒体援引消息人士。",
      sourceUrl: "https://example.com/news/ai-search-series-b",
      sourceName: "Company Newsroom"
    },
    expectedPrimaryDomain: "business",
    expectedEventTypes: ["funding"],
    expectedRiskDimensions: ["融资金额", "轮次", "投资方", "估值确认状态"],
    expectedContentMode: "news_analysis",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "acquisition-ai-chip",
    category: "企业并购",
    inputTopic: {
      title: "大型云厂商宣布收购 AI 芯片软件团队，强化推理优化工具链",
      summary: "交易仍需监管审批，双方未披露完整价格和整合时间表。",
      sourceUrl: "https://examplecloud.com/news/ai-chip-acquisition",
      sourceName: "Example Cloud"
    },
    expectedPrimaryDomain: "business",
    expectedEventTypes: ["acquisition"],
    expectedRiskDimensions: ["交易价格", "监管审批", "整合计划", "竞争影响"],
    expectedContentMode: "trend_analysis",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "regulation-ai-act",
    category: "政策法规",
    inputTopic: {
      title: "欧盟发布生成式 AI 透明度义务实施指引，明确适用对象和生效时间",
      summary: "政策原文区分模型提供方、部署方和下游应用，不同义务分阶段执行。",
      sourceUrl: "https://digital-strategy.ec.europa.eu/example-ai-guidance",
      sourceName: "European Commission"
    },
    expectedPrimaryDomain: "policy",
    expectedEventTypes: ["regulation"],
    expectedRiskDimensions: ["司法辖区", "正式法规或指引", "生效时间", "适用对象", "合规义务"],
    expectedContentMode: "explainer",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "security-incident-model-leak",
    category: "安全事故",
    inputTopic: {
      title: "某 AI 平台披露日志配置错误，部分企业对话元数据被短暂暴露",
      summary: "官方事故报告说明影响范围、修复时间和后续补救措施，尚未发现正文内容泄露。",
      sourceUrl: "https://status.example.ai/incidents/metadata-exposure",
      sourceName: "Example AI Status"
    },
    expectedPrimaryDomain: "security",
    expectedEventTypes: ["incident"],
    expectedRiskDimensions: ["影响范围", "披露时间线", "用户数据类型", "修复状态"],
    expectedContentMode: "case_review",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "enterprise-case-study-agent",
    category: "企业应用案例",
    inputTopic: {
      title: "制造企业公开 AI 质检案例，称缺陷复核流程耗时下降",
      summary: "案例材料来自供应商联合发布，包含节省时间指标但缺少第三方审计。",
      sourceUrl: "https://example-vendor.com/customers/manufacturing-ai-quality",
      sourceName: "Vendor Customer Story"
    },
    expectedPrimaryDomain: "application",
    expectedEventTypes: ["case_study"],
    expectedRiskDimensions: ["供应商案例偏差", "指标口径", "可迁移性", "人工复核"],
    expectedContentMode: "case_review",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  },
  {
    id: "creator-tool-video",
    category: "AI 创作者工具",
    inputTopic: {
      title: "AI 创作者工具新增故事板和多镜头一致性控制，面向短视频团队开放",
      summary: "产品公告展示创作者工作流更新，但生成质量、版权和商业授权仍需核验。",
      sourceUrl: "https://creator.example.ai/releases/storyboard-control",
      sourceName: "Creator AI"
    },
    expectedPrimaryDomain: "creator",
    expectedEventTypes: ["update", "launch"],
    expectedRiskDimensions: ["版权授权", "生成质量", "可用地区", "商用许可"],
    expectedContentMode: "practical_guide",
    forbiddenUnrelatedConcepts: defaultLegacyCodingAgentPollution
  }
];
