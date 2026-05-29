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
  markdown: string;
  sections: ArticleSection[];
  wordCount: number;
  createdAt: string;
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
