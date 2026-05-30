import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addWechatDraft,
  getAccessToken,
  uploadCoverMaterial
} from "../adapters/wechatOfficialApi.js";
import {
  FORBIDDEN_WECHAT_PUBLISH_API_TERMS,
  verifyWechatDraftOnlyApiGuard
} from "../hooks/forbidWechatPublishApi.js";
import type { ArticleMeta, ArticleReviewResult } from "../types/article.js";
import type { CoverResult, CoverReviewResult } from "../types/cover.js";
import type { TopicFactPack } from "../types/factPack.js";
import type { WechatLayoutResult } from "../types/layout.js";
import type { SelectedTopic, SourceReliability } from "../types/news.js";
import type {
  WechatApiDraftAddRequest,
  WechatApiDraftOutputFiles,
  WechatApiDraftPipelineResult,
  WechatApiDraftResult,
  WechatApiDraftSafety,
  WechatApiPreflight,
  WechatApiThumbMediaIdSource
} from "../types/wechatApiDraft.js";
import { createLogger, type Logger } from "../utils/logger.js";
import {
  assertWechatDraftRunNotLocked,
  writeWechatDraftRunLock
} from "./wechatDraftRunLock.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SaveWechatDraftApiOptions {
  outputDir?: string;
  articleFile?: string;
  articleMetaFile?: string;
  articleReviewFile?: string;
  coverFile?: string;
  coverReviewFile?: string;
  wechatHtmlFile?: string;
  wechatLayoutFile?: string;
  topicFactPackFile?: string;
  selectedTopicFile?: string;
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  articleReview?: ArticleReviewResult;
  cover?: CoverResult;
  coverReview?: CoverReviewResult;
  wechatHtml?: string;
  wechatLayout?: WechatLayoutResult;
  topicFactPack?: TopicFactPack;
  selectedTopic?: SelectedTopic;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
  force?: boolean;
  lockDir?: string;
}

interface WechatApiRuntimeConfig {
  apiBase: string;
  appId: string;
  appSecret: string;
  author: string;
  contentSourceUrl: string;
  coverMediaId: string;
  coverImagePath: string;
  needOpenComment: 0 | 1;
  onlyFansCanComment: 0 | 1;
  realDraftSwitchEnabled: boolean;
  realApiAllowSwitchEnabled: boolean;
  explicitDryRun: boolean;
  realApiRequested: boolean;
  forbidPublishEnvEnabled: boolean;
  forbidMassSendEnvEnabled: boolean;
}

interface LoadedWechatApiArtifacts {
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  articleReview?: ArticleReviewResult;
  cover?: CoverResult;
  coverReview?: CoverReviewResult;
  wechatHtml?: string;
  wechatLayout?: WechatLayoutResult;
  topicFactPack?: TopicFactPack;
  selectedTopic?: SelectedTopic;
}

