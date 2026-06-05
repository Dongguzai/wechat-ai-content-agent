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
    title: "Claude Code 高阶订阅与 Goose 免费开源对比，引发编码代理成本争议",
    url: "https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free",
    sourceName: "VentureBeat AI",
    snippet:
      "Claude Code 存在付费订阅路径，Goose 被描述为免费开源的 AI 编码代理，引发开发者工作流、成本和工具锁定讨论。",
    hoursAgo: 4,
    highHeat: true
  },
  {
    id: "rss-openai-agent-workbench",
    title: "OpenAI 推出多模态智能体工作台，企业内容流程开始重组",
    url: "https://example.com/rss/openai-agent-workbench",
    sourceName: "Mock RSS / OpenAI News",
    snippet:
      "新的 AI 智能体工作台展示资料整理、图文理解、任务编排和团队审计能力，适合内容、客服和研究团队试点。",
    hoursAgo: 6,
    highHeat: true
  },
  {
    id: "rss-anthropic-managed-agents",
    title: "Anthropic 推出托管智能体能力，降低企业部署门槛",
    url: "https://example.com/rss/anthropic-managed-agents",
    sourceName: "Mock RSS / Anthropic News",
    snippet:
      "托管式 AI 智能体服务把权限、工具调用、日志和人工接管放进统一控制面板，强调安全和可审计。",
    hoursAgo: 9
  },
  {
    id: "rss-deepmind-multimodal-report",
    title: "Google DeepMind 公开新多模态模型技术报告",
    url: "https://example.com/rss/deepmind-multimodal-report",
    sourceName: "Mock RSS / Google DeepMind Blog",
    snippet:
      "技术报告介绍新模型在长视频理解、代码推理和跨模态检索上的基准测试表现，并披露训练和评估方法。",
    hoursAgo: 15
  },
  {
    id: "rss-huggingface-open-source-llm",
    title: "Hugging Face 社区出现新的开源 LLM 项目，强调本地推理效率",
    url: "https://example.com/rss/huggingface-open-source-llm",
    sourceName: "Mock RSS / Hugging Face Blog",
    snippet:
      "开源模型项目公开 GitHub 仓库、推理脚本和量化权重，目标是在消费级显卡上运行智能体工作流。",
    hoursAgo: 20
  },
  {
    id: "rss-langchain-agent-runtime",
    title: "LangChain 推出智能体运行时更新，改进工具调用和状态管理",
    url: "https://example.com/rss/langchain-agent-runtime",
    sourceName: "Mock RSS / LangChain Blog",
    snippet:
      "新版框架增加可恢复任务、可观测日志和多工具路由，帮助开发者构建长任务 AI 智能体。",
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
    title: "MIT 研究团队公开 AI 教育实验结果，关注个性化辅导边界",
    url: "https://example.com/rss/mit-ai-education-research",
    sourceName: "Mock RSS / MIT News AI",
    snippet:
      "研究比较了 AI 辅导系统在解释反馈、作业提示和学习路径推荐中的效果，同时强调教师监督与数据隐私。",
    hoursAgo: 33
  },
  {
    id: "rss-bair-agent-memory",
    title: "BAIR 新论文探索智能体长期记忆，减少上下文漂移",
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
      "新一代 AI 搜索突出引用、置信度、多来源对照和原文跳转，试图缓解用户对幻觉的担忧。",
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
      "新方案强调批处理、缓存、量化和混合部署，帮助企业在 AI 助手场景降低延迟和成本。",
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
    title: "代码智能体评测从单题正确率转向真实仓库任务完成度",
    url: "https://example.com/rss/model-eval-real-repos",
    sourceName: "Mock RSS / Developer AI Watch",
    snippet:
      "新的评测更关注跨文件修改、测试修复、代码审查反馈处理和长期任务完成度。",
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
    title: "语音智能体客服方案进入试点，转人工和留痕能力受关注",
    url: "https://example.com/rss/voice-agent-service",
    sourceName: "Mock RSS / CX Automation Brief",
    snippet:
      "语音 AI 智能体在客服场景强调情绪识别、对话摘要、人工接管和服务记录，适合高频咨询业务。",
    hoursAgo: 68
  },
  {
    id: "rss-ai-video-editor",
    title: "AI 视频剪辑工具打通脚本到成片链路，短内容团队关注升温",
    url: "https://example.com/rss/ai-video-editor",
    sourceName: "Mock RSS / Creator Tech Digest",
    snippet:
      "工具把脚本生成、分镜建议、素材匹配和自动剪辑组合成工作流，瞄准品牌内容和短视频团队。",
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
    title: "安全团队公开 AI 智能体红队评测，提示工具权限风险",
    url: "https://example.com/rss/ai-security-evals",
    sourceName: "Mock RSS / Security AI Lab",
    snippet:
      "评测覆盖提示词注入、越权工具调用、数据外泄和日志审计，建议企业建立分级权限。",
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
    title: "机器人基础模型推出新基准测试，泛化能力仍是关键难点",
    url: "https://example.com/rss/robotics-foundation-model",
    sourceName: "Mock RSS / Robotics AI Review",
    snippet:
      "研究基准测试覆盖视觉语言动作模型、模拟到现实迁移和长程任务规划，展示 AI 模型的落地挑战。",
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
    title: "AI 智能体产品亮相引发开发者关注",
    url: "https://example.com/global/tavily-ai-agents-product-launch",
    sourceName: "Mock Search / Company Blog",
    snippet:
      "公司博客介绍新的 AI 智能体产品，具备工作流自动化、企业控制台和 API 接入能力。",
    hoursAgo: 8
  },
  {
    title: "新 AI 模型公开多模态推理基准测试",
    url: "https://example.com/global/tavily-new-model-release",
    sourceName: "Mock Search / Technical Blog",
    snippet:
      "公开内容包含模型卡、基准测试对比、安全说明和面向开发者的多模态任务示例。",
    hoursAgo: 17,
    highHeat: true
  },
  {
    title: "AI 创业公司宣布企业知识智能体融资",
    url: "https://example.com/global/tavily-ai-startup-funding",
    sourceName: "Mock Search / Startup News",
    snippet:
      "公司表示融资将用于扩展检索、权限、评测和工作流集成能力。",
    hoursAgo: 31
  }
];

