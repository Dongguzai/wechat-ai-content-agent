import type { NewsItem } from "./news.js";

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
  claim: string;
  safeWording: string;
  sourceUrls: string[];
}

export interface ArticleMeta {
  title: string;
  wordCount: number;
  sourceTopic: string;
  articleThesis: string;
  usedClaims: ArticleUsedClaim[];
  riskControls: string[];
  generatedAt: string;
}

export interface ArticleWritingOutputFiles {
  article: string;
  articleMeta: string;
  articleWritingReport: string;
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

export interface ArticleReviewIssue {
  type: ArticleReviewIssueType;
  severity: ArticleReviewSeverity;
  message: string;
  evidence: string;
  suggestion: string;
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
