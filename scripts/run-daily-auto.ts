import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv, projectRoot } from "../src/config/env.js";
import { verifyWechatDraftOnlyApiGuard } from "../src/hooks/forbidWechatPublishApi.js";
import { archiveRunOutputs } from "../src/pipeline/archiveRun.js";
import { auditRealData } from "../src/pipeline/auditRealData.js";
import { runFinalPreflight } from "../src/pipeline/finalPreflight.js";
import { runDailyPipeline } from "../src/pipeline/runDailyPipeline.js";
import { saveWechatDraftApiWithReport } from "../src/pipeline/saveWechatDraftApi.js";
import { readWechatDraftRunLock } from "../src/pipeline/wechatDraftRunLock.js";
import type {
  DailyAutoOutputFiles,
  DailyAutoResult,
  DailyAutoStepName,
  DailyAutoStepResult
} from "../src/types/dailyAuto.js";
import type { Logger } from "../src/utils/logger.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface DailyAutoStepHandlerContext {
  outputDir: string;
  env: NodeJS.ProcessEnv;
  now: Date;
  force: boolean;
  lockDir?: string;
  fetchImpl?: FetchLike;
  logger: Logger;
}

export interface DailyAutoStepHandlerResult {
  message?: string;
  selectedTitle?: string;
  draftMediaId?: string | null;
}

export type DailyAutoExecutableStepName =
  | "run:daily"
  | "real-data-audit"
  | "wechat:draft:dry-run"
  | "preflight:final"
  | "wechat:draft:real";

export type DailyAutoStepHandler = (
  context: DailyAutoStepHandlerContext
) => Promise<DailyAutoStepHandlerResult | void>;

export interface RunDailyAutoOptions {
  outputDir?: string;
  logFile?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  force?: boolean;
  lockDir?: string;
  fetchImpl?: FetchLike;
  stepHandlers?: Partial<Record<DailyAutoExecutableStepName, DailyAutoStepHandler>>;
  archiveRuns?: boolean;
  loadEnv?: boolean;
  writeOutputs?: boolean;
  consoleOutput?: boolean;
}

const outputDirDefault = join(projectRoot, "outputs");
const logFileDefault = join(projectRoot, "logs", "daily-auto.log");
const executableStepNames: DailyAutoExecutableStepName[] = [
  "run:daily",
  "real-data-audit",
  "wechat:draft:dry-run",
  "preflight:final",
  "wechat:draft:real"
];
const allStepNames: DailyAutoStepName[] = [
  "env:check",
  "same-day draft lock",
  ...executableStepNames
];

function nowIso(): string {
  return new Date().toISOString();
}

function createInitialSteps(): DailyAutoStepResult[] {
  return allStepNames.map((name) => ({
    name,
    status: "skipped",
    startedAt: "",
    finishedAt: "",
    message: "Not started."
  }));
}

function trimEnv(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isRealProductionMode(env: NodeJS.ProcessEnv): boolean {
  return env.REAL_PRODUCTION_MODE?.trim().toLowerCase() === "true";
}

function redactSensitiveText(text: string, env: NodeJS.ProcessEnv): string {
  const secret = trimEnv(env.WECHAT_APP_SECRET);
  let redacted = secret ? text.split(secret).join("[redacted]") : text;

  redacted = redacted.replace(/access_token\s*=\s*[^&\s]+/gi, "credential=[redacted]");
  redacted = redacted.replace(
    /"access_token"\s*:\s*"[^"]*"/gi,
    '"credential":"[redacted]"'
  );
  redacted = redacted.replace(/\baccess_token\b/gi, "credential");

  return redacted;
}

function errorMessage(error: unknown, env: NodeJS.ProcessEnv): string {
  const raw = error instanceof Error ? error.message : "Unknown error.";
  return redactSensitiveText(raw, env);
}

