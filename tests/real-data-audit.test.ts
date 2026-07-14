import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { auditRealData } from "../src/pipeline/auditRealData.js";
import type { ArticleMeta } from "../src/types/article.js";
import type { CoverResult } from "../src/types/cover.js";
import type { TopicFactPack } from "../src/types/factPack.js";
import type {
  SelectedTopic,
  ShortlistedNewsItem,
  SourceReliability
} from "../src/types/news.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const realSourceUrls = [
  "https://openai.com/news/source-a",
  "https://www.anthropic.com/news/source-b",
  "https://github.com/block/goose"
];

function realItem(overrides: Partial<ShortlistedNewsItem> = {}): ShortlistedNewsItem {
  return {
    id: "real-rss-item",
    dataMode: "real",
    mock: false,
    title: "OpenAI ships a real AI agent workflow update",
    url: "https://openai.com/news/real-ai-agent-workflow",
    sourceName: "OpenAI News",
    sourceType: "rss",
    provider: "none",
    publishedAt: "2026-05-29T00:00:00.000Z",
    fetchedAt: "2026-05-29T00:00:00.000Z",
    summary: "A real AI agent workflow update with source URL.",
    category: "tooling",
    evidence: ["source: OpenAI News", "url: https://openai.com/news/real-ai-agent-workflow"],
    duplicateKey: "real-rss-item",
    scores: {
      freshness: 90,
      heat: 80,
      technicalValue: 88,
      wechatTopic: 86,
      businessImpact: 82,
      controversy: 35,
      final: 84
    },
    duplicateSources: [],
    tags: ["tooling", "agent", "developer-workflow"],
    shortlistScore: 86,
    shortlistMetrics: {
      technicalValue: 88,
      wechatTopic: 86,
      businessImpact: 82,
      controversy: 35,
      sourceCredibility: 90,
      explainability: 88,
      originality: 86
    },
    editorial: {
      shortlistReason: "Real source is suitable for production.",
      audienceFit: "Developers and AI product readers.",
      topicAngle: "AI agent workflow is changing production work.",
      recommendedUse: "main_topic_candidate"
    },
    ...overrides
  };
}

