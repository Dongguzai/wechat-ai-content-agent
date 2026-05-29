import {
  FORBIDDEN_AUTO_PUBLISH_TERMS,
  forbidAutoPublish
} from "../hooks/forbidAutoPublish.js";
import type {
  WechatBrowserDraftPlan,
  WechatBrowserDraftStep,
  WechatBrowserSafetyCheck,
  WechatBrowserStepSafetyCheck
} from "../types/wechatBrowser.js";

export const WECHAT_BROWSER_TARGET_URL = "https://mp.weixin.qq.com" as const;

export interface WechatBrowserRuntimeConfig {
  realBrowserEnabled: boolean;
  headless: boolean;
  userDataDir: string;
  allowSaveDraft: boolean;
  allowPreview: boolean;
}

export interface WechatBrowserArtifactStatus {
  articleReviewPassed: boolean;
  coverReviewPassed: boolean;
  layoutAllowedNextStage: boolean;
  htmlExists: boolean;
  coverImageExists: boolean;
  mockDraftDryRunPassed: boolean;
  sopDocsAvailable: boolean;
}

export interface CreateWechatBrowserDraftPlanInput {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  artifacts: WechatBrowserArtifactStatus;
}

export interface WechatBrowserActionLabelReview {
  label: string;
  safetyCheck: WechatBrowserStepSafetyCheck;
  reason?: string;
}

interface StepDefinition {
  id: string;
  label: string;
  requiresHumanAction: boolean;
  gate:
    | "preflight"
    | "browser"
    | "human-login"
    | "save-draft"
    | "preview"
    | "stop";
}

const stepDefinitions: StepDefinition[] = [
  {
    id: "preflight-artifacts",
    label: "前置产物检查",
    requiresHumanAction: false,
    gate: "preflight"
  },
  {
    id: "open-wechat-admin",
    label: "打开公众号后台",
    requiresHumanAction: false,
    gate: "browser"
  },
  {
    id: "wait-human-scan-login",
    label: "等待人工扫码登录",
    requiresHumanAction: true,
    gate: "human-login"
  },
  {
    id: "enter-draft-page",
    label: "进入图文/草稿页面",
    requiresHumanAction: false,
    gate: "browser"
  },
  {
    id: "create-new-article",
    label: "新建图文",
    requiresHumanAction: false,
    gate: "browser"
  },
  {
    id: "fill-title",
    label: "填写标题",
    requiresHumanAction: false,
    gate: "browser"
  },
  {
    id: "paste-html",
    label: "粘贴正文 HTML",
    requiresHumanAction: false,
    gate: "browser"
  },
  {
    id: "upload-cover",
    label: "上传封面图",
    requiresHumanAction: false,
    gate: "browser"
  },
  {
    id: "fill-digest",
    label: "填写摘要",
    requiresHumanAction: false,
    gate: "browser"
  },
  {
    id: "save-draft",
    label: "保存草稿",
    requiresHumanAction: false,
    gate: "save-draft"
  },
  {
    id: "generate-preview",
    label: "生成预览",
    requiresHumanAction: false,
    gate: "preview"
  },
  {
    id: "stop-for-human-confirmation",
    label: "停止并等待人工确认",
    requiresHumanAction: true,
    gate: "stop"
  }
];

function parseBoolean(value: string | undefined): boolean {
  return value === "true";
}

export function createWechatBrowserRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WechatBrowserRuntimeConfig {
  return {
    realBrowserEnabled: parseBoolean(env.WECHAT_BROWSER_ENABLE_REAL),
    headless: parseBoolean(env.WECHAT_BROWSER_HEADLESS),
    userDataDir:
      env.WECHAT_BROWSER_USER_DATA_DIR || ".local/wechat-browser-profile",
    allowSaveDraft: parseBoolean(env.WECHAT_BROWSER_ALLOW_SAVE_DRAFT),
    allowPreview: parseBoolean(env.WECHAT_BROWSER_ALLOW_PREVIEW)
  };
}

export function reviewWechatBrowserActionLabel(
  label: string
): WechatBrowserActionLabelReview {
  try {
    forbidAutoPublish(label);
    return {
      label,
      safetyCheck: "passed"
    };
  } catch (error) {
    return {
      label,
      safetyCheck: "blocked",
      reason: error instanceof Error ? error.message : "Blocked by publish guard."
    };
  }
}

function forbiddenActionsBlocked(): boolean {
  return FORBIDDEN_AUTO_PUBLISH_TERMS.every(
    (term) => reviewWechatBrowserActionLabel(term).safetyCheck === "blocked"
  );
}

function createIssues(input: {
  artifacts: WechatBrowserArtifactStatus;
  forbiddenActionsBlocked: boolean;
}): string[] {
  const issues: string[] = [];
  const { artifacts } = input;

  if (!artifacts.articleReviewPassed) {
    issues.push("Article review has not passed.");
  }

  if (!artifacts.coverReviewPassed) {
    issues.push("Cover review has not passed.");
  }

  if (!artifacts.layoutAllowedNextStage) {
    issues.push("WeChat layout does not allow the browser draft stage.");
  }

  if (!artifacts.htmlExists) {
    issues.push("outputs/wechat.html is missing or empty.");
  }

  if (!artifacts.coverImageExists) {
    issues.push("Cover imagePath is missing or points to an unavailable file.");
  }

  if (!artifacts.mockDraftDryRunPassed) {
    issues.push("9A mock draft dry-run result is missing or not draft_saved.");
  }

  if (!artifacts.sopDocsAvailable) {
    issues.push("9B-0 SOP documents are missing.");
  }

  if (!input.forbiddenActionsBlocked) {
    issues.push("Forbidden publish or send actions are not fully blocked.");
  }

  return issues;
}

