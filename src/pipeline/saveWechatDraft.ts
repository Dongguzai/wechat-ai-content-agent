import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_AUTO_PUBLISH_TERMS,
  forbidAutoPublish
} from "../hooks/forbidAutoPublish.js";
import type { ArticleMeta, ArticleReviewResult } from "../types/article.js";
import type { CoverResult, CoverReviewResult } from "../types/cover.js";
import type { WechatLayoutResult } from "../types/layout.js";
import type {
  WechatDraftAction,
  WechatDraftOutputFiles,
  WechatDraftPipelineResult,
  WechatDraftResult
} from "../types/wechatDraft.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface SaveWechatDraftOptions {
  outputDir?: string;
  articleFile?: string;
  articleMetaFile?: string;
  articleReviewFile?: string;
  coverFile?: string;
  coverReviewFile?: string;
  wechatHtmlFile?: string;
  wechatLayoutFile?: string;
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  articleReview?: ArticleReviewResult;
  cover?: CoverResult;
  coverReview?: CoverReviewResult;
  wechatHtml?: string;
  wechatLayout?: WechatLayoutResult;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

export const WECHAT_DRAFT_ACTION_LABELS = [
  "检查文章审核结果",
  "检查封面审核结果",
  "检查 HTML 排版结果",
  "创建草稿",
  "填写标题",
  "填写正文 HTML",
  "上传封面图",
  "保存草稿",
  "生成预览",
  "等待人工确认"
] as const;

type WechatDraftActionLabel = (typeof WECHAT_DRAFT_ACTION_LABELS)[number];

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultOutputDir = join(projectRoot, "outputs");
const humanActionRequired =
  "请人工登录微信公众号后台检查草稿预览，确认无误后再手动发布。" as const;

