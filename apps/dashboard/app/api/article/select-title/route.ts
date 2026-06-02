import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { selectArticleTitle } from "@/lib/editor-workflow";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const body = await request.json();
    const result = await selectArticleTitle(body);
    return NextResponse.json(redactJson({ ok: true, ...result }));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Title selection failed."
      },
      { status: 400 }
    );
  }
}