const exaSearchTemplates: MockSearchTemplate[] = [
  {
    title: "技术报告详解新的开源 LLM 架构",
    url: "https://example.com/global/exa-open-source-llm-technical-report",
    sourceName: "Mock Search / Research Lab",
    snippet:
      "报告覆盖模型架构、训练数据、评测、推理成本和 GitHub 更新说明。",
    hoursAgo: 11,
    highHeat: true
  },
  {
    title: "面向开发者的 AI 框架推出智能体状态原语",
    url: "https://example.com/global/exa-agent-framework-launch",
    sourceName: "Mock Search / Developer Blog",
    snippet:
      "框架提供持久执行、工具路由、类型化输出和面向生产智能体的可观测能力。",
    hoursAgo: 26
  },
  {
    title: "公司博客解读面向文档工作流的新多模态 AI 模型",
    url: "https://example.com/global/exa-multimodal-document-model",
    sourceName: "Mock Search / Company Blog",
    snippet:
      "该模型结合 OCR、视觉语言推理和长上下文检索，用于企业文档处理。",
    hoursAgo: 44
  }
];

export function createMockRssNews(now = new Date()): RawNewsItem[] {
  const fetchedAt = now.toISOString();

  return mockRssTemplates.map((item) => ({
    id: item.id,
    dataMode: "mock",
    mock: true,
    mockReason: "mock_rss",
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
        dataMode: "mock",
        mock: true,
        mockReason: "mock_search",
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
