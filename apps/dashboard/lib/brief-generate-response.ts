import { collectKnownSecretValues, redactSecrets } from "@/lib/redaction";

const DEFAULT_FAILURE_MESSAGE = "Brief generation failed.";
const MAX_ERROR_MESSAGE_LENGTH = 300;

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}

export function sanitizeBriefGenerationErrorMessage(
  error: unknown,
  env: NodeJS.ProcessEnv
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = redactSensitiveKeyNames(redactSecrets(raw, collectKnownSecretValues(env)))
    .replace(/\s+/g, " ")
    .trim();

  if (!redacted) {
    return DEFAULT_FAILURE_MESSAGE;
  }

  return redacted.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`
    : redacted;
}

function redactSensitiveKeyNames(input: string): string {
  return input
    .replace(/\bDATABASE_URL\b/g, "database credential")
    .replace(/\bR2_SECRET_ACCESS_KEY\b/g, "R2 credential")
    .replace(/\bCRON_SECRET\b/g, "cron credential")
    .replace(/\b[A-Z0-9_]*API_KEY[A-Z0-9_]*\b/g, "API credential")
    .replace(/\b[A-Z0-9_]*(?:APP_SECRET|ACCESS_TOKEN|ACCESS_KEY_ID|ACCESS_KEY)\b/g, "credential");
}
