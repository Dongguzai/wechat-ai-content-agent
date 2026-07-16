import postgres, { type Sql } from "postgres";
import type {
  CloudEditorialBriefRecord,
  CloudNewsItemRecord,
  CloudRunRecord,
  CloudRunStatus,
  CloudRunType,
  CloudShortlistedItemRecord,
  CloudTopicSelectionRecord,
  ArticleGenerationStepRecord,
  ArticleGenerationStage,
  ArticleGenerationTaskRecord,
  TodayBriefPayload
} from "../types/cloud.js";

export interface EditorialBriefDbAdapter {
  ensureSchema(): Promise<void>;
  getSuccessfulRun(runDate: string, runType: CloudRunType): Promise<CloudRunRecord | undefined>;
  startRun(input: {
    id: string;
    runDate: string;
    runType: CloudRunType;
    startedAt: string;
  }): Promise<CloudRunRecord>;
  clearRunArtifacts(runId: string): Promise<void>;
  insertNewsItems(items: CloudNewsItemRecord[]): Promise<CloudNewsItemRecord[]>;
  insertShortlistedItems(items: CloudShortlistedItemRecord[]): Promise<CloudShortlistedItemRecord[]>;
  insertEditorialBrief(brief: CloudEditorialBriefRecord): Promise<CloudEditorialBriefRecord>;
  saveTopicSelection(selection: {
    id: string;
    runId: string;
    selectedShortlistedItemId: string;
    approvedTitle: string;
    approvalNotes: string;
    approvalJson: unknown;
    handoffJson: unknown;
    createdAt: string;
  }): Promise<CloudTopicSelectionRecord>;
  createArticleGenerationTask(input: {
    id: string;
    topicSelectionId: string;
    runId: string;
    selectedTopicId: string;
    approvedTitle: string;
    status: "queued";
    currentStage: ArticleGenerationStage;
    progress: number;
    message: string;
    createdAt: string;
  }): Promise<ArticleGenerationTaskRecord>;
  getArticleGenerationTask(taskId: string): Promise<ArticleGenerationTaskRecord | undefined>;
  getTopicSelectionById(topicSelectionId: string): Promise<CloudTopicSelectionRecord | undefined>;
  getActiveArticleGenerationTaskByTopicSelection(
    topicSelectionId: string
  ): Promise<ArticleGenerationTaskRecord | undefined>;
  claimNextArticleGenerationTask(input: {
    workerId: string;
    claimedAt: string;
  }): Promise<ArticleGenerationTaskRecord | undefined>;
  getArticleGenerationSteps(taskId: string): Promise<ArticleGenerationStepRecord[]>;
  startArticleGenerationStep(input: {
    id: string;
    taskId: string;
    stage: ArticleGenerationStage;
    attempt: number;
    message: string;
    inputJson?: unknown;
    startedAt: string;
  }): Promise<ArticleGenerationStepRecord>;
  completeArticleGenerationStep(input: {
    taskId: string;
    stage: ArticleGenerationStage;
    attempt: number;
    message: string;
    outputJson?: unknown;
    finishedAt: string;
  }): Promise<ArticleGenerationStepRecord | undefined>;
  failArticleGenerationStep(input: {
    taskId: string;
    stage: ArticleGenerationStage;
    attempt: number;
    status?: "failed" | "cancelled";
    message: string;
    errorMessage?: string;
    finishedAt: string;
  }): Promise<ArticleGenerationStepRecord | undefined>;
  completeTopicAnalysisAndRequeue(input: {
    taskId: string;
    workerId: string;
    completedAt: string;
    message: string;
  }): Promise<ArticleGenerationTaskRecord | undefined>;
  failArticleGenerationTask(input: {
    taskId: string;
    workerId: string;
    failedAt: string;
    message: string;
    errorMessage: string;
  }): Promise<ArticleGenerationTaskRecord | undefined>;
  recoverStaleArticleGenerationTasks(input: {
    staleBefore: string;
    recoveredAt: string;
  }): Promise<{ requeued: number; failed: number }>;
  cancelArticleGenerationTask(input: {
    taskId: string;
    cancelledAt: string;
    message: string;
  }): Promise<ArticleGenerationTaskRecord | undefined>;
  markRunSuccess(runId: string, finishedAt: string): Promise<CloudRunRecord>;
  markRunFailed(runId: string, finishedAt: string, error: string): Promise<CloudRunRecord>;
  getTodayBrief(runDate: string, runType: CloudRunType): Promise<TodayBriefPayload>;
}

