import { NextResponse } from "next/server";
import { getSettingsStatus } from "@/lib/dashboard-data";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getSettingsStatus());
}
