import type { RawNewsItem, SearchProvider } from "../types/news.js";

interface MockRssTemplate {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  snippet: string;
  hoursAgo: number;
  rawContent?: string;
  highHeat?: boolean;
}

interface MockSearchTemplate {
  title: string;
  url: string;
  sourceName: string;
  snippet: string;
  hoursAgo: number;
  highHeat?: boolean;
}

function isoHoursAgo(now: Date, hoursAgo: number): string {
  return new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
}

const mockRssTemplates: MockRssTemplate[] = [
  {
    id: "rss-claude-code-goose",
    title: "Claude Code costs up to $200 a month. Goose does the same thing for free.",
    url: "https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free",
    sourceName: "VentureBeat AI",
    snippet:
      "Claude Code has paid subscription paths while Goose is described as a free open source AI agent, raising developer workflow, cost, and lock-in questions.",
    hoursAgo: 4,
    highHeat: true
  },
  {
    id: "rss-openai-agent-workbench",
    title: "OpenAI 发布多模态 Agent 工作台，企业内容流程开始重组",
    url: "https://example.com/rss/openai-agent-workbench",
    sourceName: "Mock RSS / OpenAI News",
    snippet:
      "新的 AI agent 工作台展示资料整理、图文理解、任务编排和团队审计能力，适合内容、客服和研究团队试点。",
    hoursAgo: 6,
    highHeat: true
  },
  {
    id: "rss-anthropic-managed-agents",
    title: "Anthropic 推出托管 Agent 能力，降低企业部署门槛",
    url: "https://example.com/rss/anthropic-managed-agents",
    sourceName: "Mock RSS / Anthropic News",
    snippet:
      "托管式 AI agent 服务把权限、工具调用、日志和人工接管放进统一控制面板，强调安全和可审计。",
    hoursAgo: 9
  },
  {
    id: "rss-deepmind-multimodal-report",
    title: "Google DeepMind 公开新多模态模型技术报告",
    url: "https://example.com/rss/deepmind-multimodal-report",
    sourceName: "Mock RSS / Google DeepMind Blog",
    snippet:
      "技术报告介绍新模型在长视频理解、代码推理和跨模态检索上的 benchmark 表现，并披露训练和评估方法。",
    hoursAgo: 15
  },
  {
    id: "rss-huggingface-open-source-llm",
    title: "Hugging Face 社区出现新的开源 LLM 项目，强调本地推理效率",
    url: "https://example.com/rss/huggingface-open-source-llm",
    sourceName: "Mock RSS / Hugging Face Blog",
    snippet:
      "开源模型项目发布 GitHub 仓库、推理脚本和量化权重，目标是在消费级显卡上运行 agent 工作流。",
    hoursAgo: 20
  },
  {
    id: "rss-langchain-agent-runtime",
    title: "LangChain 发布 Agent Runtime 更新，改进工具调用和状态管理",
    url: "https://example.com/rss/langchain-agent-runtime",
    sourceName: "Mock RSS / LangChain Blog",
    snippet:
      "新版 framework 增加可恢复任务、可观测日志和多工具路由，帮助开发者构建长任务 AI agent。",
    hoursAgo: 27
  },
  {
    id: "rss-microsoft-copilot-workflows",
    title: "Microsoft 扩展 Copilot 工作流能力，面向运营和销售团队",
    url: "https://example.com/rss/microsoft-copilot-workflows",
    sourceName: "Mock RSS / Microsoft AI Blog",
    snippet:
      "产品更新把自然语言查询、表格分析、会议摘要和 CRM 自动记录接入企业工作流。",
    hoursAgo: 30
  },
  {
    id: "rss-mit-ai-education-research",
    title: "MIT 研究团队发布 AI 教育实验结果，关注个性化辅导边界",
    url: "https://example.com/rss/mit-ai-education-research",
    sourceName: "Mock RSS / MIT News AI",
    snippet:
      "研究比较了 AI tutor 在解释反馈、作业提示和学习路径推荐中的效果，同时强调教师监督与数据隐私。",
    hoursAgo: 33
  },
  {
    id: "rss-bair-agent-memory",
    title: "BAIR 新论文探索 Agent 长期记忆，减少上下文漂移",
    url: "https://example.com/rss/bair-agent-memory",
    sourceName: "Mock RSS / BAIR Blog",
    snippet:
      "研究提出分层记忆和任务状态压缩方法，在多轮工具调用任务中提升一致性和可追踪性。",
    hoursAgo: 39
  },
  {
    id: "rss-ai-search-citations",
    title: "AI 搜索产品加强来源标注，可信引用成为核心竞争点",
    url: "https://example.com/rss/ai-search-citations",
    sourceName: "Mock RSS / The Verge AI",
    snippet:
      "新一代 AI search 突出引用、置信度、多来源对照和原文跳转，试图缓解用户对幻觉的担忧。",
    hoursAgo: 42
  },
  {
    id: "rss-ai-startup-funding",
    title: "AI 数据基础设施创业公司完成新融资，企业知识库仍是热点",
    url: "https://example.com/rss/ai-startup-funding",
    sourceName: "Mock RSS / VentureBeat AI",
    snippet:
      "融资将用于扩展向量检索、权限同步和评估工具，客户集中在金融、零售和软件企业。",
    hoursAgo: 48
  },
  {
    id: "rss-nvidia-inference-cost",
    title: "NVIDIA 推出推理优化方案，小模型成本曲线继续下探",
    url: "https://example.com/rss/nvidia-inference-cost",
    sourceName: "Mock RSS / NVIDIA Blog",
    snippet:
      "新方案强调批处理、缓存、量化和混合部署，帮助企业在 AI assistant 场景降低延迟和成本。",
    hoursAgo: 50
  },
  {
    id: "rss-simon-ai-sdk",
    title: "开发者社区讨论 AI SDK 新模式，工具调用开始标准化",
    url: "https://example.com/rss/simon-ai-sdk",
    sourceName: "Mock RSS / Simon Willison",
    snippet:
      "文章梳理多家 AI SDK 在结构化输出、函数调用、检索和可观测性上的趋同，适合开发者选型。",
    hoursAgo: 54
  },
  {
    id: "rss-model-eval-real-repos",
    title: "代码 Agent 评测从单题正确率转向真实仓库任务完成度",
    url: "https://example.com/rss/model-eval-real-repos",
    sourceName: "Mock RSS / Developer AI Watch",
    snippet:
      "新的 evaluation 更关注跨文件修改、测试修复、代码审查反馈处理和长期任务完成度。",
    hoursAgo: 60
  },
  {
    id: "rss-enterprise-ai-policy",
    title: "企业 AI 使用规范模板走热，法务和安全团队进入前置评审",
    url: "https://example.com/rss/enterprise-ai-policy",
    sourceName: "Mock RSS / Governance Review",
    snippet:
      "模板覆盖敏感数据输入边界、供应商评估、人工复核、审计记录和员工培训。",
    hoursAgo: 63
  },
  {
    id: "rss-voice-agent-service",
    title: "语音 Agent 客服方案进入试点，转人工和留痕能力受关注",
    url: "https://example.com/rss/voice-agent-service",
    sourceName: "Mock RSS / CX Automation Brief",
    snippet:
      "语音 AI agent 在客服场景强调情绪识别、对话摘要、人工接管和服务记录，适合高频咨询业务。",
    hoursAgo: 68
  },
  {
    id: "rss-ai-video-editor",
    title: "AI 视频剪辑工具打通脚本到成片链路，短内容团队关注升温",
    url: "https://example.com/rss/ai-video-editor",
    sourceName: "Mock RSS / Creator Tech Digest",
    snippet:
      "工具把脚本生成、分镜建议、素材匹配和自动剪辑组合成 workflow，瞄准品牌内容和短视频团队。",
    hoursAgo: 70
  },
  {
    id: "rss-multimodal-office",
    title: "办公套件加入多模态表格分析，运营报表生成更自动",
    url: "https://example.com/rss/multimodal-office",
    sourceName: "Mock RSS / Workplace AI Notes",
    snippet:
      "产品更新让用户用自然语言询问表格、自动生成图表、解释异常并输出管理层摘要。",
    hoursAgo: 74
  },
  {
    id: "rss-ai-security-evals",
    title: "安全团队发布 AI Agent 红队评测，提示工具权限风险",
    url: "https://example.com/rss/ai-security-evals",
    sourceName: "Mock RSS / Security AI Lab",
    snippet:
      "评测覆盖 prompt injection、越权工具调用、数据外泄和日志审计，建议企业建立分级权限。",
    hoursAgo: 80
  },
  {
    id: "rss-open-source-rag",
    title: "开源 RAG 工具更新检索评估模块，降低知识库调优成本",
    url: "https://example.com/rss/open-source-rag",
    sourceName: "Mock RSS / Open Source AI Weekly",
    snippet:
      "新版本加入召回率评估、引用追踪和错误样本分析，帮助团队改进企业知识助手。",
    hoursAgo: 88
  },
  {
    id: "rss-ai-chip-supply",
    title: "AI 芯片供应链出现新配额策略，中小团队转向混合算力",
    url: "https://example.com/rss/ai-chip-supply",
    sourceName: "Mock RSS / Infra Signals",
    snippet:
      "算力供应商用更细配额服务不同规模客户，模型团队更多采用云端、边缘和本地混合方案。",
    hoursAgo: 96
  },
  {
    id: "rss-robotics-foundation-model",
    title: "机器人基础模型发布新 benchmark，泛化能力仍是关键难点",
    url: "https://example.com/rss/robotics-foundation-model",
    sourceName: "Mock RSS / Robotics AI Review",
    snippet:
      "研究 benchmark 覆盖视觉语言动作模型、模拟到现实迁移和长程任务规划，展示 AI model 的落地挑战。",
    hoursAgo: 108
  },
  {
    id: "rss-ai-copyright-policy",
    title: "AI 训练数据版权争议持续升温，平台开始调整授权策略",
    url: "https://example.com/rss/ai-copyright-policy",
    sourceName: "Mock RSS / Policy Tech Brief",
    snippet:
      "多方围绕模型训练数据、内容授权和生成结果归属展开讨论，企业需要关注合规和素材来源记录。",
    hoursAgo: 118,
    highHeat: true
  }
];

