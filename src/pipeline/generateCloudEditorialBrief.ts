import { randomUUID } from "node:crypto";
import type { EditorialBriefDbAdapter } from "../adapters/neon.js";
import type { R2StorageAdapter } from "../adapters/r2.js";
import {
  CLOUD_BRIEF_GENERATION_STEPS,
  type CloudBriefGenerationStep,
  EDITORIAL_BRIEF_RUN_TYPE,
  type CloudEditorialBriefRecord,
  type CloudNewsItemRecord,
  type CloudRunRecord,
  type CloudRunType,
  type CloudShortlistedItemRecord,
  type TodayBriefPayload
} from "../types/cloud.js";
import type { NormalizedNewsItem, ShortlistedNewsItem } from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { formatRunDate } from "../utils/runDate.js";
import {
  collectNewsWithReport,
  type CollectNewsOptions
} from "./collectNews.js";
import {
  generateEditorialBrief,
  type GenerateEditorialBriefOptions
} from "./generateEditorialBrief.js";
import {
  shortlistNewsWithReport,
  type ShortlistNewsOptions
} from "./shortlistNews.js";
import {
  selectTopicWithReport,
  type SelectTopicOptions
} from "./selectTopic.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type StepReporter = (step: CloudBriefGenerationStep) => void;

export interface CloudBriefPipelineFns {
  collectNewsWithReport: typeof collectNewsWithReport;
  shortlistNewsWithReport: typeof shortlistNewsWithReport;
  selectTopicWithReport: typeof selectTopicWithReport;
  generateEditorialBrief: typeof generateEditorialBrief;
}

export interface GenerateCloudEditorialBriefOptions {
  db: EditorialBriefDbAdapter;
  r2: R2StorageAdapter;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  runDate?: string;
  runType?: CloudRunType;
  fetchImpl?: FetchLike;
  logger?: Logger;
  pipeline?: Partial<CloudBriefPipelineFns>;
  force?: boolean;
  onStep?: StepReporter;
  sanitizeErrorMessage?: (message: string) => string;
}

export type GenerateCloudEditorialBriefResult =
  | {
      status: "already_exists";
      run: CloudRunRecord;
    }
  | {
      status: "created";
      run: CloudRunRecord;
      brief: CloudEditorialBriefRecord;
      shortlistedItems: CloudShortlistedItemRecord[];
      reportR2Key: string;
    };

const defaultPipeline: CloudBriefPipelineFns = {
  collectNewsWithReport,
  shortlistNewsWithReport,
  selectTopicWithReport,
  generateEditorialBrief
};

const targetCloudCandidateCount = 20;
const minimumCloudCandidateCount = 10;

function fixedNumber(value: number | undefined, fallback = 0): number {
  return Number((value ?? fallback).toFixed(1));
}

function textFallback(primary: string | undefined, fallback: string): string {
  const value = primary?.trim();
  return value ? value : fallback;
}

function createNewsRows(input: {
  runId: string;
  candidates: NormalizedNewsItem[];
  createdAt: string;
}): {
  rows: CloudNewsItemRecord[];
  idByOriginalId: Map<string, string>;
} {
  const idByOriginalId = new Map<string, string>();
  const rows = input.candidates.map((item) => {
    const id = randomUUID();
    idByOriginalId.set(item.id, id);

    return {
      id,
      runId: input.runId,
      title: textFallback(item.titleZh, item.title),
      url: item.url,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      provider: item.provider === "none" ? undefined : item.provider,
      query: item.query,
      summary: textFallback(item.summaryZh, item.summary),
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
      score: fixedNumber(item.scores.final),
      rawJson: item,
      createdAt: input.createdAt
    };
  });

  return { rows, idByOriginalId };
}

function riskNotesFor(item: ShortlistedNewsItem): string[] {
  const notes = [
    ...(item.riskNotesZh ?? []),
    item.editorial.riskNote
  ]
    .map((note) => note?.trim() ?? "")
    .filter(Boolean);

  return [...new Set(notes)];
}

