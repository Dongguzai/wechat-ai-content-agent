import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchExa } from "../adapters/exa.js";
import { fetchRssNews } from "../adapters/rss.js";
import { searchTavily } from "../adapters/tavily.js";
import {
  exaQueries,
  readCollectionConfig,
  rssSources,
  tavilyQueries,
  type RssSourceConfig
} from "../config/sources.js";
import type {
  SourceHealthCheck,
  SourceHealthOutputFiles,
  SourceHealthProvider,
  SourceHealthResult,
  SourceHealthSourceResult
} from "../types/sourceHealth.js";
import { createLogger, type Logger } from "../utils/logger.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CheckSourceHealthOptions {
  outputDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  fetchImpl?: FetchLike;
  now?: Date;
  rssSourceList?: RssSourceConfig[];
  writeOutputs?: boolean;
}

interface TimedSourceResult {
  itemCount: number;
  error: string | null;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function createOutputFiles(outputDir: string): SourceHealthOutputFiles {
  return {
    result: join(outputDir, "source-health.json"),
    report: join(outputDir, "source-health-report.md")
  };
}

function isRealProductionMode(env: NodeJS.ProcessEnv): boolean {
  return env.REAL_PRODUCTION_MODE?.trim().toLowerCase() === "true";
}

function joinWarnings(warnings: Array<{ message: string; detail?: string }>): string | null {
  const message = warnings
    .map((warning) => warning.detail ? `${warning.message}: ${warning.detail}` : warning.message)
    .join(" | ");

  return message || null;
}

function disabledSearchError(input: {
  provider: "Tavily" | "Exa";
  searchEnabled: boolean;
  apiKey?: string;
}): string {
  if (!input.searchEnabled) {
    return `SEARCH_ENABLE_REAL_API=false; real ${input.provider} source disabled.`;
  }

  if (!input.apiKey?.trim()) {
    return `${input.provider.toUpperCase()}_API_KEY missing; real ${input.provider} source disabled.`;
  }

  return `Real ${input.provider} source disabled.`;
}

async function timed<T>(
  action: () => Promise<T>,
  summarize: (value: T) => TimedSourceResult
): Promise<TimedSourceResult & { durationMs: number }> {
  const startedAt = Date.now();

  try {
    const result = summarize(await action());
    return {
      ...result,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      itemCount: 0,
      error: error instanceof Error ? error.message : "unknown source health error",
      durationMs: Date.now() - startedAt
    };
  }
}

function createSourceRecord(input: {
  provider: SourceHealthProvider;
  enabled: boolean;
  attempted: boolean;
  itemCount: number;
  error: string | null;
  durationMs: number;
  fallbackAllowed: boolean;
}): SourceHealthSourceResult {
  const success = input.attempted && input.itemCount > 0;

  return {
    provider: input.provider,
    enabled: input.enabled,
    attempted: input.attempted,
    success,
    itemCount: input.itemCount,
    error: success ? null : input.error,
    durationMs: input.durationMs,
    usedFallback: input.fallbackAllowed && !success
  };
}

function makeCheck(
  name: string,
  passed: boolean,
  message: string,
  details: string[] = []
): SourceHealthCheck {
  return {
    name,
    passed,
    message,
    details
  };
}

function createReport(result: SourceHealthResult): string {
  const sourceLines = result.sources.map((source) => [
    `- provider: ${source.provider}`,
    `  - enabled: ${source.enabled}`,
    `  - attempted: ${source.attempted}`,
    `  - success: ${source.success}`,
    `  - itemCount: ${source.itemCount}`,
    `  - durationMs: ${source.durationMs}`,
    `  - usedFallback: ${source.usedFallback}`,
    `  - error: ${source.error ?? "none"}`
  ].join("\n"));
  const checkLines = result.checks.flatMap((check) => [
    `- ${check.passed ? "pass" : "block"}: ${check.name} - ${check.message}`,
    ...check.details.map((detail) => `  - ${detail}`)
  ]);
  const issueLines =
    result.issues.length > 0 ? result.issues.map((issue) => `- ${issue}`) : ["- none"];
  const warningLines =
    result.warnings.length > 0
      ? result.warnings.map((warning) => `- ${warning}`)
      : ["- none"];

  return [
    "# Source Health Report",
    "",
    "## Result",
    "",
    `- passed: ${result.passed}`,
    `- generatedAt: ${result.generatedAt}`,
    `- realProductionMode: ${result.summary.realProductionMode}`,
    `- fallbackAllowed: ${result.summary.fallbackAllowed}`,
    "",
    "## Summary",
    "",
    `- totalRealNewsItems: ${result.summary.totalRealNewsItems}`,
    `- realRssItems: ${result.summary.realRssItems}`,
    `- realSearchItems: ${result.summary.realSearchItems}`,
    `- MIN_REAL_NEWS_ITEMS: ${result.summary.thresholds.minRealNewsItems}`,
    `- MIN_REAL_RSS_ITEMS: ${result.summary.thresholds.minRealRssItems}`,
    `- MIN_REAL_SEARCH_ITEMS: ${result.summary.thresholds.minRealSearchItems}`,
    "",
    "## Sources",
    "",
    ...sourceLines,
    "",
    "## Checks",
    "",
    ...checkLines,
    "",
    "## Blocking Issues",
    "",
    ...issueLines,
    "",
    "## Warnings",
    "",
    ...warningLines,
    "",
    "## Boundary",
    "",
    "- Development mode may continue with mock fallback for dry-run continuity.",
    "- REAL_PRODUCTION_MODE=true only passes when real RSS/search counts meet thresholds.",
    "- Source health does not call WeChat APIs, publish APIs, mass-send APIs, or APIMart.",
    ""
  ].join("\n");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function checkSourceHealthWithReport(
  options: CheckSourceHealthOptions = {}
): Promise<SourceHealthResult> {
  const logger = options.logger ?? createLogger("source-health");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const config = readCollectionConfig(env);
  const realProductionMode = isRealProductionMode(env);
  const fallbackAllowed = !realProductionMode;
  const files = createOutputFiles(outputDir);

  logger.info("Checking source health for RSS, Tavily, and Exa.");

  const rssHealth = config.rssEnableRealFetch
    ? await timed(
        () =>
          fetchRssNews(options.rssSourceList ?? rssSources, {
            fetchImpl: options.fetchImpl,
            logger,
            maxItemsPerSource: 8,
            timeoutMs: config.rssFetchTimeoutMs,
            retryCount: config.rssFetchRetry,
            now
          }),
        (result) => ({
          itemCount: result.items.length,
          error: result.items.length > 0 ? null : joinWarnings(result.warnings)
        })
      )
    : {
        itemCount: 0,
        error: "RSS_ENABLE_REAL_FETCH=false; real RSS source disabled.",
        durationMs: 0
      };

  const selectedTavilyQueries = tavilyQueries.slice(
    0,
    config.tavilyMaxQueriesPerRun
  );
  const selectedExaQueries = exaQueries.slice(0, config.exaMaxQueriesPerRun);
  const tavilyEnabled = config.searchEnableRealApi && Boolean(config.tavilyApiKey);
  const exaEnabled = config.searchEnableRealApi && Boolean(config.exaApiKey);

  const tavilyHealth = tavilyEnabled
    ? await timed(
        () =>
          searchTavily(selectedTavilyQueries, {
            apiKey: config.tavilyApiKey,
            fetchImpl: options.fetchImpl,
            logger,
            maxResultsPerQuery: config.searchMaxResultsPerQuery,
            lookbackHours: config.searchLookbackHours,
            timeoutMs: config.searchFetchTimeoutMs,
            retryCount: config.searchFetchRetry,
            now
          }),
        (result) => ({
          itemCount: result.items.length,
          error: result.items.length > 0 ? null : joinWarnings(result.warnings)
        })
      )
    : {
        itemCount: 0,
        error: disabledSearchError({
          provider: "Tavily",
          searchEnabled: config.searchEnableRealApi,
          apiKey: config.tavilyApiKey
        }),
        durationMs: 0
      };

  const exaHealth = exaEnabled
    ? await timed(
        () =>
          searchExa(selectedExaQueries, {
            apiKey: config.exaApiKey,
            fetchImpl: options.fetchImpl,
            logger,
            maxResultsPerQuery: config.searchMaxResultsPerQuery,
            lookbackHours: config.searchLookbackHours,
            timeoutMs: config.searchFetchTimeoutMs,
            retryCount: config.searchFetchRetry,
            now
          }),
        (result) => ({
          itemCount: result.items.length,
          error: result.items.length > 0 ? null : joinWarnings(result.warnings)
        })
      )
    : {
        itemCount: 0,
        error: disabledSearchError({
          provider: "Exa",
          searchEnabled: config.searchEnableRealApi,
          apiKey: config.exaApiKey
        }),
        durationMs: 0
      };

  const sources: SourceHealthSourceResult[] = [
    createSourceRecord({
      provider: "rss",
      enabled: config.rssEnableRealFetch,
      attempted: config.rssEnableRealFetch,
      fallbackAllowed,
      ...rssHealth
    }),
    createSourceRecord({
      provider: "tavily",
      enabled: tavilyEnabled,
      attempted: tavilyEnabled,
      fallbackAllowed,
      ...tavilyHealth
    }),
    createSourceRecord({
      provider: "exa",
      enabled: exaEnabled,
      attempted: exaEnabled,
      fallbackAllowed,
      ...exaHealth
    })
  ];
  const realRssItems = sources.find((source) => source.provider === "rss")?.itemCount ?? 0;
  const realSearchItems = sources
    .filter((source) => source.provider === "tavily" || source.provider === "exa")
    .reduce((sum, source) => sum + source.itemCount, 0);
  const totalRealNewsItems = realRssItems + realSearchItems;
  const summary = {
    realProductionMode,
    fallbackAllowed,
    totalRealNewsItems,
    realRssItems,
    realSearchItems,
    thresholds: {
      minRealNewsItems: config.minRealNewsItems,
      minRealRssItems: config.minRealRssItems,
      minRealSearchItems: config.minRealSearchItems
    }
  };
  const productionChecks = realProductionMode
    ? [
        makeCheck(
          "minimum real news items",
          totalRealNewsItems >= config.minRealNewsItems,
          "REAL_PRODUCTION_MODE=true requires enough real news items.",
          [`totalRealNewsItems=${totalRealNewsItems}`, `required=${config.minRealNewsItems}`]
        ),
        makeCheck(
          "minimum real RSS items",
          realRssItems >= config.minRealRssItems,
          "REAL_PRODUCTION_MODE=true requires enough real RSS items.",
          [`realRssItems=${realRssItems}`, `required=${config.minRealRssItems}`]
        ),
        makeCheck(
          "minimum real search items",
          realSearchItems >= config.minRealSearchItems,
          "REAL_PRODUCTION_MODE=true requires enough real Tavily/Exa search items.",
          [`realSearchItems=${realSearchItems}`, `required=${config.minRealSearchItems}`]
        ),
        makeCheck(
          "mock fallback not used",
          sources.every((source) => !source.usedFallback),
          "REAL_PRODUCTION_MODE=true forbids mock fallback for source health.",
          sources
            .filter((source) => source.usedFallback)
            .map((source) => `${source.provider} used fallback`)
        )
      ]
    : [
        makeCheck(
          "development fallback allowed",
          true,
          "REAL_PRODUCTION_MODE=false may continue with mock fallback."
        )
      ];
  const sourceChecks = sources.map((source) =>
    makeCheck(
      `${source.provider} health recorded`,
      true,
      `${source.provider} health was checked and recorded.`,
      [
        `enabled=${source.enabled}`,
        `attempted=${source.attempted}`,
        `success=${source.success}`,
        `itemCount=${source.itemCount}`,
        `usedFallback=${source.usedFallback}`
      ]
    )
  );
  const checks = [...sourceChecks, ...productionChecks];
  const issues = checks
    .filter((check) => !check.passed)
    .map((check) => `${check.name}: ${check.message}`);
  const warnings = !realProductionMode
    ? sources
        .filter((source) => source.usedFallback)
        .map((source) => `${source.provider}: ${source.error ?? "mock fallback used"}`)
    : [];
  const result: SourceHealthResult = {
    passed: issues.length === 0,
    generatedAt,
    outputDir,
    sources,
    summary,
    checks,
    issues,
    warnings,
    files
  };
  const report = createReport(result);

  if (options.writeOutputs ?? true) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.result, result);
    await writeFile(files.report, report, "utf8");
  }

  logger.info(
    `Source health ${result.passed ? "passed" : "blocked"}; realItems=${totalRealNewsItems}; rss=${realRssItems}; search=${realSearchItems}.`
  );

  return result;
}

export async function checkSourceHealth(
  options: CheckSourceHealthOptions = {}
): Promise<SourceHealthSourceResult[]> {
  const result = await checkSourceHealthWithReport(options);
  return result.sources;
}
