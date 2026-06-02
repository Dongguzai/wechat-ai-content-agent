import assert from "node:assert/strict";
import test from "node:test";
import { resolveLlmStageConfig } from "../src/adapters/llm.js";

test("LLM stage model prefers stage-specific env over MINIMAX_MODEL", () => {
  const config = resolveLlmStageConfig("article-writer", {
    LLM_PROVIDER: "minimax",
    LLM_ENABLE_REAL_API: "true",
    LLM_DRY_RUN: "false",
    MINIMAX_MODEL: "minimax-m3-shared",
    ARTICLE_WRITER_MODEL: "minimax-m3-writer"
  });

  assert.equal(config.model, "minimax-m3-writer");
  assert.equal(config.mode, "real");
});

test("LLM stage model falls back to MINIMAX_MODEL when stage env is unset", () => {
  const config = resolveLlmStageConfig("title-generator", {
    LLM_PROVIDER: "minimax",
    LLM_ENABLE_REAL_API: "true",
    LLM_DRY_RUN: "false",
    MINIMAX_MODEL: "minimax-m3-shared"
  });

  assert.equal(config.model, "minimax-m3-shared");
  assert.equal(config.mode, "real");
});

test("real LLM mode requires a stage model or MINIMAX_MODEL", () => {
  assert.throws(
    () =>
      resolveLlmStageConfig("article-reviewer", {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false"
      }),
    /ARTICLE_REVIEWER_MODEL or MINIMAX_MODEL/
  );
});