const tavilySearchTemplates: MockSearchTemplate[] = [
  {
    title: "AI agents product launch draws developer attention",
    url: "https://example.com/global/tavily-ai-agents-product-launch",
    sourceName: "Mock Search / Company Blog",
    snippet:
      "A company blog post outlines a new AI agent product with workflow automation, enterprise controls, and API access.",
    hoursAgo: 8
  },
  {
    title: "New AI model released with multimodal reasoning benchmarks",
    url: "https://example.com/global/tavily-new-model-release",
    sourceName: "Mock Search / Technical Blog",
    snippet:
      "The release includes model cards, benchmark comparisons, safety notes, and developer examples for multimodal tasks.",
    hoursAgo: 17,
    highHeat: true
  },
  {
    title: "AI startup announces funding for enterprise knowledge agents",
    url: "https://example.com/global/tavily-ai-startup-funding",
    sourceName: "Mock Search / Startup News",
    snippet:
      "The company says the funding will expand retrieval, permissions, evaluation, and workflow integrations.",
    hoursAgo: 31
  }
];

const exaSearchTemplates: MockSearchTemplate[] = [
  {
    title: "Technical report details a new open source LLM architecture",
    url: "https://example.com/global/exa-open-source-llm-technical-report",
    sourceName: "Mock Search / Research Lab",
    snippet:
      "The report covers model architecture, training data, evaluation, inference cost, and GitHub release notes.",
    hoursAgo: 11,
    highHeat: true
  },
  {
    title: "Developer-focused AI framework launches with agent state primitives",
    url: "https://example.com/global/exa-agent-framework-launch",
    sourceName: "Mock Search / Developer Blog",
    snippet:
      "The framework provides durable execution, tool routing, typed outputs, and observability for production agents.",
    hoursAgo: 26
  },
  {
    title: "Company blog explains new multimodal AI model for document workflows",
    url: "https://example.com/global/exa-multimodal-document-model",
    sourceName: "Mock Search / Company Blog",
    snippet:
      "The model combines OCR, vision-language reasoning, and long-context retrieval for enterprise document processing.",
    hoursAgo: 44
  }
];

