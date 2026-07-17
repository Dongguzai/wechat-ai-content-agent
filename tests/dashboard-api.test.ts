import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import test from "node:test";
import type { EditorialBriefDbAdapter } from "../src/adapters/neon";
import type {
  ArticleGenerationStepRecord,
  ArticleGenerationTaskRecord,
  CloudTopicSelectionRecord,
  CloudRunType
} from "../src/types/cloud";
import { analyzeTopicSelection } from "../src/agents/article-generation/topic-analysis";
import { runArticleGenerationWorker } from "../src/workers/article-generation-worker";
import { handleCronArticleWorker } from "../apps/dashboard/lib/article-generation-worker";
import { executeDashboardAction } from "../apps/dashboard/lib/actions";
import {
  handleArticleGenerationCancel,
  handleArticleGenerationStatus
} from "../apps/dashboard/lib/article-generation";
import { getArticleData, getBriefData, getDashboardStatus, getSettingsStatus, readFileForApi } from "../apps/dashboard/lib/dashboard-data";
import {
  createCurrentFeedback,
  cropCover,
  deleteCoverVersion,
  regenerateCover,
  saveArticleDraft,
  selectArticleTitle,
  selectBriefTopic,
  setCurrentCoverVersion
} from "../apps/dashboard/lib/editor-workflow";
import { saveApproval, saveFeedback } from "../apps/dashboard/lib/forms";

const dashboardRequire = createRequire(new URL("../apps/dashboard/package.json", import.meta.url));
const sharp = dashboardRequire("sharp") as any;

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dashboard-api-"));
  await mkdir(join(root, "outputs"), { recursive: true });
  await mkdir(join(root, "inputs"), { recursive: true });
  await mkdir(join(root, "feedback"), { recursive: true });
  await mkdir(join(root, "runs"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "wechat-ai-content-agent" }));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  return root;
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await writeFile(join(root, relativePath), JSON.stringify(value, null, 2), "utf8");
}

function assertNoStoreResponse(response: Response): void {
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Expires"), "0");
}

class SelectionOnlyDb implements EditorialBriefDbAdapter {
  ensured = false;
  selections: CloudTopicSelectionRecord[] = [];
  articleGenerationTasks: ArticleGenerationTaskRecord[] = [];
  articleGenerationSteps: ArticleGenerationStepRecord[] = [];
  beforeConditionalCancel?: (task: ArticleGenerationTaskRecord) => void | Promise<void>;

  async ensureSchema() {
    this.ensured = true;
  }

  async saveTopicSelection(selection: {
    id: string;
    runId: string;
    selectedShortlistedItemId: string;
    approvedTitle: string;
    approvalNotes: string;
    approvalJson: unknown;
    handoffJson: unknown;
    createdAt: string;
  }) {
    const record: CloudTopicSelectionRecord = {
      ...selection,
      handoffJson: selection.handoffJson as CloudTopicSelectionRecord["handoffJson"],
      updatedAt: selection.createdAt
    };
    this.selections.push(record);
    return record;
  }

  async createArticleGenerationTask(input: {
    id: string;
    topicSelectionId: string;
    runId: string;
    selectedTopicId: string;
    approvedTitle: string;
    status: "queued";
    currentStage: ArticleGenerationTaskRecord["currentStage"];
    progress: number;
    message: string;
    createdAt: string;
  }) {
    const existing = this.articleGenerationTasks.find(
      (task) =>
        task.runId === input.runId &&
        task.selectedTopicId === input.selectedTopicId &&
        ["queued", "running", "success"].includes(task.status)
    );
    if (existing) {
      return existing;
    }

    const task: ArticleGenerationTaskRecord = {
      ...input,
      attempt: 0,
      maxAttempts: 2,
      updatedAt: input.createdAt
    };
    this.articleGenerationTasks.push(task);
    return task;
  }

  async getArticleGenerationTask(taskId: string) {
    return this.articleGenerationTasks.find((task) => task.id === taskId);
  }

  async getTopicSelectionById(topicSelectionId: string) {
    return this.selections.find((selection) => selection.id === topicSelectionId);
  }

  async getActiveArticleGenerationTaskByTopicSelection(topicSelectionId: string) {
    return this.articleGenerationTasks.find(
      (task) =>
        task.topicSelectionId === topicSelectionId &&
        ["queued", "running", "success"].includes(task.status)
    );
  }

  async claimNextArticleGenerationTask(input: { workerId: string; claimedAt: string }) {
    const task = this.articleGenerationTasks.find(
      (item) => item.status === "queued" && item.currentStage === "waiting_for_worker"
    );
    if (!task) return undefined;
    task.status = "running";
    task.currentStage = "topic_analysis";
    task.progress = 5;
    task.message = "正在分析选题";
    task.attempt += 1;
    task.lockedBy = input.workerId;
    task.lockedAt = input.claimedAt;
    task.startedAt ??= input.claimedAt;
    task.updatedAt = input.claimedAt;
    return { ...task };
  }

