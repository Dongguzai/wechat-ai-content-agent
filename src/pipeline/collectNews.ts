import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchGlobalNews } from "../adapters/globalSearch.js";
import { fetchRssNews } from "../adapters/rss.js";
import {
  containsAiSignal,
  getDomain,
  inferCategory,
  isLowTrustDomain,
  isSeoAggregationUrl,
  isTrustedDomain,
  scoreNewsItem
} from "../config/scoring.js";
import {
  readCollectionConfig,
  rssSources,
  type CollectionConfig,
  type RssSourceConfig
} from "../config/sources.js";
import { requireSourceUrl } from "../hooks/requireSourceUrl.js";
import { createMockRssNews } from "../mock/mockNews.js";
import type {
  CollectionOutputFiles,
  CollectionWarning,
  DuplicateSource,
  NewsCollectionResult,
  NewsCollectionStats,
  NewsItem,
  NewsRejection,
  NormalizedNewsItem,
  RawNewsItem
} from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CollectNewsOptions {
  outputDir?: string;
  logger?: Logger;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  rssSourceList?: RssSourceConfig[];
  writeOutputs?: boolean;
  useMockRss?: boolean;
  allowMockRssFallback?: boolean;
  rawItemsOverride?: RawNewsItem[];
}

interface BuildCollectionOptions {
  rawItems: RawNewsItem[];
  warnings: CollectionWarning[];
  config: CollectionConfig;
  apiRealCall: boolean;
  now: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function trimText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";

    for (const key of [...parsed.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_") ||
        ["ref", "ref_src", "fbclid", "gclid", "mc_cid", "mc_eid"].includes(
          normalizedKey
        )
      ) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const serialized = parsed.toString();
    return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
  } catch {
    return url.trim().toLowerCase();
  }
}

function titleFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title: string): Set<string> {
  const fingerprint = titleFingerprint(title);
  const words = fingerprint.split(" ").filter((word) => word.length > 2);

  if (words.length >= 3) {
    return new Set(words);
  }

  const compact = fingerprint.replace(/\s+/g, "");
  const shingles = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    shingles.add(compact.slice(index, index + 2));
  }

  return shingles;
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  return intersection.length / union.size;
}

function summarize(raw: RawNewsItem): string {
  const snippet = trimText(raw.snippet);
  const content = trimText(raw.rawContent);
  const base = snippet || content || trimText(raw.title);
  return truncate(base, 240);
}

function evidenceFor(raw: RawNewsItem): string[] {
  const evidence = [
    `source: ${raw.sourceName}`,
    `url: ${raw.url}`,
    raw.publishedAt ? `publishedAt: ${raw.publishedAt}` : undefined,
    raw.sourceType === "global_search" && raw.provider
      ? `search provider: ${raw.provider}`
      : undefined,
    raw.query ? `query: ${raw.query}` : undefined,
    raw.snippet ? `snippet: ${truncate(trimText(raw.snippet), 180)}` : undefined
  ];

  return evidence.filter((item): item is string => Boolean(item));
}

