import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopicFactPack } from "./buildTopicFactPack.js";
import { collectNewsWithReport } from "./collectNews.js";
import { selectTopicWithReport } from "./selectTopic.js";
import { shortlistNewsWithReport } from "./shortlistNews.js";
import { writeArticleWithReport } from "./writeArticle.js";
import type {
  DailyPipelineResult,
  PipelineOutputFiles
} from "../types/pipeline.js";
import { createLogger, type Logger } from "../utils/logger.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RunDailyPipelineOptions {
  outputDir?: string;
  logger?: Logger;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  useMockRss?: boolean;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function createDailyReport(result: Omit<DailyPipelineResult, "durationMs">): string {
  const { artifacts, collectionStats, files, outputDir, shortlistStats } = result;
  const selected = artifacts.selectedTopic.selected;

  return [
    "# Daily AI Content Pipeline Report",
    "",
    `Output directory: ${outputDir}`,
    "",
    "## Summary",
    "",
    "- Current phase: article writing only",
    `- Candidate news: ${artifacts.candidates.length}`,
    `- Shortlisted news: ${artifacts.shortlisted.length}`,
    `- Selected topic: ${selected.title}`,
    `- Selected source reliability: ${selected.selection.sourceReliability}`,
    `- Selected decisionScore: ${selected.selection.decisionScore.toFixed(1)}`,
    `- Fact pack source reliability: ${artifacts.topicFactPack.sourceReliability}`,
    `- Fact pack claims: ${artifacts.topicFactPack.verifiedClaims.length}`,
    `- Article title: ${artifacts.article.title}`,
    `- Article word count: ${artifacts.article.wordCount}`,
    `- Article used claims: ${artifacts.articleMeta.usedClaims.length}`,
    `- RSS shortlisted: ${shortlistStats.rssShortlistedCount}`,
    `- global_search shortlisted: ${shortlistStats.globalSearchShortlistedCount}`,
    `- Collection API real call: ${collectionStats.apiRealCall ? "yes" : "no"}`,
    "",
    "## Output Files",
    "",
    `- raw-news.json: ${files.rawNews}`,
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
    `- daily-report.md: ${files.dailyReport}`,
    "",
    "## Safety Notes",
    "",
    "- This run stops after writing the article body.",
    "- No cover, WeChat HTML, WeChat draft, APIMart call, or browser automation is used.",
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

  logger.info("1/5 collectNews: building the 20-item candidate pool.");
  const collection = await collectNewsWithReport({
    outputDir,
    logger,
    fetchImpl: options.fetchImpl,
    env: options.env,
    now: options.now,
    useMockRss: options.useMockRss
  });

  logger.info("2/5 shortlistNews: running editorial first-pass selection.");
  const shortlist = await shortlistNewsWithReport({
    outputDir,
    candidates: collection.candidates,
    logger,
    writeOutputs: true
  });

  logger.info("3/5 selectTopic: choosing today's main editorial topic.");
  const topicSelection = await selectTopicWithReport({
    outputDir,
    shortlisted: shortlist.shortlisted,
    logger,
    writeOutputs: true,
    now: options.now
  });

  logger.info("4/5 buildTopicFactPack: verifying key claims for the selected topic.");
  const factPack = await buildTopicFactPack({
    outputDir,
    topic: topicSelection.topic,
    logger,
    writeOutputs: true,
    now: options.now
  });

  logger.info("5/5 writeArticle: writing the WeChat article body.");
  const article = await writeArticleWithReport({
    outputDir,
    topic: topicSelection.topic,
    factPack: factPack.factPack,
    logger,
    writeOutputs: true,
    now: options.now
  });

  const files: PipelineOutputFiles = {
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
    dailyReport: join(outputDir, "daily-report.md")
  };

  const partialResult = {
    outputDir,
    files,
    artifacts: {
      candidates: collection.candidates,
      shortlisted: shortlist.shortlisted,
      selectedTopic: topicSelection.topic,
      topicFactPack: factPack.factPack,
      article: article.article,
      articleMeta: article.meta
    },
    collectionStats: collection.stats,
    shortlistStats: shortlist.stats
  };
  const report = createDailyReport(partialResult);
  await writeFile(files.dailyReport, report, "utf8");

  const durationMs = Date.now() - startedAt;
  logger.info(`Dry-run completed in ${durationMs}ms.`);
  logger.info(
    `Shortlisted ${shortlist.stats.shortlistedCount} items; selected topic: ${topicSelection.topic.selected.title}; article ready.`
  );

  return {
    ...partialResult,
    durationMs
  };
}
