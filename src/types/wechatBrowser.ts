export type WechatBrowserDraftMode = "browser-disabled" | "browser-real";

export type WechatBrowserStepSafetyCheck = "passed" | "blocked";

export interface WechatBrowserDraftStep {
  id: string;
  label: string;
  allowed: boolean;
  requiresHumanAction: boolean;
  safetyCheck: WechatBrowserStepSafetyCheck;
  notes: string;
}

export interface WechatBrowserDraftPlan {
  mode: WechatBrowserDraftMode;
  browserDisabled: boolean;
  realBrowserEnabled: boolean;
  allowSaveDraft: boolean;
  allowPreview: boolean;
  targetUrl: "https://mp.weixin.qq.com";
  steps: WechatBrowserDraftStep[];
  forbiddenActions: string[];
  humanCheckpoints: string[];
  generatedAt: string;
}

export interface WechatBrowserSafetyCheck {
  passed: boolean;
  realBrowserEnabled: boolean;
  allowSaveDraft: boolean;
  allowPreview: boolean;
  articleReviewPassed: boolean;
  coverReviewPassed: boolean;
  layoutAllowedNextStage: boolean;
  forbiddenActionsBlocked: boolean;
  credentialsStored: false;
  cookieTokenCommitted: false;
  issues: string[];
  generatedAt: string;
}

export interface WechatBrowserDraftOutputFiles {
  wechatBrowserDraftPlan: string;
  wechatBrowserDraftPlanReport: string;
  wechatBrowserSafetyCheck: string;
}

export interface WechatBrowserDraftPipelineResult {
  outputDir: string;
  files: WechatBrowserDraftOutputFiles;
  plan: WechatBrowserDraftPlan;
  safetyCheck: WechatBrowserSafetyCheck;
  report: string;
}
