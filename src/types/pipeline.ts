import type {
  ArticleDraft,
  ArticleReviewResult,
  CoverInfo,
  SelectedTopic,
  WechatDraftResult,
  WechatHtmlRender
} from "./article.js";
import type { NewsItem } from "./news.js";

export interface PipelineOutputFiles {
  latestNews: string;
  selectedTopic: string;
  articleMarkdown: string;
  articleReview: string;
  cover: string;
  wechatHtml: string;
  dailyReport: string;
}

export interface DailyPipelineArtifacts {
  news: NewsItem[];
  selectedTopic: SelectedTopic;
  article: ArticleDraft;
  review: ArticleReviewResult;
  cover: CoverInfo;
  wechatHtml: WechatHtmlRender;
  draft: WechatDraftResult;
}

export interface DailyPipelineResult {
  outputDir: string;
  files: PipelineOutputFiles;
  artifacts: DailyPipelineArtifacts;
  durationMs: number;
}
