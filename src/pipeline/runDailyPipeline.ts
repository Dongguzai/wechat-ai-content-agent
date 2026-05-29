import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectNews } from "./collectNews.js";
import { generateCover } from "./generateCover.js";
import { renderWechatHtml } from "./renderWechatHtml.js";
import { reviewArticle } from "./reviewArticle.js";
import { saveWechatDraft } from "./saveWechatDraft.js";
import { selectTopic } from "./selectTopic.js";
import { writeArticle } from "./writeArticle.js";
import type { DailyPipelineResult, PipelineOutputFiles } from "../types/pipeline.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface RunDailyPipelineOptions {
  outputDir?: string;
  logger?: Logger;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createDailyReport(result: Omit<DailyPipelineResult, "durationMs">): string {
  const { artifacts, files, outputDir } = result;

  return [
    "# Daily AI Content Pipeline Report",
    "",
    `Output directory: ${outputDir}`,
    "",
    "## Summary",
    "",
    `- News collected: ${artifacts.news.length}`,
    `- Selected topic: ${artifacts.selectedTopic.news.title}`,
    `- Article title: ${artifacts.article.title}`,
    `- Article length: ${artifacts.article.wordCount} chars`,
    `- Review passed: ${artifacts.review.passed}`,
    `- Cover mode: ${artifacts.cover.mode}`,
    `- Draft mode: ${artifacts.draft.mode}`,
    `- Draft status: ${artifacts.draft.status}`,
    "",
    "## Output Files",
    "",
    `- latest-news.json: ${files.latestNews}`,
    `- selected-topic.json: ${files.selectedTopic}`,
    `- article.md: ${files.articleMarkdown}`,
    `- article-review.json: ${files.articleReview}`,
    `- cover.json: ${files.cover}`,
    `- wechat.html: ${files.wechatHtml}`,
    `- daily-report.md: ${files.dailyReport}`,
    "",
    "## Safety Notes",
    "",
    "- Source URLs are required for every news item.",
    "- The current draft step is mock-only.",
    "- No external service, browser automation, schedule, or database is used in this phase.",
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

  logger.info("1/7 collectNews: loading mock AI news.");
  const news = await collectNews();

  logger.info("2/7 selectTopic: choosing the highest scored topic.");
  const selectedTopic = selectTopic(news);

  logger.info("3/7 writeArticle: drafting a mock WeChat article.");
  const article = writeArticle(selectedTopic);

  logger.info("4/7 reviewArticle: running mock editorial review.");
  const review = reviewArticle(article);

  if (!review.passed) {
    throw new Error(`Article review failed: ${review.issues.join("; ")}`);
  }

  logger.info("5/7 generateCover: creating mock cover metadata.");
  const cover = generateCover(selectedTopic);

  logger.info("6/7 renderWechatHtml: rendering WeChat-compatible HTML.");
  const wechatHtml = renderWechatHtml(article);

  logger.info("7/7 saveWechatDraft: saving a mock draft record.");
  const draft = await saveWechatDraft({ article, cover, html: wechatHtml });

  const files: PipelineOutputFiles = {
    latestNews: join(outputDir, "latest-news.json"),
    selectedTopic: join(outputDir, "selected-topic.json"),
    articleMarkdown: join(outputDir, "article.md"),
    articleReview: join(outputDir, "article-review.json"),
    cover: join(outputDir, "cover.json"),
    wechatHtml: join(outputDir, "wechat.html"),
    dailyReport: join(outputDir, "daily-report.md")
  };

  await writeJson(files.latestNews, news);
  await writeJson(files.selectedTopic, selectedTopic);
  await writeFile(files.articleMarkdown, `${article.markdown}\n`, "utf8");
  await writeJson(files.articleReview, review);
  await writeJson(files.cover, cover);
  await writeFile(files.wechatHtml, `${wechatHtml.html}\n`, "utf8");

  const partialResult = {
    outputDir,
    files,
    artifacts: {
      news,
      selectedTopic,
      article,
      review,
      cover,
      wechatHtml,
      draft
    }
  };
  const report = createDailyReport(partialResult);
  await writeFile(files.dailyReport, report, "utf8");

  const durationMs = Date.now() - startedAt;
  logger.info(`Dry-run completed in ${durationMs}ms.`);
  logger.info(`Selected topic: ${selectedTopic.news.title}`);
  logger.info(`Generated files: ${Object.values(files).join(", ")}`);

  return {
    ...partialResult,
    durationMs
  };
}