function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";

  if (!databaseUrl) {
    throw new Error("Neon adapter requires DATABASE_URL.");
  }

  return databaseUrl;
}

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function optionalIso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  return iso(value);
}

function dateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function toTimestamp(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toRun(row: Record<string, unknown>): CloudRunRecord {
  return {
    id: String(row.id),
    runDate: dateString(row.run_date),
    runType: row.run_type as CloudRunType,
    status: row.status as CloudRunStatus,
    startedAt: iso(row.started_at),
    finishedAt: optionalIso(row.finished_at),
    error: row.error ? String(row.error) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toNewsItem(row: Record<string, unknown>): CloudNewsItemRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    title: String(row.title),
    url: String(row.url),
    sourceName: String(row.source_name),
    sourceType: String(row.source_type),
    provider: row.provider ? String(row.provider) : undefined,
    query: row.query ? String(row.query) : undefined,
    summary: String(row.summary),
    publishedAt: optionalIso(row.published_at),
    fetchedAt: iso(row.fetched_at),
    score: Number(row.score),
    rawJson: row.raw_json,
    createdAt: iso(row.created_at)
  };
}

function toShortlistedItem(row: Record<string, unknown>): CloudShortlistedItemRecord {
  const rawJson = isRecord(row.news_raw_json) ? row.news_raw_json : {};

  return {
    id: String(row.id),
    runId: String(row.run_id),
    newsItemId: String(row.news_item_id),
    rank: Number(row.rank),
    title: String(row.title),
    rawTitle: optionalString(rawJson.rawTitle),
    titleZh: optionalString(rawJson.titleZh) ?? String(row.title),
    url: String(row.url),
    sourceName: String(row.source_name),
    sourceType: String(row.source_type),
    provider: row.provider ? String(row.provider) : undefined,
    query: row.query ? String(row.query) : undefined,
    category: String(row.category),
    tags: asStringArray(row.tags),
    summary: String(row.summary),
    rawSummary: optionalString(rawJson.rawSummary),
    summaryZh: optionalString(rawJson.summaryZh) ?? String(row.summary),
    topicAngle: String(row.topic_angle),
    topicAngleZh: optionalString(rawJson.topicAngleZh) ?? String(row.topic_angle),
    shortlistReason: String(row.shortlist_reason),
    shortlistReasonZh: optionalString(rawJson.shortlistReasonZh) ?? String(row.shortlist_reason),
    shortlistScore: Number(row.shortlist_score),
    riskNotes: asStringArray(row.risk_notes),
    riskNotesZh: asStringArray(rawJson.riskNotesZh),
    sourceLanguage:
      rawJson.sourceLanguage === "zh" ||
      rawJson.sourceLanguage === "en" ||
      rawJson.sourceLanguage === "unknown"
        ? rawJson.sourceLanguage
        : undefined,
    localized: typeof rawJson.localized === "boolean" ? rawJson.localized : undefined,
    createdAt: iso(row.created_at)
  };
}

function toBrief(row: Record<string, unknown>): CloudEditorialBriefRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    recommendedTopicId: String(row.recommended_topic_id),
    recommendedTitle: String(row.recommended_title),
    recommendedUrl: String(row.recommended_url),
    recommendationReason: String(row.recommendation_reason),
    coreConflict: String(row.core_conflict),
    writingAngle: String(row.writing_angle),
    articleThesis: String(row.article_thesis),
    sourceReliability: String(row.source_reliability),
    riskNotes: asStringArray(row.risk_notes),
    shouldPublishToday: Boolean(row.should_publish_today),
    publishRecommendationReason: String(row.publish_recommendation_reason),
    reportR2Key: row.report_r2_key ? String(row.report_r2_key) : undefined,
    createdAt: iso(row.created_at)
  };
}

