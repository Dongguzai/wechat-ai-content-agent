import type { TopicFactPack } from "./factPack.js";
import type {
  ArticleDraft,
  ArticleMeta,
  ArticleReviewResult
} from "./article.js";
import type { CoverResult, CoverReviewResult } from "./cover.js";
import type { WechatLayoutResult } from "./layout.js";
import type { WechatDraftResult } from "./wechatDraft.js";
import type {
  WechatApiDraftResult,
  WechatApiPreflight
} from "./wechatApiDraft.js";
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
  cover: string;
  coverPrompt: string;
  coverReview: string;
  coverImageDir: string;
  wechatHtml: string;
  wechatLayout: string;
  wechatLayoutReport: string;
  wechatDraftResult: string;
  wechatDraftReport: string;
  wechatApiDraftResult: string;
  wechatApiDraftReport: string;
  wechatApiPreflight: string;
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
  cover: CoverResult;
  coverReview: CoverReviewResult;
  wechatLayout: WechatLayoutResult;
  wechatDraft: WechatDraftResult;
  wechatApiDraft: WechatApiDraftResult;
  wechatApiPreflight: WechatApiPreflight;
}

export interface DailyPipelineResult {
  outputDir: string;
  files: PipelineOutputFiles;
  artifacts: DailyPipelineArtifacts;
  collectionStats: NewsCollectionStats;
  shortlistStats: NewsShortlistStats;
  durationMs: number;
}