function tagsFor(text: string): string[] {
  const tags = [
    "agent",
    "model",
    "multimodal",
    "research",
    "funding",
    "open source",
    "developer",
    "enterprise",
    "policy",
    "safety",
    "workflow"
  ];
  const haystack = text.toLowerCase();
  return tags.filter((tag) => haystack.includes(tag)).slice(0, 6);
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isSearchProviderUrl(url: string): boolean {
  const domain = getDomain(url);
  return [
    "google.com",
    "bing.com",
    "search.yahoo.com",
    "tavily.com",
    "exa.ai"
  ].some((searchDomain) => domain === searchDomain || domain.endsWith(`.${searchDomain}`));
}

function isRepost(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return [
    "转载",
    "reposted from",
    "republished from",
    "syndicated from",
    "originally appeared on",
    "mirror of"
  ].some((signal) => text.includes(signal));
}

function isAdvertorial(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return [
    "sponsored",
    "advertorial",
    "paid post",
    "partner content",
    "limited time offer",
    "coupon",
    "promo code"
  ].some((signal) => text.includes(signal));
}

function isGenericTitle(title: string): boolean {
  return [
    "company",
    "news",
    "blog",
    "research",
    "announcements",
    "products",
    "articles"
  ].includes(title.trim().toLowerCase());
}

function createRejection(
  reason: string,
  now: Date,
  detail?: string
): NewsRejection {
  return {
    hard: true,
    reason,
    detail,
    rejectedAt: now.toISOString()
  };
}

function evaluateRejection(
  raw: RawNewsItem,
  normalized: Omit<NormalizedNewsItem, "rejection">,
  now: Date
): NewsRejection | undefined {
  const title = normalized.title;
  const url = normalized.url;
  const summary = normalized.summary;
  const text = `${title} ${summary} ${raw.rawContent ?? ""}`;

  if (!url) {
    return createRejection("missing_url", now, "News item has no URL.");
  }

  if (!title) {
    return createRejection("missing_title", now, "News item has no title.");
  }

  if (isGenericTitle(title)) {
    return createRejection(
      "missing_title",
      now,
      `Title is too generic to identify the original news item: ${title}.`
    );
  }

  if (raw.sourceType === "global_search") {
    if (!raw.provider || raw.provider === "none" || !raw.query) {
      return createRejection(
        "global_search_missing_provider_or_query",
        now,
        "Global search result must include provider and query."
      );
    }
  }

  if (!isValidHttpUrl(url)) {
    return createRejection(
      "source_url_not_accessible",
      now,
      "URL is not a valid http(s) source URL."
    );
  }

  if (isRepost(title, summary)) {
    return createRejection("obvious_repost", now);
  }

  if (isSeoAggregationUrl(url, title)) {
    return createRejection("seo_aggregation_page", now);
  }

  if (isAdvertorial(title, summary)) {
    return createRejection("advertorial", now);
  }

  if (raw.sourceType === "global_search" && isSearchProviderUrl(url)) {
    return createRejection(
      "search_snippet_without_original_source",
      now,
      "Search result points back to a search provider instead of an original source."
    );
  }

  if (raw.publishedAt) {
    const timestamp = Date.parse(raw.publishedAt);
    const ageHours = Number.isFinite(timestamp)
      ? (now.getTime() - timestamp) / 3_600_000
      : 0;
    const highHeat = raw.highHeat ?? normalized.scores.heat >= 90;

    if (ageHours > 168 && !highHeat) {
      return createRejection(
        "older_than_7_days",
        now,
        `Published ${Math.round(ageHours)} hours ago.`
      );
    }
  }

  if (isLowTrustDomain(url) && !isTrustedDomain(url)) {
    return createRejection(
      "untrusted_source_without_original",
      now,
      `Low-trust domain: ${getDomain(url)}.`
    );
  }

  if (!containsAiSignal(text)) {
    return createRejection("not_ai_related", now);
  }

  return undefined;
}

function normalizeRawItem(raw: RawNewsItem, now: Date): NormalizedNewsItem {
  const title = trimText(raw.title);
  const url = trimText(raw.url);
  const summary = summarize(raw);
  const category = inferCategory(`${title} ${summary} ${raw.rawContent ?? ""}`);
  const scores = scoreNewsItem(raw, category, now);
  const duplicateKey = url
    ? normalizeUrl(url)
    : `title:${titleFingerprint(title)}`;
  const normalizedBase: Omit<NormalizedNewsItem, "rejection"> = {
    id: raw.id,
    dataMode: raw.dataMode ?? (raw.mock ? "mock" : "real"),
    mock: raw.mock === true || raw.dataMode === "mock",
    mockReason: raw.mockReason,
    title,
    url,
    sourceName: trimText(raw.sourceName) || "Unknown source",
    sourceType: raw.sourceType,
    provider: raw.provider,
    query: raw.query,
    publishedAt: raw.publishedAt,
    fetchedAt: raw.fetchedAt,
    snippet:
      raw.sourceType === "global_search" && raw.snippet
        ? trimText(raw.snippet)
        : undefined,
    summary,
    category,
    evidence: evidenceFor(raw),
    duplicateKey,
    scores,
    duplicateSources: [],
    tags: tagsFor(`${title} ${summary}`)
  };
  const rejection = evaluateRejection(raw, normalizedBase, now);

  return rejection ? { ...normalizedBase, rejection } : normalizedBase;
}

function toDuplicateSource(item: NormalizedNewsItem): DuplicateSource {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    provider: item.provider,
    query: item.query
  };
}