export function createWechatBrowserSafetyCheck(
  input: CreateWechatBrowserDraftPlanInput
): WechatBrowserSafetyCheck {
  const config = createWechatBrowserRuntimeConfig(input.env);
  const blocked = forbiddenActionsBlocked();
  const issues = createIssues({
    artifacts: input.artifacts,
    forbiddenActionsBlocked: blocked
  });
  const generatedAt = (input.now ?? new Date()).toISOString();

  return {
    passed: issues.length === 0,
    realBrowserEnabled: config.realBrowserEnabled,
    allowSaveDraft: config.allowSaveDraft,
    allowPreview: config.allowPreview,
    articleReviewPassed: input.artifacts.articleReviewPassed,
    coverReviewPassed: input.artifacts.coverReviewPassed,
    layoutAllowedNextStage: input.artifacts.layoutAllowedNextStage,
    forbiddenActionsBlocked: blocked,
    credentialsStored: false,
    cookieTokenCommitted: false,
    issues,
    generatedAt
  };
}

function evaluateStep(input: {
  definition: StepDefinition;
  config: WechatBrowserRuntimeConfig;
  safetyCheck: WechatBrowserSafetyCheck;
}): Pick<WechatBrowserDraftStep, "allowed" | "safetyCheck" | "notes"> {
  const labelReview = reviewWechatBrowserActionLabel(input.definition.label);

  if (labelReview.safetyCheck === "blocked") {
    return {
      allowed: false,
      safetyCheck: "blocked",
      notes: labelReview.reason ?? "Blocked by forbidAutoPublish."
    };
  }

  if (input.definition.gate === "stop") {
    return {
      allowed: true,
      safetyCheck: "passed",
      notes: "Mandatory stop point. Wait for human confirmation and do not continue to publish or mass send."
    };
  }

  if (!input.safetyCheck.passed) {
    return {
      allowed: false,
      safetyCheck: "blocked",
      notes: "Blocked because preflight safety check did not pass."
    };
  }

  if (input.definition.gate === "preflight") {
    return {
      allowed: true,
      safetyCheck: "passed",
      notes: "Read-only artifact and SOP check."
    };
  }

  if (!input.config.realBrowserEnabled) {
    return {
      allowed: false,
      safetyCheck: "blocked",
      notes: "WECHAT_BROWSER_ENABLE_REAL=false; browser remains disabled and no real page is opened."
    };
  }

  if (input.definition.gate === "save-draft" && !input.config.allowSaveDraft) {
    return {
      allowed: false,
      safetyCheck: "blocked",
      notes: "WECHAT_BROWSER_ALLOW_SAVE_DRAFT=false; save draft click is not allowed."
    };
  }

  if (input.definition.gate === "preview" && !input.config.allowPreview) {
    return {
      allowed: false,
      safetyCheck: "blocked",
      notes: "WECHAT_BROWSER_ALLOW_PREVIEW=false; preview generation is not allowed."
    };
  }

  return {
    allowed: true,
    safetyCheck: "passed",
    notes:
      input.definition.gate === "human-login"
        ? "Requires human QR-code scan. No credentials, cookie, or token may be stored."
        : "Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1."
  };
}

function createSteps(input: {
  config: WechatBrowserRuntimeConfig;
  safetyCheck: WechatBrowserSafetyCheck;
}): WechatBrowserDraftStep[] {
  return stepDefinitions.map((definition) => {
    const evaluation = evaluateStep({
      definition,
      config: input.config,
      safetyCheck: input.safetyCheck
    });

    return {
      id: definition.id,
      label: definition.label,
      requiresHumanAction: definition.requiresHumanAction,
      ...evaluation
    };
  });
}

export function createWechatBrowserDraftPlan(
  input: CreateWechatBrowserDraftPlanInput
): {
  plan: WechatBrowserDraftPlan;
  safetyCheck: WechatBrowserSafetyCheck;
} {
  const config = createWechatBrowserRuntimeConfig(input.env);
  const safetyCheck = createWechatBrowserSafetyCheck(input);
  const generatedAt = safetyCheck.generatedAt;
  const steps = createSteps({ config, safetyCheck });

  return {
    plan: {
      mode: config.realBrowserEnabled ? "browser-real" : "browser-disabled",
      browserDisabled: !config.realBrowserEnabled,
      realBrowserEnabled: config.realBrowserEnabled,
      allowSaveDraft: config.allowSaveDraft,
      allowPreview: config.allowPreview,
      targetUrl: WECHAT_BROWSER_TARGET_URL,
      steps,
      forbiddenActions: [...FORBIDDEN_AUTO_PUBLISH_TERMS],
      humanCheckpoints: [
        "用户显式设置 WECHAT_BROWSER_ENABLE_REAL=true",
        "用户准备人工扫码登录",
        "用户显式设置 WECHAT_BROWSER_ALLOW_SAVE_DRAFT=true 后才允许保存草稿",
        "用户显式设置 WECHAT_BROWSER_ALLOW_PREVIEW=true 后才允许生成预览",
        "保存草稿或生成预览后停止并等待人工确认",
        "最终发布必须人工操作"
      ],
      generatedAt
    },
    safetyCheck
  };
}
