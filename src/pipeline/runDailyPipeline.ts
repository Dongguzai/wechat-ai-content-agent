import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopicFactPack } from "./buildTopicFactPack.js";
import { checkSourceHealthWithReport } from "./checkSourceHealth.js";
import { collectNewsWithReport } from "./collectNews.js";
import {
  selectManualTopicWithReport,
  selectTopicWithReport
} from "./selectTopic.js";
import { shortlistNewsWithReport } from "./shortlistNews.js";
import { writeArticleWithReport } from "./writeArticle.js";
import { generateTitlesWithReport } from "./generateTitles.js";
import { reviewArticleWithReport } from "./reviewArticle.js";
import { generateCoverWithReport } from "./generateCover.js";
import { renderWechatHtmlWithReport } from "./renderWechatHtml.js";
import { saveWechatDraftWithReport } from "./saveWechatDraft.js";
import { saveWechatDraftApiWithReport } from "./saveWechatDraftApi.js";
import { loadEditorialFeedback } from "./loadEditorialFeedback.js";
import { loadEditorialStyle } from "./loadEditorialStyle.js";
import { loadManualTopic } from "./loadManualTopic.js";
import { formatLlmUsage } from "../adapters/llm.js";
import type {
  DailyPipelineResult,
  PipelineOutputFiles
} from "../types/pipeline.js";
import { createLogger, type Logger } from "../utils/logger.js";
import type { CoverPipelineResult } from "../types/cover.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RunDailyPipelineOptions {
  outputDir?: string;
  logger?: Logger;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  useMockRss?: boolean;
  manualTopicFile?: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function reuseExistingCoverIfAvailable(
  outputDir: string,
  logger: Logger
): Promise<CoverPipelineResult | undefined> {
  const files = {
    cover: join(outputDir, "cover.json"),
    coverPrompt: join(outputDir, "cover-prompt.md"),
    coverReview: join(outputDir, "cover-review.json"),
    coverImageDir: join(outputDir, "covers")
  };

  try {
    const [cover, review] = await Promise.all([
      readJsonFile<CoverPipelineResult["cover"]>(files.cover),
      readJsonFile<CoverPipelineResult["review"]>(files.coverReview)
    ]);

    if (!review.passed || cover.imagePath !== review.imagePath) {
      return undefined;
    }

    logger.info(`Reusing existing cover artifacts; image=${cover.imagePath}.`);
    return {
      outputDir,
      files,
      cover,
      review,
      promptMarkdown: await readFile(files.coverPrompt, "utf8").catch(() => "")
    };
  } catch {
    return undefined;
  }
}

