import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { createCloudBriefServices } from "@/lib/cloud-brief-server";
import { redactJson } from "@/lib/redaction";
import type { EditorialBriefDbAdapter } from "../../../src/adapters/neon";

interface ArticleGenerationHandlerOptions {
  db?: EditorialBriefDbAdapter;
  isAuthorized?: () => Promise<boolean>;
  now?: Date;
}

async function authorize(options: ArticleGenerationHandlerOptions): Promise<NextResponse | undefined> {
  if (options.isAuthorized) {
    return (await options.isAuthorized())
      ? undefined
      : NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  return await requireApiSession();
}

function resolveDb(options: ArticleGenerationHandlerOptions): EditorialBriefDbAdapter {
  return options.db ?? createCloudBriefServices().db;
}

function taskIdFromRequest(request: Request): string {
  return new URL(request.url).searchParams.get("id")?.trim() ?? "";
}

export async function handleArticleGenerationStatus(
  request: Request,
  options: ArticleGenerationHandlerOptions = {}
) {
  const authError = await authorize(options);
  if (authError) return authError;

  const taskId = taskIdFromRequest(request);
  if (!taskId) {
    return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  }

  const task = await resolveDb(options).getArticleGenerationTask(taskId);
  if (!task) {
    return NextResponse.json({ ok: false, error: "Article generation task not found." }, { status: 404 });
  }

  return NextResponse.json(redactJson({ ok: true, task }));
}

export async function handleArticleGenerationCancel(
  request: Request,
  options: ArticleGenerationHandlerOptions = {}
) {
  const authError = await authorize(options);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const taskId =
    body && typeof body === "object" && !Array.isArray(body) && typeof body.taskId === "string"
      ? body.taskId.trim()
      : "";
  if (!taskId) {
    return NextResponse.json({ ok: false, error: "taskId is required." }, { status: 400 });
  }

  const db = resolveDb(options);
  const task = await db.getArticleGenerationTask(taskId);
  if (!task) {
    return NextResponse.json({ ok: false, error: "Article generation task not found." }, { status: 404 });
  }

  if (task.status === "success" || task.status === "failed") {
    return NextResponse.json(
      { ok: false, error: `Task cannot be cancelled from status ${task.status}.` },
      { status: 409 }
    );
  }

  if (task.status === "cancelled") {
    return NextResponse.json(redactJson({ ok: true, task }));
  }

  const cancelled = await db.cancelArticleGenerationTask({
    taskId,
    cancelledAt: (options.now ?? new Date()).toISOString(),
    message: "任务已取消"
  });
  if (!cancelled) {
    return NextResponse.json({ ok: false, error: "Article generation task not found." }, { status: 404 });
  }

  return NextResponse.json(redactJson({ ok: true, task: cancelled }));
}
