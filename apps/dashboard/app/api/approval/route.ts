import { NextResponse } from "next/server";
import { saveApproval } from "@/lib/forms";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveApproval(body);
    return NextResponse.json(redactJson({ ok: true, ...result }));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Approval save failed."
      },
      { status: 400 }
    );
  }
}
