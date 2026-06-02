import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArticleMeta } from "../types/article.js";
import type {
  FeedbackTemplate,
  FeedbackTemplateResult
} from "../types/feedback.js";
import type { SelectedTopic } from "../types/news.js";
import type { WechatApiDraftResult } from "../types/wechatApiDraft.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface CreateFeedbackTemplateOptions {
  outputDir?: string;
  runsDir?: string;
  feedbackDir?: string;
  logger?: Logger;
  now?: Date;
}

interface FeedbackSource {
  sourceDir: string;
  articleMeta: ArticleMeta;
  selectedTopic?: SelectedTopic;
  wechatApiDraft?: WechatApiDraftResult;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultOutputDir = join(projectRoot, "outputs");
const defaultRunsDir = join(projectRoot, "runs");
const defaultFeedbackDir = join(projectRoot, "feedback");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createFeedbackTitleSlug(title: string): string {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "untitled";
}

function draftMediaIdFrom(result: WechatApiDraftResult | undefined): string {
  if (result?.status === "draft_created") {
    return result.mediaId;
  }

  return "";
}

async function loadSourceFromDir(sourceDir: string): Promise<FeedbackSource | undefined> {
  const articleMetaPath = join(sourceDir, "article-meta.json");

  if (!(await pathExists(articleMetaPath))) {
    return undefined;
  }

  return {
    sourceDir,
    articleMeta: await readJsonFile<ArticleMeta>(articleMetaPath),
    selectedTopic: await readOptionalJsonFile<SelectedTopic>(
      join(sourceDir, "selected-topic.json")
    ),
    wechatApiDraft: await readOptionalJsonFile<WechatApiDraftResult>(
      join(sourceDir, "wechat-api-draft-result.json")
    )
  };
}

async function latestRunDirs(runsDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const path = join(runsDir, entry.name);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs, name: entry.name };
      })
  );

  return dirs
    .sort((left, right) => right.name.localeCompare(left.name) || right.mtimeMs - left.mtimeMs)
    .map((entry) => entry.path);
}

async function resolveFeedbackSource(input: {
  outputDir: string;
  runsDir: string;
}): Promise<FeedbackSource> {
  const outputSource = await loadSourceFromDir(input.outputDir);
  if (outputSource) {
    return outputSource;
  }

  for (const runDir of await latestRunDirs(input.runsDir)) {
    const runSource = await loadSourceFromDir(runDir);
    if (runSource) {
      return runSource;
    }
  }

  throw new Error("No article-meta.json found in outputs or runs.");
}

function createFeedback(input: {
  date: string;
  source: FeedbackSource;
}): FeedbackTemplate {
  const selectedTitle = input.source.selectedTopic?.selected.title;

  return {
    date: input.date,
    title: input.source.articleMeta.title,
    topic: selectedTitle ?? input.source.articleMeta.sourceTopic,
    draftMediaId: draftMediaIdFrom(input.source.wechatApiDraft),
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
}

export async function createFeedbackTemplate(
  options: CreateFeedbackTemplateOptions = {}
): Promise<FeedbackTemplateResult> {
  const logger = options.logger ?? createLogger("feedback-template");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const runsDir = options.runsDir ?? defaultRunsDir;
  const feedbackDir = options.feedbackDir ?? defaultFeedbackDir;
  const date = formatDate(options.now ?? new Date());
  const source = await resolveFeedbackSource({ outputDir, runsDir });
  const feedback = createFeedback({ date, source });
  const slug = createFeedbackTitleSlug(feedback.title);
  const filePath = join(feedbackDir, `${date}-${slug}.json`);

  if (await pathExists(filePath)) {
    throw new Error(`Feedback file already exists and will not be overwritten: ${filePath}`);
  }

  await mkdir(feedbackDir, { recursive: true });
  await writeJson(filePath, feedback);
  logger.info(`Created feedback template: ${filePath}`);

  return {
    feedbackDir,
    sourceDir: source.sourceDir,
    filePath,
    feedback
  };
}