function createDailyReport(result: Omit<DailyPipelineResult, "durationMs">): string {
  const { artifacts, collectionStats, files, outputDir, shortlistStats } = result;
  const selected = artifacts.selectedTopic.selected;
  const finalTitle = artifacts.titleSelection.selectedTitle;
  const sourceHealth = artifacts.sourceHealth;

  return [
    "# Daily AI Content Pipeline Report",
    "",
    `Output directory: ${outputDir}`,
    "",
    "## Summary",
    "",
    "- Current phase: wechat official API draft dry-run",
    `- Candidate news: ${artifacts.candidates.length}`,
    `- Shortlisted news: ${artifacts.shortlisted.length}`,
    `- Manual topic used: ${artifacts.manualTopic.used ? "yes" : "no"}`,
    `- Manual topic file: ${artifacts.manualTopic.used ? artifacts.manualTopic.filePath : "none"}`,
    `- Editorial style read: ${artifacts.editorialStyle.loaded ? "yes" : "no"}`,
    `- Editorial style file: ${artifacts.editorialStyle.path}`,
    `- Feedback read: ${artifacts.editorialFeedback.feedbackRead ? "yes" : "no"}`,
    `- Feedback file: ${artifacts.editorialFeedback.latest?.filePath ?? "none"}`,
    `- Source health passed: ${sourceHealth.passed ? "yes" : "no"}`,
    `- Source health real items: ${sourceHealth.summary.totalRealNewsItems}`,
    `- Source health RSS items: ${sourceHealth.summary.realRssItems}`,
    `- Source health search items: ${sourceHealth.summary.realSearchItems}`,
    `- Source health fallback used: ${sourceHealth.sources.some((source) => source.usedFallback) ? "yes" : "no"}`,
    `- Selected topic: ${selected.title}`,
    `- Selected source reliability: ${selected.selection.sourceReliability}`,
    `- Selected decisionScore: ${selected.selection.decisionScore.toFixed(1)}`,
    `- Fact pack source reliability: ${artifacts.topicFactPack.sourceReliability}`,
    `- Fact pack claims: ${artifacts.topicFactPack.verifiedClaims.length}`,
    `- Article title: ${artifacts.article.title}`,
    `- Writer LLM: ${artifacts.articleMeta.llm?.provider ?? "minimax"} / ${artifacts.articleMeta.llm?.model ?? "unknown"} / ${artifacts.articleMeta.llm?.mode ?? "mock"} (${artifacts.articleMeta.llm ? formatLlmUsage(artifacts.articleMeta.llm.usage) : "usage unknown"})`,
    `- Title candidates generated: ${artifacts.titleCandidates.length}`,
    `- Final title: ${finalTitle}`,
    `- Title LLM: ${artifacts.titleSelection.llm?.provider ?? "minimax"} / ${artifacts.titleSelection.llm?.model ?? "unknown"} / ${artifacts.titleSelection.llm?.mode ?? "mock"} (${artifacts.titleSelection.llm ? formatLlmUsage(artifacts.titleSelection.llm.usage) : "usage unknown"})`,
    `- Final title selection reason: ${artifacts.titleSelection.selectionReason}`,
    `- Article word count: ${artifacts.article.wordCount}`,
    `- Article used claims: ${artifacts.articleMeta.usedClaims.length}`,
    `- Article review score: ${artifacts.articleReview.score}`,
    `- Article review passed: ${artifacts.articleReview.passed ? "yes" : "no"}`,
    `- Reviewer LLM: ${artifacts.articleReview.llm?.provider ?? "minimax"} / ${artifacts.articleReview.llm?.model ?? "unknown"} / ${artifacts.articleReview.llm?.mode ?? "mock"} (${artifacts.articleReview.llm ? formatLlmUsage(artifacts.articleReview.llm.usage) : "usage unknown"})`,
    `- Article review verdict: ${artifacts.articleReview.finalVerdict}`,
    `- Cover provider: ${artifacts.cover.provider}`,
    `- Cover mode: ${artifacts.cover.mode}`,
    `- Cover image size: ${artifacts.cover.imageSize}`,
    `- Cover review passed: ${artifacts.coverReview.passed ? "yes" : "no"}`,
    `- Cover image path: ${artifacts.cover.imagePath}`,
    `- WeChat HTML compatible: ${artifacts.wechatLayout.compatibleWithWechat ? "yes" : "no"}`,
    `- WeChat layout warnings: ${artifacts.wechatLayout.warnings.length}`,
    `- WeChat draft stage allowed: ${artifacts.wechatLayout.allowedNextStage ? "yes" : "no"}`,
    `- WeChat draft dry-run mode: ${artifacts.wechatDraft.mode}`,
    `- WeChat draft dry-run status: ${artifacts.wechatDraft.status}`,
    `- WeChat mock draftId: ${artifacts.wechatDraft.draftId}`,
    `- WeChat mock previewUrl: ${artifacts.wechatDraft.previewUrl}`,
    `- WeChat draft allowedNextStage: ${artifacts.wechatDraft.allowedNextStage ? "yes" : "no"}`,
    `- Human confirmation required: ${artifacts.wechatDraft.safety.requiresHumanConfirmation ? "yes" : "no"}`,
    `- WeChat official API draft mode: ${artifacts.wechatApiDraft.mode}`,
    `- WeChat official API draft status: ${artifacts.wechatApiDraft.status}`,
    `- WeChat official API preflight passed: ${artifacts.wechatApiPreflight.passed ? "yes" : "no"}`,
    `- WeChat official API real switches enabled: ${artifacts.wechatApiPreflight.realDraftSwitchEnabled && artifacts.wechatApiPreflight.realApiAllowSwitchEnabled ? "yes" : "no"}`,
    `- WeChat official API publish called: ${artifacts.wechatApiDraft.safety.publishApiCalled ? "yes" : "no"}`,
    `- WeChat official API mass send called: ${artifacts.wechatApiDraft.safety.massSendApiCalled ? "yes" : "no"}`,
    `- RSS shortlisted: ${shortlistStats.rssShortlistedCount}`,
    `- global_search shortlisted: ${shortlistStats.globalSearchShortlistedCount}`,
    `- Collection API real call: ${collectionStats.apiRealCall ? "yes" : "no"}`,
    "",
    "## Output Files",
    "",
    `- raw-news.json: ${files.rawNews}`,
    `- source-health.json: ${files.sourceHealth}`,
    `- source-health-report.md: ${files.sourceHealthReport}`,
    `- normalized-news.json: ${files.normalizedNews}`,
    `- rejected-news.json: ${files.rejectedNews}`,
    `- candidate-news.json: ${files.candidateNews}`,
    `- collection-report.md: ${files.collectionReport}`,
    `- shortlisted-news.json: ${files.shortlistedNews}`,
    `- shortlist-report.md: ${files.shortlistReport}`,
    `- selected-topic.json: ${files.selectedTopic}`,
    `- topic-selection-report.md: ${files.topicSelectionReport}`,
    `- topic-fact-pack.json: ${files.topicFactPackJson}`,
    `- topic-fact-pack.md: ${files.topicFactPackReport}`,
    `- article.md: ${files.article}`,
    `- article-meta.json: ${files.articleMeta}`,
    `- article-writing-report.md: ${files.articleWritingReport}`,
    `- title-candidates.json: ${files.titleCandidates}`,
    `- title-selection-report.md: ${files.titleSelectionReport}`,
    `- article-review.json: ${files.articleReview}`,
    `- article-review-report.md: ${files.articleReviewReport}`,
    `- cover.json: ${files.cover}`,
    `- cover-prompt.md: ${files.coverPrompt}`,
    `- cover-review.json: ${files.coverReview}`,
    `- covers/: ${files.coverImageDir}`,
    `- wechat.html: ${files.wechatHtml}`,
    `- wechat-layout.json: ${files.wechatLayout}`,
    `- wechat-layout-report.md: ${files.wechatLayoutReport}`,
    `- wechat-draft-result.json: ${files.wechatDraftResult}`,
    `- wechat-draft-report.md: ${files.wechatDraftReport}`,
    `- wechat-api-draft-result.json: ${files.wechatApiDraftResult}`,
    `- wechat-api-draft-report.md: ${files.wechatApiDraftReport}`,
    `- wechat-api-preflight.json: ${files.wechatApiPreflight}`,
    `- daily-report.md: ${files.dailyReport}`,
    "",
    "## Safety Notes",
    "",
    "- This run stops after generating the WeChat official API draft request preview.",
    "- 已完成 mock 草稿写入。",
    "- 已生成微信公众号官方 API 草稿箱请求预览。",
    "- 未操作真实公众号后台。",
    "- 未打开公众号后台。",
    "- 未真实写入草稿，除非显式打开 WECHAT_API_ENABLE_REAL_DRAFT 和 WECHAT_DRAFT_ALLOW_REAL_API。",
    "- 未发布。",
    "- 未群发。",
    "- 需要人工确认。",
    "- 真实 API 模式也只允许创建草稿箱草稿。",
    "- No public send action, mass send action, browser automation, or WeChat admin page operation is used.",
    "- APIMart is the only allowed image provider; default mode is mock unless COVER_ENABLE_REAL_API=true and APIMART_API_KEY is present.",
    "- Real APIMart generation is intentionally TODO-gated until the API contract is confirmed.",
    "- Tavily/Exa search summaries are treated as leads only, not factual sources.",
    "- The article uses topic-fact-pack safeWording and avoids absolute comparison claims.",
    ""
  ].join("\n");
}

