import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolvePoliciesForProfile } from "../src/config/policyRegistry.js";
import { buildTopicFactPack } from "../src/pipeline/buildTopicFactPack.js";
import {
  reviewArticle,
  reviewArticleWithReport
} from "../src/pipeline/reviewArticle.js";
import { writeArticleWithReport } from "../src/pipeline/writeArticle.js";
import type { ArticleMeta, ArticleReviewResult } from "../src/types/article.js";
import type { TopicFactPack } from "../src/types/factPack.js";
import type { LlmChatCompletionInput } from "../src/types/llm.js";
import type { SelectedTopic } from "../src/types/news.js";
import type { TopicProfile } from "../src/types/topicProfile.js";
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
      title: "Claude Code costs up to $200 a month. Goose does the same thing for free.",
      url: "https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free",
      sourceName: "VentureBeat AI",
      selection: {
        suggestedTitles: [
          "AI 编码代理真正卷到的，不是价格，而是工作流",
          "Claude Code 很贵，Goose 免费：开发者为什么开始重新算账",
          "这次开源不是热闹，是编码代理的护城河开始松动"
        ],
        articleThesis: "编码代理竞争正在从模型能力转向工作流控制权。",
        sourceReliability: "medium"
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  } as unknown as SelectedTopic;
}

async function createReviewFixture(outputDir: string): Promise<{
  topic: SelectedTopic;
  factPack: TopicFactPack;
  articleMarkdown: string;
  articleMeta: ArticleMeta;
}> {
  const topic = selectedTopicFixture();
  await writeFile(
    join(outputDir, "selected-topic.json"),
    `${JSON.stringify(topic, null, 2)}\n`,
    "utf8"
  );
  const factPackResult = await buildTopicFactPack({
    outputDir,
    topic,
    topicSelectionReport: "# Topic Selection Report",
    logger: silentLogger,
    now: new Date("2026-05-29T00:00:00.000Z")
  });
  const articleResult = await writeArticleWithReport({
    outputDir,
    topic,
    factPack: factPackResult.factPack,
    topicSelectionReport: "# Topic Selection Report",
    topicFactPackReport: "# Topic Fact Pack",
    logger: silentLogger,
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  return {
    topic,
    factPack: factPackResult.factPack,
    articleMarkdown: articleResult.article.markdown,
    articleMeta: articleResult.meta
  };
}

function validAuxiliaryReviewPayload(): Record<string, unknown> {
  return {
    passed: true,
    score: 92,
    summary: "MiniMax auxiliary review passed.",
    issues: [],
    factBoundaryCheck: {
      passed: true,
      violations: []
    },
    qualityCheck: {
      wordCountOk: true,
      hasTitle: true,
      hasHeadings: true,
      thirdPersonPerspective: true,
      notNewsRelease: true,
      themesCovered: ["开源", "工作流", "成本"]
    }
  };
}

function assertReviewContract(review: ArticleReviewResult): void {
  assert.equal(typeof review.passed, "boolean");
  assert.equal(typeof review.score, "number");
  assert.ok(review.score >= 0);
  assert.ok(review.score <= 100);
  assert.ok(Array.isArray(review.issues));
  assert.ok(Array.isArray(review.reviewPolicies ?? []));
  for (const issue of review.issues) {
    assert.ok(issue.ruleId);
    assert.ok(issue.source);
    assert.equal(typeof issue.blocking, "boolean");
  }
  assert.ok(review.factBoundaryCheck);
  assert.equal(typeof review.factBoundaryCheck.passed, "boolean");
  assert.ok(Array.isArray(review.factBoundaryCheck.violations));
  assert.ok(review.qualityCheck);
  assert.equal(typeof review.qualityCheck.wordCountOk, "boolean");
  assert.ok(Array.isArray(review.qualityCheck.themesCovered));
  assert.ok(review.finalVerdict);
  assert.ok(review.generatedAt);
}

test("reviewArticleWithReport writes review JSON and Markdown report", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-reviewer-"));

  try {
    await createReviewFixture(outputDir);

    const result = await reviewArticleWithReport({
      outputDir,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await access(result.files.articleReview);
    await access(result.files.articleReviewReport);
    assertReviewContract(result.review);
    assert.equal(result.review.passed, true);
    assert.ok(result.review.score >= 80);

    const writtenReview = JSON.parse(
      await readFile(result.files.articleReview, "utf8")
    ) as ArticleReviewResult;
    assertReviewContract(writtenReview);
    assert.equal(writtenReview.llm?.provider, "minimax");
    assert.equal(writtenReview.llm?.mode, "mock");

    const report = await readFile(result.files.articleReviewReport, "utf8");
    assert.match(report, /审核结论/);
    assert.match(report, /总分/);
    assert.match(report, /是否通过/);
    assert.match(report, /主要优点/);
    assert.match(report, /发现的问题/);
    assert.match(report, /必修修改项/);
    assert.match(report, /可选优化建议/);
    assert.match(report, /fact pack 边界检查结果/);
    assert.match(report, /是否允许进入下一阶段/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("reviewArticleWithReport real mode calls MiniMax but hard rules still block forbidden terms", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-reviewer-real-"));
  let called = 0;

  try {
    const fixture = await createReviewFixture(outputDir);
    const result = await reviewArticleWithReport({
      outputDir,
      articleMarkdown: `${fixture.articleMarkdown}\n\nGoose 完全替代 Claude Code。`,
      articleMeta: fixture.articleMeta,
      factPack: fixture.factPack,
      selectedTopic: fixture.topic,
      topicFactPackReport: "# Topic Fact Pack",
      env: {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        ARTICLE_REVIEWER_PROVIDER: "minimax",
        ARTICLE_REVIEWER_MODEL: "minimax-m3-test"
      },
      chatCompletion: async (input: LlmChatCompletionInput) => {
        called += 1;
        assert.equal(input.model, "minimax-m3-test");
        assert.match(input.userPrompt ?? "", /article-meta\.json/);
        return {
          provider: "minimax",
          model: "minimax-m3-test",
          content: JSON.stringify({
            passed: true,
            score: 99,
            summary: "MiniMax auxiliary review passed.",
            issues: [],
            factBoundaryCheck: {
              passed: true,
              violations: []
            },
            qualityCheck: {
              wordCountOk: true,
              hasTitle: true,
              hasHeadings: true,
              thirdPersonPerspective: true,
              notNewsRelease: true,
              themesCovered: ["开源", "工作流", "成本"]
            }
          }),
          usage: {
            promptTokens: 91,
            completionTokens: 34,
            totalTokens: 125
          },
          finishReason: "stop",
          generatedAt: "2026-05-29T00:00:00.000Z"
        };
      },
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(called, 1);
    assert.equal(result.review.passed, false);
    assert.equal(result.review.factBoundaryCheck.passed, false);
    assert.equal(result.review.llm?.mode, "rules+real");
    assert.deepEqual(result.review.llm?.usage, {
      promptTokens: 91,
      completionTokens: 34,
      totalTokens: 125
    });
    assert.ok(
      result.review.issues.some((issue) => issue.evidence.includes("完全替代"))
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("reviewArticleWithReport real mode parses MiniMax explanation plus JSON", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-reviewer-explained-json-"));
  let called = 0;

  try {
    const fixture = await createReviewFixture(outputDir);
    const result = await reviewArticleWithReport({
      outputDir,
      articleMarkdown: fixture.articleMarkdown,
      articleMeta: fixture.articleMeta,
      factPack: fixture.factPack,
      selectedTopic: fixture.topic,
      topicFactPackReport: "# Topic Fact Pack",
      env: {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        ARTICLE_REVIEWER_PROVIDER: "minimax",
        ARTICLE_REVIEWER_MODEL: "minimax-m3-test"
      },
      chatCompletion: async () => {
        called += 1;
        return {
          provider: "minimax",
          model: "minimax-m3-test",
          content: `好的，以下是审稿结果：\n${JSON.stringify(validAuxiliaryReviewPayload())}`,
          usage: {
            promptTokens: 91,
            completionTokens: 34,
            totalTokens: 125
          },
          finishReason: "stop",
          generatedAt: "2026-05-29T00:00:00.000Z"
        };
      },
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(called, 1);
    assert.equal(result.review.llm?.mode, "rules+real");
    assert.equal(result.review.passed, true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("reviewArticle fails when the article says Goose completely replaces Claude Code", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-reviewer-"));

  try {
    const fixture = await createReviewFixture(outputDir);
    const review = reviewArticle(
      {
        articleMarkdown: `${fixture.articleMarkdown}\n\nGoose 完全替代 Claude Code。`,
        articleMeta: fixture.articleMeta,
        factPack: fixture.factPack,
        selectedTopic: fixture.topic
      },
      { now: new Date("2026-05-29T00:00:00.000Z") }
    );

    assertReviewContract(review);
    assert.equal(review.passed, false);
    assert.equal(review.factBoundaryCheck.passed, false);
    assert.ok(
      review.issues.some(
        (issue) => issue.severity === "high" && issue.evidence.includes("完全替代")
      )
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("reviewArticle fails when the article says Goose has zero cost", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-reviewer-"));

  try {
    const fixture = await createReviewFixture(outputDir);
    const review = reviewArticle(
      {
        articleMarkdown: `${fixture.articleMarkdown}\n\nGoose 零成本。`,
        articleMeta: fixture.articleMeta,
        factPack: fixture.factPack,
        selectedTopic: fixture.topic
      },
      { now: new Date("2026-05-29T00:00:00.000Z") }
    );

    assertReviewContract(review);
    assert.equal(review.passed, false);
    assert.equal(review.factBoundaryCheck.passed, false);
    assert.ok(
      review.issues.some(
        (issue) => issue.severity === "high" && issue.evidence.includes("零成本")
      )
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("reviewArticle applies dynamic ReviewPolicy issues with rule traceability", async () => {
  const now = "2026-05-29T00:00:00.000Z";
  const topicProfile: TopicProfile = {
    schemaVersion: "1.0",
    id: "topic-profile-pricing",
    topicId: "topic-pricing",
    primaryDomain: "tooling",
    secondaryDomains: [],
    eventTypes: ["pricing"],
    entities: [{ name: "Example AI", type: "product" }],
    targetAudiences: ["开发者"],
    readerQuestions: ["免费层边界是什么？"],
    evidenceNeeds: ["官方价格页"],
    riskDimensions: ["币种", "生效日期", "订阅与 API 差异", "免费层边界"],
    recommendedContentMode: "explainer",
    confidence: 0.9,
    classificationReason: "价格调整题。",
    generatedAt: now
  };
  const reviewPolicies = await resolvePoliciesForProfile(topicProfile, {
    scopes: ["review"],
    now: new Date(now)
  });
  const selectedTopic = {
    selected: {
      title: "Example AI pricing update",
      url: "https://example.com/pricing",
      sourceName: "Example",
      selection: {
        suggestedTitles: ["Example AI 调整免费层边界"],
        articleThesis: "价格变化真正影响的是套餐边界。",
        sourceReliability: "high",
        writingAngle: "解释免费层边界"
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  } as unknown as SelectedTopic;
  const factPack: TopicFactPack = {
    schemaVersion: "2.0",
    topicId: "topic-pricing",
    topicTitle: "Example AI pricing update",
    generatedAt: now,
    entities: [{ name: "Example AI", type: "product" }],
    sourceReliability: "high",
    sourceReliabilityReason: "官方来源。",
    claims: [
      {
        id: "claim-price-change",
        statement: "Example AI 在 2026 年调整免费层边界。",
        status: "verified",
        evidenceIds: ["evidence-pricing"],
        sourceUrls: ["https://example.com/pricing"],
        confidence: 0.9,
        safeWording: "可以写成 Example AI 调整免费层边界。",
        requiredQualifiers: ["据官方价格页"],
        forbiddenWording: ["零成本", "永久免费"],
        riskDimensions: ["免费层边界"]
      },
      {
        id: "claim-api-boundary",
        statement: "订阅套餐和 API 调用需要分开说明。",
        status: "verified",
        evidenceIds: ["evidence-pricing"],
        sourceUrls: ["https://example.com/pricing"],
        confidence: 0.9,
        safeWording: "可以写成订阅套餐和 API 调用是不同计费边界。",
        requiredQualifiers: ["分别说明"],
        forbiddenWording: ["订阅和 API 完全一样"],
        riskDimensions: ["订阅与 API 差异"]
      },
      {
        id: "claim-effective-date",
        statement: "价格说明需要保留生效日期。",
        status: "verified",
        evidenceIds: ["evidence-pricing"],
        sourceUrls: ["https://example.com/pricing"],
        confidence: 0.9,
        safeWording: "可以写成价格信息需要回到官方页面核对生效日期。",
        requiredQualifiers: ["生效日期"],
        forbiddenWording: ["所有用户都涨价"],
        riskDimensions: ["生效日期"]
      }
    ],
    unsupportedClaims: [],
    conflictingClaims: [],
    verifiedClaims: [],
    safeWritingBoundary: ["不写零成本。"],
    riskNotes: ["定价题需要说明免费层边界。"],
    recommendedFraming: "解释免费层边界。",
    articleAngleSuggestions: ["从套餐边界解释影响。"],
    sourceEvidenceIds: ["evidence-pricing"]
  };
  const articleMeta: ArticleMeta = {
    title: "Example AI 调整免费层边界，开发者为什么要重新算账",
    wordCount: 180,
    sourceTopic: "Example AI pricing update",
    articleThesis: "价格变化真正影响的是套餐边界。",
    usedClaims: factPack.claims.map((claim) => ({
      id: claim.id,
      claim: claim.statement,
      safeWording: claim.safeWording,
      sourceUrls: claim.sourceUrls,
      evidenceIds: claim.evidenceIds,
      status: claim.status
    })),
    riskControls: ["不写零成本"],
    editorialPlan: {
      id: "editorial-plan-pricing",
      contentMode: "explainer",
      sectionClaimMap: [{ sectionId: "section-1", allowedClaimIds: ["claim-price-change"] }],
      requiredThemes: ["免费层边界", "订阅与 API 差异", "生效日期"]
    },
    generatedAt: now
  };
  const articleMarkdown = [
    "# Example AI 调整免费层边界，开发者为什么要重新算账",
    "",
    "## 免费层边界",
    "",
    "据官方价格页，Example AI 在 2026 年调整免费层边界，但这次免费层是零成本。",
    "",
    "## 计费差异",
    "",
    "订阅套餐和 API 调用需要分开说明，价格信息需要回到官方页面核对生效日期。",
    "",
    "来源：https://example.com/pricing"
  ].join("\n");

  const review = reviewArticle(
    {
      articleMarkdown,
      articleMeta,
      factPack,
      selectedTopic,
      topicProfile,
      reviewPolicies
    },
    { now: new Date(now) }
  );

  assertReviewContract(review);
  assert.equal(review.passed, false);
  assert.ok(review.reviewPolicies?.some((policy) => policy.id === "pricing"));
  assert.ok(
    review.issues.some(
      (issue) =>
        issue.policyId === "pricing" &&
        issue.ruleId === "review-policy.pricing.free-tier-zero-cost" &&
        issue.source === "review_policy" &&
        issue.blocking
    )
  );
});

test("reviewArticle fails when the article exceeds 1500 characters", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-reviewer-"));

  try {
    const fixture = await createReviewFixture(outputDir);
    const longArticle = `${fixture.articleMarkdown}\n\n${"开源工作流成本工具锁定".repeat(120)}`;
    const review = reviewArticle(
      {
        articleMarkdown: longArticle,
        articleMeta: fixture.articleMeta,
        factPack: fixture.factPack,
        selectedTopic: fixture.topic
      },
      { now: new Date("2026-05-29T00:00:00.000Z") }
    );

    assertReviewContract(review);
    assert.equal(review.passed, false);
    assert.equal(review.qualityCheck.wordCountOk, false);
    assert.ok(
      review.issues.some(
        (issue) => issue.type === "structure" && issue.severity === "high"
      )
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("current real article outputs can be reviewed with a clear verdict", async () => {
  const outputDir = join(process.cwd(), "outputs");
  const result = await reviewArticleWithReport({
    outputDir,
    writeOutputs: false,
    logger: silentLogger,
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  assertReviewContract(result.review);
  assert.match(result.review.finalVerdict, /下一阶段/);
  assert.match(result.report, /审核结论/);
});