function createOutputFiles(input: {
  outputDir: string;
  logFile: string;
}): DailyAutoOutputFiles {
  return {
    log: input.logFile,
    report: join(input.outputDir, "daily-auto-report.md"),
    result: join(input.outputDir, "daily-auto-result.json")
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendLog(input: {
  logFile: string;
  env: NodeJS.ProcessEnv;
  line: string;
  consoleOutput: boolean;
}): void {
  const line = redactSensitiveText(input.line, input.env);
  appendFileSync(input.logFile, `${line}\n`, "utf8");

  if (input.consoleOutput) {
    console.log(line);
  }
}

function createFileLogger(input: {
  logFile: string;
  env: NodeJS.ProcessEnv;
  consoleOutput: boolean;
}): Logger {
  const write = (level: string, message: string): void => {
    appendLog({
      ...input,
      line: `[${nowIso()}] [daily-auto] [${level}] ${message}`
    });
  };

  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message)
  };
}

function assertRequiredEnv(env: NodeJS.ProcessEnv): string {
  const requiredValues: Array<[string, string]> = [
    ["WECHAT_APP_ID", trimEnv(env.WECHAT_APP_ID)],
    ["WECHAT_APP_SECRET", trimEnv(env.WECHAT_APP_SECRET)],
    ["WECHAT_COVER_MEDIA_ID", trimEnv(env.WECHAT_COVER_MEDIA_ID)]
  ];
  const missing = requiredValues.filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}.`);
  }

  const switchValues: Array<[string, string | undefined, string]> = [
    ["WECHAT_API_ENABLE_REAL_DRAFT", env.WECHAT_API_ENABLE_REAL_DRAFT, "true"],
    ["WECHAT_DRAFT_ALLOW_REAL_API", env.WECHAT_DRAFT_ALLOW_REAL_API, "true"]
  ];
  const invalidSwitches = switchValues
    .filter(([, actual, expected]) => actual !== expected)
    .map(([key, actual, expected]) => `${key} must be ${expected}, got ${actual ?? "unset"}`);

  if (invalidSwitches.length > 0) {
    throw new Error(invalidSwitches.join("; "));
  }

  if (!verifyWechatDraftOnlyApiGuard()) {
    throw new Error("WeChat draft-only API guard is not active.");
  }

  if (isRealProductionMode(env)) {
    if (env.RSS_ENABLE_REAL_FETCH !== "true") {
      throw new Error("REAL_PRODUCTION_MODE=true requires RSS_ENABLE_REAL_FETCH=true.");
    }

    if (env.SEARCH_ENABLE_REAL_API !== "true") {
      throw new Error("REAL_PRODUCTION_MODE=true requires SEARCH_ENABLE_REAL_API=true.");
    }

    if (!trimEnv(env.TAVILY_API_KEY) && !trimEnv(env.EXA_API_KEY)) {
      throw new Error(
        "REAL_PRODUCTION_MODE=true requires TAVILY_API_KEY or EXA_API_KEY so mock search cannot enter production."
      );
    }
  }

  return env.WECHAT_DRAFT_DRY_RUN === "false"
    ? "Required real-draft environment is present; WECHAT_DRAFT_DRY_RUN=false."
    : "Required real-draft environment is present; real draft stage will force WECHAT_DRAFT_DRY_RUN=false.";
}

async function defaultRealDataAudit(
  context: DailyAutoStepHandlerContext
): Promise<DailyAutoStepHandlerResult> {
  const result = await auditRealData({
    outputDir: context.outputDir,
    env: context.env,
    logger: context.logger,
    writeOutputs: true,
    now: context.now
  });

  if (!result.passed) {
    throw new Error(`Real data audit blocked: ${result.issues.join(" ")}`);
  }

  return {
    message: `Real data audit passed; mockCandidates=${result.summary.mockCandidateCount}; coverMode=${result.summary.coverMode}.`
  };
}

async function defaultRunDaily(
  context: DailyAutoStepHandlerContext,
  archiveRuns: boolean
): Promise<DailyAutoStepHandlerResult> {
  const result = await runDailyPipeline({
    outputDir: context.outputDir,
    logger: context.logger,
    fetchImpl: context.fetchImpl,
    env: {
      ...context.env,
      WECHAT_DRAFT_DRY_RUN: "true",
      WECHAT_API_ENABLE_REAL_DRAFT: "false",
      WECHAT_DRAFT_ALLOW_REAL_API: "false"
    },
    now: context.now
  });
  const archive = archiveRuns
    ? await archiveRunOutputs({
        outputDir: result.outputDir,
        now: context.now
      })
    : undefined;

  return {
    selectedTitle: result.artifacts.titleSelection.selectedTitle,
    message: archive
      ? `Daily pipeline completed; output=${result.outputDir}; archived=${archive.archiveDir}.`
      : `Daily pipeline completed; output=${result.outputDir}.`
  };
}

async function defaultWechatDraftDryRun(
  context: DailyAutoStepHandlerContext
): Promise<DailyAutoStepHandlerResult> {
  const result = await saveWechatDraftApiWithReport({
    outputDir: context.outputDir,
    logger: context.logger,
    env: {
      ...context.env,
      WECHAT_DRAFT_DRY_RUN: "true",
      WECHAT_API_ENABLE_REAL_DRAFT: "false",
      WECHAT_DRAFT_ALLOW_REAL_API: "false"
    },
    fetchImpl: context.fetchImpl,
    writeOutputs: true,
    now: context.now
  });

  return {
    message: `Official API draft dry-run completed; mode=${result.result.mode}; status=${result.result.status}.`
  };
}

async function defaultFinalPreflight(
  context: DailyAutoStepHandlerContext
): Promise<DailyAutoStepHandlerResult> {
  const result = await runFinalPreflight({
    outputDir: context.outputDir,
    env: context.env,
    now: context.now,
    force: context.force,
    lockDir: context.lockDir
  });

  if (!result.passed) {
    throw new Error(`Final preflight blocked: ${result.issues.join(" ")}`);
  }

  return {
    message: "Final preflight passed."
  };
}

async function defaultWechatDraftReal(
  context: DailyAutoStepHandlerContext
): Promise<DailyAutoStepHandlerResult> {
  const result = await saveWechatDraftApiWithReport({
    outputDir: context.outputDir,
    logger: context.logger,
    env: {
      ...context.env,
      WECHAT_DRAFT_DRY_RUN: "false"
    },
    fetchImpl: context.fetchImpl,
    writeOutputs: true,
    now: context.now,
    force: context.force,
    lockDir: context.lockDir
  });

  if (result.result.mode !== "real_api") {
    throw new Error("Real draft stage did not enter real_api mode.");
  }

  if (
    result.result.safety.draftOnly !== true ||
    result.result.safety.publishApiCalled !== false ||
    result.result.safety.massSendApiCalled !== false ||
    result.result.safety.requiresHumanConfirmation !== true
  ) {
    throw new Error("Real draft stage returned unsafe WeChat draft safety flags.");
  }

  return {
    selectedTitle: result.result.title,
    draftMediaId: result.result.mediaId,
    message: `WeChat official API draft created; mediaId=${result.result.mediaId}.`
  };
}

function createReport(input: {
  result: DailyAutoResult;
  files: DailyAutoOutputFiles;
  force: boolean;
}): string {
  const sameDayLockStep = input.result.steps.find(
    (step) => step.name === "same-day draft lock"
  );
  const stoppedBySameDayLock =
    sameDayLockStep?.status === "failed" &&
    /same-day|同日|lock/i.test(sameDayLockStep.message);
  const stepLines = input.result.steps.map(
    (step) =>
      `- ${step.status}: ${step.name} - ${step.message || "No message."}`
  );

  return [
    "# Daily Auto Draft Report",
    "",
    "## Result",
    "",
    `- mode: ${input.result.mode}`,
    `- status: ${input.result.status}`,
    `- generatedAt: ${input.result.generatedAt}`,
    `- force: ${input.force}`,
    `- selectedTitle: ${input.result.selectedTitle || "none"}`,
    `- draftMediaId: ${input.result.draftMediaId ?? "none"}`,
    `- stoppedBySameDayDraftLock: ${stoppedBySameDayLock ? "yes" : "no"}`,
    `- error: ${input.result.error ?? "none"}`,
    "",
    "## Steps",
    "",
    ...stepLines,
    "",
    "## Safety Boundary",
    "",
    "- This automation only creates WeChat official API draft-box drafts.",
    "- It does not publish articles.",
    "- It does not mass send articles.",
    "- It does not call publish, freepublish, mass, or sendall interfaces.",
    "- It does not open or operate the WeChat admin console.",
    "- REAL_PRODUCTION_MODE=true runs real-data-audit immediately after run:daily and stops on any mock/fallback production artifact.",
    "- article-review, cover-review, wechat-layout, and preflight:final remain mandatory gates.",
    "- same-day real draft lock remains active by default; use --force only for an explicit manual repeat test.",
    "- Final publishing still requires human confirmation in the official WeChat admin console.",
    "- AppSecret and credential values are not written to this report.",
    "",
    "## Output Files",
    "",
    `- result: ${input.files.result}`,
    `- report: ${input.files.report}`,
    `- log: ${input.files.log}`,
    ""
  ].join("\n");
}

function buildResult(input: {
  status: "success" | "failed";
  steps: DailyAutoStepResult[];
  selectedTitle: string;
  draftMediaId: string | null;
  error: string | null;
}): DailyAutoResult {
  return {
    mode: "daily_auto",
    status: input.status,
    steps: input.steps,
    selectedTitle: input.selectedTitle,
    draftMediaId: input.draftMediaId,
    draftOnly: true,
    publishApiCalled: false,
    massSendApiCalled: false,
    requiresHumanConfirmation: true,
    error: input.error,
    generatedAt: nowIso()
  };
}

function markSkippedAfterFailure(input: {
  steps: DailyAutoStepResult[];
  failedStepName: DailyAutoStepName;
}): void {
  const failedIndex = input.steps.findIndex(
    (step) => step.name === input.failedStepName
  );

  input.steps.slice(failedIndex + 1).forEach((step) => {
    if (step.status === "skipped") {
      step.message = `Skipped because ${input.failedStepName} failed.`;
    }
  });
}

export async function runDailyAuto(
  options: RunDailyAutoOptions = {}
): Promise<DailyAutoResult> {
  const outputDir = options.outputDir ?? outputDirDefault;
  const logFile = options.logFile ?? logFileDefault;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const force = options.force === true;
  const archiveRuns = options.archiveRuns ?? true;
  const writeOutputs = options.writeOutputs ?? true;
  const consoleOutput = options.consoleOutput ?? true;
  const files = createOutputFiles({ outputDir, logFile });
  const steps = createInitialSteps();
  const logger = createFileLogger({ logFile, env, consoleOutput });
  const context: DailyAutoStepHandlerContext = {
    outputDir,
    env,
    now,
    force,
    lockDir: options.lockDir,
    fetchImpl: options.fetchImpl,
    logger
  };
  let selectedTitle = "";
  let draftMediaId: string | null = null;
  let status: "success" | "failed" = "failed";
  let error: string | null = null;

  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(logFile), { recursive: true });
  await writeFile(logFile, "", { flag: "a" });

  const runStep = async (
    name: DailyAutoStepName,
    action: () => Promise<DailyAutoStepHandlerResult | void>
  ): Promise<void> => {
    const step = steps.find((candidate) => candidate.name === name);
    if (!step) {
      throw new Error(`Unknown daily auto step: ${name}`);
    }

    step.status = "failed";
    step.startedAt = nowIso();
    step.message = "Started.";
    appendLog({
      logFile,
      env,
      consoleOutput,
      line: `[${step.startedAt}] [daily-auto] [start] ${name}`
    });

    try {
      const result = await action();

      if (result?.selectedTitle) {
        selectedTitle = result.selectedTitle;
      }

      if (result?.draftMediaId !== undefined) {
        draftMediaId = result.draftMediaId;
      }

      step.status = "success";
      step.message = redactSensitiveText(result?.message ?? "Completed.", env);
      step.finishedAt = nowIso();
      appendLog({
        logFile,
        env,
        consoleOutput,
        line: `[${step.finishedAt}] [daily-auto] [success] ${name}: ${step.message}`
      });
    } catch (caught) {
      step.status = "failed";
      step.message = errorMessage(caught, env);
      step.finishedAt = nowIso();
      appendLog({
        logFile,
        env,
        consoleOutput,
        line: `[${step.finishedAt}] [daily-auto] [failed] ${name}: ${step.message}`
      });
      throw caught;
    }
  };

  try {
    await runStep("env:check", async () => {
      if (options.loadEnv ?? options.env === undefined) {
        await loadDotEnv({ env });
      }

      return {
        message: assertRequiredEnv(env)
      };
    });

    await runStep("same-day draft lock", async () => {
      const lockState = await readWechatDraftRunLock({
        lockDir: options.lockDir,
        now
      });

      if (lockState.locked && !force) {
        const createdAt = lockState.lock?.createdAt ?? "unknown time";
        throw new Error(
          `same-day draft lock stopped daily auto: a real draft already exists for ${lockState.date} at ${createdAt}. Use --force only for an explicit manual repeat test.`
        );
      }

      if (lockState.locked && force) {
        return {
          message: `Existing same-day draft lock for ${lockState.date} is overridden by explicit --force.`
        };
      }

      return {
        message: `same-day draft lock is clear for ${lockState.date}.`
      };
    });

    for (const name of executableStepNames) {
      if (name === "real-data-audit" && !isRealProductionMode(env)) {
        const step = steps.find((candidate) => candidate.name === name);
        if (step) {
          step.status = "skipped";
          step.startedAt = nowIso();
          step.finishedAt = step.startedAt;
          step.message = "Skipped because REAL_PRODUCTION_MODE=false.";
        }
        continue;
      }

      const handler = options.stepHandlers?.[name];
      const action =
        handler ??
        (name === "run:daily"
          ? (stepContext: DailyAutoStepHandlerContext) =>
              defaultRunDaily(stepContext, archiveRuns)
          : name === "real-data-audit"
            ? defaultRealDataAudit
          : name === "wechat:draft:dry-run"
            ? defaultWechatDraftDryRun
            : name === "preflight:final"
              ? defaultFinalPreflight
              : defaultWechatDraftReal);

      await runStep(name, () => action(context));
    }

    status = "success";
  } catch (caught) {
    error = errorMessage(caught, env);
    const failedStep = steps.find((step) => step.status === "failed");
    if (failedStep) {
      markSkippedAfterFailure({
        steps,
        failedStepName: failedStep.name
      });
    }
  }

  const result = buildResult({
    status,
    steps,
    selectedTitle,
    draftMediaId,
    error
  });
  const report = createReport({ result, files, force });

  if (writeOutputs) {
    await writeJson(files.result, result);
    await writeFile(files.report, report, "utf8");
  }

  return result;
}

async function main(): Promise<void> {
  const result = await runDailyAuto({
    force: process.argv.includes("--force"),
    consoleOutput: false
  });

  console.log(
    `[daily-auto] ${result.status}; result=${join(
      outputDirDefault,
      "daily-auto-result.json"
    )}; report=${join(outputDirDefault, "daily-auto-report.md")}; log=${logFileDefault}`
  );

  if (result.error) {
    console.error(`[daily-auto] blocked: ${result.error}`);
  }

  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
