export type SourceHealthProvider = "rss" | "tavily" | "exa";

export interface SourceHealthSourceResult {
  provider: SourceHealthProvider;
  enabled: boolean;
  attempted: boolean;
  success: boolean;
  itemCount: number;
  error: string | null;
  durationMs: number;
  usedFallback: boolean;
}

export interface SourceHealthThresholds {
  minRealNewsItems: number;
  minRealRssItems: number;
  minRealSearchItems: number;
}

export interface SourceHealthSummary {
  realProductionMode: boolean;
  fallbackAllowed: boolean;
  totalRealNewsItems: number;
  realRssItems: number;
  realSearchItems: number;
  thresholds: SourceHealthThresholds;
}

export interface SourceHealthCheck {
  name: string;
  passed: boolean;
  message: string;
  details: string[];
}

export interface SourceHealthOutputFiles {
  result: string;
  report: string;
}

export interface SourceHealthResult {
  passed: boolean;
  generatedAt: string;
  outputDir: string;
  sources: SourceHealthSourceResult[];
  summary: SourceHealthSummary;
  checks: SourceHealthCheck[];
  issues: string[];
  warnings: string[];
  files: SourceHealthOutputFiles;
}
