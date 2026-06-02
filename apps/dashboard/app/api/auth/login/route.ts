import { NextResponse } from "next/server";
import {
  createDashboardSessionToken,
  isDashboardAuthConfigured,
  setDashboardSessionCookie,
  verifyDashboardPassword
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isDashboardAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Dashboard auth is not configured." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";

  if (!verifyDashboardPassword(password)) {
    return NextResponse.json({ ok: false, error: "密码不正确。" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  setDashboardSessionCookie(response, createDashboardSessionToken());
  return response;
}
