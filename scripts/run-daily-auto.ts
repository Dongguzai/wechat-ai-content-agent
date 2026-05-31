import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNotificationConfig,
  sendNotification
} from "../src/adapters/notification.js";
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
import type { CoverResult } from "../src/types/cover.js";
import type { ArticleMeta } from "../src/types/article.js";
import type { SelectedTopic } from "../src/types/news.js";
import { formatRunArchiveTimestamp } from "../src/utils/dateFormat.js";
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
  selectedTopicUrl?: string | null;
  coverImagePath?: string | null;
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
  runsDir?: string;
  fetchImpl?: FetchLike;
  notifyFetchImpl?: FetchLike;
  stepHandlers?: Partial<Record<DailyAutoExecutableStepName, DailyAutoStepHandler>>;
  archiveRuns?: boolean;
  loadEnv?: boolean;
  writeOutputs?: boolean;
  consoleOutput?: boolean;
}

const outputDirDefault = join(projectRoot, "outputs");
const logFileDefault = join(projectRoot, "logs", "daily-auto.log");
const runsDirDefault = join(projectRoot, "runs");
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
    durationMs: 0,
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
  const sensitiveValues = [
    env.WECHAT_APP_SECRET,
    env.APIMART_API_KEY,
    env.NOTIFY_WEBHOOK_URL
  ]
    .map(trimEnv)
    .filter(Boolean);
  let redacted = text;

  for (const value of sensitiveValues) {
    redacted = redacted.split(value).join("[redacted]");
  }

  redacted = redacted.replace(/access_token\s*=\s*[^&\s]+/gi, "credential=[redacted]");
  redacted = redacted.replace(
    /"access_token"\s*:\s*"[^"]*"/gi,
    '"credential":"[redacted]"'
  );
  redacted = redacted.replace(/\baccess_token\b/gi, "credential");
  redacted = redacted.replace(/appsecret\s*=\s*[^&\s]+/gi, "credential=[redacted]");
  redacted = redacted.replace(
    /"appsecret"\s*:\s*"[^"]*"/gi,
    '"credential":"[redacted]"'
  );

  return redacted;
}

function errorMessage(error: unknown, env: NodeJS.ProcessEnv): string {
  const raw = error instanceof Error ? error.message : "Unknown error.";
  return redactSensitiveText(raw, env);
}

