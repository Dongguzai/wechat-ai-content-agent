export type RealDataAuditSeverity = "blocker" | "warning";

export interface RealDataAuditCheck {
  name: string;
  passed: boolean;
  severity: RealDataAuditSeverity;
  message: string;
  details: string[];
}

export interface RealDataAuditSummary {
  candidateCount: number;
  shortlistedCount: number;
  realRssCandidateCount: number;
  realTavilyCandidateCount: number;
  realExaCandidateCount: number;
  mockCandidateCount: number;
  mockShortlistedCount: number;
  mockSearchCandidateCount: number;
  mockRssCandidateCount: number;
  mockFallbackDetected: boolean;
  coverMode: string;
  coverImagePath: string;
}

export interface RealDataAuditOutputFiles {
  result: string;
  report: string;
}

export interface RealDataAuditResult {
  passed: boolean;
  realProductionMode: boolean;
  generatedAt: string;
  outputDir: string;
  checks: RealDataAuditCheck[];
  issues: string[];
  warnings: string[];
  summary: RealDataAuditSummary;
  files: RealDataAuditOutputFiles;
}
