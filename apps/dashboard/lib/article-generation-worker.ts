import { NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/auth";
import { createCloudBriefServices } from "@/lib/cloud-brief-server";
import { redactJson } from "@/lib/redaction";
import type { EditorialBriefDbAdapter } from "../../../src/adapters/neon";
import { runArticleGenerationWorker } from "../../../src/workers/article-generation-worker";

export interface CronArticleWorkerHandlerOptions {
  db?: EditorialBriefDbAdapter;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  workerId?: string;
}

export async function handleCronArticleWorker(
  request: Request,
  options: CronArticleWorkerHandlerOptions = {}
) {
  const env = options.env ?? process.env;
  const cronSecret = env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Cron credential is not configured." },
      { status: 401 }
    );
  }

  if (!verifyBearerToken(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const db = options.db ?? createCloudBriefServices(env).db;
  const staleAfterSeconds = Number(env.ARTICLE_WORKER_STALE_AFTER_SECONDS ?? 600);

  try {
    await db.ensureSchema();
    const result = await runArticleGenerationWorker({
      db,
      workerId: options.workerId,
      now: options.now,
      staleAfterSeconds
    });
    return NextResponse.json(redactJson(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Article worker failed.";
    return NextResponse.json(
      redactJson({
        ok: false,
        status: "worker_error",
        error: message.replace(/\s+/g, " ").trim().slice(0, 500)
      }),
      { status: 500 }
    );
  }
}
