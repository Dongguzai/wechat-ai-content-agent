import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectNewsWithReport } from "../src/pipeline/collectNews.js";
import { selectTopic, selectTopicWithReport } from "../src/pipeline/selectTopic.js";
import { shortlistNewsWithReport } from "../src/pipeline/shortlistNews.js";
import type { SelectedTopic, ShortlistedNewsItem } from "../src/types/news.js";
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
    RSS_MIN_CANDIDATES: "14",
    ...overrides
  };
}

async function createShortlist(): Promise<ShortlistedNewsItem[]> {
  const collection = await collectNewsWithReport({
    useMockRss: true,
    writeOutputs: false,
    logger: silentLogger,
    env: testEnv(),
    now: new Date("2026-05-29T00:00:00.000Z")
  });
  const shortlist = await shortlistNewsWithReport({
    candidates: collection.candidates,
    writeOutputs: false,
    logger: silentLogger
  });

  return shortlist.shortlisted;
}

function assertSelectedTopicContract(
  topic: SelectedTopic,
  shortlisted: ShortlistedNewsItem[]
): void {
  assert.equal(Array.isArray(topic.selected), false);
  assert.ok(topic.selected.title);
  assert.ok(topic.selected.url);
  assert.notEqual(topic.selected.sourceType, "global_search");
  assert.notEqual(topic.selected.selection.sourceReliability, "low");
  assert.ok(topic.selected.selection.selectedReason);
  assert.ok(topic.selected.selection.whyMostWorthWriting);
  assert.ok(topic.selected.selection.coreConflict);
  assert.ok(topic.selected.selection.writingAngle);
  assert.ok(topic.selected.selection.articleThesis);
  assert.ok(Array.isArray(topic.selected.selection.riskNotes));
  assert.ok(topic.selected.selection.suggestedTitles.length >= 3);
  assert.equal(typeof topic.selected.selection.decisionScore, "number");
  assert.ok(topic.runnersUp.length >= 2);
  assert.equal(
    topic.rejected.length,
    shortlisted.length - 1 - topic.runnersUp.length
  );
  assert.ok(topic.generatedAt);
}

function fixtureItem(
  overrides: Partial<ShortlistedNewsItem> & Pick<ShortlistedNewsItem, "id" | "title">
): ShortlistedNewsItem {
  const now = "2026-05-29T00:00:00.000Z";
  const { id, title, ...rest } = overrides;

  return {
    id,
    title,
    url: "https://openai.com/index/fixture-topic",
    sourceName: "OpenAI News",
    sourceType: "rss",
    provider: "none",
    publishedAt: now,
    fetchedAt: now,
    summary:
      "AI agent workflow update with developer tooling, enterprise controls, and business impact.",
    category: "tooling",
    evidence: ["source: OpenAI News", "url: https://openai.com/index/fixture-topic"],
    duplicateKey: `fixture:${overrides.id}`,
    scores: {
      freshness: 100,
      heat: 80,
      technicalValue: 80,
      wechatTopic: 80,
      businessImpact: 70,
      controversy: 30,
      final: 82
    },
    duplicateSources: [],
    tags: ["tooling", "agent", "developer-workflow", "business"],
    shortlistScore: 78,
    shortlistMetrics: {
      technicalValue: 80,
      wechatTopic: 80,
      businessImpact: 70,
      controversy: 30,
      sourceCredibility: 95,
      explainability: 82,
      originality: 95
    },
    editorial: {
      shortlistReason: "Fixture shortlist reason.",
      audienceFit: "Fixture audience fit.",
      topicAngle:
        "这个题适合讨论 AI agent 如何改变开发者工作流、企业工具采购和团队治理方式。",
      recommendedUse: "main_topic_candidate"
    },
    ...rest
  };
}

