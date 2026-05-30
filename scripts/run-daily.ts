import { loadDotEnv } from "../src/config/env.js";
import { archiveRunOutputs } from "../src/pipeline/archiveRun.js";
import { runDailyPipeline } from "../src/pipeline/runDailyPipeline.js";

await loadDotEnv();

const now = new Date();
const result = await runDailyPipeline({
  env: {
    ...process.env,
    WECHAT_DRAFT_DRY_RUN: "true",
    WECHAT_API_ENABLE_REAL_DRAFT: "false",
    WECHAT_DRAFT_ALLOW_REAL_API: "false"
  },
  now
});
const archive = await archiveRunOutputs({
  outputDir: result.outputDir,
  now
});

console.log(`[run:daily] output=${result.outputDir}`);
console.log(`[run:daily] archived=${archive.archiveDir}`);
