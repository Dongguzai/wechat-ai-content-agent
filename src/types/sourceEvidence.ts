export type SourceEvidenceKind =
  | "original_url"
  | "official_source"
  | "paper"
  | "github"
  | "policy_text"
  | "search_lead"
  | "reference";

export type SourceEvidenceStatus =
  | "available_metadata_only"
  | "not_fetched"
  | "unavailable"
  | "lead_only"
  | "available_body";

export type SourceEvidenceExtractionStatus =
  | "success"
  | "metadata_only"
  | "unsupported_content_type"
  | "blocked"
  | "timeout"
  | "failed";

export type SourceEvidenceReliability = "high" | "medium" | "low";

export interface SourceEvidenceSnippet {
  id: string;
  text: string;
  supportsTaskIds: string[];
  extractedFrom: "title" | "body" | "metadata";
}

export interface SourceEvidenceItem {
  id: string;
  topicId: string;
  url: string;
  title: string;
  sourceName: string;
  kind: SourceEvidenceKind;
  status: SourceEvidenceStatus;
  extractionStatus: SourceEvidenceExtractionStatus;
  evidenceSnippets: SourceEvidenceSnippet[];
  supportsTaskIds: string[];
  reliability: SourceEvidenceReliability;
  usableAsEvidence: boolean;
  rejectionReason?: string;
  publishedAt?: string;
  canSupportVerifiedClaim: boolean;
  evidenceUse: "primary" | "supporting" | "lead_only";
  unavailableReason?: string;
  notes: string[];
  policyIds: string[];
  collectedAt: string;
}

export interface SourceEvidence {
  schemaVersion: "1.0";
  id: string;
  topicId: string;
  items: SourceEvidenceItem[];
  unsupportedReasons: string[];
  collectionMode: "metadata_only" | "mixed" | "extracted";
  generatedAt: string;
}

export interface SourceEvidenceOutputFiles {
  sourceEvidenceJson: string;
  sourceEvidenceReport: string;
}

export interface SourceEvidenceResult {
  outputDir: string;
  files: SourceEvidenceOutputFiles;
  evidence: SourceEvidence;
  report: string;
}
