import type { NewsSourceType, SearchProvider } from "./news.js";

export interface EditorialStyleLoadResult {
  path: string;
  content: string;
  loaded: boolean;
}

export interface ManualTopicLoadResult {
  filePath: string;
  used: boolean;
  content: string;
  title?: string;
  sourceUrl?: string;
  sourceName?: string;
  angle?: string;
  thesis?: string;
}

export interface EditorialBriefCandidate {
  id: string;
  title: string;
  rawTitle?: string;
  titleZh?: string;
  sourceName: string;
  sourceType: string;
  url: string;
  score: number;
  summary: string;
  rawSummary?: string;
  summaryZh?: string;
}

export interface EditorialBriefShortlistedItem {
  id: string;
  rank: number;
  title: string;
  rawTitle?: string;
  titleZh?: string;
  url: string;
  sourceName: string;
  sourceType: NewsSourceType;
  provider: SearchProvider | null;
  query: string | null;
  category: string;
  tags: string[];
  summary: string;
  rawSummary?: string;
  summaryZh?: string;
  riskNotes: string[];
  shortlistScore: number;
  topicAngle: string;
  topicAngleZh?: string;
  shortlistReason: string;
  shortlistReasonZh?: string;
  sourceLanguage?: "zh" | "en" | "unknown";
  localized?: boolean;
}

export interface EditorialBriefRecommendedTopic {
  id: string;
  title: string;
  rawTitle?: string;
  titleZh?: string;
  url: string;
  reason: string;
  coreConflict: string;
  writingAngle: string;
  articleThesis: string;
  sourceReliability: "high" | "medium" | "low";
  riskNotes: string[];
}

export interface EditorialBriefRunnerUp {
  id: string;
  title: string;
  url: string;
  reason: string;
  whyNotSelected: string;
}

export interface EditorialBriefRiskReminder {
  factRisk: string;
  sourceRisk: string;
  titleRisk: string;
  needsManualCheck: boolean;
}

export interface EditorialBrief {
  generatedAt: string;
  candidateCount: number;
  shortlistedCount: number;
  candidates: EditorialBriefCandidate[];
  shortlistedItems: EditorialBriefShortlistedItem[];
  /**
   * Legacy alias retained for older dashboard/readers. New code should use
   * shortlistedItems.
   */
  shortlisted: EditorialBriefShortlistedItem[];
  recommendedTopic: EditorialBriefRecommendedTopic;
  runnersUp: EditorialBriefRunnerUp[];
  riskReminder: EditorialBriefRiskReminder;
  shouldPublishToday: boolean;
  publishRecommendationReason: string;
  approvalRequired: true;
  nextStep: "Read the 10 shortlisted source URLs, then edit inputs/editorial-approval.json.";
}

export interface EditorialBriefOutputFiles {
  markdown: string;
  json: string;
}

export interface EditorialBriefResult {
  outputDir: string;
  files: EditorialBriefOutputFiles;
  brief: EditorialBrief;
  markdown: string;
}

export interface EditorialApproval {
  approvedByUser: boolean;
  approvedTopicId: string;
  approvedTitle: string;
  notes: string;
}

export type EditorialApprovalMatchKind =
  | "selected-topic"
  | "shortlisted-news"
  | "none";

export interface EditorialApprovalLoadResult {
  approvalRequired: true;
  approvalFile: string;
  approvalRead: boolean;
  approvedByUser: boolean;
  approvedTopicId: string;
  approvedTitle: string;
  notes: string;
  matchedTopicKind: EditorialApprovalMatchKind;
  matchedTopicId?: string;
  aiRecommendedTopicId?: string;
  userApprovedTopicId?: string;
  userChangedTopic?: boolean;
  blockedReason?: string;
}
