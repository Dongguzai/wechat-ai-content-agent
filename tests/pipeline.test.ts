import assert from "node:assert/strict";
import test from "node:test";
import { collectNewsWithReport } from "../src/pipeline/collectNews.js";
import { selectTopic } from "../src/pipeline/selectTopic.js";
import { shortlistNewsWithReport } from "../src/pipeline/shortlistNews.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

test("selectTopic returns one editor-approved topic with selection rationale", async () => {
  const collection = await collectNewsWithReport({
    useMockRss: true,
    writeOutputs: false,
    logger: silentLogger,
    env: { SEARCH_ENABLE_REAL_API: "false" },
    now: new Date("2026-05-29T00:00:00.000Z")
  });
  const shortlist = await shortlistNewsWithReport({
    candidates: collection.candidates,
    writeOutputs: false,
    logger: silentLogger
  });
  const topic = selectTopic(shortlist.shortlisted, {
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  assert.ok(topic.selected.title);
  assert.ok(topic.selected.url);
  assert.ok(topic.selected.selection.selectedReason);
  assert.ok(topic.selected.selection.whyMostWorthWriting);
  assert.ok(topic.selected.selection.articleThesis);
  assert.ok(topic.runnersUp.length >= 2);
  assert.ok(topic.rejected.length > 0);
});
