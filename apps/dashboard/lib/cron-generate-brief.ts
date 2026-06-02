import { NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/auth";
import { generateCloudBriefForToday } from "@/lib/cloud-brief-server";
import { redactJson } from "@/lib/redaction";

export interface CronGenerateBriefHandlerOptions {
  env?: NodeJS.ProcessEnv;
  generate?: () => Promise<unknown>;
}

export async function handleCronGenerateBrief(
  request: Request,
  options: CronGenerateBriefHandlerOptions = {}
) {
  const env = options.env ?? process.env;
  const cronSecret = env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 }
    );
  }

  if (!verifyBearerToken(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await (options.generate ?? (() => generateCloudBriefForToday(env)))();
    return NextResponse.json(redactJson({ ok: true, ...asObject(result) }));
  } catch (error) {
    return NextResponse.json(
      redactJson({
        ok: false,
        error: error instanceof Error ? error.message : "Brief generation failed."
      }),
      { status: 500 }
    );
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}
