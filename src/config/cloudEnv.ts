export interface CloudBriefEnvValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const requiredCloudBriefEnvKeys = [
  "DATABASE_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET"
] as const;

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

function validateR2Endpoint(value: string, errors: string[], warnings: string[]): void {
  const parsed = parseUrl(value);

  if (!parsed) {
    errors.push("R2_ENDPOINT must be a valid URL.");
    return;
  }

  if (parsed.protocol !== "https:") {
    errors.push("R2_ENDPOINT must use https://.");
  }

  if (parsed.username || parsed.password) {
    errors.push("R2_ENDPOINT must not include credentials.");
  }

  if (parsed.pathname && parsed.pathname !== "/") {
    errors.push("R2_ENDPOINT must not include a path; put the bucket in R2_BUCKET.");
  }

  if (!parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
    warnings.push("R2_ENDPOINT should normally end with .r2.cloudflarestorage.com.");
  }
}

function validateR2AccountId(value: string, errors: string[]): void {
  if (/^https?:\/\//i.test(value) || value.includes("/") || value.includes(".")) {
    errors.push(
      "R2_ACCOUNT_ID must be only the Cloudflare account id; put the full S3 endpoint URL in R2_ENDPOINT."
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

  if (!r2Endpoint && !r2AccountId) {
    errors.push("R2_ENDPOINT or R2_ACCOUNT_ID is required for cloud brief generation.");
  }

  if (databaseUrl) {
    validateDatabaseUrl(databaseUrl, errors, warnings);
  }

  if (r2Endpoint) {
    validateR2Endpoint(r2Endpoint, errors, warnings);
  } else if (r2AccountId) {
    validateR2AccountId(r2AccountId, errors);
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
