import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectNewsWithReport } from "../src/pipeline/collectNews.js";
import { generateEditorialBrief } from "../src/pipeline/generateEditorialBrief.js";
import { localizeNewsItem } from "../src/pipeline/localizeNewsItem.js";
import type {
  NewsCategory,
  NewsScores,
  NewsTag,
  NormalizedNewsItem,
  RawNewsItem,
  SelectedTopic,
  ShortlistedNewsItem,
  ShortlistScoreDimensions
} from "../src/types/news.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SEARCH_ENABLE_REAL_API: "false",
    TAVILY_MAX_QUERIES_PER_RUN: "6",
    EXA_MAX_QUERIES_PER_RUN: "6",
    SEARCH_MAX_RESULTS_PER_QUERY: "5",
    SEARCH_LOOKBACK_HOURS: "72",
    GLOBAL_SEARCH_MAX_CANDIDATES: "6",
    RSS_MIN_CANDIDATES: "1",
    ...overrides
  };
}

function englishRaw(id = "english-ai-agent-news"): RawNewsItem {
  const now = "2026-05-29T00:00:00.000Z";

  return {
    id,
    dataMode: "real",
    sourceType: "rss",
    provider: "none",
    title: "OpenAI launches new agent workflow for developers",
    url: `https://openai.com/${id}`,
    snippet:
      "OpenAI describes a new AI agent workflow with enterprise controls and developer automation.",
    sourceName: "OpenAI News",
    publishedAt: now,
    fetchedAt: now
  };
}

test("English title and summary are not rejected by basic language filtering", async () => {
  const result = await collectNewsWithReport({
    rawItemsOverride: [englishRaw()],
    writeOutputs: false,
    allowMockRssFallback: false,
    logger: silentLogger,
    now: new Date("2026-05-29T00:00:00.000Z"),
    env: testEnv()
  });

  assert.equal(result.rejectedItems.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].sourceLanguage, "en");
  assert.equal(result.candidates[0].localized, true);
  assert.notEqual(result.candidates[0].rejection?.reason, "non_chinese_news_language");
});

test("localizeNewsItem returns Chinese fields and preserves original URL", async () => {
  const localized = await localizeNewsItem(
    {
      title: "OpenAI launches new agent workflow for developers",
      summary:
        "OpenAI describes a new AI agent workflow with enterprise controls and developer automation.",
      snippet: "AI agent workflow update.",
      url: "https://openai.com/news/agent-workflow",
      sourceName: "OpenAI News",
      sourceType: "rss",
      provider: "none"
    },
    {
      env: testEnv({ LLM_ENABLE_REAL_API: "false" })
    }
  );

  assert.equal(localized.sourceLanguage, "en");
  assert.equal(localized.localized, true);
  assert.equal(localized.rawTitle, "OpenAI launches new agent workflow for developers");
  assert.equal(localized.url, "https://openai.com/news/agent-workflow");
  assert.match(localized.titleZh, /AI 资讯/);
  assert.match(localized.summaryZh, /这条资讯/);
  assert.match(localized.topicAngleZh, /切入/);
});

test("global_search localization keeps original verification risk reminder", async () => {
  const localized = await localizeNewsItem(
    {
      title: "New AI model benchmark appears in company blog",
      summary: "Search result snippet mentions an AI model benchmark.",
      snippet: "AI model benchmark search snippet.",
      url: "https://example.com/original-ai-model-benchmark",
      sourceName: "Example Blog",
      sourceType: "global_search",
      provider: "tavily",
      query: "新 AI 模型技术报告"
    },
    { env: testEnv() }
  );

  assert.equal(localized.url, "https://example.com/original-ai-model-benchmark");
  assert.ok(
    localized.riskNotesZh.some(
      (note) => note.includes("需要回到原文核验") && note.includes("搜索摘要不作为确定事实")
    )
  );
});

