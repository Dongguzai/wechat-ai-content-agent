import type { SourceReliability } from "./news.js";

export type FactClaimStatus =
  | "verified"
  | "partially_verified"
  | "conflicting"
  | "unverified";

export type FactRiskLevel = "low" | "medium" | "high";

export interface FactPackClaim {
  id?: string;
  claim: string;
  status: FactClaimStatus;
  sourceUrls: string[];
  safeWording: string;
  risk: FactRiskLevel;
  evidenceIds?: string[];
  evidenceSnippetIds?: string[];
  confidence?: number;
  requiredQualifiers?: string[];
  forbiddenWording?: string[];
  riskDimensions?: string[];
}

export interface DynamicFactClaim {
  id: string;
  statement: string;
  status: FactClaimStatus;
  evidenceIds: string[];
  evidenceSnippetIds?: string[];
  sourceUrls: string[];
  confidence: number;
  safeWording: string;
  requiredQualifiers: string[];
  forbiddenWording: string[];
  riskDimensions: string[];
}

export interface TopicFactPack {
  schemaVersion: "2.0";
  topicId: string;
  topicTitle: string;
  generatedAt: string;
  entities: Array<{
    name: string;
    type: string;
  }>;
  sourceReliability: SourceReliability;
  sourceReliabilityReason: string;
  claims: DynamicFactClaim[];
  unsupportedClaims: DynamicFactClaim[];
  conflictingClaims: DynamicFactClaim[];
  verifiedClaims: FactPackClaim[];
  safeWritingBoundary: string[];
  riskNotes: string[];
  recommendedFraming: string;
  articleAngleSuggestions: string[];
  sourceEvidenceIds: string[];
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
