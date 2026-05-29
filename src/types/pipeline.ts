import type { TopicFactPack } from "./factPack.js";
import type {
  ArticleDraft,
  ArticleMeta,
  ArticleReviewResult
} from "./article.js";
import type {
  NewsCollectionStats,
  NewsShortlistStats,
  NormalizedNewsItem,
  SelectedTopic,
  ShortlistedNewsItem
} from "./news.js";

export interface PipelineOutputFiles {
  rawNews: string;
  normalizedNews: string;
  rejectedNews: string;
  candidateNews: string;
  collectionReport: string;
  shortlistedNews: string;
  shortlistReport: string;
  selectedTopic: string;
  topicSelectionReport: string;
  topicFactPackJson: string;
  topicFactPackReport: string;
  article: string;
  articleMeta: string;
  articleWritingReport: string;
  articleReview: string;
  articleReviewReport: string;
  dailyReport: string;
}

export interface DailyPipelineArtifacts {
  candidates: NormalizedNewsItem[];
  shortlisted: ShortlistedNewsItem[];
  selectedTopic: SelectedTopic;
  topicFactPack: TopicFactPack;
  article: ArticleDraft;
  articleMeta: ArticleMeta;
  articleReview: ArticleReviewResult;
}

export interface DailyPipelineResult {
  outputDir: string;
  files: PipelineOutputFiles;
  artifacts: DailyPipelineArtifacts;
  collectionStats: NewsCollectionStats;
  shortlistStats: NewsShortlistStats;
  durationMs: number;
}
