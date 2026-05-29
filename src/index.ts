import { pathToFileURL } from "node:url";
import { collectNewsWithReport } from "./pipeline/collectNews.js";

export { runDailyPipeline } from "./pipeline/runDailyPipeline.js";
export { collectNews } from "./pipeline/collectNews.js";
export { selectTopic } from "./pipeline/selectTopic.js";
export { writeArticle } from "./pipeline/writeArticle.js";
export { reviewArticle } from "./pipeline/reviewArticle.js";
export { generateCover } from "./pipeline/generateCover.js";
export { renderWechatHtml } from "./pipeline/renderWechatHtml.js";
export { saveWechatDraft } from "./pipeline/saveWechatDraft.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await collectNewsWithReport();
}
