import { loadDotEnv } from "../src/config/env.js";
import { saveWechatDraftApiWithReport } from "../src/pipeline/saveWechatDraftApi.js";

await loadDotEnv();

try {
  const realModeRequested = process.argv.includes("--real");
  const force = process.argv.includes("--force");

  if (
    realModeRequested &&
    (process.env.WECHAT_API_ENABLE_REAL_DRAFT !== "true" ||
      process.env.WECHAT_DRAFT_ALLOW_REAL_API !== "true")
  ) {
    throw new Error(
      "pnpm wechat:draft:real requires WECHAT_API_ENABLE_REAL_DRAFT=true and WECHAT_DRAFT_ALLOW_REAL_API=true."
    );
  }

  const result = await saveWechatDraftApiWithReport({
    env: realModeRequested
      ? {
          ...process.env,
          WECHAT_DRAFT_DRY_RUN: "false"
        }
      : process.env,
    force
  });

  console.log(
    `[wechat:draft] ${result.result.mode} ${result.result.status}; result=${result.files.wechatApiDraftResult}`
  );
  console.log(`[wechat:draft] preflight=${result.files.wechatApiPreflight}`);
  console.log(`[wechat:draft] report=${result.files.wechatApiDraftReport}`);
  if (force && result.result.mode === "real_api") {
    console.log("[wechat:draft] force override used for same-day draft lock.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`[wechat:draft] blocked: ${message}`);
  process.exitCode = 1;
}
