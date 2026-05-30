import {
  exaQueries,
  tavilyQueries,
  type CollectionConfig
} from "../config/sources.js";
import { createMockGlobalSearchNews } from "../mock/mockNews.js";
import type { CollectionWarning, RawNewsItem } from "../types/news.js";
import type { Logger } from "../utils/logger.js";
import { searchExa } from "./exa.js";
import { searchTavily } from "./tavily.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GlobalSearchOptions {
  config: CollectionConfig;
  fetchImpl?: FetchLike;
  logger?: Logger;
  now?: Date;
  allowMockFallback?: boolean;
}

export interface GlobalSearchResult {
  items: RawNewsItem[];
  warnings: CollectionWarning[];
  apiRealCall: boolean;
}

export async function searchGlobalNews(
  options: GlobalSearchOptions
): Promise<GlobalSearchResult> {
  const { config } = options;
  const now = options.now ?? new Date();
  const allowMockFallback = options.allowMockFallback ?? true;
  const warnings: CollectionWarning[] = [];
  let apiRealCall = false;

  const selectedTavilyQueries = tavilyQueries.slice(
    0,
    config.tavilyMaxQueriesPerRun
  );
  const selectedExaQueries = exaQueries.slice(0, config.exaMaxQueriesPerRun);

  const shouldUseRealTavily =
    config.searchEnableRealApi && Boolean(config.tavilyApiKey);
  const shouldUseRealExa =
    config.searchEnableRealApi && Boolean(config.exaApiKey);

  const tavilyPromise = shouldUseRealTavily
    ? searchTavily(selectedTavilyQueries, {
        apiKey: config.tavilyApiKey,
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        maxResultsPerQuery: config.searchMaxResultsPerQuery,
        lookbackHours: config.searchLookbackHours,
        timeoutMs: config.searchFetchTimeoutMs,
        retryCount: config.searchFetchRetry,
        now
      })
    : !allowMockFallback
      ? Promise.resolve({
          items: [],
          warnings: [
            {
              source: "tavily" as const,
              message:
                "Real Tavily search is unavailable and mock fallback is disabled."
            }
          ]
        })
    : Promise.resolve({
        items: createMockGlobalSearchNews(
          "tavily",
          selectedTavilyQueries,
          config.searchMaxResultsPerQuery,
          now
        ),
        warnings: [
          {
            source: "tavily" as const,
            message:
              "Using mock Tavily search adapter because real search is disabled or TAVILY_API_KEY is missing."
          }
        ]
      });

  const exaPromise = shouldUseRealExa
    ? searchExa(selectedExaQueries, {
        apiKey: config.exaApiKey,
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        maxResultsPerQuery: config.searchMaxResultsPerQuery,
        lookbackHours: config.searchLookbackHours,
        timeoutMs: config.searchFetchTimeoutMs,
        retryCount: config.searchFetchRetry,
        now
      })
    : !allowMockFallback
      ? Promise.resolve({
          items: [],
          warnings: [
            {
              source: "exa" as const,
              message:
                "Real Exa search is unavailable and mock fallback is disabled."
            }
          ]
        })
    : Promise.resolve({
        items: createMockGlobalSearchNews(
          "exa",
          selectedExaQueries,
          config.searchMaxResultsPerQuery,
          now
        ),
        warnings: [
          {
            source: "exa" as const,
            message:
              "Using mock Exa search adapter because real search is disabled or EXA_API_KEY is missing."
          }
        ]
      });

  const [tavilyResult, exaResult] = await Promise.all([
    tavilyPromise,
    exaPromise
  ]);

  if (shouldUseRealTavily || shouldUseRealExa) {
    apiRealCall = true;
  }

  warnings.push(...tavilyResult.warnings, ...exaResult.warnings);

  for (const warning of warnings) {
    options.logger?.warn(warning.detail ? `${warning.message}: ${warning.detail}` : warning.message);
  }

  return {
    items: [...tavilyResult.items, ...exaResult.items],
    warnings,
    apiRealCall
  };
}
