import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createFeedbackTemplate,
  createFeedbackTitleSlug
} from "../src/pipeline/createFeedbackTemplate.js";
import type { FeedbackTemplate } from "../src/types/feedback.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("feedback:new creates template from latest article metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedback-template-"));
  const outputDir = join(root, "outputs");
  const feedbackDir = join(root, "feedback");

  try {
    await writeJson(join(outputDir, "article-meta.json"), {
      title: "AI 编码代理：工作流/成本？",
      wordCount: 1200,
      sourceTopic: "编码代理成本",
      articleThesis: "工作流入口之争。",
      usedClaims: [],
      riskControls: [],
      generatedAt: "2026-05-29T00:00:00.000Z"
    });
    await writeJson(join(outputDir, "selected-topic.json"), {
      selected: {
        title: "Claude Code 和 Goose 的成本冲突",
        id: "topic-id"
      }
    });
    await writeJson(join(outputDir, "wechat-api-draft-result.json"), {
      mode: "real_api",
      status: "draft_created",
      mediaId: "DRAFT_MEDIA_ID_VALUE",
      title: "AI 编码代理：工作流/成本？",
      thumbMediaIdSource: "env",
      htmlPath: "outputs/wechat.html",
      coverImagePath: "outputs/covers/cover.png",
      safety: {
        draftOnly: true,
        publishApiCalled: false,
        massSendApiCalled: false,
        requiresHumanConfirmation: true
      },
      generatedAt: "2026-05-29T00:00:00.000Z"
    });

    const result = await createFeedbackTemplate({
      outputDir,
      feedbackDir,
      runsDir: join(root, "runs"),
      logger: silentLogger,
      now: new Date("2026-05-30T00:00:00.000Z")
    });
    const saved = JSON.parse(await readFile(result.filePath, "utf8")) as FeedbackTemplate;

    assert.match(result.filePath, /2026-05-30-ai-编码代理-工作流-成本\.json$/);
    assert.equal(saved.title, "AI 编码代理：工作流/成本？");
    assert.equal(saved.topic, "Claude Code 和 Goose 的成本冲突");
    assert.equal(saved.draftMediaId, "DRAFT_MEDIA_ID_VALUE");
    assert.equal(saved.coverQuality, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feedback:new does not overwrite existing feedback file", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedback-template-existing-"));
  const outputDir = join(root, "outputs");
  const feedbackDir = join(root, "feedback");

  try {
    await writeJson(join(outputDir, "article-meta.json"), {
      title: "Already Exists",
      wordCount: 1200,
      sourceTopic: "topic",
      articleThesis: "thesis",
      usedClaims: [],
      riskControls: [],
      generatedAt: "2026-05-29T00:00:00.000Z"
    });
    await writeJson(join(feedbackDir, "2026-05-30-already-exists.json"), {
      keep: true
    });

    await assert.rejects(
      () =>
        createFeedbackTemplate({
          outputDir,
          feedbackDir,
          runsDir: join(root, "runs"),
          logger: silentLogger,
          now: new Date("2026-05-30T00:00:00.000Z")
        }),
      /will not be overwritten/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feedback title slug preserves safe Chinese characters", () => {
  assert.equal(
    createFeedbackTitleSlug("AI 编码代理：工作流/成本？"),
    "ai-编码代理-工作流-成本"
  );
});
