export type NewsCategory =
  | "model"
  | "product"
  | "research"
  | "policy"
  | "funding"
  | "tooling";

export type NewsSourceType = "rss" | "global_search" | "manual";

export type SearchProvider = "tavily" | "exa" | "none";

export type NewsDataMode = "real" | "mock";

export type NewsLocalizationStatus =
  | "not_required"
  | "needs_localization"
  | "localized"
  | "failed";

export type NewsTag =
  | "tooling"
  | "open-source"
  | "agent"
  | "developer-workflow"
  | "model"
  | "product"
  | "research"
  | "business"
  | "community"
  | "policy";

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
  dataMode?: NewsDataMode;
  mock?: boolean;
  mockReason?: string;
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
  stage?: "basic" | "localization" | "editorial";
  rejectedAt: string;
}

export type NewsChineseLanguageField =
  | "title"
  | "query"
  | "snippet"
  | "summary"
  | "rawContent";

export interface NewsChineseLanguageViolation {
  field: NewsChineseLanguageField;
  reason: "missing_chinese_text" | "contains_untranslated_english";
  disallowedTerms: string[];
}

export interface NewsChineseLanguageCheckResult {
  passed: boolean;
  violations: NewsChineseLanguageViolation[];
}

export interface NormalizedNewsItem {
  id: string;
  dataMode?: NewsDataMode;
  mock?: boolean;
  mockReason?: string;
  title: string;
  rawTitle?: string;
  titleZh?: string;
  url: string;
  sourceName: string;
  sourceType: NewsSourceType;
  provider?: SearchProvider;
  query?: string;
  publishedAt?: string;
  fetchedAt: string;
  snippet?: string;
  summary: string;
  rawSummary?: string;
  summaryZh?: string;
  sourceLanguage?: "zh" | "en" | "unknown";
  topicAngleZh?: string;
  shortlistReasonZh?: string;
  riskNotesZh?: string[];
  localized?: boolean;
  localizationStatus?: NewsLocalizationStatus;
  category: NewsCategory;
  evidence: string[];
  duplicateKey: string;
  scores: NewsScores;
  rejection?: NewsRejection;
  duplicateSources?: DuplicateSource[];
  tags?: string[];
}

export type NewsItem = NormalizedNewsItem;

export type ShortlistRecommendedUse =
  | "main_topic_candidate"
  | "secondary_topic"
  | "reference_only";

export interface ShortlistScoreDimensions {
  technicalValue: number;
  wechatTopic: number;
  businessImpact: number;
  controversy: number;
  sourceCredibility: number;
  explainability: number;
  originality: number;
}

export interface TopicDecisionScoreDimensions {
  wechatTopic: number;
  businessImpact: number;
  technicalValue: number;
  controversy: number;
  sourceCredibility: number;
  explainability: number;
}

export interface ShortlistedNewsEditorial {
  shortlistReason: string;
  audienceFit: string;
  topicAngle: string;
  riskNote?: string;
  recommendedUse: ShortlistRecommendedUse;
}

export interface ShortlistedNewsItem extends NormalizedNewsItem {
  tags: NewsTag[];
  shortlistScore: number;
  shortlistMetrics: ShortlistScoreDimensions;
  editorial: ShortlistedNewsEditorial;
}

export type SourceReliability = "high" | "medium" | "low";

export interface SelectedTopicSelection {
  selectedReason: string;
  whyMostWorthWriting: string;
  coreConflict: string;
  publicInterest: string;
  technicalSignificance: string;
  businessImpact: string;
  predictedImpact: string;
  writingAngle: string;
  suggestedTitles: string[];
  articleThesis: string;
  riskNotes: string[];
  sourceReliability: SourceReliability;
  decisionScore: number;
}

export type SelectedTopicItem = ShortlistedNewsItem & {
  selection: SelectedTopicSelection;
};

export interface SelectedTopicRunnerUp {
  title: string;
  url: string;
  reason: string;
  whyNotSelected: string;
}

export interface SelectedTopicRejectedItem {
  title: string;
  url: string;
  reason: string;
}

export interface SelectedTopic {
  selected: SelectedTopicItem;
  runnersUp: SelectedTopicRunnerUp[];
  rejected: SelectedTopicRejectedItem[];
  generatedAt: string;
}

export interface TopicSelectionOutputFiles {
  selectedTopic: string;
  topicSelectionReport: string;
}

export interface TopicSelectionResult {
  outputDir: string;
  files: TopicSelectionOutputFiles;
  shortlisted: ShortlistedNewsItem[];
  topic: SelectedTopic;
}

export interface ShortlistOutputFiles {
  shortlistedNews: string;
  shortlistReport: string;
}

export interface ShortlistElimination {
  id: string;
  title: string;
  sourceName?: string;
  sourceType?: NewsSourceType;
  provider?: SearchProvider;
  reason: string;
  shortlistScore?: number;
}

export interface NewsShortlistStats {
  candidateCount: number;
  shortlistedCount: number;
  rssShortlistedCount: number;
  globalSearchShortlistedCount: number;
  tavilyShortlistedCount: number;
  exaShortlistedCount: number;
  categoryCounts: Record<NewsCategory, number>;
  tagCounts: Record<NewsTag, number>;
}

export interface NewsShortlistResult {
  outputDir: string;
  files: ShortlistOutputFiles;
  candidates: NormalizedNewsItem[];
  shortlisted: ShortlistedNewsItem[];
  eliminated: ShortlistElimination[];
  stats: NewsShortlistStats;
}

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
  realSourceCount?: number;
  rssRawCount: number;
  tavilyRawCount: number;
  exaRawCount: number;
  normalizedCount: number;
  dedupedCount: number;
  hardRejectionCount: number;
  basicRejectionCount?: number;
  localizedCount?: number;
  localizationFailedCount?: number;
  rejectedAfterLocalizationCount?: number;
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
