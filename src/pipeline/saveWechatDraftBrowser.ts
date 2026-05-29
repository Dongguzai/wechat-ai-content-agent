import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWechatBrowserDraftPlan,
  type WechatBrowserArtifactStatus
} from "../adapters/wechatBrowser.js";
import type { ArticleReviewResult } from "../types/article.js";
import type { CoverResult, CoverReviewResult } from "../types/cover.js";
import type { WechatLayoutResult } from "../types/layout.js";
import type { WechatDraftResult } from "../types/wechatDraft.js";
import type {
  WechatBrowserDraftOutputFiles,
  WechatBrowserDraftPipelineResult,
  WechatBrowserDraftPlan,
  WechatBrowserSafetyCheck
} from "../types/wechatBrowser.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface SaveWechatDraftBrowserOptions {
  outputDir?: string;
  docsDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultOutputDir = join(projectRoot, "outputs");
const defaultDocsDir = join(projectRoot, "docs");

function createOutputFiles(outputDir: string): WechatBrowserDraftOutputFiles {
  return {
    wechatBrowserDraftPlan: join(outputDir, "wechat-browser-draft-plan.json"),
    wechatBrowserDraftPlanReport: join(
      outputDir,
      "wechat-browser-draft-plan.md"
    ),
    wechatBrowserSafetyCheck: join(outputDir, "wechat-browser-safety-check.json")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function textFileExistsAndNotEmpty(path: string): Promise<boolean> {
  try {
    const content = await readFile(path, "utf8");
    return content.trim().length > 0;
  } catch {
    return false;
  }
}

function resolveArtifactPath(path: string, outputDir: string): string {
  if (isAbsolute(path)) {
    return path;
  }

  if (path.startsWith("outputs/")) {
    return join(projectRoot, path);
  }

  return join(outputDir, path);
}

async function collectArtifactStatus(input: {
  outputDir: string;
  docsDir: string;
}): Promise<WechatBrowserArtifactStatus> {
  const articleReviewFile = join(input.outputDir, "article-review.json");
  const coverReviewFile = join(input.outputDir, "cover-review.json");
  const coverFile = join(input.outputDir, "cover.json");
  const wechatLayoutFile = join(input.outputDir, "wechat-layout.json");
  const wechatHtmlFile = join(input.outputDir, "wechat.html");
  const wechatDraftResultFile = join(input.outputDir, "wechat-draft-result.json");

  const [articleReview, coverReview, cover, layout, draftResult] =
    await Promise.all([
      readJsonFile<ArticleReviewResult>(articleReviewFile),
      readJsonFile<CoverReviewResult>(coverReviewFile),
      readJsonFile<CoverResult>(coverFile),
      readJsonFile<WechatLayoutResult>(wechatLayoutFile),
      readJsonFile<WechatDraftResult>(wechatDraftResultFile)
    ]);
  const sopFiles = [
    join(input.docsDir, "wechat-draft-browser-sop.md"),
    join(input.docsDir, "wechat-draft-browser-checklist.md"),
    join(input.docsDir, "wechat-draft-risk-map.md")
  ];

  return {
    articleReviewPassed: articleReview.passed,
    coverReviewPassed: coverReview.passed,
    layoutAllowedNextStage: layout.allowedNextStage,
    htmlExists: await textFileExistsAndNotEmpty(wechatHtmlFile),
    coverImageExists:
      cover.imagePath.trim().length > 0 &&
      (await fileExists(resolveArtifactPath(cover.imagePath, input.outputDir))),
    mockDraftDryRunPassed:
      draftResult.mode === "mock" && draftResult.status === "draft_saved",
    sopDocsAvailable: (
      await Promise.all(sopFiles.map((file) => textFileExistsAndNotEmpty(file)))
    ).every(Boolean)
  };
}

function createPlanReport(input: {
  plan: WechatBrowserDraftPlan;
  safetyCheck: WechatBrowserSafetyCheck;
}): string {
  const { plan, safetyCheck } = input;
  const stepLines = plan.steps.map(
    (step) =>
      `- ${step.id}: ${step.label} | allowed=${step.allowed} | requiresHumanAction=${step.requiresHumanAction} | safetyCheck=${step.safetyCheck} | ${step.notes}`
  );
  const humanCheckpointLines = plan.humanCheckpoints.map(
    (checkpoint) => `- ${checkpoint}`
  );
  const forbiddenActionLines = plan.forbiddenActions.map((action) => `- ${action}`);
  const issueLines =
    safetyCheck.issues.length > 0
      ? safetyCheck.issues.map((issue) => `- ${issue}`)
      : ["- none"];

  return [
    "# WeChat Browser Draft Plan",
    "",
    "## 1. 当前模式",
    "",
    plan.mode,
    "",
    "## 2. 是否会打开真实浏览器",
    "",
    plan.realBrowserEnabled
      ? "是，但本 9B-1 骨架只生成计划；真实 DOM selector 仍为 TODO。"
      : "否。WECHAT_BROWSER_ENABLE_REAL=false，当前只生成 browser-disabled plan。",
    "",
    "## 3. 是否允许保存草稿",
    "",
    plan.allowSaveDraft ? "是" : "否",
    "",
    "## 4. 是否允许生成预览",
    "",
    plan.allowPreview ? "是" : "否",
    "",
    "## 5. 操作步骤",
    "",
    ...stepLines,
    "",
    "## 6. 人工介入点",
    "",
    ...humanCheckpointLines,
    "",
    "## 7. 禁止动作",
    "",
    ...forbiddenActionLines,
    "",
    "## 8. 安全检查结果",
    "",
    `- passed: ${safetyCheck.passed}`,
    `- realBrowserEnabled: ${safetyCheck.realBrowserEnabled}`,
    `- allowSaveDraft: ${safetyCheck.allowSaveDraft}`,
    `- allowPreview: ${safetyCheck.allowPreview}`,
    `- articleReviewPassed: ${safetyCheck.articleReviewPassed}`,
    `- coverReviewPassed: ${safetyCheck.coverReviewPassed}`,
    `- layoutAllowedNextStage: ${safetyCheck.layoutAllowedNextStage}`,
    `- forbiddenActionsBlocked: ${safetyCheck.forbiddenActionsBlocked}`,
    `- credentialsStored: ${safetyCheck.credentialsStored}`,
    `- cookieTokenCommitted: ${safetyCheck.cookieTokenCommitted}`,
    "",
    "### issues",
    "",
    ...issueLines,
    "",
    "## 9. 下一步需要用户明确确认的事项",
    "",
    "- 是否允许设置 WECHAT_BROWSER_ENABLE_REAL=true 并打开微信公众号后台。",
    "- 是否已准备人工扫码登录。",
    "- 是否允许设置 WECHAT_BROWSER_ALLOW_SAVE_DRAFT=true 后真实点击保存草稿。",
    "- 是否允许设置 WECHAT_BROWSER_ALLOW_PREVIEW=true 后生成预览。",
    "- 是否确认不保存账号密码、cookie、token 或二维码到仓库。",
    "- 是否确认系统不得自动发布、不得自动群发、不得确认任何最终发送弹窗。",
    "",
    "## 10. 发布边界",
    "",
    "- 系统只能保存草稿。",
    "- 系统只能生成预览。",
    "- 系统不得自动发布。",
    "- 系统不得自动群发。",
    "- 系统不得确认任何最终发送弹窗。",
    "- 最终发布必须人工操作。",
    ""
  ].join("\n");
}

export async function saveWechatDraftBrowserPlanWithReport(
  options: SaveWechatDraftBrowserOptions = {}
): Promise<WechatBrowserDraftPipelineResult> {
  const logger = options.logger ?? createLogger("wechat-browser-draft-plan");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const docsDir = options.docsDir ?? defaultDocsDir;
  const files = createOutputFiles(outputDir);
  const artifacts = await collectArtifactStatus({ outputDir, docsDir });
  const { plan, safetyCheck } = createWechatBrowserDraftPlan({
    env: options.env,
    now: options.now,
    artifacts
  });
  const report = createPlanReport({ plan, safetyCheck });

  if (options.writeOutputs ?? true) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.wechatBrowserDraftPlan, plan);
    await writeFile(files.wechatBrowserDraftPlanReport, report, "utf8");
    await writeJson(files.wechatBrowserSafetyCheck, safetyCheck);
  }

  logger.info(
    `Generated WeChat browser draft plan; mode=${plan.mode}; browserDisabled=${plan.browserDisabled}.`
  );

  return {
    outputDir,
    files,
    plan,
    safetyCheck,
    report
  };
}
