import { pathToFileURL } from "node:url";
import { loadDotEnv } from "./config/env.js";
import { runDailyPipeline } from "./pipeline/runDailyPipeline.js";

export { runDailyPipeline } from "./pipeline/runDailyPipeline.js";
export { buildTopicFactPack } from "./pipeline/buildTopicFactPack.js";
export {
  checkSourceHealth,
  checkSourceHealthWithReport
} from "./pipeline/checkSourceHealth.js";
export { collectNews } from "./pipeline/collectNews.js";
export { shortlistNews, shortlistNewsWithReport } from "./pipeline/shortlistNews.js";
export { selectTopic } from "./pipeline/selectTopic.js";
export { writeArticle, writeArticleWithReport } from "./pipeline/writeArticle.js";
export {
  FORBIDDEN_TITLE_TERMS,
  generateTitleCandidates,
  generateTitlesWithReport
} from "./pipeline/generateTitles.js";
export { loadEditorialFeedback } from "./pipeline/loadEditorialFeedback.js";
export { loadEditorialStyle } from "./pipeline/loadEditorialStyle.js";
export { loadManualTopic } from "./pipeline/loadManualTopic.js";
export {
  reviewArticle,
  reviewArticleWithReport
} from "./pipeline/reviewArticle.js";
export {
  generateCover,
  generateCoverWithReport,
  reviewCover
} from "./pipeline/generateCover.js";
export {
  canEnterWechatDraftStage,
  renderWechatHtml,
  renderWechatHtmlWithReport,
  reviewWechatHtmlChecks
} from "./pipeline/renderWechatHtml.js";
export {
  assertWechatDraftActionLabel,
  saveWechatDraft,
  saveWechatDraftWithReport
} from "./pipeline/saveWechatDraft.js";
export {
  saveWechatDraftApi,
  saveWechatDraftApiWithReport
} from "./pipeline/saveWechatDraftApi.js";
export {
  saveWechatDraftBrowserPlanWithReport
} from "./pipeline/saveWechatDraftBrowser.js";
export {
  addWechatDraft,
  getAccessToken,
  uploadCoverMaterial
} from "./adapters/wechatOfficialApi.js";
export {
  forbidWechatPublishApi,
  verifyWechatDraftOnlyApiGuard
} from "./hooks/forbidWechatPublishApi.js";
export {
  createWechatBrowserDraftPlan,
  createWechatBrowserRuntimeConfig,
  createWechatBrowserSafetyCheck,
  reviewWechatBrowserActionLabel
} from "./adapters/wechatBrowser.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await loadDotEnv();
  await runDailyPipeline();
}
