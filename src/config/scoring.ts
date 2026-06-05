import type {
  NewsCategory,
  NewsScores,
  NormalizedNewsItem,
  RawNewsItem,
  ShortlistedNewsItem,
  ShortlistScoreDimensions,
  TopicDecisionScoreDimensions
} from "../types/news.js";

export const scoreWeights = {
  technicalValue: 0.45,
  wechatTopic: 0.45,
  freshness: 0.1
} as const;

export const shortlistScoreWeights = {
  technicalValue: 0.25,
  wechatTopic: 0.3,
  businessImpact: 0.15,
  controversy: 0.1,
  sourceCredibility: 0.1,
  explainability: 0.1
} as const;

export const decisionScoreWeights = {
  wechatTopic: 0.25,
  businessImpact: 0.2,
  technicalValue: 0.2,
  controversy: 0.15,
  sourceCredibility: 0.1,
  explainability: 0.1
} as const;

export const categoryKeywords: Record<NewsCategory, string[]> = {
  model: [
    "model",
    "llm",
    "gpt",
    "claude",
    "gemini",
    "llama",
    "mistral",
    "multimodal",
    "reasoning",
    "模型",
    "大模型",
    "多模态",
    "推理",
    "基座模型"
  ],
  product: [
    "product",
    "launch",
    "app",
    "chatbot",
    "assistant",
    "agent",
    "workspace",
    "copilot",
    "产品",
    "发布",
    "应用",
    "助手",
    "智能体",
    "工作台",
    "办公套件"
  ],
  research: [
    "research",
    "paper",
    "technical report",
    "benchmark",
    "evaluation",
    "breakthrough",
    "study",
    "研究",
    "论文",
    "技术报告",
    "基准测试",
    "评测",
    "突破",
    "实验"
  ],
  policy: [
    "policy",
    "safety",
    "regulation",
    "copyright",
    "law",
    "governance",
    "security",
    "政策",
    "安全",
    "监管",
    "版权",
    "法律",
    "治理",
    "合规",
    "隐私"
  ],
  funding: [
    "funding",
    "acquisition",
    "valuation",
    "investment",
    "startup",
    "revenue",
    "enterprise",
    "融资",
    "并购",
    "估值",
    "投资",
    "创业公司",
    "收入",
    "企业",
    "商业化"
  ],
  tooling: [
    "developer",
    "github",
    "open source",
    "framework",
    "sdk",
    "api",
    "tool",
    "workflow",
    "开发者",
    "开源",
    "框架",
    "工具",
    "工作流",
    "代码",
    "仓库",
    "运行时"
  ]
};

export const trustedCompanyDomains = [
  "openai.com",
  "anthropic.com",
  "deepmind.google",
  "blog.google",
  "ai.meta.com",
  "microsoft.com",
  "huggingface.co",
  "github.com",
  "langchain.com",
  "llamaindex.ai",
  "mistral.ai",
  "cohere.com",
  "nvidia.com",
  "mit.edu",
  "berkeley.edu"
];

export const seoAggregationDomains = [
  "feedspot.com",
  "openrss.org",
  "rss.com",
  "rsshub.app",
  "medium.com/tag",
  "substack.com/s/"
];

export const lowTrustDomains = [
  "marktechpost.com",
  "analyticsindiamag.com",
  "aitoolhunt.com",
  "futuretools.io",
  "theresanaiforthat.com"
];

const aiKeywords = [
  "ai",
  "artificial intelligence",
  "machine learning",
  "ml",
  "llm",
  "large language model",
  "agent",
  "gpt",
  "claude",
  "gemini",
  "llama",
  "deepmind",
  "openai",
  "anthropic",
  "multimodal",
  "diffusion",
  "neural",
  "transformer",
  "copilot",
  "rag",
  "人工智能",
  "大模型",
  "模型",
  "多模态",
  "智能体",
  "机器学习",
  "推理",
  "生成式",
  "知识库",
  "编码代理"
];

const officialSourceSignals = [
  "openai",
  "anthropic",
  "deepmind",
  "google",
  "microsoft",
  "meta",
  "hugging face",
  "langchain",
  "nvidia",
  "mit",
  "bair",
  "berkeley",
  "github"
];

const crediblePublicationSignals = [
  "venturebeat",
  "the verge",
  "simon willison",
  "developer",
  "research lab",
  "technical blog",
  "company blog"
];

const explainabilitySignals = [
  "workflow",
  "enterprise",
  "developer",
  "customer",
  "pricing",
  "cost",
  "funding",
  "policy",
  "safety",
  "benchmark",
  "github",
  "open source",
  "education",
  "office",
  "search",
  "agent",
  "工作流",
  "企业",
  "开发者",
  "客户",
  "定价",
  "成本",
  "融资",
  "政策",
  "安全",
  "基准测试",
  "开源",
  "教育",
  "办公",
  "搜索",
  "智能体"
];

