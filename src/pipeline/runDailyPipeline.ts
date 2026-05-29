import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectNewsWithReport } from "./collectNews.js";
import { shortlistNewsWithReport } from "./shortlistNews.js";
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

  return [
    "# Daily AI Content Pipeline Report",
    "",
    `Output directory: ${outputDir}`,
    "",
    "## Summary",
    "",
    "- Current phase: editorial shortlist only",
    `- Candidate news: ${artifacts.candidates.length}`,
    `- Shortlisted news: ${artifacts.shortlisted.length}`,
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
    `- daily-report.md: ${files.dailyReport}`,
    "",
    "## Safety Notes",
    "",
    "- This run stops after shortlisting; it does not select a final topic.",
    "- No article, cover, WeChat draft, APIMart call, or browser automation is used.",
    "- Tavily/Exa search summaries are treated as leads only, not factual sources.",
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

  logger.info("1/2 collectNews: building the 20-item candidate pool.");
  const collection = await collectNewsWithReport({
    outputDir,
    logger,
    fetchImpl: options.fetchImpl,
    env: options.env,
    now: options.now,
    useMockRss: options.useMockRss
  });

  logger.info("2/2 shortlistNews: running editorial first-pass selection.");
  const shortlist = await shortlistNewsWithReport({
    outputDir,
    candidates: collection.candidates,
    logger,
    writeOutputs: true
  });

  const files: PipelineOutputFiles = {
    rawNews: collection.files.rawNews,
    normalizedNews: collection.files.normalizedNews,
    rejectedNews: collection.files.rejectedNews,
    candidateNews: collection.files.candidateNews,
    collectionReport: collection.files.collectionReport,
    shortlistedNews: shortlist.files.shortlistedNews,
    shortlistReport: shortlist.files.shortlistReport,
    dailyReport: join(outputDir, "daily-report.md")
  };

  const partialResult = {
    outputDir,
    files,
    artifacts: {
      candidates: collection.candidates,
      shortlisted: shortlist.shortlisted
    },
    collectionStats: collection.stats,
    shortlistStats: shortlist.stats
  };
  const report = createDailyReport(partialResult);
  await writeFile(files.dailyReport, report, "utf8");

  const durationMs = Date.now() - startedAt;
  logger.info(`Dry-run completed in ${durationMs}ms.`);
  logger.info(
    `Shortlisted ${shortlist.stats.shortlistedCount} items; no final topic selected.`
  );

  return {
    ...partialResult,
    durationMs
  };
}
