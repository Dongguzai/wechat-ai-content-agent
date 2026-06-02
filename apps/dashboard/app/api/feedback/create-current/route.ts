import { NextResponse } from "next/server";
import { createCurrentFeedback } from "@/lib/editor-workflow";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await createCurrentFeedback();
    return NextResponse.json(redactJson({ ok: true, ...result }));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Current feedback creation failed."
      },
      { status: 400 }
    );
  }
}