const originalitySignals = [
  "technical report",
  "paper",
  "model card",
  "github",
  "release notes",
  "company blog",
  "research lab",
  "official",
  "source:",
  "技术报告",
  "论文",
  "模型卡",
  "发布说明",
  "公司博客",
  "研究机构",
  "官方"
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function containsAiSignal(text: string): boolean {
  const haystack = text.toLowerCase();
  return aiKeywords.some((keyword) => haystack.includes(keyword));
}

export function inferCategory(text: string): NewsCategory {
  const haystack = text.toLowerCase();
  const categoryScores = Object.entries(categoryKeywords).map(
    ([category, keywords]) => ({
      category: category as NewsCategory,
      score: keywords.filter((keyword) => haystack.includes(keyword)).length
    })
  );

  const [best] = categoryScores.sort((a, b) => b.score - a.score);
  return best && best.score > 0 ? best.category : "product";
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isTrustedDomain(url: string): boolean {
  const domain = getDomain(url);
  return trustedCompanyDomains.some(
    (trustedDomain) =>
      domain === trustedDomain || domain.endsWith(`.${trustedDomain}`)
  );
}

export function isSeoAggregationUrl(url: string, title: string): boolean {
  const normalized = `${url} ${title}`.toLowerCase();
  const domain = getDomain(url);
  const urlPath = url.toLowerCase();

  return (
    seoAggregationDomains.some((seoDomain) => normalized.includes(seoDomain)) ||
    /\/(tag|category|topics?|search|best-ai-tools|ai-tools)\b/.test(urlPath) ||
    /\b(top|best)\s+\d+\s+ai\b/.test(title.toLowerCase()) ||
    domain.includes("aitools")
  );
}

export function isLowTrustDomain(url: string): boolean {
  const domain = getDomain(url);
  return lowTrustDomains.some(
    (lowTrustDomain) =>
      domain === lowTrustDomain || domain.endsWith(`.${lowTrustDomain}`)
  );
}

function scoreSourceCredibility(item: NormalizedNewsItem): number {
  const sourceName = item.sourceName.toLowerCase();

  if (isLowTrustDomain(item.url)) {
    return 40;
  }

  if (isTrustedDomain(item.url)) {
    return 95;
  }

  if (officialSourceSignals.some((signal) => sourceName.includes(signal))) {
    return item.sourceType === "rss" ? 90 : 78;
  }

  if (crediblePublicationSignals.some((signal) => sourceName.includes(signal))) {
    return item.sourceType === "rss" ? 82 : 72;
  }

  return item.sourceType === "rss" ? 76 : 62;
}

function scoreExplainability(item: NormalizedNewsItem): number {
  const text = `${item.title} ${item.summary} ${item.tags?.join(" ") ?? ""}`.toLowerCase();
  const categoryBase: Record<NewsCategory, number> = {
    product: 78,
    funding: 77,
    policy: 75,
    tooling: 73,
    model: 70,
    research: 66
  };
  const signalBoost = explainabilitySignals.filter((signal) =>
    text.includes(signal)
  ).length * 3;
  const jargonPenalty =
    /\b(architecture|quantization|transformer|latent|embedding|inference)\b/.test(
      text
    ) && item.category === "research"
      ? 5
      : 0;

  return clampScore(categoryBase[item.category] + signalBoost - jargonPenalty);
}

function scoreOriginality(item: NormalizedNewsItem): number {
  const text = `${item.title} ${item.summary} ${item.evidence.join(" ")}`.toLowerCase();
  let score = item.sourceType === "rss" ? 76 : 58;

  if (isTrustedDomain(item.url)) {
    score += 16;
  }

  if (officialSourceSignals.some((signal) => item.sourceName.toLowerCase().includes(signal))) {
    score += 10;
  }

  if (originalitySignals.some((signal) => text.includes(signal))) {
    score += 8;
  }

  if (item.sourceType === "global_search") {
    score -= 8;
  }

  if (item.duplicateSources && item.duplicateSources.length > 0) {
    score += 4;
  }

  return clampScore(score);
}

export function scoreShortlistDimensions(
  item: NormalizedNewsItem
): ShortlistScoreDimensions {
  return {
    technicalValue: item.scores.technicalValue,
    wechatTopic: item.scores.wechatTopic,
    businessImpact: item.scores.businessImpact,
    controversy: item.scores.controversy,
    sourceCredibility: scoreSourceCredibility(item),
    explainability: scoreExplainability(item),
    originality: scoreOriginality(item)
  };
}

export function calculateShortlistScore(
  dimensions: ShortlistScoreDimensions
): number {
  return clampScore(
    dimensions.technicalValue * shortlistScoreWeights.technicalValue +
      dimensions.wechatTopic * shortlistScoreWeights.wechatTopic +
      dimensions.businessImpact * shortlistScoreWeights.businessImpact +
      dimensions.controversy * shortlistScoreWeights.controversy +
      dimensions.sourceCredibility * shortlistScoreWeights.sourceCredibility +
      dimensions.explainability * shortlistScoreWeights.explainability
  );
}

export function scoreTopicDecisionDimensions(
  item: ShortlistedNewsItem
): TopicDecisionScoreDimensions {
  return {
    wechatTopic: item.shortlistMetrics.wechatTopic,
    businessImpact: item.shortlistMetrics.businessImpact,
    technicalValue: item.shortlistMetrics.technicalValue,
    controversy: item.shortlistMetrics.controversy,
    sourceCredibility: item.shortlistMetrics.sourceCredibility,
    explainability: item.shortlistMetrics.explainability
  };
}

export function calculateDecisionScore(
  dimensions: TopicDecisionScoreDimensions
): number {
  return clampScore(
    dimensions.wechatTopic * decisionScoreWeights.wechatTopic +
      dimensions.businessImpact * decisionScoreWeights.businessImpact +
      dimensions.technicalValue * decisionScoreWeights.technicalValue +
      dimensions.controversy * decisionScoreWeights.controversy +
      dimensions.sourceCredibility * decisionScoreWeights.sourceCredibility +
      dimensions.explainability * decisionScoreWeights.explainability
  );
}

export function scoreNewsItem(
  raw: RawNewsItem,
  category: NewsCategory,
  now: Date
): NewsScores {
  const text = `${raw.title} ${raw.snippet ?? ""} ${raw.rawContent ?? ""}`;
  const haystack = text.toLowerCase();
  const publishedAt = raw.publishedAt ? Date.parse(raw.publishedAt) : NaN;
  const ageHours = Number.isFinite(publishedAt)
    ? Math.max(0, (now.getTime() - publishedAt) / 3_600_000)
    : 72;

  let freshness = 45;
  if (ageHours <= 24) {
    freshness = 100;
  } else if (ageHours <= 72) {
    freshness = 86;
  } else if (ageHours <= 168) {
    freshness = 68;
  }

  const heatTerms = [
    "openai",
    "anthropic",
    "deepmind",
    "google",
    "meta",
    "microsoft",
    "nvidia",
    "launch",
    "released",
    "funding",
    "acquisition",
    "breakthrough",
    "frontier",
    "发布",
    "融资",
    "并购",
    "突破",
    "前沿"
  ];
  const technicalTerms = [
    "technical report",
    "benchmark",
    "github",
    "open source",
    "research",
    "paper",
    "framework",
    "sdk",
    "api",
    "model",
    "multimodal",
    "reasoning",
    "eval",
    "技术报告",
    "基准测试",
    "开源",
    "研究",
    "论文",
    "框架",
    "模型",
    "多模态",
    "推理",
    "评测"
  ];
  const wechatTerms = [
    "agent",
    "product",
    "launch",
    "enterprise",
    "workflow",
    "content",
    "creator",
    "developer",
    "startup",
    "pricing",
    "china",
    "global",
    "智能体",
    "产品",
    "发布",
    "企业",
    "工作流",
    "内容",
    "创作者",
    "开发者",
    "创业公司",
    "定价",
    "中国",
    "全球"
  ];
  const businessTerms = [
    "funding",
    "acquisition",
    "valuation",
    "enterprise",
    "customer",
    "revenue",
    "pricing",
    "partnership",
    "startup",
    "融资",
    "并购",
    "估值",
    "企业",
    "客户",
    "收入",
    "定价",
    "合作",
    "创业公司"
  ];
  const controversyTerms = [
    "lawsuit",
    "copyright",
    "safety",
    "risk",
    "policy",
    "ban",
    "regulation",
    "security",
    "privacy",
    "诉讼",
    "版权",
    "安全",
    "风险",
    "政策",
    "禁令",
    "监管",
    "隐私"
  ];

  const scoreByTerms = (terms: string[], base: number, step: number): number =>
    base + terms.filter((term) => haystack.includes(term)).length * step;

  const sourceTrust = isTrustedDomain(raw.url) ? 10 : 0;
  const rssBoost = raw.sourceType === "rss" ? 4 : 0;

  const heat = scoreByTerms(heatTerms, 48, 7) + sourceTrust + rssBoost;
  const technicalValue =
    scoreByTerms(technicalTerms, category === "research" ? 66 : 48, 7) +
    (category === "model" || category === "tooling" ? 8 : 0) +
    sourceTrust;
  const wechatTopic =
    scoreByTerms(wechatTerms, 52, 6) +
    (category === "product" || category === "tooling" ? 8 : 0) +
    rssBoost;
  const businessImpact =
    scoreByTerms(businessTerms, category === "funding" ? 65 : 45, 7) +
    (isTrustedDomain(raw.url) ? 4 : 0);
  const controversy = scoreByTerms(controversyTerms, 20, 10);

  const final =
    technicalValue * scoreWeights.technicalValue +
    wechatTopic * scoreWeights.wechatTopic +
    freshness * scoreWeights.freshness;

  return {
    freshness: clampScore(freshness),
    heat: clampScore(heat),
    technicalValue: clampScore(technicalValue),
    wechatTopic: clampScore(wechatTopic),
    businessImpact: clampScore(businessImpact),
    controversy: clampScore(controversy),
    final: clampScore(final)
  };
}
