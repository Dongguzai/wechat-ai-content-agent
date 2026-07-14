import type { NewsItem } from "./news.js";
import type { LlmRunMetadata } from "./llm.js";
import type { EditorialApproval } from "./editorial.js";

export interface SelectedTopic {
  news: NewsItem;
  angle: string;
  rationale: string;
  targetAudience: string;
  selectedAt: string;
}

export interface ArticleSection {
  heading: string;
  body: string;
  planSectionId?: string;
  role?: string;
  claimIds?: string[];
}

export interface ArticleDraft {
  title: string;
  subtitle: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceName: string;
  sourceTopic: string;
  articleThesis: string;
  markdown: string;
  sections: ArticleSection[];
  wordCount: number;
  usedClaims: ArticleUsedClaim[];
  riskControls: string[];
  createdAt: string;
}

export interface ArticleUsedClaim {
  id?: string;
  claim: string;
  safeWording: string;
  sourceUrls: string[];
  evidenceIds?: string[];
  evidenceSnippetIds?: string[];
  status?: string;
}

export interface ArticleMeta {
  title: string;
  wordCount: number;
  sourceTopic: string;
  articleThesis: string;
  usedClaims: ArticleUsedClaim[];
  riskControls: string[];
  editorialPlan?: {
    id: string;
    contentMode: string;
    sectionClaimMap: Array<{
      sectionId: string;
      allowedClaimIds: string[];
    }>;
    requiredThemes: string[];
  };
  editorialApproval?: EditorialApproval;
  llm?: LlmRunMetadata;
  generatedAt: string;
}

export interface ArticleWritingOutputFiles {
  article: string;
  articleMeta: string;
  articleWritingReport: string;
  articleAttempt1: string;
  articleRepair1: string;
  articleRepair2: string;
  articleValidation: string;
  articleWritingError: string;
  articleWritingErrorReport: string;
}

export interface ArticleWritingResult {
  outputDir: string;
  files: ArticleWritingOutputFiles;
  article: ArticleDraft;
  meta: ArticleMeta;
  report: string;
}

export type ArticleReviewIssueType =
  | "fact"
  | "logic"
  | "style"
  | "title"
  | "policy"
  | "structure";

export type ArticleReviewSeverity = "low" | "medium" | "high";
export type ArticleReviewIssueSource =
  | "local_rule"
  | "review_policy"
  | "fact_pack"
  | "auxiliary_llm";

export interface ArticleReviewIssue {
  type: ArticleReviewIssueType;
  severity: ArticleReviewSeverity;
  message: string;
  evidence: string;
  suggestion: string;
  ruleId: string;
  policyId?: string;
  source: ArticleReviewIssueSource;
  blocking: boolean;
}

export interface ArticleFactBoundaryCheck {
  passed: boolean;
  violations: string[];
}

export interface ArticleQualityCheck {
  wordCountOk: boolean;
  hasTitle: boolean;
  hasHeadings: boolean;
  thirdPersonPerspective: boolean;
  notNewsRelease: boolean;
  themesCovered: string[];
}

export interface ArticleReviewResult {
  passed: boolean;
  score: number;
  summary: string;
  issues: ArticleReviewIssue[];
  requiredFixes: string[];
  optionalSuggestions: string[];
  factBoundaryCheck: ArticleFactBoundaryCheck;
  qualityCheck: ArticleQualityCheck;
  reviewPolicies?: Array<{
    id: string;
    version: string;
    title: string;
    sourcePath: string;
    matchReasons: string[];
  }>;
  llm?: LlmRunMetadata;
  finalVerdict: string;
  generatedAt: string;
}

export interface ArticleReviewOutputFiles {
  articleReview: string;
  articleReviewReport: string;
}

export interface ArticleReviewPipelineResult {
  outputDir: string;
  files: ArticleReviewOutputFiles;
  review: ArticleReviewResult;
  report: string;
}

export interface CoverInfo {
  mode: "mock";
  title: string;
  prompt: string;
  imageUrl: string;
  altText: string;
  createdAt: string;
}

export interface WechatHtmlRender {
  html: string;
  renderedAt: string;
  wordCount: number;
}