function createShortlistedRows(input: {
  runId: string;
  shortlisted: ShortlistedNewsItem[];
  idByOriginalId: Map<string, string>;
  createdAt: string;
}): {
  rows: CloudShortlistedItemRecord[];
  idByOriginalId: Map<string, string>;
} {
  const idByOriginalId = new Map<string, string>();
  const sorted = [...input.shortlisted].sort(
    (left, right) => right.shortlistScore - left.shortlistScore
  );
  const rows = sorted.map((item, index) => {
    const id = randomUUID();
    const newsItemId = input.idByOriginalId.get(item.id);

    if (!newsItemId) {
      throw new Error(`Cannot persist shortlisted item without matching news item: ${item.id}`);
    }

    idByOriginalId.set(item.id, id);

    return {
      id,
      runId: input.runId,
      newsItemId,
      rank: index + 1,
      title: textFallback(item.titleZh, item.title),
      rawTitle: item.rawTitle ?? item.title,
      titleZh: textFallback(item.titleZh, item.title),
      url: item.url,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      provider: item.provider === "none" ? undefined : item.provider,
      query: item.query,
      category: item.category,
      tags: item.tags,
      summary: textFallback(item.summaryZh, item.summary),
      rawSummary: item.rawSummary ?? item.summary,
      summaryZh: textFallback(item.summaryZh, item.summary),
      topicAngle: textFallback(item.topicAngleZh, item.editorial.topicAngle),
      topicAngleZh: textFallback(item.topicAngleZh, item.editorial.topicAngle),
      shortlistReason: textFallback(item.shortlistReasonZh, item.editorial.shortlistReason),
      shortlistReasonZh: textFallback(item.shortlistReasonZh, item.editorial.shortlistReason),
      shortlistScore: fixedNumber(item.shortlistScore),
      riskNotes: riskNotesFor(item),
      riskNotesZh: item.riskNotesZh,
      sourceLanguage: item.sourceLanguage,
      localized: item.localized,
      createdAt: input.createdAt
    };
  });

  return { rows, idByOriginalId };
}

