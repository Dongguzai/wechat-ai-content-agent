import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTopicFactPack } from "../src/pipeline/buildTopicFactPack.js";
import type { TopicFactPack } from "../src/types/factPack.js";
import type { SelectedTopic } from "../src/types/news.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function selectedTopicFixture(sourceReliability: "high" | "medium" | "low" = "medium"): SelectedTopic {
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
        sourceReliability,
        decisionScore: 76.5
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  };
}

function assertFactPackContract(factPack: TopicFactPack): void {
  assert.ok(factPack.topicTitle);
  assert.ok(factPack.generatedAt);
  assert.notEqual(factPack.sourceReliability, "low");
  assert.ok(factPack.verifiedClaims.length >= 3);

  for (const claim of factPack.verifiedClaims) {
    assert.ok(claim.claim);
    assert.ok(claim.status);
    assert.ok(Array.isArray(claim.sourceUrls));
    assert.ok(claim.sourceUrls.length > 0);
    assert.ok(claim.safeWording);
    assert.ok(claim.risk);
  }

  assert.ok(factPack.comparison.claudeCode);
  assert.ok(factPack.comparison.goose);
  assert.ok(factPack.comparison.unsafeComparisonClaims.length >= 2);
  assert.ok(factPack.safeWritingBoundary.length >= 3);
  assert.ok(factPack.riskNotes.length >= 3);
  assert.ok(factPack.recommendedFraming);
}

test("buildTopicFactPack writes JSON and Markdown fact pack outputs", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "topic-fact-pack-"));

  try {
    const result = await buildTopicFactPack({
      outputDir,
      topic: selectedTopicFixture(),
      topicSelectionReport: "# Topic Selection Report",
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assertFactPackContract(result.factPack);
    await access(result.files.topicFactPackJson);
    await access(result.files.topicFactPackReport);

    const writtenFactPack = JSON.parse(
      await readFile(result.files.topicFactPackJson, "utf8")
    ) as TopicFactPack;
    assertFactPackContract(writtenFactPack);

    const report = await readFile(result.files.topicFactPackReport, "utf8");
    assert.match(report, /主选题/);
    assert.match(report, /已核验事实/);
    assert.match(report, /部分核验事实/);
    assert.match(report, /未核验或高风险事实/);
    assert.match(report, /Claude Code 与 Goose 对比/);
    assert.match(report, /安全写法/);
    assert.match(report, /禁止写法/);
    assert.match(report, /推荐公众号切入角度/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("buildTopicFactPack stops when selected topic source reliability is low", async () => {
  await assert.rejects(
    () =>
      buildTopicFactPack({
        topic: selectedTopicFixture("low"),
        topicSelectionReport: "# Topic Selection Report",
        writeOutputs: false,
        logger: silentLogger
      }),
    /sourceReliability is low/
  );
});
