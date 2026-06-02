import { NextResponse } from "next/server";
import { executeDashboardAction } from "@/lib/actions";
import { requireApiSession } from "@/lib/auth";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const body = await request.json();
    const result = await executeDashboardAction(body?.action);
    const status = result.status === "rejected" ? 403 : 200;
    return NextResponse.json(redactJson(result), { status });
  } catch (error) {
    return NextResponse.json(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "Action failed."
      },
      { status: 500 }
    );
  }
}
