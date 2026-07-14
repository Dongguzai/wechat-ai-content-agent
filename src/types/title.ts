import type { LlmRunMetadata } from "./llm.js";

export type TitleCandidateKind =
  | "judgement"
  | "contrast"
  | "trend"
  | "publicImpact"
  | "techDiscussion";

export interface TitleCandidate {
  kind: TitleCandidateKind;
  kindLabel: string;
  title: string;
  rationale: string;
  sourceClaimIds: string[];
  matchedThemes: string[];
  spreadScore: number;
  accuracyScore: number;
  nonClickbaitScore: number;
  wechatFitScore: number;
  thesisMatchScore: number;
  finalScore: number;
  violations: string[];
}

export interface TitleSelectionSummary {
  generatedAt: string;
  selectedTitle: string;
  selectedKind: TitleCandidateKind;
  selectionReason: string;
  candidates: TitleCandidate[];
  forbiddenTerms: string[];
  approvedTitleReference?: string;
  editorialStyleRead: boolean;
  feedbackRead: boolean;
  feedbackSummary?: string;
  llm?: LlmRunMetadata;
}

export interface TitleCandidatesFile {
  generatedAt: string;
  selectedTitle: string;
  selectedKind: TitleCandidateKind;
  candidates: TitleCandidate[];
  forbiddenTerms: string[];
  approvedTitleReference?: string;
  llm: LlmRunMetadata;
}

export interface TitleGenerationOutputFiles {
  titleCandidates: string;
  titleSelectionReport: string;
}

export interface TitleGenerationResult {
  outputDir: string;
  files: TitleGenerationOutputFiles;
  candidates: TitleCandidate[];
  selectedCandidate: TitleCandidate;
  selection: TitleSelectionSummary;
  articleMarkdown: string;
  articleMeta: import("./article.js").ArticleMeta;
  report: string;
}
