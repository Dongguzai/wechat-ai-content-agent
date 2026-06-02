import postgres, { type Sql } from "postgres";
import type {
  CloudEditorialBriefRecord,
  CloudNewsItemRecord,
  CloudRunRecord,
  CloudRunStatus,
  CloudRunType,
  CloudShortlistedItemRecord,
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
  return {
    id: String(row.id),
    runId: String(row.run_id),
    newsItemId: String(row.news_item_id),
    rank: Number(row.rank),
    title: String(row.title),
    url: String(row.url),
    sourceName: String(row.source_name),
    sourceType: String(row.source_type),
    provider: row.provider ? String(row.provider) : undefined,
    query: row.query ? String(row.query) : undefined,
    category: String(row.category),
    tags: asStringArray(row.tags),
    summary: String(row.summary),
    topicAngle: String(row.topic_angle),
    shortlistReason: String(row.shortlist_reason),
    shortlistScore: Number(row.shortlist_score),
    riskNotes: asStringArray(row.risk_notes),
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
      await sql`create index if not exists news_items_run_id_idx on news_items(run_id)`;
      await sql`create index if not exists shortlisted_items_run_id_rank_idx on shortlisted_items(run_id, rank)`;
      await sql`create index if not exists editorial_briefs_run_id_idx on editorial_briefs(run_id)`;
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

      const [briefRows, shortlistedRows] = await Promise.all([
        sql`select * from editorial_briefs where run_id = ${run.id} order by created_at desc limit 1`,
        sql`select * from shortlisted_items where run_id = ${run.id} order by rank asc`
      ]);

      return {
        run,
        brief: briefRows[0] ? toBrief(briefRows[0]) : null,
        shortlistedItems: shortlistedRows.map((row) => toShortlistedItem(row))
      };
    }
  };
}
