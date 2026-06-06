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
import { checkChineseNewsLanguage } from "../hooks/requireChineseNewsLanguage.js";
import { requireSourceUrl } from "../hooks/requireSourceUrl.js";
import { createMockRssNews } from "../mock/mockNews.js";
import {
  detectNewsSourceLanguage,
  localizeNewsItem
} from "./localizeNewsItem.js";
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
  env: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  outputDir: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function trimText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function positiveIntegerFromEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number,
  maxValue: number
): number {
  const rawValue = env[key]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    return defaultValue;
  }

  return Math.min(value, maxValue);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
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
  detail?: string,
  stage: NewsRejection["stage"] = "basic"
): NewsRejection {
  return {
    hard: true,
    reason,
    detail,
    stage,
    rejectedAt: now.toISOString()
  };
}

function evaluateBasicRejection(
  raw: RawNewsItem,
  normalized: Omit<NormalizedNewsItem, "rejection">,
  now: Date
): NewsRejection | undefined {
  const title = normalized.title;
  const url = normalized.url;
  const summary = normalized.summary;
  const text = `${title} ${summary} ${raw.rawContent ?? ""}`;

  if (raw.sourceType === "global_search") {
    if (!raw.provider || raw.provider === "none") {
      return createRejection(
        "global_search_missing_provider",
        now,
        "Global search result must include provider."
      );
    }

    if (!raw.query) {
      return createRejection(
        "global_search_missing_query",
        now,
        "Global search result must include query."
      );
    }

    if (!url && raw.snippet) {
      return createRejection(
        "snippet_only_without_url",
        now,
        "Global search result has a snippet but no original source URL."
      );
    }
  }

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
      "snippet_only_without_url",
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
      "low_trust_domain",
      now,
      `Low-trust domain: ${getDomain(url)}.`
    );
  }

  if (!containsAiSignal(text)) {
    return createRejection("not_ai_related", now);
  }

  return undefined;
}

function evaluateEditorialRejection(
  normalized: Omit<NormalizedNewsItem, "rejection">,
  now: Date
): NewsRejection | undefined {
  const titleZh = trimText(normalized.titleZh ?? normalized.title);
  const summaryZh = trimText(normalized.summaryZh ?? normalized.summary);
  const topicAngleZh = trimText(normalized.topicAngleZh);
  const shortlistReasonZh = trimText(normalized.shortlistReasonZh);
  const riskNotesZh = normalized.riskNotesZh?.join(" ") ?? "";

  if (summaryZh.length < 18) {
    return createRejection(
      "unclear_summary",
      now,
      "Localized Chinese summary is too short or unclear.",
      "editorial"
    );
  }

  if (topicAngleZh.length < 28) {
    return createRejection(
      "weak_topic_angle",
      now,
      "Localized topic angle is too weak for WeChat editorial screening.",
      "editorial"
    );
  }

  if (normalized.scores.wechatTopic < 30) {
    return createRejection(
      "low_wechat_fit",
      now,
      `wechatTopic score is too low: ${normalized.scores.wechatTopic}.`,
      "editorial"
    );
  }

  const languageCheck = checkChineseNewsLanguage({
    title: titleZh,
    summary: summaryZh,
    rawContent: [topicAngleZh, shortlistReasonZh, riskNotesZh]
      .filter(Boolean)
      .join(" ")
  });

  if (!languageCheck.passed) {
    return createRejection(
      "not_suitable_for_chinese_reader",
      now,
      "Localized fields still contain untranslated language or lack Chinese text.",
      "editorial"
    );
  }

  return undefined;
}

function normalizeRawItemBase(
  raw: RawNewsItem,
  now: Date
): Omit<NormalizedNewsItem, "rejection"> {
  const title = trimText(raw.title);
  const url = trimText(raw.url);
  const summary = summarize(raw);
  const category = inferCategory(`${title} ${summary} ${raw.rawContent ?? ""}`);
  const scores = scoreNewsItem(raw, category, now);
  const duplicateKey = url
    ? normalizeUrl(url)
    : `title:${titleFingerprint(title)}`;
  return {
    id: raw.id,
    dataMode: raw.dataMode ?? (raw.mock ? "mock" : "real"),
    mock: raw.mock === true || raw.dataMode === "mock",
    mockReason: raw.mockReason,
    title,
    rawTitle: title,
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
    rawSummary: summary,
    sourceLanguage: detectNewsSourceLanguage({
      title,
      summary,
      snippet: raw.snippet
    }),
    localized: false,
    localizationStatus: "not_required",
    category,
    evidence: evidenceFor(raw),
    duplicateKey,
    scores,
    duplicateSources: [],
    tags: tagsFor(`${title} ${summary}`)
  };
}

