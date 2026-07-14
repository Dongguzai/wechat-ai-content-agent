import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildResearchPlan } from "../src/pipeline/buildResearchPlan.js";
import { collectSourceEvidence } from "../src/pipeline/collectSourceEvidence.js";
import type { SelectedTopic } from "../src/types/news.js";
import type { TopicProfile } from "../src/types/topicProfile.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function profile(overrides: Partial<TopicProfile>): TopicProfile {
  return {
    schemaVersion: "1.0",
    id: "topic-profile-test",
    topicId: "topic-test",
    primaryDomain: "product",
    secondaryDomains: [],
    eventTypes: ["launch"],
    entities: [],
    targetAudiences: ["普通 AI 关注者"],
    readerQuestions: ["这件事是否正式发布？"],
    evidenceNeeds: ["官方公告", "原始来源"],
    riskDimensions: ["可用范围", "功能边界"],
    recommendedContentMode: "news_analysis",
    confidence: 0.7,
    classificationReason: "test profile",
    generatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides
  };
}

function selectedTopic(sourceType: SelectedTopic["selected"]["sourceType"] = "rss"): SelectedTopic {
  const now = "2026-07-13T00:00:00.000Z";

  return {
    selected: {
      id: "topic-test",
      title: "Example AI 发布新产品",
      titleZh: "Example AI 发布新产品",
      rawTitle: "Example AI launches a new product",
      url:
        sourceType === "global_search"
          ? "https://search.example.com/result"
          : "https://example.ai/releases/new-product",
      sourceName: sourceType === "global_search" ? "Exa Search" : "Example AI",
      sourceType,
      provider: sourceType === "global_search" ? "exa" : "none",
      publishedAt: now,
      fetchedAt: now,
      summary: "官方公告介绍发布时间、可用范围和功能边界。",
      category: "product",
      evidence: [
        sourceType === "global_search"
          ? "search result: https://search.example.com/result"
          : "official source: https://example.ai/releases/new-product"
      ],
      duplicateKey: "topic-test",
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
      tags: ["product"],
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
        shortlistReason: "test shortlist",
        audienceFit: "普通 AI 关注者",
        topicAngle: "从产品发布边界切入。",
        recommendedUse: "main_topic_candidate"
      },
      selection: {
        selectedReason: "test selection",
        whyMostWorthWriting: "test",
        coreConflict: "发布信息和真实可用边界之间的差异。",
        publicInterest: "用户关心是否可用。",
        technicalSignificance: "test",
        businessImpact: "test",
        predictedImpact: "test",
        writingAngle: "从发布边界切入。",
        suggestedTitles: ["Example AI 发布新产品"],
        articleThesis: "产品发布需要先核验可用范围。",
        riskNotes: ["可用范围"],
        sourceReliability: "high",
        decisionScore: 80
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  };
}

test("buildResearchPlan creates different tasks for product, benchmark, pricing, funding, regulation, and incident topics", async () => {
  const cases = [
    {
      name: "product",
      profile: profile({
        primaryDomain: "product",
        eventTypes: ["launch"],
        riskDimensions: ["可用范围", "开放对象", "功能边界"]
      }),
      expectedTask: "research-task-launch"
    },
    {
      name: "benchmark",
      profile: profile({
        primaryDomain: "research",
        eventTypes: ["benchmark"],
        riskDimensions: ["指标定义", "测试条件", "厂商自测", "第三方复现"]
      }),
      expectedTask: "research-task-benchmark"
    },
    {
      name: "pricing",
      profile: profile({
        primaryDomain: "tooling",
        eventTypes: ["pricing"],
        riskDimensions: ["币种", "生效日期", "订阅与 API 差异", "免费层边界"]
      }),
      expectedTask: "research-task-pricing"
    },
    {
      name: "funding",
      profile: profile({
        primaryDomain: "business",
        eventTypes: ["funding"],
        riskDimensions: ["融资金额", "轮次", "投资方", "估值确认状态"]
      }),
      expectedTask: "research-task-funding"
    },
    {
      name: "regulation",
      profile: profile({
        primaryDomain: "policy",
        eventTypes: ["regulation"],
        riskDimensions: ["司法辖区", "生效时间", "适用对象", "实际义务"]
      }),
      expectedTask: "research-task-regulation"
    },
    {
      name: "incident",
      profile: profile({
        primaryDomain: "security",
        eventTypes: ["incident"],
        riskDimensions: ["影响范围", "披露时间线", "用户数据类型", "修复状态"]
      }),
      expectedTask: "research-task-incident"
    }
  ];

  for (const item of cases) {
    const result = await buildResearchPlan({
      topicProfile: item.profile,
      writeOutputs: false,
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });

    assert.ok(
      result.plan.tasks.some((task) => task.id === item.expectedTask),
      `${item.name} should include ${item.expectedTask}`
    );
    assert.ok(result.plan.tasks.some((task) => task.id === "research-task-source-boundary"));
    assert.ok(result.plan.policyRefs.length > 0);
  }
});

test("buildResearchPlan writes JSON and report with policy traceability", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "research-plan-"));

  try {
    const result = await buildResearchPlan({
      outputDir,
      topicProfile: profile({
        primaryDomain: "tooling",
        eventTypes: ["pricing", "update"],
        riskDimensions: ["币种", "生效日期", "订阅与 API 差异", "免费层边界"]
      }),
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });

    await access(result.files.researchPlanJson);
    await access(result.files.researchPlanReport);
    assert.ok(result.plan.policyRefs.some((policy) => policy.id === "pricing"));

    const report = await readFile(result.files.researchPlanReport, "utf8");
    assert.match(report, /Research Plan/);
    assert.match(report, /research:pricing@1\.0/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("collectSourceEvidence keeps search leads metadata-only and unable to verify claims", async () => {
  const plan = (
    await buildResearchPlan({
      topicProfile: profile({
        primaryDomain: "product",
        eventTypes: ["launch"],
        riskDimensions: ["可用范围", "功能边界"]
      }),
      writeOutputs: false,
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    })
  ).plan;

  const result = await collectSourceEvidence({
    selectedTopic: selectedTopic("global_search"),
    researchPlan: plan,
    writeOutputs: false,
    logger: silentLogger,
    now: new Date("2026-07-13T00:00:00.000Z")
  });

  assert.equal(result.evidence.collectionMode, "metadata_only");
  assert.ok(result.evidence.items.length > 0);
  assert.ok(
    result.evidence.items.every((item) => item.kind === "search_lead")
  );
  assert.ok(
    result.evidence.items.every((item) => item.canSupportVerifiedClaim === false)
  );
  assert.ok(result.evidence.unsupportedReasons.some((reason) => reason.includes("search_lead")));
});

test("collectSourceEvidence blocks localhost and private source URLs before fetch", async () => {
  const topic = selectedTopic("rss");
  topic.selected.url = "http://127.0.0.1/internal";
  topic.selected.evidence = ["official source: http://127.0.0.1/internal"];
  const plan = (
    await buildResearchPlan({
      topicProfile: profile({
        primaryDomain: "product",
        eventTypes: ["launch"],
        riskDimensions: ["可用范围", "功能边界"]
      }),
      writeOutputs: false,
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    })
  ).plan;
  let fetched = false;

  const result = await collectSourceEvidence({
    selectedTopic: topic,
    researchPlan: plan,
    writeOutputs: false,
    logger: silentLogger,
    fetchImpl: async () => {
      fetched = true;
      return new Response("should not fetch");
    },
    now: new Date("2026-07-13T00:00:00.000Z")
  });

  assert.equal(fetched, false);
  assert.ok(result.evidence.items.every((item) => item.extractionStatus === "blocked"));
  assert.ok(result.evidence.items.every((item) => item.usableAsEvidence === false));
});

test("collectSourceEvidence writes extracted snippets for original URLs when body evidence is available", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "source-evidence-"));
  const plan = (
    await buildResearchPlan({
      topicProfile: profile({
        primaryDomain: "product",
        eventTypes: ["launch"],
        riskDimensions: ["可用范围", "功能边界"]
      }),
      writeOutputs: false,
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    })
  ).plan;

  try {
    const result = await collectSourceEvidence({
      outputDir,
      selectedTopic: selectedTopic("rss"),
      researchPlan: plan,
      logger: silentLogger,
      fetchImpl: async () =>
        new Response(
          `<!doctype html><html><head><title>OpenAI launches a new agent tool</title><meta property="article:published_time" content="2026-07-12T00:00:00Z"></head><body><article><p>OpenAI 发布了一项新的 agent 工具，重点涉及可用范围、功能边界和开发者工作流。</p><p>这段正文用于支持调研任务，但仍需要保留事实边界和限定语。</p></article></body></html>`,
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" }
          }
        ),
      now: new Date("2026-07-13T00:00:00.000Z")
    });

    await access(result.files.sourceEvidenceJson);
    await access(result.files.sourceEvidenceReport);
    assert.ok(result.evidence.items.some((item) => item.kind === "official_source"));
    assert.ok(
      result.evidence.items.some((item) => item.extractionStatus === "success")
    );
    assert.ok(
      result.evidence.items.some((item) => item.usableAsEvidence === true)
    );
    assert.ok(result.evidence.items.some((item) => item.evidenceSnippets.length > 0));

    const report = await readFile(result.files.sourceEvidenceReport, "utf8");
    assert.match(report, /extractionStatus: success|snippetCount:/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
