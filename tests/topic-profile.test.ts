import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyTopic,
  classifyTopicWithReport
} from "../src/pipeline/classifyTopic.js";
import type { LlmChatCompletionInput } from "../src/types/llm.js";
import type {
  NewsCategory,
  NewsTag,
  SelectedTopic,
  SourceReliability
} from "../src/types/news.js";
import type { Logger } from "../src/utils/logger.js";
import {
  defaultLegacyCodingAgentPollution,
  topicFixtures,
  type TopicFixture
} from "./fixtures/topicFixtures.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function newsCategoryForFixture(fixture: TopicFixture): NewsCategory {
  if (fixture.expectedPrimaryDomain === "model") {
    return "model";
  }
  if (fixture.expectedPrimaryDomain === "research") {
    return "research";
  }
  if (fixture.expectedPrimaryDomain === "policy") {
    return "policy";
  }
  if (fixture.expectedPrimaryDomain === "tooling") {
    return "tooling";
  }
  if (fixture.expectedEventTypes.includes("funding")) {
    return "funding";
  }

  return "product";
}

function tagsForFixture(fixture: TopicFixture): NewsTag[] {
  const tags: NewsTag[] = ["community"];

  if (fixture.expectedPrimaryDomain === "tooling") {
    tags.push("tooling");
  }
  if (fixture.expectedPrimaryDomain === "business") {
    tags.push("business");
  }
  if (fixture.expectedPrimaryDomain === "research") {
    tags.push("research");
  }
  if (fixture.expectedPrimaryDomain === "policy") {
    tags.push("policy");
  }
  if (fixture.expectedEventTypes.includes("launch") || fixture.expectedEventTypes.includes("update")) {
    tags.push("product");
  }

  return [...new Set(tags)];
}

