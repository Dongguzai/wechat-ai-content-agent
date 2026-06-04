export interface CloudBriefEnvValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const requiredCloudBriefEnvKeys = [
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET"
] as const;
const r2AccountIdPattern = /^[a-f0-9]{32}$/i;

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function hasAnyValue(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.some((name) => Boolean(envValue(env, name)));
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function validateDatabaseUrl(value: string, errors: string[], warnings: string[]): void {
  const parsed = parseUrl(value);

  if (!parsed) {
    errors.push("DATABASE_URL must be a valid Postgres connection URL.");
    return;
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    errors.push("DATABASE_URL must use postgres:// or postgresql://, not an HTTP URL.");
    return;
  }

  if (!parsed.hostname) {
    errors.push("DATABASE_URL must include a database hostname.");
  }

  if (!parsed.username || !parsed.password) {
    warnings.push("DATABASE_URL should include username and password credentials.");
  }

  if (parsed.searchParams.get("sslmode") === "disable") {
    errors.push("DATABASE_URL must not set sslmode=disable for cloud brief generation.");
  }
}

function validatePositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[]
): void {
  const value = envValue(env, name);
  if (value && !/^[1-9]\d*$/.test(value)) {
    errors.push(`${name} must be a positive integer.`);
  }
}

function validateHttpUrlEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[]
): void {
  const value = envValue(env, name);
  if (!value) {
    return;
  }

  const parsed = parseUrl(value);
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    errors.push(`${name} must be a valid http(s) URL.`);
  }
}

function validateR2AccountId(value: string, errors: string[]): void {
  if (/^https?:\/\//i.test(value) || value.includes("/") || value.includes(".")) {
    errors.push(
      "R2_ACCOUNT_ID must be only the Cloudflare account id; upload endpoint is derived as https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com."
    );
  }

  if (!r2AccountIdPattern.test(value)) {
    errors.push(
      "R2_ACCOUNT_ID must be the 32-character hexadecimal Cloudflare account id, not an API token, access key, bucket name, URL, or public/custom domain."
    );
  }
}

export function validateCloudBriefEnv(
  env: NodeJS.ProcessEnv = process.env
): CloudBriefEnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const databaseUrl = envValue(env, "DATABASE_URL");
  const r2Endpoint = envValue(env, "R2_ENDPOINT");
  const r2AccountId = envValue(env, "R2_ACCOUNT_ID");
  const cloudIntent = hasAnyValue(env, [
    ...requiredCloudBriefEnvKeys,
    "R2_ENDPOINT",
    "R2_ACCOUNT_ID",
    "R2_PUBLIC_BASE_URL",
    "CRON_SECRET",
    "DASHBOARD_PASSWORD",
    "AUTH_SECRET"
  ]);

  if (!cloudIntent) {
    return { ok: true, errors, warnings };
  }

  for (const key of requiredCloudBriefEnvKeys) {
    if (!envValue(env, key)) {
      errors.push(`${key} is required for cloud brief generation.`);
    }
  }

  if (databaseUrl) {
    validateDatabaseUrl(databaseUrl, errors, warnings);
  }

  if (r2AccountId) {
    validateR2AccountId(r2AccountId, errors);
  }
  if (r2Endpoint) {
    warnings.push(
      "R2_ENDPOINT is ignored for uploads; the R2 adapter derives the S3 endpoint from R2_ACCOUNT_ID."
    );
  }

  validatePositiveIntegerEnv(env, "DATABASE_MAX_CONNECTIONS", errors);
  validateHttpUrlEnv(env, "R2_PUBLIC_BASE_URL", errors);

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

export function assertCloudBriefEnv(env: NodeJS.ProcessEnv = process.env): void {
  const result = validateCloudBriefEnv(env);

  if (!result.ok) {
    throw new Error(`Cloud brief env invalid: ${result.errors.join(" ")}`);
  }
}
