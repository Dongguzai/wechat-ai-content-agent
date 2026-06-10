import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatDotEnvParseErrors,
  miniMaxDotEnvOverrideKeys,
  parseDotEnv,
  projectRoot as defaultProjectRoot,
  type DotEnvEntry
} from "../src/config/env.js";
import { validateCloudBriefEnv } from "../src/config/cloudEnv.js";

type EnvValueKind =
  | "boolean"
  | "integer"
  | "nonnegativeInteger"
  | "enum"
  | "flag"
  | "url"
  | "number"
  | "string";

interface EnvSpec {
  name: string;
  kind: EnvValueKind;
  allowedValues?: string[];
}

export interface EnvCheckOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  dotenvPath?: string | null;
}

export interface EnvCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

export interface EnvCheckCliOptions extends EnvCheckOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

const envSpecs: EnvSpec[] = [
  { name: "REAL_PRODUCTION_MODE", kind: "boolean" },
  { name: "LLM_PROVIDER", kind: "enum", allowedValues: ["minimax"] },
  { name: "LLM_ENABLE_REAL_API", kind: "boolean" },
  { name: "LLM_DRY_RUN", kind: "boolean" },
  { name: "MINIMAX_API_KEY", kind: "string" },
  { name: "MINIMAX_BASE_URL", kind: "url" },
  { name: "MINIMAX_MODEL", kind: "string" },
  { name: "MINIMAX_MAX_COMPLETION_TOKENS", kind: "integer" },
  { name: "MINIMAX_TEMPERATURE", kind: "number" },
  { name: "ARTICLE_WRITER_PROVIDER", kind: "enum", allowedValues: ["minimax"] },
  { name: "ARTICLE_WRITER_MODEL", kind: "string" },
  { name: "TITLE_GENERATOR_PROVIDER", kind: "enum", allowedValues: ["minimax"] },
  { name: "TITLE_GENERATOR_MODEL", kind: "string" },
  { name: "ARTICLE_REVIEWER_PROVIDER", kind: "enum", allowedValues: ["minimax"] },
  { name: "ARTICLE_REVIEWER_MODEL", kind: "string" },
  { name: "RSS_ENABLE_REAL_FETCH", kind: "boolean" },
  { name: "RSS_FETCH_TIMEOUT_MS", kind: "integer" },
  { name: "RSS_FETCH_RETRY", kind: "nonnegativeInteger" },
  { name: "SEARCH_ENABLE_REAL_API", kind: "boolean" },
  { name: "SEARCH_FETCH_TIMEOUT_MS", kind: "integer" },
  { name: "SEARCH_FETCH_RETRY", kind: "nonnegativeInteger" },
  { name: "TAVILY_API_KEY", kind: "string" },
  { name: "EXA_API_KEY", kind: "string" },
  { name: "TAVILY_MAX_QUERIES_PER_RUN", kind: "integer" },
  { name: "EXA_MAX_QUERIES_PER_RUN", kind: "integer" },
  { name: "SEARCH_MAX_RESULTS_PER_QUERY", kind: "integer" },
  { name: "SEARCH_LOOKBACK_HOURS", kind: "integer" },
  { name: "NEWS_LOOKBACK_HOURS", kind: "integer" },
  { name: "GLOBAL_SEARCH_MAX_CANDIDATES", kind: "integer" },
  { name: "RSS_MIN_CANDIDATES", kind: "integer" },
  { name: "MIN_REAL_NEWS_ITEMS", kind: "integer" },
  { name: "MIN_REAL_RSS_ITEMS", kind: "integer" },
  { name: "MIN_REAL_SEARCH_ITEMS", kind: "integer" },
  { name: "DATABASE_URL", kind: "string" },
  { name: "DATABASE_MAX_CONNECTIONS", kind: "integer" },
  { name: "R2_ENDPOINT", kind: "string" },
  { name: "R2_ACCOUNT_ID", kind: "string" },
  { name: "R2_ACCESS_KEY_ID", kind: "string" },
  { name: "R2_SECRET_ACCESS_KEY", kind: "string" },
  { name: "R2_BUCKET", kind: "string" },
  { name: "R2_PUBLIC_BASE_URL", kind: "url" },
  { name: "CRON_SECRET", kind: "string" },
  { name: "DASHBOARD_PASSWORD", kind: "string" },
  { name: "AUTH_SECRET", kind: "string" },
  { name: "BRIEF_TIME_ZONE", kind: "string" },
  { name: "COVER_ENABLE_REAL_API", kind: "boolean" },
  { name: "APIMART_API_KEY", kind: "string" },
  { name: "APIMART_IMAGE_API_URL", kind: "url" },
  { name: "APIMART_IMAGE_MODEL", kind: "string" },
  { name: "APIMART_IMAGE_SIZE", kind: "enum", allowedValues: ["16:9"] },
  { name: "APIMART_IMAGE_RESOLUTION", kind: "enum", allowedValues: ["2k"] },
  { name: "APIMART_COVER_STYLE", kind: "string" },
  { name: "COVER_IMAGE_PROVIDER", kind: "enum", allowedValues: ["apimart"] },
  { name: "COVER_IMAGE_SIZE", kind: "enum", allowedValues: ["900x383"] },
  { name: "COVER_OUTPUT_DIR", kind: "string" },
  { name: "WECHAT_BROWSER_ENABLE_REAL", kind: "boolean" },
  { name: "WECHAT_BROWSER_HEADLESS", kind: "boolean" },
  { name: "WECHAT_BROWSER_USER_DATA_DIR", kind: "string" },
  { name: "WECHAT_BROWSER_ALLOW_SAVE_DRAFT", kind: "boolean" },
  { name: "WECHAT_BROWSER_ALLOW_PREVIEW", kind: "boolean" },
  { name: "WECHAT_API_ENABLE_REAL_DRAFT", kind: "boolean" },
  { name: "WECHAT_DRAFT_ALLOW_REAL_API", kind: "boolean" },
  { name: "WECHAT_DRAFT_DRY_RUN", kind: "boolean" },
  { name: "WECHAT_FORBID_PUBLISH", kind: "boolean" },
  { name: "WECHAT_FORBID_MASS_SEND", kind: "boolean" },
  { name: "WECHAT_APP_ID", kind: "string" },
  { name: "WECHAT_APP_SECRET", kind: "string" },
  { name: "WECHAT_API_BASE", kind: "url" },
  { name: "WECHAT_AUTHOR", kind: "string" },
  { name: "WECHAT_CONTENT_SOURCE_URL", kind: "string" },
  { name: "WECHAT_COVER_MEDIA_ID", kind: "string" },
  { name: "WECHAT_COVER_IMAGE_PATH", kind: "string" },
  { name: "WECHAT_NEED_OPEN_COMMENT", kind: "flag" },
  { name: "WECHAT_ONLY_FANS_CAN_COMMENT", kind: "flag" },
  { name: "NOTIFY_ENABLE", kind: "boolean" },
  { name: "NOTIFY_METHOD", kind: "enum", allowedValues: ["console", "webhook"] },
  { name: "NOTIFY_WEBHOOK_URL", kind: "url" },
  { name: "NOTIFY_EMAIL_TO", kind: "string" },
  { name: "NOTIFY_ON_SUCCESS", kind: "boolean" },
  { name: "NOTIFY_ON_FAILURE", kind: "boolean" }
];

