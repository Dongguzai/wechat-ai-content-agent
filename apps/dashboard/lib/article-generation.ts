import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { createCloudBriefServices } from "@/lib/cloud-brief-server";
import { redactJson } from "@/lib/redaction";
import type { EditorialBriefDbAdapter } from "../../../src/adapters/neon";
import type { ArticleGenerationStepRecord } from "../../../src/types/cloud";

interface ArticleGenerationHandlerOptions {
  db?: EditorialBriefDbAdapter;
  isAuthorized?: () => Promise<boolean>;
  now?: Date;
}

type SafeArticleGenerationStep = Omit<ArticleGenerationStepRecord, "inputJson" | "outputJson">;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0"
};

function withNoStoreHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(noStoreHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

function noStoreJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(noStoreHeaders)) {
    headers.set(key, value);
  }
  return NextResponse.json(body, { ...init, headers });
}

async function authorize(options: ArticleGenerationHandlerOptions): Promise<NextResponse | undefined> {
  if (options.isAuthorized) {
    return (await options.isAuthorized())
      ? undefined
      : noStoreJson({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const authError = await requireApiSession();
  return authError ? withNoStoreHeaders(authError) : undefined;
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

  try {
    const taskId = taskIdFromRequest(request);
    if (!taskId) {
      return noStoreJson({ ok: false, error: "id is required." }, { status: 400 });
    }

    const db = resolveDb(options);
    const task = await db.getArticleGenerationTask(taskId);
    if (!task) {
      return noStoreJson({ ok: false, error: "Article generation task not found." }, { status: 404 });
    }

    const steps = (await db.getArticleGenerationSteps(taskId)).map(toSafeStep);
    return noStoreJson(redactJson({ ok: true, task, steps }));
  } catch (error) {
    return noStoreJson(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Article generation status failed."
      },
      { status: 500 }
    );
  }
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

function toSafeStep(step: ArticleGenerationStepRecord): SafeArticleGenerationStep {
  const { inputJson: _inputJson, outputJson: _outputJson, ...safeStep } = step;
  return safeStep;
}
