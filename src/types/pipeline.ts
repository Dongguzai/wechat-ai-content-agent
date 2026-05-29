import type {
  NewsCollectionStats,
  NewsShortlistStats,
  NormalizedNewsItem,
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
  dailyReport: string;
}

export interface DailyPipelineArtifacts {
  candidates: NormalizedNewsItem[];
  shortlisted: ShortlistedNewsItem[];
}

export interface DailyPipelineResult {
  outputDir: string;
  files: PipelineOutputFiles;
  artifacts: DailyPipelineArtifacts;
  collectionStats: NewsCollectionStats;
  shortlistStats: NewsShortlistStats;
  durationMs: number;
}
