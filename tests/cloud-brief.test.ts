import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { handleCronGenerateBrief } from "../apps/dashboard/lib/cron-generate-brief";
import { redactJson } from "../apps/dashboard/lib/redaction";
import type { EditorialBriefDbAdapter } from "../src/adapters/neon";
import type { R2StorageAdapter, R2UploadInput } from "../src/adapters/r2";
import {
  generateCloudEditorialBrief,
  getTodayEditorialBrief
} from "../src/pipeline/generateCloudEditorialBrief";
import {
  EDITORIAL_BRIEF_RUN_TYPE,
  type CloudEditorialBriefRecord,
  type CloudNewsItemRecord,
  type CloudRunRecord,
  type CloudRunType,
  type CloudShortlistedItemRecord
} from "../src/types/cloud";
import type {
  NewsCategory,
  NewsScores,
  NewsTag,
  NormalizedNewsItem,
  SelectedTopic,
  ShortlistedNewsItem,
  ShortlistScoreDimensions
} from "../src/types/news";

class MemoryBriefDb implements EditorialBriefDbAdapter {
  runs: CloudRunRecord[] = [];
  newsItems: CloudNewsItemRecord[] = [];
  shortlistedItems: CloudShortlistedItemRecord[] = [];
  briefs: CloudEditorialBriefRecord[] = [];
  ensured = false;

  constructor(seedRuns: CloudRunRecord[] = []) {
    this.runs = [...seedRuns];
  }

  async ensureSchema() {
    this.ensured = true;
  }

  async getSuccessfulRun(runDate: string, runType: CloudRunType) {
    return this.runs.find(
      (run) => run.runDate === runDate && run.runType === runType && run.status === "success"
    );
  }

  async startRun(input: { id: string; runDate: string; runType: CloudRunType; startedAt: string }) {
    const existing = this.runs.find(
      (run) => run.runDate === input.runDate && run.runType === input.runType
    );
    const run: CloudRunRecord = {
      id: existing?.id ?? input.id,
      runDate: input.runDate,
      runType: input.runType,
      status: "running",
      startedAt: input.startedAt,
      createdAt: existing?.createdAt ?? input.startedAt,
      updatedAt: input.startedAt
    };

    if (existing) {
      Object.assign(existing, run);
      return existing;
    }

    this.runs.push(run);
    return run;
  }

  async clearRunArtifacts(runId: string) {
    this.newsItems = this.newsItems.filter((item) => item.runId !== runId);
    this.shortlistedItems = this.shortlistedItems.filter((item) => item.runId !== runId);
    this.briefs = this.briefs.filter((brief) => brief.runId !== runId);
  }

  async insertNewsItems(items: CloudNewsItemRecord[]) {
    this.newsItems.push(...items);
    return items;
  }

  async insertShortlistedItems(items: CloudShortlistedItemRecord[]) {
    this.shortlistedItems.push(...items);
    return items;
  }

  async insertEditorialBrief(brief: CloudEditorialBriefRecord) {
    this.briefs.push(brief);
    return brief;
  }

  async markRunSuccess(runId: string, finishedAt: string) {
    const run = this.mustFindRun(runId);
    run.status = "success";
    run.finishedAt = finishedAt;
    run.error = undefined;
    run.updatedAt = finishedAt;
    return run;
  }

  async markRunFailed(runId: string, finishedAt: string, error: string) {
    const run = this.mustFindRun(runId);
    run.status = "failed";
    run.finishedAt = finishedAt;
    run.error = error;
    run.updatedAt = finishedAt;
    return run;
  }

  async getTodayBrief(runDate: string, runType: CloudRunType) {
    const run =
      this.runs.find(
        (item) => item.runDate === runDate && item.runType === runType && item.status === "success"
      ) ?? null;

    if (!run) {
      return { run: null, brief: null, shortlistedItems: [] };
    }

    return {
      run,
      brief: this.briefs.find((brief) => brief.runId === run.id) ?? null,
      shortlistedItems: this.shortlistedItems
        .filter((item) => item.runId === run.id)
        .sort((left, right) => left.rank - right.rank)
    };
  }

  private mustFindRun(runId: string): CloudRunRecord {
    const run = this.runs.find((item) => item.id === runId);
    if (!run) {
      throw new Error(`Missing run ${runId}`);
    }
    return run;
  }
}

class MemoryR2 implements R2StorageAdapter {
  uploads: R2UploadInput[] = [];

  async putText(input: R2UploadInput) {
    this.uploads.push(input);
    return { key: input.key };
  }
}

function fakeScore(index: number): NewsScores {
  return {
    freshness: 90 - index,
    heat: 85 - index,
    technicalValue: 80,
    wechatTopic: 82,
    businessImpact: 78,
    controversy: 30,
    final: 90 - index
  };
}

