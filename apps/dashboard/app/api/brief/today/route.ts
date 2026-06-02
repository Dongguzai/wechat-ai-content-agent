import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getCloudBriefForToday } from "@/lib/cloud-brief-server";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function GET() {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const payload = await getCloudBriefForToday();
    return NextResponse.json(redactJson(payload));
  } catch (error) {
    return NextResponse.json(
      redactJson({
        run: null,
        brief: null,
        shortlistedItems: [],
        error: error instanceof Error ? error.message : "Today brief lookup failed."
      }),
      { status: 503 }
    );
  }
}
