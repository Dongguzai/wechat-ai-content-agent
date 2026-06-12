import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { generateApimartImage } from "../../../src/adapters/apimart";
import { executeDashboardAction } from "./actions";
import {
  getRepoRoot,
  isInside,
  pathExists,
  readJsonFile,
  readTextFile,
  relativePathFromMaybeAbsolute,
  resolveSafeReadPath,
  toPosixPath,
  writeJsonRelative,
  type DashboardFsOptions
} from "./paths";
import { redactJson, redactSecrets } from "./redaction";

type JsonObject = Record<string, any>;

export interface SaveArticleInput {
  title: string;
  content: string;
}

export interface RewriteArticleInput {
  content: string;
  instruction: string;
}

export interface CoverCropInput {
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CoverRegenerateOptions extends DashboardFsOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
}

interface CoverHistoryItem {
  imagePath: string;
  provider: string;
  mode: string;
  instruction: string;
  createdAt: string;
  isCurrent: boolean;
}

interface CoverHistoryFile {
  items: CoverHistoryItem[];
  updatedAt?: string;
}

const blockedWechatTerms = [
  "publish",
  "freepublish",
  "mass",
  "sendall",
  "群发",
  "发布",
  "确认发送",
  "立即发送"
];
const WECHAT_COVER_WIDTH = 900;
const WECHAT_COVER_HEIGHT = 383;

export async function selectBriefTopic(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ path: string; approval: JsonObject; redirectTo: "/article" }> {
  const topicId = stringField(input, "topicId").trim();
  if (!topicId) {
    throw new Error("topicId is required.");
  }

  // 优先信任 client 提交的 topic（cloud flow 来自 Neon 真实数据，id 是 UUID）。
  // outputs/editorial-brief.json 是旧 pipeline 的孤儿数据，id 是 rss-... 字符串，
  // cloud flow 不再依赖它。
  const submittedTopic = submittedTopicFromInput(input, topicId);
  const topic = submittedTopic ?? (await findLegacyLocalTopic(input, topicId, options));

  if (!topic) {
    throw new Error(
      "topicId was not found in submitted topic or outputs/editorial-brief.json shortlistedItems."
    );
  }
  if (!stringValue(topic.url)) {
    throw new Error("Topics without an original URL cannot be selected.");
  }

  const approval = {
    approvedByUser: true,
    approvedTopicId: topicId,
    approvedTitle: stringValue(topic.titleZh) || stringValue(topic.title),
    notes: ""
  };
  const writtenPath = await writeJsonRelative("inputs/editorial-approval.json", approval, options);
  if (submittedTopic && isCloudBriefSelection(input)) {
    await writeCloudArticleHandoff(input, submittedTopic, options);
  }
  return { path: writtenPath, approval, redirectTo: "/article" };
}

async function findLegacyLocalTopic(
  input: unknown,
  topicId: string,
  options: DashboardFsOptions
): Promise<JsonObject | undefined> {
  // client 已经提交了 topic 就不读 local file，避免 cloud UUID 误判
  if (isRecord(input) && isRecord(input.topic)) {
    return undefined;
  }
  try {
    const brief = await readJsonFile<JsonObject>("outputs/editorial-brief.json", options);
    const items = shortlistedFromBrief(brief);
    return items.find((item) => String(item.id ?? "") === topicId);
  } catch {
    return undefined;
  }
}

export async function saveArticleDraft(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ articlePath: string; metaPath: string; meta: JsonObject; markdown: string }> {
  const title = stringField(input, "title").trim();
  const content = stringField(input, "content");

  if (!title) {
    throw new Error("title is required.");
  }

  assertNoBlockedTerms(title, await forbiddenTitleTerms(options));

  const markdown = composeArticleMarkdown(title, content);
  const root = getRepoRoot(options);
  const outputsDir = path.join(root, "outputs");
  await mkdir(outputsDir, { recursive: true });

  const currentMeta = (await readJsonFile<JsonObject>("outputs/article-meta.json", options)) ?? {};
  const updatedAt = new Date().toISOString();
  const meta = {
    ...currentMeta,
    title,
    wordCount: countReadableUnits(markdown),
    updatedAt
  };

  await writeFile(path.join(outputsDir, "article.md"), markdown, "utf8");
  const metaPath = await writeJsonRelative("outputs/article-meta.json", meta, options);

  return {
    articlePath: "outputs/article.md",
    metaPath,
    meta: redactJson(meta) as JsonObject,
    markdown
  };
}

export async function selectArticleTitle(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ title: string; meta: JsonObject }> {
  const title = stringField(input, "title").trim();
  if (!title) {
    throw new Error("title is required.");
  }

  const titles = await readJsonFile<JsonObject>("outputs/title-candidates.json", options);
  const candidates = Array.isArray(titles?.candidates) ? titles.candidates : [];
  const candidate = candidates.find((item) => stringValue(item.title) === title);
  if (!candidate) {
    throw new Error("Selected title must come from outputs/title-candidates.json.");
  }
  if (Array.isArray(candidate.violations) && candidate.violations.length > 0) {
    throw new Error("Selected title has title safety violations.");
  }

  assertNoBlockedTerms(title, await forbiddenTitleTerms(options));

  const currentMeta = (await readJsonFile<JsonObject>("outputs/article-meta.json", options)) ?? {};
  const meta = {
    ...currentMeta,
    title,
    updatedAt: new Date().toISOString()
  };
  await writeJsonRelative("outputs/article-meta.json", meta, options);

  const currentMarkdown = await readTextFile("outputs/article.md", options);
  if (currentMarkdown !== undefined) {
    const root = getRepoRoot(options);
    await mkdir(path.join(root, "outputs"), { recursive: true });
    await writeFile(
      path.join(root, "outputs", "article.md"),
      replaceMarkdownTitle(currentMarkdown, title),
      "utf8"
    );
  }

  return { title, meta: redactJson(meta) as JsonObject };
}

export async function rewriteArticleWithLlm(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ rewrittenArticle: string; llm: JsonObject; action: JsonObject }> {
  const content = stringField(input, "content");
  const instruction = stringField(input, "instruction").trim();

  if (!content.trim()) {
    throw new Error("content is required.");
  }
  if (!instruction) {
    throw new Error("instruction is required.");
  }

  await writeJsonRelative(
    "outputs/article-rewrite-request.json",
    {
      content,
      instruction,
      requestedAt: new Date().toISOString()
    },
    options
  );
  const action = await executeDashboardAction("rewriteArticle", options);
  const result = await readJsonFile<JsonObject>("outputs/article-rewrite-result.json", options);
  if (!result?.rewrittenArticle) {
    throw new Error(action.message || "Article rewrite did not produce a result.");
  }
  return {
    rewrittenArticle: stringValue(result.rewrittenArticle),
    llm: redactJson(result.llm ?? {}) as JsonObject,
    action: redactJson(action) as JsonObject
  };
}

