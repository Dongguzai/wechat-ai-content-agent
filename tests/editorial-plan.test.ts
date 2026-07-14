import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildEditorialPlan } from "../src/pipeline/buildEditorialPlan.js";
import { buildResearchPlan } from "../src/pipeline/buildResearchPlan.js";
import type { TopicFactPack } from "../src/types/factPack.js";
import type { SelectedTopic } from "../src/types/news.js";
import type { TopicProfile } from "../src/types/topicProfile.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function selectedTopic(): SelectedTopic {
  const now = "2026-07-13T00:00:00.000Z";

  return {
    selected: {
      id: "topic-editorial-plan",
      title: "Example AI 调整产品价格和能力边界",
      titleZh: "Example AI 调整产品价格和能力边界",
      rawTitle: "Example AI updates pricing and product limits",
      url: "https://example.ai/pricing-update",
      sourceName: "Example AI",
      sourceType: "rss",
      provider: "none",
      publishedAt: now,
      fetchedAt: now,
      summary: "公告介绍价格、能力边界和不同用户影响。",
      summaryZh: "公告介绍价格、能力边界和不同用户影响。",
      rawSummary: "Pricing and product limits changed.",
      category: "tooling",
      evidence: ["url: https://example.ai/pricing-update"],
      duplicateKey: "topic-editorial-plan",
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
      tags: ["tooling"],
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
        topicAngle: "从事实边界切入。",
        recommendedUse: "main_topic_candidate"
      },
      selection: {
        selectedReason: "test selection",
        whyMostWorthWriting: "test",
        coreConflict: "公告信息和用户实际成本之间的差异。",
        publicInterest: "用户关心是否涨价以及适用范围。",
        technicalSignificance: "需要区分能力边界和编辑判断。",
        businessImpact: "影响团队采购和工具选择。",
        predictedImpact: "后续影响取决于真实使用成本。",
        writingAngle: "从价格边界和用户影响切入。",
        suggestedTitles: ["Example AI 价格调整，真正要看边界"],
        articleThesis: "价格调整需要先核验适用对象和计费边界。",
        riskNotes: ["币种", "免费层边界"],
        sourceReliability: "high",
        decisionScore: 80
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  };
}

function profile(overrides: Partial<TopicProfile>): TopicProfile {
  return {
    schemaVersion: "1.0",
    id: "topic-profile-editorial-plan",
    topicId: "topic-editorial-plan",
    primaryDomain: "tooling",
    secondaryDomains: [],
    eventTypes: ["pricing"],
    entities: [],
    targetAudiences: ["普通 AI 关注者"],
    readerQuestions: ["这件事影响哪些用户？"],
    evidenceNeeds: ["官方公告", "价格页"],
    riskDimensions: ["币种", "生效日期", "订阅与 API 差异", "免费层边界"],
    recommendedContentMode: "comparison",
    confidence: 0.8,
    classificationReason: "test profile",
    generatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides
  };
}

function factPack(): TopicFactPack {
  const claims = [
    {
      id: "claim-source-topic",
      statement: "当前选题来自 Example AI 官方公告。",
      status: "partially_verified" as const,
      evidenceIds: ["evidence-1"],
      sourceUrls: ["https://example.ai/pricing-update"],
      confidence: 0.55,
      safeWording: "可以写 Example AI 的公告显示这是一条价格和能力边界更新，但仍需回到原文核验。",
      requiredQualifiers: ["据公告显示"],
      forbiddenWording: ["全面涨价", "永久免费"],
      riskDimensions: ["来源可靠性"]
    },
    {
      id: "claim-topic-summary",
      statement: "公告介绍价格、能力边界和不同用户影响。",
      status: "partially_verified" as const,
      evidenceIds: ["evidence-1"],
      sourceUrls: ["https://example.ai/pricing-update"],
      confidence: 0.55,
      safeWording: "可以概括为价格、能力边界和用户影响，但不能补写未核验套餐数字。",
      requiredQualifiers: ["可以概括为"],
      forbiddenWording: ["所有用户都涨价"],
      riskDimensions: ["事实边界"]
    },
    {
      id: "claim-pricing-boundary",
      statement: "价格变化需要核验币种、周期、订阅和 API 差异。",
      status: "unverified" as const,
      evidenceIds: ["evidence-1"],
      sourceUrls: ["https://example.ai/pricing-update"],
      confidence: 0.25,
      safeWording: "写价格时必须同时说明币种、周期、免费层和额外用量仍待核验。",
      requiredQualifiers: ["仍待核验"],
      forbiddenWording: ["零成本"],
      riskDimensions: ["币种", "免费层边界"]
    },
    {
      id: "claim-benchmark-boundary",
      statement: "benchmark 结果需要核验指标、测试条件和第三方复现。",
      status: "unverified" as const,
      evidenceIds: ["evidence-1"],
      sourceUrls: ["https://example.ai/pricing-update"],
      confidence: 0.25,
      safeWording: "写 benchmark 时必须绑定具体指标、测试条件和复现状态。",
      requiredQualifiers: ["测试条件"],
      forbiddenWording: ["全面领先"],
      riskDimensions: ["指标定义", "测试条件", "第三方复现"]
    },
    {
      id: "claim-policy-boundary",
      statement: "政策题需要核验司法辖区、生效时间和实际义务。",
      status: "unverified" as const,
      evidenceIds: ["evidence-1"],
      sourceUrls: ["https://example.ai/pricing-update"],
      confidence: 0.25,
      safeWording: "写政策时必须限定地区、适用对象和实际义务。",
      requiredQualifiers: ["限定地区"],
      forbiddenWording: ["所有地区都必须"],
      riskDimensions: ["司法辖区", "实际义务"]
    }
  ];

  return {
    schemaVersion: "2.0",
    topicId: "topic-editorial-plan",
    topicTitle: "Example AI 调整产品价格和能力边界",
    generatedAt: "2026-07-13T00:00:00.000Z",
    entities: [],
    sourceReliability: "medium",
    sourceReliabilityReason: "测试夹具。",
    claims,
    unsupportedClaims: claims.filter((claim) => claim.status === "unverified"),
    conflictingClaims: [],
    verifiedClaims: claims.map((claim) => ({
      id: claim.id,
      claim: claim.statement,
      status: claim.status,
      sourceUrls: claim.sourceUrls,
      safeWording: claim.safeWording,
      risk: claim.status === "unverified" ? "high" : "medium",
      evidenceIds: claim.evidenceIds,
      confidence: claim.confidence,
      requiredQualifiers: claim.requiredQualifiers,
      forbiddenWording: claim.forbiddenWording,
      riskDimensions: claim.riskDimensions
    })),
    safeWritingBoundary: ["只能使用测试 fact pack。"],
    riskNotes: ["不要补写 fact pack 外的数字。"],
    recommendedFraming: "从价格边界和用户影响切入。",
    articleAngleSuggestions: ["从价格边界和用户影响切入。"],
    sourceEvidenceIds: ["evidence-1"]
  };
}