function dedupeNews(items: NormalizedNewsItem[]): NormalizedNewsItem[] {
  const sorted = [...items].sort((a, b) => b.scores.final - a.scores.final);
  const deduped: NormalizedNewsItem[] = [];

  for (const item of sorted) {
    const duplicateIndex = deduped.findIndex(
      (existing) =>
        existing.duplicateKey === item.duplicateKey ||
        titleSimilarity(existing.title, item.title) >= 0.82
    );

    if (duplicateIndex === -1) {
      deduped.push({ ...item, duplicateSources: [...(item.duplicateSources ?? [])] });
      continue;
    }

    const keeper = deduped[duplicateIndex];
    keeper.duplicateSources = [
      ...(keeper.duplicateSources ?? []),
      toDuplicateSource(item),
      ...(item.duplicateSources ?? [])
    ];
  }

  return deduped;
}

function selectCandidates(
  dedupedItems: NormalizedNewsItem[],
  config: CollectionConfig,
  warnings: CollectionWarning[]
): NormalizedNewsItem[] {
  const sorted = [...dedupedItems].sort((a, b) => b.scores.final - a.scores.final);
  const selected: NormalizedNewsItem[] = [];
  const selectedIds = new Set<string>();
  const rssItems = sorted.filter((item) => item.sourceType === "rss");

  if (rssItems.length < config.rssMinCandidates) {
    warnings.push({
      source: "quota",
      message: "RSS candidates are below the required minimum.",
      detail: `RSS accepted after rejection/dedupe: ${rssItems.length}; required: ${config.rssMinCandidates}.`
    });
  }

  for (const item of rssItems.slice(0, config.rssMinCandidates)) {
    selected.push(item);
    selectedIds.add(item.id);
  }

  for (const item of sorted) {
    if (selected.length >= config.targetCandidateCount) {
      break;
    }

    if (selectedIds.has(item.id)) {
      continue;
    }

    const globalCount = selected.filter(
      (candidate) => candidate.sourceType === "global_search"
    ).length;

    if (
      item.sourceType === "global_search" &&
      globalCount >= config.globalSearchMaxCandidates
    ) {
      continue;
    }

    selected.push(item);
    selectedIds.add(item.id);
  }

  return selected
    .sort((a, b) => b.scores.final - a.scores.final)
    .slice(0, config.targetCandidateCount);
}

function countByProvider(
  items: NormalizedNewsItem[] | RawNewsItem[],
  provider: "tavily" | "exa"
): number {
  return items.filter((item) => item.provider === provider).length;
}

function createStats(
  rawItems: RawNewsItem[],
  normalizedItems: NormalizedNewsItem[],
  dedupedItems: NormalizedNewsItem[],
  rejectedItems: NormalizedNewsItem[],
  candidates: NormalizedNewsItem[],
  apiRealCall: boolean
): NewsCollectionStats {
  return {
    rawCount: rawItems.length,
    rssRawCount: rawItems.filter((item) => item.sourceType === "rss").length,
    tavilyRawCount: countByProvider(rawItems, "tavily"),
    exaRawCount: countByProvider(rawItems, "exa"),
    normalizedCount: normalizedItems.length,
    dedupedCount: dedupedItems.length,
    hardRejectionCount: rejectedItems.length,
    finalCandidateCount: candidates.length,
    rssCandidateCount: candidates.filter((item) => item.sourceType === "rss").length,
    globalSearchCandidateCount: candidates.filter(
      (item) => item.sourceType === "global_search"
    ).length,
    tavilyCandidateCount: countByProvider(candidates, "tavily"),
    exaCandidateCount: countByProvider(candidates, "exa"),
    apiRealCall
  };
}