function candidate(index: number): NormalizedNewsItem {
  const id = `candidate-${index}`;
  const category: NewsCategory = index % 2 === 0 ? "tooling" : "product";

  return {
    id,
    dataMode: "mock",
    mock: true,
    title: `AI news ${index}`,
    url: `https://example.com/news-${index}`,
    sourceName: "Example",
    sourceType: "rss",
    provider: "none",
    fetchedAt: "2026-06-02T00:00:00.000Z",
    summary: `Summary ${index}`,
    category,
    evidence: [`url: https://example.com/news-${index}`],
    duplicateKey: id,
    scores: fakeScore(index),
    duplicateSources: [],
    tags: ["agent", "tooling"]
  };
}

function shortlisted(item: NormalizedNewsItem, index: number): ShortlistedNewsItem {
  const tags: NewsTag[] = ["agent", "tooling"];
  const shortlistMetrics: ShortlistScoreDimensions = {
    technicalValue: 82,
    wechatTopic: 86,
    businessImpact: 76,
    controversy: 35,
    sourceCredibility: 92,
    explainability: 88,
    originality: 90
  };

  return {
    ...item,
    tags,
    shortlistScore: 95 - index,
    shortlistMetrics,
    editorial: {
      shortlistReason: `Reason ${index}`,
      audienceFit: "开发者和产品读者。",
      topicAngle: `Angle ${index}`,
      riskNote: index === 0 ? "需要核验原始来源。" : undefined,
      recommendedUse: "main_topic_candidate"
    }
  };
}

