import { loadDotEnv } from "../src/config/env.js";
import { archiveRunOutputs } from "../src/pipeline/archiveRun.js";
import { runDailyPipeline } from "../src/pipeline/runDailyPipeline.js";

await loadDotEnv();

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

const now = new Date();
const result = await runDailyPipeline({
  env: {
    ...process.env,
    WECHAT_DRAFT_DRY_RUN: "true",
    WECHAT_API_ENABLE_REAL_DRAFT: "false",
    WECHAT_DRAFT_ALLOW_REAL_API: "false"
  },
  manualTopicFile: manualTopicFileFromArgs(process.argv.slice(2)),
  now
});
const archive = await archiveRunOutputs({
  outputDir: result.outputDir,
  now
});

console.log(`[run:daily] output=${result.outputDir}`);
console.log(`[run:daily] archived=${archive.archiveDir}`);
