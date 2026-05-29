import type { SourceReliability } from "./news.js";

export type FactClaimStatus = "verified" | "partially_verified" | "unverified";

export type FactRiskLevel = "low" | "medium" | "high";

export interface FactPackClaim {
  claim: string;
  status: FactClaimStatus;
  sourceUrls: string[];
  safeWording: string;
  risk: FactRiskLevel;
}

export interface FactPackSubject {
  pricing: string;
  positioning: string;
  capabilities: string[];
  sourceUrls: string[];
}

export interface TopicFactPackComparison {
  claudeCode: FactPackSubject;
  goose: FactPackSubject;
  similarities: string[];
  differences: string[];
  unsafeComparisonClaims: string[];
}

export interface TopicFactPack {
  topicTitle: string;
  generatedAt: string;
  sourceReliability: SourceReliability;
  verifiedClaims: FactPackClaim[];
  comparison: TopicFactPackComparison;
  safeWritingBoundary: string[];
  riskNotes: string[];
  recommendedFraming: string;
  articleAngleSuggestions: string[];
}

export interface TopicFactPackOutputFiles {
  topicFactPackJson: string;
  topicFactPackReport: string;
}

export interface TopicFactPackResult {
  outputDir: string;
  files: TopicFactPackOutputFiles;
  factPack: TopicFactPack;
}
