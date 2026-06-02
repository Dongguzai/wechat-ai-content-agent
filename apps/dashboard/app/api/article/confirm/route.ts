import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { confirmArticleAndReview } from "@/lib/editor-workflow";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const body = await request.json();
    const result = await confirmArticleAndReview(body);
    const status = result.next ? 200 : 409;
    return NextResponse.json(redactJson({ ok: Boolean(result.next), ...result }), { status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Article confirmation failed."
      },
      { status: 400 }
    );
  }
}
