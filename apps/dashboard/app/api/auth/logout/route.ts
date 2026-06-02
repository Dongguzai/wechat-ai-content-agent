import { NextResponse } from "next/server";
import { clearDashboardSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearDashboardSessionCookie(response);
  return response;
}