const envSpecByName = new Map(envSpecs.map((spec) => [spec.name, spec]));
const ignoredScanDirs = new Set([
  ".git",
  ".local",
  "dist",
  "node_modules",
  "outputs"
]);
const scanExtensions = new Set([".ts", ".js", ".mjs", ".cjs"]);

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function duplicateEnvKeys(entries: DotEnvEntry[]): string[] {
  const linesByKey = new Map<string, number[]>();

  for (const entry of entries) {
    linesByKey.set(entry.key, [...(linesByKey.get(entry.key) ?? []), entry.line]);
  }

  return [...linesByKey.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([key, lines]) => `${key} (lines ${lines.join(", ")})`);
}

function applyEntriesToEnv(
  entries: DotEnvEntry[],
  env: NodeJS.ProcessEnv,
  overrideKeys: readonly string[] = []
): void {
  const overrideKeySet = new Set(overrideKeys);

  for (const entry of entries) {
    if (overrideKeySet.has(entry.key) || env[entry.key] === undefined) {
      env[entry.key] = entry.value;
    }
  }
}

async function listScanFiles(root: string, dirName: string): Promise<string[]> {
  const dir = join(root, dirName);
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        return ignoredScanDirs.has(entry.name)
          ? []
          : listScanFiles(root, join(dirName, entry.name));
      }

      if (!entry.isFile() || !scanExtensions.has(extname(entry.name))) {
        return [];
      }

      return [path];
    })
  );

  return files.flat();
}