export async function runDailyPipeline(
  options: RunDailyPipelineOptions = {}
): Promise<DailyPipelineResult> {
  const startedAt = Date.now();
  const logger = options.logger ?? createLogger("dry-run");
  const outputDir = options.outputDir ?? defaultOutputDir;

  await mkdir(outputDir, { recursive: true });
  logger.info(`Output directory ready: ${outputDir}`);

  const editorialStyle = await loadEditorialStyle({ logger });
  const editorialFeedback = await loadEditorialFeedback({ logger });
  const manualTopic = await loadManualTopic({
    manualTopicFile: options.manualTopicFile,
    logger
  });

  logger.info("1/12 checkSourceHealth: probing real RSS/search source readiness.");
  const sourceHealth = await checkSourceHealthWithReport({
    outputDir,
    logger,
    fetchImpl: options.fetchImpl,
    env: options.env,
    now: options.now
  });

  if (!sourceHealth.passed) {
    throw new Error(`Source health blocked: ${sourceHealth.issues.join(" ")}`);
  }

  logger.info("2/12 collectNews: building the 20-item candidate pool.");
  const collection = await collectNewsWithReport({
    outputDir,
    logger,
    fetchImpl: options.fetchImpl,
    env: options.env,
    now: options.now,
    useMockRss: options.useMockRss
  });

  logger.info("3/12 shortlistNews: running editorial first-pass selection.");
  const shortlist = await shortlistNewsWithReport({
    outputDir,
    candidates: collection.candidates,
    logger,
    writeOutputs: true
  });

  logger.info("4/12 selectTopic: choosing today's main editorial topic.");
  const topicSelection = manualTopic.used
    ? await selectManualTopicWithReport({
        outputDir,
        shortlisted: shortlist.shortlisted,
        manualTopic,
        editorialStyle,
        feedback: editorialFeedback,
        logger,
        writeOutputs: true,
        now: options.now
      })
    : await selectTopicWithReport({
        outputDir,
        shortlisted: shortlist.shortlisted,
        editorialStyle,
        feedback: editorialFeedback,
        logger,
        writeOutputs: true,
        now: options.now
      });

  logger.info("5/12 buildTopicFactPack: verifying key claims for the selected topic.");
  const factPack = await buildTopicFactPack({
    outputDir,
    topic: topicSelection.topic,
    logger,
    writeOutputs: true,
    now: options.now
  });

  logger.info("6/12 writeArticle: writing the WeChat article body.");
  const article = await writeArticleWithReport({
    outputDir,
    topic: topicSelection.topic,
    factPack: factPack.factPack,
    editorialStyle,
    logger,
    env: options.env,
    fetchImpl: options.fetchImpl,
    writeOutputs: true,
    now: options.now
  });

  logger.info("7/12 generateTitles: scoring title candidates and selecting final title.");
  const titleGeneration = await generateTitlesWithReport({
    outputDir,
    articleMarkdown: article.article.markdown,
    articleMeta: article.meta,
    selectedTopic: topicSelection.topic,
    factPack: factPack.factPack,
    editorialStyle,
    feedback: editorialFeedback,
    logger,
    env: options.env,
    fetchImpl: options.fetchImpl,
    writeOutputs: true,
    now: options.now
  });
  const articleForNextStages = {
    ...article.article,
    title: titleGeneration.articleMeta.title,
    markdown: titleGeneration.articleMarkdown,
    wordCount: titleGeneration.articleMeta.wordCount
  };
  const articleMetaForNextStages = titleGeneration.articleMeta;

  logger.info("8/12 reviewArticle: auditing the article before cover generation.");
  const articleReview = await reviewArticleWithReport({
    outputDir,
    articleMarkdown: articleForNextStages.markdown,
    articleMeta: articleMetaForNextStages,
    factPack: factPack.factPack,
    selectedTopic: topicSelection.topic,
    logger,
    env: options.env,
    fetchImpl: options.fetchImpl,
    writeOutputs: true,
    now: options.now
  });

  logger.info("9/12 cover: reusing existing cover artifacts when available.");
  const cover =
    (await reuseExistingCoverIfAvailable(outputDir, logger)) ??
    (await generateCoverWithReport({
      outputDir,
      articleMarkdown: articleForNextStages.markdown,
      articleMeta: articleMetaForNextStages,
      articleReview: articleReview.review,
      selectedTopic: topicSelection.topic,
      factPack: factPack.factPack,
      logger,
      env: options.env,
      writeOutputs: true,
      now: options.now
    }));

  logger.info("10/12 renderWechatHtml: creating Stripe-inspired WeChat HTML layout.");
  const wechatLayout = await renderWechatHtmlWithReport({
    outputDir,
    articleMarkdown: articleForNextStages.markdown,
    articleMeta: articleMetaForNextStages,
    articleReview: articleReview.review,
    cover: cover.cover,
    coverReview: cover.review,
    logger,
    writeOutputs: true,
    now: options.now
  });

  logger.info("11/12 saveWechatDraft: creating mock WeChat draft dry-run outputs.");
  const wechatDraft = await saveWechatDraftWithReport({
    outputDir,
    logger,
    writeOutputs: true,
    now: options.now
  });

  logger.info(
    "12/12 saveWechatDraftApi: generating WeChat official API draft request preview."
  );
  const wechatApiDraft = await saveWechatDraftApiWithReport({
    outputDir,
    logger,
    env: options.env,
    fetchImpl: options.fetchImpl,
    writeOutputs: true,
    now: options.now
  });

  const files: PipelineOutputFiles = {
    sourceHealth: sourceHealth.files.result,
    sourceHealthReport: sourceHealth.files.report,
    rawNews: collection.files.rawNews,
    normalizedNews: collection.files.normalizedNews,
    rejectedNews: collection.files.rejectedNews,
    candidateNews: collection.files.candidateNews,
    collectionReport: collection.files.collectionReport,
    shortlistedNews: shortlist.files.shortlistedNews,
    shortlistReport: shortlist.files.shortlistReport,
    selectedTopic: topicSelection.files.selectedTopic,
    topicSelectionReport: topicSelection.files.topicSelectionReport,
    topicFactPackJson: factPack.files.topicFactPackJson,
    topicFactPackReport: factPack.files.topicFactPackReport,
    article: article.files.article,
    articleMeta: article.files.articleMeta,
    articleWritingReport: article.files.articleWritingReport,
    titleCandidates: titleGeneration.files.titleCandidates,
    titleSelectionReport: titleGeneration.files.titleSelectionReport,
    articleReview: articleReview.files.articleReview,
    articleReviewReport: articleReview.files.articleReviewReport,
    cover: cover.files.cover,
    coverPrompt: cover.files.coverPrompt,
    coverReview: cover.files.coverReview,
    coverImageDir: cover.files.coverImageDir,
    wechatHtml: wechatLayout.files.wechatHtml,
    wechatLayout: wechatLayout.files.wechatLayout,
    wechatLayoutReport: wechatLayout.files.wechatLayoutReport,
    wechatDraftResult: wechatDraft.files.wechatDraftResult,
    wechatDraftReport: wechatDraft.files.wechatDraftReport,
    wechatApiDraftResult: wechatApiDraft.files.wechatApiDraftResult,
    wechatApiDraftReport: wechatApiDraft.files.wechatApiDraftReport,
    wechatApiPreflight: wechatApiDraft.files.wechatApiPreflight,
    dailyReport: join(outputDir, "daily-report.md")
  };

  const partialResult = {
    outputDir,
    files,
    artifacts: {
      candidates: collection.candidates,
      shortlisted: shortlist.shortlisted,
      selectedTopic: topicSelection.topic,
      manualTopic,
      editorialStyle,
      editorialFeedback,
      sourceHealth,
      topicFactPack: factPack.factPack,
      article: articleForNextStages,
      articleMeta: articleMetaForNextStages,
      titleCandidates: titleGeneration.candidates,
      titleSelection: titleGeneration.selection,
      articleReview: articleReview.review,
      cover: cover.cover,
      coverReview: cover.review,
      wechatLayout: wechatLayout.layout,
      wechatDraft: wechatDraft.result,
      wechatApiDraft: wechatApiDraft.result,
      wechatApiPreflight: wechatApiDraft.preflight
    },
    collectionStats: collection.stats,
    shortlistStats: shortlist.stats
  };
  const report = createDailyReport(partialResult);
  await writeFile(files.dailyReport, report, "utf8");

  const durationMs = Date.now() - startedAt;
  logger.info(`Dry-run completed in ${durationMs}ms.`);
  logger.info(
    `Shortlisted ${shortlist.stats.shortlistedCount} items; selected topic: ${topicSelection.topic.selected.title}; article review passed=${articleReview.review.passed}; cover review passed=${cover.review.passed}; HTML compatible=${wechatLayout.layout.compatibleWithWechat}; mock draft status=${wechatDraft.result.status}; API draft mode=${wechatApiDraft.result.mode}.`
  );

  return {
    ...partialResult,
    durationMs
  };
}