async function normalizeRawItem(
  raw: RawNewsItem,
  now: Date,
  options: Pick<BuildCollectionOptions, "env" | "fetchImpl" | "outputDir">
): Promise<NormalizedNewsItem> {
  const normalizedBase = normalizeRawItemBase(raw, now);
  const basicRejection = evaluateBasicRejection(raw, normalizedBase, now);

  if (basicRejection) {
    return { ...normalizedBase, rejection: basicRejection };
  }

  try {
    const localized = await localizeNewsItem(
      {
        title: normalizedBase.rawTitle ?? normalizedBase.title,
        summary: normalizedBase.rawSummary ?? normalizedBase.summary,
        snippet: raw.snippet,
        url: normalizedBase.url,
        sourceName: normalizedBase.sourceName,
        sourceType: normalizedBase.sourceType,
        provider: normalizedBase.provider,
        query: normalizedBase.query
      },
      {
        env: options.env,
        fetchImpl: options.fetchImpl,
        outputDir: options.outputDir
      }
    );
    const localizedItem: Omit<NormalizedNewsItem, "rejection"> = {
      ...normalizedBase,
      title: localized.titleZh,
      summary: localized.summaryZh,
      sourceLanguage: localized.sourceLanguage,
      rawTitle: localized.rawTitle,
      rawSummary: localized.rawSummary,
      titleZh: localized.titleZh,
      summaryZh: localized.summaryZh,
      topicAngleZh: localized.topicAngleZh,
      shortlistReasonZh: localized.shortlistReasonZh,
      riskNotesZh: localized.riskNotesZh,
      localized: localized.localized,
      localizationStatus: localized.localized ? "localized" : "not_required",
      tags: tagsFor(
        `${localized.titleZh} ${localized.summaryZh} ${normalizedBase.rawTitle ?? ""} ${
          normalizedBase.rawSummary ?? ""
        }`
      )
    };
    const editorialRejection = evaluateEditorialRejection(localizedItem, now);

    return editorialRejection
      ? { ...localizedItem, rejection: editorialRejection }
      : localizedItem;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown localization error.";

    return {
      ...normalizedBase,
      localizationStatus: "failed",
      rejection: createRejection("localization_failed", now, detail, "localization")
    };
  }
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
  const basicRejectionCount = rejectedItems.filter(
    (item) => item.rejection?.stage === "basic"
  ).length;
  const localizationFailedCount = rejectedItems.filter(
    (item) => item.rejection?.reason === "localization_failed"
  ).length;
  const rejectedAfterLocalizationCount = rejectedItems.filter(
    (item) => item.rejection?.stage === "editorial"
  ).length;

  return {
    rawCount: rawItems.length,
    realSourceCount: rawItems.filter(
      (item) => item.dataMode !== "mock" && item.mock !== true
    ).length,
    rssRawCount: rawItems.filter((item) => item.sourceType === "rss").length,
    tavilyRawCount: countByProvider(rawItems, "tavily"),
    exaRawCount: countByProvider(rawItems, "exa"),
    normalizedCount: normalizedItems.length,
    dedupedCount: dedupedItems.length,
    hardRejectionCount: rejectedItems.length,
    basicRejectionCount,
    localizedCount: normalizedItems.filter((item) => item.localized === true).length,
    localizationFailedCount,
    rejectedAfterLocalizationCount,
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

async function buildCollection({
  rawItems,
  warnings,
  config,
  apiRealCall,
  now,
  env,
  fetchImpl,
  outputDir
}: BuildCollectionOptions): Promise<Omit<NewsCollectionResult, "outputDir" | "files">> {
  const localizationConcurrency = positiveIntegerFromEnv(
    env,
    "NEWS_LOCALIZER_CONCURRENCY",
    4,
    8
  );
  const normalizedItems = await mapWithConcurrency(
    rawItems,
    localizationConcurrency,
    async (item) =>
      await normalizeRawItem(item, now, {
        env,
        fetchImpl,
        outputDir
      })
  );

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
    `- 真实源数量: ${stats.realSourceCount ?? 0}`,
    `- RSS 原始数量: ${stats.rssRawCount}`,
    `- Tavily 原始数量: ${stats.tavilyRawCount}`,
    `- Exa 原始数量: ${stats.exaRawCount}`,
    `- normalize 后数量: ${stats.normalizedCount}`,
    `- 去重后数量: ${stats.dedupedCount}`,
    `- hard rejection 数量: ${stats.hardRejectionCount}`,
    `- basic rejection 数量: ${stats.basicRejectionCount ?? 0}`,
    `- 中文化完成数量: ${stats.localizedCount ?? 0}`,
    `- 中文化失败数量: ${stats.localizationFailedCount ?? 0}`,
    `- 中文化后编辑拒绝数量: ${stats.rejectedAfterLocalizationCount ?? 0}`,
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
    "- Basic rejection runs before localization: missing URL/title, missing global_search provider/query, snippet-only search leads, SEO aggregation, advertorial, stale non-high-heat items, low-trust sources, and non-AI items are rejected.",
    "- English RSS/Tavily/Exa source items are allowed into basic filtering, then localized into Chinese fields before WeChat editorial screening.",
    "- Editorial rejection runs after localization: weak_topic_angle, low_wechat_fit, unclear_summary, and not_suitable_for_chinese_reader.",
    "- Candidate display should prefer titleZh/summaryZh/topicAngleZh/shortlistReasonZh while preserving rawTitle/rawSummary and the original URL.",
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

  let collection = await buildCollection({
    ...rawCollection,
    config,
    now,
    env: options.env ?? process.env,
    fetchImpl: options.fetchImpl,
    outputDir
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

    collection = await buildCollection({
      rawItems: [...rawCollection.rawItems, ...mockFallback],
      warnings: [...rawCollection.warnings, warning],
      config,
      apiRealCall: rawCollection.apiRealCall,
      now,
      env: options.env ?? process.env,
      fetchImpl: options.fetchImpl,
      outputDir
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
