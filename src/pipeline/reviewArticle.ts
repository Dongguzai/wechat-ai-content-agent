import { requireSourceUrl } from "../hooks/requireSourceUrl.js";
import type { ArticleDraft, ArticleReviewResult } from "../types/article.js";

export function reviewArticle(article: ArticleDraft): ArticleReviewResult {
  const issues: string[] = [];

  requireSourceUrl({
    id: "article-source",
    title: article.sourceTitle,
    url: article.sourceUrl,
    sourceName: article.sourceName,
    summary: article.subtitle,
    category: "product",
    publishedAt: article.createdAt,
    tags: [],
    scores: {
      popularity: 0,
      novelty: 0,
      relevance: 0,
      credibility: 0,
      discussionPotential: 0,
      total: 0
    }
  });

  if (article.wordCount > 1500) {
    issues.push("Article exceeds the 1500 character limit.");
  }

  if (!article.markdown.includes(article.sourceUrl)) {
    issues.push("Article must include the source url.");
  }

  return {
    passed: issues.length === 0,
    riskLevel: issues.length === 0 ? "low" : "medium",
    issues,
    suggestions:
      issues.length === 0
        ? ["Mock review passed. Keep manual fact checking before real service adapters are added."]
        : ["Fix review issues before continuing the pipeline."],
    reviewedAt: new Date().toISOString()
  };
}