function createBriefRow(input: {
  runId: string;
  recommendedTopicId: string;
  reportR2Key: string;
  createdAt: string;
  briefResult: Awaited<ReturnType<typeof generateEditorialBrief>>;
}): CloudEditorialBriefRecord {
  const recommended = input.briefResult.brief.recommendedTopic;

  return {
    id: randomUUID(),
    runId: input.runId,
    recommendedTopicId: input.recommendedTopicId,
    recommendedTitle: recommended.title,
    recommendedUrl: recommended.url,
    recommendationReason: recommended.reason,
    coreConflict: recommended.coreConflict,
    writingAngle: recommended.writingAngle,
    articleThesis: recommended.articleThesis,
    sourceReliability: recommended.sourceReliability,
    riskNotes: recommended.riskNotes,
    shouldPublishToday: input.briefResult.brief.shouldPublishToday,
    publishRecommendationReason: input.briefResult.brief.publishRecommendationReason,
    reportR2Key: input.reportR2Key,
    createdAt: input.createdAt
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExplicitTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function createCloudBriefCollectionEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const baseEnv = env ?? process.env;

  if (isExplicitTrue(baseEnv.CLOUD_BRIEF_REAL_LOCALIZATION)) {
    return baseEnv;
  }

  return {
    ...baseEnv,
    NEWS_LOCALIZER_FORCE_RULES: "true",
    LLM_DRY_RUN: "true"
  };
}

function isCloudBriefGenerationStep(value: unknown): value is CloudBriefGenerationStep {
  return (
    typeof value === "string" &&
    CLOUD_BRIEF_GENERATION_STEPS.includes(value as CloudBriefGenerationStep)
  );
}

export class CloudBriefStepError extends Error {
  readonly step: CloudBriefGenerationStep;
  readonly originalError: unknown;

  constructor(step: CloudBriefGenerationStep, error: unknown) {
    super(errorMessage(error));
    this.name = "CloudBriefStepError";
    this.step = step;
    this.originalError = error;

    if (error instanceof Error && error.stack) {
      this.stack = error.stack;
    }
  }
}

export function getCloudBriefGenerationStep(error: unknown): CloudBriefGenerationStep | undefined {
  if (error instanceof CloudBriefStepError) {
    return error.step;
  }

  if (error && typeof error === "object" && "step" in error) {
    const step = (error as { step?: unknown }).step;
    if (isCloudBriefGenerationStep(step)) {
      return step;
    }
  }

  return undefined;
}

async function runStep<T>(
  step: CloudBriefGenerationStep,
  reportStep: StepReporter | undefined,
  run: () => Promise<T>
): Promise<T> {
  reportStep?.(step);

  try {
    return await run();
  } catch (error) {
    throw new CloudBriefStepError(step, error);
  }
}

async function runExistingBriefPipeline(input: {
  now: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  logger: Logger;
  pipeline: CloudBriefPipelineFns;
  onStep?: StepReporter;
}) {
  const collectionEnv = createCloudBriefCollectionEnv(input.env);
  const collectOptions: CollectNewsOptions = {
    env: collectionEnv,
    now: input.now,
    fetchImpl: input.fetchImpl,
    logger: input.logger,
    writeOutputs: false
  };
  const { candidates } = await runStep("collectNews", input.onStep, async () => {
    const collection = await input.pipeline.collectNewsWithReport(collectOptions);
    const candidates = collection.candidates.slice(0, targetCloudCandidateCount);

    if (candidates.length < minimumCloudCandidateCount) {
      throw new Error(
        `Cloud editorial brief requires at least ${minimumCloudCandidateCount} candidates, got ${candidates.length}.`
      );
    }

    if (candidates.length < targetCloudCandidateCount) {
      input.logger.warn(
        `Cloud editorial brief collected ${candidates.length}/${targetCloudCandidateCount} candidates; continuing with available candidates.`
      );
    }

    return { candidates };
  });

  const shortlistOptions: ShortlistNewsOptions = {
    candidates,
    now: input.now,
    logger: input.logger,
    writeOutputs: false
  };
  const shortlistResult = await runStep("shortlistNews", input.onStep, async () => {
    const shortlistResult = await input.pipeline.shortlistNewsWithReport(shortlistOptions);

    if (shortlistResult.shortlisted.length !== 10) {
      throw new Error(`Cloud editorial brief requires 10 shortlisted items, got ${shortlistResult.shortlisted.length}.`);
    }

    return shortlistResult;
  });

  const selectOptions: SelectTopicOptions = {
    shortlisted: shortlistResult.shortlisted,
    now: input.now,
    logger: input.logger,
    writeOutputs: false
  };
  const { topicResult, briefResult } = await runStep("selectTopic", input.onStep, async () => {
    const topicResult = await input.pipeline.selectTopicWithReport(selectOptions);
    const briefOptions: GenerateEditorialBriefOptions = {
      candidates,
      shortlisted: shortlistResult.shortlisted,
      selectedTopic: topicResult.topic,
      now: input.now,
      logger: input.logger,
      writeOutputs: false
    };
    const briefResult = await input.pipeline.generateEditorialBrief(briefOptions);

    return { topicResult, briefResult };
  });

  return {
    candidates,
    shortlisted: shortlistResult.shortlisted,
    selectedTopic: topicResult.topic,
    briefResult
  };
}

export async function generateCloudEditorialBrief(
  options: GenerateCloudEditorialBriefOptions
): Promise<GenerateCloudEditorialBriefResult> {
  const logger = options.logger ?? createLogger("cloud-editorial-brief");
  const now = options.now ?? new Date();
  const runDate = options.runDate ?? formatRunDate(now, options.env?.BRIEF_TIME_ZONE);
  const runType = options.runType ?? EDITORIAL_BRIEF_RUN_TYPE;
  const pipeline = { ...defaultPipeline, ...options.pipeline };
  const force = options.force === true;
  let currentStep: CloudBriefGenerationStep = "db.connect";
  const reportStep: StepReporter = (step) => {
    currentStep = step;
    options.onStep?.(step);
  };

  await runStep("db.connect", reportStep, async () => {
    await options.db.ensureSchema();
  });
  const existing = await runStep("db.findExistingRun", reportStep, async () =>
    await options.db.getSuccessfulRun(runDate, runType)
  );
  if (existing && !force) {
    logger.info(`Cloud editorial brief already exists for ${runDate}.`);
    return {
      status: "already_exists",
      run: existing
    };
  }
  if (existing && force) {
    logger.info(`Cloud editorial brief manual force run will overwrite ${runDate}; runId=${existing.id}.`);
  }

  const startedAt = now.toISOString();
  const run = await runStep("db.createRun", reportStep, async () =>
    await options.db.startRun({
      id: randomUUID(),
      runDate,
      runType,
      startedAt
    })
  );

  try {
    await options.db.clearRunArtifacts(run.id);
    const generated = await runExistingBriefPipeline({
      now,
      env: options.env,
      fetchImpl: options.fetchImpl,
      logger,
      pipeline,
      onStep: reportStep
    });
    const createdAt = now.toISOString();
    const newsRows = await runStep("db.saveNewsItems", reportStep, async () => {
      const newsRows = createNewsRows({
        runId: run.id,
        candidates: generated.candidates,
        createdAt
      });
      await options.db.insertNewsItems(newsRows.rows);
      return newsRows;
    });
    const shortlistedRows = await runStep("db.saveShortlistedItems", reportStep, async () => {
      const shortlistedRows = createShortlistedRows({
        runId: run.id,
        shortlisted: generated.shortlisted,
        idByOriginalId: newsRows.idByOriginalId,
        createdAt
      });
      await options.db.insertShortlistedItems(shortlistedRows.rows);
      return shortlistedRows;
    });
    const recommendedOriginalId = generated.selectedTopic.selected.id;
    const recommendedTopicId = shortlistedRows.idByOriginalId.get(recommendedOriginalId);

    if (!recommendedTopicId) {
      throw new CloudBriefStepError(
        "selectTopic",
        new Error(`Recommended topic is not in persisted shortlist: ${recommendedOriginalId}`)
      );
    }

    const reportR2Key = `reports/${runDate}/editorial-brief.md`;
    const brief = await runStep("db.saveEditorialBrief", reportStep, async () => {
      const briefRow = createBriefRow({
        runId: run.id,
        recommendedTopicId,
        reportR2Key,
        createdAt,
        briefResult: generated.briefResult
      });
      return await options.db.insertEditorialBrief(briefRow);
    });
    const upload = await runStep("r2.uploadBriefReport", reportStep, async () =>
      await options.r2.putText({
        key: reportR2Key,
        body: generated.briefResult.markdown,
        contentType: "text/markdown; charset=utf-8"
      })
    );
    const successRun = await runStep("db.markRunSuccess", reportStep, async () =>
      await options.db.markRunSuccess(run.id, new Date().toISOString())
    );

    logger.info(`Cloud editorial brief generated for ${runDate}; reportR2Key=${upload.key}.`);

    return {
      status: "created",
      run: successRun,
      brief,
      shortlistedItems: shortlistedRows.rows,
      reportR2Key: upload.key
    };
  } catch (error) {
    const failedStep = getCloudBriefGenerationStep(error) ?? currentStep;
    const message = options.sanitizeErrorMessage?.(errorMessage(error)) ?? errorMessage(error);

    try {
      await runStep("db.markRunFailed", reportStep, async () =>
        await options.db.markRunFailed(run.id, new Date().toISOString(), message)
      );
    } catch (markError) {
      logger.error(`Cloud editorial brief failed for ${runDate}; step=db.markRunFailed.`);
      throw markError;
    }

    logger.error(`Cloud editorial brief failed for ${runDate}; step=${failedStep}.`);
    throw getCloudBriefGenerationStep(error)
      ? error
      : new CloudBriefStepError(failedStep, error);
  }
}

export async function getTodayEditorialBrief(options: {
  db: EditorialBriefDbAdapter;
  now?: Date;
  runDate?: string;
  runType?: CloudRunType;
  env?: NodeJS.ProcessEnv;
}): Promise<TodayBriefPayload> {
  const now = options.now ?? new Date();
  const runDate = options.runDate ?? formatRunDate(now, options.env?.BRIEF_TIME_ZONE);
  const runType = options.runType ?? EDITORIAL_BRIEF_RUN_TYPE;

  await options.db.ensureSchema();
  return await options.db.getTodayBrief(runDate, runType);
}
