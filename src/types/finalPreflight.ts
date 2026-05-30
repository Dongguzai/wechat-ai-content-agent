export interface FinalPreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  details: string[];
}

export interface FinalPreflightOutputFiles {
  result: string;
  report: string;
}

export interface FinalPreflightResult {
  passed: boolean;
  generatedAt: string;
  outputDir: string;
  force: boolean;
  checks: FinalPreflightCheck[];
  issues: string[];
  files: FinalPreflightOutputFiles;
}
