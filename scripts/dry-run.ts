import {
  loadDotEnv,
  miniMaxDotEnvOverrideKeys
} from "../src/config/env.js";
import {
  archiveRunOutputs,
  BRIEF_OUTPUT_ARCHIVE_PATHS
} from "../src/pipeline/archiveRun.js";
import {
  runDailyPipeline,
  type RunDailyFromStage,
  type RunDailyUntilStage
} from "../src/pipeline/runDailyPipeline.js";

await loadDotEnv({ overrideKeys: [...miniMaxDotEnvOverrideKeys] });

function manualTopicFileFromArgs(args: string[]): string | undefined {
  const index = args.indexOf("--manual-topic");
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--manual-topic requires a markdown file path.");
  }

  return value;
}

function valueAfterFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function parseUntil(args: string[]): RunDailyUntilStage | undefined {
  const value = valueAfterFlag(args, "--until");
  if (value === undefined) {
    return undefined;
  }

  if (value === "brief" || value === "topic") {
    return value;
  }

  throw new Error("--until must be brief or topic.");
}

function parseFrom(args: string[]): RunDailyFromStage | undefined {
  const value = valueAfterFlag(args, "--from");
  if (value === undefined) {
    return undefined;
  }

  if (value === "article" || value === "layout") {
    return value;
  }

  throw new Error("--from must be article or layout.");
}

const now = new Date();
const args = process.argv.slice(2);
const result = await runDailyPipeline({
  env: {
    ...process.env,
    REAL_PRODUCTION_MODE: "false",
    RSS_ENABLE_REAL_FETCH: "false",
    SEARCH_ENABLE_REAL_API: "false",
    WECHAT_DRAFT_DRY_RUN: "true",
    WECHAT_API_ENABLE_REAL_DRAFT: "false",
    WECHAT_DRAFT_ALLOW_REAL_API: "false"
  },
  manualTopicFile: manualTopicFileFromArgs(args),
  until: parseUntil(args),
  from: parseFrom(args),
  now
});

const archive = await archiveRunOutputs({
  outputDir: result.outputDir,
  now,
  relativePaths:
    result.stoppedAt === "brief" ? BRIEF_OUTPUT_ARCHIVE_PATHS : undefined
});

console.log(`[dry-run] archived=${archive.archiveDir}`);
console.log(`[dry-run] stoppedAt=${result.stoppedAt}; next=${result.nextCommand}`);