interface PreparedDraftArticle {
  request: WechatApiDraftAddRequest;
  title: string;
  contentLength: number;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultOutputDir = join(projectRoot, "outputs");
const draftEndpoint = "/cgi-bin/draft/add" as const;

const safety: WechatApiDraftSafety = {
  draftOnly: true,
  publishApiCalled: false,
  massSendApiCalled: false,
  requiresHumanConfirmation: true
};

function createOutputFiles(outputDir: string): WechatApiDraftOutputFiles {
  return {
    wechatApiDraftResult: join(outputDir, "wechat-api-draft-result.json"),
    wechatApiDraftReport: join(outputDir, "wechat-api-draft-report.md"),
    wechatApiPreflight: join(outputDir, "wechat-api-preflight.json")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path);
  } catch {
    return undefined;
  }
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
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

function resolveArtifactPath(path: string, outputDir: string): string {
  if (isAbsolute(path)) {
    return path;
  }

  if (path.startsWith("outputs/")) {
    return join(projectRoot, path);
  }

  return join(outputDir, path);
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true";
}

function parseCommentFlag(value: string | undefined): 0 | 1 {
  return value === "1" ? 1 : 0;
}

function createRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WechatApiRuntimeConfig {
  const realDraftSwitchEnabled = parseBoolean(env.WECHAT_API_ENABLE_REAL_DRAFT);
  const realApiAllowSwitchEnabled = parseBoolean(env.WECHAT_DRAFT_ALLOW_REAL_API);
  const explicitDryRun = parseBoolean(env.WECHAT_DRAFT_DRY_RUN);
  const realApiRequested =
    realDraftSwitchEnabled && realApiAllowSwitchEnabled && !explicitDryRun;

  return {
    apiBase: env.WECHAT_API_BASE || "https://api.weixin.qq.com",
    appId: env.WECHAT_APP_ID?.trim() ?? "",
    appSecret: env.WECHAT_APP_SECRET?.trim() ?? "",
    author: env.WECHAT_AUTHOR?.trim() ?? "",
    contentSourceUrl: env.WECHAT_CONTENT_SOURCE_URL?.trim() ?? "",
    coverMediaId: env.WECHAT_COVER_MEDIA_ID?.trim() ?? "",
    coverImagePath: env.WECHAT_COVER_IMAGE_PATH?.trim() ?? "",
    needOpenComment: parseCommentFlag(env.WECHAT_NEED_OPEN_COMMENT),
    onlyFansCanComment: parseCommentFlag(env.WECHAT_ONLY_FANS_CAN_COMMENT),
    realDraftSwitchEnabled,
    realApiAllowSwitchEnabled,
    explicitDryRun,
    realApiRequested,
    forbidPublishEnvEnabled: env.WECHAT_FORBID_PUBLISH !== "false",
    forbidMassSendEnvEnabled: env.WECHAT_FORBID_MASS_SEND !== "false"
  };
}

async function loadArtifacts(input: {
  options: SaveWechatDraftApiOptions;
  outputDir: string;
  files: {
    articleFile: string;
    articleMetaFile: string;
    articleReviewFile: string;
    coverFile: string;
    coverReviewFile: string;
    wechatHtmlFile: string;
    wechatLayoutFile: string;
    topicFactPackFile: string;
    selectedTopicFile: string;
  };
}): Promise<LoadedWechatApiArtifacts> {
  const { options, files } = input;

  return {
    articleMarkdown:
      options.articleMarkdown ?? (await readOptionalTextFile(files.articleFile)),
    articleMeta:
      options.articleMeta ??
      (await readOptionalJsonFile<ArticleMeta>(files.articleMetaFile)),
    articleReview:
      options.articleReview ??
      (await readOptionalJsonFile<ArticleReviewResult>(files.articleReviewFile)),
    cover:
      options.cover ?? (await readOptionalJsonFile<CoverResult>(files.coverFile)),
    coverReview:
      options.coverReview ??
      (await readOptionalJsonFile<CoverReviewResult>(files.coverReviewFile)),
    wechatHtml:
      options.wechatHtml ?? (await readOptionalTextFile(files.wechatHtmlFile)),
    wechatLayout:
      options.wechatLayout ??
      (await readOptionalJsonFile<WechatLayoutResult>(files.wechatLayoutFile)),
    topicFactPack:
      options.topicFactPack ??
      (await readOptionalJsonFile<TopicFactPack>(files.topicFactPackFile)),
    selectedTopic:
      options.selectedTopic ??
      (await readOptionalJsonFile<SelectedTopic>(files.selectedTopicFile))
  };
}

function firstMarkdownLine(markdown: string | undefined): string {
  const line =
    markdown
      ?.split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate.length > 0) ?? "";
  return line.replace(/^#+\s*/, "").trim();
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, (match) =>
      match.replace(/^\[/, "").replace(/]\([^)]*\)$/, "")
    )
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createDigest(input: {
  articleMeta?: ArticleMeta;
  wechatLayout?: WechatLayoutResult;
  articleMarkdown?: string;
}): string {
  const metaDigest = (input.articleMeta as (ArticleMeta & { digest?: string }) | undefined)
    ?.digest;
  const raw =
    metaDigest?.trim() ||
    input.wechatLayout?.digest?.trim() ||
    stripMarkdown(input.articleMarkdown ?? "");

  return raw.length > 120 ? raw.slice(0, 120) : raw;
}

