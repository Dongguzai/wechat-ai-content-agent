import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_WECHAT_PUBLISH_API_TERMS,
  verifyWechatDraftOnlyApiGuard
} from "../hooks/forbidWechatPublishApi.js";
import type { ArticleReviewResult } from "../types/article.js";
import type { CoverReviewResult } from "../types/cover.js";
import type {
  FinalPreflightCheck,
  FinalPreflightOutputFiles,
  FinalPreflightResult
} from "../types/finalPreflight.js";
import type { WechatLayoutResult } from "../types/layout.js";
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
  const files = createOutputFiles(outputDir);
  const articleReview = await readJsonFile<ArticleReviewResult>(
    join(outputDir, "article-review.json")
  );
  const coverReview = await readJsonFile<CoverReviewResult>(
    join(outputDir, "cover-review.json")
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
      "cover media id present",
      coverMediaId.length > 0,
      "WECHAT_COVER_MEDIA_ID must be present before final real-draft preflight."
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
      "same-day real draft lock is clear",
      !lockState.locked || force,
      force
        ? "Existing same-day lock is being overridden by --force."
        : "No same-day real draft lock exists.",
      lockState.locked ? [lockState.lockFile] : []
    )
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