function createOutputFiles(input: {
  outputDir: string;
  logFile: string;
  runReport: string;
}): DailyAutoOutputFiles {
  return {
    log: input.logFile,
    report: join(input.outputDir, "daily-auto-report.md"),
    result: join(input.outputDir, "daily-auto-result.json"),
    runReport: input.runReport
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
    ["APIMART_API_KEY", trimEnv(env.APIMART_API_KEY)],
    ["APIMART_IMAGE_API_URL", trimEnv(env.APIMART_IMAGE_API_URL)],
    ["WECHAT_APP_ID", trimEnv(env.WECHAT_APP_ID)],
    ["WECHAT_APP_SECRET", trimEnv(env.WECHAT_APP_SECRET)]
  ];
  const missing = requiredValues.filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}.`);
  }

  const switchValues: Array<[string, string | undefined, string]> = [
    ["REAL_PRODUCTION_MODE", env.REAL_PRODUCTION_MODE, "true"],
    ["RSS_ENABLE_REAL_FETCH", env.RSS_ENABLE_REAL_FETCH, "true"],
    ["SEARCH_ENABLE_REAL_API", env.SEARCH_ENABLE_REAL_API, "true"],
    ["COVER_ENABLE_REAL_API", env.COVER_ENABLE_REAL_API, "true"],
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

  if (!trimEnv(env.TAVILY_API_KEY) && !trimEnv(env.EXA_API_KEY)) {
    throw new Error(
      "REAL_PRODUCTION_MODE=true requires TAVILY_API_KEY or EXA_API_KEY so mock search cannot enter production."
    );
  }

  return env.WECHAT_DRAFT_DRY_RUN === "false"
    ? "Required real-draft environment is present; WECHAT_DRAFT_DRY_RUN=false."
    : "Required production environment is present; real draft stage will force WECHAT_DRAFT_DRY_RUN=false.";
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
    selectedTopicUrl: result.artifacts.selectedTopic.selected.url,
    coverImagePath: result.artifacts.cover.imagePath,
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
    coverImagePath: result.result.coverImagePath || null,
    draftMediaId: result.result.mediaId,
    message: `WeChat official API draft created; mediaId=${result.result.mediaId}.`
  };
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readSummaryArtifacts(outputDir: string): Promise<{
  articleTitle: string | null;
  selectedTopicTitle: string | null;
  selectedTopicUrl: string | null;
  coverImagePath: string | null;
  draftMediaId: string | null;
}> {
  const [articleMeta, selectedTopic, cover, draftResult] = await Promise.all([
    readOptionalJsonFile<ArticleMeta>(join(outputDir, "article-meta.json")),
    readOptionalJsonFile<SelectedTopic>(join(outputDir, "selected-topic.json")),
    readOptionalJsonFile<CoverResult>(join(outputDir, "cover.json")),
    readOptionalJsonFile<{ mediaId?: string; title?: string; coverImagePath?: string }>(
      join(outputDir, "wechat-api-draft-result.json")
    )
  ]);

  return {
    articleTitle:
      draftResult?.title?.trim() ||
      articleMeta?.title?.trim() ||
      selectedTopic?.selected.title?.trim() ||
      null,
    selectedTopicTitle: selectedTopic?.selected.title?.trim() || null,
    selectedTopicUrl: selectedTopic?.selected.url?.trim() || null,
    coverImagePath:
      draftResult?.coverImagePath?.trim() ||
      cover?.imagePath?.trim() ||
      null,
    draftMediaId: draftResult?.mediaId?.trim() || null
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
      `- ${step.status}: ${step.name} (${step.durationMs}ms) - ${step.message || "No message."}`
  );
  const statusText = input.result.status === "success" ? "成功" : "失败";
  const failureAdvice =
    input.result.status === "failed"
      ? [
          "",
          "## 失败原因与建议处理方式",
          "",
          `- 失败原因: ${input.result.error ?? "未记录具体错误。"}`,
          stoppedBySameDayLock
            ? "- 建议处理: 今日已经创建过真实草稿。默认不要重复运行；如确需手动重跑，只能人工执行 `pnpm run:daily:auto -- --force`。"
            : "- 建议处理: 先查看本报告和 `logs/daily-auto.log`，修复失败步骤对应的配置、数据源或审核产物后再手动重跑。"
        ]
      : [];

  return [
    "# 每日自动草稿运行报告",
    "",
    "## 今日运行状态",
    "",
    `- 今日运行状态: ${statusText}`,
    `- mode: ${input.result.mode}`,
    `- 运行开始时间: ${input.result.startedAt}`,
    `- 运行结束时间: ${input.result.finishedAt}`,
    `- 运行耗时: ${input.result.durationMs}ms`,
    `- 生成时间: ${input.result.generatedAt}`,
    `- 是否手动 --force: ${input.force ? "是" : "否"}`,
    `- 是否被同日真实草稿锁阻断: ${stoppedBySameDayLock ? "是" : "否"}`,
    "",
    "## 今日内容",
    "",
    `- 今日主选题: ${input.result.selectedTitle ?? "无"}`,
    `- 主选题 URL: ${input.result.selectedTopicUrl ?? "无"}`,
    `- 文章标题: ${input.result.selectedTitle ?? "无"}`,
    `- 封面图路径: ${input.result.coverImagePath ?? "无"}`,
    `- 微信草稿 media_id: ${input.result.draftMediaId ?? "无"}`,
    "",
    "## 安全确认",
    "",
    `- 是否只创建草稿: ${input.result.draftOnly ? "是" : "否"}`,
    `- 是否发布: ${input.result.publishApiCalled ? "是" : "否"}`,
    `- 是否群发: ${input.result.massSendApiCalled ? "是" : "否"}`,
    `- 是否需要人工确认: ${input.result.requiresHumanConfirmation ? "是" : "否"}`,
    "",
    "## 每一步执行结果",
    "",
    ...stepLines,
    ...failureAdvice,
    "",
    "## 安全边界",
    "",
    "- 系统只允许创建微信公众号官方 API 草稿箱草稿。",
    "- 系统不会自动发布。",
    "- 系统不会自动群发。",
    "- 系统禁止调用 publish、freepublish、mass、sendall 等发布或群发接口。",
    "- 系统不会打开或操作微信公众号后台。",
    "- REAL_PRODUCTION_MODE=true 时，真实数据审计会阻断 mock news / mock search / mock cover / fallback mock 进入草稿。",
    "- article-review、cover-review、wechat-layout、preflight:final 仍是必经闸门。",
    "- 同日真实草稿锁默认生效；`--force` 只能由人工显式手动执行。",
    "- 最终发布仍必须由人工登录微信公众号后台确认。",
    "- AppSecret、access token、APIMart key 不会写入本报告。",
    "",
    "## 输出文件",
    "",
    `- result: ${input.files.result}`,
    `- report: ${input.files.report}`,
    `- runReport: ${input.files.runReport}`,
    `- log: ${input.files.log}`,
    ""
  ].join("\n");
}

function buildResult(input: {
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: DailyAutoStepResult[];
  selectedTitle: string | null;
  selectedTopicUrl: string | null;
  coverImagePath: string | null;
  draftMediaId: string | null;
  error: string | null;
}): DailyAutoResult {
  return {
    mode: "daily_auto",
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    selectedTitle: input.selectedTitle,
    selectedTopicUrl: input.selectedTopicUrl,
    coverImagePath: input.coverImagePath,
    draftMediaId: input.draftMediaId,
    draftOnly: true,
    publishApiCalled: false,
    massSendApiCalled: false,
    requiresHumanConfirmation: true,
    steps: input.steps,
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
      const skippedAt = nowIso();
      step.startedAt = step.startedAt || skippedAt;
      step.finishedAt = step.finishedAt || skippedAt;
      step.durationMs = 0;
      step.message = `Skipped because ${input.failedStepName} failed.`;
    }
  });
}

export async function runDailyAuto(
  options: RunDailyAutoOptions = {}
): Promise<DailyAutoResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const outputDir = options.outputDir ?? outputDirDefault;
  const logFile = options.logFile ?? logFileDefault;
  const runsDir = options.runsDir ?? runsDirDefault;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const force = options.force === true;
  const archiveRuns = options.archiveRuns ?? true;
  const writeOutputs = options.writeOutputs ?? true;
  const consoleOutput = options.consoleOutput ?? true;
  const runDir = join(runsDir, formatRunArchiveTimestamp(now));
  const files = createOutputFiles({
    outputDir,
    logFile,
    runReport: join(runDir, "run-report.md")
  });
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
  let selectedTitle: string | null = null;
  let selectedTopicUrl: string | null = null;
  let coverImagePath: string | null = null;
  let draftMediaId: string | null = null;
  let status: "success" | "failed" = "failed";
  let error: string | null = null;

  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(logFile), { recursive: true });
  await mkdir(runDir, { recursive: true });
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
    const stepStartedAtMs = Date.now();
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

      if (result?.selectedTopicUrl !== undefined) {
        selectedTopicUrl = result.selectedTopicUrl;
      }

      if (result?.coverImagePath !== undefined) {
        coverImagePath = result.coverImagePath;
      }

      if (result?.draftMediaId !== undefined) {
        draftMediaId = result.draftMediaId;
      }

      step.status = "success";
      step.message = redactSensitiveText(result?.message ?? "Completed.", env);
      step.finishedAt = nowIso();
      step.durationMs = Date.now() - stepStartedAtMs;
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
      step.durationMs = Date.now() - stepStartedAtMs;
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
          step.durationMs = 0;
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

  const currentRunHasArtifacts = steps.some(
    (step) =>
      step.status === "success" &&
      (step.name === "run:daily" || step.name === "wechat:draft:real")
  );
  if (currentRunHasArtifacts) {
    const summary = await readSummaryArtifacts(outputDir);
    selectedTitle = selectedTitle ?? summary.articleTitle;
    selectedTopicUrl = selectedTopicUrl ?? summary.selectedTopicUrl;
    coverImagePath = coverImagePath ?? summary.coverImagePath;
    draftMediaId = draftMediaId ?? summary.draftMediaId;
  }
  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();
  const result = buildResult({
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    steps,
    selectedTitle,
    selectedTopicUrl,
    coverImagePath,
    draftMediaId,
    error
  });
  const report = createReport({ result, files, force });

  if (writeOutputs) {
    await writeJson(files.result, result);
    await writeFile(files.report, report, "utf8");
    await writeFile(files.runReport, report, "utf8");
  }

  const notificationConfig = createNotificationConfig(env);
  const notificationTitle =
    result.status === "success"
      ? "每日自动草稿创建成功"
      : "每日自动草稿创建失败";
  const notificationMessage =
    result.status === "success"
      ? "每日生产流程已完成，微信公众号草稿箱已创建草稿，仍需人工确认后发布。"
      : "每日生产流程失败，草稿创建未完成或被安全闸门阻断，请查看运行报告。";
  const notificationResult = await sendNotification({
    config: notificationConfig,
    fetchImpl: options.notifyFetchImpl ?? options.fetchImpl,
    payload: {
      status: result.status,
      title: notificationTitle,
      message: notificationMessage,
      selectedTitle: result.selectedTitle,
      draftMediaId: result.draftMediaId,
      reportPath: files.report,
      requiresHumanConfirmation: true,
      generatedAt: result.generatedAt
    },
    consoleNotify: (message) =>
      appendLog({
        logFile,
        env,
        consoleOutput,
        line: `[${nowIso()}] [daily-auto] [notify] ${message}`
      })
  });

  if (notificationResult.warning) {
    appendLog({
      logFile,
      env,
      consoleOutput,
      line: `[${nowIso()}] [daily-auto] [warn] ${notificationResult.warning}`
    });
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
