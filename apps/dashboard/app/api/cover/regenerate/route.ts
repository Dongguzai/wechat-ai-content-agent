import { NextResponse } from "next/server";
import { regenerateCover } from "@/lib/editor-workflow";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await regenerateCover(body);
    return NextResponse.json(redactJson({ ok: true, ...result }));
  } catch (error) {
    return NextResponse.json(
      redactJson({
        ok: false,
        error: error instanceof Error ? error.message : "Cover regenerate failed."
      }),
      { status: 400 }
    );
  }
}
