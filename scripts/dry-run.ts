import { loadDotEnv } from "../src/config/env.js";
import { runDailyPipeline } from "../src/pipeline/runDailyPipeline.js";

await loadDotEnv();

await runDailyPipeline({
  env: {
    ...process.env,
    WECHAT_DRAFT_DRY_RUN: "true",
    WECHAT_API_ENABLE_REAL_DRAFT: "false",
    WECHAT_DRAFT_ALLOW_REAL_API: "false"
  }
});