function lineNumberForIndex(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function addReference(
  references: Map<string, Set<string>>,
  name: string,
  source: string
): void {
  references.set(name, references.get(name) ?? new Set<string>());
  references.get(name)?.add(source);
}

async function collectEnvReferences(
  root: string
): Promise<Map<string, Set<string>>> {
  const references = new Map<string, Set<string>>();
  const sourceFiles = [
    ...(await listScanFiles(root, "src")),
    ...(await listScanFiles(root, "scripts"))
  ];
  const referencePatterns = [
    /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g,
    /\benv\.([A-Z][A-Z0-9_]*)/g,
    /\benv\[['"]([A-Z][A-Z0-9_]*)['"]\]/g
  ];

  for (const file of sourceFiles) {
    const text = await readFile(file, "utf8");
    const relativePath = relative(root, file);

    for (const pattern of referencePatterns) {
      for (const match of text.matchAll(pattern)) {
        addReference(
          references,
          match[1],
          `${relativePath}:${lineNumberForIndex(text, match.index ?? 0)}`
        );
      }
    }
  }

  const packageJson = await readOptionalTextFile(join(root, "package.json"));
  if (packageJson) {
    for (const match of packageJson.matchAll(/\b([A-Z][A-Z0-9_]+)=/g)) {
      addReference(references, match[1], "package.json");
    }
  }

  return references;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function isExplicitTrue(env: NodeJS.ProcessEnv, name: string): boolean {
  return envValue(env, name) === "true";
}

function isExplicitFalse(env: NodeJS.ProcessEnv, name: string): boolean {
  return envValue(env, name) === "false";
}

function requireEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[]
): void {
  if (!envValue(env, name)) {
    errors.push(`${name} is required for real WeChat draft mode.`);
  }
}

function validateEnvValue(
  spec: EnvSpec,
  value: string,
  errors: string[]
): void {
  if (spec.kind === "boolean" && value !== "true" && value !== "false") {
    errors.push(`${spec.name} must be either true or false.`);
    return;
  }

  if (spec.kind === "integer" && !/^[1-9]\d*$/.test(value)) {
    errors.push(`${spec.name} must be a positive integer.`);
    return;
  }

  if (spec.kind === "number" && !Number.isFinite(Number(value))) {
    errors.push(`${spec.name} must be a finite number.`);
    return;
  }

  if (spec.kind === "nonnegativeInteger" && !/^(0|[1-9]\d*)$/.test(value)) {
    errors.push(`${spec.name} must be a non-negative integer.`);
    return;
  }

  if (spec.kind === "flag" && value !== "0" && value !== "1") {
    errors.push(`${spec.name} must be either 0 or 1.`);
    return;
  }

  if (
    spec.kind === "enum" &&
    spec.allowedValues &&
    !spec.allowedValues.includes(value)
  ) {
    errors.push(`${spec.name} must be one of: ${spec.allowedValues.join(", ")}.`);
    return;
  }

  if (spec.kind === "url") {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        errors.push(`${spec.name} must be an http(s) URL.`);
      }
    } catch {
      errors.push(`${spec.name} must be a valid URL.`);
    }
  }
}

function validateConditionalEnv(
  env: NodeJS.ProcessEnv,
  errors: string[],
  warnings: string[]
): void {
  const realProductionMode = isExplicitTrue(env, "REAL_PRODUCTION_MODE");

  if (realProductionMode) {
    if (!isExplicitTrue(env, "RSS_ENABLE_REAL_FETCH")) {
      errors.push("REAL_PRODUCTION_MODE=true requires RSS_ENABLE_REAL_FETCH=true.");
    }

    if (!isExplicitTrue(env, "SEARCH_ENABLE_REAL_API")) {
      errors.push("REAL_PRODUCTION_MODE=true requires SEARCH_ENABLE_REAL_API=true.");
    }

    if (!isExplicitTrue(env, "LLM_ENABLE_REAL_API")) {
      errors.push("REAL_PRODUCTION_MODE=true requires LLM_ENABLE_REAL_API=true.");
    }

    if (!isExplicitFalse(env, "LLM_DRY_RUN")) {
      errors.push("REAL_PRODUCTION_MODE=true requires LLM_DRY_RUN=false.");
    }

    if ((envValue(env, "LLM_PROVIDER") ?? "minimax") !== "minimax") {
      errors.push("REAL_PRODUCTION_MODE=true requires LLM_PROVIDER=minimax.");
    }
  }

  const llmRealIntent =
    isExplicitTrue(env, "LLM_ENABLE_REAL_API") ||
    isExplicitFalse(env, "LLM_DRY_RUN");
  if (llmRealIntent) {
    if (!isExplicitTrue(env, "LLM_ENABLE_REAL_API") || !isExplicitFalse(env, "LLM_DRY_RUN")) {
      errors.push(
        "Real MiniMax LLM mode requires LLM_ENABLE_REAL_API=true and LLM_DRY_RUN=false."
      );
    }

    if ((envValue(env, "LLM_PROVIDER") ?? "minimax") !== "minimax") {
      errors.push("Real MiniMax LLM mode requires LLM_PROVIDER=minimax.");
    }

    if (!envValue(env, "MINIMAX_API_KEY")) {
      errors.push("Real MiniMax LLM mode requires MINIMAX_API_KEY.");
    }

    for (const [stageName, stageModelKey] of [
      ["article-writer", "ARTICLE_WRITER_MODEL"],
      ["title-generator", "TITLE_GENERATOR_MODEL"],
      ["article-reviewer", "ARTICLE_REVIEWER_MODEL"]
    ] as const) {
      if (!envValue(env, stageModelKey) && !envValue(env, "MINIMAX_MODEL")) {
        errors.push(
          `Real MiniMax LLM mode requires ${stageModelKey} or MINIMAX_MODEL for ${stageName}.`
        );
      }
    }
  }

  if (isExplicitTrue(env, "SEARCH_ENABLE_REAL_API")) {
    const hasTavilyKey = Boolean(envValue(env, "TAVILY_API_KEY"));
    const hasExaKey = Boolean(envValue(env, "EXA_API_KEY"));

    if (!hasTavilyKey && !hasExaKey) {
      const message =
        "SEARCH_ENABLE_REAL_API=true requires TAVILY_API_KEY or EXA_API_KEY for real search.";
      if (realProductionMode) {
        errors.push(message);
      } else {
        warnings.push(`${message} Development mode will use mock search.`);
      }
    } else {
      if (!hasTavilyKey) {
        warnings.push("TAVILY_API_KEY is empty; Tavily will use mock search.");
      }

      if (!hasExaKey) {
        warnings.push("EXA_API_KEY is empty; Exa will use mock search.");
      }
    }
  }

  const cloudBriefEnv = validateCloudBriefEnv(env);
  errors.push(...cloudBriefEnv.errors);
  warnings.push(...cloudBriefEnv.warnings);

  if (
    realProductionMode &&
    isExplicitFalse(env, "COVER_ENABLE_REAL_API")
  ) {
    warnings.push(
      "REAL_PRODUCTION_MODE=true requires a real cover artifact before final preflight; COVER_ENABLE_REAL_API=false will keep generated covers in mock mode unless a real cover is supplied."
    );
  }

  if (isExplicitTrue(env, "COVER_ENABLE_REAL_API")) {
    if (!envValue(env, "APIMART_API_KEY")) {
      errors.push("COVER_ENABLE_REAL_API=true requires APIMART_API_KEY.");
    }

    if (!envValue(env, "APIMART_IMAGE_API_URL")) {
      errors.push("COVER_ENABLE_REAL_API=true requires APIMART_IMAGE_API_URL.");
    }
  }

  const realDraftIntent =
    isExplicitTrue(env, "WECHAT_API_ENABLE_REAL_DRAFT") ||
    isExplicitTrue(env, "WECHAT_DRAFT_ALLOW_REAL_API") ||
    isExplicitFalse(env, "WECHAT_DRAFT_DRY_RUN");

  if (realDraftIntent) {
    if (
      !isExplicitTrue(env, "WECHAT_API_ENABLE_REAL_DRAFT") ||
      !isExplicitTrue(env, "WECHAT_DRAFT_ALLOW_REAL_API") ||
      !isExplicitFalse(env, "WECHAT_DRAFT_DRY_RUN")
    ) {
      errors.push(
        "Real WeChat draft mode requires WECHAT_API_ENABLE_REAL_DRAFT=true, WECHAT_DRAFT_ALLOW_REAL_API=true, and WECHAT_DRAFT_DRY_RUN=false."
      );
    }

    requireEnvValue(env, "WECHAT_APP_ID", errors);
    requireEnvValue(env, "WECHAT_APP_SECRET", errors);

    if (
      !envValue(env, "WECHAT_COVER_MEDIA_ID") &&
      !envValue(env, "WECHAT_COVER_IMAGE_PATH")
    ) {
      errors.push(
        "Real WeChat draft mode requires WECHAT_COVER_MEDIA_ID or WECHAT_COVER_IMAGE_PATH."
      );
    }
  }

  const coverImagePath = envValue(env, "WECHAT_COVER_IMAGE_PATH");
  if (coverImagePath && !/\.(?:jpe?g|png)$/i.test(coverImagePath)) {
    const message =
      "WECHAT_COVER_IMAGE_PATH should point to a JPG, JPEG, or PNG image.";
    if (realDraftIntent) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  if (isExplicitFalse(env, "WECHAT_FORBID_PUBLISH")) {
    errors.push("WECHAT_FORBID_PUBLISH=false disables a required safety guard.");
  }

  if (isExplicitFalse(env, "WECHAT_FORBID_MASS_SEND")) {
    errors.push("WECHAT_FORBID_MASS_SEND=false disables a required safety guard.");
  }
}

function describeWechatDraftMode(env: NodeJS.ProcessEnv): string[] {
  const realDraftReady =
    isExplicitTrue(env, "WECHAT_API_ENABLE_REAL_DRAFT") &&
    isExplicitTrue(env, "WECHAT_DRAFT_ALLOW_REAL_API") &&
    isExplicitFalse(env, "WECHAT_DRAFT_DRY_RUN");
  const realDraftIntent =
    isExplicitTrue(env, "WECHAT_API_ENABLE_REAL_DRAFT") ||
    isExplicitTrue(env, "WECHAT_DRAFT_ALLOW_REAL_API") ||
    isExplicitFalse(env, "WECHAT_DRAFT_DRY_RUN");

  if (realDraftReady) {
    return [
      "WeChat draft mode: real API draft creation is configured; env:check validates credentials and cover inputs but does not call WeChat API.",
      "Real mode is limited to official draft creation and still requires publish/mass-send guards to stay enabled."
    ];
  }

  if (realDraftIntent) {
    return [
      "WeChat draft mode: incomplete real-mode intent detected; keep WECHAT_DRAFT_DRY_RUN=true for dry-run or set both real switches plus credentials and cover inputs.",
      "Dry-run mode only writes request previews/preflight outputs and does not fetch access_token or create WeChat drafts."
    ];
  }

  return [
    "WeChat draft mode: dry-run/preflight only; no access_token fetch and no real draft creation should occur.",
    "Real draft mode requires WECHAT_API_ENABLE_REAL_DRAFT=true, WECHAT_DRAFT_ALLOW_REAL_API=true, WECHAT_DRAFT_DRY_RUN=false, AppID/AppSecret, and WECHAT_COVER_MEDIA_ID or a real JPG/PNG cover path."
  ];
}

function describeLlmMode(env: NodeJS.ProcessEnv): string[] {
  const realReady =
    isExplicitTrue(env, "LLM_ENABLE_REAL_API") &&
    isExplicitFalse(env, "LLM_DRY_RUN") &&
    (envValue(env, "LLM_PROVIDER") ?? "minimax") === "minimax";

  if (realReady) {
    return [
      "MiniMax LLM mode: real API calls are configured for article writing, title generation, and auxiliary review.",
      "MiniMax API key is read from environment only and must not be written to outputs or logs."
    ];
  }

  return [
    "MiniMax LLM mode: mock/deterministic text generation; no MiniMax API call should occur."
  ];
}

function formatMissingExampleKeys(
  missingKeys: string[],
  references: Map<string, Set<string>>
): string {
  return missingKeys
    .map((key) => {
      const sources = [...(references.get(key) ?? [])].slice(0, 2).join(", ");
      return sources ? `${key} (${sources})` : key;
    })
    .join(", ");
}

export async function checkEnvironment(
  options: EnvCheckOptions = {}
): Promise<EnvCheckResult> {
  const root = resolve(options.projectRoot ?? defaultProjectRoot);
  const dotenvPath =
    options.dotenvPath === null
      ? null
      : resolve(options.dotenvPath ?? join(root, ".env"));
  const runtimeEnv: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const examplePath = join(root, ".env.example");
  const exampleContent = await readOptionalTextFile(examplePath);

  if (!exampleContent) {
    errors.push(".env.example is missing.");
    return { ok: false, errors, warnings, info };
  }

  const example = parseDotEnv(exampleContent);
  if (example.errors.length > 0) {
    errors.push(formatDotEnvParseErrors(examplePath, example.errors));
  }

  const exampleDuplicates = duplicateEnvKeys(example.entries);
  if (exampleDuplicates.length > 0) {
    errors.push(`.env.example has duplicate keys: ${exampleDuplicates.join(", ")}.`);
  }

  const exampleNames = new Set(example.entries.map((entry) => entry.key));

  if (dotenvPath) {
    const dotenvContent = await readOptionalTextFile(dotenvPath);
    if (!dotenvContent) {
      warnings.push(".env was not found; using shell environment only.");
    } else {
      const parsed = parseDotEnv(dotenvContent);
      if (parsed.errors.length > 0) {
        errors.push(formatDotEnvParseErrors(dotenvPath, parsed.errors));
      } else {
        applyEntriesToEnv(parsed.entries, runtimeEnv, miniMaxDotEnvOverrideKeys);
        info.push(`Loaded ${relative(root, dotenvPath)} (${parsed.entries.length} keys).`);
      }

      const localDuplicates = duplicateEnvKeys(parsed.entries);
      if (localDuplicates.length > 0) {
        errors.push(`.env has duplicate keys: ${localDuplicates.join(", ")}.`);
      }

      const unknownLocalKeys = [
        ...new Set(parsed.entries.map((entry) => entry.key))
      ].filter((key) => !exampleNames.has(key));
      if (unknownLocalKeys.length > 0) {
        errors.push(
          `.env contains keys not declared in .env.example: ${unknownLocalKeys.join(", ")}.`
        );
      }
    }
  }

  const references = await collectEnvReferences(root);
  const missingExampleKeys = [...references.keys()]
    .filter((key) => !exampleNames.has(key))
    .sort();

  if (missingExampleKeys.length > 0) {
    errors.push(
      `.env.example is missing keys used by code: ${formatMissingExampleKeys(
        missingExampleKeys,
        references
      )}.`
    );
  }

  const missingSpecKeys = [...envSpecByName.keys()]
    .filter((key) => !exampleNames.has(key))
    .sort();
  if (missingSpecKeys.length > 0) {
    errors.push(
      `.env.example is missing keys required by env:check: ${missingSpecKeys.join(", ")}.`
    );
  }

  for (const name of exampleNames) {
    const value = envValue(runtimeEnv, name);
    const spec = envSpecByName.get(name);

    if (value && spec) {
      validateEnvValue(spec, value, errors);
    }
  }

  validateConditionalEnv(runtimeEnv, errors, warnings);
  info.push(...describeLlmMode(runtimeEnv));
  info.push(...describeWechatDraftMode(runtimeEnv));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info
  };
}

export async function checkEnvironmentCli(
  options: EnvCheckCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const result = await checkEnvironment(options);

  for (const message of result.info) {
    stdout(`[env:check] ${message}`);
  }

  for (const message of result.warnings) {
    stderr(`[env:check] warning: ${message}`);
  }

  for (const message of result.errors) {
    stderr(`[env:check] error: ${message}`);
  }

  stdout(result.ok ? "[env:check] ok" : "[env:check] failed");
  return result.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await checkEnvironmentCli();
}
