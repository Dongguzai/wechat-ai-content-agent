import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectNewsWithReport } from "../src/pipeline/collectNews.js";
import { shortlistNewsWithReport } from "../src/pipeline/shortlistNews.js";
import type {
  NormalizedNewsItem,
  ShortlistedNewsItem
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
    RSS_MIN_CANDIDATES: "14",
    ...overrides
  };
}

async function createCandidates(): Promise<NormalizedNewsItem[]> {
  const collection = await collectNewsWithReport({
    useMockRss: true,
    writeOutputs: false,
    logger: silentLogger,
    env: testEnv(),
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  return collection.candidates;
}

function assertShortlistContract(shortlisted: ShortlistedNewsItem[]): void {
  assert.equal(shortlisted.length, 10);
  assert.ok(
    shortlisted.filter((item) => item.sourceType === "rss").length >= 7
  );
  assert.ok(
    shortlisted.filter((item) => item.sourceType === "global_search").length <= 3
  );
  assert.ok(
    shortlisted.filter(
      (item) => item.provider === "tavily" || item.provider === "exa"
    ).length <= 3
  );
  assert.ok(
    shortlisted.filter(
      (item) =>
        item.tags.includes("tooling") ||
        item.tags.includes("developer-workflow")
    ).length >= 2
  );

  const duplicateKeys = new Set<string>();
  for (const item of shortlisted) {
    assert.ok(item.url);
    assert.ok(item.sourceName);
    assert.ok(Array.isArray(item.tags));
    assert.ok(item.editorial.shortlistReason);
    assert.ok(item.editorial.topicAngle);
    assert.ok(
      [...item.editorial.topicAngle].length >= 50,
      `topicAngle is too short: ${item.title}`
    );
    assert.notEqual(
      item.editorial.topicAngle,
      item.editorial.shortlistReason,
      `topicAngle duplicates shortlistReason: ${item.title}`
    );
    assert.equal(typeof item.shortlistScore, "number");
    assert.ok(item.shortlistScore > 0);

    if (item.sourceType === "global_search") {
      assert.match(item.editorial.riskNote ?? "", /不能作为事实依据/);
    }

    const duplicateKey = item.duplicateKey || item.url;
    assert.equal(
      duplicateKeys.has(duplicateKey),
      false,
      `Duplicate event shortlisted: ${item.title}`
    );
    duplicateKeys.add(duplicateKey);
  }
}

test("shortlistNewsWithReport writes 10 shortlisted items with source quotas", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "news-shortlister-"));

  try {
    const candidates = await createCandidates();
    const result = await shortlistNewsWithReport({
      outputDir,
      candidates,
      logger: silentLogger
    });

    assert.equal(result.stats.candidateCount, 20);
    assert.equal(result.stats.shortlistedCount, 10);
    assertShortlistContract(result.shortlisted);

    for (const filePath of Object.values(result.files)) {
      await access(filePath);
    }

    const writtenShortlist = JSON.parse(
      await readFile(result.files.shortlistedNews, "utf8")
    ) as ShortlistedNewsItem[];
    assertShortlistContract(writtenShortlist);

    const report = await readFile(result.files.shortlistReport, "utf8");
    assert.match(report, /candidate 总数: 20/);
    assert.match(report, /shortlisted 总数: 10/);
    assert.match(report, /RSS 入围数量:/);
    assert.match(report, /global_search 入围数量:/);
    assert.match(report, /Tavily 入围数量:/);
    assert.match(report, /Exa 入围数量:/);
    assert.match(report, /Category Distribution \/ category 分布/);
    assert.match(report, /Tags Distribution \/ tags 分布/);
    assert.match(report, /- tooling:/);
    assert.match(report, /- developer-workflow:/);
    assert.match(report, /## Eliminated/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("shortlistNewsWithReport does not allow obvious duplicate events", async () => {
  const candidates = await createCandidates();
  const [topCandidate, ...restCandidates] = candidates;
  const duplicateCandidate: NormalizedNewsItem = {
    ...topCandidate,
    id: "duplicate-editorial-fixture",
    title: `${topCandidate.title} updated`,
    url: `${topCandidate.url}?utm_source=duplicate-fixture`,
    sourceName: "Fixture Duplicate Source",
    scores: {
      ...topCandidate.scores,
      final: 100,
      technicalValue: 100,
      wechatTopic: 100
    }
  };

  const result = await shortlistNewsWithReport({
    candidates: [topCandidate, duplicateCandidate, ...restCandidates],
    writeOutputs: false,
    logger: silentLogger
  });
  const ids = new Set(result.shortlisted.map((item) => item.id));

  assertShortlistContract(result.shortlisted);
  assert.equal(
    ids.has(topCandidate.id) && ids.has(duplicateCandidate.id),
    false
  );
  assert.ok(
    result.eliminated.some(
      (item) =>
        item.id === topCandidate.id || item.id === duplicateCandidate.id
    )
  );
});
