import { createNeonDbAdapter, type EditorialBriefDbAdapter } from "../../../src/adapters/neon";
import { createR2Adapter, type R2StorageAdapter } from "../../../src/adapters/r2";
import { assertCloudBriefEnv } from "../../../src/config/cloudEnv";
import {
  CloudBriefStepError,
  generateCloudEditorialBrief,
  getTodayEditorialBrief
} from "../../../src/pipeline/generateCloudEditorialBrief";
import type { CloudBriefGenerationStep } from "../../../src/types/cloud";

export interface CloudBriefServiceOptions {
  onStep?: (step: CloudBriefGenerationStep) => void;
  sanitizeErrorMessage?: (message: string) => string;
  force?: boolean;
  runLabel?: string;
}

function createLazyR2Adapter(env: NodeJS.ProcessEnv): R2StorageAdapter {
  let r2: R2StorageAdapter | undefined;

  return {
    async putText(input) {
      r2 ??= createR2Adapter(env);
      return await r2.putText(input);
    }
  };
}

function createLazyDbAdapter(env: NodeJS.ProcessEnv): EditorialBriefDbAdapter {
  let db: EditorialBriefDbAdapter | undefined;
  const getDb = () => {
    db ??= createNeonDbAdapter(env);
    return db;
  };

  return {
    async ensureSchema() {
      return await getDb().ensureSchema();
    },
    async getSuccessfulRun(runDate, runType) {
      return await getDb().getSuccessfulRun(runDate, runType);
    },
    async startRun(input) {
      return await getDb().startRun(input);
    },
    async clearRunArtifacts(runId) {
      return await getDb().clearRunArtifacts(runId);
    },
    async insertNewsItems(items) {
      return await getDb().insertNewsItems(items);
    },
    async insertShortlistedItems(items) {
      return await getDb().insertShortlistedItems(items);
    },
    async insertEditorialBrief(brief) {
      return await getDb().insertEditorialBrief(brief);
    },
    async saveTopicSelection(selection) {
      return await getDb().saveTopicSelection(selection);
    },
    async createArticleGenerationTask(input) {
      return await getDb().createArticleGenerationTask(input);
    },
    async getArticleGenerationTask(taskId) {
      return await getDb().getArticleGenerationTask(taskId);
    },
    async getActiveArticleGenerationTaskByTopicSelection(topicSelectionId) {
      return await getDb().getActiveArticleGenerationTaskByTopicSelection(topicSelectionId);
    },
    async cancelArticleGenerationTask(input) {
      return await getDb().cancelArticleGenerationTask(input);
    },
    async markRunSuccess(runId, finishedAt) {
      return await getDb().markRunSuccess(runId, finishedAt);
    },
    async markRunFailed(runId, finishedAt, error) {
      return await getDb().markRunFailed(runId, finishedAt, error);
    },
    async getTodayBrief(runDate, runType) {
      return await getDb().getTodayBrief(runDate, runType);
    }
  };
}

export function createCloudBriefServices(env: NodeJS.ProcessEnv = process.env) {
  return {
    db: createLazyDbAdapter(env),
    r2: createLazyR2Adapter(env)
  };
}

export async function generateCloudBriefForToday(
  env: NodeJS.ProcessEnv = process.env,
  options: CloudBriefServiceOptions = {}
) {
  options.onStep?.("config.validate");
  try {
    assertCloudBriefEnv(env);
  } catch (error) {
    throw new CloudBriefStepError("config.validate", error);
  }

  const services = createCloudBriefServices(env);
  if (options.force) {
    console.log(`[cloud.brief] ${options.runLabel ?? "force run"} requested with force=true.`);
  }

  return await generateCloudEditorialBrief({
    db: services.db,
    r2: services.r2,
    env,
    force: options.force,
    onStep: options.onStep,
    sanitizeErrorMessage: options.sanitizeErrorMessage
  });
}

export async function getCloudBriefForToday(env: NodeJS.ProcessEnv = process.env) {
  const services = createCloudBriefServices(env);
  return await getTodayEditorialBrief({
    db: services.db,
    env
  });
}
