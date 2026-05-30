import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ManualTopicLoadResult } from "../types/editorial.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface LoadManualTopicOptions {
  manualTopicFile?: string;
  logger?: Logger;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultManualTopicFile = join(projectRoot, "inputs", "manual-topic.md");

function firstMatch(content: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function parseTitle(content: string): string | undefined {
  const heading = firstMatch(content, [/^#\s+(.+)$/m]);
  if (heading) {
    return heading;
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^(source|url|来源|角度|论点|thesis|angle)\s*[:：]/i.test(line));
}

export async function loadManualTopic(
  options: LoadManualTopicOptions = {}
): Promise<ManualTopicLoadResult> {
  const logger = options.logger ?? createLogger("manual-topic");
  const filePath = options.manualTopicFile ?? defaultManualTopicFile;

  try {
    const content = await readFile(filePath, "utf8");
    if (!content.trim()) {
      return { filePath, used: false, content: "" };
    }

    const sourceUrl =
      firstMatch(content, [
        /(?:Source URL|URL|来源链接|原文链接)\s*[:：]\s*(https?:\/\/\S+)/i
      ]) ?? content.match(/https?:\/\/\S+/)?.[0];
    const result: ManualTopicLoadResult = {
      filePath,
      used: true,
      content,
      title: parseTitle(content),
      sourceUrl,
      sourceName: firstMatch(content, [
        /(?:Source Name|来源|来源名称)\s*[:：]\s*(.+)$/im
      ]),
      angle: firstMatch(content, [/(?:Angle|写作角度|角度)\s*[:：]\s*(.+)$/im]),
      thesis: firstMatch(content, [/(?:Thesis|中心论点|论点)\s*[:：]\s*(.+)$/im])
    };

    logger.info(`Loaded manual topic override: ${filePath}`);
    return result;
  } catch {
    return { filePath, used: false, content: "" };
  }
}