function createOutputFiles(outputDir: string): WechatDraftOutputFiles {
  return {
    wechatDraftResult: join(outputDir, "wechat-draft-result.json"),
    wechatDraftReport: join(outputDir, "wechat-draft-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

export function assertWechatDraftActionLabel(label: string): void {
  forbidAutoPublish(label);

  if (!WECHAT_DRAFT_ACTION_LABELS.includes(label as WechatDraftActionLabel)) {
    throw new Error(`Unsupported WeChat draft mock action label: ${label}`);
  }
}

function createPassedAction(label: WechatDraftActionLabel): WechatDraftAction {
  assertWechatDraftActionLabel(label);

  return {
    label,
    status: "passed"
  };
}

function createMockDraftId(generatedAt: string): string {
  return `mock-draft-${generatedAt.replace(/\D/g, "").slice(0, 17)}`;
}

function createMockPreviewUrl(draftId: string): string {
  return `mock://wechat-draft/${draftId}/preview`;
}

function assertArticleReviewPassed(review: ArticleReviewResult): void {
  if (!review.passed) {
    throw new Error("Article review has not passed; WeChat draft dry-run blocked.");
  }
}

function assertCoverReviewPassed(review: CoverReviewResult): void {
  if (!review.passed) {
    throw new Error("Cover review has not passed; WeChat draft dry-run blocked.");
  }
}

function assertWechatLayoutAllowed(layout: WechatLayoutResult): void {
  if (!layout.compatibleWithWechat) {
    throw new Error(
      "WeChat layout is not compatible with WeChat; draft dry-run blocked."
    );
  }

  if (!layout.allowedNextStage) {
    throw new Error(
      "WeChat layout did not allow the draft stage; draft dry-run blocked."
    );
  }
}

function assertTitleAvailable(meta: ArticleMeta): void {
  if (!meta.title.trim()) {
    throw new Error("Article title is empty; WeChat draft dry-run blocked.");
  }
}

function assertHtmlAvailable(html: string): void {
  if (!html.trim()) {
    throw new Error("wechat.html is empty; WeChat draft dry-run blocked.");
  }
}

function assertCoverPathAvailable(cover: CoverResult): void {
  if (!cover.imagePath.trim()) {
    throw new Error("Cover imagePath is empty; WeChat draft dry-run blocked.");
  }
}

function createDraftReport(result: WechatDraftResult): string {
  const actionLines = result.actions.map(
    (action) =>
      `- ${action.label}: ${action.status}${action.reason ? ` (${action.reason})` : ""}`
  );
  const forbiddenLines = result.safety.forbiddenActionsChecked.map(
    (action) => `- ${action}`
  );

  return [
    "# WeChat Draft Dry-Run Report",
    "",
    "## 1. 草稿箱写入 dry-run 结论",
    "",
    "已完成 mock 草稿写入。该步骤只生成本地 dry-run 结果，不接入真实微信公众号后台。",
    "",
    "## 2. 文章标题",
    "",
    result.title,
    "",
    "## 3. HTML 路径",
    "",
    result.htmlPath,
    "",
    "## 4. 封面图路径",
    "",
    result.coverImagePath,
    "",
    "## 5. mock draftId",
    "",
    result.draftId,
    "",
    "## 6. mock previewUrl",
    "",
    result.previewUrl,
    "",
    "## 7. 已模拟的安全动作",
    "",
    ...actionLines,
    "",
    "## 8. 被禁止的动作列表",
    "",
    ...forbiddenLines,
    "",
    "## 9. 是否需要人工确认",
    "",
    result.safety.requiresHumanConfirmation ? "是，需要人工确认。" : "否",
    "",
    result.humanActionRequired,
    "",
    "## 10. 发布边界",
    "",
    "系统不会自动发布，也不会自动群发。",
    "未操作真实公众号后台，未真实保存草稿，未发布，未群发。",
    ""
  ].join("\n");
}

export async function saveWechatDraftWithReport(
  options: SaveWechatDraftOptions = {}
): Promise<WechatDraftPipelineResult> {
  const logger = options.logger ?? createLogger("wechat-draft-dry-run");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const files = createOutputFiles(outputDir);
  const articleFile = options.articleFile ?? join(outputDir, "article.md");
  const articleMetaFile = options.articleMetaFile ?? join(outputDir, "article-meta.json");
  const articleReviewFile =
    options.articleReviewFile ?? join(outputDir, "article-review.json");
  const coverFile = options.coverFile ?? join(outputDir, "cover.json");
  const coverReviewFile =
    options.coverReviewFile ?? join(outputDir, "cover-review.json");
  const wechatHtmlFile = options.wechatHtmlFile ?? join(outputDir, "wechat.html");
  const wechatLayoutFile =
    options.wechatLayoutFile ?? join(outputDir, "wechat-layout.json");
  const writeOutputs = options.writeOutputs ?? true;
  const generatedAt = (options.now ?? new Date()).toISOString();

  await (options.articleMarkdown === undefined
    ? readFile(articleFile, "utf8")
    : Promise.resolve(options.articleMarkdown));
  const articleMeta =
    options.articleMeta ?? (await readJsonFile<ArticleMeta>(articleMetaFile));
  const articleReview =
    options.articleReview ?? (await readJsonFile<ArticleReviewResult>(articleReviewFile));
  const cover = options.cover ?? (await readJsonFile<CoverResult>(coverFile));
  const coverReview =
    options.coverReview ?? (await readJsonFile<CoverReviewResult>(coverReviewFile));
  const html =
    options.wechatHtml ?? (await readFile(wechatHtmlFile, "utf8"));
  const wechatLayout =
    options.wechatLayout ?? (await readJsonFile<WechatLayoutResult>(wechatLayoutFile));

  const actions: WechatDraftAction[] = [];

  actions.push(createPassedAction("检查文章审核结果"));
  assertArticleReviewPassed(articleReview);

  actions.push(createPassedAction("检查封面审核结果"));
  assertCoverReviewPassed(coverReview);

  actions.push(createPassedAction("检查 HTML 排版结果"));
  assertWechatLayoutAllowed(wechatLayout);
  assertHtmlAvailable(html);
  assertCoverPathAvailable(cover);
  await access(wechatHtmlFile);
  await access(resolveArtifactPath(cover.imagePath, outputDir));

  actions.push(createPassedAction("创建草稿"));

  actions.push(createPassedAction("填写标题"));
  assertTitleAvailable(articleMeta);

  actions.push(createPassedAction("填写正文 HTML"));
  assertHtmlAvailable(html);

  actions.push(createPassedAction("上传封面图"));
  assertCoverPathAvailable(cover);

  actions.push(createPassedAction("保存草稿"));

  const draftId = createMockDraftId(generatedAt);
  const previewUrl = createMockPreviewUrl(draftId);

  actions.push(createPassedAction("生成预览"));
  actions.push(createPassedAction("等待人工确认"));

  const result: WechatDraftResult = {
    mode: "mock",
    status: "draft_saved",
    title: articleMeta.title,
    draftId,
    previewUrl,
    htmlPath: "outputs/wechat.html",
    coverImagePath: cover.imagePath,
    actions,
    safety: {
      autoPublishBlocked: true,
      onlyDraftSaved: true,
      requiresHumanConfirmation: true,
      forbiddenActionsChecked: [...FORBIDDEN_AUTO_PUBLISH_TERMS]
    },
    allowedNextStage: false,
    humanActionRequired,
    generatedAt
  };
  const report = createDraftReport(result);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.wechatDraftResult, result);
    await writeFile(files.wechatDraftReport, report, "utf8");
  }

  logger.info(
    `Mock WeChat draft saved; draftId=${result.draftId}; humanConfirmationRequired=yes.`
  );

  return {
    outputDir,
    files,
    result,
    report
  };
}

export async function saveWechatDraft(
  options: SaveWechatDraftOptions = {}
): Promise<WechatDraftPipelineResult> {
  return saveWechatDraftWithReport(options);
}
