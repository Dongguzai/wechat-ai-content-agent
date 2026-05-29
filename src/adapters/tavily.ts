import { createHash } from "node:crypto";
import { getDomain } from "../config/scoring.js";
import type { CollectionWarning, RawNewsItem } from "../types/news.js";
import type { Logger } from "../utils/logger.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export interface TavilySearchOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
  logger?: Logger;
  maxResultsPerQuery: number;
  lookbackHours: number;
  now?: Date;
}

export interface TavilySearchResult {
  items: RawNewsItem[];
  warnings: CollectionWarning[];
}

function createNewsId(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 16);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeResult(
  query: string,
  result: unknown,
  fetchedAt: string,
  index: number
): RawNewsItem | undefined {
  const record = asRecord(result);
  if (!record) {
    return undefined;
  }

  const url = readString(record, "url") ?? "";
  const title = readString(record, "title") ?? "";
  const snippet =
    readString(record, "content") ??
    readString(record, "snippet") ??
    readString(record, "raw_content");
  const publishedAt = normalizeDate(
    readString(record, "published_date") ??
      readString(record, "publishedAt") ??
      readString(record, "date")
  ) ?? fetchedAt;
  const sourceNameCandidate =
    readString(record, "source") ??
    readString(record, "site_name") ??
    getDomain(url);
  const sourceName = sourceNameCandidate || "Tavily result";

  return {
    id: createNewsId("tavily", query, url, title, String(index)),
    sourceType: "global_search",
    provider: "tavily",
    query,
    title,
    url,
    snippet,
    sourceName,
    publishedAt,
    fetchedAt,
    rawContent: snippet
  };
}

export async function searchTavily(
  queries: string[],
  options: TavilySearchOptions
): Promise<TavilySearchResult> {
  const warnings: CollectionWarning[] = [];

  if (!options.apiKey) {
    const warning: CollectionWarning = {
      source: "tavily",
      message: "Tavily API key is missing; skipped real Tavily search."
    };
    warnings.push(warning);
    options.logger?.warn(warning.message);
    return { items: [], warnings };
  }

  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const days = Math.max(1, Math.ceil(options.lookbackHours / 24));
  const batches = await Promise.all(
    queries.map(async (query) => {
      try {
        const response = await fetchImpl("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            query,
            max_results: options.maxResultsPerQuery,
            search_depth: "advanced",
            include_answer: false,
            include_raw_content: false,
            days
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const payload = (await response.json()) as UnknownRecord;
        const results = Array.isArray(payload.results) ? payload.results : [];

        return results
          .slice(0, options.maxResultsPerQuery)
          .map((result, index) => normalizeResult(query, result, fetchedAt, index))
          .filter((item): item is RawNewsItem => Boolean(item));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown Tavily API error";
        const warning: CollectionWarning = {
          source: "tavily",
          message: `Tavily search failed for query: ${query}`,
          detail: message
        };
        warnings.push(warning);
        options.logger?.warn(`${warning.message}: ${message}`);
        return [];
      }
    })
  );

  return {
    items: batches.flat(),
    warnings
  };
}
