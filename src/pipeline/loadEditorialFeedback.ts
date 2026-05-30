import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EditorialFeedback,
  EditorialFeedbackLoadResult,
  LoadedEditorialFeedback
} from "../types/feedback.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface LoadEditorialFeedbackOptions {
  feedbackDir?: string;
  logger?: Logger;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultFeedbackDir = join(projectRoot, "feedback");

function isFeedback(value: unknown): value is EditorialFeedback {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.date === "string" &&
    typeof record.title === "string" &&
    typeof record.published === "boolean" &&
    typeof record.views === "number" &&
    typeof record.likes === "number" &&
    typeof record.shares === "number" &&
    typeof record.myRating === "number" &&
    typeof record.topicQuality === "number" &&
    typeof record.titleQuality === "number" &&
    Array.isArray(record.articleProblems) &&
    record.articleProblems.every((item) => typeof item === "string") &&
    typeof record.notes === "string"
  );
}

function sortFeedbackByDate(
  left: LoadedEditorialFeedback,
  right: LoadedEditorialFeedback
): number {
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return rightTime - leftTime;
  }

  return right.filePath.localeCompare(left.filePath);
}

export async function loadEditorialFeedback(
  options: LoadEditorialFeedbackOptions = {}
): Promise<EditorialFeedbackLoadResult> {
  const logger = options.logger ?? createLogger("editorial-feedback");
  const feedbackDir = options.feedbackDir ?? defaultFeedbackDir;
  const skippedFiles: string[] = [];

  let entries;
  try {
    entries = await readdir(feedbackDir, { withFileTypes: true });
  } catch {
    return {
      feedbackDir,
      feedbackRead: false,
      skippedFiles
    };
  }

  const loaded: LoadedEditorialFeedback[] = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      extname(entry.name) !== ".json" ||
      entry.name === "template.json"
    ) {
      continue;
    }

    const filePath = join(feedbackDir, entry.name);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      if (!isFeedback(parsed)) {
        skippedFiles.push(filePath);
        continue;
      }
      loaded.push({ ...parsed, filePath });
    } catch {
      skippedFiles.push(filePath);
    }
  }

  loaded.sort(sortFeedbackByDate);
  const latest = loaded[0];

  if (latest) {
    logger.info(`Loaded latest editorial feedback: ${latest.filePath}`);
  }

  return {
    feedbackDir,
    latest,
    feedbackRead: Boolean(latest),
    skippedFiles
  };
}
