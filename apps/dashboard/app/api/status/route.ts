import { NextResponse } from "next/server";
import { getDashboardStatus } from "@/lib/dashboard-data";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function GET() {
  const status = await getDashboardStatus();
  return NextResponse.json(redactJson(status));
}
