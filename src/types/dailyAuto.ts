export type DailyAutoMode = "daily_auto";

export type DailyAutoStatus = "success" | "failed";

export type DailyAutoStepStatus = "success" | "failed" | "skipped";

export type DailyAutoStepName =
  | "env:check"
  | "same-day draft lock"
  | "run:daily"
  | "real-data-audit"
  | "wechat:draft:dry-run"
  | "preflight:final"
  | "wechat:draft:real";

export interface DailyAutoStepResult {
  name: DailyAutoStepName;
  status: DailyAutoStepStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  message: string;
}

export interface DailyAutoResult {
  mode: DailyAutoMode;
  status: DailyAutoStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  selectedTitle: string | null;
  selectedTopicUrl: string | null;
  coverImagePath: string | null;
  draftMediaId: string | null;
  draftOnly: true;
  publishApiCalled: false;
  massSendApiCalled: false;
  requiresHumanConfirmation: true;
  steps: DailyAutoStepResult[];
  error: string | null;
  generatedAt: string;
}

export interface DailyAutoOutputFiles {
  log: string;
  report: string;
  result: string;
  runReport: string;
}
