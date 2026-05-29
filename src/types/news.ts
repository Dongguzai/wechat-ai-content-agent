export type NewsCategory =
  | "model"
  | "product"
  | "research"
  | "policy"
  | "funding"
  | "tooling";

export type NewsSourceType = "rss" | "global_search" | "manual";

export type SearchProvider = "tavily" | "exa" | "none";

export interface NewsScores {
  freshness: number;
  heat: number;
  technicalValue: number;
  wechatTopic: number;
  businessImpact: number;
  controversy: number;
  final: number;
}

export interface RawNewsItem {
  id: string;
  sourceType: NewsSourceType;
  provider?: SearchProvider;
  query?: string;
  title: string;
  url: string;
  snippet?: string;
  sourceName: string;
  publishedAt?: string;
  fetchedAt: string;
  rawContent?: string;
  highHeat?: boolean;
}

export interface DuplicateSource {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  sourceType: NewsSourceType;
  provider?: SearchProvider;
  query?: string;
}

export interface NewsRejection {
  hard: true;
  reason: string;
  detail?: string;
  rejectedAt: string;
}

export interface NormalizedNewsItem {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  sourceType: NewsSourceType;
  provider?: SearchProvider;
  query?: string;
  publishedAt?: string;
  fetchedAt: string;
  snippet?: string;
  summary: string;
  category: NewsCategory;
  evidence: string[];
  duplicateKey: string;
  scores: NewsScores;
  rejection?: NewsRejection;
  duplicateSources?: DuplicateSource[];
  tags?: string[];
}

export type NewsItem = NormalizedNewsItem;

export interface CollectionWarning {
  source:
    | "rss"
    | "tavily"
    | "exa"
    | "global_search"
    | "quota"
    | "normalization";
  message: string;
  detail?: string;
}

export interface CollectionOutputFiles {
  rawNews: string;
  normalizedNews: string;
  rejectedNews: string;
  candidateNews: string;
  collectionReport: string;
}

export interface NewsCollectionStats {
  rawCount: number;
  rssRawCount: number;
  tavilyRawCount: number;
  exaRawCount: number;
  normalizedCount: number;
  dedupedCount: number;
  hardRejectionCount: number;
  finalCandidateCount: number;
  rssCandidateCount: number;
  globalSearchCandidateCount: number;
  tavilyCandidateCount: number;
  exaCandidateCount: number;
  apiRealCall: boolean;
}

export interface NewsCollectionResult {
  outputDir: string;
  files: CollectionOutputFiles;
  rawItems: RawNewsItem[];
  normalizedItems: NormalizedNewsItem[];
  dedupedItems: NormalizedNewsItem[];
  rejectedItems: NormalizedNewsItem[];
  candidates: NormalizedNewsItem[];
  warnings: CollectionWarning[];
  stats: NewsCollectionStats;
}
