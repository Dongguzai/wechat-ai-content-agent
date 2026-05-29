import assert from "node:assert/strict";
import test from "node:test";
import { collectNews } from "../src/pipeline/collectNews.js";
import { selectTopic } from "../src/pipeline/selectTopic.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

test("selectTopic chooses the highest final score", async () => {
  const news = await collectNews({
    useMockRss: true,
    writeOutputs: false,
    logger: silentLogger,
    env: { SEARCH_ENABLE_REAL_API: "false" }
  });
  const topic = selectTopic(news);
  const maxScore = Math.max(...news.map((item) => item.scores.final));

  assert.equal(topic.news.scores.final, maxScore);
});
