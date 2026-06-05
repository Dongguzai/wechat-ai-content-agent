import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockNews } from "../mock/mockNews.js";
import type { ArticleMeta } from "../types/article.js";
import type { CoverResult } from "../types/cover.js";
import type { TopicFactPack } from "../types/factPack.js";
import type {
  NormalizedNewsItem,
  SelectedTopic,
  ShortlistedNewsItem
} from "../types/news.js";
import type {
  RealDataAuditCheck,
  RealDataAuditOutputFiles,
  RealDataAuditResult,
  RealDataAuditSeverity,
  RealDataAuditSummary
} from "../types/realDataAudit.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface AuditRealDataOptions {
  outputDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  now?: Date;
  writeOutputs?: boolean;
}

interface LoadedAuditArtifacts {
  rawItems: NormalizedNewsItem[];
  normalizedItems: NormalizedNewsItem[];
  rejectedItems: NormalizedNewsItem[];
  candidates: NormalizedNewsItem[];
  shortlisted: ShortlistedNewsItem[];
  selectedTopic?: SelectedTopic;
  factPack?: TopicFactPack;
  articleMeta?: ArticleMeta;
  cover?: CoverResult;
  collectionReport?: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const mockRssIds = new Set(mockNews.map((item) => item.id));

function createOutputFiles(outputDir: string): RealDataAuditOutputFiles {
  return {
    result: join(outputDir, "real-data-audit.json"),
    report: join(outputDir, "real-data-audit-report.md")
  };
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeUrl(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const serialized = parsed.toString();
    return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
  } catch {
    return value.trim().toLowerCase();
  }
}

function hostnameFromUrl(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isSearchProviderUrl(value: string): boolean {
  const host = hostnameFromUrl(value);
  return ["google.com", "bing.com", "search.yahoo.com", "tavily.com", "exa.ai"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

function isRealHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      host !== "example.com" &&
      !host.endsWith(".example.com") &&
      host !== "localhost" &&
      !host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function isMockNewsItem(item: Pick<NormalizedNewsItem, "id" | "dataMode" | "mock" | "mockReason" | "sourceName">): boolean {
  return (
    item.mock === true ||
    item.dataMode === "mock" ||
    Boolean(item.mockReason) ||
    mockRssIds.has(item.id) ||
    item.id.startsWith("mock-") ||
    /\bmock\b/i.test(item.sourceName)
  );
}

function hasSourceUrls(value: { sourceUrls?: unknown }): boolean {
  return (
    Array.isArray(value.sourceUrls) &&
    value.sourceUrls.length > 0 &&
    value.sourceUrls.every((url) => typeof url === "string" && isRealHttpUrl(url))
  );
}

function uniqueSourceUrls(input: {
  factPack?: TopicFactPack;
  articleMeta?: ArticleMeta;
}): string[] {
  const urls = [
    ...(input.factPack?.verifiedClaims.flatMap((claim) => claim.sourceUrls) ?? []),
    ...(input.articleMeta?.usedClaims.flatMap((claim) => claim.sourceUrls) ?? [])
  ];

  return [...new Set(urls.filter(isRealHttpUrl).map(normalizeUrl))];
}

function isPngOrJpegPath(path: string): boolean {
  return /\.(?:png|jpe?g)$/i.test(path);
}

function isMockCover(cover: CoverResult | undefined): boolean {
  if (!cover) {
    return true;
  }

  const extension = extname(cover.imagePath).toLowerCase();
  return (
    cover.mode !== "real" ||
    extension === ".svg" ||
    /\bmock\b/i.test(basename(cover.imagePath))
  );
}

function makeCheck(input: {
  name: string;
  passed: boolean;
  severity: RealDataAuditSeverity;
  message: string;
  details?: string[];
}): RealDataAuditCheck {
  return {
    name: input.name,
    passed: input.passed,
    severity: input.severity,
    message: input.message,
    details: input.details ?? []
  };
}

function productionSeverity(realProductionMode: boolean): RealDataAuditSeverity {
  return realProductionMode ? "blocker" : "warning";
}

function productionPassed(realProductionMode: boolean, passed: boolean): boolean {
  return realProductionMode ? passed : passed;
}

async function loadArtifacts(outputDir: string): Promise<LoadedAuditArtifacts> {
  return {
    rawItems:
      (await readOptionalJsonFile<NormalizedNewsItem[]>(
        join(outputDir, "raw-news.json")
      )) ?? [],
    normalizedItems:
      (await readOptionalJsonFile<NormalizedNewsItem[]>(
        join(outputDir, "normalized-news.json")
      )) ?? [],
    rejectedItems:
      (await readOptionalJsonFile<NormalizedNewsItem[]>(
        join(outputDir, "rejected-news.json")
      )) ?? [],
    candidates:
      (await readOptionalJsonFile<NormalizedNewsItem[]>(
        join(outputDir, "candidate-news.json")
      )) ?? [],
    shortlisted:
      (await readOptionalJsonFile<ShortlistedNewsItem[]>(
        join(outputDir, "shortlisted-news.json")
      )) ?? [],
    selectedTopic: await readOptionalJsonFile<SelectedTopic>(
      join(outputDir, "selected-topic.json")
    ),
    factPack: await readOptionalJsonFile<TopicFactPack>(
      join(outputDir, "topic-fact-pack.json")
    ),
    articleMeta: await readOptionalJsonFile<ArticleMeta>(
      join(outputDir, "article-meta.json")
    ),
    cover: await readOptionalJsonFile<CoverResult>(join(outputDir, "cover.json")),
    collectionReport: await readOptionalTextFile(join(outputDir, "collection-report.md"))
  };
}

function createSummary(artifacts: LoadedAuditArtifacts): RealDataAuditSummary {
  const realCandidates = artifacts.candidates.filter((item) => !isMockNewsItem(item));
  const mockCandidates = artifacts.candidates.filter(isMockNewsItem);
  const mockShortlisted = artifacts.shortlisted.filter(isMockNewsItem);
  const sourceItems =
    artifacts.rawItems.length > 0 ? artifacts.rawItems : artifacts.normalizedItems;
  const mockFallbackDetected =
    artifacts.candidates.some((item) => item.mockReason === "rss_fallback") ||
    /mock rss fallback|fallback items|added mock/i.test(
      artifacts.collectionReport ?? ""
    );

  return {
    candidateCount: artifacts.candidates.length,
    shortlistedCount: artifacts.shortlisted.length,
    realSourceCount: sourceItems.filter((item) => !isMockNewsItem(item)).length,
    localizedCount: artifacts.normalizedItems.filter((item) => item.localized === true)
      .length,
    localizationFailedCount: artifacts.rejectedItems.filter(
      (item) => item.rejection?.reason === "localization_failed"
    ).length,
    rejectedAfterLocalizationCount: artifacts.rejectedItems.filter(
      (item) => item.rejection?.stage === "editorial"
    ).length,
    realRssCandidateCount: realCandidates.filter((item) => item.sourceType === "rss")
      .length,
    realTavilyCandidateCount: realCandidates.filter(
      (item) => item.sourceType === "global_search" && item.provider === "tavily"
    ).length,
    realExaCandidateCount: realCandidates.filter(
      (item) => item.sourceType === "global_search" && item.provider === "exa"
    ).length,
    mockCandidateCount: mockCandidates.length,
    mockShortlistedCount: mockShortlisted.length,
    mockSearchCandidateCount: mockCandidates.filter(
      (item) => item.sourceType === "global_search"
    ).length,
    mockRssCandidateCount: mockCandidates.filter((item) => item.sourceType === "rss")
      .length,
    mockFallbackDetected,
    coverMode: artifacts.cover?.mode ?? "missing",
    coverImagePath: artifacts.cover?.imagePath ?? ""
  };
}

function buildChecks(input: {
  artifacts: LoadedAuditArtifacts;
  summary: RealDataAuditSummary;
  realProductionMode: boolean;
}): RealDataAuditCheck[] {
  const { artifacts, realProductionMode, summary } = input;
  const selected = artifacts.selectedTopic?.selected;
  const selectedUrl = selected?.url ?? "";
  const selectedIsMock = selected ? isMockNewsItem(selected) : true;
  const selectedReliability = selected?.selection.sourceReliability ?? "missing";
  const factClaims = artifacts.factPack?.verifiedClaims ?? [];
  const usedClaims = artifacts.articleMeta?.usedClaims ?? [];
  const finalFactUrls = uniqueSourceUrls({
    factPack: artifacts.factPack,
    articleMeta: artifacts.articleMeta
  });
  const selectedUrlKey = normalizeUrl(selectedUrl);
  const independentFactUrls = finalFactUrls.filter(
    (url) => url !== selectedUrlKey && !isSearchProviderUrl(url)
  );
  const selectedFromGlobalSearch = selected?.sourceType === "global_search";
  const hasRealCandidateSource =
    summary.realRssCandidateCount +
      summary.realTavilyCandidateCount +
      summary.realExaCandidateCount >
    0;
  const coverPath = artifacts.cover?.imagePath ?? "";
  const coverIsRealImage =
    artifacts.cover?.mode === "real" &&
    isPngOrJpegPath(coverPath) &&
    !isMockCover(artifacts.cover);
  const productionMockFree =
    summary.mockCandidateCount === 0 &&
    summary.mockShortlistedCount === 0 &&
    !summary.mockFallbackDetected &&
    !selectedIsMock &&
    !isMockCover(artifacts.cover);

  return [
    makeCheck({
      name: "candidate news has real source",
      passed: productionPassed(realProductionMode, hasRealCandidateSource),
      severity: productionSeverity(realProductionMode),
      message:
        "candidate-news.json must include at least one real RSS, Tavily, or Exa source in production mode.",
      details: [
        `realSourceCount=${summary.realSourceCount ?? 0}`,
        `localizedCount=${summary.localizedCount ?? 0}`,
        `localizationFailedCount=${summary.localizationFailedCount ?? 0}`,
        `rejectedAfterLocalizationCount=${summary.rejectedAfterLocalizationCount ?? 0}`,
        `realRss=${summary.realRssCandidateCount}`,
        `realTavily=${summary.realTavilyCandidateCount}`,
        `realExa=${summary.realExaCandidateCount}`
      ]
    }),
    makeCheck({
      name: "candidate news has no mock entries",
      passed: summary.mockCandidateCount === 0,
      severity: productionSeverity(realProductionMode),
      message: "REAL_PRODUCTION_MODE=true forbids mock news/search candidates.",
      details: artifacts.candidates
        .filter(isMockNewsItem)
        .slice(0, 8)
        .map((item) => `${item.id} ${item.sourceType}/${item.provider ?? "none"}`)
    }),
    makeCheck({
      name: "shortlisted news has no mockNews",
      passed: summary.mockShortlistedCount === 0,
      severity: productionSeverity(realProductionMode),
      message: "shortlisted-news.json must not include mockNews items in production mode.",
      details: artifacts.shortlisted
        .filter(isMockNewsItem)
        .slice(0, 8)
        .map((item) => `${item.id} ${item.title}`)
    }),
    makeCheck({
      name: "selected topic has real url",
      passed: isRealHttpUrl(selectedUrl),
      severity: "blocker",
      message: "selected-topic.json selected.url must be a real http(s) URL.",
      details: [selectedUrl || "missing selected topic url"]
    }),
    makeCheck({
      name: "selected topic source reliability",
      passed: selectedReliability !== "low" && selectedReliability !== "missing",
      severity: "blocker",
      message: "selected-topic sourceReliability must not be low.",
      details: [`sourceReliability=${selectedReliability}`]
    }),
    makeCheck({
      name: "selected topic is not mock",
      passed: !selectedIsMock,
      severity: productionSeverity(realProductionMode),
      message: "REAL_PRODUCTION_MODE=true forbids mock selected-topic entries.",
      details: selected ? [`${selected.id} ${selected.sourceType}`] : ["missing selected topic"]
    }),
    makeCheck({
      name: "fact pack claims have sourceUrls",
      passed: factClaims.length >= 3 && factClaims.every(hasSourceUrls),
      severity: "blocker",
      message:
        "topic-fact-pack.verifiedClaims must include at least 3 claims and every claim must have real sourceUrls.",
      details: [
        `claimCount=${factClaims.length}`,
        ...factClaims
          .map((claim, index) =>
            hasSourceUrls(claim) ? "" : `claim[${index}] missing real sourceUrls`
          )
          .filter(Boolean)
      ]
    }),
    makeCheck({
      name: "article usedClaims have sourceUrls",
      passed: usedClaims.length >= 3 && usedClaims.every(hasSourceUrls),
      severity: "blocker",
      message:
        "article-meta.usedClaims must include at least 3 claims and every claim must have real sourceUrls.",
      details: [
        `usedClaimCount=${usedClaims.length}`,
        ...usedClaims
          .map((claim, index) =>
            hasSourceUrls(claim) ? "" : `usedClaims[${index}] missing real sourceUrls`
          )
          .filter(Boolean)
      ]
    }),
    makeCheck({
      name: "global_search is not sole final fact basis",
      passed: !selectedFromGlobalSearch || independentFactUrls.length >= 2,
      severity: "blocker",
      message:
        "global_search may only be a lead; final fact basis needs independent sourceUrls beyond the search lead.",
      details: [
        `selectedSourceType=${selected?.sourceType ?? "missing"}`,
        `independentFactUrls=${independentFactUrls.length}`
      ]
    }),
    makeCheck({
      name: "cover is real production image",
      passed: coverIsRealImage,
      severity: productionSeverity(realProductionMode),
      message:
        "REAL_PRODUCTION_MODE=true requires cover.mode=real and a non-mock JPG/PNG imagePath.",
      details: [`mode=${summary.coverMode}`, `imagePath=${summary.coverImagePath || "missing"}`]
    }),
    makeCheck({
      name: "no mock fallback in production",
      passed: productionMockFree,
      severity: productionSeverity(realProductionMode),
      message: "REAL_PRODUCTION_MODE=true forbids mock news, mock search, mock cover, and fallback mock artifacts.",
      details: [
        `mockCandidates=${summary.mockCandidateCount}`,
        `mockShortlisted=${summary.mockShortlistedCount}`,
        `mockFallbackDetected=${summary.mockFallbackDetected}`,
        `selectedIsMock=${selectedIsMock}`,
        `coverIsMock=${isMockCover(artifacts.cover)}`
      ]
    })
  ];
}

function createReport(result: RealDataAuditResult): string {
  const checkLines = result.checks.flatMap((check) => [
    `- ${check.passed ? "pass" : check.severity}: ${check.name} - ${check.message}`,
    ...check.details.map((detail) => `  - ${detail}`)
  ]);
  const issueLines =
    result.issues.length > 0 ? result.issues.map((issue) => `- ${issue}`) : ["- none"];
  const warningLines =
    result.warnings.length > 0
      ? result.warnings.map((warning) => `- ${warning}`)
      : ["- none"];

  return [
    "# Real Data Audit",
    "",
    "## Result",
    "",
    `- passed: ${result.passed}`,
    `- realProductionMode: ${result.realProductionMode}`,
    `- generatedAt: ${result.generatedAt}`,
    "",
    "## Summary",
    "",
    `- candidateCount: ${result.summary.candidateCount}`,
    `- shortlistedCount: ${result.summary.shortlistedCount}`,
    `- realSourceCount: ${result.summary.realSourceCount ?? 0}`,
    `- localizedCount: ${result.summary.localizedCount ?? 0}`,
    `- localizationFailedCount: ${result.summary.localizationFailedCount ?? 0}`,
    `- rejectedAfterLocalizationCount: ${result.summary.rejectedAfterLocalizationCount ?? 0}`,
    `- realRssCandidateCount: ${result.summary.realRssCandidateCount}`,
    `- realTavilyCandidateCount: ${result.summary.realTavilyCandidateCount}`,
    `- realExaCandidateCount: ${result.summary.realExaCandidateCount}`,
    `- mockCandidateCount: ${result.summary.mockCandidateCount}`,
    `- mockShortlistedCount: ${result.summary.mockShortlistedCount}`,
    `- mockSearchCandidateCount: ${result.summary.mockSearchCandidateCount}`,
    `- mockRssCandidateCount: ${result.summary.mockRssCandidateCount}`,
    `- mockFallbackDetected: ${result.summary.mockFallbackDetected}`,
    `- coverMode: ${result.summary.coverMode}`,
    `- coverImagePath: ${result.summary.coverImagePath || "missing"}`,
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
    "- global_search results are leads only and cannot be the sole final fact basis.",
    "- REAL_PRODUCTION_MODE=false keeps mock/fallback findings as warnings for development.",
    "- REAL_PRODUCTION_MODE=true blocks mock news, mock search, mock cover, and fallback mock artifacts before real draft creation.",
    ""
  ].join("\n");
}

export async function auditRealData(
  options: AuditRealDataOptions = {}
): Promise<RealDataAuditResult> {
  const logger = options.logger ?? createLogger("real-data-audit");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const env = options.env ?? process.env;
  const realProductionMode = parseBoolean(env.REAL_PRODUCTION_MODE);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const files = createOutputFiles(outputDir);
  const artifacts = await loadArtifacts(outputDir);
  const summary = createSummary(artifacts);
  const checks = buildChecks({
    artifacts,
    summary,
    realProductionMode
  });
  const issues = checks
    .filter((check) => !check.passed && check.severity === "blocker")
    .map((check) => `${check.name}: ${check.message}`);
  const warnings = checks
    .filter((check) => !check.passed && check.severity === "warning")
    .map((check) => `${check.name}: ${check.message}`);
  const result: RealDataAuditResult = {
    passed: issues.length === 0,
    realProductionMode,
    generatedAt,
    outputDir,
    checks,
    issues,
    warnings,
    summary,
    files
  };
  const report = createReport(result);

  if (options.writeOutputs ?? true) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.result, result);
    await writeFile(files.report, report, "utf8");
  }

  logger.info(
    `Real data audit ${result.passed ? "passed" : "blocked"}; production=${realProductionMode}; mockCandidates=${summary.mockCandidateCount}; coverMode=${summary.coverMode}.`
  );

  return result;
}