test("selectTopicWithReport writes selected-topic outputs with editor decision fields", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "topic-editor-"));

  try {
    const shortlisted = await createShortlist();
    const result = await selectTopicWithReport({
      outputDir,
      shortlisted,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assertSelectedTopicContract(result.topic, shortlisted);

    await access(result.files.selectedTopic);
    await access(result.files.topicSelectionReport);

    const writtenTopic = JSON.parse(
      await readFile(result.files.selectedTopic, "utf8")
    ) as SelectedTopic;
    assertSelectedTopicContract(writtenTopic, shortlisted);

    const report = await readFile(result.files.topicSelectionReport, "utf8");
    assert.match(report, /今日主选题标题/);
    assert.match(report, /为什么它最值得写/);
    assert.match(report, /它的核心冲突是什么/);
    assert.match(report, /它适合公众号的写作角度/);
    assert.match(report, /文章中心论点 articleThesis/);
    assert.match(report, /为什么没有选择其他入围资讯/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("selectTopic rejects unreliable high-scoring global_search and missing-url items", () => {
  const globalSearchLead = fixtureItem({
    id: "fixture-global-search-lead",
    title: "AI startup funding search lead with huge business impact",
    url: "https://example.com/global/search-lead",
    sourceName: "Mock Search / Startup News",
    sourceType: "global_search",
    provider: "tavily",
    query: "AI startup funding",
    snippet: "Search summary only.",
    scores: {
      freshness: 100,
      heat: 100,
      technicalValue: 98,
      wechatTopic: 100,
      businessImpact: 100,
      controversy: 80,
      final: 99
    },
    shortlistScore: 99,
    shortlistMetrics: {
      technicalValue: 98,
      wechatTopic: 100,
      businessImpact: 100,
      controversy: 80,
      sourceCredibility: 88,
      explainability: 95,
      originality: 62
    },
    editorial: {
      shortlistReason: "High scoring search lead.",
      audienceFit: "创业者和企业读者。",
      topicAngle:
        "企业知识 agent 融资很热，但这条只有 Tavily 搜索摘要，缺少可靠原始来源。",
      riskNote: "Tavily/Exa 搜索摘要不能作为事实依据。",
      recommendedUse: "secondary_topic"
    }
  });
  const missingUrlLead = fixtureItem({
    id: "fixture-missing-url-lead",
    title: "AI model update without source URL",
    url: "",
    sourceName: "Unknown source",
    shortlistScore: 98,
    shortlistMetrics: {
      technicalValue: 100,
      wechatTopic: 100,
      businessImpact: 100,
      controversy: 100,
      sourceCredibility: 95,
      explainability: 95,
      originality: 95
    }
  });
  const lowReliabilityLead = fixtureItem({
    id: "fixture-low-reliability-lead",
    title: "AI agent rumor from low trust source",
    url: "https://marktechpost.com/fixture-rumor",
    sourceName: "Low Trust Fixture",
    shortlistScore: 97,
    shortlistMetrics: {
      technicalValue: 100,
      wechatTopic: 100,
      businessImpact: 100,
      controversy: 100,
      sourceCredibility: 40,
      explainability: 95,
      originality: 50
    }
  });
  const validTopic = fixtureItem({
    id: "fixture-valid-topic",
    title: "ITBench-AA shows enterprise AI agents still struggle with real IT tasks",
    url: "https://huggingface.co/blog/ibm-research/itbench-aa",
    sourceName: "Hugging Face Blog",
    sourceType: "rss",
    shortlistScore: 70,
    shortlistMetrics: {
      technicalValue: 82,
      wechatTopic: 72,
      businessImpact: 70,
      controversy: 45,
      sourceCredibility: 95,
      explainability: 84,
      originality: 100
    },
    editorial: {
      shortlistReason: "Reliable technical benchmark.",
      audienceFit: "技术负责人和企业读者。",
      topicAngle:
        "企业 IT agent 基准测试分数不高，适合讨论演示自动化和真实企业环境的差距。",
      recommendedUse: "main_topic_candidate"
    }
  });

  const topic = selectTopic(
    [globalSearchLead, missingUrlLead, lowReliabilityLead, validTopic],
    { now: new Date("2026-05-29T00:00:00.000Z") }
  );

  assert.equal(topic.selected.id, validTopic.id);
  assert.ok(topic.selected.url);
  assert.notEqual(topic.selected.sourceType, "global_search");
  assert.notEqual(topic.selected.selection.sourceReliability, "low");
  const nonSelectedReasons = [
    ...topic.runnersUp.map((item) => `${item.reason} ${item.whyNotSelected}`),
    ...topic.rejected.map((item) => item.reason)
  ].join("\n");
  assert.match(nonSelectedReasons, /global_search/);
});
