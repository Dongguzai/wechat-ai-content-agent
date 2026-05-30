import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkSourceHealthWithReport } from "../src/pipeline/checkSourceHealth.js";
import type { RssSourceConfig } from "../src/config/sources.js";
import type { SourceHealthResult } from "../src/types/sourceHealth.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const rssSourceList: RssSourceConfig[] = [
  {
    name: "Fixture RSS",
    url: "https://fixture.local/rss.xml",
    trustScore: 90
  }
];

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    REAL_PRODUCTION_MODE: "false",
    RSS_ENABLE_REAL_FETCH: "true",
    RSS_FETCH_TIMEOUT_MS: "1000",
    RSS_FETCH_RETRY: "0",
    SEARCH_ENABLE_REAL_API: "false",
    SEARCH_FETCH_TIMEOUT_MS: "1000",
    SEARCH_FETCH_RETRY: "0",
    TAVILY_MAX_QUERIES_PER_RUN: "1",
    EXA_MAX_QUERIES_PER_RUN: "1",
    SEARCH_MAX_RESULTS_PER_QUERY: "1",
    SEARCH_LOOKBACK_HOURS: "72",
    MIN_REAL_NEWS_ITEMS: "20",
    MIN_REAL_RSS_ITEMS: "10",
    MIN_REAL_SEARCH_ITEMS: "3",
    ...overrides
  };
}

function rssXml(count = 2): string {
  const items = Array.from({ length: count }, (_value, index) => {
    const item = index + 1;

    return [
      "<item>",
      `<title>AI agent source health ${item}</title>`,
      `<link>https://news.example.org/ai-agent-${item}</link>`,
      `<description>AI model and agent source health fixture ${item}.</description>`,
      "<pubDate>Fri, 29 May 2026 00:00:00 GMT</pubDate>",
      "</item>"
    ].join("");
  });

  return `<rss><channel>${items.join("")}</channel></rss>`;
}

function searchPayload(provider: "tavily" | "exa"): string {
  return JSON.stringify({
    results: [
      {
        title: `${provider} AI source health result`,
        url: `https://search.example.org/${provider}/ai-source-health`,
        content: "AI model and agent source health search result.",
        text: "AI model and agent source health search result.",
        published_date: "2026-05-29T00:00:00.000Z",
        publishedDate: "2026-05-29T00:00:00.000Z"
      }
    ]
  });
}

test("source health records successful RSS, Tavily, and Exa checks", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "source-health-success-"));
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    const url = input.toString();

    if (url.includes("tavily")) {
      return new Response(searchPayload("tavily"), { status: 200 });
    }

    if (url.includes("exa")) {
      return new Response(searchPayload("exa"), { status: 200 });
    }

    return new Response(rssXml(2), { status: 200 });
  };

  try {
    const result = await checkSourceHealthWithReport({
      outputDir,
      logger: silentLogger,
      fetchImpl,
      rssSourceList,
      env: env({
        REAL_PRODUCTION_MODE: "true",
        SEARCH_ENABLE_REAL_API: "true",
        TAVILY_API_KEY: "tavily-test-key",
        EXA_API_KEY: "exa-test-key",
        MIN_REAL_NEWS_ITEMS: "4",
        MIN_REAL_RSS_ITEMS: "2",
        MIN_REAL_SEARCH_ITEMS: "2"
      }),
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.passed, true);
    assert.equal(result.sources.length, 3);
    assert.equal(result.summary.totalRealNewsItems, 4);
    assert.equal(result.summary.realRssItems, 2);
    assert.equal(result.summary.realSearchItems, 2);

    for (const source of result.sources) {
      assert.equal(source.enabled, true);
      assert.equal(source.attempted, true);
      assert.equal(source.success, true);
      assert.equal(source.error, null);
      assert.equal(source.usedFallback, false);
      assert.equal(typeof source.durationMs, "number");
    }

    await access(result.files.result);
    await access(result.files.report);

    const saved = JSON.parse(
      await readFile(result.files.result, "utf8")
    ) as SourceHealthResult;
    assert.equal(saved.passed, true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("source health records failed sources and development fallback", async () => {
  const result = await checkSourceHealthWithReport({
    logger: silentLogger,
    writeOutputs: false,
    rssSourceList,
    env: env({ SEARCH_ENABLE_REAL_API: "false" }),
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
    now: new Date("2026-05-29T00:00:00.000Z")
  });
  const rss = result.sources.find((source) => source.provider === "rss");
  const tavily = result.sources.find((source) => source.provider === "tavily");

  assert.equal(result.passed, true);
  assert.equal(rss?.success, false);
  assert.equal(rss?.usedFallback, true);
  assert.match(rss?.error ?? "", /HTTP 503/);
  assert.equal(tavily?.enabled, false);
  assert.equal(tavily?.usedFallback, true);
  assert.match(result.warnings.join("\n"), /rss:/);
});

test("source health RSS retry succeeds after a transient failure", async () => {
  let calls = 0;

  const result = await checkSourceHealthWithReport({
    logger: silentLogger,
    writeOutputs: false,
    rssSourceList,
    env: env({ RSS_FETCH_RETRY: "1" }),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("temporary", { status: 503 });
      }

      return new Response(rssXml(1), { status: 200 });
    },
    now: new Date("2026-05-29T00:00:00.000Z")
  });
  const rss = result.sources.find((source) => source.provider === "rss");

  assert.equal(calls, 2);
  assert.equal(rss?.success, true);
  assert.equal(rss?.itemCount, 1);
});

test("source health honors configurable timeout", async () => {
  const result = await checkSourceHealthWithReport({
    logger: silentLogger,
    writeOutputs: false,
    rssSourceList,
    env: env({
      RSS_FETCH_TIMEOUT_MS: "5",
      RSS_FETCH_RETRY: "0"
    }),
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    now: new Date("2026-05-29T00:00:00.000Z")
  });
  const rss = result.sources.find((source) => source.provider === "rss");

  assert.equal(rss?.success, false);
  assert.equal(rss?.usedFallback, true);
  assert.match(rss?.error ?? "", /timed out after 5ms/);
});

test("REAL_PRODUCTION_MODE=true blocks when real source counts are insufficient", async () => {
  const result = await checkSourceHealthWithReport({
    logger: silentLogger,
    writeOutputs: false,
    rssSourceList,
    env: env({
      REAL_PRODUCTION_MODE: "true",
      SEARCH_ENABLE_REAL_API: "false",
      MIN_REAL_NEWS_ITEMS: "20",
      MIN_REAL_RSS_ITEMS: "10",
      MIN_REAL_SEARCH_ITEMS: "3"
    }),
    fetchImpl: async () => new Response(rssXml(1), { status: 200 }),
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join("\n"), /minimum real news items/);
  assert.match(result.issues.join("\n"), /minimum real RSS items/);
  assert.match(result.issues.join("\n"), /minimum real search items/);
});

test("REAL_PRODUCTION_MODE=false allows source fallback warnings", async () => {
  const result = await checkSourceHealthWithReport({
    logger: silentLogger,
    writeOutputs: false,
    rssSourceList,
    env: env({
      REAL_PRODUCTION_MODE: "false",
      RSS_ENABLE_REAL_FETCH: "false",
      SEARCH_ENABLE_REAL_API: "false"
    }),
    fetchImpl: async () => {
      throw new Error("fetch should not be attempted");
    },
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  assert.equal(result.passed, true);
  assert.ok(result.sources.every((source) => !source.attempted));
  assert.ok(result.sources.every((source) => source.usedFallback));
  assert.equal(result.warnings.length, 3);
});
