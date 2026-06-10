import { createHash } from "node:crypto";
import { getDomain } from "../config/scoring.js";
import type { CollectionWarning, RawNewsItem } from "../types/news.js";
import type { Logger } from "../utils/logger.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export interface ExaSearchOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
  logger?: Logger;
  maxResultsPerQuery: number;
  lookbackHours: number;
  timeoutMs?: number;
  retryCount?: number;
  now?: Date;
}

export interface ExaSearchResult {
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

function readSummary(record: UnknownRecord): string | undefined {
  const directSummary = readString(record, "summary") ?? readString(record, "text");
  if (directSummary) {
    return directSummary;
  }

  const highlights = record.highlights;
  if (Array.isArray(highlights)) {
    return highlights.filter((item) => typeof item === "string").join(" ");
  }

  return undefined;
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
  const snippet = readSummary(record);
  const publishedAt = normalizeDate(
    readString(record, "publishedDate") ??
      readString(record, "publishedAt") ??
      readString(record, "date")
  );
  const sourceNameCandidate =
    readString(record, "author") ??
    readString(record, "siteName") ??
    getDomain(url);
  const sourceName = sourceNameCandidate || "Exa result";

  return {
    id: createNewsId("exa", query, url, title, String(index)),
    sourceType: "global_search",
    provider: "exa",
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

async function fetchJsonWithTimeout(input: {
  fetchImpl: FetchLike;
  url: string;
  init: RequestInit;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    return await input.fetchImpl(input.url, {
      ...input.init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Exa search timed out after ${input.timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(input: {
  fetchImpl: FetchLike;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  retryCount: number;
}): Promise<Response> {
  const maxAttempts = Math.max(1, input.retryCount + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(input);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("unknown Exa API error");
}

export async function searchExa(
  queries: string[],
  options: ExaSearchOptions
): Promise<ExaSearchResult> {
  const warnings: CollectionWarning[] = [];

  if (!options.apiKey) {
    const warning: CollectionWarning = {
      source: "exa",
      message: "Exa API key is missing; skipped real Exa search."
    };
    warnings.push(warning);
    options.logger?.warn(warning.message);
    return { items: [], warnings };
  }

  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retryCount = options.retryCount ?? 1;
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const startPublishedDate = new Date(
    (options.now ?? new Date()).getTime() - options.lookbackHours * 3_600_000
  ).toISOString();

  const batches = await Promise.all(
    queries.map(async (query) => {
      try {
        const response = await fetchJsonWithRetry({
          fetchImpl,
          url: "https://api.exa.ai/search",
          timeoutMs,
          retryCount,
          init: {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              query,
              numResults: options.maxResultsPerQuery,
              type: "neural",
              startPublishedDate,
              contents: {
                text: true,
                highlights: true,
                summary: true
              }
            })
          }
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
          error instanceof Error ? error.message : "unknown Exa API error";
        const warning: CollectionWarning = {
          source: "exa",
          message: `Exa search failed for query: ${query}`,
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
