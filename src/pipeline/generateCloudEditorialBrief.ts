import { randomUUID } from "node:crypto";
import type { EditorialBriefDbAdapter } from "../adapters/neon.js";
import type { R2StorageAdapter } from "../adapters/r2.js";
import {
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

function fixedNumber(value: number | undefined, fallback = 0): number {
  return Number((value ?? fallback).toFixed(1));
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
      title: item.title,
      url: item.url,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      provider: item.provider === "none" ? undefined : item.provider,
      query: item.query,
      summary: item.summary,
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
  const note = item.editorial.riskNote?.trim();
  return note ? [note] : [];
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
      title: item.title,
      url: item.url,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      provider: item.provider === "none" ? undefined : item.provider,
      query: item.query,
      category: item.category,
      tags: item.tags,
      summary: item.summary,
      topicAngle: item.editorial.topicAngle,
      shortlistReason: item.editorial.shortlistReason,
      shortlistScore: fixedNumber(item.shortlistScore),
      riskNotes: riskNotesFor(item),
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

async function runExistingBriefPipeline(input: {
  now: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  logger: Logger;
  pipeline: CloudBriefPipelineFns;
}) {
  const collectOptions: CollectNewsOptions = {
    env: input.env,
    now: input.now,
    fetchImpl: input.fetchImpl,
    logger: input.logger,
    writeOutputs: false
  };
  const collection = await input.pipeline.collectNewsWithReport(collectOptions);
  const candidates = collection.candidates.slice(0, 20);

  if (candidates.length !== 20) {
    throw new Error(`Cloud editorial brief requires 20 candidates, got ${candidates.length}.`);
  }

  const shortlistOptions: ShortlistNewsOptions = {
    candidates,
    now: input.now,
    logger: input.logger,
    writeOutputs: false
  };
  const shortlistResult = await input.pipeline.shortlistNewsWithReport(shortlistOptions);

  if (shortlistResult.shortlisted.length !== 10) {
    throw new Error(`Cloud editorial brief requires 10 shortlisted items, got ${shortlistResult.shortlisted.length}.`);
  }

  const selectOptions: SelectTopicOptions = {
    shortlisted: shortlistResult.shortlisted,
    now: input.now,
    logger: input.logger,
    writeOutputs: false
  };
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

  await options.db.ensureSchema();
  const existing = await options.db.getSuccessfulRun(runDate, runType);
  if (existing) {
    logger.info(`Cloud editorial brief already exists for ${runDate}.`);
    return {
      status: "already_exists",
      run: existing
    };
  }

  const startedAt = now.toISOString();
  const run = await options.db.startRun({
    id: randomUUID(),
    runDate,
    runType,
    startedAt
  });

  try {
    await options.db.clearRunArtifacts(run.id);
    const generated = await runExistingBriefPipeline({
      now,
      env: options.env,
      fetchImpl: options.fetchImpl,
      logger,
      pipeline
    });
    const createdAt = now.toISOString();
    const newsRows = createNewsRows({
      runId: run.id,
      candidates: generated.candidates,
      createdAt
    });
    const shortlistedRows = createShortlistedRows({
      runId: run.id,
      shortlisted: generated.shortlisted,
      idByOriginalId: newsRows.idByOriginalId,
      createdAt
    });
    const recommendedOriginalId = generated.selectedTopic.selected.id;
    const recommendedTopicId = shortlistedRows.idByOriginalId.get(recommendedOriginalId);

    if (!recommendedTopicId) {
      throw new Error(`Recommended topic is not in persisted shortlist: ${recommendedOriginalId}`);
    }

    await options.db.insertNewsItems(newsRows.rows);
    await options.db.insertShortlistedItems(shortlistedRows.rows);

    const reportR2Key = `reports/${runDate}/editorial-brief.md`;
    const upload = await options.r2.putText({
      key: reportR2Key,
      body: generated.briefResult.markdown,
      contentType: "text/markdown; charset=utf-8"
    });
    const briefRow = createBriefRow({
      runId: run.id,
      recommendedTopicId,
      reportR2Key: upload.key,
      createdAt,
      briefResult: generated.briefResult
    });
    const brief = await options.db.insertEditorialBrief(briefRow);
    const successRun = await options.db.markRunSuccess(run.id, new Date().toISOString());

    logger.info(`Cloud editorial brief generated for ${runDate}; reportR2Key=${upload.key}.`);

    return {
      status: "created",
      run: successRun,
      brief,
      shortlistedItems: shortlistedRows.rows,
      reportR2Key: upload.key
    };
  } catch (error) {
    const message = errorMessage(error);
    await options.db.markRunFailed(run.id, new Date().toISOString(), message);
    logger.error(`Cloud editorial brief failed for ${runDate}: ${message}`);
    throw error;
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
