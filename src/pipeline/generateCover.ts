import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateApimartImage } from "../adapters/apimart.js";
import { forceApimartImage } from "../hooks/forceApimartImage.js";
import type { ArticleMeta, ArticleReviewResult } from "../types/article.js";
import type {
  CoverImageProvider,
  CoverImageSize,
  CoverOutputFiles,
  CoverPipelineResult,
  CoverResult,
  CoverReviewChecks,
  CoverReviewResult,
  CoverReviewSummary,
  CoverVisualRequirements
} from "../types/cover.js";
import type { TopicFactPack } from "../types/factPack.js";
import type { SelectedTopic } from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface GenerateCoverOptions {
  outputDir?: string;
  articleFile?: string;
  articleMetaFile?: string;
  articleReviewFile?: string;
  selectedTopicFile?: string;
  topicFactPackFile?: string;
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  articleReview?: ArticleReviewResult;
  selectedTopic?: SelectedTopic;
  factPack?: TopicFactPack;
  provider?: string;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  writeOutputs?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
}

interface CoverPromptParts {
  articleTitle: string;
  coverText: string;
  coreViewpoint: string;
  coverStyle: string;
  visualConcept: string;
  chineseDesignDescription: string;
  imagePrompt: string;
  negativePrompt: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const requiredImageSize: CoverImageSize = "900x383";
const defaultCoverText = "AI 编码代理\n卷向工作流";
const defaultApimartCoverStyle =
  "warm friendly 3D animated movie cover, story-driven, clean composition, clear subject, horizontal 900x383px, prominent Chinese headline inside safe margins";

function createOutputFiles(outputDir: string, coverImageDir: string): CoverOutputFiles {
  return {
    cover: join(outputDir, "cover.json"),
    coverPrompt: join(outputDir, "cover-prompt.md"),
    coverReview: join(outputDir, "cover-review.json"),
    coverImageDir
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function extractMarkdownTitle(markdown: string): string {
  const firstLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine?.replace(/^#{1,6}\s*/, "").trim() ?? "";
}

function resolveCoverOutputDir(outputDir: string, env: NodeJS.ProcessEnv): string {
  const configured = env.COVER_OUTPUT_DIR?.trim();

  if (!configured) {
    return join(outputDir, "covers");
  }

  if (isAbsolute(configured)) {
    return configured;
  }

  const normalized = configured.replaceAll("\\", "/");
  if (normalized === "outputs/covers") {
    return join(outputDir, "covers");
  }

  if (normalized.startsWith("outputs/")) {
    return join(outputDir, normalized.slice("outputs/".length));
  }

  return join(outputDir, configured);
}

function resolveImageSize(env: NodeJS.ProcessEnv): CoverImageSize {
  const imageSize = env.COVER_IMAGE_SIZE?.trim() || requiredImageSize;

  if (imageSize !== requiredImageSize) {
    throw new Error(`COVER_IMAGE_SIZE must be 900x383; received ${imageSize}.`);
  }

  return requiredImageSize;
}

function resolveApimartCoverStyle(env: NodeJS.ProcessEnv): string {
  return sanitizeCoverStyle(env.APIMART_COVER_STYLE?.trim() || defaultApimartCoverStyle);
}

function createPromptParts(input: {
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  selectedTopic: SelectedTopic;
  factPack: TopicFactPack;
  coverStyle: string;
}): CoverPromptParts {
  const articleTitle =
    input.articleMeta.title ||
    extractMarkdownTitle(input.articleMarkdown) ||
    "AI 编码代理真正卷到的，不是价格，而是工作流";
  const coverText = defaultCoverText;
  const coreViewpoint = sanitizeCoverContext(
    input.articleMeta.articleThesis ||
      input.factPack.recommendedFraming ||
      input.selectedTopic.selected.selection.articleThesis ||
      "AI coding agent 的竞争重点正在从模型能力转向工作流控制权。"
  );
  const safeFraming = sanitizeCoverContext(input.factPack.recommendedFraming);
  const safeCoreConflict = sanitizeCoverContext(
    input.selectedTopic.selected.selection.coreConflict
  );
  const visualConcept =
    "A clear central glowing workflow hub, surrounded by abstract code panels and connected tool nodes. The image should feel story-driven, polished, warm, friendly, and professional. Clean composition, clear subject, horizontal 900x383px layout, prominent Chinese headline inside safe margins, 2K quality, crisp details, soft cinematic lighting.";
  const chineseDesignDescription = [
    "封面围绕文章主题：AI coding agent 的竞争重点正在从价格和模型能力，转向开发者工作流入口。",
    `安全风格方向：${input.coverStyle}`,
    "画面采用 3D 动画电影质感和科技商业杂志封面感，以发光的工作流中枢节点作为视觉中心。",
    "中心主体是一张 3D 代码工作台，抽象代码窗口、节点连线和工具链路径从四周汇入工作流入口。",
    "中文大标题是最重要的视觉元素，居中或偏左居中，粗体、清晰、现代科技感，适合手机端缩略图阅读。",
    "画面只做抽象对比：一侧是闭源订阅入口，一侧是开源工具链路径，不使用真实品牌标识或人物肖像。",
    `核心观点：${coreViewpoint}`,
    `文章安全表达边界：${safeFraming}`,
    `选题核心冲突：${safeCoreConflict}`
  ].join("\n");
  const imagePrompt = [
    "Prompt:",
    "Create a warm friendly 3D animated movie style technology magazine cover for a Chinese WeChat article.",
    "",
    "Article title:",
    articleTitle,
    "",
    "Main Chinese headline:",
    `「${coverText}」`,
    "",
    "Core viewpoint:",
    coreViewpoint,
    "",
    "APIMart cover style:",
    input.coverStyle,
    "",
    "Visual concept:",
    visualConcept,
    "Build a clear visual center and strong central subject: a visible path flows from scattered coding tools toward a workflow entry gate.",
    "",
    "Composition:",
    "Horizontal 900x383px layout. Keep the prominent Chinese headline inside safe margins, centered or slightly left of center, bold, crisp, modern tech typography, readable in a mobile thumbnail.",
    "",
    "2K quality:",
    "High-quality 3D animated movie quality, ultra-detailed, high-resolution render, crisp details, clean edges, rounded shapes, soft cinematic lighting, polished commercial illustration.",
    "",
    "Avoid:",
    "No real brand logos, no official product marks for named coding tools, no specific prices, no concrete price tags, no zero-cost substitute slogans, no absolute replacement claims, no real people, no clutter, no cheap AI-generated look, no specific animation studio name."
  ].join("\n");
  const negativePrompt = [
    "real brand marks",
    "official product marks",
    "brand mascots",
    "real human portrait",
    "meme layout",
    "cheap synthetic look",
    "messy small text",
    "English title replacing Chinese headline",
    "price labels",
    "zero-cost substitute slogan",
    "absolute swap claim",
    "specific animation studio imitation",
    "low resolution",
    "blurry text",
    "distorted Chinese characters"
  ].join(", ");

  return {
    articleTitle,
    coverText,
    coreViewpoint,
    coverStyle: input.coverStyle,
    visualConcept,
    chineseDesignDescription,
    imagePrompt,
    negativePrompt
  };
}

export function sanitizeCoverStyle(input: string): string {
  return input
    .replace(/Pixar-inspired/gi, "warm friendly 3D animated movie style")
    .replace(/Pixar/gi, "3D animated movie")
    .replace(/皮克斯/g, "3D 动画电影质感")
    .replace(/Disney/gi, "animated family film")
    .replace(/迪士尼/g, "动画电影质感");
}

function sanitizeCoverContext(value: string): string {
  return value
    .replace(/\$200/g, "具体价格")
    .replace(/\b(?:100|200|299|399|999)\s*(?:USD|dollars?|美元|美金|\/month|\/月|元|刀)\b/gi, "具体价格")
    .replace(/免费平替/g, "低成本替换口号")
    .replace(/完全替代/g, "绝对替换")
    .replace(/免费替代高价工具/g, "单点价格对比")
    .replace(/开源免费替代/g, "开源工具链路径")
    .replace(/免费替代/g, "低成本替换")
    .replace(/高价编码代理/g, "产品化编码代理");
}

function createVisualRequirements(): CoverVisualRequirements {
  return {
    style: "3D animated movie quality, not specific studio imitation",
    size: requiredImageSize,
    quality: "2K render quality",
    language: "Chinese",
    mainTextRequired: true,
    visualCenterRequired: true
  };
}

function includesChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function promptRequestsRealBrandMarks(prompt: string): boolean {
  return /\b(use|include|show|add|place|display)\b.{0,40}\b(real\s+brand|brand)\b.{0,24}\b(logo|mark|identity)\b/i.test(
    prompt
  );
}

function promptIncludesOfficialMarkPhrases(prompt: string): boolean {
  return /Claude\s+Logo|Goose\s+Logo|Claude\s*官方\s*Logo|Goose\s*官方\s*Logo/i.test(
    prompt
  );
}

function promptIncludesSpecificPrice(prompt: string): boolean {
  return /\$200|\b(?:100|200|299|399|999)\s*(?:USD|dollars?|美元|美金|\/month|\/月|元|刀)\b/i.test(
    prompt
  );
}

function promptNamesSpecificStudios(prompt: string): boolean {
  return /Pixar|皮克斯|Disney|迪士尼/i.test(prompt);
}

function collectReviewIssues(checks: CoverReviewChecks): string[] {
  const failures: Array<[keyof CoverReviewChecks, string]> = [
    ["providerIsApimart", "provider must be apimart."],
    ["coverTextIsChinese", "coverText must contain Chinese headline text."],
    ["imageSizeIs900x383", "imageSize must be 900x383."],
    ["declares2KQuality", "prompt or visual requirements must declare 2K quality."],
    ["usesSafeAnimatedMovieStyle", "prompt must include a safe animated movie style description."],
    ["mentionsChineseHeadline", "prompt must mention Chinese headline requirements."],
    ["mentionsSafeMargins", "prompt must mention safe margins."],
    ["hasVisualCenter", "prompt must define a clear visual center or central subject."],
    ["doesNotRequestRealBrandMarks", "prompt must not request real brand marks."],
    ["doesNotRequestOfficialMarks", "prompt must not request official product marks."],
    ["doesNotIncludeSpecificPrice", "prompt must not include a concrete price."],
    ["doesNotIncludeFreeSubstituteSlogan", "prompt must not include a free substitute slogan."],
    ["doesNotIncludeAbsoluteSubstituteClaim", "prompt must not include an absolute substitute claim."],
    ["doesNotNameSpecificStudios", "prompt must not name a specific animation studio."],
    ["realApiModeProducesRealCover", "COVER_ENABLE_REAL_API=true requires cover.mode=real."],
    ["realApiModeDoesNotReturnMockSvg", "COVER_ENABLE_REAL_API=true must not return a mock SVG cover."],
    ["imagePathAvailable", "imagePath must exist or provide a mock path."],
    ["embeddedReviewPassed", "cover.review.passed must be true."]
  ];

  return failures
    .filter(([key]) => !checks[key])
    .map(([, message]) => message);
}

function createRiskNotes(cover: CoverResult): string[] {
  return [
    `APIMart is the only allowed image provider; current mode is ${cover.mode}.`,
    "The prompt keeps the comparison abstract and avoids brand marks, concrete price claims, human portraits, and absolute winner imagery.",
    "Mock mode writes a local placeholder file only; it does not call an external image API."
  ];
}

export function reviewCover(
  cover: CoverResult,
  options: {
    imagePathAvailable?: boolean;
    now?: Date;
    realApiEnabled?: boolean;
  } = {}
): CoverReviewResult {
  const promptForChecks = [
    cover.imagePrompt,
    cover.negativePrompt,
    cover.coverText,
    cover.visualRequirements.quality,
    cover.visualRequirements.style
  ].join("\n");
  const checks: CoverReviewChecks = {
    providerIsApimart: cover.provider === "apimart",
    coverTextIsChinese: includesChinese(cover.coverText),
    imageSizeIs900x383: cover.imageSize === requiredImageSize,
    declares2KQuality: /2K/.test(promptForChecks),
    usesSafeAnimatedMovieStyle:
      /3D animated movie style|3D animated movie quality|3D 动画电影质感|animated family film|动画电影质感/i.test(
        promptForChecks
      ),
    mentionsChineseHeadline: /Chinese headline|中文大标题/i.test(promptForChecks),
    mentionsSafeMargins: /safe margins|安全边距/i.test(promptForChecks),
    hasVisualCenter: /visual center|central subject|clear subject|workflow hub|视觉中心|中心主体/i.test(
      promptForChecks
    ),
    doesNotRequestRealBrandMarks: !promptRequestsRealBrandMarks(promptForChecks),
    doesNotRequestOfficialMarks: !promptIncludesOfficialMarkPhrases(promptForChecks),
    doesNotIncludeSpecificPrice: !promptIncludesSpecificPrice(promptForChecks),
    doesNotIncludeFreeSubstituteSlogan: !/免费平替/.test(promptForChecks),
    doesNotIncludeAbsoluteSubstituteClaim: !/完全替代/.test(promptForChecks),
    doesNotNameSpecificStudios: !promptNamesSpecificStudios(promptForChecks),
    realApiModeProducesRealCover: options.realApiEnabled ? cover.mode === "real" : true,
    realApiModeDoesNotReturnMockSvg: options.realApiEnabled
      ? cover.mode !== "mock" && !/\.svg$/i.test(cover.imagePath)
      : true,
    imagePathAvailable:
      options.imagePathAvailable ?? cover.imagePath.startsWith("mock://"),
    embeddedReviewPassed: cover.review.passed === true
  };
  const issues = collectReviewIssues(checks);
  const riskNotes = createRiskNotes(cover);

  return {
    provider: cover.provider,
    mode: cover.mode,
    imageSize: cover.imageSize,
    imagePath: cover.imagePath,
    passed: issues.length === 0,
    issues,
    riskNotes,
    checks,
    generatedAt: (options.now ?? new Date()).toISOString()
  };
}

function createCoverPromptMarkdown(input: {
  parts: CoverPromptParts;
  cover: CoverResult;
  provider: CoverImageProvider;
}): string {
  return [
    "# Cover Image Prompt",
    "",
    "## 文章标题",
    "",
    input.parts.articleTitle,
    "",
    "## 封面中文大标题",
    "",
    input.parts.coverText,
    "",
    "## 中文设计说明",
    "",
    input.parts.chineseDesignDescription,
    "",
    "## 核心观点",
    "",
    input.parts.coreViewpoint,
    "",
    "## APIMart Cover Style",
    "",
    input.parts.coverStyle,
    "",
    "## English Image Prompt",
    "",
    input.parts.imagePrompt,
    "",
    "## Negative Prompt",
    "",
    input.parts.negativePrompt,
    "",
    "## 设计风格说明",
    "",
    "- 3D animated movie style",
    "- rounded shapes",
    "- soft cinematic lighting",
    "- expressive objects",
    "- polished commercial illustration",
    "- high-quality 3D render",
    "- playful but professional tech magazine cover",
    "",
    "## 视觉中心说明",
    "",
    "发光的工作流中枢节点是中心主体，抽象代码窗口和工具链路径围绕它连接，形成从工具到工作流入口的视觉路径。",
    "",
    "## 尺寸说明",
    "",
    "900x383",
    "",
    "## 2K 质感说明",
    "",
    "最终画布为 900x383，同时在生图 prompt 中强调 2K quality、ultra-detailed、high-resolution render、crisp details、clean edges。",
    "",
    "## 禁止元素",
    "",
    "- 真实品牌标识或官方产品标识",
    "- Claude / Goose 官方标识",
    "- 具体价格数字或价格标签",
    "- 零成本替换口号",
    "- 绝对替代表述",
    "- 真人肖像",
    "- 表情包风格",
    "- 廉价合成质感",
    "- 具体动画工作室名称",
    "",
    "## Provider 信息",
    "",
    `provider: ${input.provider}`,
    "",
    "## 当前调用模式",
    "",
    `mode: ${input.cover.mode}`,
    ""
  ].join("\n");
}

async function imagePathAvailable(imagePath: string): Promise<boolean> {
  if (imagePath.startsWith("mock://")) {
    return true;
  }

  try {
    await access(imagePath);
    return true;
  } catch {
    return false;
  }
}

function reviewSummaryFrom(review: CoverReviewResult): CoverReviewSummary {
  return {
    passed: review.passed,
    issues: review.issues,
    riskNotes: review.riskNotes
  };
}

export async function generateCoverWithReport(
  options: GenerateCoverOptions = {}
): Promise<CoverPipelineResult> {
  const logger = options.logger ?? createLogger("cover-image");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const env = options.env ?? process.env;
  const coverImageDir = resolveCoverOutputDir(outputDir, env);
  const files = createOutputFiles(outputDir, coverImageDir);
  const articleFile = options.articleFile ?? join(outputDir, "article.md");
  const articleMetaFile = options.articleMetaFile ?? join(outputDir, "article-meta.json");
  const articleReviewFile =
    options.articleReviewFile ?? join(outputDir, "article-review.json");
  const selectedTopicFile =
    options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const topicFactPackFile =
    options.topicFactPackFile ?? join(outputDir, "topic-fact-pack.json");
  const writeOutputs = options.writeOutputs ?? true;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const provider = options.provider ?? env.COVER_IMAGE_PROVIDER ?? "apimart";
  const imageSize = resolveImageSize(env);
  const coverStyle = resolveApimartCoverStyle(env);
  const coverRealApiEnabled = env.COVER_ENABLE_REAL_API?.trim().toLowerCase() === "true";

  forceApimartImage(provider);

  const articleMarkdown = options.articleMarkdown ?? (await readFile(articleFile, "utf8"));
  const articleMeta =
    options.articleMeta ?? (await readJsonFile<ArticleMeta>(articleMetaFile));
  const articleReview =
    options.articleReview ?? (await readJsonFile<ArticleReviewResult>(articleReviewFile));
  const selectedTopic =
    options.selectedTopic ?? (await readJsonFile<SelectedTopic>(selectedTopicFile));
  const factPack =
    options.factPack ?? (await readJsonFile<TopicFactPack>(topicFactPackFile));

  if (!articleReview.passed) {
    throw new Error("Article review has not passed; cover generation is blocked.");
  }

  const parts = createPromptParts({
    articleMarkdown,
    articleMeta,
    selectedTopic,
    factPack,
    coverStyle
  });
  const image = await generateApimartImage({
    provider,
    imagePrompt: parts.imagePrompt,
    negativePrompt: parts.negativePrompt,
    coverText: parts.coverText,
    imageSize,
    outputDir: coverImageDir,
    env,
    now: options.now,
    fetchImpl: options.fetchImpl
  });
  const placeholderReview: CoverReviewSummary = {
    passed: true,
    issues: [],
    riskNotes: []
  };
  const cover: CoverResult = {
    provider: image.provider,
    mode: image.mode,
    title: parts.articleTitle,
    coverText: parts.coverText,
    imagePrompt: parts.imagePrompt,
    negativePrompt: parts.negativePrompt,
    imageSize,
    imagePath: image.imagePath,
    visualRequirements: createVisualRequirements(),
    review: placeholderReview,
    generatedAt
  };
  const review = reviewCover(cover, {
    imagePathAvailable: await imagePathAvailable(cover.imagePath),
    now: options.now,
    realApiEnabled: coverRealApiEnabled
  });
  cover.review = reviewSummaryFrom(review);
  const finalReview = reviewCover(cover, {
    imagePathAvailable: await imagePathAvailable(cover.imagePath),
    now: options.now,
    realApiEnabled: coverRealApiEnabled
  });
  cover.review = reviewSummaryFrom(finalReview);
  const promptMarkdown = createCoverPromptMarkdown({
    parts,
    cover,
    provider: image.provider
  });

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.cover, cover);
    await writeFile(files.coverPrompt, promptMarkdown, "utf8");
    await writeJson(files.coverReview, finalReview);
  }

  logger.info(
    `Generated ${cover.mode} cover with ${cover.provider}; review passed=${cover.review.passed}; image=${cover.imagePath}.`
  );

  return {
    outputDir,
    files,
    cover,
    review: finalReview,
    promptMarkdown
  };
}

export async function generateCover(
  options: GenerateCoverOptions = {}
): Promise<CoverResult> {
  const result = await generateCoverWithReport(options);
  return result.cover;
}