export async function confirmArticleAndReview(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ next?: "/preview"; articleReview?: JsonObject; action: JsonObject }> {
  await saveArticleDraft(input, options);

  const action = await executeDashboardAction("refreshLayout", options);
  const articleReview = await readJsonFile<JsonObject>("outputs/article-review.json", options);

  return {
    next: articleReview?.passed === true ? "/preview" : undefined,
    articleReview: redactJson(articleReview ?? {}) as JsonObject,
    action: redactJson(action) as JsonObject
  };
}

export async function regenerateCover(
  input: unknown,
  options: CoverRegenerateOptions = {}
): Promise<{
  imagePath: string;
  coverJsonPath: "outputs/cover.json";
  historyCount: number;
  message: "cover regenerated";
  cover: JsonObject;
}> {
  const startedAt = new Date().toISOString();
  const root = getRepoRoot(options);
  let logImagePath = "";

  try {
    const now = options.now ?? new Date();
    const finishedAt = now.toISOString();
    const instruction = stringField(input, "instruction").trim();
    const effectiveInstruction = instruction || "根据当前文章重新生成封面";
    const [articleMeta, articleMarkdown, currentCover] = await Promise.all([
      readJsonFile<JsonObject>("outputs/article-meta.json", options),
      readTextFile("outputs/article.md", options),
      readJsonFile<JsonObject>("outputs/cover.json", options)
    ]);

    if (!articleMeta) {
      throw new Error("outputs/article-meta.json is required before regenerating cover.");
    }
    if (!articleMarkdown) {
      throw new Error("outputs/article.md is required before regenerating cover.");
    }
    if (!currentCover?.imagePath) {
      throw new Error("outputs/cover.json with imagePath is required before regenerating cover.");
    }

    const env = await resolveCoverEnv(options);
    const provider = stringValue(currentCover.provider) || env.COVER_IMAGE_PROVIDER || "apimart";
    const coverText = stringValue(currentCover.coverText) || stringValue(articleMeta.title) || "AI 内容观察";
    const previousImagePath =
      relativePathFromMaybeAbsolute(String(currentCover.imagePath), options) ??
      stringValue(currentCover.imagePath);
    const imagePrompt = buildRegeneratedCoverPrompt({
      articleTitle: stringValue(articleMeta.title) || extractMarkdownTitle(articleMarkdown),
      coreViewpoint: stringValue(articleMeta.articleThesis) || summarizeArticle(articleMarkdown),
      currentCoverPrompt: stringValue(currentCover.imagePrompt),
      coverStyle: sanitizeCoverStyle(env.APIMART_COVER_STYLE?.trim() || stringValue(currentCover.coverStyle)),
      instruction: effectiveInstruction
    });
    const negativePrompt = buildRegeneratedNegativePrompt(stringValue(currentCover.negativePrompt));

    const image = await generateApimartImage({
      provider,
      imagePrompt,
      negativePrompt,
      coverText,
      imageSize: "900x383",
      outputDir: path.join(root, "outputs", "covers"),
      fileNamePrefix: "cover-apimart-regenerated",
      env,
      now,
      fetchImpl: options.fetchImpl
    });
    const imagePath = toPosixPath(path.relative(root, image.imagePath));
    logImagePath = imagePath;

    const nextCover: JsonObject = {
      ...currentCover,
      provider: image.provider,
      mode: image.mode,
      title: stringValue(articleMeta.title) || stringValue(currentCover.title),
      coverText,
      imagePrompt,
      negativePrompt,
      imageSize: "900x383",
      imagePath,
      visualRequirements: coverVisualRequirements(),
      regenerateInstruction: instruction,
      appliedRegenerateInstruction: effectiveInstruction,
      previousImagePath,
      updatedAt: finishedAt
    };
    const review = reviewRegeneratedCover({
      mode: image.mode,
      imagePath,
      imagePathAvailable: await pathExists(image.imagePath),
      imagePrompt,
      negativePrompt,
      coverText,
      realApiEnabled: env.COVER_ENABLE_REAL_API?.trim().toLowerCase() === "true",
      generatedAt: finishedAt
    });
    nextCover.review = {
      passed: review.passed,
      issues: review.issues,
      riskNotes: review.riskNotes
    };

    try {
      await writeJsonRelative("outputs/cover.json", nextCover, options);
      await writeJsonRelative("outputs/cover-review.json", review, options);
    } catch (error) {
      throw new Error(`cover.json 更新失败：文件写入失败。${errorSummary(error)}`);
    }

    const history = await appendCoverHistoryItem(
      {
        imagePath,
        provider: image.provider,
        mode: image.mode,
        instruction: effectiveInstruction,
        createdAt: finishedAt,
        isCurrent: true
      },
      currentCover,
      previousImagePath,
      options
    );

    await appendCoverRegenerateLog(root, {
      action: "cover.regenerate",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "success",
      imagePath
    });

    return {
      imagePath,
      coverJsonPath: "outputs/cover.json",
      historyCount: history.items.length,
      message: "cover regenerated",
      cover: redactJson(nextCover) as JsonObject
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const humanError = humanCoverError(error);
    await appendCoverRegenerateLog(root, {
      action: "cover.regenerate",
      startedAt,
      finishedAt,
      status: "failed",
      imagePath: logImagePath,
      error: humanError
    });
    throw new Error(humanError);
  }
}

export async function cropCover(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{
  cover: JsonObject;
  imagePath: string;
  history: CoverHistoryItem[];
  historyCount: number;
  message: "cover cropped";
}> {
  const crop = normalizeCrop(input);
  const cover = await readJsonFile<JsonObject>("outputs/cover.json", options);
  if (!cover?.imagePath) {
    throw new Error("outputs/cover.json imagePath is required before cropping.");
  }

  const root = getRepoRoot(options);
  const relativeImagePath = relativePathFromMaybeAbsolute(String(cover.imagePath), options);
  if (!relativeImagePath || !relativeImagePath.startsWith("outputs/covers/")) {
    throw new Error("Cover imagePath must point to an outputs/covers image.");
  }
  const resolvedImage = resolveSafeReadPath(relativeImagePath, options);
  const coversDir = path.join(root, "outputs", "covers");
  if (!isInside(coversDir, resolvedImage.absolutePath)) {
    throw new Error("Cover imagePath must stay inside outputs/covers.");
  }
  const stats = await stat(resolvedImage.absolutePath).catch(() => undefined);
  if (!stats?.isFile()) {
    throw new Error("Cover imagePath must point to an existing file.");
  }
  if (!/\.(png|jpe?g|webp|svg)$/i.test(resolvedImage.relativePath)) {
    throw new Error("Cover crop only supports image files in outputs/covers.");
  }

  const image = sharp(resolvedImage.absolutePath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cover image dimensions could not be read.");
  }
  const extractArea = cropToExtractArea(crop, metadata.width, metadata.height);
  const now = new Date();
  const updatedAt = now.toISOString();
  const nextRelative = `outputs/covers/cover-cropped-${fileTimestamp(now)}.png`;
  const nextAbsolute = path.join(root, nextRelative);

  await mkdir(path.dirname(nextAbsolute), { recursive: true });
  await sharp(resolvedImage.absolutePath)
    .extract(extractArea)
    .resize(WECHAT_COVER_WIDTH, WECHAT_COVER_HEIGHT, { fit: "fill" })
    .png()
    .toFile(nextAbsolute);

  const nextCover = {
    ...cover,
    imagePath: nextRelative,
    crop,
    cropApplied: true,
    cropSourceImagePath: relativeImagePath,
    updatedAt
  };
  await writeJsonRelative("outputs/cover.json", nextCover, options);
  const history = await appendCoverHistoryItem(
    {
      imagePath: nextRelative,
      provider: stringValue(cover.provider) || "apimart",
      mode: stringValue(cover.mode) || "real",
      instruction: "manual crop",
      createdAt: updatedAt,
      isCurrent: true
    },
    cover,
    relativeImagePath,
    options
  );

  return {
    cover: redactJson(nextCover) as JsonObject,
    imagePath: toPosixPath(path.relative(root, nextAbsolute)),
    history: redactJson(history.items) as CoverHistoryItem[],
    historyCount: history.items.length,
    message: "cover cropped"
  };
}

export async function setCurrentCoverVersion(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ cover: JsonObject; imagePath: string; historyCount: number; message: "cover version set current" }> {
  const imagePath = stringField(input, "imagePath");
  const relative = relativePathFromMaybeAbsolute(imagePath, options);
  if (!relative || !relative.startsWith("outputs/covers/")) {
    throw new Error("imagePath must be an outputs/covers file.");
  }
  const resolved = resolveSafeReadPath(relative, options);
  const stats = await stat(resolved.absolutePath).catch(() => undefined);
  if (!stats?.isFile()) {
    throw new Error("imagePath must point to an existing cover file.");
  }

  const root = getRepoRoot(options);
  const cover = (await readJsonFile<JsonObject>("outputs/cover.json", options)) ?? {};
  const previousImagePath = relativePathFromMaybeAbsolute(String(cover.imagePath ?? ""), options);
  const updatedAt = new Date().toISOString();
  const nextCover = {
    ...cover,
    imagePath: relative,
    previousImagePath,
    updatedAt
  };
  await writeJsonRelative("outputs/cover.json", nextCover, options);
  const history = await setHistoryCurrent(relative, nextCover, options);
  return {
    cover: redactJson(nextCover) as JsonObject,
    imagePath: relative,
    historyCount: history.items.length,
    message: "cover version set current"
  };
}

export async function deleteCoverVersion(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ deleted: string; historyCount: number; message: "cover version deleted" }> {
  const imagePath = stringField(input, "imagePath");
  const relative = relativePathFromMaybeAbsolute(imagePath, options);
  if (!relative || !relative.startsWith("outputs/covers/")) {
    throw new Error("imagePath must be an outputs/covers file.");
  }
  const resolved = resolveSafeReadPath(relative, options);
  const currentCover = await readJsonFile<JsonObject>("outputs/cover.json", options);
  const currentRelative = relativePathFromMaybeAbsolute(String(currentCover?.imagePath ?? ""), options);
  if (currentRelative === relative) {
    throw new Error("The current cover cannot be deleted.");
  }
  await unlink(resolved.absolutePath);
  const history = await removeCoverHistoryItem(relative, options);
  return {
    deleted: relative,
    historyCount: history.items.length,
    message: "cover version deleted"
  };
}

async function resolveCoverEnv(options: CoverRegenerateOptions): Promise<NodeJS.ProcessEnv> {
  const root = getRepoRoot(options);
  const fileEnv = await readRootDotEnv(root);
  return {
    ...process.env,
    ...fileEnv,
    ...options.env
  };
}

async function readRootDotEnv(root: string): Promise<Record<string, string>> {
  const content = await readFile(path.join(root, ".env"), "utf8").catch(() => "");
  const parsed: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = assignment.slice(0, separatorIndex).trim();
    const value = assignment.slice(separatorIndex + 1).trim();
    parsed[key] = value.replace(/^["']|["']$/g, "");
  }

  return parsed;
}

function buildRegeneratedCoverPrompt(input: {
  articleTitle: string;
  coreViewpoint: string;
  currentCoverPrompt: string;
  coverStyle: string;
  instruction: string;
}): string {
  const safeCurrentPrompt = sanitizeCoverPromptText(input.currentCoverPrompt || "当前封面 prompt 未记录。");
  const safeInstruction = sanitizeCoverPromptText(input.instruction);
  const safeCoreViewpoint = sanitizeCoverPromptText(input.coreViewpoint);
  const safeCoverStyle =
    input.coverStyle ||
    "warm friendly 3D animated movie cover, story-driven, clean composition, clear subject";

  return [
    "Prompt:",
    "Create a new horizontal cover image for a Chinese WeChat article.",
    "",
    "Article title:",
    sanitizeCoverPromptText(input.articleTitle),
    "",
    "Core viewpoint:",
    safeCoreViewpoint,
    "",
    "Current cover prompt to preserve useful context:",
    truncateForPrompt(safeCurrentPrompt, 2200),
    "",
    "User regeneration instruction:",
    safeInstruction,
    "",
    "Safe APIMart cover style:",
    sanitizeCoverStyle(safeCoverStyle),
    "",
    "WeChat cover requirements:",
    "Horizontal 900x383px composition. Keep all important text and subject inside safe margins. Use a prominent Chinese main headline, readable in a mobile thumbnail. Build a clear visual center with one strong subject and uncluttered supporting elements.",
    "",
    "Quality:",
    "2K quality, crisp details, clean edges, polished commercial illustration, warm friendly 3D animated movie style, professional technology magazine cover.",
    "",
    "Avoid:",
    "No real brand logos, no official product marks, no official marks for Claude or Goose, no concrete price tags, no zero-cost replacement slogan, no absolute replacement claim, no real people, no clutter, no cheap synthetic look, no specific animation studio imitation."
  ].join("\n");
}

function buildRegeneratedNegativePrompt(currentNegativePrompt: string): string {
  return [
    sanitizeCoverPromptText(currentNegativePrompt),
    "real brand marks",
    "official product marks",
    "official marks for Claude",
    "official marks for Goose",
    "price labels",
    "zero-cost replacement slogan",
    "absolute replacement claim",
    "real human portrait",
    "messy small text",
    "English title replacing Chinese headline",
    "low resolution",
    "blurry text",
    "distorted Chinese characters"
  ]
    .filter(Boolean)
    .join(", ");
}

function sanitizeCoverPromptText(value: string): string {
  return sanitizeCoverStyle(value)
    .replace(/\$200/g, "具体价格")
    .replace(/\b(?:100|200|299|399|999)\s*(?:USD|dollars?|美元|美金|\/month|\/月|元|刀)\b/gi, "具体价格")
    .replace(/Claude\s+Logo/gi, "Claude 官方标识")
    .replace(/Goose\s+Logo/gi, "Goose 官方标识")
    .replace(/免费平替/g, "低成本替换口号")
    .replace(/完全替代/g, "绝对替换")
    .replace(/免费替代高价工具/g, "单点价格对比")
    .replace(/开源免费替代/g, "开源工具链路径")
    .replace(/免费替代/g, "低成本替换");
}

function sanitizeCoverStyle(input: string): string {
  return input
    .replace(/Pixar-inspired/gi, "warm friendly 3D animated movie style")
    .replace(/Pixar/gi, "3D animated movie")
    .replace(/皮克斯/g, "3D 动画电影质感")
    .replace(/Disney/gi, "animated family film")
    .replace(/迪士尼/g, "动画电影质感");
}

function reviewRegeneratedCover(input: {
  mode: string;
  imagePath: string;
  imagePathAvailable: boolean;
  imagePrompt: string;
  negativePrompt: string;
  coverText: string;
  realApiEnabled: boolean;
  generatedAt: string;
}): JsonObject {
  const promptForChecks = [input.imagePrompt, input.negativePrompt, input.coverText].join("\n");
  const checks = {
    providerIsApimart: true,
    coverTextIsChinese: /[\u3400-\u9fff]/.test(input.coverText),
    imageSizeIs900x383: true,
    declares2KQuality: /2K/.test(promptForChecks),
    usesSafeAnimatedMovieStyle: /3D animated movie style|3D animated movie quality|3D 动画电影质感|animated family film|动画电影质感/i.test(promptForChecks),
    mentionsChineseHeadline: /Chinese headline|中文大标题|Chinese main headline/i.test(promptForChecks),
    mentionsSafeMargins: /safe margins|安全边距/i.test(promptForChecks),
    hasVisualCenter: /visual center|central subject|clear subject|视觉中心|中心主体/i.test(promptForChecks),
    doesNotRequestOfficialMarks: !/Claude\s+Logo|Goose\s+Logo|Claude\s*官方\s*Logo|Goose\s*官方\s*Logo/i.test(promptForChecks),
    doesNotIncludeSpecificPrice: !/\$200|\b(?:100|200|299|399|999)\s*(?:USD|dollars?|美元|美金|\/month|\/月|元|刀)\b/i.test(promptForChecks),
    doesNotIncludeFreeSubstituteSlogan: !/免费平替/.test(promptForChecks),
    doesNotIncludeAbsoluteSubstituteClaim: !/完全替代/.test(promptForChecks),
    realApiModeProducesRealCover: input.realApiEnabled ? input.mode === "real" : true,
    realApiModeDoesNotReturnMockSvg: input.realApiEnabled ? input.mode !== "mock" && !/\.svg$/i.test(input.imagePath) : true,
    imagePathAvailable: input.imagePathAvailable
  };
  const issueLabels: Record<string, string> = {
    providerIsApimart: "provider must be apimart.",
    coverTextIsChinese: "coverText must contain Chinese headline text.",
    imageSizeIs900x383: "imageSize must be 900x383.",
    declares2KQuality: "prompt must declare 2K quality.",
    usesSafeAnimatedMovieStyle: "prompt must include a safe animated movie style description.",
    mentionsChineseHeadline: "prompt must mention Chinese headline requirements.",
    mentionsSafeMargins: "prompt must mention safe margins.",
    hasVisualCenter: "prompt must define a clear visual center.",
    doesNotRequestOfficialMarks: "prompt must not request official product marks.",
    doesNotIncludeSpecificPrice: "prompt must not include a concrete price.",
    doesNotIncludeFreeSubstituteSlogan: "prompt must not include a free substitute slogan.",
    doesNotIncludeAbsoluteSubstituteClaim: "prompt must not include an absolute substitute claim.",
    realApiModeProducesRealCover: "COVER_ENABLE_REAL_API=true requires cover.mode=real.",
    realApiModeDoesNotReturnMockSvg: "COVER_ENABLE_REAL_API=true must not return a mock SVG cover.",
    imagePathAvailable: "imagePath must exist."
  };
  const issues = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => issueLabels[key]);

  return {
    provider: "apimart",
    mode: input.mode,
    imageSize: "900x383",
    imagePath: input.imagePath,
    passed: issues.length === 0,
    issues,
    riskNotes: [
      `APIMart is the only allowed image provider; current mode is ${input.mode}.`,
      "The regenerated prompt keeps comparison abstract and avoids official marks, concrete price tags, human portraits, and absolute replacement claims."
    ],
    checks,
    generatedAt: input.generatedAt
  };
}

function truncateForPrompt(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

function coverVisualRequirements() {
  return {
    style: "3D animated movie quality, not specific studio imitation",
    size: "900x383",
    quality: "2K render quality",
    language: "Chinese",
    mainTextRequired: true,
    visualCenterRequired: true
  } as const;
}

function extractMarkdownTitle(markdown: string): string {
  const firstLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.replace(/^#{1,6}\s*/, "").trim() ?? "";
}

function summarizeArticle(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+.*$/m, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function appendCoverHistoryItem(
  item: CoverHistoryItem,
  previousCover: JsonObject,
  previousImagePath: string,
  options: DashboardFsOptions
): Promise<CoverHistoryFile> {
  const history = await readCoverHistory(options);
  const previousItem = previousImagePath
    ? {
        imagePath: previousImagePath,
        provider: stringValue(previousCover.provider) || "apimart",
        mode: stringValue(previousCover.mode) || "real",
        instruction: stringValue(previousCover.regenerateInstruction),
        createdAt: stringValue(previousCover.updatedAt) || stringValue(previousCover.generatedAt) || item.createdAt,
        isCurrent: false
      }
    : undefined;
  const items = history.items
    .map((existing) => ({ ...existing, imagePath: normalizeHistoryImagePath(existing.imagePath, options), isCurrent: false }))
    .filter((existing) => existing.imagePath !== item.imagePath);

  if (previousItem && !items.some((existing) => existing.imagePath === previousItem.imagePath)) {
    items.push(previousItem);
  }

  const nextHistory = {
    items: [item, ...items].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) {
        return a.isCurrent ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    }),
    updatedAt: item.createdAt
  };
  await writeCoverHistory(nextHistory, options);
  return nextHistory;
}

async function setHistoryCurrent(
  imagePath: string,
  cover: JsonObject,
  options: DashboardFsOptions
): Promise<CoverHistoryFile> {
  const now = new Date().toISOString();
  const history = await readCoverHistory(options);
  let found = false;
  const items = history.items.map((item) => {
    const normalized = normalizeHistoryImagePath(item.imagePath, options);
    const isCurrent = normalized === imagePath;
    if (isCurrent) {
      found = true;
    }
    return {
      ...item,
      imagePath: normalized,
      isCurrent
    };
  });

  if (!found) {
    items.unshift({
      imagePath,
      provider: stringValue(cover.provider) || "apimart",
      mode: stringValue(cover.mode) || "real",
      instruction: stringValue(cover.regenerateInstruction),
      createdAt: now,
      isCurrent: true
    });
  }

  const nextHistory = {
    items: items.sort((a, b) => (a.isCurrent === b.isCurrent ? b.createdAt.localeCompare(a.createdAt) : a.isCurrent ? -1 : 1)),
    updatedAt: now
  };
  await writeCoverHistory(nextHistory, options);
  return nextHistory;
}

async function removeCoverHistoryItem(
  imagePath: string,
  options: DashboardFsOptions
): Promise<CoverHistoryFile> {
  const now = new Date().toISOString();
  const history = await readCoverHistory(options);
  const nextHistory = {
    items: history.items
      .map((item) => ({ ...item, imagePath: normalizeHistoryImagePath(item.imagePath, options) }))
      .filter((item) => item.imagePath !== imagePath),
    updatedAt: now
  };
  await writeCoverHistory(nextHistory, options);
  return nextHistory;
}

async function readCoverHistory(options: DashboardFsOptions): Promise<CoverHistoryFile> {
  const history = await readJsonFile<CoverHistoryFile>("outputs/cover-history.json", options);
  const items = Array.isArray(history?.items)
    ? history.items
        .filter((item) => item && typeof item.imagePath === "string")
        .map((item) => ({
          imagePath: normalizeHistoryImagePath(item.imagePath, options),
          provider: stringValue(item.provider) || "apimart",
          mode: stringValue(item.mode) || "real",
          instruction: stringValue(item.instruction),
          createdAt: stringValue(item.createdAt) || new Date(0).toISOString(),
          isCurrent: Boolean(item.isCurrent)
        }))
    : [];

  return {
    items,
    updatedAt: history?.updatedAt
  };
}

async function writeCoverHistory(
  history: CoverHistoryFile,
  options: DashboardFsOptions
): Promise<void> {
  try {
    await writeJsonRelative("outputs/cover-history.json", history, options);
  } catch (error) {
    throw new Error(`cover-history.json 更新失败：文件写入失败。${errorSummary(error)}`);
  }
}

function normalizeHistoryImagePath(imagePath: string, options: DashboardFsOptions): string {
  return relativePathFromMaybeAbsolute(imagePath, options) ?? imagePath;
}

async function appendCoverRegenerateLog(root: string, entry: JsonObject): Promise<void> {
  const logDir = path.join(root, "logs");
  await mkdir(logDir, { recursive: true });
  await appendFile(
    path.join(logDir, "dashboard-actions.log"),
    `${JSON.stringify(redactJson(entry))}\n`,
    "utf8"
  );
}

function humanCoverError(error: unknown): string {
  const message = errorSummary(error);

  if (/APIMART_API_KEY/.test(message)) {
    return "请先配置 APIMART_API_KEY";
  }
  if (/requires APIMART_IMAGE_API_URL/.test(message)) {
    return "请先配置 APIMART_IMAGE_API_URL";
  }
  if (/APIMART_IMAGE_API_URL/.test(message) && /valid http/i.test(message)) {
    return "APIMART_IMAGE_API_URL 配置无效，请配置有效的 http(s) 地址";
  }
  if (/APIMart image API request failed with HTTP\s+\d+/i.test(message)) {
    return message.replace(/^APIMart image API request failed/i, "APIMart 请求失败").slice(0, 500);
  }
  if (/APIMart image task query failed with HTTP\s+\d+/i.test(message)) {
    return message.replace(/^APIMart image task query failed/i, "APIMart 任务查询失败").slice(0, 500);
  }
  if (/EACCES|ENOENT|ENOSPC|EPERM/i.test(message) && /\.(png|jpe?g|svg|webp)/i.test(message)) {
    return `图片保存失败：${message}`;
  }

  return message || "封面生成失败。";
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return redactSecrets(message).replace(/\s+/g, " ").trim();
}

export async function createCurrentFeedback(
  options: DashboardFsOptions = {}
): Promise<{ path: string; feedback: JsonObject }> {
  const [articleMeta, selectedTopic, apiDraft] = await Promise.all([
    readJsonFile<JsonObject>("outputs/article-meta.json", options),
    readJsonFile<JsonObject>("outputs/selected-topic.json", options),
    readJsonFile<JsonObject>("outputs/wechat-api-draft-result.json", options)
  ]);
  const date = new Date().toISOString().slice(0, 10);
  const title = stringValue(articleMeta?.title);
  const topic = stringValue(selectedTopic?.selected?.title ?? selectedTopic?.title);
  const draftMediaId = stringValue(apiDraft?.media_id ?? apiDraft?.mediaId ?? "");
  const feedback = {
    date,
    title,
    topic,
    draftMediaId,
    published: false,
    views: 0,
    likes: 0,
    shares: 0,
    myRating: 0,
    topicQuality: 0,
    titleQuality: 0,
    coverQuality: 0,
    articleProblems: [],
    notes: ""
  };

  const fileName = await uniqueFeedbackFileName(date, title, options);
  const writtenPath = await writeJsonRelative(`feedback/${fileName}`, feedback, options);

  return {
    path: writtenPath,
    feedback
  };
}

function shortlistedFromBrief(brief: JsonObject | undefined): JsonObject[] {
  if (Array.isArray(brief?.shortlistedItems)) {
    return brief.shortlistedItems;
  }
  if (Array.isArray(brief?.shortlisted)) {
    return brief.shortlisted;
  }
  return [];
}

function submittedTopicFromInput(input: unknown, topicId: string): JsonObject | undefined {
  const inputRecord = isRecord(input) ? input : {};
  const topic = inputRecord.topic;

  if (!isRecord(topic) || stringValue(topic.id) !== topicId) {
    return undefined;
  }

  const title = stringValue(topic.titleZh) || stringValue(topic.title);
  const url = stringValue(topic.url);

  if (!title && !url) {
    return undefined;
  }

  return topicSnapshotFromRecord(topic, topicId);
}

function isCloudBriefSelection(input: unknown): boolean {
  const record = isRecord(input) ? input : {};
  return stringValue(record.source) === "cloud-brief";
}

function topicSnapshotsFromInput(input: unknown, selectedTopic: JsonObject): JsonObject[] {
  const record = isRecord(input) ? input : {};
  const rawItems = Array.isArray(record.shortlistedItems) ? record.shortlistedItems : [];
  const snapshots = rawItems
    .map((item) => (isRecord(item) ? topicSnapshotFromRecord(item, stringValue(item.id)) : undefined))
    .filter((item): item is JsonObject => Boolean(item?.id && item.url));
  const hasSelected = snapshots.some((item) => item.id === selectedTopic.id);
  const items = hasSelected ? snapshots : [selectedTopic, ...snapshots];

  return items
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 10);
}

async function writeCloudArticleHandoff(
  input: unknown,
  selectedTopic: JsonObject,
  options: DashboardFsOptions
): Promise<void> {
  const now = new Date().toISOString();
  const snapshots = topicSnapshotsFromInput(input, selectedTopic);
  const candidates = snapshots.map((item) => candidateFromSnapshot(item, now));
  const shortlisted = snapshots.map((item, index) => shortlistedFromSnapshot(item, index, now));
  const selected =
    shortlisted.find((item) => item.id === selectedTopic.id) ?? shortlistedFromSnapshot(selectedTopic, 0, now);
  const selectedTopicOutput = selectedTopicFromShortlisted(selected, shortlisted, now);
  const editorialBrief = editorialBriefFromSnapshots({
    selected,
    shortlisted,
    snapshots,
    now
  });

  await Promise.all([
    writeJsonRelative("outputs/candidate-news.json", candidates, options),
    writeJsonRelative("outputs/shortlisted-news.json", shortlisted, options),
    writeJsonRelative("outputs/selected-topic.json", selectedTopicOutput, options),
    writeJsonRelative("outputs/editorial-brief.json", editorialBrief, options)
  ]);
}

function topicSnapshotFromRecord(topic: JsonObject, fallbackId: string): JsonObject {
  const title = stringValue(topic.titleZh) || stringValue(topic.title);
  const url = stringValue(topic.url);
  const summary = stringValue(topic.summaryZh) || stringValue(topic.summary) || title;
  const topicAngle =
    stringValue(topic.topicAngleZh) ||
    stringValue(topic.topicAngle) ||
    "从第三视角分析这条 AI 资讯背后的工作流变化、事实边界和影响人群。";
  const shortlistReason =
    stringValue(topic.shortlistReasonZh) ||
    stringValue(topic.shortlistReason) ||
    "该资讯来自今日云端简报，已由编辑在 Dashboard 中人工选择。";
  const riskNotes = stringArray(topic.riskNotesZh).length
    ? stringArray(topic.riskNotesZh)
    : stringArray(topic.riskNotes);

  return {
    id: fallbackId || stringValue(topic.id),
    rank: numberValue(topic.rank, 1),
    title: stringValue(topic.title) || title,
    titleZh: title,
    rawTitle: stringValue(topic.rawTitle) || stringValue(topic.title) || title,
    url,
    sourceName: stringValue(topic.sourceName) || hostFromUrl(url) || "unknown",
    sourceType: normalizedSourceType(topic.sourceType),
    provider: normalizedProvider(topic.provider),
    query: stringValue(topic.query),
    category: normalizedCategory(topic.category),
    tags: normalizedTags(topic.tags),
    summary,
    rawSummary: stringValue(topic.rawSummary) || stringValue(topic.summary) || summary,
    summaryZh: summary,
    topicAngle,
    topicAngleZh: topicAngle,
    shortlistReason,
    shortlistReasonZh: shortlistReason,
    shortlistScore: numberValue(topic.shortlistScore, 80),
    riskNotes: riskNotes.length ? riskNotes : ["需要回到原文核验事实边界。"],
    riskNotesZh: riskNotes.length ? riskNotes : ["需要回到原文核验事实边界。"],
    sourceLanguage:
      topic.sourceLanguage === "zh" || topic.sourceLanguage === "en" || topic.sourceLanguage === "unknown"
        ? topic.sourceLanguage
        : "unknown",
    localized: typeof topic.localized === "boolean" ? topic.localized : true
  };
}

function candidateFromSnapshot(item: JsonObject, now: string): JsonObject {
  return {
    id: stringValue(item.id),
    dataMode: "real",
    title: stringValue(item.titleZh) || stringValue(item.title),
    rawTitle: stringValue(item.rawTitle),
    titleZh: stringValue(item.titleZh) || stringValue(item.title),
    url: stringValue(item.url),
    sourceName: stringValue(item.sourceName),
    sourceType: stringValue(item.sourceType),
    provider: stringValue(item.provider),
    query: stringValue(item.query),
    fetchedAt: now,
    summary: stringValue(item.summaryZh) || stringValue(item.summary),
    rawSummary: stringValue(item.rawSummary),
    summaryZh: stringValue(item.summaryZh) || stringValue(item.summary),
    sourceLanguage: item.sourceLanguage,
    topicAngleZh: stringValue(item.topicAngleZh) || stringValue(item.topicAngle),
    shortlistReasonZh: stringValue(item.shortlistReasonZh) || stringValue(item.shortlistReason),
    riskNotesZh: stringArray(item.riskNotesZh).length ? stringArray(item.riskNotesZh) : stringArray(item.riskNotes),
    localized: item.localized,
    localizationStatus: "localized",
    category: stringValue(item.category),
    evidence: [`cloud-brief: ${stringValue(item.id)}`, `url: ${stringValue(item.url)}`],
    duplicateKey: `cloud:${stringValue(item.url)}`,
    scores: scoresFromSnapshot(item),
    duplicateSources: [],
    tags: stringArray(item.tags)
  };
}

function shortlistedFromSnapshot(item: JsonObject, index: number, now: string): JsonObject {
  const candidate = candidateFromSnapshot(item, now);
  const shortlistScore = numberValue(item.shortlistScore, 80);
  const sourceCredibility = stringValue(item.sourceType) === "global_search" ? 78 : 86;

  return {
    ...candidate,
    tags: stringArray(item.tags),
    shortlistScore,
    shortlistMetrics: {
      technicalValue: 82,
      wechatTopic: shortlistScore,
      businessImpact: 78,
      controversy: 35,
      sourceCredibility,
      explainability: 84,
      originality: 82
    },
    editorial: {
      shortlistReason: stringValue(item.shortlistReasonZh) || stringValue(item.shortlistReason),
      audienceFit: "AI 从业者、开发者、产品经理和关注 AI 工具变化的普通读者。",
      topicAngle: stringValue(item.topicAngleZh) || stringValue(item.topicAngle),
      riskNote: stringArray(item.riskNotesZh).concat(stringArray(item.riskNotes)).filter(Boolean)[0],
      recommendedUse: index === 0 ? "main_topic_candidate" : "secondary_topic"
    }
  };
}

function selectedTopicFromShortlisted(
  selected: JsonObject,
  shortlisted: JsonObject[],
  now: string
): JsonObject {
  const title = stringValue(selected.titleZh) || stringValue(selected.title);
  const topicAngle = stringValue(selected.topicAngleZh) || stringValue(selected.topicAngle) || selected.editorial?.topicAngle;
  const shortlistReason =
    stringValue(selected.shortlistReasonZh) ||
    stringValue(selected.shortlistReason) ||
    stringValue(selected.editorial?.shortlistReason);
  const riskNotes = stringArray(selected.riskNotesZh).length
    ? stringArray(selected.riskNotesZh)
    : stringArray(selected.riskNotes);

  return {
    selected: {
      ...selected,
      selection: {
        selectedReason: `用户在云端简报中选择了「${title}」。${shortlistReason}`,
        whyMostWorthWriting: shortlistReason,
        coreConflict: topicAngle,
        publicInterest: stringValue(selected.summaryZh) || stringValue(selected.summary),
        technicalSignificance: topicAngle,
        businessImpact: topicAngle,
        predictedImpact: "需要在 fact pack 与正文阶段继续核验具体影响范围。",
        writingAngle: topicAngle,
        suggestedTitles: [title].filter(Boolean),
        articleThesis: topicAngle,
        riskNotes: riskNotes.length ? riskNotes : ["需要回到原文核验事实边界。"],
        sourceReliability: stringValue(selected.sourceType) === "global_search" ? "medium" : "high",
        decisionScore: numberValue(selected.shortlistScore, 80)
      }
    },
    runnersUp: shortlisted
      .filter((item) => item.id !== selected.id)
      .slice(0, 2)
      .map((item) => ({
        title: stringValue(item.titleZh) || stringValue(item.title),
        url: stringValue(item.url),
        reason: "该资讯来自同一份云端简报，可作为备选。",
        whyNotSelected: "本次用户选择了另一条入围资讯。"
      })),
    rejected: [],
    generatedAt: now
  };
}

function editorialBriefFromSnapshots(input: {
  selected: JsonObject;
  shortlisted: JsonObject[];
  snapshots: JsonObject[];
  now: string;
}): JsonObject {
  const selectedTitle = stringValue(input.selected.titleZh) || stringValue(input.selected.title);
  const riskNotes = stringArray(input.selected.riskNotesZh).length
    ? stringArray(input.selected.riskNotesZh)
    : stringArray(input.selected.riskNotes);

  return {
    generatedAt: input.now,
    candidateCount: input.snapshots.length,
    shortlistedCount: input.shortlisted.length,
    candidates: input.snapshots.map((item) => ({
      id: stringValue(item.id),
      title: stringValue(item.titleZh) || stringValue(item.title),
      rawTitle: stringValue(item.rawTitle),
      titleZh: stringValue(item.titleZh) || stringValue(item.title),
      sourceName: stringValue(item.sourceName),
      sourceType: stringValue(item.sourceType),
      url: stringValue(item.url),
      score: numberValue(item.shortlistScore, 80),
      summary: stringValue(item.summaryZh) || stringValue(item.summary),
      rawSummary: stringValue(item.rawSummary),
      summaryZh: stringValue(item.summaryZh) || stringValue(item.summary)
    })),
    shortlistedItems: input.snapshots,
    shortlisted: input.snapshots,
    recommendedTopic: {
      id: stringValue(input.selected.id),
      title: selectedTitle,
      rawTitle: stringValue(input.selected.rawTitle),
      titleZh: selectedTitle,
      url: stringValue(input.selected.url),
      reason: stringValue(input.selected.shortlistReasonZh) || stringValue(input.selected.shortlistReason),
      coreConflict: stringValue(input.selected.topicAngleZh) || stringValue(input.selected.topicAngle),
      writingAngle: stringValue(input.selected.topicAngleZh) || stringValue(input.selected.topicAngle),
      articleThesis: stringValue(input.selected.topicAngleZh) || stringValue(input.selected.topicAngle),
      sourceReliability: stringValue(input.selected.sourceType) === "global_search" ? "medium" : "high",
      riskNotes
    },
    runnersUp: input.shortlisted
      .filter((item) => item.id !== input.selected.id)
      .slice(0, 2)
      .map((item) => ({
        id: stringValue(item.id),
        title: stringValue(item.titleZh) || stringValue(item.title),
        url: stringValue(item.url),
        reason: "同一份云端简报中的备选资讯。",
        whyNotSelected: "用户已选择其他主选题。"
      })),
    riskReminder: {
      factRisk: "云端简报已做中文化归一，但写作前仍需回到原文核验。",
      sourceRisk: "global_search 来源尤其需要交叉核验。",
      titleRisk: "标题不得把中文摘要或推断写成新增事实。",
      needsManualCheck: true
    },
    shouldPublishToday: true,
    publishRecommendationReason: "用户已在 Dashboard 中选择该题进入文章生产。",
    approvalRequired: true,
    nextStep: "Read the 10 shortlisted source URLs, then edit inputs/editorial-approval.json."
  };
}

function scoresFromSnapshot(item: JsonObject): JsonObject {
  const finalScore = numberValue(item.shortlistScore, 80);
  return {
    freshness: 82,
    heat: 76,
    technicalValue: 82,
    wechatTopic: finalScore,
    businessImpact: 78,
    controversy: 35,
    final: finalScore
  };
}

function normalizedSourceType(value: unknown): string {
  const sourceType = stringValue(value);
  return sourceType === "rss" || sourceType === "global_search" || sourceType === "manual"
    ? sourceType
    : "global_search";
}

function normalizedProvider(value: unknown): string {
  const provider = stringValue(value);
  return provider === "tavily" || provider === "exa" || provider === "none" ? provider : "none";
}

function normalizedCategory(value: unknown): string {
  const category = stringValue(value);
  return ["model", "product", "research", "policy", "funding", "tooling"].includes(category)
    ? category
    : "tooling";
}

function normalizedTags(value: unknown): string[] {
  const tags = stringArray(value).filter((tag) =>
    [
      "tooling",
      "open-source",
      "agent",
      "developer-workflow",
      "model",
      "product",
      "research",
      "business",
      "community",
      "policy"
    ].includes(tag)
  );

  return tags.length ? tags : ["tooling", "agent", "developer-workflow"];
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function composeArticleMarkdown(title: string, content: string): string {
  const body = removeMarkdownTitle(content).trim();
  return `# ${title}\n\n${body}\n`;
}

export function removeMarkdownTitle(markdown: string | undefined): string {
  const value = markdown ?? "";
  const lines = value.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent === -1) {
    return "";
  }
  if (/^#{1,6}\s+\S/.test(lines[firstContent].trim())) {
    return lines.slice(firstContent + 1).join("\n").trimStart();
  }
  return value;
}

function replaceMarkdownTitle(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent === -1) {
    return `# ${title}\n`;
  }
  if (/^#{1,6}\s+\S/.test(lines[firstContent].trim())) {
    lines[firstContent] = `# ${title}`;
    return lines.join("\n");
  }
  return `# ${title}\n\n${markdown}`;
}

function countReadableUnits(markdown: string): number {
  return [...markdown.replace(/\s+/g, "")].length;
}

async function forbiddenTitleTerms(options: DashboardFsOptions): Promise<string[]> {
  const titles = await readJsonFile<JsonObject>("outputs/title-candidates.json", options);
  const terms = Array.isArray(titles?.forbiddenTerms)
    ? titles.forbiddenTerms.map((term) => String(term))
    : [];
  return [...new Set([...terms, ...blockedWechatTerms])];
}

function assertNoBlockedTerms(value: string, terms: string[]): void {
  const lower = value.toLowerCase();
  const matched = terms.find((term) => {
    const normalized = term.toLowerCase();
    return normalized ? lower.includes(normalized) : false;
  });
  if (matched) {
    throw new Error(`Title contains a forbidden term: ${matched}`);
  }
}

function normalizeCrop(input: unknown): CoverCropInput["crop"] {
  const crop = recordField(input, "crop");
  const normalized = {
    x: finiteNumber(crop.x, "crop.x"),
    y: finiteNumber(crop.y, "crop.y"),
    width: finiteNumber(crop.width, "crop.width"),
    height: finiteNumber(crop.height, "crop.height")
  };
  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new Error("crop width and height must be positive.");
  }
  return normalized;
}

