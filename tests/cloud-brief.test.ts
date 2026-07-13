import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { handleCronGenerateBrief } from "../apps/dashboard/lib/cron-generate-brief";
import { handleManualGenerateBrief } from "../apps/dashboard/lib/manual-generate-brief";
import { handleR2Health } from "../apps/dashboard/lib/r2-health";
import { redactJson } from "../apps/dashboard/lib/redaction";
import type { EditorialBriefDbAdapter } from "../src/adapters/neon";
import {
  createR2S3ClientConfig,
  getR2ConfigDiagnostics,
  resolveR2AdapterConfig,
  R2_UPLOAD_ENDPOINT_HINT,
  R2_UPLOAD_FAILURE_HINT,
  type R2StorageAdapter,
  type R2UploadInput
} from "../src/adapters/r2";
import { validateCloudBriefEnv } from "../src/config/cloudEnv";
import {
  CloudBriefStepError,
  generateCloudEditorialBrief,
  getCloudBriefGenerationStep,
  getTodayEditorialBrief
} from "../src/pipeline/generateCloudEditorialBrief";
import {
  EDITORIAL_BRIEF_RUN_TYPE,
  type CloudBriefGenerationStep,
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

const validR2AccountId = "abcdef1234567890abcdef1234567890";
const validR2AccountIdUpper = "ABCDEF1234567890ABCDEF1234567890";

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

class FailingR2 implements R2StorageAdapter {
  async putText(_input: R2UploadInput): Promise<never> {
    throw new Error(
      `write EPROTO R2_SECRET_ACCESS_KEY r2-secret-key getaddrinfo ENOTFOUND ${validR2AccountId}.r2.cloudflarestorage.com SSL/TLS handshake failure`
    );
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

function fakePipeline(candidateCount = 20) {
  const candidates = Array.from({ length: candidateCount }, (_, index) => candidate(index + 1));
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
        candidateCount,
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

test("R2 adapter upload endpoint is derived from R2_ACCOUNT_ID only", () => {
  const env = {
    R2_ACCOUNT_ID: validR2AccountId,
    R2_ACCESS_KEY_ID: "r2-access-key",
    R2_SECRET_ACCESS_KEY: "r2-secret-key",
    R2_BUCKET: "briefs",
    R2_PUBLIC_BASE_URL: "https://cdn.example.com/briefs"
  };
  const config = resolveR2AdapterConfig(env);

  assert.equal(config.endpoint, `https://${validR2AccountId}.r2.cloudflarestorage.com`);
  assert.notEqual(config.endpoint, env.R2_PUBLIC_BASE_URL);
  assert.notEqual(config.endpoint, `https://briefs.${validR2AccountId}.r2.cloudflarestorage.com`);
});

test("R2 adapter ignores R2_PUBLIC_BASE_URL for upload endpoint", () => {
  const config = resolveR2AdapterConfig({
    R2_ACCOUNT_ID: validR2AccountId,
    R2_ACCESS_KEY_ID: "r2-access-key",
    R2_SECRET_ACCESS_KEY: "r2-secret-key",
    R2_BUCKET: "briefs",
    R2_PUBLIC_BASE_URL: "https://public.example.com/briefs"
  });

  assert.equal(config.endpoint, `https://${validR2AccountId}.r2.cloudflarestorage.com`);
  assert.equal(config.publicBaseUrl, "https://public.example.com/briefs");
  assert.notEqual(config.endpoint, config.publicBaseUrl);
});

test("R2 S3Client config uses region auto and forcePathStyle true", () => {
  const config = resolveR2AdapterConfig({
    R2_ACCOUNT_ID: validR2AccountId,
    R2_ACCESS_KEY_ID: "r2-access-key",
    R2_SECRET_ACCESS_KEY: "r2-secret-key",
    R2_BUCKET: "briefs"
  });
  const clientConfig = createR2S3ClientConfig(config);

  assert.equal(clientConfig.region, "auto");
  assert.equal(clientConfig.endpoint, `https://${validR2AccountId}.r2.cloudflarestorage.com`);
  assert.equal(clientConfig.forcePathStyle, true);
  assert.deepEqual(clientConfig.credentials, {
    accessKeyId: "r2-access-key",
    secretAccessKey: "r2-secret-key"
  });
});

test("R2 diagnostics returns masked config only", () => {
  const config = getR2ConfigDiagnostics({
    R2_ACCOUNT_ID: validR2AccountId,
    R2_ACCESS_KEY_ID: "r2-access-key-value",
    R2_SECRET_ACCESS_KEY: "r2-secret-key-value",
    R2_BUCKET: "briefs",
    R2_PUBLIC_BASE_URL: "https://cdn.example.com/briefs"
  });
  const serialized = JSON.stringify(config);

  assert.equal(config.hasAccountId, true);
  assert.equal(config.accountIdPreview, "abcdef***7890");
  assert.equal(config.endpointHost, "abcdef***7890.r2.cloudflarestorage.com");
  assert.equal(config.hasAccessKeyId, true);
  assert.equal(config.hasSecretAccessKey, true);
  assert.equal(config.bucket, "briefs");
  assert.equal(config.hasPublicBaseUrl, true);
  assert.doesNotMatch(serialized, new RegExp(`r2-access-key-value|r2-secret-key-value|${validR2AccountId}`));
});

test("/api/health/r2 writes a minimal object and returns masked config", async () => {
  const r2 = new MemoryR2();
  const response = await handleR2Health({
    env: {
      R2_ACCOUNT_ID: validR2AccountId,
      R2_ACCESS_KEY_ID: "r2-access-key-value",
      R2_SECRET_ACCESS_KEY: "r2-secret-key-value",
      R2_BUCKET: "briefs",
      R2_PUBLIC_BASE_URL: "https://cdn.example.com/briefs"
    },
    now: new Date("2026-06-02T00:00:00.000Z"),
    r2
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.step, "r2.putObject");
  assert.equal(payload.message, "R2 write succeeded");
  assert.equal(payload.config.accountIdPreview, "abcdef***7890");
  assert.equal(payload.config.endpointHost, "abcdef***7890.r2.cloudflarestorage.com");
  assert.equal(r2.uploads.length, 1);
  assert.equal(r2.uploads[0].key, "health-check/2026-06-02T00-00-00-000Z.txt");
  assert.equal(r2.uploads[0].body, "ok");
  assert.doesNotMatch(serialized, /r2-secret-key-value|R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(serialized, /r2-access-key-value|R2_ACCESS_KEY_ID/);
});

test("/api/health/r2 failure returns endpoint hint without secrets", async () => {
  const response = await handleR2Health({
    env: {
      R2_ACCOUNT_ID: validR2AccountIdUpper,
      R2_ACCESS_KEY_ID: "r2-access-key",
      R2_SECRET_ACCESS_KEY: "r2-secret-key",
      R2_BUCKET: "briefs"
    },
    r2: new FailingR2()
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.step, "r2.putObject");
  assert.equal(payload.endpointHint, R2_UPLOAD_ENDPOINT_HINT);
  assert.match(payload.error, /SSL\/TLS handshake failure/);
  assert.doesNotMatch(serialized, new RegExp(validR2AccountId));
  assert.doesNotMatch(serialized, new RegExp(validR2AccountIdUpper));
  assert.doesNotMatch(serialized, /r2-secret-key|R2_SECRET_ACCESS_KEY/);
});

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

test("cron generate brief returns failed step and redacted short error", async () => {
  const response = await handleCronGenerateBrief(new Request("http://localhost/api/cron/generate-brief", {
    method: "POST",
    headers: {
      Authorization: "Bearer cron-secret"
    }
  }), {
    env: {
      CRON_SECRET: "cron-secret",
      DATABASE_URL: "postgres://user:database-secret@example.neon.tech/db",
      CUSTOM_API_KEY: "custom-api-key-secret"
    },
    generate: async () => {
      throw new CloudBriefStepError(
        "db.connect",
        new Error(
          "write EPROTO DATABASE_URL R2_SECRET_ACCESS_KEY CRON_SECRET CUSTOM_API_KEY postgres://user:database-secret@example.neon.tech/db custom-api-key-secret SSL/TLS handshake failure"
        )
      );
    }
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.step, "db.connect");
  assert.match(payload.error, /SSL\/TLS handshake failure/);
  assert.doesNotMatch(
    serialized,
    /DATABASE_URL|R2_SECRET_ACCESS_KEY|CRON_SECRET|CUSTOM_API_KEY|database-secret|custom-api-key-secret|cron-secret/
  );
});

test("cron generate brief validates cloud env before external adapters", async () => {
  const response = await handleCronGenerateBrief(new Request("http://localhost/api/cron/generate-brief", {
    method: "POST",
    headers: {
      Authorization: "Bearer cron-secret"
    }
  }), {
    env: {
      CRON_SECRET: "cron-secret",
      DATABASE_URL: "https://neon.example.com/dashboard",
      R2_ACCOUNT_ID: validR2AccountId,
      R2_ACCESS_KEY_ID: "r2-access-key",
      R2_SECRET_ACCESS_KEY: "r2-secret-key",
      R2_BUCKET: "briefs"
    }
  });
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.step, "config.validate");
  assert.match(payload.error, /Cloud brief env invalid/);
  assert.match(payload.error, /postgres/);
});

test("manual generate brief rejects unauthenticated dashboard users", async () => {
  let called = false;
  const response = await handleManualGenerateBrief(
    new Request("http://localhost/api/brief/generate", {
      method: "POST"
    }),
    {
      isAuthorized: async () => false,
      generate: async () => {
        called = true;
        return { status: "created" };
      }
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.ok, false);
  assert.equal(payload.step, "auth");
  assert.equal(called, false);
});

test("manual generate brief uses dashboard auth and does not require CRON_SECRET", async () => {
  let receivedForce: boolean | undefined;
  const response = await handleManualGenerateBrief(
    new Request("http://localhost/api/brief/generate", {
      method: "POST"
    }),
    {
      env: {},
      isAuthorized: async () => true,
      generate: async ({ force }) => {
        receivedForce = force;
        return { status: "created" };
      }
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "created");
  assert.equal(receivedForce, false);
});

test("manual generate brief passes force true for dashboard reruns", async () => {
  let receivedForce = false;
  const response = await handleManualGenerateBrief(
    new Request("http://localhost/api/brief/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true })
    }),
    {
      isAuthorized: async () => true,
      generate: async ({ force }) => {
        receivedForce = force;
        return { status: "created" };
      }
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(receivedForce, true);
});

test("manual generate brief returns failed step and redacted error summary", async () => {
  const response = await handleManualGenerateBrief(
    new Request("http://localhost/api/brief/generate", {
      method: "POST"
    }),
    {
      env: {
        DATABASE_URL: "postgres://user:database-secret@example.neon.tech/db",
        R2_SECRET_ACCESS_KEY: "r2-secret-key",
        CUSTOM_API_KEY: "custom-api-key-secret"
      },
      isAuthorized: async () => true,
      generate: async () => {
        throw new CloudBriefStepError(
          "db.connect",
          new Error(
            "write EPROTO DATABASE_URL R2_SECRET_ACCESS_KEY CUSTOM_API_KEY postgres://user:database-secret@example.neon.tech/db r2-secret-key custom-api-key-secret"
          )
        );
      }
    }
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.step, "db.connect");
  assert.match(payload.error, /write EPROTO/);
  assert.doesNotMatch(
    serialized,
    /DATABASE_URL|R2_SECRET_ACCESS_KEY|CUSTOM_API_KEY|database-secret|r2-secret-key|custom-api-key-secret/
  );
});

test("generate brief returns R2 upload step and endpoint hint on R2 upload failure", async () => {
  const response = await handleManualGenerateBrief(
    new Request("http://localhost/api/brief/generate", {
      method: "POST"
    }),
    {
      env: {
        R2_ACCOUNT_ID: validR2AccountIdUpper,
        R2_ACCESS_KEY_ID: "r2-access-key-value",
        R2_SECRET_ACCESS_KEY: "r2-secret-key-value"
      },
      isAuthorized: async () => true,
      generate: async () => {
        throw new CloudBriefStepError(
          "r2.uploadBriefReport",
          new Error(
            `write EPROTO r2-access-key-value r2-secret-key-value getaddrinfo ENOTFOUND ${validR2AccountId}.r2.cloudflarestorage.com SSL/TLS handshake failure`
          )
        );
      }
    }
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.step, "r2.uploadBriefReport");
  assert.match(payload.error, /SSL\/TLS handshake failure/);
  assert.equal(payload.hint, R2_UPLOAD_FAILURE_HINT);
  assert.equal(payload.endpointHint, R2_UPLOAD_ENDPOINT_HINT);
  assert.doesNotMatch(serialized, new RegExp(validR2AccountId));
  assert.doesNotMatch(serialized, new RegExp(validR2AccountIdUpper));
  assert.doesNotMatch(serialized, /r2-access-key-value|r2-secret-key-value/);
});

test("cloud brief env requires R2_ACCOUNT_ID and ignores R2_ENDPOINT for uploads", () => {
  const baseEnv = {
    DATABASE_URL: "postgresql://user:password@example.neon.tech/db?sslmode=require",
    R2_ACCESS_KEY_ID: "r2-access-key",
    R2_SECRET_ACCESS_KEY: "r2-secret-key",
    R2_BUCKET: "briefs"
  };

  const missingAccountId = validateCloudBriefEnv({
    ...baseEnv,
    R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com"
  });
  assert.equal(missingAccountId.ok, false);
  assert.match(missingAccountId.errors.join(" "), /R2_ACCOUNT_ID/);

  const valid = validateCloudBriefEnv({
    ...baseEnv,
    R2_ACCOUNT_ID: validR2AccountId,
    R2_ENDPOINT: "this old value is ignored"
  });
  assert.equal(valid.ok, true);
  assert.match(valid.warnings.join(" "), /R2_ENDPOINT is ignored/);

  const invalid = validateCloudBriefEnv({
    ...baseEnv,
    R2_ACCOUNT_ID: "https://account-id.r2.cloudflarestorage.com"
  });

  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /R2_ACCOUNT_ID/);
});

test("cloud brief env rejects API tokens in R2_ACCOUNT_ID", () => {
  const result = validateCloudBriefEnv({
    DATABASE_URL: "postgresql://user:password@example.neon.tech/db?sslmode=require",
    R2_ACCOUNT_ID: "cfat_1234567890abcdef1234567890abcdef1234567890abc",
    R2_ACCESS_KEY_ID: "r2-access-key",
    R2_SECRET_ACCESS_KEY: "r2-secret-key",
    R2_BUCKET: "briefs"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /32-character hexadecimal Cloudflare account id/);
  assert.match(result.errors.join(" "), /not an API token/);
});

test("cloud brief env rejects pasted env lines in R2_BUCKET", () => {
  const result = validateCloudBriefEnv({
    DATABASE_URL: "postgresql://user:password@example.neon.tech/db?sslmode=require",
    R2_ACCOUNT_ID: validR2AccountId,
    R2_ACCESS_KEY_ID: "r2-access-key",
    R2_SECRET_ACCESS_KEY: "r2-secret-key",
    R2_BUCKET: "R2_ENDPOINT=https://abcdef1234567890abcdef1234567890.r2.cloudflarestorage.com"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /R2_BUCKET must be only the R2 bucket name/);
});

test("R2 adapter rejects endpoint values in R2_BUCKET before upload", () => {
  assert.throws(
    () =>
      resolveR2AdapterConfig({
        R2_ACCOUNT_ID: validR2AccountId,
        R2_ACCESS_KEY_ID: "r2-access-key",
        R2_SECRET_ACCESS_KEY: "r2-secret-key",
        R2_BUCKET: "https://abcdef1234567890abcdef1234567890.r2.cloudflarestorage.com"
      }),
    /R2_BUCKET must be only the R2 bucket name/
  );
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

test("cloud brief generation force rerun overwrites successful same-day run", async () => {
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
    force: true,
    pipeline: fakePipeline()
  });

  assert.equal(result.status, "created");
  assert.equal(db.runs.length, 1);
  assert.equal(db.runs[0].id, "run-existing");
  assert.equal(db.runs[0].status, "success");
  assert.equal(db.shortlistedItems.length, 10);
  assert.equal(r2.uploads.length, 1);
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

test("cloud brief generation continues when collection has fewer than 20 candidates", async () => {
  const db = new MemoryBriefDb();
  const r2 = new MemoryR2();
  const result = await generateCloudEditorialBrief({
    db,
    r2,
    now: new Date("2026-06-02T00:00:00.000Z"),
    runDate: "2026-06-02",
    pipeline: fakePipeline(19)
  });

  assert.equal(result.status, "created");
  assert.equal(db.runs[0].status, "success");
  assert.equal(db.newsItems.length, 19);
  assert.equal(db.shortlistedItems.length, 10);
  assert.equal(r2.uploads.length, 1);
});

test("cloud brief generation defaults collection to rules-based localization", async () => {
  const db = new MemoryBriefDb();
  const r2 = new MemoryR2();
  let receivedEnv: NodeJS.ProcessEnv | undefined;
  const pipeline = {
    ...fakePipeline(),
    collectNewsWithReport: async (options: { env?: NodeJS.ProcessEnv }) => {
      receivedEnv = options.env;
      return await fakePipeline().collectNewsWithReport();
    }
  };

  await generateCloudEditorialBrief({
    db,
    r2,
    env: {
      REAL_PRODUCTION_MODE: "true",
      LLM_ENABLE_REAL_API: "true",
      LLM_DRY_RUN: "false",
      MINIMAX_MODEL: "minimax-real-model"
    },
    now: new Date("2026-06-02T00:00:00.000Z"),
    runDate: "2026-06-02",
    pipeline
  });

  assert.equal(receivedEnv?.NEWS_LOCALIZER_FORCE_RULES, "true");
  assert.equal(receivedEnv?.LLM_DRY_RUN, "true");
});

test("cloud brief generation can opt into real collection localization", async () => {
  const db = new MemoryBriefDb();
  const r2 = new MemoryR2();
  let receivedEnv: NodeJS.ProcessEnv | undefined;
  const pipeline = {
    ...fakePipeline(),
    collectNewsWithReport: async (options: { env?: NodeJS.ProcessEnv }) => {
      receivedEnv = options.env;
      return await fakePipeline().collectNewsWithReport();
    }
  };

  await generateCloudEditorialBrief({
    db,
    r2,
    env: {
      CLOUD_BRIEF_REAL_LOCALIZATION: "true",
      LLM_ENABLE_REAL_API: "true",
      LLM_DRY_RUN: "false",
      MINIMAX_MODEL: "minimax-real-model"
    },
    now: new Date("2026-06-02T00:00:00.000Z"),
    runDate: "2026-06-02",
    pipeline
  });

  assert.equal(receivedEnv?.NEWS_LOCALIZER_FORCE_RULES, undefined);
  assert.equal(receivedEnv?.LLM_DRY_RUN, "false");
});

test("cloud brief generation reports step sequence on successful run", async () => {
  const db = new MemoryBriefDb();
  const r2 = new MemoryR2();
  const steps: CloudBriefGenerationStep[] = [];

  await generateCloudEditorialBrief({
    db,
    r2,
    now: new Date("2026-06-02T00:00:00.000Z"),
    runDate: "2026-06-02",
    pipeline: fakePipeline(),
    onStep: (step) => steps.push(step)
  });

  assert.deepEqual(steps, [
    "db.connect",
    "db.findExistingRun",
    "db.createRun",
    "collectNews",
    "shortlistNews",
    "selectTopic",
    "db.saveNewsItems",
    "db.saveShortlistedItems",
    "db.saveEditorialBrief",
    "r2.uploadBriefReport",
    "db.markRunSuccess"
  ]);
});

test("cloud brief generation marks failed run with failing step", async () => {
  const db = new MemoryBriefDb();
  const r2 = new MemoryR2();
  const steps: CloudBriefGenerationStep[] = [];

  await assert.rejects(
    () =>
      generateCloudEditorialBrief({
        db,
        r2,
        now: new Date("2026-06-02T00:00:00.000Z"),
        runDate: "2026-06-02",
        pipeline: {
          collectNewsWithReport: async () => {
            throw new Error("write EPROTO SSL/TLS handshake failure");
          }
        } as any,
        onStep: (step) => steps.push(step)
      }),
    (error) => {
      assert.equal(getCloudBriefGenerationStep(error), "collectNews");
      return true;
    }
  );

  assert.equal(db.runs[0].status, "failed");
  assert.equal(db.runs[0].error, "write EPROTO SSL/TLS handshake failure");
  assert.deepEqual(steps, [
    "db.connect",
    "db.findExistingRun",
    "db.createRun",
    "collectNews",
    "db.markRunFailed"
  ]);
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

test("R2 upload API routes force Node.js runtime", async () => {
  const files = await Promise.all([
    readFile("apps/dashboard/app/api/cron/generate-brief/route.ts", "utf8"),
    readFile("apps/dashboard/app/api/brief/generate/route.ts", "utf8"),
    readFile("apps/dashboard/app/api/health/r2/route.ts", "utf8")
  ]);

  for (const source of files) {
    assert.match(source, /export const runtime = "nodejs"/);
  }
});

test("cloud brief code does not call WeChat APIs or publish endpoints", async () => {
  const files = await Promise.all([
    readFile("src/pipeline/generateCloudEditorialBrief.ts", "utf8"),
    readFile("apps/dashboard/app/api/cron/generate-brief/route.ts", "utf8"),
    readFile("apps/dashboard/lib/cron-generate-brief.ts", "utf8"),
    readFile("apps/dashboard/app/api/brief/generate/route.ts", "utf8"),
    readFile("apps/dashboard/lib/manual-generate-brief.ts", "utf8"),
    readFile("apps/dashboard/app/api/health/r2/route.ts", "utf8"),
    readFile("apps/dashboard/lib/r2-health.ts", "utf8"),
    readFile("apps/dashboard/lib/brief-generate-response.ts", "utf8")
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
