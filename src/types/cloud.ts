export const EDITORIAL_BRIEF_RUN_TYPE = "editorial_brief";

export type CloudRunType = typeof EDITORIAL_BRIEF_RUN_TYPE;
export type CloudRunStatus = "running" | "success" | "failed";

export const CLOUD_BRIEF_GENERATION_STEPS = [
  "auth",
  "config.validate",
  "db.connect",
  "db.findExistingRun",
  "db.createRun",
  "collectNews",
  "shortlistNews",
  "selectTopic",
  "db.saveNewsItems",
  "db.saveShortlistedItems",
  "db.saveEditorialBrief",
  "r2.uploadBriefReport",
  "db.markRunSuccess",
  "db.markRunFailed"
] as const;

export type CloudBriefGenerationStep = typeof CLOUD_BRIEF_GENERATION_STEPS[number];

export interface CloudRunRecord {
  id: string;
  runDate: string;
  runType: CloudRunType;
  status: CloudRunStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudNewsItemRecord {
  id: string;
  runId: string;
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  provider?: string;
  query?: string;
  summary: string;
  publishedAt?: string;
  fetchedAt: string;
  score: number;
  rawJson: unknown;
  createdAt: string;
}

export interface CloudShortlistedItemRecord {
  id: string;
  runId: string;
  newsItemId: string;
  rank: number;
  title: string;
  rawTitle?: string;
  titleZh?: string;
  url: string;
  sourceName: string;
  sourceType: string;
  provider?: string;
  query?: string;
  category: string;
  tags: string[];
  summary: string;
  rawSummary?: string;
  summaryZh?: string;
  topicAngle: string;
  topicAngleZh?: string;
  shortlistReason: string;
  shortlistReasonZh?: string;
  shortlistScore: number;
  riskNotes: string[];
  riskNotesZh?: string[];
  sourceLanguage?: "zh" | "en" | "unknown";
  localized?: boolean;
  createdAt: string;
}

export interface CloudEditorialBriefRecord {
  id: string;
  runId: string;
  recommendedTopicId: string;
  recommendedTitle: string;
  recommendedUrl: string;
  recommendationReason: string;
  coreConflict: string;
  writingAngle: string;
  articleThesis: string;
  sourceReliability: string;
  riskNotes: string[];
  shouldPublishToday: boolean;
  publishRecommendationReason: string;
  reportR2Key?: string;
  createdAt: string;
}

export interface CloudArticleHandoffPayload {
  approval: {
    approvedByUser: boolean;
    approvedTopicId: string;
    approvedTitle: string;
    notes: string;
  };
  candidateNews: unknown[];
  shortlistedNews: unknown[];
  selectedTopic: unknown;
  editorialBrief: unknown;
}

export interface CloudTopicSelectionRecord {
  id: string;
  runId: string;
  selectedShortlistedItemId: string;
  approvedTitle: string;
  approvalNotes: string;
  approvalJson: unknown;
  handoffJson: CloudArticleHandoffPayload;
  createdAt: string;
  updatedAt: string;
}

export interface TodayBriefPayload {
  run: CloudRunRecord | null;
  brief: CloudEditorialBriefRecord | null;
  shortlistedItems: CloudShortlistedItemRecord[];
  topicSelection?: CloudTopicSelectionRecord | null;
}
