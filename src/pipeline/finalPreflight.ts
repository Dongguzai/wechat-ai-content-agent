import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_WECHAT_PUBLISH_API_TERMS,
  verifyWechatDraftOnlyApiGuard
} from "../hooks/forbidWechatPublishApi.js";
import type { ArticleReviewResult } from "../types/article.js";
import type { CoverResult, CoverReviewResult } from "../types/cover.js";
import type {
  FinalPreflightCheck,
  FinalPreflightOutputFiles,
  FinalPreflightResult
} from "../types/finalPreflight.js";
import type { WechatLayoutResult } from "../types/layout.js";
import type { RealDataAuditResult } from "../types/realDataAudit.js";
import type {
  WechatApiDraftResult,
  WechatApiPreflight
} from "../types/wechatApiDraft.js";
import { readWechatDraftRunLock } from "./wechatDraftRunLock.js";

export interface RunFinalPreflightOptions {
  outputDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  force?: boolean;
  lockDir?: string;
  writeOutputs?: boolean;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultOutputDir = join(projectRoot, "outputs");
const textScanExtensions = new Set([
  ".html",
  ".json",
  ".md",
  ".txt",
  ".svg"
]);

function createOutputFiles(outputDir: string): FinalPreflightOutputFiles {
  return {
    result: join(outputDir, "final-preflight.json"),
    report: join(outputDir, "final-preflight-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path);
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeCheck(
  name: string,
  passed: boolean,
  message: string,
  details: string[] = []
): FinalPreflightCheck {
  return {
    name,
    passed,
    message,
    details
  };
}

function sameDayDraftLockMessage(input: {
  locked: boolean;
  force: boolean;
}): string {
  if (!input.locked) {
    return "same-day real draft lock is clear.";
  }

  if (input.force) {
    return "Existing same-day lock is being overridden by --force.";
  }

  return "same-day real draft lock exists: a real draft was already created today.";
}

function extractImageSrcs(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map(
    (match) => match[1].trim()
  );
}

function isLocalImageSrc(src: string): boolean {
  if (!src) {
    return false;
  }

  if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) {
    return false;
  }

  return (
    /^file:/i.test(src) ||
    /^\.{1,2}\//.test(src) ||
    /^\//.test(src) ||
    /^[a-z]:[\\/]/i.test(src) ||
    /^(outputs|covers|\.local)\//i.test(src) ||
    /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(src)
  );
}

function findLocalImagePaths(html: string): string[] {
  const localSrcs = extractImageSrcs(html).filter(isLocalImageSrc);
  const rawPathPatterns = [
    /file:\/\/[^\s"'<>]+/gi,
    /\/Users\/[^\s"'<>]+/g,
    /(?:^|["'(])outputs\/(?:covers\/)?[^\s"'<>)]*/gi,
    /(?:^|["'(])\.{1,2}\/[^\s"'<>)]*/g
  ];
  const rawMatches = rawPathPatterns.flatMap((pattern) =>
    [...html.matchAll(pattern)].map((match) => match[0].replace(/^["'(]/, ""))
  );

  return [...new Set([...localSrcs, ...rawMatches])];
}

function findForbiddenTerms(html: string): string[] {
  const lowerHtml = html.toLowerCase();

  return FORBIDDEN_WECHAT_PUBLISH_API_TERMS.filter((term) =>
    lowerHtml.includes(term.toLowerCase())
  );
}

function isRealProductionMode(env: NodeJS.ProcessEnv): boolean {
  return env.REAL_PRODUCTION_MODE?.trim().toLowerCase() === "true";
}

function isPngOrJpegPath(path: string | undefined): boolean {
  return Boolean(path && /\.(?:png|jpe?g)$/i.test(path));
}

function isMockSvgPath(path: string | undefined): boolean {
  return Boolean(
    path &&
      (/\.svg(?:[?#].*)?$/i.test(path) || /\bmock\b/i.test(basename(path)))
  );
}

function productionChecks(input: {
  realProductionMode: boolean;
  realDataAudit?: RealDataAuditResult;
  cover?: CoverResult;
  coverReview: CoverReviewResult;
  dangerousApis: string[];
  lockStateLocked: boolean;
  force: boolean;
}): FinalPreflightCheck[] {
  if (!input.realProductionMode) {
    return [];
  }

  const coverImagePath =
    input.cover?.imagePath || input.coverReview.imagePath || "";
  const mockSummary = input.realDataAudit?.summary;
  const mockDetails = mockSummary
    ? [
        `mockCandidateCount=${mockSummary.mockCandidateCount}`,
        `mockShortlistedCount=${mockSummary.mockShortlistedCount}`,
        `mockSearchCandidateCount=${mockSummary.mockSearchCandidateCount}`,
        `mockRssCandidateCount=${mockSummary.mockRssCandidateCount}`,
        `mockFallbackDetected=${mockSummary.mockFallbackDetected}`,
        `coverMode=${mockSummary.coverMode}`
      ]
    : ["real-data-audit.json is missing."];

  return [
    makeCheck(
      "real-data-audit passed",
      input.realDataAudit?.passed === true,
      "REAL_PRODUCTION_MODE=true requires real-data-audit.passed=true.",
      input.realDataAudit?.issues ?? ["real-data-audit.json is missing."]
    ),
    makeCheck(
      "production cover mode is real",
      input.cover?.mode === "real",
      "REAL_PRODUCTION_MODE=true requires cover.mode=real.",
      [`cover.mode=${input.cover?.mode ?? "missing"}`]
    ),
    makeCheck(
      "production cover image is jpg or png",
      isPngOrJpegPath(coverImagePath),
      "REAL_PRODUCTION_MODE=true requires cover.imagePath to be a JPG, JPEG, or PNG.",
      [coverImagePath || "cover.imagePath missing"]
    ),
    makeCheck(
      "production cover is not mock svg",
      !isMockSvgPath(coverImagePath) && input.cover?.mode !== "mock",
      "REAL_PRODUCTION_MODE=true forbids mock SVG covers.",
      [coverImagePath || "cover.imagePath missing"]
    ),
    makeCheck(
      "production mock fallback absent",
      input.realDataAudit?.passed === true &&
        (mockSummary?.mockCandidateCount ?? 0) === 0 &&
        (mockSummary?.mockShortlistedCount ?? 0) === 0 &&
        (mockSummary?.mockFallbackDetected ?? false) === false &&
        (mockSummary?.coverMode ?? "missing") === "real",
      "REAL_PRODUCTION_MODE=true forbids mock news, mock search, mock cover, and fallback mock artifacts.",
      mockDetails
    ),
    makeCheck(
      "production has no publish api terms",
      input.dangerousApis.length === 0,
      "No publish/freepublish/mass/sendall interface may be used in production mode.",
      input.dangerousApis
    ),
    makeCheck(
      "production same-day lock clear or forced",
      !input.lockStateLocked || input.force,
      "REAL_PRODUCTION_MODE=true requires same-day lock clear or explicit --force.",
      input.lockStateLocked
        ? ["same-day real draft lock exists and --force was not provided."]
        : []
    )
  ];
}

function resultUsesDraftOnlyEndpoint(result: WechatApiDraftResult): boolean {
  if (result.mode !== "api_dry_run") {
    return false;
  }

  return result.requestPreview.endpoint === "/cgi-bin/draft/add";
}

function dangerousApiDetails(input: {
  preflight: WechatApiPreflight;
  draftResult: WechatApiDraftResult;
}): string[] {
  const details: string[] = [];

  if (!verifyWechatDraftOnlyApiGuard()) {
    details.push("forbidWechatPublishApi guard did not verify draft-only mode.");
  }

  if (input.preflight.publishApiCalled || input.draftResult.safety.publishApiCalled) {
    details.push("publish API flag is true.");
  }

  if (input.preflight.massSendApiCalled || input.draftResult.safety.massSendApiCalled) {
    details.push("mass send API flag is true.");
  }

  if (!resultUsesDraftOnlyEndpoint(input.draftResult)) {
    details.push("wechat-api-draft-result.json does not use /cgi-bin/draft/add.");
  }

  if (input.draftResult.mode === "api_dry_run") {
    const endpoint = input.draftResult.requestPreview.endpoint.toLowerCase();
    const forbiddenEndpointTerm = ["freepublish", "mass", "sendall", "publish"].find(
      (term) => endpoint.includes(term)
    );

    if (forbiddenEndpointTerm) {
      details.push(`forbidden endpoint term detected: ${forbiddenEndpointTerm}.`);
    }
  }

  return details;
}

async function listOutputTextFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        return listOutputTextFiles(path);
      }

      if (!entry.isFile() || !textScanExtensions.has(extname(entry.name))) {
        return [];
      }

      return [path];
    })
  );

  return files.flat();
}

async function sensitiveOutputDetails(input: {
  outputDir: string;
  env: NodeJS.ProcessEnv;
}): Promise<string[]> {
  const details: string[] = [];
  const appSecret = input.env.WECHAT_APP_SECRET?.trim() ?? "";
  const files = await listOutputTextFiles(input.outputDir);

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relativePath = relative(input.outputDir, file);

    if (appSecret && text.includes(appSecret)) {
      details.push(`${relativePath} contains the configured AppSecret value.`);
    }

    if (/\baccess_token\s*[:=]/i.test(text) || /\baccess_token=/i.test(text)) {
      details.push(`${relativePath} appears to contain an access token field.`);
    }
  }

  return details;
}

function createReport(result: FinalPreflightResult): string {
  const checkLines = result.checks.flatMap((check) => [
    `- ${check.passed ? "pass" : "block"}: ${check.name} - ${check.message}`,
    ...check.details.map((detail) => `  - ${detail}`)
  ]);
  const issueLines =
    result.issues.length > 0
      ? result.issues.map((issue) => `- ${issue}`)
      : ["- none"];

  return [
    "# Final WeChat Draft Preflight",
    "",
    "## Result",
    "",
    `- passed: ${result.passed}`,
    `- generatedAt: ${result.generatedAt}`,
    `- force: ${result.force}`,
    "",
    "## Checks",
    "",
    ...checkLines,
    "",
    "## Blocking Issues",
    "",
    ...issueLines,
    "",
    "## Boundary",
    "",
    "- This preflight only validates readiness for creating a WeChat draft.",
    "- It does not publish, mass send, open the WeChat admin console, or call the WeChat API.",
    "- Final publishing remains a manual action in the official WeChat admin console.",
    ""
  ].join("\n");
}

export async function runFinalPreflight(
  options: RunFinalPreflightOptions = {}
): Promise<FinalPreflightResult> {
  const outputDir = options.outputDir ?? defaultOutputDir;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const force = options.force === true;
  const realProductionMode = isRealProductionMode(env);
  const files = createOutputFiles(outputDir);
  const articleReview = await readJsonFile<ArticleReviewResult>(
    join(outputDir, "article-review.json")
  );
  const cover = await readOptionalJsonFile<CoverResult>(join(outputDir, "cover.json"));
  const coverReview = await readJsonFile<CoverReviewResult>(
    join(outputDir, "cover-review.json")
  );
  const realDataAudit = await readOptionalJsonFile<RealDataAuditResult>(
    join(outputDir, "real-data-audit.json")
  );
  const layout = await readJsonFile<WechatLayoutResult>(
    join(outputDir, "wechat-layout.json")
  );
  const apiPreflight = await readJsonFile<WechatApiPreflight>(
    join(outputDir, "wechat-api-preflight.json")
  );
  const apiDraftResult = await readJsonFile<WechatApiDraftResult>(
    join(outputDir, "wechat-api-draft-result.json")
  );
  const html = await readFile(join(outputDir, "wechat.html"), "utf8");
  const lockState = await readWechatDraftRunLock({
    lockDir: options.lockDir,
    now
  });
  const coverMediaId = env.WECHAT_COVER_MEDIA_ID?.trim() ?? "";
  const uploadableCoverPath =
    env.WECHAT_COVER_IMAGE_PATH?.trim() ||
    cover?.imagePath?.trim() ||
    coverReview.imagePath?.trim() ||
    "";
  const coverInputPresent =
    coverMediaId.length > 0 ||
    (coverMediaId.length === 0 && isPngOrJpegPath(uploadableCoverPath) && !isMockSvgPath(uploadableCoverPath));
  const localImagePaths = findLocalImagePaths(html);
  const forbiddenTerms = findForbiddenTerms(html);
  const dangerousApis = dangerousApiDetails({
    preflight: apiPreflight,
    draftResult: apiDraftResult
  });
  const sensitiveOutputs = await sensitiveOutputDetails({
    outputDir,
    env
  });
  const checks: FinalPreflightCheck[] = [
    makeCheck(
      "article-review passed",
      articleReview.passed === true,
      "article-review.json passed must be true."
    ),
    makeCheck(
      "cover-review passed",
      coverReview.passed === true,
      "cover-review.json passed must be true."
    ),
    makeCheck(
      "wechat-layout allowed",
      layout.allowedNextStage === true,
      "wechat-layout.json allowedNextStage must be true."
    ),
    makeCheck(
      "wechat-api dry-run passed",
      apiPreflight.passed === true &&
        apiPreflight.dryRun === true &&
        apiPreflight.mode === "api_dry_run" &&
        apiDraftResult.mode === "api_dry_run" &&
        apiDraftResult.status === "request_preview_generated",
      "wechat-api dry-run preflight and request preview must both pass."
    ),
    makeCheck(
      "cover media id present or uploadable cover present",
      coverInputPresent,
      "WECHAT_COVER_MEDIA_ID or an uploadable JPG/PNG cover image must be present before final real-draft preflight.",
      [
        coverMediaId ? "WECHAT_COVER_MEDIA_ID is present." : "WECHAT_COVER_MEDIA_ID is missing.",
        uploadableCoverPath || "cover image path is missing."
      ]
    ),
    makeCheck(
      "html has no local image paths",
      localImagePaths.length === 0,
      "wechat.html must not reference local image paths.",
      localImagePaths
    ),
    makeCheck(
      "html has no forbidden terms",
      forbiddenTerms.length === 0,
      "wechat.html must not contain publish or mass-send risk terms.",
      forbiddenTerms
    ),
    makeCheck(
      "wechat api remains draft-only",
      dangerousApis.length === 0,
      "No publish/freepublish/mass/sendall interface may be used.",
      dangerousApis
    ),
    makeCheck(
      "outputs contain no secrets",
      sensitiveOutputs.length === 0,
      "outputs must not contain AppSecret values or token fields.",
      sensitiveOutputs
    ),
    makeCheck(
      "same-day real draft lock",
      !lockState.locked || force,
      sameDayDraftLockMessage({
        locked: lockState.locked,
        force
      }),
      lockState.locked ? [lockState.lockFile] : []
    ),
    ...productionChecks({
      realProductionMode,
      realDataAudit,
      cover,
      coverReview,
      dangerousApis,
      lockStateLocked: lockState.locked,
      force
    })
  ];
  const issues = checks
    .filter((check) => !check.passed)
    .map((check) => `${check.name}: ${check.message}`);
  const result: FinalPreflightResult = {
    passed: issues.length === 0,
    generatedAt,
    outputDir,
    force,
    checks,
    issues,
    files
  };
  const report = createReport(result);

  if (options.writeOutputs ?? true) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.result, result);
    await writeFile(files.report, report, "utf8");
  }

  return result;
}