export function createMockRssNews(now = new Date()): RawNewsItem[] {
  const fetchedAt = now.toISOString();

  return mockRssTemplates.map((item) => ({
    id: item.id,
    sourceType: "rss",
    provider: "none",
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    sourceName: item.sourceName,
    publishedAt: isoHoursAgo(now, item.hoursAgo),
    fetchedAt,
    rawContent: item.rawContent ?? item.snippet,
    highHeat: item.highHeat
  }));
}

export function createMockGlobalSearchNews(
  provider: Exclude<SearchProvider, "none">,
  queries: string[],
  maxResultsPerQuery: number,
  now = new Date()
): RawNewsItem[] {
  const fetchedAt = now.toISOString();
  const templates =
    provider === "tavily" ? tavilySearchTemplates : exaSearchTemplates;

  return queries.flatMap((query, queryIndex) =>
    templates.slice(0, Math.min(maxResultsPerQuery, templates.length)).map(
      (template, resultIndex) => ({
        id: `mock-${provider}-${queryIndex + 1}-${resultIndex + 1}`,
        sourceType: "global_search" as const,
        provider,
        query,
        title: template.title,
        url: `${template.url}?q=${queryIndex + 1}-${resultIndex + 1}`,
        snippet: template.snippet,
        sourceName: template.sourceName,
        publishedAt: isoHoursAgo(now, template.hoursAgo + queryIndex),
        fetchedAt,
        rawContent: template.snippet,
        highHeat: template.highHeat
      })
    )
  );
}

export const mockNews: RawNewsItem[] = createMockRssNews();
