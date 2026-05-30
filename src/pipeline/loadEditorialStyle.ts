import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditorialStyleLoadResult } from "../types/editorial.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface LoadEditorialStyleOptions {
  styleFile?: string;
  logger?: Logger;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultStyleFile = join(projectRoot, "config", "editorial-style.md");

export async function loadEditorialStyle(
  options: LoadEditorialStyleOptions = {}
): Promise<EditorialStyleLoadResult> {
  const logger = options.logger ?? createLogger("editorial-style");
  const path = options.styleFile ?? defaultStyleFile;

  try {
    const content = await readFile(path, "utf8");
    logger.info(`Loaded editorial style config: ${path}`);
    return {
      path,
      content,
      loaded: content.trim().length > 0
    };
  } catch (error) {
    logger.warn(
      `Editorial style config not loaded: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      path,
      content: "",
      loaded: false
    };
  }
}