  async getArticleGenerationSteps(taskId: string) {
    return this.articleGenerationSteps
      .filter((step) => step.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async startArticleGenerationStep(input: {
    id: string;
    taskId: string;
    stage: ArticleGenerationStepRecord["stage"];
    attempt: number;
    message: string;
    inputJson?: unknown;
    startedAt: string;
  }) {
    const existing = this.articleGenerationSteps.find(
      (step) => step.taskId === input.taskId && step.stage === input.stage && step.attempt === input.attempt
    );
    const step: ArticleGenerationStepRecord = {
      id: existing?.id ?? input.id,
      taskId: input.taskId,
      stage: input.stage,
      status: "running",
      attempt: input.attempt,
      message: input.message,
      inputJson: input.inputJson,
      startedAt: input.startedAt,
      createdAt: existing?.createdAt ?? input.startedAt,
      updatedAt: input.startedAt
    };
    if (existing) {
      Object.assign(existing, step);
      return existing;
    }
    this.articleGenerationSteps.push(step);
    return step;
  }

  async completeArticleGenerationStep(input: {
    taskId: string;
    stage: ArticleGenerationStepRecord["stage"];
    attempt: number;
    message: string;
    outputJson?: unknown;
    finishedAt: string;
  }) {
    const step = this.articleGenerationSteps.find(
      (item) =>
        item.taskId === input.taskId &&
        item.stage === input.stage &&
        item.attempt === input.attempt &&
        item.status === "running"
    );
    if (!step) return undefined;
    step.status = "success";
    step.message = input.message;
    step.outputJson = input.outputJson;
    step.errorMessage = undefined;
    step.finishedAt = input.finishedAt;
    step.updatedAt = input.finishedAt;
    return step;
  }

  async failArticleGenerationStep(input: {
    taskId: string;
    stage: ArticleGenerationStepRecord["stage"];
    attempt: number;
    status?: "failed" | "cancelled";
    message: string;
    errorMessage?: string;
    finishedAt: string;
  }) {
    const step = this.articleGenerationSteps.find(
      (item) =>
        item.taskId === input.taskId &&
        item.stage === input.stage &&
        item.attempt === input.attempt &&
        item.status === "running"
    );
    if (!step) return undefined;
    step.status = input.status ?? "failed";
    step.message = input.message;
    step.errorMessage = input.errorMessage;
    step.finishedAt = input.finishedAt;
    step.updatedAt = input.finishedAt;
    return step;
  }

  async completeTopicAnalysisAndRequeue(input: {
    taskId: string;
    workerId: string;
    completedAt: string;
    message: string;
  }) {
    const task = this.articleGenerationTasks.find(
      (item) =>
        item.id === input.taskId &&
        item.status === "running" &&
        item.currentStage === "topic_analysis" &&
        item.lockedBy === input.workerId
    );
    if (!task) return undefined;
    task.status = "queued";
    task.currentStage = "research";
    task.progress = 15;
    task.message = input.message;
    task.errorMessage = undefined;
    task.lockedBy = undefined;
    task.lockedAt = undefined;
    task.updatedAt = input.completedAt;
    return task;
  }

  async failArticleGenerationTask(input: {
    taskId: string;
    workerId: string;
    failedAt: string;
    message: string;
    errorMessage: string;
  }) {
    const task = this.articleGenerationTasks.find(
      (item) =>
        item.id === input.taskId &&
        item.status === "running" &&
        item.currentStage === "topic_analysis" &&
        item.lockedBy === input.workerId
    );
    if (!task) return undefined;
    task.status = "failed";
    task.currentStage = "topic_analysis";
    task.message = input.message;
    task.errorMessage = input.errorMessage;
    task.finishedAt = input.failedAt;
    task.lockedBy = undefined;
    task.lockedAt = undefined;
    task.updatedAt = input.failedAt;
    return task;
  }

  async recoverStaleArticleGenerationTasks(input: { staleBefore: string; recoveredAt: string }) {
    let requeued = 0;
    let failed = 0;
    for (const task of this.articleGenerationTasks) {
      if (task.status !== "running" || task.currentStage !== "topic_analysis" || !task.lockedAt) continue;
      if (task.lockedAt >= input.staleBefore) continue;
      if (task.attempt < task.maxAttempts) {
        task.status = "queued";
        task.currentStage = "waiting_for_worker";
        task.message = "上次执行中断，已重新排队";
        task.lockedBy = undefined;
        task.lockedAt = undefined;
        task.updatedAt = input.recoveredAt;
        requeued += 1;
      } else {
        task.status = "failed";
        task.message = "Worker 多次中断，任务已停止";
        task.errorMessage = "超过最大自动恢复次数";
        task.finishedAt = input.recoveredAt;
        task.lockedBy = undefined;
        task.lockedAt = undefined;
        task.updatedAt = input.recoveredAt;
        failed += 1;
      }
    }
    return { requeued, failed };
  }

  async cancelArticleGenerationTask(input: {
    taskId: string;
    cancelledAt: string;
    message: string;
  }) {
    const task = this.articleGenerationTasks.find((item) => item.id === input.taskId);
    if (task) {
      await this.beforeConditionalCancel?.(task);
    }
    if (
      task &&
      ((task.status === "queued" && task.currentStage === "waiting_for_worker") ||
        (task.status === "running" && task.currentStage === "topic_analysis"))
    ) {
      task.status = "cancelled";
      task.message = input.message;
      task.cancelledAt = input.cancelledAt;
      task.updatedAt = input.cancelledAt;
      return task;
    }

    const current = this.articleGenerationTasks.find((item) => item.id === input.taskId);
    if (!current) return undefined;
    if (current.status === "cancelled") return current;
    if (current.status === "success" || current.status === "failed") {
      throw new Error(`Article generation task cannot be cancelled from status ${current.status}.`);
    }
    throw new Error(
      `Article generation task could not be cancelled from status ${current.status} and stage ${current.currentStage}.`
    );
  }

  async getSuccessfulRun() {
    return undefined;
  }

  async startRun(): Promise<never> {
    throw new Error("not implemented");
  }

  async clearRunArtifacts(): Promise<void> {}

  async insertNewsItems(items: any[]) {
    return items;
  }

  async insertShortlistedItems(items: any[]) {
    return items;
  }

  async insertEditorialBrief(brief: any) {
    return brief;
  }

  async markRunSuccess(): Promise<never> {
    throw new Error("not implemented");
  }

  async markRunFailed(): Promise<never> {
    throw new Error("not implemented");
  }

  async getTodayBrief(_runDate: string, _runType: CloudRunType) {
    return { run: null, brief: null, shortlistedItems: [], topicSelection: null };
  }
}

async function seedArticleGenerationTask(
  db: SelectionOnlyDb,
  overrides: {
    taskId?: string;
    topicSelectionId?: string;
    selectedTopicId?: string;
    approvedTitle?: string;
    handoff?: Partial<CloudTopicSelectionRecord["handoffJson"]>;
    currentStage?: ArticleGenerationTaskRecord["currentStage"];
    status?: ArticleGenerationTaskRecord["status"];
  } = {}
) {
  const selectedTopicId = overrides.selectedTopicId ?? "topic-worker";
  const approvedTitle = overrides.approvedTitle ?? "云端入围资讯";
  const topicSelection = await db.saveTopicSelection({
    id: overrides.topicSelectionId ?? `selection-${selectedTopicId}`,
    runId: "run-worker",
    selectedShortlistedItemId: selectedTopicId,
    approvedTitle,
    approvalNotes: "",
    approvalJson: {
      approvedByUser: true,
      approvedTopicId: selectedTopicId,
      approvedTitle,
      notes: ""
    },
    handoffJson: {
      approval: {
        approvedByUser: true,
        approvedTopicId: selectedTopicId,
        approvedTitle,
        notes: ""
      },
      candidateNews: [],
      shortlistedNews: [],
      selectedTopic: {
        selected: {
          id: selectedTopicId,
          title: "Cloud topic raw title",
          titleZh: approvedTitle,
          url: "https://example.com/cloud-topic",
          sourceName: "Example Cloud",
          category: "tooling",
          tags: ["agent", "developer-workflow"],
          summaryZh: "这是一条云端简报摘要。",
          topicAngleZh: "从工作流入口变化切入。",
          riskNotesZh: ["需要回到原文核验。"],
          selection: {
            coreConflict: "效率与治理之间的冲突。",
            writingAngle: "从工作流入口变化切入。",
            articleThesis: "AI 工具价值正在进入真实流程。",
            sourceReliability: "high"
          }
        }
      },
      editorialBrief: {
        recommendedTopic: {
          coreConflict: "效率与治理之间的冲突。",
          writingAngle: "从工作流入口变化切入。",
          articleThesis: "AI 工具价值正在进入真实流程。",
          sourceReliability: "high"
        }
      },
      ...overrides.handoff
    },
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  const task = await db.createArticleGenerationTask({
    id: overrides.taskId ?? `task-${selectedTopicId}`,
    topicSelectionId: topicSelection.id,
    runId: topicSelection.runId,
    selectedTopicId,
    approvedTitle,
    status: "queued",
    currentStage: overrides.currentStage ?? "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  task.status = overrides.status ?? task.status;
  return { task, topicSelection };
}

test("article generation task adapter creates, reads, reuses active, and cancels queued tasks", async () => {
  const db = new SelectionOnlyDb();
  const createdAt = "2026-06-02T00:00:00.000Z";
  const first = await db.createArticleGenerationTask({
    id: "task-1",
    topicSelectionId: "selection-1",
    runId: "run-1",
    selectedTopicId: "topic-1",
    approvedTitle: "选题 1",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt
  });
  const second = await db.createArticleGenerationTask({
    id: "task-2",
    topicSelectionId: "selection-1",
    runId: "run-1",
    selectedTopicId: "topic-1",
    approvedTitle: "选题 1",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt
  });

  assert.equal(first.id, "task-1");
  assert.equal(second.id, "task-1");
  assert.equal(db.articleGenerationTasks.length, 1);
  assert.equal((await db.getArticleGenerationTask("task-1"))?.approvedTitle, "选题 1");
  assert.equal((await db.getActiveArticleGenerationTaskByTopicSelection("selection-1"))?.id, "task-1");

  const cancelled = await db.cancelArticleGenerationTask({
    taskId: "task-1",
    cancelledAt: "2026-06-02T00:01:00.000Z",
    message: "任务已取消"
  });
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.cancelledAt, "2026-06-02T00:01:00.000Z");
  assert.equal(cancelled?.message, "任务已取消");

  const cancelledAgain = await db.cancelArticleGenerationTask({
    taskId: "task-1",
    cancelledAt: "2026-06-02T00:02:00.000Z",
    message: "任务已取消"
  });
  assert.equal(cancelledAgain?.status, "cancelled");
  assert.equal(cancelledAgain?.cancelledAt, "2026-06-02T00:01:00.000Z");

  const recreated = await db.createArticleGenerationTask({
    id: "task-3",
    topicSelectionId: "selection-1",
    runId: "run-1",
    selectedTopicId: "topic-1",
    approvedTitle: "选题 1",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:03:00.000Z"
  });
  assert.equal(recreated.id, "task-3");
  assert.equal(db.articleGenerationTasks.length, 2);
});

test("article generation task adapter does not cancel success tasks and returns undefined for missing tasks", async () => {
  const db = new SelectionOnlyDb();
  const task = await db.createArticleGenerationTask({
    id: "task-success",
    topicSelectionId: "selection-success",
    runId: "run-success",
    selectedTopicId: "topic-success",
    approvedTitle: "成功选题",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  task.status = "success";
  task.currentStage = "completed";
  task.progress = 100;

  await assert.rejects(
    () =>
      db.cancelArticleGenerationTask({
        taskId: "task-success",
        cancelledAt: "2026-06-02T00:01:00.000Z",
        message: "任务已取消"
      }),
    /cannot be cancelled/
  );
  assert.equal(await db.getArticleGenerationTask("missing-task"), undefined);
  assert.equal(
    await db.cancelArticleGenerationTask({
      taskId: "missing-task",
      cancelledAt: "2026-06-02T00:01:00.000Z",
      message: "任务已取消"
    }),
    undefined
  );
});

test("article generation task adapter cancels running tasks and rejects failed tasks", async () => {
  const db = new SelectionOnlyDb();
  const runningTask = await db.createArticleGenerationTask({
    id: "task-running-cancel",
    topicSelectionId: "selection-running-cancel",
    runId: "run-running-cancel",
    selectedTopicId: "topic-running-cancel",
    approvedTitle: "运行中选题",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  runningTask.status = "running";
  runningTask.currentStage = "topic_analysis";
  runningTask.progress = 5;

  const cancelled = await db.cancelArticleGenerationTask({
    taskId: "task-running-cancel",
    cancelledAt: "2026-06-02T00:01:00.000Z",
    message: "任务已取消"
  });
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.cancelledAt, "2026-06-02T00:01:00.000Z");

  const failedTask = await db.createArticleGenerationTask({
    id: "task-failed-cancel",
    topicSelectionId: "selection-failed-cancel",
    runId: "run-failed-cancel",
    selectedTopicId: "topic-failed-cancel",
    approvedTitle: "失败选题",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  failedTask.status = "failed";
  failedTask.currentStage = "topic_analysis";

  await assert.rejects(
    () =>
      db.cancelArticleGenerationTask({
        taskId: "task-failed-cancel",
        cancelledAt: "2026-06-02T00:01:00.000Z",
        message: "任务已取消"
      }),
    /cannot be cancelled from status failed/
  );
});

test("article generation cancel does not overwrite a task completed to queued research during cancellation", async () => {
  const db = new SelectionOnlyDb();
  const task = await db.createArticleGenerationTask({
    id: "task-cancel-race-research",
    topicSelectionId: "selection-cancel-race-research",
    runId: "run-cancel-race-research",
    selectedTopicId: "topic-cancel-race-research",
    approvedTitle: "竞态选题",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  task.status = "running";
  task.currentStage = "topic_analysis";
  task.progress = 5;
  db.beforeConditionalCancel = (current) => {
    current.status = "queued";
    current.currentStage = "research";
    current.progress = 15;
    current.message = "选题分析完成，等待调研阶段执行";
    current.updatedAt = "2026-06-02T00:01:00.000Z";
  };

  await assert.rejects(
    () =>
      db.cancelArticleGenerationTask({
        taskId: "task-cancel-race-research",
        cancelledAt: "2026-06-02T00:01:01.000Z",
        message: "任务已取消"
      }),
    /could not be cancelled from status queued and stage research/
  );
  assert.equal(task.status, "queued");
  assert.equal(task.currentStage, "research");
  assert.equal(task.progress, 15);
  assert.equal(task.cancelledAt, undefined);
  assert.equal(task.message, "选题分析完成，等待调研阶段执行");
});

test("article generation cancel does not overwrite success or failed terminal races", async () => {
  for (const terminalStatus of ["success", "failed"] as const) {
    const db = new SelectionOnlyDb();
    const task = await db.createArticleGenerationTask({
      id: `task-cancel-race-${terminalStatus}`,
      topicSelectionId: `selection-cancel-race-${terminalStatus}`,
      runId: `run-cancel-race-${terminalStatus}`,
      selectedTopicId: `topic-cancel-race-${terminalStatus}`,
      approvedTitle: "终态竞态选题",
      status: "queued",
      currentStage: "waiting_for_worker",
      progress: 0,
      message: "文章生成任务已创建，等待执行",
      createdAt: "2026-06-02T00:00:00.000Z"
    });
    task.status = "running";
    task.currentStage = "topic_analysis";
    db.beforeConditionalCancel = (current) => {
      current.status = terminalStatus;
      current.currentStage = terminalStatus === "success" ? "completed" : "topic_analysis";
      current.progress = terminalStatus === "success" ? 100 : 5;
      current.updatedAt = "2026-06-02T00:01:00.000Z";
    };

    await assert.rejects(
      () =>
        db.cancelArticleGenerationTask({
          taskId: `task-cancel-race-${terminalStatus}`,
          cancelledAt: "2026-06-02T00:01:01.000Z",
          message: "任务已取消"
        }),
      new RegExp(`cannot be cancelled from status ${terminalStatus}`)
    );
    assert.equal(task.status, terminalStatus);
    assert.equal(task.cancelledAt, undefined);
  }
});

test("article generation status API handles auth, validation, missing, and found tasks", async () => {
  const db = new SelectionOnlyDb();
  const task = await db.createArticleGenerationTask({
    id: "task-status",
    topicSelectionId: "selection-status",
    runId: "run-status",
    selectedTopicId: "topic-status",
    approvedTitle: "状态选题",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  task.currentStage = "research";
  task.progress = 15;
  task.message = "选题分析完成，等待调研阶段执行";

  const unauthorized = await handleArticleGenerationStatus(
    new Request("https://example.com/api/article-generation/status?id=task-status"),
    { db, isAuthorized: async () => false }
  );
  assert.equal(unauthorized.status, 401);
  assertNoStoreResponse(unauthorized);

  const missingId = await handleArticleGenerationStatus(
    new Request("https://example.com/api/article-generation/status"),
    { db, isAuthorized: async () => true }
  );
  assert.equal(missingId.status, 400);
  assertNoStoreResponse(missingId);

  const notFound = await handleArticleGenerationStatus(
    new Request("https://example.com/api/article-generation/status?id=missing-task"),
    { db, isAuthorized: async () => true }
  );
  assert.equal(notFound.status, 404);
  assertNoStoreResponse(notFound);

  const found = await handleArticleGenerationStatus(
    new Request("https://example.com/api/article-generation/status?id=task-status"),
    { db, isAuthorized: async () => true }
  );
  const payload = await found.json();
  assert.equal(found.status, 200);
  assertNoStoreResponse(found);
  assert.equal(payload.ok, true);
  assert.equal(payload.task.id, "task-status");
  assert.equal(payload.task.currentStage, "research");
  assert.equal(payload.task.progress, 15);
  assert.deepEqual(payload.steps, []);
});

test("article generation status route is dynamic and no-revalidate", async () => {
  const routeSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/api/article-generation/status/route.ts"),
    "utf8"
  );

  assert.match(routeSource, /export const runtime = "nodejs"/);
  assert.match(routeSource, /export const dynamic = "force-dynamic"/);
  assert.match(routeSource, /export const revalidate = 0/);
});

test("article generation status API returns safe step records", async () => {
  const db = new SelectionOnlyDb();
  await seedArticleGenerationTask(db, { taskId: "task-with-step" });
  await db.startArticleGenerationStep({
    id: "step-1",
    taskId: "task-with-step",
    stage: "topic_analysis",
    attempt: 1,
    message: "正在分析选题",
    inputJson: { handoff: "hidden" },
    startedAt: "2026-06-02T00:00:00.000Z"
  });
  await db.completeArticleGenerationStep({
    taskId: "task-with-step",
    stage: "topic_analysis",
    attempt: 1,
    message: "选题分析完成",
    outputJson: { sourceUrl: "https://example.com/cloud-topic" },
    finishedAt: "2026-06-02T00:00:01.000Z"
  });

  const response = await handleArticleGenerationStatus(
    new Request("https://example.com/api/article-generation/status?id=task-with-step"),
    { db, isAuthorized: async () => true }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.steps.length, 1);
  assert.equal(payload.steps[0].status, "success");
  assert.equal(payload.steps[0].message, "选题分析完成");
  assert.equal(payload.steps[0].inputJson, undefined);
  assert.equal(payload.steps[0].outputJson, undefined);
});

test("article generation worker claims only waiting tasks and skips queued research tasks", async () => {
  const db = new SelectionOnlyDb();
  await seedArticleGenerationTask(db, { taskId: "task-research", currentStage: "research" });
  await seedArticleGenerationTask(db, { taskId: "task-waiting", selectedTopicId: "topic-waiting" });

  const [first, second] = await Promise.all([
    db.claimNextArticleGenerationTask({
      workerId: "worker-a",
      claimedAt: "2026-06-02T00:01:00.000Z"
    }),
    db.claimNextArticleGenerationTask({
      workerId: "worker-b",
      claimedAt: "2026-06-02T00:01:00.000Z"
    })
  ]);

  const claimed = [first, second].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.id, "task-waiting");
  assert.equal(claimed[0]?.status, "running");
  assert.equal(claimed[0]?.currentStage, "topic_analysis");
  assert.equal(claimed[0]?.attempt, 1);
  assert.equal((await db.getArticleGenerationTask("task-research"))?.currentStage, "research");
});

test("article generation worker completes deterministic topic_analysis and requeues research", async () => {
  const db = new SelectionOnlyDb();
  await seedArticleGenerationTask(db, { taskId: "task-worker-success" });

  const result = await runArticleGenerationWorker({
    db,
    workerId: "worker-success",
    now: new Date("2026-06-02T00:01:00.000Z")
  });
  const task = await db.getArticleGenerationTask("task-worker-success");
  const steps = await db.getArticleGenerationSteps("task-worker-success");

  assert.equal(result.status, "stage_completed");
  assert.equal(task?.status, "queued");
  assert.equal(task?.currentStage, "research");
  assert.equal(task?.progress, 15);
  assert.equal(task?.message, "选题分析完成，等待调研阶段执行");
  assert.equal(task?.lockedBy, undefined);
  assert.equal(steps[0].status, "success");
  assert.equal((steps[0].outputJson as any).sourceUrl, "https://example.com/cloud-topic");
});

test("topic analysis validates handoff without fetch, MiniMax, or local writes", async () => {
  const db = new SelectionOnlyDb();
  const { task, topicSelection } = await seedArticleGenerationTask(db);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;

  try {
    const result = analyzeTopicSelection({
      task,
      topicSelection,
      analyzedAt: "2026-06-02T00:01:00.000Z"
    });
    assert.equal(result.selectedTopicId, "topic-worker");
    assert.equal(result.sourceUrl, "https://example.com/cloud-topic");
    assert.equal(result.editorialBrief?.writingAngle, "从工作流入口变化切入。");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("topic analysis fails for unapproved, missing selectedTopic, ID mismatch, and missing URL", async () => {
  const db = new SelectionOnlyDb();
  const { task, topicSelection } = await seedArticleGenerationTask(db);

  assert.throws(
    () =>
      analyzeTopicSelection({
        task,
        topicSelection: {
          ...topicSelection,
          handoffJson: {
            ...topicSelection.handoffJson,
            approval: { ...topicSelection.handoffJson.approval, approvedByUser: false }
          }
        }
      }),
    /未通过人工确认/
  );
  assert.throws(
    () =>
      analyzeTopicSelection({
        task,
        topicSelection: {
          ...topicSelection,
          handoffJson: { ...topicSelection.handoffJson, selectedTopic: undefined as any }
        }
      }),
    /缺少 selectedTopic/
  );
  assert.throws(
    () =>
      analyzeTopicSelection({
        task,
        topicSelection: {
          ...topicSelection,
          handoffJson: {
            ...topicSelection.handoffJson,
            selectedTopic: { id: "other-topic", title: "标题", url: "https://example.com/other" }
          }
        }
      }),
    /ID 与任务选题 ID 不一致/
  );
  assert.throws(
    () =>
      analyzeTopicSelection({
        task,
        topicSelection: {
          ...topicSelection,
          handoffJson: {
            ...topicSelection.handoffJson,
            selectedTopic: { id: "topic-worker", title: "标题" }
          }
        }
      }),
    /缺少原文 URL/
  );
});

test("article generation worker marks business validation failure without retrying", async () => {
  const db = new SelectionOnlyDb();
  await seedArticleGenerationTask(db, {
    taskId: "task-worker-fail",
    handoff: {
      approval: {
        approvedByUser: false,
        approvedTopicId: "topic-worker",
        approvedTitle: "云端入围资讯",
        notes: ""
      }
    }
  });

  const result = await runArticleGenerationWorker({
    db,
    workerId: "worker-fail",
    now: new Date("2026-06-02T00:01:00.000Z")
  });
  const task = await db.getArticleGenerationTask("task-worker-fail");
  const steps = await db.getArticleGenerationSteps("task-worker-fail");

  assert.equal(result.status, "task_failed");
  assert.equal(task?.status, "failed");
  assert.equal(task?.currentStage, "topic_analysis");
  assert.match(task?.errorMessage ?? "", /未通过人工确认/);
  assert.equal(steps[0].status, "failed");
});

test("article generation worker does not overwrite cancellation during execution", async () => {
  const db = new SelectionOnlyDb();
  await seedArticleGenerationTask(db, { taskId: "task-worker-cancel" });
  const originalGet = db.getArticleGenerationTask.bind(db);
  let reads = 0;
  db.getArticleGenerationTask = async (taskId: string) => {
    reads += 1;
    const task = await originalGet(taskId);
    if (reads === 2 && task?.status === "running") {
      await db.cancelArticleGenerationTask({
        taskId,
        cancelledAt: "2026-06-02T00:01:01.000Z",
        message: "任务已取消"
      });
    }
    return await originalGet(taskId);
  };

  const result = await runArticleGenerationWorker({
    db,
    workerId: "worker-cancel",
    now: new Date("2026-06-02T00:01:00.000Z")
  });
  const task = await originalGet("task-worker-cancel");
  const steps = await db.getArticleGenerationSteps("task-worker-cancel");

  assert.equal(result.status, "cancelled");
  assert.equal(task?.status, "cancelled");
  assert.equal(task?.message, "任务已取消");
  assert.equal(steps[0].status, "cancelled");
});

test("article generation worker recovers stale locks and fails over max attempts", async () => {
  const db = new SelectionOnlyDb();
  const { task: requeueTask } = await seedArticleGenerationTask(db, {
    taskId: "task-stale-requeue",
    selectedTopicId: "topic-stale-requeue"
  });
  requeueTask.status = "running";
  requeueTask.currentStage = "topic_analysis";
  requeueTask.attempt = 1;
  requeueTask.maxAttempts = 2;
  requeueTask.lockedBy = "old-worker";
  requeueTask.lockedAt = "2026-06-02T00:00:00.000Z";

  const { task: failTask } = await seedArticleGenerationTask(db, {
    taskId: "task-stale-fail",
    selectedTopicId: "topic-stale-fail"
  });
  failTask.status = "running";
  failTask.currentStage = "topic_analysis";
  failTask.attempt = 2;
  failTask.maxAttempts = 2;
  failTask.lockedBy = "old-worker";
  failTask.lockedAt = "2026-06-02T00:00:00.000Z";

  const recovered = await db.recoverStaleArticleGenerationTasks({
    staleBefore: "2026-06-02T00:05:00.000Z",
    recoveredAt: "2026-06-02T00:10:00.000Z"
  });

  assert.deepEqual(recovered, { requeued: 1, failed: 1 });
  assert.equal(requeueTask.status, "queued");
  assert.equal(requeueTask.currentStage, "waiting_for_worker");
  assert.equal(failTask.status, "failed");
  assert.equal(failTask.errorMessage, "超过最大自动恢复次数");
});

test("cron article worker validates secret, returns idle, and processes one task", async () => {
  const unauthorizedNoSecret = await handleCronArticleWorker(
    new Request("https://example.com/api/cron/article-worker"),
    { env: {} }
  );
  assert.equal(unauthorizedNoSecret.status, 401);

  const unauthorizedMissingHeader = await handleCronArticleWorker(
    new Request("https://example.com/api/cron/article-worker"),
    { env: { CRON_SECRET: "cron-secret" } }
  );
  assert.equal(unauthorizedMissingHeader.status, 401);

  const unauthorizedWrongSecret = await handleCronArticleWorker(
    new Request("https://example.com/api/cron/article-worker", {
      headers: { Authorization: "Bearer wrong-secret" }
    }),
    { env: { CRON_SECRET: "cron-secret" } }
  );
  assert.equal(unauthorizedWrongSecret.status, 401);

  const idleDb = new SelectionOnlyDb();
  const idle = await handleCronArticleWorker(
    new Request("https://example.com/api/cron/article-worker", {
      headers: { Authorization: "Bearer cron-secret" }
    }),
    { db: idleDb, env: { CRON_SECRET: "cron-secret" } }
  );
  const idlePayload = await idle.json();
  assert.equal(idle.status, 200);
  assert.equal(idlePayload.status, "idle");

  const db = new SelectionOnlyDb();
  await seedArticleGenerationTask(db, { taskId: "task-cron-1" });
  await seedArticleGenerationTask(db, { taskId: "task-cron-2", selectedTopicId: "topic-cron-2" });
  const response = await handleCronArticleWorker(
    new Request("https://example.com/api/cron/article-worker", {
      headers: { Authorization: "Bearer cron-secret" }
    }),
    {
      db,
      env: {
        CRON_SECRET: "cron-secret",
        ARTICLE_WORKER_STALE_AFTER_SECONDS: "600"
      },
      workerId: "worker-cron",
      now: new Date("2026-06-02T00:01:00.000Z")
    }
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(payload.status, "stage_completed");
  assert.equal(payload.taskId, "task-cron-1");
  assert.equal(db.articleGenerationTasks.filter((task) => task.currentStage === "research").length, 1);
  assert.doesNotMatch(serialized, /cron-secret|selectedTopic|handoff/);
});

test("article generation cancel API handles auth, validation, idempotent cancel, and terminal states", async () => {
  const db = new SelectionOnlyDb();
  await db.createArticleGenerationTask({
    id: "task-cancel",
    topicSelectionId: "selection-cancel",
    runId: "run-cancel",
    selectedTopicId: "topic-cancel",
    approvedTitle: "取消选题",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  const successTask = await db.createArticleGenerationTask({
    id: "task-success-cancel",
    topicSelectionId: "selection-success-cancel",
    runId: "run-success-cancel",
    selectedTopicId: "topic-success-cancel",
    approvedTitle: "成功选题",
    status: "queued",
    currentStage: "waiting_for_worker",
    progress: 0,
    message: "文章生成任务已创建，等待执行",
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  successTask.status = "success";

  const unauthorized = await handleArticleGenerationCancel(
    new Request("https://example.com/api/article-generation/cancel", {
      method: "POST",
      body: JSON.stringify({ taskId: "task-cancel" })
    }),
    { db, isAuthorized: async () => false }
  );
  assert.equal(unauthorized.status, 401);

  const missingId = await handleArticleGenerationCancel(
    new Request("https://example.com/api/article-generation/cancel", {
      method: "POST",
      body: JSON.stringify({})
    }),
    { db, isAuthorized: async () => true }
  );
  assert.equal(missingId.status, 400);

  const cancelled = await handleArticleGenerationCancel(
    new Request("https://example.com/api/article-generation/cancel", {
      method: "POST",
      body: JSON.stringify({ taskId: "task-cancel" })
    }),
    {
      db,
      isAuthorized: async () => true,
      now: new Date("2026-06-02T00:01:00.000Z")
    }
  );
  const cancelledPayload = await cancelled.json();
  assert.equal(cancelled.status, 200);
  assert.equal(cancelledPayload.task.status, "cancelled");
  assert.equal(cancelledPayload.task.message, "任务已取消");

  const cancelledAgain = await handleArticleGenerationCancel(
    new Request("https://example.com/api/article-generation/cancel", {
      method: "POST",
      body: JSON.stringify({ taskId: "task-cancel" })
    }),
    {
      db,
      isAuthorized: async () => true,
      now: new Date("2026-06-02T00:02:00.000Z")
    }
  );
  const cancelledAgainPayload = await cancelledAgain.json();
  assert.equal(cancelledAgain.status, 200);
  assert.equal(cancelledAgainPayload.task.cancelledAt, "2026-06-02T00:01:00.000Z");

  const successCancel = await handleArticleGenerationCancel(
    new Request("https://example.com/api/article-generation/cancel", {
      method: "POST",
      body: JSON.stringify({ taskId: "task-success-cancel" })
    }),
    { db, isAuthorized: async () => true }
  );
  assert.equal(successCancel.status, 409);
});

test("cloud brief view routes Neon selections to the article generation page", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );

  assert.match(source, /result\.persistence === "neon"/);
  assert.match(source, /\/article-generation\/\$\{result\.taskId\}/);
  assert.match(source, /选题已保存，但文章任务创建失败/);
  assert.match(source, /body: JSON\.stringify\(\{ action: "continueArticle" \}\)/);
  assert.ok(
    source.indexOf('result.persistence === "neon"') <
      source.indexOf('body: JSON.stringify({ action: "continueArticle" })')
  );
});

test("article generation view displays queued and cancelled states with polling", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/article-generation-view.tsx"),
    "utf8"
  );

  assert.match(source, /window\.setInterval/);
  assert.match(source, /3000/);
  assert.match(source, /文章生成任务已经创建/);
  assert.match(source, /任务已取消/);
  assert.match(source, /terminalStatuses/);
  assert.match(source, /const statusUrl = `\/api\/article-generation\/status\?id=\$\{encodeURIComponent\(taskId\)\}&t=\$\{Date\.now\(\)\}`/);
  assert.match(source, /fetch\(statusUrl, \{/);
  assert.match(source, /method: "GET"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(source, /document\.visibilityState === "visible"/);
  assert.match(source, /window\.addEventListener\("pageshow", handlePageShow\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(source, /window\.removeEventListener\("pageshow", handlePageShow\)/);
  assert.match(source, /const progress = Math\.max\(0, Math\.min\(100, task\?\.progress \?\? 0\)\)/);
  assert.match(source, /\{progress\}%/);
  assert.match(source, /width: `\$\{progress\}%`/);
  assert.match(source, /task\.currentStage === "research"\s+\?\s+"等待下一阶段"/);
  assert.match(source, /\/api\/article-generation\/cancel/);
});

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function apimartEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    COVER_IMAGE_PROVIDER: "apimart",
    COVER_ENABLE_REAL_API: "true",
    APIMART_API_KEY: "apimart-secret-value",
    APIMART_IMAGE_API_URL: "https://apimart.example/v1/images/generations",
    APIMART_TASK_INITIAL_DELAY_MS: "0",
    APIMART_TASK_POLL_INTERVAL_MS: "0",
    APIMART_COVER_STYLE: "Pixar-inspired clean cover",
    ...overrides
  };
}

async function seedCoverRegenerateFiles(root: string): Promise<string> {
  await mkdir(join(root, "outputs/covers"), { recursive: true });
  const currentCoverPath = join(root, "outputs/covers/current.png");
  await writeFile(currentCoverPath, Buffer.from(tinyPngBase64, "base64"));
  await writeJson(root, "outputs/article-meta.json", {
    title: "当前文章标题",
    articleThesis: "核心观点是 AI 编码代理竞争正在转向工作流入口。"
  });
  await writeFile(join(root, "outputs/article.md"), "# 当前文章标题\n\n正文内容。", "utf8");
  await writeJson(root, "outputs/cover.json", {
    provider: "apimart",
    mode: "real",
    title: "当前文章标题",
    coverText: "AI 工作流\n入口之争",
    imagePrompt: "Current prompt with $200 and 免费平替 should be sanitized.",
    negativePrompt: "low resolution",
    imageSize: "900x383",
    imagePath: currentCoverPath,
    generatedAt: "2026-06-01T00:00:00.000Z",
    review: { passed: true, issues: [], riskNotes: [] }
  });
  return currentCoverPath;
}

function fakeApimartFetch(calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        data: [{ b64_json: tinyPngBase64 }]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;
}

test("dashboard status reads outputs state", async () => {
  const root = await createTempRoot();
  try {
    await writeJson(root, "outputs/candidate-news.json", [{ title: "候选" }]);
    await writeJson(root, "outputs/shortlisted-news.json", [{ title: "入围" }]);
    await writeJson(root, "outputs/selected-topic.json", { selected: { title: "主选题" } });
    await writeJson(root, "outputs/topic-profile.json", {
      topicId: "topic-1",
      primaryDomain: "product",
      eventTypes: ["launch"]
    });
    await writeJson(root, "outputs/research-plan.json", {
      topicId: "topic-1",
      tasks: [{ id: "task-1" }],
      policyRefs: [{ id: "product-launch" }]
    });
    await writeJson(root, "outputs/source-evidence.json", {
      topicId: "topic-1",
      collectionMode: "metadata_only",
      items: [{ id: "evidence-1" }]
    });
    await writeJson(root, "outputs/editorial-plan.json", {
      topicId: "topic-1",
      contentMode: "news_analysis",
      sections: [{ id: "section-1" }]
    });
    await writeJson(root, "outputs/article-meta.json", { title: "文章标题" });
    await writeJson(root, "outputs/article-review.json", {
      passed: true,
      reviewPolicies: [{ id: "product-launch", version: "1.0" }]
    });
    await writeJson(root, "outputs/cover-review.json", { passed: true });
    await writeJson(root, "outputs/wechat-layout.json", { allowedNextStage: true, compatibleWithWechat: true });
    await writeJson(root, "outputs/wechat-api-preflight.json", { passed: true });
    await writeJson(root, "outputs/wechat-draft-result.json", { status: "draft_saved", mode: "mock" });

    const status = await getDashboardStatus({ rootDir: root });

    assert.equal(status.briefSource, "pipeline-outputs");
    assert.equal(status.steps.find((step) => step.key === "topic-profile")?.state, "passed");
    assert.equal(status.steps.find((step) => step.key === "research-plan")?.state, "passed");
    assert.equal(status.steps.find((step) => step.key === "source-evidence")?.state, "passed");
    assert.equal(status.steps.find((step) => step.key === "editorial-plan")?.state, "passed");
    assert.equal(status.steps.find((step) => step.key === "review-policy")?.state, "passed");
    assert.ok(status.dynamicArtifacts.some((artifact) => artifact.key === "review-policy"));
    assert.equal(status.steps.find((step) => step.key === "article-review")?.state, "passed");
    assert.equal(status.steps.find((step) => step.key === "wechat-draft")?.state, "passed");

    const article = await getArticleData({ rootDir: root });
    assert.equal(article.topicProfile?.primaryDomain, "product");
    assert.equal(article.researchPlan?.tasks?.length, 1);
    assert.equal(article.sourceEvidence?.items?.length, 1);
    assert.equal(article.editorialPlan?.sections?.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard status shows latest article-writing validation failure", async () => {
  const root = await createTempRoot();
  try {
    await writeJson(root, "outputs/selected-topic.json", { selected: { title: "主选题" } });
    await writeJson(root, "outputs/article-writing-error.json", {
      failedStep: "article-writer",
      error: "Article contains forbidden absolute wording: Claude Code 必须花 $200 才能用",
      suggestedFix: "重新生成 topic-fact-pack 后再从 article 阶段运行。",
      generatedAt: "2026-06-02T00:00:00.000Z"
    });

    const status = await getDashboardStatus({ rootDir: root });
    const article = await getArticleData({ rootDir: root });
    const articleStep = status.steps.find((step) => step.key === "article");

    assert.equal(articleStep?.state, "failed");
    assert.match(articleStep?.detail ?? "", /forbidden absolute wording/);
    assert.match(String(article.llmError?.error), /forbidden absolute wording/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file API helper refuses .env and node_modules", async () => {
  const root = await createTempRoot();
  try {
    await writeFile(join(root, ".env"), "WECHAT_APP_SECRET=secret", "utf8");
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "node_modules/secret.txt"), "secret", "utf8");
    await writeFile(join(root, "outputs/ok.txt"), "hello", "utf8");

    await assert.rejects(() => readFileForApi(".env", { rootDir: root }));
    await assert.rejects(() => readFileForApi("node_modules/secret.txt", { rootDir: root }));
    const ok = await readFileForApi("outputs/ok.txt", { rootDir: root });
    assert.equal(ok.content, "hello");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard action only executes allowlisted commands", async () => {
  const root = await createTempRoot();
  try {
    const result = await executeDashboardAction("draftDryRun", {
      rootDir: root,
      runner: async (input) => {
        assert.equal(input.command, "pnpm");
        assert.deepEqual(input.args, ["wechat:draft:dry-run"]);
        return {
          exitCode: 0,
          stdout: "access_token=should-not-leak\nok",
          stderr: ""
        };
      }
    });

    assert.equal(result.status, "passed");
    assert.match(result.stdout, /\[REDACTED\]/);
    assert.doesNotMatch(result.stdout, /should-not-leak/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard action refreshLayout is allowlisted and fixed to layout flow", async () => {
  const root = await createTempRoot();
  try {
    const result = await executeDashboardAction("refreshLayout", {
      rootDir: root,
      runner: async (input) => {
        assert.equal(input.command, "pnpm");
        assert.deepEqual(input.args, ["run:daily", "--", "--from", "layout"]);
        assert.equal(input.env.FORBID_WECHAT_PUBLISH, "true");
        assert.equal(input.env.FORBID_WECHAT_MASS_SEND, "true");
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
    });

    assert.equal(result.status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard action rejects publish, freepublish, mass, and sendall", async () => {
  const root = await createTempRoot();
  try {
    for (const action of ["publish", "freepublish", "mass", "sendall", "群发", "立即发送"]) {
      const result = await executeDashboardAction(action, {
        rootDir: root,
        runner: async () => {
          throw new Error("runner should not be called");
        }
      });
      assert.equal(result.status, "rejected");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval writer saves inputs/editorial-approval.json", async () => {
  const root = await createTempRoot();
  try {
    const result = await saveApproval(
      {
        approvedByUser: true,
        approvedTopicId: "topic-1",
        approvedTitle: "标题",
        notes: "ok"
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, result.path), "utf8"));
    assert.equal(saved.approvedByUser, true);
    assert.equal(saved.approvedTopicId, "topic-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard brief data prioritizes 10 shortlisted items with source URLs", async () => {
  const root = await createTempRoot();
  try {
    const shortlistedItems = Array.from({ length: 10 }, (_, index) => ({
      id: `topic-${index + 1}`,
      rank: index + 1,
      title: `入围资讯 ${index + 1}`,
      url: `https://example.com/original-${index + 1}`,
      sourceName: "Example",
      sourceType: index === 0 ? "global_search" : "rss",
      provider: index === 0 ? "tavily" : null,
      query: index === 0 ? "AI news" : null,
      category: "tooling",
      tags: ["agent"],
      summary: "摘要",
      topicAngle: "选题角度",
      shortlistReason: "入围理由",
      shortlistScore: 90 - index,
      riskNotes: []
    }));
    await writeJson(root, "outputs/editorial-brief.json", {
      generatedAt: "2026-06-02T00:00:00.000Z",
      shortlistedItems,
      recommendedTopic: {
        id: "topic-1",
        title: "推荐",
        url: "https://example.com/original-1",
        riskNotes: []
      },
      runnersUp: shortlistedItems.slice(1, 3),
      approvalRequired: true
    });

    const data = await getBriefData({ rootDir: root });

    assert.equal(data.shortlisted.length, 10);
    assert.ok(data.shortlisted.every((item) => item.title && item.url));
    assert.equal(data.shortlisted[0].sourceType, "global_search");
    assert.equal(data.shortlisted[0].provider, "tavily");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief topic selection writes approved editorial approval and redirects to article", async () => {
  const root = await createTempRoot();
  try {
    const shortlistedItems = Array.from({ length: 10 }, (_, index) => ({
      id: `topic-${index + 1}`,
      title: `入围资讯 ${index + 1}`,
      url: `https://example.com/${index + 1}`
    }));
    await writeJson(root, "outputs/editorial-brief.json", { shortlistedItems });

    // 模拟 client 端发完整 topic 对象（cloud flow 真实场景）
    const result = await selectBriefTopic(
      {
        topicId: "topic-7",
        topic: {
          id: "topic-7",
          title: "入围资讯 7",
          titleZh: "入围资讯 7",
          url: "https://example.com/7"
        }
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, "inputs/editorial-approval.json"), "utf8"));

    assert.equal(result.redirectTo, "/article");
    assert.equal(saved.approvedByUser, true);
    assert.equal(saved.approvedTopicId, "topic-7");
    assert.equal(saved.approvedTitle, "入围资讯 7");
    assert.equal(saved.notes, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief topic selection accepts a cloud brief topic snapshot", async () => {
  const root = await createTempRoot();
  try {
    const result = await selectBriefTopic(
      {
        source: "cloud-brief",
        topicId: "cloud-topic-3",
        topic: {
          id: "cloud-topic-3",
          title: "Cloud topic raw title",
          titleZh: "云端入围资讯",
          url: "https://example.com/cloud-topic-3",
          sourceName: "Example Cloud",
          sourceType: "global_search",
          provider: "tavily",
          query: "AI 智能体 工作流",
          category: "tooling",
          tags: ["agent", "developer-workflow"],
          summaryZh: "这是一条云端简报摘要。",
          topicAngleZh: "从工作流入口变化切入。",
          shortlistReasonZh: "适合作为今日主文。",
          shortlistScore: 88,
          riskNotesZh: ["需要回到原文核验。"]
        },
        shortlistedItems: [
          {
            id: "cloud-topic-3",
            rank: 1,
            title: "Cloud topic raw title",
            titleZh: "云端入围资讯",
            url: "https://example.com/cloud-topic-3",
            sourceName: "Example Cloud",
            sourceType: "global_search",
            provider: "tavily",
            query: "AI 智能体 工作流",
            category: "tooling",
            tags: ["agent", "developer-workflow"],
            summaryZh: "这是一条云端简报摘要。",
            topicAngleZh: "从工作流入口变化切入。",
            shortlistReasonZh: "适合作为今日主文。",
            shortlistScore: 88,
            riskNotesZh: ["需要回到原文核验。"]
          }
        ]
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, "inputs/editorial-approval.json"), "utf8"));
    const selectedTopic = JSON.parse(await readFile(join(root, "outputs/selected-topic.json"), "utf8"));
    const shortlisted = JSON.parse(await readFile(join(root, "outputs/shortlisted-news.json"), "utf8"));
    const candidates = JSON.parse(await readFile(join(root, "outputs/candidate-news.json"), "utf8"));

    assert.equal(result.redirectTo, "/article");
    assert.equal(saved.approvedByUser, true);
    assert.equal(saved.approvedTopicId, "cloud-topic-3");
    assert.equal(saved.approvedTitle, "云端入围资讯");
    assert.equal(selectedTopic.selected.id, "cloud-topic-3");
    assert.equal(selectedTopic.selected.url, "https://example.com/cloud-topic-3");
    assert.equal(selectedTopic.selected.selection.writingAngle, "从工作流入口变化切入。");
    assert.equal(shortlisted[0].id, "cloud-topic-3");
    assert.equal(candidates[0].id, "cloud-topic-3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud brief topic selection persists durable Neon handoff without local writes on Vercel", async () => {
  const root = await createTempRoot();
  const db = new SelectionOnlyDb();
  try {
    const result = await selectBriefTopic(
      {
        source: "cloud-brief",
        runId: "run-cloud-1",
        topicId: "cloud-topic-3",
        topic: {
          id: "cloud-topic-3",
          runId: "run-cloud-1",
          newsItemId: "news-3",
          title: "Cloud topic raw title",
          titleZh: "云端入围资讯",
          url: "https://example.com/cloud-topic-3",
          sourceName: "Example Cloud",
          sourceType: "global_search",
          provider: "tavily",
          query: "AI 智能体 工作流",
          category: "tooling",
          tags: ["agent", "developer-workflow"],
          summaryZh: "这是一条云端简报摘要。",
          topicAngleZh: "从工作流入口变化切入。",
          shortlistReasonZh: "适合作为今日主文。",
          shortlistScore: 88,
          riskNotesZh: ["需要回到原文核验。"]
        },
        shortlistedItems: [
          {
            id: "cloud-topic-3",
            runId: "run-cloud-1",
            newsItemId: "news-3",
            rank: 1,
            title: "Cloud topic raw title",
            titleZh: "云端入围资讯",
            url: "https://example.com/cloud-topic-3",
            sourceName: "Example Cloud",
            sourceType: "global_search",
            provider: "tavily",
            query: "AI 智能体 工作流",
            category: "tooling",
            tags: ["agent", "developer-workflow"],
            summaryZh: "这是一条云端简报摘要。",
            topicAngleZh: "从工作流入口变化切入。",
            shortlistReasonZh: "适合作为今日主文。",
            shortlistScore: 88,
            riskNotesZh: ["需要回到原文核验。"]
          }
        ]
      },
      {
        rootDir: root,
        db,
        env: { VERCEL: "1" },
        writeLocalHandoff: false
      }
    );

    assert.equal(result.path, "neon:article_generation_tasks");
    assert.equal(result.persistence, "neon");
    assert.equal(typeof result.taskId, "string");
    assert.ok(result.taskId);
    assert.equal(result.taskStatus, "queued");
    assert.equal(result.redirectTo, `/article-generation/${result.taskId}`);
    assert.equal(db.ensured, true);
    assert.equal(db.selections.length, 1);
    assert.equal(db.articleGenerationTasks.length, 1);
    assert.equal(db.selections[0].runId, "run-cloud-1");
    assert.equal(db.selections[0].selectedShortlistedItemId, "cloud-topic-3");
    assert.equal(db.articleGenerationTasks[0].topicSelectionId, db.selections[0].id);
    assert.equal(db.articleGenerationTasks[0].runId, "run-cloud-1");
    assert.equal(db.articleGenerationTasks[0].selectedTopicId, "cloud-topic-3");
    assert.equal(db.articleGenerationTasks[0].status, "queued");
    assert.equal(db.articleGenerationTasks[0].currentStage, "waiting_for_worker");
    assert.equal(db.articleGenerationTasks[0].progress, 0);
    assert.equal(db.articleGenerationTasks[0].message, "文章生成任务已创建，等待执行");
    assert.equal(db.selections[0].handoffJson.approval.approvedTopicId, "cloud-topic-3");
    assert.equal(
      (db.selections[0].handoffJson.selectedTopic as any).selected.selection.writingAngle,
      "从工作流入口变化切入。"
    );
    await assert.rejects(() => access(join(root, "inputs/editorial-approval.json")));
    await assert.rejects(() => access(join(root, "outputs/selected-topic.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud brief topic selection reuses an active article generation task", async () => {
  const root = await createTempRoot();
  const db = new SelectionOnlyDb();
  const input = {
    source: "cloud-brief",
    runId: "run-cloud-1",
    topicId: "cloud-topic-3",
    topic: {
      id: "cloud-topic-3",
      runId: "run-cloud-1",
      title: "Cloud topic raw title",
      titleZh: "云端入围资讯",
      url: "https://example.com/cloud-topic-3"
    },
    shortlistedItems: [
      {
        id: "cloud-topic-3",
        runId: "run-cloud-1",
        rank: 1,
        title: "Cloud topic raw title",
        titleZh: "云端入围资讯",
        url: "https://example.com/cloud-topic-3"
      }
    ]
  };

  try {
    const first = await selectBriefTopic(input, {
      rootDir: root,
      db,
      env: { VERCEL: "1" },
      writeLocalHandoff: false
    });
    const second = await selectBriefTopic(input, {
      rootDir: root,
      db,
      env: { VERCEL: "1" },
      writeLocalHandoff: false
    });

    assert.equal(first.taskId, second.taskId);
    assert.equal(db.articleGenerationTasks.length, 1);
    assert.equal(second.redirectTo, `/article-generation/${first.taskId}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief topic selection rejects shortlisted items without URL", async () => {
  const root = await createTempRoot();
  try {
    await writeJson(root, "outputs/editorial-brief.json", {
      shortlistedItems: [{ id: "topic-1", title: "无 URL" }]
    });

    await assert.rejects(
      () => selectBriefTopic({ topicId: "topic-1" }, { rootDir: root }),
      /original URL/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("article save writes markdown and updates meta word count", async () => {
  const root = await createTempRoot();
  try {
    const result = await saveArticleDraft(
      { title: "新标题", content: "第一段\n\n第二段" },
      { rootDir: root }
    );
    const markdown = await readFile(join(root, "outputs/article.md"), "utf8");
    const meta = JSON.parse(await readFile(join(root, "outputs/article-meta.json"), "utf8"));

    assert.equal(result.articlePath, "outputs/article.md");
    assert.match(markdown, /^# 新标题/);
    assert.equal(meta.title, "新标题");
    assert.equal(typeof meta.wordCount, "number");
    assert.equal(typeof meta.updatedAt, "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("article title selection must come from candidates and blocks forbidden terms", async () => {
  const root = await createTempRoot();
  try {
    await writeJson(root, "outputs/title-candidates.json", {
      forbiddenTerms: ["群发"],
      candidates: [
        { title: "安全标题", violations: [] },
        { title: "群发标题", violations: [] }
      ]
    });
    await writeJson(root, "outputs/article-meta.json", { title: "旧标题" });
    await writeFile(join(root, "outputs/article.md"), "# 旧标题\n\n正文", "utf8");

    const result = await selectArticleTitle({ title: "安全标题" }, { rootDir: root });
    const markdown = await readFile(join(root, "outputs/article.md"), "utf8");

    assert.equal(result.title, "安全标题");
    assert.match(markdown, /^# 安全标题/);
    await assert.rejects(
      () => selectArticleTitle({ title: "群发标题" }, { rootDir: root }),
      /forbidden term/
    );
    await assert.rejects(
      () => selectArticleTitle({ title: "不存在" }, { rootDir: root }),
      /title-candidates/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/brief page reads the cloud today API with friendly empty state", async () => {
  const pageSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/brief/page.tsx"),
    "utf8"
  );
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );

  assert.match(pageSource, /CloudBriefView/);
  assert.match(pageSource, /requireDashboardSession/);
  assert.match(viewSource, /api\/brief\/today/);
  assert.match(viewSource, /今日 10 条入围资讯阅读清单/);
  assert.match(viewSource, /今日简报尚未生成。请等待 7 点定时任务，或手动触发生成。/);
  assert.match(viewSource, /href=\{item\.url\}/);
  assert.match(viewSource, /api\/brief\/select-topic/);
  assert.match(viewSource, /api\/action/);
  assert.match(viewSource, /continueArticle/);
  assert.match(viewSource, /正在生成文章/);
  assert.match(viewSource, /readBriefCache/);
  assert.match(viewSource, /writeBriefCache/);
  assert.match(viewSource, /sessionStorage/);
  assert.match(viewSource, /刷新云端/);
  assert.match(viewSource, /选择此题/);
});

test("/brief page can manually generate and refresh today's cloud brief", async () => {
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );

  assert.match(viewSource, /开始收集/);
  assert.match(viewSource, /重新收集/);
  assert.match(viewSource, /api\/brief\/generate/);
  assert.match(viewSource, /method: "POST"/);
  assert.match(viewSource, /JSON\.stringify\(force \? \{ force: true \} : \{\}\)/);
  assert.match(viewSource, /disabled=\{generateState === "loading"\}/);
  assert.match(viewSource, /正在收集\.\.\./);
  assert.match(viewSource, /正在抓取资讯并筛选 10 条入围内容，通常需要 30～60 秒。/);
  assert.match(viewSource, /收集完成/);
  assert.match(viewSource, /await loadBrief\(\{ showLoading: false \}\)/);
  assert.match(viewSource, /const cachedPayload = readBriefCache\(\)/);
  assert.match(viewSource, /onClick=\{refreshBrief\}/);
  assert.match(viewSource, /items\.slice\(0, 10\)\.map/);
});

test("/brief rerun asks for confirmation and displays step-level failures", async () => {
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );

  assert.match(viewSource, /window\.confirm/);
  assert.match(viewSource, /今天已经生成过简报，重新收集会覆盖今日入围资讯，是否继续？/);
  assert.match(viewSource, /收集失败/);
  assert.match(viewSource, /失败阶段：/);
  assert.match(viewSource, /错误摘要：/);
  assert.match(viewSource, /排查提示：/);
  assert.match(viewSource, /Endpoint：/);
  assert.match(viewSource, /result\.step \?\? "unknown"/);
  assert.match(viewSource, /result\.error \?\? "Brief generation failed\."/);
});

test("/api/brief/generate is dashboard-authenticated and not a cron-secret endpoint", async () => {
  const routeSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/api/brief/generate/route.ts"),
    "utf8"
  );
  const handlerSource = await readFile(
    join(process.cwd(), "apps/dashboard/lib/manual-generate-brief.ts"),
    "utf8"
  );
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );
  const source = `${routeSource}\n${handlerSource}`;

  assert.match(source, /hasDashboardSession/);
  assert.match(source, /generateCloudBriefForToday/);
  assert.match(source, /manual force run/);
  assert.match(source, /step/);
  assert.match(source, /redactJson/);
  assert.doesNotMatch(source, /verifyBearerToken/);
  assert.doesNotMatch(viewSource, /CRON_SECRET|DATABASE_URL|R2_SECRET_ACCESS_KEY|API_KEY|APP_SECRET|ACCESS_TOKEN/);
  assert.doesNotMatch(source, /wechatOfficialApi|saveWechatDraft|freepublish|mass|sendall|api\.weixin\.qq\.com|\/publish/i);
});

test("dashboard next config loads root .env for server-only auth settings", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/next.config.ts"),
    "utf8"
  );

  assert.match(source, /loadRootDotEnv\(\)/);
  assert.match(source, /join\(dashboardDir, "\.\.", "\.\.", "\.env"\)/);
  assert.match(source, /process\.env\[key\] !== undefined/);
  assert.doesNotMatch(source, /console\.log|DASHBOARD_PASSWORD|AUTH_SECRET/);
});

test("dashboard main nav only exposes brief, article, preview, and feedback", async () => {
  const shellSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/shell.tsx"),
    "utf8"
  );
  const navBlock = shellSource.match(/const navItems = \[[\s\S]*?\];/)?.[0] ?? "";
  const debugBlock = shellSource.match(/const debugItems = \[[\s\S]*?\];/)?.[0] ?? "";

  for (const label of ["简报", "文章", "预览", "反馈"]) {
    assert.match(navBlock, new RegExp(label));
  }
  for (const label of ["总览", "确认", "标题", "封面", "微信", "Runs", "设置"]) {
    assert.doesNotMatch(navBlock, new RegExp(label));
    assert.match(debugBlock, new RegExp(label));
  }
});

test("article workbench has collapsed title candidates, editable article, AI rewrite, and cover controls", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/article-workbench.tsx"),
    "utf8"
  );

  assert.match(source, /useState\(false\)/);
  assert.match(source, /展开标题候选/);
  assert.match(source, /api\/article\/select-title/);
  assert.match(source, /api\/article\/save/);
  assert.match(source, /api\/article\/rewrite/);
  assert.match(source, /api\/article\/confirm/);
  assert.match(source, /api\/cover\/crop/);
  assert.match(source, /api\/cover\/regenerate/);
  assert.match(source, /保存草稿/);
  assert.match(source, /预览排版/);
  assert.match(source, /确认下一步/);
});

test("article workbench cover regenerate keeps loading on the button and refreshes cover files", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/article-workbench.tsx"),
    "utf8"
  );

  assert.match(source, /CoverRegenerateStatus = "idle" \| "loading" \| "success" \| "failed"/);
  assert.match(source, /coverRegenerateInFlight/);
  assert.match(source, /正在生成\.\.\./);
  assert.match(source, /disabled=\{pending \|\| coverRegenerating\}/);
  assert.doesNotMatch(source, /正在调用 APIMart 生成新封面，可能需要几十秒/);
  assert.match(source, /封面已重新生成/);
  assert.match(source, /封面生成失败/);
  assert.match(source, /fetchDashboardJson\("outputs\/cover\.json"\)/);
  assert.match(source, /fetchDashboardJson\("outputs\/cover-history\.json"\)/);
  assert.match(source, /raw=1&t=/);
  assert.match(source, /setCoverPrompt\(""\)/);
  assert.match(source, /已设为当前封面/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /当前封面不能删除/);
});

test("article workbench renders an interactive fixed-ratio cover cropper", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/article-workbench.tsx"),
    "utf8"
  );

  assert.match(source, /from "react-easy-crop"/);
  assert.match(source, /const WECHAT_COVER_ASPECT = 900 \/ 383/);
  assert.match(source, /const \[crop, setCrop\] = useState\(\{ x: 0, y: 0 \}\)/);
  assert.match(source, /const \[zoom, setZoom\] = useState\(1\)/);
  assert.match(source, /const \[croppedAreaPixels, setCroppedAreaPixels\]/);
  assert.match(source, /<Cropper/);
  assert.match(source, /image=\{coverImage\.src\}/);
  assert.match(source, /crop=\{crop\}/);
  assert.match(source, /zoom=\{zoom\}/);
  assert.match(source, /aspect=\{WECHAT_COVER_ASPECT\}/);
  assert.match(source, /onCropChange=\{setCrop\}/);
  assert.match(source, /onZoomChange=\{setZoom\}/);
  assert.match(source, /onCropComplete=\{onCropComplete\}/);
  assert.match(source, /type="range"/);
  assert.match(source, /setZoom\(Number\(event\.target\.value\)\)/);
  assert.match(source, /\/api\/cover\/crop/);
  assert.match(source, /x: croppedAreaPixels\.x/);
  assert.match(source, /width: croppedAreaPixels\.width/);
  assert.match(source, /rawFileUrl\(nextRelativePath, Date\.now\(\)\)/);
  assert.match(source, /setCoverHistory\(normalizeHistoryItems\(payload\.history, nextRelativePath\)\)/);
  assert.match(source, /封面裁剪已保存并应用到当前文章/);
  assert.match(source, /封面裁剪失败/);
  assert.doesNotMatch(source, /CropField/);
});

test("cover regenerate route returns ok true payload and redacted failed payload", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/app/api/cover/regenerate/route.ts"),
    "utf8"
  );

  assert.match(source, /regenerateCover\(body\)/);
  assert.match(source, /\{ ok: true, \.\.\.result \}/);
  assert.match(source, /ok: false/);
  assert.match(source, /redactJson/);
});

test("only preview page exposes the write-to-draft action button", async () => {
  const previewSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/preview/page.tsx"),
    "utf8"
  );
  const appFiles = [
    "apps/dashboard/app/page.tsx",
    "apps/dashboard/app/brief/page.tsx",
    "apps/dashboard/app/article/page.tsx",
    "apps/dashboard/app/feedback/page.tsx",
    "apps/dashboard/app/wechat/page.tsx"
  ];

  assert.match(previewSource, /createWechatDraft/);
  assert.match(previewSource, /写入公众号草稿箱/);
  for (const file of appFiles) {
    const source = await readFile(join(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /createWechatDraft|写入公众号草稿箱/);
  }
});

test("cover crop generates a 900x383 png and updates cover json plus history", async () => {
  const root = await createTempRoot();
  try {
    await mkdir(join(root, "outputs/covers"), { recursive: true });
    const imagePath = join(root, "outputs/covers/current.png");
    await sharp({
      create: {
        width: 1200,
        height: 700,
        channels: 4,
        background: { r: 82, g: 130, b: 190, alpha: 1 }
      }
    })
      .png()
      .toFile(imagePath);
    await writeJson(root, "outputs/cover.json", {
      provider: "apimart",
      mode: "real",
      imagePath: "outputs/covers/current.png",
      title: "当前封面",
      updatedAt: "2026-06-01T00:00:00.000Z"
    });
    await writeJson(root, "outputs/cover-history.json", {
      items: [
        {
          imagePath: "outputs/covers/current.png",
          provider: "apimart",
          mode: "real",
          instruction: "initial",
          createdAt: "2026-06-01T00:00:00.000Z",
          isCurrent: true
        }
      ]
    });

    const result = await cropCover(
      { crop: { x: 100, y: 50, width: 900, height: 383 } },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, "outputs/cover.json"), "utf8"));
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));
    const metadata = await sharp(join(root, result.imagePath)).metadata();

    assert.equal(result.message, "cover cropped");
    assert.match(result.imagePath, /^outputs\/covers\/cover-cropped-.*\.png$/);
    assert.equal(metadata.width, 900);
    assert.equal(metadata.height, 383);
    assert.equal(saved.imagePath, result.imagePath);
    assert.equal(saved.provider, "apimart");
    assert.equal(saved.mode, "real");
    assert.equal(saved.cropApplied, true);
    assert.equal(saved.cropSourceImagePath, "outputs/covers/current.png");
    assert.equal(saved.crop.x, 100);
    assert.equal(typeof saved.updatedAt, "string");
    assert.equal(history.items[0].imagePath, result.imagePath);
    assert.equal(history.items[0].instruction, "manual crop");
    assert.equal(history.items[0].isCurrent, true);
    assert.equal(history.items.find((item: any) => item.imagePath === "outputs/covers/current.png").isCurrent, false);
    assert.equal(result.history.length, history.items.length);
    assert.doesNotMatch(JSON.stringify({ saved, history }), /freepublish|mass|sendall/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover crop rejects images outside outputs/covers", async () => {
  const root = await createTempRoot();
  try {
    await writeFile(join(root, "outputs/current.png"), Buffer.from(tinyPngBase64, "base64"));
    await writeJson(root, "outputs/cover.json", {
      provider: "apimart",
      mode: "real",
      imagePath: "outputs/current.png"
    });

    await assert.rejects(
      () => cropCover({ crop: { x: 0, y: 0, width: 1, height: 1 } }, { rootDir: root }),
      /outputs\/covers/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover crop code does not call APIMart, WeChat, or publish endpoints", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/lib/editor-workflow.ts"),
    "utf8"
  );
  const cropBlock = source.match(/export async function cropCover[\s\S]*?^export async function setCurrentCoverVersion/m)?.[0] ?? "";

  assert.doesNotMatch(cropBlock, /generateApimartImage|APIMART_API|APIMART_IMAGE|fetch\(|wechatOfficialApi/i);
  assert.doesNotMatch(cropBlock, /\b(?:publish|freepublish|mass|sendall)\b/i);
});

test("cover regenerate returns imagePath and updates cover json plus history", async () => {
  const root = await createTempRoot();
  try {
    const previousCoverPath = await seedCoverRegenerateFiles(root);
    const calls: string[] = [];

    const result = await regenerateCover(
      { instruction: "标题更清晰，视觉中心更突出" },
      {
        rootDir: root,
        env: apimartEnv(),
        fetchImpl: fakeApimartFetch(calls),
        now: new Date("2026-06-02T01:02:03.000Z")
      }
    );
    const savedCover = JSON.parse(await readFile(join(root, "outputs/cover.json"), "utf8"));
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));
    const log = await readFile(join(root, "logs/dashboard-actions.log"), "utf8");

    assert.equal(result.message, "cover regenerated");
    assert.match(result.imagePath, /^outputs\/covers\/cover-apimart-regenerated-.*\.png$/);
    assert.equal(savedCover.imagePath, result.imagePath);
    assert.equal(savedCover.provider, "apimart");
    assert.equal(savedCover.mode, "real");
    assert.equal(savedCover.regenerateInstruction, "标题更清晰，视觉中心更突出");
    assert.equal(savedCover.previousImagePath, "outputs/covers/current.png");
    assert.equal(savedCover.review.passed, true);
    assert.equal(history.items[0].imagePath, result.imagePath);
    assert.equal(history.items[0].isCurrent, true);
    assert.equal(history.items.some((item: any) => item.imagePath === "outputs/covers/current.png"), true);
    assert.equal(result.historyCount, history.items.length);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(savedCover), /freepublish|mass|sendall/i);
    assert.doesNotMatch(log, /apimart-secret-value/);
    await access(join(root, result.imagePath));
    await access(previousCoverPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover regenerate failure returns readable APIMart errors and preserves current cover", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const beforeCover = await readFile(join(root, "outputs/cover.json"), "utf8");

    await assert.rejects(
      () =>
        regenerateCover(
          { instruction: "换一版" },
          {
            rootDir: root,
            env: apimartEnv(),
            fetchImpl: (async () =>
              new Response(JSON.stringify({ error: "upstream failed" }), {
                status: 502,
                statusText: "Bad Gateway",
                headers: { "content-type": "application/json" }
              })) as typeof fetch
          }
        ),
      /APIMart 请求失败.*HTTP 502/
    );

    const afterCover = await readFile(join(root, "outputs/cover.json"), "utf8");
    const covers = await readdir(join(root, "outputs/covers"));
    const log = await readFile(join(root, "logs/dashboard-actions.log"), "utf8");

    assert.equal(afterCover, beforeCover);
    assert.equal(covers.some((file) => file.includes("cover-apimart-regenerated")), false);
    assert.match(log, /"status":"failed"/);
    assert.doesNotMatch(log, /apimart-secret-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover regenerate reports missing APIMART_API_KEY without leaking secrets", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);

    await assert.rejects(
      () =>
        regenerateCover(
          { instruction: "更温暖" },
          {
            rootDir: root,
            env: apimartEnv({ APIMART_API_KEY: "" }),
            fetchImpl: fakeApimartFetch()
          }
        ),
      /请先配置 APIMART_API_KEY/
    );

    const log = await readFile(join(root, "logs/dashboard-actions.log"), "utf8");
    assert.match(log, /请先配置 APIMART_API_KEY/);
    assert.doesNotMatch(log, /apimart-secret-value|Bearer/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover regenerate does not call WeChat or publish endpoints", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const calls: string[] = [];

    await regenerateCover(
      { instruction: "" },
      {
        rootDir: root,
        env: apimartEnv(),
        fetchImpl: fakeApimartFetch(calls)
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls.some((url) => /wechat|freepublish|mass|sendall|publish/i.test(url)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover version set-current updates cover json and history", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const nextPath = join(root, "outputs/covers/next.png");
    await writeFile(nextPath, Buffer.from(tinyPngBase64, "base64"));
    await writeJson(root, "outputs/cover-history.json", {
      items: [
        {
          imagePath: "outputs/covers/current.png",
          provider: "apimart",
          mode: "real",
          instruction: "old",
          createdAt: "2026-06-01T00:00:00.000Z",
          isCurrent: true
        },
        {
          imagePath: "outputs/covers/next.png",
          provider: "apimart",
          mode: "real",
          instruction: "new",
          createdAt: "2026-06-02T00:00:00.000Z",
          isCurrent: false
        }
      ]
    });

    const result = await setCurrentCoverVersion({ imagePath: "outputs/covers/next.png" }, { rootDir: root });
    const savedCover = JSON.parse(await readFile(join(root, "outputs/cover.json"), "utf8"));
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));

    assert.equal(result.message, "cover version set current");
    assert.equal(savedCover.imagePath, "outputs/covers/next.png");
    assert.equal(history.items.find((item: any) => item.imagePath === "outputs/covers/next.png").isCurrent, true);
    assert.equal(history.items.find((item: any) => item.imagePath === "outputs/covers/current.png").isCurrent, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover version delete blocks current cover and removes non-current history", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const oldPath = join(root, "outputs/covers/old.png");
    await writeFile(oldPath, Buffer.from(tinyPngBase64, "base64"));
    await writeJson(root, "outputs/cover-history.json", {
      items: [
        {
          imagePath: "outputs/covers/current.png",
          provider: "apimart",
          mode: "real",
          instruction: "current",
          createdAt: "2026-06-02T00:00:00.000Z",
          isCurrent: true
        },
        {
          imagePath: "outputs/covers/old.png",
          provider: "apimart",
          mode: "real",
          instruction: "old",
          createdAt: "2026-06-01T00:00:00.000Z",
          isCurrent: false
        }
      ]
    });

    await assert.rejects(
      () => deleteCoverVersion({ imagePath: "outputs/covers/current.png" }, { rootDir: root }),
      /current cover cannot be deleted/i
    );
    const result = await deleteCoverVersion({ imagePath: "outputs/covers/old.png" }, { rootDir: root });
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));

    assert.equal(result.message, "cover version deleted");
    assert.equal(history.items.some((item: any) => item.imagePath === "outputs/covers/old.png"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feedback create-current uses current article data and does not overwrite existing files", async () => {
  const root = await createTempRoot();
  try {
    const today = new Date().toISOString().slice(0, 10);
    await writeJson(root, "outputs/article-meta.json", { title: "AI workflow" });
    await writeJson(root, "outputs/selected-topic.json", { selected: { title: "当前主选题" } });
    await writeJson(root, "outputs/wechat-api-draft-result.json", { media_id: "draft-media" });
    await writeJson(root, `feedback/${today}-ai-workflow.json`, { existing: true });

    const result = await createCurrentFeedback({ rootDir: root });
    const saved = JSON.parse(await readFile(join(root, result.path), "utf8"));

    assert.equal(result.path, `feedback/${today}-ai-workflow-2.json`);
    assert.equal(saved.title, "AI workflow");
    assert.equal(saved.topic, "当前主选题");
    assert.equal(saved.draftMediaId, "draft-media");
    assert.equal(saved.published, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feedback writer saves feedback json", async () => {
  const root = await createTempRoot();
  try {
    const result = await saveFeedback(
      {
        fileName: "2026-06-01-test.json",
        feedback: {
          date: "2026-06-01",
          title: "标题",
          views: 10,
          likes: 2,
          shares: 1,
          myRating: 4,
          topicQuality: 5,
          titleQuality: 4,
          coverQuality: 3,
          notes: "复盘"
        }
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, result.path), "utf8"));
    assert.equal(saved.views, 10);
    assert.equal(saved.coverQuality, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("settings status never returns secret plaintext", async () => {
  const root = await createTempRoot();
  try {
    await writeFile(
      join(root, ".env"),
      [
        "REAL_PRODUCTION_MODE=true",
        "LLM_PROVIDER=minimax",
        "COVER_IMAGE_PROVIDER=apimart",
        "WECHAT_API_ENABLE_REAL_DRAFT=true",
        "MINIMAX_API_KEY=minimax-secret-value",
        "APIMART_API_KEY=apimart-secret-value",
        "WECHAT_APP_SECRET=wechat-secret-value"
      ].join("\n"),
      "utf8"
    );

    const settings = await getSettingsStatus({ rootDir: root, env: {} });
    const serialized = JSON.stringify(settings);

    assert.equal(settings.realProductionModeIsTrue, true);
    assert.equal(settings.llmProviderIsMinimax, true);
    assert.equal(settings.secretsPresent.MINIMAX_API_KEY, true);
    assert.doesNotMatch(serialized, /minimax-secret-value|apimart-secret-value|wechat-secret-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
