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

function genericSelectedTopicFixture(): SelectedTopic {
  const topic = selectedTopicFixture("high");

  return {
    ...topic,
    selected: {
      ...topic.selected,
      id: "fixture-generic-agent-news",
      title: "AI 资讯：智能体工作流更新",
      rawTitle: "腾讯混元 Hy3 正式版发布：Agent 能力提升",
      titleZh: "腾讯混元 Hy3 正式版发布，智能体能力更新",
      url: "https://example.com/tencent-hunyuan-hy3-agent",
      sourceName: "Example Tech",
      sourceType: "global_search",
      provider: "exa",
      summary: "腾讯混元 Hy3 正式版发布，信息显示其智能体和工具调用能力有所更新。",
      rawSummary: "Tencent Hunyuan Hy3 release mentions agent and tool-use updates.",
      summaryZh: "腾讯混元 Hy3 正式版发布，信息显示其智能体和工具调用能力有所更新。",
      evidence: [
        "source: Example Tech",
        "url: https://example.com/tencent-hunyuan-hy3-agent"
      ],
      duplicateKey: "fixture-generic-agent-news",
      tags: ["model", "agent", "developer-workflow"],
      editorial: {
        ...topic.selected.editorial,
        topicAngle: "从模型发布看智能体工作流如何进入产品竞争。"
      },
      selection: {
        ...topic.selected.selection,
        coreConflict: "模型能力更新与真实工作流落地之间的落差。",
        publicInterest: "智能体能力更新会影响开发者和产品团队的工具选择。",
        technicalSignificance: "模型工具调用和智能体能力继续产品化。",
        businessImpact: "影响云厂商和企业 AI 工具预算。",
        predictedImpact: "开发者工作流会继续被智能体工具重塑。",
        writingAngle: "从模型发布看智能体工作流如何进入产品竞争。",
        suggestedTitles: [
          "智能体能力更新，真正要看的不是参数，是工作流",
          "模型发布越来越像工作流入口争夺",
          "AI 模型更新背后，开发者工具链又被推了一步"
        ],
        articleThesis: "智能体竞争正在从模型参数转向开发者工作流入口。",
        riskNotes: ["搜索线索需要回到原文核验。"],
        sourceReliability: "high"
      }
    }
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

test("buildTopicFactPack uses current topic facts for generic AI news", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "topic-fact-pack-generic-"));

  try {
    const result = await buildTopicFactPack({
      outputDir,
      topic: genericSelectedTopicFixture(),
      topicSelectionReport: "# Topic Selection Report",
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assertFactPackContract(result.factPack);
    assert.equal(result.factPack.topicTitle, "腾讯混元 Hy3 正式版发布，智能体能力更新");
    assert.equal(result.factPack.sourceReliability, "medium");
    assert.ok(
      result.factPack.verifiedClaims.every((claim) =>
        claim.sourceUrls.includes("https://example.com/tencent-hunyuan-hy3-agent")
      )
    );
    assert.ok(
      result.factPack.verifiedClaims.every((claim) => !claim.claim.includes("Claude Code"))
    );
    assert.ok(
      result.factPack.verifiedClaims.every((claim) => !claim.safeWording.includes("Goose"))
    );

    const written = await readFile(result.files.topicFactPackJson, "utf8");
    const report = await readFile(result.files.topicFactPackReport, "utf8");
    assert.doesNotMatch(written, /\$200|Claude Code costs|Goose does the same thing/);
    assert.match(report, /选题核验维度/);
    assert.doesNotMatch(report, /Claude Code 与 Goose 对比/);
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