test("localization_failed items enter rejected news", async () => {
  const result = await collectNewsWithReport({
    rawItemsOverride: [englishRaw("real-production-localization-fails")],
    writeOutputs: false,
    allowMockRssFallback: false,
    logger: silentLogger,
    now: new Date("2026-05-29T00:00:00.000Z"),
    env: testEnv({
      REAL_PRODUCTION_MODE: "true",
      LLM_ENABLE_REAL_API: "false"
    })
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejectedItems[0].rejection?.reason, "localization_failed");
  assert.equal(result.stats.localizationFailedCount, 1);
});

test("REAL_PRODUCTION_MODE=true does not allow mock localization", async () => {
  await assert.rejects(
    () =>
      localizeNewsItem(
        {
          title: "OpenAI launches new agent workflow for developers",
          summary: "OpenAI describes an AI agent workflow.",
          snippet: "AI agent workflow.",
          url: "https://openai.com/news/agent-workflow",
          sourceName: "OpenAI News",
          sourceType: "rss",
          provider: "none"
        },
        {
          env: testEnv({
            REAL_PRODUCTION_MODE: "true",
            LLM_ENABLE_REAL_API: "false"
          })
        }
      ),
    /requires real LLM localization/
  );
});

function fakeScore(index: number): NewsScores {
  return {
    freshness: 90 - index,
    heat: 80,
    technicalValue: 82,
    wechatTopic: 84,
    businessImpact: 76,
    controversy: 30,
    final: 88 - index
  };
}

function shortlistedItem(index: number): ShortlistedNewsItem {
  const category: NewsCategory = "tooling";
  const tags: NewsTag[] = ["agent", "tooling"];
  const shortlistMetrics: ShortlistScoreDimensions = {
    technicalValue: 82,
    wechatTopic: 84,
    businessImpact: 76,
    controversy: 30,
    sourceCredibility: 92,
    explainability: 88,
    originality: 90
  };
  const rawTitle = `OpenAI launches agent workflow ${index}`;
  const titleZh = `OpenAI 智能体工作流中文标题 ${index}`;

  return {
    id: `shortlisted-${index}`,
    dataMode: "real",
    title: titleZh,
    rawTitle,
    titleZh,
    url: `https://openai.com/news/localized-${index}`,
    sourceName: "OpenAI News",
    sourceType: "rss",
    provider: "none",
    fetchedAt: "2026-05-29T00:00:00.000Z",
    summary: `中文摘要 ${index}，说明这条资讯的基本情况和后续核验要求。`,
    rawSummary: `English summary ${index}`,
    summaryZh: `中文摘要 ${index}，说明这条资讯的基本情况和后续核验要求。`,
    sourceLanguage: "en",
    topicAngleZh: `中文选题角度 ${index}：从开发者工作流变化和企业采用边界切入。`,
    shortlistReasonZh: `中文入围理由 ${index}：来源明确、主题相关，适合进入编辑初筛。`,
    riskNotesZh: ["需要回到原文核验关键事实。"],
    localized: true,
    localizationStatus: "localized",
    category,
    evidence: [`url: https://openai.com/news/localized-${index}`],
    duplicateKey: `shortlisted-${index}`,
    scores: fakeScore(index),
    duplicateSources: [],
    tags,
    shortlistScore: 90 - index,
    shortlistMetrics,
    editorial: {
      shortlistReason: `中文入围理由 ${index}：来源明确、主题相关，适合进入编辑初筛。`,
      audienceFit: "适合开发者和产品读者。",
      topicAngle: `中文选题角度 ${index}：从开发者工作流变化和企业采用边界切入。`,
      riskNote: "需要回到原文核验关键事实。",
      recommendedUse: "main_topic_candidate"
    }
  };
}

function selectedTopic(items: ShortlistedNewsItem[]): SelectedTopic {
  return {
    selected: {
      ...items[0],
      selection: {
        selectedReason: "中文推荐理由。",
        whyMostWorthWriting: "冲突清晰。",
        coreConflict: "效率提升和事实核验之间的冲突。",
        publicInterest: "读者关心工作流变化。",
        technicalSignificance: "技术变化清晰。",
        businessImpact: "影响采购和工具选型。",
        predictedImpact: "可能影响团队流程。",
        writingAngle: "从工作流变化切入。",
        suggestedTitles: ["AI 工作流变化"],
        articleThesis: "AI 工具价值需要放进真实流程里判断。",
        riskNotes: ["避免夸大。"],
        sourceReliability: "high",
        decisionScore: 88
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

test("editorial-brief.md displays Chinese and original titles", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "localized-brief-"));
  const shortlisted = Array.from({ length: 10 }, (_, index) => shortlistedItem(index + 1));

  try {
    const result = await generateEditorialBrief({
      outputDir,
      candidates: shortlisted,
      shortlisted,
      selectedTopic: selectedTopic(shortlisted),
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });
    const markdown = await readFile(result.files.markdown, "utf8");

    assert.match(markdown, /中文标题：OpenAI 智能体工作流中文标题 1/);
    assert.match(markdown, /原始标题：OpenAI launches agent workflow 1/);
    assert.match(markdown, /原文 URL：\[https:\/\/openai.com\/news\/localized-1\]/);
    assert.match(markdown, /中文摘要：中文摘要 1/);
    assert.match(markdown, /中文选题角度：中文选题角度 1/);
    assert.match(markdown, /中文入围理由：中文入围理由 1/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("Dashboard brief page source prefers Chinese title and keeps original URL", async () => {
  const source = await readFile("apps/dashboard/components/cloud-brief-view.tsx", "utf8");

  assert.match(source, /item\.titleZh \?\? item\.title/);
  assert.match(source, /原始标题/);
  assert.match(source, /原文 URL/);
  assert.match(source, /item\.url/);
});
