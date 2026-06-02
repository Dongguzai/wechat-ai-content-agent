import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

export const DASHBOARD_SESSION_COOKIE = "wechat_agent_dashboard_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function readAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTH_SECRET?.trim() ?? "";
}

function readDashboardPassword(env: NodeJS.ProcessEnv = process.env): string {
  return env.DASHBOARD_PASSWORD?.trim() ?? "";
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isDashboardAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(readDashboardPassword(env) && readAuthSecret(env));
}

export function verifyDashboardPassword(
  password: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = readDashboardPassword(env);
  return Boolean(expected) && safeEqual(password, expected);
}

export function createDashboardSessionToken(
  issuedAt = Date.now(),
  env: NodeJS.ProcessEnv = process.env
): string {
  const secret = readAuthSecret(env);
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured.");
  }

  const payload = String(issuedAt);
  return `v1.${payload}.${hmac(`dashboard:${payload}`, secret)}`;
}

export function verifyDashboardSessionToken(
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const secret = readAuthSecret(env);
  if (!token || !secret) {
    return false;
  }

  const [version, issuedAt, signature] = token.split(".");
  if (version !== "v1" || !issuedAt || !signature) {
    return false;
  }

  const timestamp = Number(issuedAt);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  if (Date.now() - timestamp > SESSION_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  return safeEqual(signature, hmac(`dashboard:${issuedAt}`, secret));
}

export async function hasDashboardSession(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyDashboardSessionToken(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value, env);
}

export async function requireDashboardSession(nextPath = "/brief"): Promise<void> {
  if (await hasDashboardSession()) {
    return;
  }

  redirect(`/login?next=${encodeURIComponent(safeNextPath(nextPath))}`);
}

export async function requireApiSession(): Promise<NextResponse | undefined> {
  if (await hasDashboardSession()) {
    return undefined;
  }

  return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

export function setDashboardSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export function clearDashboardSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export function safeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/brief";
  }

  return value;
}

export function verifyBearerToken(
  authorizationHeader: string | null,
  expectedSecret: string | undefined
): boolean {
  const expected = expectedSecret?.trim() ?? "";
  const prefix = "Bearer ";
  const actual = authorizationHeader?.startsWith(prefix)
    ? authorizationHeader.slice(prefix.length).trim()
    : "";

  return Boolean(expected && actual) && safeEqual(actual, expected);
}
