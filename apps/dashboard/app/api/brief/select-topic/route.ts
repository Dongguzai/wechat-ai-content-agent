import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { createCloudBriefServices } from "@/lib/cloud-brief-server";
import { selectBriefTopic } from "@/lib/editor-workflow";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const body = await request.json();
    const isCloudBriefSelection =
      body && typeof body === "object" && !Array.isArray(body) && body.source === "cloud-brief";
    const result = await selectBriefTopic(
      body,
      isCloudBriefSelection
        ? { db: createCloudBriefServices().db, env: process.env }
        : {}
    );
    return NextResponse.json(redactJson({ ok: true, ...result }));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Topic selection failed."
      },
      { status: 400 }
    );
  }
}
