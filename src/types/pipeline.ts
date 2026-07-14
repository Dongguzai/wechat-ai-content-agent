import type { TopicFactPack } from "./factPack.js";
import type { TopicProfile } from "./topicProfile.js";
import type { ResearchPlan } from "./researchPlan.js";
import type { SourceEvidence } from "./sourceEvidence.js";
import type { EditorialPlan } from "./editorialPlan.js";
import type {
  ArticleDraft,
  ArticleMeta,
  ArticleReviewResult
} from "./article.js";
import type { CoverResult, CoverReviewResult } from "./cover.js";
import type { WechatLayoutResult } from "./layout.js";
import type { WechatDraftResult } from "./wechatDraft.js";
import type {
  EditorialApprovalLoadResult,
  EditorialBrief,
  EditorialStyleLoadResult,
  ManualTopicLoadResult
} from "./editorial.js";
import type { EditorialFeedbackLoadResult } from "./feedback.js";
import type { TitleCandidate, TitleSelectionSummary } from "./title.js";
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
import type { SourceHealthResult } from "./sourceHealth.js";

export interface PipelineOutputFiles {
  sourceHealth: string;
  sourceHealthReport: string;
  rawNews: string;
  normalizedNews: string;
  rejectedNews: string;
  candidateNews: string;
  collectionReport: string;
  shortlistedNews: string;
  shortlistReport: string;
  selectedTopic: string;
  topicSelectionReport: string;
  editorialBrief: string;
  editorialBriefJson: string;
  topicProfileJson: string;
  topicProfileReport: string;
  researchPlanJson: string;
  researchPlanReport: string;
  sourceEvidenceJson: string;
  sourceEvidenceReport: string;
  editorialPlanJson: string;
  editorialPlanReport: string;
  topicFactPackJson: string;
  topicFactPackReport: string;
  article: string;
  articleMeta: string;
  articleWritingReport: string;
  titleCandidates: string;
  titleSelectionReport: string;
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
  candidates?: NormalizedNewsItem[];
  shortlisted?: ShortlistedNewsItem[];
  selectedTopic?: SelectedTopic;
  manualTopic?: ManualTopicLoadResult;
  editorialStyle?: EditorialStyleLoadResult;
  editorialFeedback?: EditorialFeedbackLoadResult;
  editorialBrief?: EditorialBrief;
  editorialApproval?: EditorialApprovalLoadResult;
  sourceHealth?: SourceHealthResult;
  topicProfile?: TopicProfile;
  researchPlan?: ResearchPlan;
  sourceEvidence?: SourceEvidence;
  editorialPlan?: EditorialPlan;
  topicFactPack?: TopicFactPack;
  article?: ArticleDraft;
  articleMeta?: ArticleMeta;
  titleCandidates?: TitleCandidate[];
  titleSelection?: TitleSelectionSummary;
  articleReview?: ArticleReviewResult;
  cover?: CoverResult;
  coverReview?: CoverReviewResult;
  wechatLayout?: WechatLayoutResult;
  wechatDraft?: WechatDraftResult;
  wechatApiDraft?: WechatApiDraftResult;
  wechatApiPreflight?: WechatApiPreflight;
}

export interface DailyPipelineResult {
  outputDir: string;
  files: PipelineOutputFiles;
  artifacts: DailyPipelineArtifacts;
  currentStage: string;
  stoppedAt: string;
  nextCommand: string;
  collectionStats?: NewsCollectionStats;
  shortlistStats?: NewsShortlistStats;
  durationMs: number;
}
