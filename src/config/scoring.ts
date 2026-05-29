import type { NewsCategory, NewsScores, RawNewsItem } from "../types/news.js";

export const scoreWeights = {
  technicalValue: 0.45,
  wechatTopic: 0.45,
  freshness: 0.1
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
    "reasoning"
  ],
  product: [
    "product",
    "launch",
    "app",
    "chatbot",
    "assistant",
    "agent",
    "workspace",
    "copilot"
  ],
  research: [
    "research",
    "paper",
    "technical report",
    "benchmark",
    "evaluation",
    "breakthrough",
    "study"
  ],
  policy: [
    "policy",
    "safety",
    "regulation",
    "copyright",
    "law",
    "governance",
    "security"
  ],
  funding: [
    "funding",
    "acquisition",
    "valuation",
    "investment",
    "startup",
    "revenue",
    "enterprise"
  ],
  tooling: [
    "developer",
    "github",
    "open source",
    "framework",
    "sdk",
    "api",
    "tool",
    "workflow"
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
  "知识库"
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
    "frontier"
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
    "eval"
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
    "global"
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
    "startup"
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
    "privacy"
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