function resolveSourceReliability(
  artifacts: LoadedWechatApiArtifacts
): SourceReliability | "unknown" {
  return (
    artifacts.topicFactPack?.sourceReliability ??
    artifacts.selectedTopic?.selected.selection.sourceReliability ??
    "unknown"
  );
}

async function readSmallFilePrefix(path: string): Promise<string> {
  try {
    const content = await readFile(path, "utf8");
    return content.slice(0, 200).trimStart();
  } catch {
    return "";
  }
}

async function detectMockSvg(input: {
  cover?: CoverResult;
  coverImagePath: string;
}): Promise<boolean> {
  if (!input.coverImagePath) {
    return false;
  }

  const extensionIsSvg = extname(input.coverImagePath).toLowerCase() === ".svg";
  const contentLooksSvg = (await readSmallFilePrefix(input.coverImagePath)).startsWith(
    "<svg"
  );

  return extensionIsSvg || contentLooksSvg || (input.cover?.mode === "mock" && extensionIsSvg);
}

function isUploadableCover(path: string, exists: boolean, mockSvg: boolean): boolean {
  return exists && !mockSvg && /\.(jpe?g|png)$/i.test(path);
}

async function createPreflight(input: {
  config: WechatApiRuntimeConfig;
  artifacts: LoadedWechatApiArtifacts;
  outputDir: string;
  coverImagePath: string;
  generatedAt: string;
}): Promise<WechatApiPreflight> {
  const coverImageExists =
    input.coverImagePath.length > 0 && (await fileExists(input.coverImagePath));
  const coverIsMockSvg = await detectMockSvg({
    cover: input.artifacts.cover,
    coverImagePath: input.coverImagePath
  });
  const coverUploadable = isUploadableCover(
    input.coverImagePath,
    coverImageExists,
    coverIsMockSvg
  );
  const sourceReliability = resolveSourceReliability(input.artifacts);
  const sourceReliabilityAllowed = sourceReliability !== "low";
  const forbidWechatPublishApiHookEnabled = verifyWechatDraftOnlyApiGuard();
  const issues: string[] = [];
  const articleReviewPassed = input.artifacts.articleReview?.passed === true;
  const coverReviewPassed = input.artifacts.coverReview?.passed === true;
  const layoutAllowedNextStage =
    input.artifacts.wechatLayout?.allowedNextStage === true;
  const htmlExists = Boolean(input.artifacts.wechatHtml?.trim());
  const coverJsonExists = Boolean(input.artifacts.cover);
  const thumbMediaIdFromEnv = input.config.coverMediaId.length > 0;

  if (!articleReviewPassed) {
    issues.push("article-review.json passed must be true.");
  }

  if (!coverReviewPassed) {
    issues.push("cover-review.json passed must be true.");
  }

  if (!layoutAllowedNextStage) {
    issues.push("wechat-layout.json allowedNextStage must be true.");
  }

  if (!htmlExists) {
    issues.push("outputs/wechat.html is missing or empty.");
  }

  if (!coverJsonExists) {
    issues.push("outputs/cover.json is missing.");
  }

  if (!sourceReliabilityAllowed) {
    issues.push("sourceReliability=low blocks WeChat draft creation.");
  }

  if (!forbidWechatPublishApiHookEnabled) {
    issues.push("forbidWechatPublishApi hook is not fully active.");
  }

  if (!input.config.forbidPublishEnvEnabled) {
    issues.push("WECHAT_FORBID_PUBLISH must not be false.");
  }

  if (!input.config.forbidMassSendEnvEnabled) {
    issues.push("WECHAT_FORBID_MASS_SEND must not be false.");
  }

  if (input.config.realApiRequested) {
    if (!input.config.appId) {
      issues.push("WECHAT_APP_ID is required for real WeChat draft API calls.");
    }

    if (!input.config.appSecret) {
      issues.push("WECHAT_APP_SECRET is required for real WeChat draft API calls.");
    }

    if (!thumbMediaIdFromEnv && coverIsMockSvg) {
      issues.push(
        "Mock SVG cover blocks real WeChat draft creation. Provide a real JPG/PNG cover or WECHAT_COVER_MEDIA_ID."
      );
    }

    if (!thumbMediaIdFromEnv && !coverUploadable) {
      issues.push(
        "A real draft requires WECHAT_COVER_MEDIA_ID or an uploadable local JPG/PNG cover image."
      );
    }
  }

  const draftOnlyGuardEnabled =
    forbidWechatPublishApiHookEnabled &&
    input.config.forbidPublishEnvEnabled &&
    input.config.forbidMassSendEnvEnabled;

  return {
    mode: input.config.realApiRequested ? "real_api" : "api_dry_run",
    realApiRequested: input.config.realApiRequested,
    dryRun: !input.config.realApiRequested,
    realDraftSwitchEnabled: input.config.realDraftSwitchEnabled,
    realApiAllowSwitchEnabled: input.config.realApiAllowSwitchEnabled,
    appIdPresent: input.config.appId.length > 0,
    appSecretPresent: input.config.appSecret.length > 0,
    articleReviewPassed,
    coverReviewPassed,
    layoutAllowedNextStage,
    htmlExists,
    htmlPath: "outputs/wechat.html",
    coverJsonExists,
    coverImagePath: input.coverImagePath
      ? input.coverImagePath.startsWith(input.outputDir)
        ? join("outputs", input.coverImagePath.slice(input.outputDir.length + 1))
        : input.coverImagePath
      : "",
    coverImageExists,
    coverIsMockSvg,
    coverUploadable,
    thumbMediaIdFromEnv,
    sourceReliability,
    sourceReliabilityAllowed,
    forbidAutoPublishHookEnabled: forbidWechatPublishApiHookEnabled,
    forbidWechatPublishApiHookEnabled,
    forbidPublishEnvEnabled: input.config.forbidPublishEnvEnabled,
    forbidMassSendEnvEnabled: input.config.forbidMassSendEnvEnabled,
    draftOnlyGuardEnabled,
    publishApiCalled: false,
    massSendApiCalled: false,
    issues,
    passed: issues.length === 0,
    generatedAt: input.generatedAt
  };
}

