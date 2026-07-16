import { randomUUID } from "node:crypto";
import type { EditorialBriefDbAdapter } from "../adapters/neon.js";
import type { ArticleGenerationTaskRecord } from "../types/cloud.js";
import {
  analyzeTopicSelection,
  createTopicAnalysisInputSummary,
  type TopicAnalysisResult
} from "../agents/article-generation/topic-analysis.js";

export type ArticleGenerationWorkerResult =
  | {
      ok: true;
      status: "idle";
      message: "No queued topic_analysis task.";
      recovered: { requeued: number; failed: number };
    }
  | {
      ok: true;
      status: "stage_completed";
      taskId: string;
      completedStage: "topic_analysis";
      nextStage: "research";
      progress: 15;
      recovered: { requeued: number; failed: number };
    }
  | {
      ok: true;
      status: "task_failed";
      taskId: string;
      failedStage: "topic_analysis";
      error: string;
      recovered: { requeued: number; failed: number };
    }
  | {
      ok: true;
      status: "cancelled";
      taskId: string;
      message: string;
      recovered: { requeued: number; failed: number };
    };

export interface ArticleGenerationWorkerOptions {
  db: EditorialBriefDbAdapter;
  workerId?: string;
  now?: Date;
  staleAfterSeconds?: number;
}

const TOPIC_ANALYSIS_STAGE = "topic_analysis";
const RESEARCH_WAITING_MESSAGE = "选题分析完成，等待调研阶段执行";

export async function runArticleGenerationWorker(
  options: ArticleGenerationWorkerOptions
): Promise<ArticleGenerationWorkerResult> {
  const now = options.now ?? new Date();
  const workerId = options.workerId ?? `article-worker-${randomUUID()}`;
  const staleAfterSecondsValue = options.staleAfterSeconds;
  const staleAfterSeconds =
    typeof staleAfterSecondsValue === "number" && Number.isFinite(staleAfterSecondsValue)
      ? Math.max(1, Math.floor(staleAfterSecondsValue))
      : 600;
  const staleBefore = new Date(now.getTime() - staleAfterSeconds * 1000).toISOString();

  const recovered = await options.db.recoverStaleArticleGenerationTasks({
    staleBefore,
    recoveredAt: now.toISOString()
  });

  const task = await options.db.claimNextArticleGenerationTask({
    workerId,
    claimedAt: now.toISOString()
  });

  if (!task) {
    return { ok: true, status: "idle", message: "No queued topic_analysis task.", recovered };
  }

  return await runClaimedTopicAnalysis({ db: options.db, task, workerId, now, recovered });
}

async function runClaimedTopicAnalysis(input: {
  db: EditorialBriefDbAdapter;
  task: ArticleGenerationTaskRecord;
  workerId: string;
  now: Date;
  recovered: { requeued: number; failed: number };
}): Promise<ArticleGenerationWorkerResult> {
  const { db, task, workerId, now, recovered } = input;
  const taskBeforeStage = await db.getArticleGenerationTask(task.id);
  if (taskBeforeStage?.status === "cancelled") {
    return cancelledResult(task.id, recovered);
  }
  if (!isWorkerOwnedTopicAnalysisTask(taskBeforeStage, workerId)) {
    return cancelledResult(task.id, recovered);
  }

  const topicSelection = await db.getTopicSelectionById(task.topicSelectionId);
  const attempt = task.attempt;
  const startedAt = now.toISOString();

  await db.startArticleGenerationStep({
    id: randomUUID(),
    taskId: task.id,
    stage: TOPIC_ANALYSIS_STAGE,
    attempt,
    message: "正在分析选题",
    inputJson: topicSelection
      ? createTopicAnalysisInputSummary({ task, topicSelection })
      : {
          taskId: task.id,
          topicSelectionId: task.topicSelectionId,
          selectedTopicId: task.selectedTopicId,
          approvedTitle: task.approvedTitle,
          hasSelectedTopic: false,
          hasEditorialBrief: false,
          shortlistedCount: 0,
          candidateCount: 0
        },
    startedAt
  });

  let result: TopicAnalysisResult;
  try {
    if (!topicSelection) {
      throw new Error("Topic selection 不存在。");
    }
    result = analyzeTopicSelection({
      task,
      topicSelection,
      analyzedAt: now.toISOString()
    });
  } catch (error) {
    const errorMessage = sanitizeWorkerError(error);
    await db.failArticleGenerationStep({
      taskId: task.id,
      stage: TOPIC_ANALYSIS_STAGE,
      attempt,
      message: "选题分析失败",
      errorMessage,
      finishedAt: now.toISOString()
    });
    const failedTask = await db.failArticleGenerationTask({
      taskId: task.id,
      workerId,
      failedAt: now.toISOString(),
      message: "选题分析失败",
      errorMessage
    });
    if (!failedTask && (await db.getArticleGenerationTask(task.id))?.status === "cancelled") {
      return cancelledResult(task.id, recovered);
    }
    return {
      ok: true,
      status: "task_failed",
      taskId: task.id,
      failedStage: TOPIC_ANALYSIS_STAGE,
      error: errorMessage,
      recovered
    };
  }

  const taskBeforeSuccess = await db.getArticleGenerationTask(task.id);
  if (taskBeforeSuccess?.status === "cancelled") {
    await db.failArticleGenerationStep({
      taskId: task.id,
      stage: TOPIC_ANALYSIS_STAGE,
      attempt,
      status: "cancelled",
      message: "任务已取消",
      finishedAt: now.toISOString()
    });
    return cancelledResult(task.id, recovered);
  }

  await db.completeArticleGenerationStep({
    taskId: task.id,
    stage: TOPIC_ANALYSIS_STAGE,
    attempt,
    message: "选题分析完成",
    outputJson: result,
    finishedAt: now.toISOString()
  });

  const updatedTask = await db.completeTopicAnalysisAndRequeue({
    taskId: task.id,
    workerId,
    completedAt: now.toISOString(),
    message: RESEARCH_WAITING_MESSAGE
  });
  if (!updatedTask && (await db.getArticleGenerationTask(task.id))?.status === "cancelled") {
    return cancelledResult(task.id, recovered);
  }

  return {
    ok: true,
    status: "stage_completed",
    taskId: task.id,
    completedStage: TOPIC_ANALYSIS_STAGE,
    nextStage: "research",
    progress: 15,
    recovered
  };
}

function isWorkerOwnedTopicAnalysisTask(
  task: ArticleGenerationTaskRecord | undefined,
  workerId: string
): boolean {
  return Boolean(
    task &&
      task.status === "running" &&
      task.currentStage === TOPIC_ANALYSIS_STAGE &&
      task.lockedBy === workerId
  );
}

function cancelledResult(
  taskId: string,
  recovered: { requeued: number; failed: number }
): ArticleGenerationWorkerResult {
  return {
    ok: true,
    status: "cancelled",
    taskId,
    message: "Task was cancelled before topic_analysis could be completed.",
    recovered
  };
}

function sanitizeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "选题分析失败。";
}
