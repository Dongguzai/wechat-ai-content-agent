import { access, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RunArchiveEntry,
  RunArchiveManifest,
  RunArchiveResult
} from "../types/runArchive.js";
import { formatRunArchiveTimestamp } from "../utils/dateFormat.js";

export interface ArchiveRunOutputsOptions {
  outputDir?: string;
  runsDir?: string;
  now?: Date;
  relativePaths?: readonly string[];
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultOutputDir = join(projectRoot, "outputs");
const defaultRunsDir = join(projectRoot, "runs");

export const CORE_OUTPUT_ARCHIVE_PATHS = [
  "raw-news.json",
  "normalized-news.json",
  "rejected-news.json",
  "candidate-news.json",
  "collection-report.md",
  "shortlisted-news.json",
  "shortlist-report.md",
  "selected-topic.json",
  "topic-selection-report.md",
  "topic-fact-pack.json",
  "topic-fact-pack.md",
  "article.md",
  "article-meta.json",
  "article-writing-report.md",
  "title-candidates.json",
  "title-selection-report.md",
  "article-review.json",
  "article-review-report.md",
  "cover.json",
  "cover-prompt.md",
  "cover-review.json",
  "covers",
  "wechat.html",
  "wechat-layout.json",
  "wechat-layout-report.md",
  "wechat-draft-result.json",
  "wechat-draft-report.md",
  "wechat-api-preflight.json",
  "wechat-api-draft-result.json",
  "wechat-api-draft-report.md",
  "daily-report.md"
] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function archiveRunOutputs(
  options: ArchiveRunOutputsOptions = {}
): Promise<RunArchiveResult> {
  const outputDir = options.outputDir ?? defaultOutputDir;
  const runsDir = options.runsDir ?? defaultRunsDir;
  const now = options.now ?? new Date();
  const archivedAt = now.toISOString();
  const archiveDir = join(runsDir, formatRunArchiveTimestamp(now));
  const relativePaths = options.relativePaths ?? CORE_OUTPUT_ARCHIVE_PATHS;
  const entries: RunArchiveEntry[] = [];
  const missing: string[] = [];

  await mkdir(archiveDir, { recursive: true });

  for (const relativePath of relativePaths) {
    const sourcePath = join(outputDir, relativePath);
    const archivedPath = join(archiveDir, relativePath);

    if (!(await pathExists(sourcePath))) {
      missing.push(relativePath);
      continue;
    }

    const sourceStat = await stat(sourcePath);
    await cp(sourcePath, archivedPath, {
      recursive: sourceStat.isDirectory(),
      force: true
    });
    entries.push({
      sourcePath,
      archivedPath,
      relativePath,
      kind: sourceStat.isDirectory() ? "directory" : "file"
    });
  }

  const dailyReportPath = join(outputDir, "daily-report.md");
  if (await pathExists(dailyReportPath)) {
    const runReportPath = join(archiveDir, "run-report.md");
    await writeFile(runReportPath, await readFile(dailyReportPath, "utf8"), "utf8");
    entries.push({
      sourcePath: dailyReportPath,
      archivedPath: runReportPath,
      relativePath: "run-report.md",
      kind: "file"
    });
  }

  const manifestPath = join(archiveDir, "run-manifest.json");
  const manifest: RunArchiveManifest = {
    version: 1,
    archivedAt,
    sourceOutputDir: outputDir,
    archiveDir,
    entries,
    missing
  };

  await writeJson(manifestPath, manifest);

  return {
    archiveDir,
    manifestPath,
    entries,
    missing,
    archivedAt
  };
}
