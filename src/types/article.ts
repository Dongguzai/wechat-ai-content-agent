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

export interface ArticleReviewResult {
  passed: boolean;
  riskLevel: "low" | "medium" | "high";
  issues: string[];
  suggestions: string[];
  reviewedAt: string;
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

export interface WechatDraftResult {
  mode: "mock";
  draftId: string;
  title: string;
  status: "mock_saved";
  savedAt: string;
  note: string;
}