function selectedTopicFixture(input: {
  item?: ShortlistedNewsItem;
  url?: string;
  reliability?: SourceReliability;
} = {}): SelectedTopic {
  const item = {
    ...(input.item ?? realItem()),
    ...(input.url !== undefined ? { url: input.url } : {})
  };

  return {
    selected: {
      ...item,
      selection: {
        selectedReason: "Real production source selected.",
        whyMostWorthWriting: "It has a real URL and verifiable source claims.",
        coreConflict: "AI agent workflow value versus production risk.",
        publicInterest: "Readers can understand the workflow impact.",
        technicalSignificance: "The update affects agent tooling.",
        businessImpact: "Teams may change tooling choices.",
        predictedImpact: "More teams evaluate agent workflows.",
        writingAngle: "Explain the production workflow shift.",
        suggestedTitles: ["AI Agent 工作流进入真实生产"],
        articleThesis: "AI agent workflows are becoming production infrastructure.",
        riskNotes: ["Keep facts sourced."],
        sourceReliability: input.reliability ?? "medium",
        decisionScore: 88
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function factPackFixture(sourceUrls = realSourceUrls): TopicFactPack {
  const claims = [0, 1, 2].map((index) => ({
    id: `fixture-claim-${index + 1}`,
    statement: `Verified production claim ${index + 1}`,
    status: "verified" as const,
    evidenceIds: [`fixture-evidence-${index + 1}`],
    sourceUrls: sourceUrls[index] ? [sourceUrls[index]] : [],
    confidence: 0.9,
    safeWording: `Safe wording ${index + 1}`,
    requiredQualifiers: ["据来源显示"],
    forbiddenWording: [],
    riskDimensions: ["source quality"]
  }));

  return {
    schemaVersion: "2.0",
    topicId: "fixture-real-agent-workflow",
    topicTitle: "OpenAI ships a real AI agent workflow update",
    generatedAt: "2026-05-29T00:00:00.000Z",
    entities: [],
    sourceReliability: "medium",
    sourceReliabilityReason: "测试夹具使用真实来源 URL。",
    claims,
    unsupportedClaims: [],
    conflictingClaims: [],
    verifiedClaims: claims.map((claim) => ({
      id: claim.id,
      claim: claim.statement,
      status: claim.status,
      sourceUrls: claim.sourceUrls,
      safeWording: claim.safeWording,
      risk: "low",
      evidenceIds: claim.evidenceIds,
      confidence: claim.confidence,
      requiredQualifiers: claim.requiredQualifiers,
      forbiddenWording: claim.forbiddenWording,
      riskDimensions: claim.riskDimensions
    })),
    safeWritingBoundary: [],
    riskNotes: [],
    recommendedFraming: "Use verified sources only.",
    articleAngleSuggestions: [],
    sourceEvidenceIds: claims.flatMap((claim) => claim.evidenceIds)
  };
}

function articleMetaFixture(sourceUrls = realSourceUrls): ArticleMeta {
  return {
    title: "AI Agent 工作流进入真实生产",
    wordCount: 900,
    sourceTopic: "OpenAI ships a real AI agent workflow update",
    articleThesis: "AI agent workflows are becoming production infrastructure.",
    usedClaims: [0, 1, 2].map((index) => ({
      claim: `Used production claim ${index + 1}`,
      safeWording: `Safe wording ${index + 1}`,
      sourceUrls: sourceUrls[index] ? [sourceUrls[index]] : []
    })),
    riskControls: ["source facts", "avoid overclaiming", "keep human review"],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function coverFixture(outputDir: string, mode: "real" | "mock" = "real"): CoverResult {
  return {
    provider: "apimart",
    mode,
    title: "AI Agent 工作流进入真实生产",
    coverText: "AI Agent\n真实生产",
    imagePrompt: "Real production cover prompt.",
    negativePrompt: "No brand marks.",
    imageSize: "900x383",
    imagePath: join(outputDir, "covers", mode === "real" ? "cover.png" : "cover.svg"),
    visualRequirements: {
      style: "3D animated movie quality, not specific studio imitation",
      size: "900x383",
      quality: "2K render quality",
      language: "Chinese",
      mainTextRequired: true,
      visualCenterRequired: true
    },
    review: {
      passed: true,
      issues: [],
      riskNotes: []
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeAuditFixture(
  outputDir: string,
  overrides: {
    candidates?: ShortlistedNewsItem[];
    shortlisted?: ShortlistedNewsItem[];
    selectedTopic?: SelectedTopic;
    factPack?: TopicFactPack;
    articleMeta?: ArticleMeta;
    cover?: CoverResult;
    collectionReport?: string;
  } = {}
): Promise<void> {
  const candidates = overrides.candidates ?? [realItem()];
  const shortlisted = overrides.shortlisted ?? [candidates[0]];
  const cover = overrides.cover ?? coverFixture(outputDir);

  await mkdir(join(outputDir, "covers"), { recursive: true });
  await writeFile(cover.imagePath, cover.mode === "real" ? "png\n" : "<svg />\n", "utf8");
  await writeJson(join(outputDir, "candidate-news.json"), candidates);
  await writeJson(join(outputDir, "shortlisted-news.json"), shortlisted);
  await writeJson(
    join(outputDir, "selected-topic.json"),
    overrides.selectedTopic ?? selectedTopicFixture({ item: shortlisted[0] })
  );
  await writeJson(
    join(outputDir, "topic-fact-pack.json"),
    overrides.factPack ?? factPackFixture()
  );
  await writeJson(
    join(outputDir, "article-meta.json"),
    overrides.articleMeta ?? articleMetaFixture()
  );
  await writeJson(join(outputDir, "cover.json"), cover);
  await writeFile(
    join(outputDir, "collection-report.md"),
    overrides.collectionReport ?? "# Collection\n\n- real sources only\n",
    "utf8"
  );
}

test("REAL_PRODUCTION_MODE=false allows mock fallback as warnings", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "real-data-audit-dev-"));
  const mockItem = realItem({
    id: "rss-openai-agent-workbench",
    dataMode: "mock",
    mock: true,
    mockReason: "rss_fallback",
    sourceName: "Mock RSS / OpenAI News",
    url: "https://openai.com/news/mock-looking-real-url"
  });

  try {
    await writeAuditFixture(outputDir, {
      candidates: [mockItem],
      shortlisted: [mockItem],
      selectedTopic: selectedTopicFixture({ item: mockItem }),
      cover: coverFixture(outputDir, "mock"),
      collectionReport: "RSS candidates were insufficient; added mock RSS fallback items."
    });

    const result = await auditRealData({
      outputDir,
      env: { REAL_PRODUCTION_MODE: "false" },
      logger: silentLogger
    });

    assert.equal(result.passed, true);
    assert.ok(result.warnings.length > 0);
    assert.equal(result.summary.mockFallbackDetected, true);
    assert.match(await readFile(result.files.report, "utf8"), /REAL_PRODUCTION_MODE=false/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("REAL_PRODUCTION_MODE=true blocks mock news", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "real-data-audit-mock-news-"));
  const mockItem = realItem({
    id: "rss-openai-agent-workbench",
    dataMode: "mock",
    mock: true,
    mockReason: "mock_rss",
    sourceName: "Mock RSS / OpenAI News"
  });

  try {
    await writeAuditFixture(outputDir, {
      candidates: [mockItem],
      shortlisted: [mockItem],
      selectedTopic: selectedTopicFixture({ item: mockItem })
    });

    const result = await auditRealData({
      outputDir,
      env: { REAL_PRODUCTION_MODE: "true" },
      logger: silentLogger
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /mock news|mockNews|mock selected-topic/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("REAL_PRODUCTION_MODE=true blocks mock cover", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "real-data-audit-mock-cover-"));

  try {
    await writeAuditFixture(outputDir, {
      cover: coverFixture(outputDir, "mock")
    });

    const result = await auditRealData({
      outputDir,
      env: { REAL_PRODUCTION_MODE: "true" },
      logger: silentLogger
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /cover\.mode=real|mock cover/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("selected-topic without a real url is blocked", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "real-data-audit-no-url-"));

  try {
    await writeAuditFixture(outputDir, {
      selectedTopic: selectedTopicFixture({ url: "https://example.com/mock-topic" })
    });

    const result = await auditRealData({
      outputDir,
      env: { REAL_PRODUCTION_MODE: "false" },
      logger: silentLogger
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /selected topic has real url/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("fact pack claims without sourceUrls are blocked", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "real-data-audit-facts-"));

  try {
    await writeAuditFixture(outputDir, {
      factPack: factPackFixture([])
    });

    const result = await auditRealData({
      outputDir,
      env: { REAL_PRODUCTION_MODE: "false" },
      logger: silentLogger
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /fact pack claims have sourceUrls/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("article usedClaims without sourceUrls are blocked", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "real-data-audit-claims-"));

  try {
    await writeAuditFixture(outputDir, {
      articleMeta: articleMetaFixture([])
    });

    const result = await auditRealData({
      outputDir,
      env: { REAL_PRODUCTION_MODE: "false" },
      logger: silentLogger
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /article usedClaims have sourceUrls/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("global_search cannot be the sole final fact basis", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "real-data-audit-global-"));
  const globalItem = realItem({
    id: "real-tavily-item",
    sourceType: "global_search",
    provider: "tavily",
    url: "https://openai.com/news/search-lead-source"
  });

  try {
    await writeAuditFixture(outputDir, {
      candidates: [globalItem],
      shortlisted: [globalItem],
      selectedTopic: selectedTopicFixture({ item: globalItem }),
      factPack: factPackFixture(["https://openai.com/news/search-lead-source"]),
      articleMeta: articleMetaFixture(["https://openai.com/news/search-lead-source"])
    });

    const result = await auditRealData({
      outputDir,
      env: { REAL_PRODUCTION_MODE: "true" },
      logger: silentLogger
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /global_search is not sole final fact basis/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
