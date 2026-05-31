import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTopicFactPack } from "../src/pipeline/buildTopicFactPack.js";
import {
  FORBIDDEN_TITLE_TERMS,
  generateTitlesWithReport
} from "../src/pipeline/generateTitles.js";
import { loadEditorialFeedback } from "../src/pipeline/loadEditorialFeedback.js";
import { loadEditorialStyle } from "../src/pipeline/loadEditorialStyle.js";
import { runDailyPipeline } from "../src/pipeline/runDailyPipeline.js";
import { writeArticleWithReport } from "../src/pipeline/writeArticle.js";
import type { ArticleMeta } from "../src/types/article.js";
import type { LlmChatCompletionInput } from "../src/types/llm.js";
import type { SelectedTopic } from "../src/types/news.js";
import type { TitleCandidatesFile } from "../src/types/title.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function selectedTopicFixture(): SelectedTopic {
  const now = "2026-05-29T00:00:00.000Z";

  return {
    selected: {
      id: "fixture-claude-code-goose",
      title: "Claude Code costs up to $200 a month. Goose does the same thing for free.",
      url: "https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free",
      sourceName: "VentureBeat AI",
      sourceType: "rss",
      provider: "none",
      publishedAt: now,
      fetchedAt: now,
      summary:
        "Claude Code has paid subscription paths while Goose is described as a free open source AI agent.",
      category: "tooling",
      evidence: [
        "source: VentureBeat AI",
        "url: https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free"
      ],
      duplicateKey: "fixture-claude-code-goose",
      scores: {
        freshness: 86,
        heat: 94,
        technicalValue: 98,
        wechatTopic: 98,
        businessImpact: 59,
        controversy: 30,
        final: 92.7
      },
      duplicateSources: [],
      tags: ["tooling", "open-source", "agent", "developer-workflow", "model"],
      shortlistScore: 81.9,
      shortlistMetrics: {
        technicalValue: 98,
        wechatTopic: 98,
        businessImpact: 59,
        controversy: 30,
        sourceCredibility: 82,
        explainability: 79,
        originality: 84
      },
      editorial: {
        shortlistReason: "Fixture shortlist reason.",
        audienceFit: "开发者和技术团队。",
        topicAngle:
          "表面上是 Claude Code 与 Goose 的价格对比，真正的问题是编码代理会不会从昂贵订阅走向开源替代。",
        recommendedUse: "main_topic_candidate"
      },
      selection: {
        selectedReason: "Fixture selection reason.",
        whyMostWorthWriting: "Fixture why most worth writing.",
        coreConflict: "闭源高价编码代理和免费开源替代之间的冲突。",
        publicInterest: "价格差异直观。",
        technicalSignificance: "coding agent 工作流变化。",
        businessImpact: "影响团队工具预算。",
        predictedImpact: "开源 agent 会成为成本对冲。",
        writingAngle: "从工作流和总成本分析。",
        suggestedTitles: [
          "AI 编码代理真正卷到的，不是价格，而是工作流",
          "Claude Code 很贵，Goose 免费：开发者为什么开始重新算账",
          "这次开源不是热闹，是编码代理的护城河开始松动"
        ],
        articleThesis: "编码代理竞争正在从模型能力转向工作流控制权。",
        riskNotes: ["需要核验官方价格。"],
        sourceReliability: "medium",
        decisionScore: 76.5
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  };
}

async function createArticleFixture(outputDir: string): Promise<SelectedTopic> {
  const topic = selectedTopicFixture();
  await writeFile(
    join(outputDir, "selected-topic.json"),
    `${JSON.stringify(topic, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(outputDir, "topic-selection-report.md"),
    "# Topic Selection Report\n",
    "utf8"
  );
  const factPack = await buildTopicFactPack({
    outputDir,
    topic,
    topicSelectionReport: "# Topic Selection Report",
    logger: silentLogger,
    now: new Date("2026-05-29T00:00:00.000Z")
  });
  await writeArticleWithReport({
    outputDir,
    topic,
    factPack: factPack.factPack,
    topicSelectionReport: "# Topic Selection Report",
    topicFactPackReport: "# Topic Fact Pack",
    logger: silentLogger,
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  return topic;
}

test("editorial-style file exists and can be read", async () => {
  const style = await loadEditorialStyle({ logger: silentLogger });

  assert.equal(style.loaded, true);
  assert.match(style.content, /第三视角/);
  assert.match(style.content, /冲突切入/);
  await access(style.path);
});

test("generateTitlesWithReport creates 5 safe candidates and writes final title to article-meta", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "title-generator-"));

  try {
    await createArticleFixture(outputDir);
    const feedback = await loadEditorialFeedback({
      feedbackDir: join(outputDir, "missing-feedback"),
      logger: silentLogger
    });
    const result = await generateTitlesWithReport({
      outputDir,
      feedback,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.candidates.length, 5);
    assert.equal(result.selection.feedbackRead, false);
    await access(result.files.titleCandidates);
    await access(result.files.titleSelectionReport);

    const writtenCandidates = JSON.parse(
      await readFile(result.files.titleCandidates, "utf8")
    ) as TitleCandidatesFile;
    assert.equal(writtenCandidates.candidates.length, 5);
    assert.equal(writtenCandidates.llm.provider, "minimax");
    assert.equal(writtenCandidates.llm.mode, "mock");

    for (const candidate of writtenCandidates.candidates) {
      assert.equal(typeof candidate.spreadScore, "number");
      assert.equal(typeof candidate.accuracyScore, "number");
      assert.equal(typeof candidate.nonClickbaitScore, "number");
      assert.equal(typeof candidate.wechatFitScore, "number");
      assert.equal(typeof candidate.thesisMatchScore, "number");
      assert.equal(typeof candidate.finalScore, "number");
      assert.deepEqual(candidate.violations, []);

      for (const term of FORBIDDEN_TITLE_TERMS) {
        assert.equal(
          candidate.title.includes(term),
          false,
          `candidate contains forbidden term ${term}: ${candidate.title}`
        );
      }
    }

    const meta = JSON.parse(
      await readFile(join(outputDir, "article-meta.json"), "utf8")
    ) as ArticleMeta;
    const article = await readFile(join(outputDir, "article.md"), "utf8");
    const report = await readFile(result.files.titleSelectionReport, "utf8");

    assert.equal(meta.title, result.selection.selectedTitle);
    assert.equal(article.split(/\r?\n/, 1)[0].trim(), result.selection.selectedTitle);
    assert.match(report, /最终标题/);
    assert.match(report, /选择理由/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generateTitlesWithReport real mode calls MiniMax and records title llm usage", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "title-generator-real-"));
  let called = 0;

  try {
    await createArticleFixture(outputDir);
    const feedback = await loadEditorialFeedback({
      feedbackDir: join(outputDir, "missing-feedback"),
      logger: silentLogger
    });
    const result = await generateTitlesWithReport({
      outputDir,
      feedback,
      env: {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        TITLE_GENERATOR_PROVIDER: "minimax",
        TITLE_GENERATOR_MODEL: "MiniMax-M2.7"
      },
      chatCompletion: async (input: LlmChatCompletionInput) => {
        called += 1;
        assert.equal(input.model, "MiniMax-M2.7");
        assert.match(input.userPrompt ?? "", /article\.md/);
        return {
          provider: "minimax",
          model: "MiniMax-M2.7",
          content: JSON.stringify({
            candidates: [
              {
                kind: "judgement",
                title: "AI 编码代理真正卷到的，不是价格，而是工作流",
                rationale: "判断明确。"
              },
              {
                kind: "contrast",
                title: "Claude Code 和 Goose 的分歧，不止在价格",
                rationale: "保留反差。"
              },
              {
                kind: "trend",
                title: "编码代理开始从付费产品走向开源基础设施",
                rationale: "趋势表达。"
              },
              {
                kind: "publicImpact",
                title: "AI 写代码变成账单后，团队要重新算成本",
                rationale: "人群影响。"
              },
              {
                kind: "techDiscussion",
                title: "开发者争论 Goose，背后是工作流入口之争",
                rationale: "技术圈讨论。"
              }
            ]
          }),
          usage: {
            promptTokens: 77,
            completionTokens: 55,
            totalTokens: 132
          },
          finishReason: "stop",
          generatedAt: "2026-05-29T00:00:00.000Z"
        };
      },
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    const writtenCandidates = JSON.parse(
      await readFile(result.files.titleCandidates, "utf8")
    ) as TitleCandidatesFile;

    assert.equal(called, 1);
    assert.equal(result.candidates.length, 5);
    assert.equal(result.selection.llm?.mode, "real");
    assert.equal(writtenCandidates.llm.mode, "real");
    assert.deepEqual(writtenCandidates.llm.usage, {
      promptTokens: 77,
      completionTokens: 55,
      totalTokens: 132
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("feedback missing does not fail the loader", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedback-missing-"));

  try {
    const result = await loadEditorialFeedback({
      feedbackDir: join(root, "feedback"),
      logger: silentLogger
    });

    assert.equal(result.feedbackRead, false);
    assert.equal(result.latest, undefined);
    assert.deepEqual(result.skippedFiles, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manual-topic takes priority and still runs fact pack and article review", async () => {
  const root = await mkdtemp(join(tmpdir(), "manual-topic-flow-"));
  const outputDir = join(root, "outputs");
  const manualTopicFile = join(root, "inputs", "manual-topic.md");

  try {
    await mkdir(join(root, "inputs"), { recursive: true });
    await writeFile(
      manualTopicFile,
      [
        "# Claude Code 和 Goose 的成本冲突，值得重新写一遍",
        "",
        "Source URL: https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free",
        "Source Name: VentureBeat AI",
        "Angle: 从工作流、成本和开源基础设施的角度分析。",
        "Thesis: 编码代理竞争正在从模型能力转向工作流控制权。",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runDailyPipeline({
      outputDir,
      manualTopicFile,
      useMockRss: true,
      logger: silentLogger,
      env: {
        SEARCH_ENABLE_REAL_API: "false",
        WECHAT_DRAFT_DRY_RUN: "true",
        WECHAT_API_ENABLE_REAL_DRAFT: "false",
        WECHAT_DRAFT_ALLOW_REAL_API: "false"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.artifacts.manualTopic.used, true);
    assert.equal(result.artifacts.selectedTopic.selected.sourceType, "manual");
    assert.ok(result.artifacts.topicFactPack.verifiedClaims.length >= 3);
    assert.equal(result.artifacts.articleReview.passed, true);

    const report = await readFile(result.files.dailyReport, "utf8");
    assert.match(report, /Manual topic used: yes/);
    assert.match(report, /Title candidates generated: 5/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