function selectedTopicFromFixture(
  fixture: TopicFixture,
  sourceReliability: SourceReliability = "high"
): SelectedTopic {
  const now = "2026-07-13T00:00:00.000Z";

  return {
    selected: {
      id: fixture.id,
      title: fixture.inputTopic.title,
      titleZh: fixture.inputTopic.title,
      rawTitle: fixture.inputTopic.title,
      url: fixture.inputTopic.sourceUrl,
      sourceName: fixture.inputTopic.sourceName,
      sourceType: "rss",
      provider: "none",
      publishedAt: now,
      fetchedAt: now,
      summary: fixture.inputTopic.summary,
      summaryZh: fixture.inputTopic.summary,
      rawSummary: fixture.inputTopic.summary,
      category: newsCategoryForFixture(fixture),
      evidence: [`url: ${fixture.inputTopic.sourceUrl}`],
      duplicateKey: fixture.id,
      scores: {
        freshness: 90,
        heat: 80,
        technicalValue: 80,
        wechatTopic: 85,
        businessImpact: 70,
        controversy: 30,
        final: 80
      },
      duplicateSources: [],
      tags: tagsForFixture(fixture),
      shortlistScore: 80,
      shortlistMetrics: {
        technicalValue: 80,
        wechatTopic: 85,
        businessImpact: 70,
        controversy: 30,
        sourceCredibility: 90,
        explainability: 85,
        originality: 75
      },
      editorial: {
        shortlistReason: `${fixture.category} fixture shortlist reason.`,
        audienceFit: "普通 AI 关注者、开发者和企业决策者。",
        topicAngle: `${fixture.category}：从事实边界、风险维度和读者问题切入。`,
        recommendedUse: "main_topic_candidate"
      },
      selection: {
        selectedReason: "Fixture selected for topic profile coverage.",
        whyMostWorthWriting: fixture.inputTopic.summary,
        coreConflict: `${fixture.category} 的事实边界和读者实际影响之间的张力。`,
        publicInterest: "读者需要知道这件事是否已经确定，以及影响哪些人。",
        technicalSignificance: "需要区分原始来源事实、编辑判断和后续影响。",
        businessImpact: "可能影响团队采购、产品判断或内容生产流程。",
        predictedImpact: "后续影响取决于事实核验和实际落地范围。",
        writingAngle: `${fixture.category}：${fixture.inputTopic.summary}`,
        suggestedTitles: [`${fixture.category} 为什么值得关注`],
        articleThesis: `${fixture.category} 需要按题型建立事实边界，而不是套用旧专题结构。`,
        riskNotes: fixture.expectedRiskDimensions,
        sourceReliability,
        decisionScore: 80
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  };
}

test("classifyTopic creates distinct TopicProfiles for the 12 fixture categories", () => {
  const profiles = topicFixtures.map((fixture) => ({
    fixture,
    profile: classifyTopic(
      selectedTopicFromFixture(fixture),
      new Date("2026-07-13T00:00:00.000Z")
    )
  }));
  const domains = new Set(profiles.map(({ profile }) => profile.primaryDomain));
  const modes = new Set(profiles.map(({ profile }) => profile.recommendedContentMode));
  const eventTypes = new Set(profiles.flatMap(({ profile }) => profile.eventTypes));

  assert.ok(domains.size >= 8);
  assert.ok(modes.size >= 5);
  assert.ok(eventTypes.size >= 10);

  for (const { fixture, profile } of profiles) {
    assert.equal(profile.schemaVersion, "1.0");
    assert.equal(profile.topicId, fixture.id);
    assert.equal(profile.primaryDomain, fixture.expectedPrimaryDomain);
    assert.equal(profile.recommendedContentMode, fixture.expectedContentMode);
    for (const expectedEventType of fixture.expectedEventTypes) {
      assert.ok(
        profile.eventTypes.includes(expectedEventType),
        `${fixture.id} missing event type ${expectedEventType}`
      );
    }

    const riskOverlap = fixture.expectedRiskDimensions.filter((risk) =>
      profile.riskDimensions.includes(risk)
    );
    assert.ok(riskOverlap.length > 0, `${fixture.id} should include at least one expected risk`);
  }
});

test("non-coding fixture profiles do not inherit legacy coding-agent comparison concepts", () => {
  for (const fixture of topicFixtures) {
    const profile = classifyTopic(
      selectedTopicFromFixture(fixture),
      new Date("2026-07-13T00:00:00.000Z")
    );
    const profileText = JSON.stringify(profile);

    for (const forbidden of defaultLegacyCodingAgentPollution) {
      assert.doesNotMatch(
        profileText,
        new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${fixture.id} should not include ${forbidden}`
      );
    }
  }
});

test("classifyTopicWithReport writes topic profile outputs", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "topic-profile-"));

  try {
    const result = await classifyTopicWithReport({
      outputDir,
      topic: selectedTopicFromFixture(topicFixtures[0]),
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });

    assert.equal(result.profile.primaryDomain, topicFixtures[0].expectedPrimaryDomain);
    await access(result.files.topicProfileJson);
    await access(result.files.topicProfileReport);

    const written = JSON.parse(await readFile(result.files.topicProfileJson, "utf8")) as {
      topicId: string;
    };
    assert.equal(written.topicId, topicFixtures[0].id);

    const report = await readFile(result.files.topicProfileReport, "utf8");
    assert.match(report, /Topic Profile Report/);
    assert.match(report, /旧 TopicFactPack 继续运行/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("classifyTopicWithReport real mode uses MiniMax JSON classification", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "topic-profile-real-"));
  let called = 0;

  try {
    const result = await classifyTopicWithReport({
      outputDir,
      topic: selectedTopicFromFixture(topicFixtures[2]),
      env: {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        TOPIC_CLASSIFIER_PROVIDER: "minimax",
        TOPIC_CLASSIFIER_MODEL: "minimax-topic-test"
      },
      chatCompletion: async (input: LlmChatCompletionInput) => {
        called += 1;
        assert.equal(input.model, "minimax-topic-test");
        assert.match(input.userPrompt ?? "", /selected-topic\.json/);
        return {
          provider: "minimax",
          model: "minimax-topic-test",
          content: JSON.stringify({
            primaryDomain: "tooling",
            secondaryDomains: ["business"],
            eventTypes: ["pricing", "update"],
            entities: [{ name: "Example AI", type: "organization" }],
            targetAudiences: ["普通 AI 关注者", "企业决策者"],
            readerQuestions: ["新版价格何时生效？"],
            evidenceNeeds: ["官方价格页", "套餐说明"],
            riskDimensions: ["币种", "生效日期", "订阅与 API 差异"],
            recommendedContentMode: "comparison",
            confidence: 0.81,
            classificationReason: "价格和套餐信息明显。"
          }),
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
          finishReason: "stop",
          generatedAt: "2026-07-13T00:00:00.000Z"
        };
      },
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });

    assert.equal(called, 1);
    assert.equal(result.profile.primaryDomain, "tooling");
    assert.deepEqual(result.profile.eventTypes, ["pricing", "update"]);
    assert.equal(result.llm?.mode, "real");
    assert.equal(result.llm?.model, "minimax-topic-test");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("classifyTopicWithReport falls back to conservative other after JSON repair failure", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "topic-profile-fallback-"));
  let called = 0;

  try {
    const result = await classifyTopicWithReport({
      outputDir,
      topic: selectedTopicFromFixture(topicFixtures[4]),
      env: {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        TOPIC_CLASSIFIER_PROVIDER: "minimax",
        TOPIC_CLASSIFIER_MODEL: "minimax-topic-test"
      },
      chatCompletion: async () => {
        called += 1;
        return {
          provider: "minimax",
          model: "minimax-topic-test",
          content: called === 1 ? "not json" : JSON.stringify({ primaryDomain: "research" }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
          generatedAt: "2026-07-13T00:00:00.000Z"
        };
      },
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });

    assert.equal(called, 2);
    assert.equal(result.profile.primaryDomain, "other");
    assert.equal(result.profile.confidence, 0.2);
    assert.match(result.profile.classificationReason, /分类失败/);
    await access(join(outputDir, "llm-json-error.json"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