function assertPreflightPassed(preflight: WechatApiPreflight): void {
  if (!preflight.passed) {
    throw new Error(`WeChat API draft preflight blocked: ${preflight.issues.join(" ")}`);
  }
}

function assertLoaded<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} is required after preflight.`);
  }

  return value;
}

function prepareDraftArticle(input: {
  config: WechatApiRuntimeConfig;
  artifacts: LoadedWechatApiArtifacts;
  thumbMediaId: string;
}): PreparedDraftArticle {
  const articleMarkdown = assertLoaded(input.artifacts.articleMarkdown, "article.md");
  const html = assertLoaded(input.artifacts.wechatHtml, "wechat.html");
  const title =
    input.artifacts.articleMeta?.title?.trim() ||
    input.artifacts.wechatLayout?.title?.trim() ||
    firstMarkdownLine(articleMarkdown);

  if (!title) {
    throw new Error("Article title is empty; WeChat API draft creation blocked.");
  }

  const digest = createDigest({
    articleMeta: input.artifacts.articleMeta,
    wechatLayout: input.artifacts.wechatLayout,
    articleMarkdown
  });

  return {
    title,
    contentLength: html.length,
    request: {
      articles: [
        {
          title,
          author: input.config.author,
          digest,
          content: html,
          content_source_url: input.config.contentSourceUrl,
          thumb_media_id: input.thumbMediaId,
          need_open_comment: input.config.needOpenComment,
          only_fans_can_comment: input.config.onlyFansCanComment
        }
      ]
    }
  };
}

function createReport(input: {
  preflight: WechatApiPreflight;
  result: WechatApiDraftResult;
}): string {
  const issueLines =
    input.preflight.issues.length > 0
      ? input.preflight.issues.map((issue) => `- ${issue}`)
      : ["- none"];

  const resultLines =
    input.result.mode === "real_api"
      ? [
          `- mode: ${input.result.mode}`,
          `- status: ${input.result.status}`,
          `- title: ${input.result.title}`,
          `- thumbMediaIdSource: ${input.result.thumbMediaIdSource}`,
          `- mediaId: ${input.result.mediaId}`
        ]
      : [
          `- mode: ${input.result.mode}`,
          `- status: ${input.result.status}`,
          `- endpoint: ${input.result.requestPreview.endpoint}`,
          `- title: ${input.result.requestPreview.title}`,
          `- hasContent: ${input.result.requestPreview.hasContent}`,
          `- hasThumbMediaId: ${input.result.requestPreview.hasThumbMediaId}`,
          `- contentLength: ${input.result.requestPreview.contentLength}`
        ];

  return [
    "# WeChat Official API Draft Report",
    "",
    "## 1. 阶段",
    "",
    "第 9C 阶段：微信公众号官方 API 草稿箱写入。",
    "",
    "## 2. 结果",
    "",
    ...resultLines,
    "",
    "## 3. Preflight",
    "",
    `- passed: ${input.preflight.passed}`,
    `- mode: ${input.preflight.mode}`,
    `- articleReviewPassed: ${input.preflight.articleReviewPassed}`,
    `- coverReviewPassed: ${input.preflight.coverReviewPassed}`,
    `- layoutAllowedNextStage: ${input.preflight.layoutAllowedNextStage}`,
    `- htmlExists: ${input.preflight.htmlExists}`,
    `- coverIsMockSvg: ${input.preflight.coverIsMockSvg}`,
    `- coverUploadable: ${input.preflight.coverUploadable}`,
    `- thumbMediaIdFromEnv: ${input.preflight.thumbMediaIdFromEnv}`,
    `- sourceReliability: ${input.preflight.sourceReliability}`,
    "",
    "### issues",
    "",
    ...issueLines,
    "",
    "## 4. 安全边界",
    "",
    "- 只允许创建公众号草稿箱草稿。",
    "- 只允许调用草稿创建接口。",
    "- 不调用发布接口。",
    "- 不调用群发接口。",
    "- 不打开浏览器，不操作公众号后台页面。",
    "- 不写入 AppSecret 或完整调用凭据到 outputs。",
    "- 最终发布必须由人工登录公众号后台确认完成。",
    "",
    "## 5. 已启用 hook",
    "",
    `- forbidWechatPublishApi: ${input.preflight.forbidWechatPublishApiHookEnabled}`,
    `- draftOnlyGuardEnabled: ${input.preflight.draftOnlyGuardEnabled}`,
    `- forbiddenTerms: ${FORBIDDEN_WECHAT_PUBLISH_API_TERMS.join(", ")}`,
    ""
  ].join("\n");
}

export async function saveWechatDraftApiWithReport(
  options: SaveWechatDraftApiOptions = {}
): Promise<WechatApiDraftPipelineResult> {
  const logger = options.logger ?? createLogger("wechat-api-draft");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const outputFiles = createOutputFiles(outputDir);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const config = createRuntimeConfig(options.env);
  const files = {
    articleFile: options.articleFile ?? join(outputDir, "article.md"),
    articleMetaFile: options.articleMetaFile ?? join(outputDir, "article-meta.json"),
    articleReviewFile:
      options.articleReviewFile ?? join(outputDir, "article-review.json"),
    coverFile: options.coverFile ?? join(outputDir, "cover.json"),
    coverReviewFile:
      options.coverReviewFile ?? join(outputDir, "cover-review.json"),
    wechatHtmlFile: options.wechatHtmlFile ?? join(outputDir, "wechat.html"),
    wechatLayoutFile:
      options.wechatLayoutFile ?? join(outputDir, "wechat-layout.json"),
    topicFactPackFile:
      options.topicFactPackFile ?? join(outputDir, "topic-fact-pack.json"),
    selectedTopicFile:
      options.selectedTopicFile ?? join(outputDir, "selected-topic.json")
  };
  const artifacts = await loadArtifacts({ options, outputDir, files });
  const configuredCoverPath =
    config.coverImagePath || artifacts.cover?.imagePath || "";
  const coverImagePath = configuredCoverPath
    ? resolveArtifactPath(configuredCoverPath, outputDir)
    : "";
  const preflight = await createPreflight({
    config,
    artifacts,
    outputDir,
    coverImagePath,
    generatedAt
  });

  if (options.writeOutputs ?? true) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(outputFiles.wechatApiPreflight, preflight);
  }

  assertPreflightPassed(preflight);

  if (!config.realApiRequested) {
    const prepared = prepareDraftArticle({
      config,
      artifacts,
      thumbMediaId: config.coverMediaId
    });
    const result: WechatApiDraftResult = {
      mode: "api_dry_run",
      status: "request_preview_generated",
      requestPreview: {
        endpoint: draftEndpoint,
        title: prepared.title,
        hasContent: true,
        hasThumbMediaId: config.coverMediaId.length > 0,
        contentLength: prepared.contentLength
      },
      safety,
      generatedAt
    };
    const report = createReport({ preflight, result });

    if (options.writeOutputs ?? true) {
      await writeJson(outputFiles.wechatApiDraftResult, result);
      await writeFile(outputFiles.wechatApiDraftReport, report, "utf8");
    }

    logger.info("Generated WeChat official API draft dry-run request preview.");

    return {
      outputDir,
      files: outputFiles,
      preflight,
      result,
      report
    };
  }

  await assertWechatDraftRunNotLocked({
    lockDir: options.lockDir,
    now: options.now,
    force: options.force
  });

  const accessToken = await getAccessToken({
    config: {
      apiBase: config.apiBase,
      appId: config.appId,
      appSecret: config.appSecret
    },
    fetchImpl: options.fetchImpl
  });
  let thumbMediaId = config.coverMediaId;
  let thumbMediaIdSource: WechatApiThumbMediaIdSource = "env";

  if (!thumbMediaId) {
    thumbMediaId = await uploadCoverMaterial({
      apiBase: config.apiBase,
      accessToken,
      imagePath: coverImagePath,
      fetchImpl: options.fetchImpl
    });
    thumbMediaIdSource = "uploaded";
  }

  const prepared = prepareDraftArticle({
    config,
    artifacts,
    thumbMediaId
  });
  const mediaId = await addWechatDraft({
    apiBase: config.apiBase,
    accessToken,
    request: prepared.request,
    fetchImpl: options.fetchImpl
  });
  const result: WechatApiDraftResult = {
    mode: "real_api",
    status: "draft_created",
    mediaId,
    title: prepared.title,
    thumbMediaIdSource,
    htmlPath: "outputs/wechat.html",
    coverImagePath: preflight.coverImagePath,
    safety,
    generatedAt
  };
  const report = createReport({ preflight, result });

  if (options.writeOutputs ?? true) {
    await writeJson(outputFiles.wechatApiDraftResult, result);
    await writeFile(outputFiles.wechatApiDraftReport, report, "utf8");
  }

  await writeWechatDraftRunLock({
    lockDir: options.lockDir,
    now: options.now,
    mediaId,
    title: prepared.title,
    force: options.force
  });

  logger.info("Created WeChat official API draft. Publishing remains manual.");

  return {
    outputDir,
    files: outputFiles,
    preflight,
    result,
    report
  };
}

export async function saveWechatDraftApi(
  options: SaveWechatDraftApiOptions = {}
): Promise<WechatApiDraftPipelineResult> {
  return saveWechatDraftApiWithReport(options);
}
