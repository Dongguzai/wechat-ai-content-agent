import type { NewsCategory } from "../types/news.js";

export interface RssSourceConfig {
  name: string;
  url: string;
  categoryHint?: NewsCategory;
  trustScore: number;
}

export interface CollectionConfig {
  rssEnableRealFetch: boolean;
  searchEnableRealApi: boolean;
  tavilyApiKey?: string;
  exaApiKey?: string;
  tavilyMaxQueriesPerRun: number;
  exaMaxQueriesPerRun: number;
  searchMaxResultsPerQuery: number;
  searchLookbackHours: number;
  globalSearchMaxCandidates: number;
  rssMinCandidates: number;
  targetCandidateCount: number;
}

export const rssSources: RssSourceConfig[] = [
  {
    name: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    categoryHint: "product",
    trustScore: 96
  },
  {
    name: "Anthropic News (generated RSS)",
    url: "https://raw.githubusercontent.com/0xSMW/rss-feeds/main/feeds/feed_anthropic_news.xml",
    categoryHint: "model",
    trustScore: 86
  },
  {
    name: "Google DeepMind Blog",
    url: "https://deepmind.com/blog/feed/basic/",
    categoryHint: "research",
    trustScore: 95
  },
  {
    name: "Google AI Blog",
    url: "https://blog.google/technology/ai/rss/",
    categoryHint: "product",
    trustScore: 92
  },
  {
    name: "Microsoft AI Blog",
    url: "https://news.microsoft.com/source/topics/ai/feed/",
    categoryHint: "product",
    trustScore: 91
  },
  {
    name: "Hugging Face Blog",
    url: "https://huggingface.co/blog/feed.xml",
    categoryHint: "tooling",
    trustScore: 90
  },
  {
    name: "LangChain Blog",
    url: "https://blog.langchain.com/rss/",
    categoryHint: "tooling",
    trustScore: 88
  },
  {
    name: "MIT News AI",
    url: "https://news.mit.edu/rss/topic/artificial-intelligence2",
    categoryHint: "research",
    trustScore: 89
  },
  {
    name: "BAIR Blog",
    url: "https://bair.berkeley.edu/blog/feed.xml",
    categoryHint: "research",
    trustScore: 88
  },
  {
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed/",
    categoryHint: "funding",
    trustScore: 76
  },
  {
    name: "The Verge AI",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    categoryHint: "product",
    trustScore: 76
  },
  {
    name: "Simon Willison",
    url: "https://simonwillison.net/atom/everything/",
    categoryHint: "tooling",
    trustScore: 86
  }
];

export const tavilyQueries = [
  "latest AI news today",
  "top artificial intelligence news last 24 hours",
  "OpenAI Anthropic Google DeepMind Meta AI latest news",
  "new AI model released last 72 hours",
  "AI startup funding acquisition latest news",
  "AI agents product launch last 72 hours"
];

export const exaQueries = [
  "new AI model technical report",
  "AI agent framework launch",
  "new open source LLM project GitHub",
  "AI research breakthrough company blog",
  "developer focused AI product update",
  "new multimodal AI model release"
];

const DEFAULT_CONFIG: CollectionConfig = {
  rssEnableRealFetch: true,
  searchEnableRealApi: false,
  tavilyMaxQueriesPerRun: 6,
  exaMaxQueriesPerRun: 6,
  searchMaxResultsPerQuery: 5,
  searchLookbackHours: 72,
  globalSearchMaxCandidates: 6,
  rssMinCandidates: 14,
  targetCandidateCount: 20
};

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function readInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function readCollectionConfig(
  env: NodeJS.ProcessEnv = process.env
): CollectionConfig {
  return {
    rssEnableRealFetch: readBoolean(
      env.RSS_ENABLE_REAL_FETCH,
      DEFAULT_CONFIG.rssEnableRealFetch
    ),
    searchEnableRealApi: readBoolean(
      env.SEARCH_ENABLE_REAL_API,
      DEFAULT_CONFIG.searchEnableRealApi
    ),
    tavilyApiKey: optionalString(env.TAVILY_API_KEY),
    exaApiKey: optionalString(env.EXA_API_KEY),
    tavilyMaxQueriesPerRun: readInteger(
      env.TAVILY_MAX_QUERIES_PER_RUN,
      DEFAULT_CONFIG.tavilyMaxQueriesPerRun
    ),
    exaMaxQueriesPerRun: readInteger(
      env.EXA_MAX_QUERIES_PER_RUN,
      DEFAULT_CONFIG.exaMaxQueriesPerRun
    ),
    searchMaxResultsPerQuery: readInteger(
      env.SEARCH_MAX_RESULTS_PER_QUERY,
      DEFAULT_CONFIG.searchMaxResultsPerQuery
    ),
    searchLookbackHours: readInteger(
      env.SEARCH_LOOKBACK_HOURS,
      DEFAULT_CONFIG.searchLookbackHours
    ),
    globalSearchMaxCandidates: readInteger(
      env.GLOBAL_SEARCH_MAX_CANDIDATES,
      DEFAULT_CONFIG.globalSearchMaxCandidates
    ),
    rssMinCandidates: readInteger(
      env.RSS_MIN_CANDIDATES,
      DEFAULT_CONFIG.rssMinCandidates
    ),
    targetCandidateCount: DEFAULT_CONFIG.targetCandidateCount
  };
}