function selectedTopic(items: ShortlistedNewsItem[]): SelectedTopic {
  return {
    selected: {
      ...items[0],
      selection: {
        selectedReason: "Best topic.",
        whyMostWorthWriting: "It has the clearest conflict.",
        coreConflict: "效率与治理之间的冲突。",
        publicInterest: "读者能理解。",
        technicalSignificance: "技术变化清晰。",
        businessImpact: "影响采购。",
        predictedImpact: "会影响工作流。",
        writingAngle: "从工作流变化切入。",
        suggestedTitles: ["AI 工作流变化"],
        articleThesis: "AI 工具价值正在进入真实流程。",
        riskNotes: ["避免夸大。"],
        sourceReliability: "high",
        decisionScore: 88
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: "2026-06-02T00:00:00.000Z"
  };
}

function fakePipeline() {
  const candidates = Array.from({ length: 20 }, (_, index) => candidate(index + 1));
  const shortlistedItems = candidates.slice(0, 10).map(shortlisted);
  const topic = selectedTopic(shortlistedItems);

  return {
    collectNewsWithReport: async () => ({
      candidates,
      rawItems: [],
      normalizedItems: candidates,
      dedupedItems: candidates,
      rejectedItems: [],
      warnings: [],
      stats: {}
    }),
    shortlistNewsWithReport: async () => ({
      candidates,
      shortlisted: shortlistedItems,
      eliminated: [],
      stats: {}
    }),
    selectTopicWithReport: async () => ({
      shortlisted: shortlistedItems,
      topic
    }),
    generateEditorialBrief: async () => ({
      outputDir: "unused",
      files: {
        markdown: "unused",
        json: "unused"
      },
      markdown: "# 今日 AI 资讯编辑简报\n\n云端报告。",
      brief: {
        generatedAt: "2026-06-02T00:00:00.000Z",
        candidateCount: 20,
        shortlistedCount: 10,
        candidates: [],
        shortlistedItems: [],
        shortlisted: [],
        recommendedTopic: {
          id: topic.selected.id,
          title: topic.selected.title,
          url: topic.selected.url,
          reason: topic.selected.selection.selectedReason,
          coreConflict: topic.selected.selection.coreConflict,
          writingAngle: topic.selected.selection.writingAngle,
          articleThesis: topic.selected.selection.articleThesis,
          sourceReliability: topic.selected.selection.sourceReliability,
          riskNotes: topic.selected.selection.riskNotes
        },
        runnersUp: [],
        riskReminder: {
          factRisk: "需要核验。",
          sourceRisk: "来源可靠。",
          titleRisk: "标题克制。",
          needsManualCheck: true
        },
        shouldPublishToday: true,
        publishRecommendationReason: "可以进入人工确认。",
        approvalRequired: true,
        nextStep: "Read the 10 shortlisted source URLs, then edit inputs/editorial-approval.json."
      }
    })
  } as any;
}

test("cron generate brief rejects missing Authorization header", async () => {
  let called = false;
  const response = await handleCronGenerateBrief(new Request("http://localhost/api/cron/generate-brief", {
    method: "POST"
  }), {
    env: { CRON_SECRET: "cron-secret" },
    generate: async () => {
      called = true;
      return { status: "created" };
    }
  });

  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("cron generate brief accepts correct CRON_SECRET", async () => {
  let called = false;
  const response = await handleCronGenerateBrief(new Request("http://localhost/api/cron/generate-brief", {
    method: "POST",
    headers: {
      Authorization: "Bearer cron-secret"
    }
  }), {
    env: { CRON_SECRET: "cron-secret" },
    generate: async () => {
      called = true;
      return { status: "created" };
    }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(called, true);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "created");
});

test("cloud brief generation returns already_exists for successful same-day run", async () => {
  const db = new MemoryBriefDb([
    {
      id: "run-existing",
      runDate: "2026-06-02",
      runType: EDITORIAL_BRIEF_RUN_TYPE,
      status: "success",
      startedAt: "2026-06-02T00:00:00.000Z",
      finishedAt: "2026-06-02T00:01:00.000Z",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:01:00.000Z"
    }
  ]);
  const r2 = new MemoryR2();
  const result = await generateCloudEditorialBrief({
    db,
    r2,
    now: new Date("2026-06-02T00:00:00.000Z"),
    runDate: "2026-06-02",
    pipeline: {
      collectNewsWithReport: async () => {
        throw new Error("pipeline should not run");
      }
    } as any
  });

  assert.equal(result.status, "already_exists");
  assert.equal(db.runs.length, 1);
  assert.equal(r2.uploads.length, 0);
});

test("cloud brief generation writes run, 10 shortlisted items, editorial brief, and R2 report", async () => {
  const db = new MemoryBriefDb();
  const r2 = new MemoryR2();
  const result = await generateCloudEditorialBrief({
    db,
    r2,
    now: new Date("2026-06-02T00:00:00.000Z"),
    runDate: "2026-06-02",
    pipeline: fakePipeline()
  });

  assert.equal(result.status, "created");
  assert.equal(db.ensured, true);
  assert.equal(db.runs.length, 1);
  assert.equal(db.runs[0].status, "success");
  assert.equal(db.newsItems.length, 20);
  assert.equal(db.shortlistedItems.length, 10);
  assert.equal(db.briefs.length, 1);
  assert.equal(db.briefs[0].reportR2Key, "reports/2026-06-02/editorial-brief.md");
  assert.equal(r2.uploads.length, 1);
  assert.equal(r2.uploads[0].key, "reports/2026-06-02/editorial-brief.md");
});

test("today cloud brief returns 10 shortlistedItems", async () => {
  const db = new MemoryBriefDb();
  const r2 = new MemoryR2();
  await generateCloudEditorialBrief({
    db,
    r2,
    now: new Date("2026-06-02T00:00:00.000Z"),
    runDate: "2026-06-02",
    pipeline: fakePipeline()
  });

  const payload = await getTodayEditorialBrief({
    db,
    runDate: "2026-06-02"
  });

  assert.equal(payload.run?.status, "success");
  assert.equal(payload.brief?.recommendedTitle, "AI news 1");
  assert.equal(payload.shortlistedItems.length, 10);
});

test("cloud brief UI empty state uses friendly prompt and not missing", async () => {
  const source = await readFile("apps/dashboard/components/cloud-brief-view.tsx", "utf8");

  assert.match(source, /今日简报尚未生成。请等待 7 点定时任务，或手动触发生成。/);
  assert.doesNotMatch(source, /missing/i);
});

test("cloud brief code does not call WeChat APIs or publish endpoints", async () => {
  const files = await Promise.all([
    readFile("src/pipeline/generateCloudEditorialBrief.ts", "utf8"),
    readFile("apps/dashboard/app/api/cron/generate-brief/route.ts", "utf8"),
    readFile("apps/dashboard/lib/cron-generate-brief.ts", "utf8")
  ]);
  const source = files.join("\n");

  assert.doesNotMatch(source, /wechatOfficialApi|saveWechatDraft|freepublish|mass|sendall|api\.weixin\.qq\.com|\/publish/i);
  assert.doesNotMatch(source, /群发|确认发送|立即发送/);
});

test("cloud secret keys are redacted from API payloads", () => {
  const payload = redactJson({
    DATABASE_URL: "postgres://user:database-secret@example.neon.tech/db",
    R2_SECRET_ACCESS_KEY: "r2-secret-value",
    CRON_SECRET: "cron-secret-value",
    nested: {
      AUTH_SECRET: "auth-secret-value"
    }
  });

  assert.equal(payload.DATABASE_URL, "[REDACTED]");
  assert.equal(payload.R2_SECRET_ACCESS_KEY, "[REDACTED]");
  assert.equal(payload.CRON_SECRET, "[REDACTED]");
  assert.equal(payload.nested.AUTH_SECRET, "[REDACTED]");
});