function createOutputFiles(outputDir: string): CollectionOutputFiles {
  return {
    rawNews: join(outputDir, "raw-news.json"),
    normalizedNews: join(outputDir, "normalized-news.json"),
    rejectedNews: join(outputDir, "rejected-news.json"),
    candidateNews: join(outputDir, "candidate-news.json"),
    collectionReport: join(outputDir, "collection-report.md")
  };
}

function buildCollection({
  rawItems,
  warnings,
  config,
  apiRealCall,
  now
}: BuildCollectionOptions): Omit<NewsCollectionResult, "outputDir" | "files"> {
  const normalizedItems = rawItems.map((item) => normalizeRawItem(item, now));
  const rejectedItems = normalizedItems.filter((item) => item.rejection);
  const acceptedItems = normalizedItems.filter((item) => !item.rejection);
  const dedupedItems = dedupeNews(acceptedItems);
  const candidates = selectCandidates(dedupedItems, config, warnings);
  const stats = createStats(
    rawItems,
    normalizedItems,
    dedupedItems,
    rejectedItems,
    candidates,
    apiRealCall
  );

  return {
    rawItems,
    normalizedItems,
    rejectedItems,
    dedupedItems,
    candidates,
    warnings,
    stats
  };
}

function createCollectionReport(result: NewsCollectionResult): string {
  const { stats, warnings } = result;
  const warningLines =
    warnings.length > 0
      ? warnings.map((warning) => {
          const detail = warning.detail ? ` (${warning.detail})` : "";
          return `- [${warning.source}] ${warning.message}${detail}`;
        })
      : ["- None"];

  return [
    "# AI News Collection Report",
    "",
    "## Counts",
    "",
    `- 原始抓取数量: ${stats.rawCount}`,
    `- RSS 原始数量: ${stats.rssRawCount}`,
    `- Tavily 原始数量: ${stats.tavilyRawCount}`,
    `- Exa 原始数量: ${stats.exaRawCount}`,
    `- normalize 后数量: ${stats.normalizedCount}`,
    `- 去重后数量: ${stats.dedupedCount}`,
    `- hard rejection 数量: ${stats.hardRejectionCount}`,
    `- 最终候选数量: ${stats.finalCandidateCount}`,
    `- RSS 候选数量: ${stats.rssCandidateCount}`,
    `- global_search 候选数量: ${stats.globalSearchCandidateCount}`,
    `- Tavily 候选数量: ${stats.tavilyCandidateCount}`,
    `- Exa 候选数量: ${stats.exaCandidateCount}`,
    `- API 是否真实调用: ${stats.apiRealCall ? "是" : "否"}`,
    "",
    "## Warnings",
    "",
    ...warningLines,
    "",
    "## Notes",
    "",
    "- RSS is treated as the primary source stream.",
    "- Tavily and Exa global_search results are candidate leads only; downstream fact work must verify original source URLs.",
    "- Missing URL, missing title, missing global_search provider/query, SEO aggregation, advertorial, stale non-high-heat items, low-trust sources, and non-AI items are hard rejected.",
    ""
  ].join("\n");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCollectionOutputs(result: NewsCollectionResult): Promise<void> {
  await mkdir(result.outputDir, { recursive: true });
  await writeJson(result.files.rawNews, result.rawItems);
  await writeJson(result.files.normalizedNews, result.normalizedItems);
  await writeJson(result.files.rejectedNews, result.rejectedItems);
  await writeJson(result.files.candidateNews, result.candidates);
  await writeFile(result.files.collectionReport, createCollectionReport(result), "utf8");
}

async function collectRawNews(
  options: CollectNewsOptions,
  config: CollectionConfig,
  now: Date,
  logger: Logger
): Promise<{
  rawItems: RawNewsItem[];
  warnings: CollectionWarning[];
  apiRealCall: boolean;
}> {
  if (options.rawItemsOverride) {
    return {
      rawItems: options.rawItemsOverride,
      warnings: [],
      apiRealCall: false
    };
  }

  const rssResult = options.useMockRss
    ? {
        items: createMockRssNews(now),
        warnings: [
          {
            source: "rss" as const,
            message: "Using mock RSS adapter because useMockRss=true."
          }
        ]
      }
    : !config.rssEnableRealFetch
      ? {
          items: [],
          warnings: [
            {
              source: "rss" as const,
              message: "Real RSS fetch is disabled and mock fallback is disabled."
            }
          ]
        }
      : await fetchRssNews(options.rssSourceList ?? rssSources, {
          fetchImpl: options.fetchImpl,
          logger,
          now,
          maxItemsPerSource: 8,
          timeoutMs: config.rssFetchTimeoutMs,
          retryCount: config.rssFetchRetry
        });

  const globalSearchResult = await searchGlobalNews({
    config,
    fetchImpl: options.fetchImpl,
    logger,
    now,
    allowMockFallback:
      options.env?.REAL_PRODUCTION_MODE?.trim().toLowerCase() !== "true"
  });

  return {
    rawItems: [...rssResult.items, ...globalSearchResult.items],
    warnings: [...rssResult.warnings, ...globalSearchResult.warnings],
    apiRealCall: globalSearchResult.apiRealCall
  };
}

export async function collectNewsWithReport(
  options: CollectNewsOptions = {}
): Promise<NewsCollectionResult> {
  const logger = options.logger ?? createLogger("news-collector");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const files = createOutputFiles(outputDir);
  const now = options.now ?? new Date();
  const config = readCollectionConfig(options.env);
  const writeOutputs = options.writeOutputs ?? true;
  const realProductionMode =
    options.env?.REAL_PRODUCTION_MODE?.trim().toLowerCase() === "true";
  const allowMockRssFallback = options.allowMockRssFallback ?? !realProductionMode;
  if (realProductionMode && options.useMockRss === true) {
    throw new Error("REAL_PRODUCTION_MODE=true forbids mock RSS fallback.");
  }

  const useMockRss = options.useMockRss ?? (!config.rssEnableRealFetch && !realProductionMode);

  logger.info("Collecting RSS and global search AI news candidates.");
  const rawCollection = await collectRawNews(
    {
      ...options,
      useMockRss
    },
    config,
    now,
    logger
  );

  let collection = buildCollection({
    ...rawCollection,
    config,
    now
  });

  if (
    allowMockRssFallback &&
    !options.useMockRss &&
    (collection.stats.rssCandidateCount < config.rssMinCandidates ||
      collection.stats.finalCandidateCount < config.targetCandidateCount)
  ) {
    const warning: CollectionWarning = {
      source: "rss",
      message:
        "RSS candidates were insufficient after real fetch; added mock RSS fallback items for dry-run continuity.",
      detail: `RSS candidates: ${collection.stats.rssCandidateCount}; final candidates: ${collection.stats.finalCandidateCount}.`
    };
    logger.warn(`${warning.message} ${warning.detail ?? ""}`.trim());

    const existingKeys = new Set(rawCollection.rawItems.map((item) => item.id));
    const mockFallback = createMockRssNews(now).filter(
      (item) => !existingKeys.has(item.id)
    ).map((item) => ({
      ...item,
      dataMode: "mock" as const,
      mock: true,
      mockReason: "rss_fallback"
    }));

    collection = buildCollection({
      rawItems: [...rawCollection.rawItems, ...mockFallback],
      warnings: [...rawCollection.warnings, warning],
      config,
      apiRealCall: rawCollection.apiRealCall,
      now
    });
  }

  requireSourceUrl(collection.candidates);

  const result: NewsCollectionResult = {
    outputDir,
    files,
    ...collection
  };

  if (writeOutputs) {
    await writeCollectionOutputs(result);
  }

  logger.info(
    `Collected ${result.stats.finalCandidateCount} candidates: ${result.stats.rssCandidateCount} RSS, ${result.stats.globalSearchCandidateCount} global_search.`
  );

  return result;
}

export async function collectNews(
  options: CollectNewsOptions = {}
): Promise<NewsItem[]> {
  const result = await collectNewsWithReport(options);
  return result.candidates;
}