function cropToExtractArea(
  crop: CoverCropInput["crop"],
  imageWidth: number,
  imageHeight: number
): sharp.Region {
  const left = Math.max(0, Math.round(crop.x));
  const top = Math.max(0, Math.round(crop.y));
  if (left >= imageWidth || top >= imageHeight) {
    throw new Error("crop area is outside the cover image.");
  }

  const requestedWidth = Math.max(1, Math.round(crop.width));
  const requestedHeight = Math.max(1, Math.round(crop.height));
  const width = Math.min(requestedWidth, imageWidth - left);
  const height = Math.min(requestedHeight, imageHeight - top);
  if (width <= 0 || height <= 0) {
    throw new Error("crop area is outside the cover image.");
  }

  return { left, top, width, height };
}

async function uniqueFeedbackFileName(
  date: string,
  title: string,
  options: DashboardFsOptions
): Promise<string> {
  const slug = slugify(title) || "article";
  let candidate = `${date}-${slug}.json`;
  let suffix = 2;
  while (await pathExists(path.join(getRepoRoot(options), "feedback", candidate))) {
    candidate = `${date}-${slug}-${suffix}.json`;
    suffix += 1;
  }
  return candidate;
}

export async function listCoverVersions(
  options: DashboardFsOptions = {}
): Promise<Array<{ imagePath: string; relativePath: string; updatedAt?: string; source: string }>> {
  const root = getRepoRoot(options);
  const coversDir = path.join(root, "outputs", "covers");
  const entries = await readdir(coversDir).catch(() => []);
  const versions = await Promise.all(
    entries
      .filter((entry) => /\.(png|jpe?g|svg|webp)$/i.test(entry))
      .map(async (entry) => {
        const absolute = path.join(coversDir, entry);
        const stats = await stat(absolute).catch(() => undefined);
        return {
          imagePath: absolute,
          relativePath: toPosixPath(path.relative(root, absolute)),
          updatedAt: stats?.mtime.toISOString(),
          source: entry.includes("real") ? "real" : entry.includes("crop") ? "crop" : "mock"
        };
      })
  );

  return versions
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, 5);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function fileTimestamp(now: Date): string {
  return now.toISOString().replace(/[^0-9A-Za-z]/g, "-");
}

function stringField(input: unknown, key: string): string {
  const record = isRecord(input) ? input : {};
  return stringValue(record[key]);
}

function recordField(input: unknown, key: string): JsonObject {
  const record = isRecord(input) ? input : {};
  const value = record[key];
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