test("buildEditorialPlan creates event-specific section structures with claim maps", async () => {
  const cases = [
    {
      name: "pricing",
      profile: profile({ eventTypes: ["pricing"], primaryDomain: "tooling" }),
      expectedHeading: /价格变化到底改了什么/,
      expectedPolicy: "pricing"
    },
    {
      name: "benchmark",
      profile: profile({
        primaryDomain: "research",
        eventTypes: ["benchmark"],
        riskDimensions: ["指标定义", "测试条件", "厂商自测", "第三方复现"]
      }),
      expectedHeading: /先看测试条件/,
      expectedPolicy: "model-benchmark"
    },
    {
      name: "regulation",
      profile: profile({
        primaryDomain: "policy",
        eventTypes: ["regulation"],
        riskDimensions: ["司法辖区", "生效时间", "适用对象", "实际义务"]
      }),
      expectedHeading: /适用谁、何时生效/,
      expectedPolicy: "regulation"
    }
  ];

  for (const item of cases) {
    const researchPlan = await buildResearchPlan({
      topicProfile: item.profile,
      writeOutputs: false,
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });
    const result = await buildEditorialPlan({
      topic: selectedTopic(),
      topicProfile: item.profile,
      researchPlan: researchPlan.plan,
      factPack: factPack(),
      writeOutputs: false,
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });
    const headings = result.plan.sections.map((section) => section.heading).join("\n");
    const claimIds = new Set(factPack().claims.map((claim) => claim.id));

    assert.match(headings, item.expectedHeading, `${item.name} should use event structure`);
    assert.ok(result.plan.policyRefs.some((policy) => policy.id === item.expectedPolicy));
    assert.ok(result.plan.sections.length >= 3);
    for (const section of result.plan.sections) {
      assert.ok(section.allowedClaimIds.length > 0);
      assert.ok(section.allowedClaimIds.every((id) => claimIds.has(id)));
    }
  }
});

test("buildEditorialPlan writes JSON and Markdown report", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "editorial-plan-"));
  const topicProfile = profile({ eventTypes: ["pricing"], primaryDomain: "tooling" });
  const researchPlan = await buildResearchPlan({
    topicProfile,
    writeOutputs: false,
    logger: silentLogger,
    now: new Date("2026-07-13T00:00:00.000Z")
  });

  try {
    const result = await buildEditorialPlan({
      outputDir,
      topic: selectedTopic(),
      topicProfile,
      researchPlan: researchPlan.plan,
      factPack: factPack(),
      logger: silentLogger,
      now: new Date("2026-07-13T00:00:00.000Z")
    });

    await access(result.files.editorialPlanJson);
    await access(result.files.editorialPlanReport);
    assert.ok(result.plan.forbiddenWording.includes("永久免费"));
    assert.ok(result.plan.requiredThemes.includes("价格"));

    const report = await readFile(result.files.editorialPlanReport, "utf8");
    assert.match(report, /Editorial Plan/);
    assert.match(report, /allowedClaimIds/);
    assert.match(report, /pricing@1\.0/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
