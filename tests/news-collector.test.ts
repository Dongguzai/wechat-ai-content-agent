import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectNewsWithReport } from "../src/pipeline/collectNews.js";
import type { RawNewsItem } from "../src/types/news.js";
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

test("collectNewsWithReport writes 20 candidates with RSS/global quotas", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "news-collector-"));

  try {
    const result = await collectNewsWithReport({
      outputDir,
      useMockRss: true,
      logger: silentLogger,
      env: testEnv()
    });

    assert.equal(result.candidates.length, 20);
    assert.equal(result.stats.finalCandidateCount, 20);
    assert.ok(result.stats.rssCandidateCount >= 14);
    assert.ok(result.stats.globalSearchCandidateCount <= 6);
    assert.ok(result.stats.tavilyRawCount > 0);
    assert.ok(result.stats.exaRawCount > 0);
    assert.equal(result.stats.apiRealCall, false);

    for (const filePath of Object.values(result.files)) {
      await access(filePath);
    }

    for (const candidate of result.candidates) {
      assert.ok(candidate.title);
      assert.ok(candidate.url);
      assert.ok(candidate.sourceName);
      assert.ok(candidate.sourceType);
      assert.ok(candidate.summary);
      assert.ok(candidate.category);
      assert.ok(candidate.scores);
      assert.equal(typeof candidate.scores.final, "number");
    }

    const globalSearchCandidates = result.candidates.filter(
      (candidate) => candidate.sourceType === "global_search"
    );
    assert.ok(globalSearchCandidates.length > 0);
    assert.ok(
      globalSearchCandidates.every(
        (candidate) => candidate.snippet && candidate.snippet.length > 0
      )
    );

    const rawNews = JSON.parse(
      await readFile(result.files.rawNews, "utf8")
    ) as RawNewsItem[];
    const globalSearchItems = rawNews.filter(
      (item) => item.sourceType === "global_search"
    );

    assert.ok(globalSearchItems.length > 0);
    assert.ok(
      globalSearchItems.every(
        (item) =>
          item.provider &&
          item.query &&
          item.url &&
          item.title &&
          item.snippet &&
          item.publishedAt &&
          item.fetchedAt
      )
    );

    const report = await readFile(result.files.collectionReport, "utf8");
    assert.match(report, /API 是否真实调用: 否/);
    assert.match(report, /RSS 候选数量:/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("hard rejection fixtures cover invalid source scenarios", async () => {
  const now = new Date("2026-05-29T00:00:00.000Z");
  const fetchedAt = now.toISOString();
  const fixtureItems: RawNewsItem[] = [
    {
      id: "fixture-missing-url",
      sourceType: "rss",
      provider: "none",
      title: "AI model update without source URL",
      url: "",
      snippet: "AI model release has only text but no accessible source URL.",
      sourceName: "Fixture RSS",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-missing-title",
      sourceType: "rss",
      provider: "none",
      title: "",
      url: "https://openai.com/fixture-missing-title",
      snippet: "AI model release with a source URL but no title.",
      sourceName: "Fixture RSS",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-global-missing-provider",
      sourceType: "global_search",
      query: "new AI model technical report",
      title: "AI model technical report without provider",
      url: "https://openai.com/fixture-global-missing-provider",
      snippet: "AI technical report search result missing provider metadata.",
      sourceName: "Fixture Search",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-global-missing-query",
      sourceType: "global_search",
      provider: "tavily",
      title: "AI model technical report without query",
      url: "https://openai.com/fixture-global-missing-query",
      snippet: "AI technical report search result missing query metadata.",
      sourceName: "Fixture Search",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-seo-aggregation",
      sourceType: "rss",
      provider: "none",
      title: "Top 10 AI tools list",
      url: "https://example.com/tag/ai-tools",
      snippet: "AI SEO aggregation page listing many tools.",
      sourceName: "Fixture RSS",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-advertorial",
      sourceType: "rss",
      provider: "none",
      title: "Sponsored AI platform offer",
      url: "https://openai.com/fixture-sponsored-ai-platform",
      snippet: "Sponsored partner content with coupon for AI software.",
      sourceName: "Fixture RSS",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-not-ai",
      sourceType: "rss",
      provider: "none",
      title: "Gardening update for spring",
      url: "https://openai.com/fixture-gardening",
      snippet: "Tomato plants and soil notes for a spring garden.",
      sourceName: "Fixture RSS",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-snippet-only",
      sourceType: "global_search",
      provider: "exa",
      query: "new AI model technical report",
      title: "AI model search result with snippet only",
      url: "",
      snippet: "AI model search result has a snippet but no accessible source URL.",
      sourceName: "Fixture Search",
      publishedAt: fetchedAt,
      fetchedAt
    },
    {
      id: "fixture-old-not-high-heat",
      sourceType: "rss",
      provider: "none",
      title: "Old AI model release",
      url: "https://openai.com/fixture-old-ai-model",
      snippet: "AI model release notes from several weeks ago.",
      sourceName: "Fixture RSS",
      publishedAt: "2026-05-01T00:00:00.000Z",
      fetchedAt
    },
    {
      id: "fixture-old-high-heat",
      sourceType: "rss",
      provider: "none",
      title: "High heat old AI model release",
      url: "https://openai.com/fixture-old-high-heat-ai-model",
      snippet: "OpenAI AI model release remains high heat despite being older.",
      sourceName: "Fixture RSS",
      publishedAt: "2026-05-01T00:00:00.000Z",
      fetchedAt,
      highHeat: true
    }
  ];

  const result = await collectNewsWithReport({
    rawItemsOverride: fixtureItems,
    writeOutputs: false,
    allowMockRssFallback: false,
    logger: silentLogger,
    now,
    env: testEnv()
  });

  const reasonsById = new Map(
    result.rejectedItems.map((item) => [item.id, item.rejection?.reason])
  );

  assert.equal(reasonsById.get("fixture-missing-url"), "missing_url");
  assert.equal(reasonsById.get("fixture-missing-title"), "missing_title");
  assert.equal(
    reasonsById.get("fixture-global-missing-provider"),
    "global_search_missing_provider_or_query"
  );
  assert.equal(
    reasonsById.get("fixture-global-missing-query"),
    "global_search_missing_provider_or_query"
  );
  assert.equal(reasonsById.get("fixture-seo-aggregation"), "seo_aggregation_page");
  assert.equal(reasonsById.get("fixture-advertorial"), "advertorial");
  assert.equal(reasonsById.get("fixture-not-ai"), "not_ai_related");
  assert.equal(reasonsById.get("fixture-snippet-only"), "missing_url");
  assert.equal(reasonsById.get("fixture-old-not-high-heat"), "older_than_7_days");
  assert.equal(reasonsById.has("fixture-old-high-heat"), false);
  assert.ok(
    result.candidates.some((candidate) => candidate.id === "fixture-old-high-heat")
  );
});

test("SEARCH_ENABLE_REAL_API=false uses mock search without calling fetch", async () => {
  let fetchCalls = 0;

  const result = await collectNewsWithReport({
    useMockRss: true,
    writeOutputs: false,
    logger: silentLogger,
    env: testEnv({ SEARCH_ENABLE_REAL_API: "false" }),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called for mock search");
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.stats.apiRealCall, false);
  assert.equal(result.candidates.length, 20);
});

test("real Tavily and Exa adapters call the requested APIs when enabled", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchImpl = async (
    input: string | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input.toString();
    calls.push({ url, init });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const query = typeof body.query === "string" ? body.query : "unknown query";

    return new Response(
      JSON.stringify({
        results: [
          {
            title: `${query} result`,
            url: `https://example.com/real/${encodeURIComponent(query)}`,
            content: "AI model and agent technical update with source URL.",
            text: "AI model and agent technical update with source URL.",
            published_date: "2026-05-28T00:00:00.000Z",
            publishedDate: "2026-05-28T00:00:00.000Z"
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await collectNewsWithReport({
    useMockRss: true,
    writeOutputs: false,
    logger: silentLogger,
    env: testEnv({
      SEARCH_ENABLE_REAL_API: "true",
      TAVILY_API_KEY: "test-tavily-key",
      EXA_API_KEY: "test-exa-key"
    }),
    fetchImpl
  });

  assert.equal(result.stats.apiRealCall, true);
  assert.ok(calls.some((call) => call.url === "https://api.tavily.com/search"));
  assert.ok(calls.some((call) => call.url === "https://api.exa.ai/search"));

  const tavilyCall = calls.find((call) => call.url.includes("tavily"));
  const exaCall = calls.find((call) => call.url.includes("exa"));

  assert.equal(tavilyCall?.init?.method, "POST");
  assert.equal(exaCall?.init?.method, "POST");
  assert.equal(
    (tavilyCall?.init?.headers as Record<string, string>).authorization,
    "Bearer test-tavily-key"
  );
  assert.equal(
    (exaCall?.init?.headers as Record<string, string>)["x-api-key"],
    "test-exa-key"
  );
});

test("Tavily and Exa failures produce warnings without failing collection", async () => {
  const result = await collectNewsWithReport({
    useMockRss: true,
    writeOutputs: false,
    logger: silentLogger,
    env: testEnv({
      SEARCH_ENABLE_REAL_API: "true",
      TAVILY_API_KEY: "test-tavily-key",
      EXA_API_KEY: "test-exa-key"
    }),
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })
  });

  assert.equal(result.candidates.length, 20);
  assert.equal(result.stats.apiRealCall, true);
  assert.ok(
    result.warnings.some(
      (warning) =>
        warning.source === "tavily" && warning.message.includes("failed")
    )
  );
  assert.ok(
    result.warnings.some(
      (warning) => warning.source === "exa" && warning.message.includes("failed")
    )
  );
});