function toTopicSelection(row: Record<string, unknown>): CloudTopicSelectionRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    selectedShortlistedItemId: String(row.selected_shortlisted_item_id),
    approvedTitle: String(row.approved_title),
    approvalNotes: String(row.approval_notes ?? ""),
    approvalJson: row.approval_json,
    handoffJson: row.handoff_json as CloudTopicSelectionRecord["handoffJson"],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toArticleGenerationTask(row: Record<string, unknown>): ArticleGenerationTaskRecord {
  return {
    id: String(row.id),
    topicSelectionId: String(row.topic_selection_id),
    runId: String(row.run_id),
    selectedTopicId: String(row.selected_topic_id),
    approvedTitle: String(row.approved_title),
    status: row.status as ArticleGenerationTaskRecord["status"],
    currentStage: String(row.current_stage) as ArticleGenerationTaskRecord["currentStage"],
    progress: Number(row.progress),
    message: String(row.message),
    attempt: Number(row.attempt ?? 0),
    maxAttempts: Number(row.max_attempts ?? 2),
    lockedBy: row.locked_by ? String(row.locked_by) : undefined,
    lockedAt: optionalIso(row.locked_at),
    startedAt: optionalIso(row.started_at),
    finishedAt: optionalIso(row.finished_at),
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    cancelledAt: optionalIso(row.cancelled_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toArticleGenerationStep(row: Record<string, unknown>): ArticleGenerationStepRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    stage: String(row.stage) as ArticleGenerationStepRecord["stage"],
    status: String(row.status) as ArticleGenerationStepRecord["status"],
    attempt: Number(row.attempt),
    message: String(row.message),
    inputJson: row.input_json ?? undefined,
    outputJson: row.output_json ?? undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    startedAt: optionalIso(row.started_at),
    finishedAt: optionalIso(row.finished_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export function createNeonDbAdapter(env: NodeJS.ProcessEnv = process.env): EditorialBriefDbAdapter {
  const sql = postgres(readDatabaseUrl(env), {
    max: Number(env.DATABASE_MAX_CONNECTIONS ?? 1),
    ssl: "require",
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    onnotice: () => undefined
  });

  return createPostgresEditorialBriefAdapter(sql);
}

export function createPostgresEditorialBriefAdapter(sql: Sql): EditorialBriefDbAdapter {
  return {
    async ensureSchema() {
      await sql`
        create table if not exists runs (
          id text primary key,
          run_date date not null,
          run_type text not null,
          status text not null,
          started_at timestamptz not null,
          finished_at timestamptz,
          error text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (run_date, run_type)
        )
      `;
      await sql`
        create table if not exists news_items (
          id text primary key,
          run_id text not null references runs(id) on delete cascade,
          title text not null,
          url text not null,
          source_name text not null,
          source_type text not null,
          provider text,
          query text,
          summary text not null,
          published_at timestamptz,
          fetched_at timestamptz not null,
          score double precision not null,
          raw_json jsonb not null,
          created_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists shortlisted_items (
          id text primary key,
          run_id text not null references runs(id) on delete cascade,
          news_item_id text not null references news_items(id) on delete cascade,
          rank integer not null,
          title text not null,
          url text not null,
          source_name text not null,
          source_type text not null,
          provider text,
          query text,
          category text not null,
          tags jsonb not null,
          summary text not null,
          topic_angle text not null,
          shortlist_reason text not null,
          shortlist_score double precision not null,
          risk_notes jsonb not null,
          created_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists editorial_briefs (
          id text primary key,
          run_id text not null references runs(id) on delete cascade,
          recommended_topic_id text not null references shortlisted_items(id) on delete restrict,
          recommended_title text not null,
          recommended_url text not null,
          recommendation_reason text not null,
          core_conflict text not null,
          writing_angle text not null,
          article_thesis text not null,
          source_reliability text not null,
          risk_notes jsonb not null,
          should_publish_today boolean not null,
          publish_recommendation_reason text not null,
          report_r2_key text,
          created_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists topic_selections (
          id text primary key,
          run_id text not null references runs(id) on delete cascade,
          selected_shortlisted_item_id text not null references shortlisted_items(id) on delete restrict,
          approved_title text not null,
          approval_notes text not null,
          approval_json jsonb not null,
          handoff_json jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists article_generation_tasks (
          id text primary key,
          topic_selection_id text not null references topic_selections(id) on update cascade on delete cascade,
          run_id text not null references runs(id) on delete cascade,
          selected_topic_id text not null,
          approved_title text not null,
          status text not null check (status in ('queued', 'running', 'success', 'failed', 'cancelled')),
          current_stage text not null check (
            current_stage in (
              'waiting_for_worker',
              'topic_analysis',
              'research',
              'fact_pack',
              'outline',
              'writing',
              'title',
              'review',
              'completed'
            )
          ),
          progress integer not null default 0 check (progress >= 0 and progress <= 100),
          message text not null,
          attempt integer not null default 0,
          max_attempts integer not null default 2,
          locked_by text,
          locked_at timestamptz,
          started_at timestamptz,
          finished_at timestamptz,
          error_message text,
          cancelled_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`alter table article_generation_tasks add column if not exists attempt integer not null default 0`;
      await sql`alter table article_generation_tasks add column if not exists max_attempts integer not null default 2`;
      await sql`alter table article_generation_tasks add column if not exists locked_by text`;
      await sql`alter table article_generation_tasks add column if not exists locked_at timestamptz`;
      await sql`alter table article_generation_tasks add column if not exists started_at timestamptz`;
      await sql`alter table article_generation_tasks add column if not exists finished_at timestamptz`;
      await sql`
        create table if not exists article_generation_steps (
          id text primary key,
          task_id text not null references article_generation_tasks(id) on delete cascade,
          stage text not null,
          status text not null check (status in ('queued', 'running', 'success', 'failed', 'cancelled', 'skipped')),
          attempt integer not null default 1,
          message text not null,
          input_json jsonb,
          output_json jsonb,
          error_message text,
          started_at timestamptz,
          finished_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (task_id, stage, attempt)
        )
      `;
      await sql`create index if not exists news_items_run_id_idx on news_items(run_id)`;
      await sql`create index if not exists shortlisted_items_run_id_rank_idx on shortlisted_items(run_id, rank)`;
      await sql`create index if not exists editorial_briefs_run_id_idx on editorial_briefs(run_id)`;
      await sql`create unique index if not exists topic_selections_run_id_idx on topic_selections(run_id)`;
      await sql`create index if not exists article_generation_tasks_topic_selection_id_idx on article_generation_tasks(topic_selection_id)`;
      await sql`create index if not exists article_generation_tasks_run_id_idx on article_generation_tasks(run_id)`;
      await sql`create index if not exists article_generation_tasks_status_updated_at_idx on article_generation_tasks(status, updated_at)`;
      await sql`create index if not exists article_generation_tasks_claim_idx on article_generation_tasks(status, current_stage, created_at)`;
      await sql`create index if not exists article_generation_tasks_locked_idx on article_generation_tasks(status, locked_at)`;
      await sql`create index if not exists article_generation_steps_task_created_idx on article_generation_steps(task_id, created_at)`;
      await sql`
        create unique index if not exists article_generation_tasks_active_topic_idx
        on article_generation_tasks(run_id, selected_topic_id)
        where status in ('queued', 'running', 'success')
      `;
    },

    async getSuccessfulRun(runDate, runType) {
      const rows = await sql`
        select * from runs
        where run_date = ${runDate}::date
          and run_type = ${runType}
          and status = 'success'
        limit 1
      `;
      return rows[0] ? toRun(rows[0]) : undefined;
    },

    async startRun(input) {
      const rows = await sql`
        insert into runs (
          id, run_date, run_type, status, started_at, finished_at, error, created_at, updated_at
        )
        values (
          ${input.id}, ${input.runDate}::date, ${input.runType}, 'running',
          ${new Date(input.startedAt)}, null, null, ${new Date(input.startedAt)}, ${new Date(input.startedAt)}
        )
        on conflict (run_date, run_type) do update set
          status = 'running',
          started_at = excluded.started_at,
          finished_at = null,
          error = null,
          updated_at = excluded.updated_at
        returning *
      `;
      return toRun(rows[0]);
    },

    async clearRunArtifacts(runId) {
      await sql`delete from editorial_briefs where run_id = ${runId}`;
      await sql`delete from shortlisted_items where run_id = ${runId}`;
      await sql`delete from news_items where run_id = ${runId}`;
    },

    async insertNewsItems(items) {
      for (const item of items) {
        await sql`
          insert into news_items (
            id, run_id, title, url, source_name, source_type, provider, query, summary,
            published_at, fetched_at, score, raw_json, created_at
          )
          values (
            ${item.id}, ${item.runId}, ${item.title}, ${item.url}, ${item.sourceName},
            ${item.sourceType}, ${item.provider ?? null}, ${item.query ?? null}, ${item.summary},
            ${toTimestamp(item.publishedAt)}, ${new Date(item.fetchedAt)}, ${item.score},
            ${sql.json(item.rawJson as never)}, ${new Date(item.createdAt)}
          )
        `;
      }
      return items;
    },

    async insertShortlistedItems(items) {
      for (const item of items) {
        await sql`
          insert into shortlisted_items (
            id, run_id, news_item_id, rank, title, url, source_name, source_type,
            provider, query, category, tags, summary, topic_angle, shortlist_reason,
            shortlist_score, risk_notes, created_at
          )
          values (
            ${item.id}, ${item.runId}, ${item.newsItemId}, ${item.rank}, ${item.title},
            ${item.url}, ${item.sourceName}, ${item.sourceType}, ${item.provider ?? null},
            ${item.query ?? null}, ${item.category}, ${sql.json(item.tags)}, ${item.summary},
            ${item.topicAngle}, ${item.shortlistReason}, ${item.shortlistScore},
            ${sql.json(item.riskNotes)}, ${new Date(item.createdAt)}
          )
        `;
      }
      return items;
    },

    async insertEditorialBrief(brief) {
      const rows = await sql`
        insert into editorial_briefs (
          id, run_id, recommended_topic_id, recommended_title, recommended_url,
          recommendation_reason, core_conflict, writing_angle, article_thesis,
          source_reliability, risk_notes, should_publish_today,
          publish_recommendation_reason, report_r2_key, created_at
        )
        values (
          ${brief.id}, ${brief.runId}, ${brief.recommendedTopicId}, ${brief.recommendedTitle},
          ${brief.recommendedUrl}, ${brief.recommendationReason}, ${brief.coreConflict},
          ${brief.writingAngle}, ${brief.articleThesis}, ${brief.sourceReliability},
          ${sql.json(brief.riskNotes)}, ${brief.shouldPublishToday},
          ${brief.publishRecommendationReason}, ${brief.reportR2Key ?? null}, ${new Date(brief.createdAt)}
        )
        returning *
      `;
      return toBrief(rows[0]);
    },

    async saveTopicSelection(selection) {
      const rows = await sql`
        insert into topic_selections (
          id, run_id, selected_shortlisted_item_id, approved_title, approval_notes,
          approval_json, handoff_json, created_at, updated_at
        )
        values (
          ${selection.id}, ${selection.runId}, ${selection.selectedShortlistedItemId},
          ${selection.approvedTitle}, ${selection.approvalNotes},
          ${sql.json(selection.approvalJson as never)}, ${sql.json(selection.handoffJson as never)},
          ${new Date(selection.createdAt)}, ${new Date(selection.createdAt)}
        )
        on conflict (run_id) do update set
          id = excluded.id,
          selected_shortlisted_item_id = excluded.selected_shortlisted_item_id,
          approved_title = excluded.approved_title,
          approval_notes = excluded.approval_notes,
          approval_json = excluded.approval_json,
          handoff_json = excluded.handoff_json,
          updated_at = excluded.updated_at
        returning *
      `;
      return toTopicSelection(rows[0]);
    },

    async createArticleGenerationTask(input) {
      const existingRows = await sql`
        select * from article_generation_tasks
        where run_id = ${input.runId}
          and selected_topic_id = ${input.selectedTopicId}
          and status in ('queued', 'running', 'success')
        order by created_at desc
        limit 1
      `;
      if (existingRows[0]) {
        return toArticleGenerationTask(existingRows[0]);
      }

      try {
        const rows = await sql`
          insert into article_generation_tasks (
            id, topic_selection_id, run_id, selected_topic_id, approved_title,
            status, current_stage, progress, message, error_message, cancelled_at,
            created_at, updated_at
          )
          values (
            ${input.id}, ${input.topicSelectionId}, ${input.runId},
            ${input.selectedTopicId}, ${input.approvedTitle}, ${input.status},
            ${input.currentStage}, ${input.progress}, ${input.message}, null, null,
            ${new Date(input.createdAt)}, ${new Date(input.createdAt)}
          )
          returning *
        `;
        return toArticleGenerationTask(rows[0]);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const rows = await sql`
          select * from article_generation_tasks
          where run_id = ${input.runId}
            and selected_topic_id = ${input.selectedTopicId}
            and status in ('queued', 'running', 'success')
          order by created_at desc
          limit 1
        `;
        if (!rows[0]) {
          throw error;
        }
        return toArticleGenerationTask(rows[0]);
      }
    },

    async getArticleGenerationTask(taskId) {
      const rows = await sql`
        select * from article_generation_tasks
        where id = ${taskId}
        limit 1
      `;
      return rows[0] ? toArticleGenerationTask(rows[0]) : undefined;
    },

    async getTopicSelectionById(topicSelectionId) {
      const rows = await sql`
        select * from topic_selections
        where id = ${topicSelectionId}
        limit 1
      `;
      return rows[0] ? toTopicSelection(rows[0]) : undefined;
    },

    async getActiveArticleGenerationTaskByTopicSelection(topicSelectionId) {
      const rows = await sql`
        select * from article_generation_tasks
        where topic_selection_id = ${topicSelectionId}
          and status in ('queued', 'running', 'success')
        order by updated_at desc
        limit 1
      `;
      return rows[0] ? toArticleGenerationTask(rows[0]) : undefined;
    },

    async claimNextArticleGenerationTask(input) {
      const rows = await sql`
        with next_task as (
          select id
          from article_generation_tasks
          where status = 'queued'
            and current_stage = 'waiting_for_worker'
          order by created_at asc
          for update skip locked
          limit 1
        )
        update article_generation_tasks
        set status = 'running',
            current_stage = 'topic_analysis',
            progress = 5,
            message = '正在分析选题',
            attempt = attempt + 1,
            locked_by = ${input.workerId},
            locked_at = ${new Date(input.claimedAt)},
            started_at = coalesce(started_at, ${new Date(input.claimedAt)}),
            updated_at = ${new Date(input.claimedAt)}
        from next_task
        where article_generation_tasks.id = next_task.id
        returning article_generation_tasks.*
      `;
      return rows[0] ? toArticleGenerationTask(rows[0]) : undefined;
    },

    async getArticleGenerationSteps(taskId) {
      const rows = await sql`
        select * from article_generation_steps
        where task_id = ${taskId}
        order by created_at asc, stage asc, attempt asc
      `;
      return rows.map((row) => toArticleGenerationStep(row));
    },

    async startArticleGenerationStep(input) {
      const rows = await sql`
        insert into article_generation_steps (
          id, task_id, stage, status, attempt, message, input_json, output_json,
          error_message, started_at, finished_at, created_at, updated_at
        )
        values (
          ${input.id}, ${input.taskId}, ${input.stage}, 'running', ${input.attempt},
          ${input.message}, ${sql.json((input.inputJson ?? null) as never)}, null,
          null, ${new Date(input.startedAt)}, null, ${new Date(input.startedAt)}, ${new Date(input.startedAt)}
        )
        on conflict (task_id, stage, attempt) do update set
          status = 'running',
          message = excluded.message,
          input_json = excluded.input_json,
          output_json = null,
          error_message = null,
          started_at = excluded.started_at,
          finished_at = null,
          updated_at = excluded.updated_at
        returning *
      `;
      return toArticleGenerationStep(rows[0]);
    },

    async completeArticleGenerationStep(input) {
      const rows = await sql`
        update article_generation_steps
        set status = 'success',
            message = ${input.message},
            output_json = ${sql.json((input.outputJson ?? null) as never)},
            error_message = null,
            finished_at = ${new Date(input.finishedAt)},
            updated_at = ${new Date(input.finishedAt)}
        where task_id = ${input.taskId}
          and stage = ${input.stage}
          and attempt = ${input.attempt}
          and status = 'running'
        returning *
      `;
      return rows[0] ? toArticleGenerationStep(rows[0]) : undefined;
    },

    async failArticleGenerationStep(input) {
      const status = input.status ?? "failed";
      const rows = await sql`
        update article_generation_steps
        set status = ${status},
            message = ${input.message},
            error_message = ${input.errorMessage ?? null},
            finished_at = ${new Date(input.finishedAt)},
            updated_at = ${new Date(input.finishedAt)}
        where task_id = ${input.taskId}
          and stage = ${input.stage}
          and attempt = ${input.attempt}
          and status = 'running'
        returning *
      `;
      return rows[0] ? toArticleGenerationStep(rows[0]) : undefined;
    },

    async completeTopicAnalysisAndRequeue(input) {
      const rows = await sql`
        update article_generation_tasks
        set status = 'queued',
            current_stage = 'research',
            progress = 15,
            message = ${input.message},
            error_message = null,
            locked_by = null,
            locked_at = null,
            updated_at = ${new Date(input.completedAt)}
        where id = ${input.taskId}
          and status = 'running'
          and current_stage = 'topic_analysis'
          and locked_by = ${input.workerId}
        returning *
      `;
      return rows[0] ? toArticleGenerationTask(rows[0]) : undefined;
    },

    async failArticleGenerationTask(input) {
      const rows = await sql`
        update article_generation_tasks
        set status = 'failed',
            current_stage = 'topic_analysis',
            message = ${input.message},
            error_message = ${input.errorMessage},
            finished_at = ${new Date(input.failedAt)},
            locked_by = null,
            locked_at = null,
            updated_at = ${new Date(input.failedAt)}
        where id = ${input.taskId}
          and status = 'running'
          and current_stage = 'topic_analysis'
          and locked_by = ${input.workerId}
        returning *
      `;
      return rows[0] ? toArticleGenerationTask(rows[0]) : undefined;
    },

    async recoverStaleArticleGenerationTasks(input) {
      const requeuedRows = await sql`
        update article_generation_tasks
        set status = 'queued',
            current_stage = 'waiting_for_worker',
            message = '上次执行中断，已重新排队',
            locked_by = null,
            locked_at = null,
            updated_at = ${new Date(input.recoveredAt)}
        where status = 'running'
          and current_stage = 'topic_analysis'
          and locked_at < ${new Date(input.staleBefore)}
          and attempt < max_attempts
        returning id
      `;
      const failedRows = await sql`
        update article_generation_tasks
        set status = 'failed',
            message = 'Worker 多次中断，任务已停止',
            error_message = '超过最大自动恢复次数',
            finished_at = ${new Date(input.recoveredAt)},
            locked_by = null,
            locked_at = null,
            updated_at = ${new Date(input.recoveredAt)}
        where status = 'running'
          and current_stage = 'topic_analysis'
          and locked_at < ${new Date(input.staleBefore)}
          and attempt >= max_attempts
        returning id
      `;
      return { requeued: requeuedRows.length, failed: failedRows.length };
    },

    async cancelArticleGenerationTask(input) {
      const rows = await sql`
        update article_generation_tasks
        set status = 'cancelled',
            message = ${input.message},
            cancelled_at = ${new Date(input.cancelledAt)},
            updated_at = ${new Date(input.cancelledAt)}
        where id = ${input.taskId}
          and status in ('queued', 'running')
          and (
            (status = 'queued' and current_stage = 'waiting_for_worker')
            or (status = 'running' and current_stage = 'topic_analysis')
          )
        returning *
      `;
      if (rows[0]) {
        return toArticleGenerationTask(rows[0]);
      }

      const currentRows = await sql`
        select * from article_generation_tasks
        where id = ${input.taskId}
        limit 1
      `;
      const current = currentRows[0] ? toArticleGenerationTask(currentRows[0]) : undefined;
      if (!current) {
        return undefined;
      }
      if (current.status === "cancelled") {
        return current;
      }
      if (current.status === "success" || current.status === "failed") {
        throw new Error(
          `Article generation task cannot be cancelled from status ${current.status}.`
        );
      }

      throw new Error(
        `Article generation task could not be cancelled from status ${current.status} and stage ${current.currentStage}.`
      );
    },

    async markRunSuccess(runId, finishedAt) {
      const rows = await sql`
        update runs
        set status = 'success',
            finished_at = ${new Date(finishedAt)},
            error = null,
            updated_at = ${new Date(finishedAt)}
        where id = ${runId}
        returning *
      `;
      return toRun(rows[0]);
    },

    async markRunFailed(runId, finishedAt, error) {
      const rows = await sql`
        update runs
        set status = 'failed',
            finished_at = ${new Date(finishedAt)},
            error = ${error},
            updated_at = ${new Date(finishedAt)}
        where id = ${runId}
        returning *
      `;
      return toRun(rows[0]);
    },

    async getTodayBrief(runDate, runType) {
      const runRows = await sql`
        select * from runs
        where run_date = ${runDate}::date
          and run_type = ${runType}
          and status = 'success'
        limit 1
      `;
      const run = runRows[0] ? toRun(runRows[0]) : null;
      if (!run) {
        return { run: null, brief: null, shortlistedItems: [] };
      }

      const [briefRows, shortlistedRows, topicSelectionRows] = await Promise.all([
        sql`select * from editorial_briefs where run_id = ${run.id} order by created_at desc limit 1`,
        sql`
          select shortlisted_items.*, news_items.raw_json as news_raw_json
          from shortlisted_items
          left join news_items on news_items.id = shortlisted_items.news_item_id
          where shortlisted_items.run_id = ${run.id}
          order by shortlisted_items.rank asc
        `,
        sql`
          select * from topic_selections
          where run_id = ${run.id}
          order by updated_at desc
          limit 1
        `
      ]);

      return {
        run,
        brief: briefRows[0] ? toBrief(briefRows[0]) : null,
        shortlistedItems: shortlistedRows.map((row) => toShortlistedItem(row)),
        topicSelection: topicSelectionRows[0] ? toTopicSelection(topicSelectionRows[0]) : null
      };
    }
  };
}
