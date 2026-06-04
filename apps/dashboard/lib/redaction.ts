const SECRET_KEY_PATTERN =
  /(app[_-]?secret|access[_-]?token|api[_-]?key|database[_-]?url|authorization|bearer|cookie|session|password|secret|token)/i;

const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(access_token|appsecret|app_secret|api_key|apikey|token|secret)\s*[:=]\s*["']?[^"',\s}]+/gi
];

const KNOWN_SECRET_ENV_KEYS = [
  "MINIMAX_API_KEY",
  "APIMART_API_KEY",
  "WECHAT_APP_SECRET",
  "WECHAT_ACCESS_TOKEN",
  "WECHAT_COVER_MEDIA_ID",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "CRON_SECRET",
  "DASHBOARD_PASSWORD",
  "AUTH_SECRET"
];

export function redactJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item)) as T;
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      redacted[key] = SECRET_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redactJson(nested);
    }
    return redacted as T;
  }

  if (typeof value === "string") {
    return redactSecrets(value) as T;
  }

  return value;
}

export function collectKnownSecretValues(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const values = new Set<string>();

  for (const key of KNOWN_SECRET_ENV_KEYS) {
    const value = env[key];
    if (value && value.length >= 6) {
      values.add(value);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (SECRET_KEY_PATTERN.test(key) && value && value.length >= 6) {
      values.add(value);
    }
  }

  return [...values];
}

export function redactSecrets(
  input: string,
  extraSecretValues: string[] = []
): string {
  let output = input;

  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, (match) => {
      const separator = match.includes(":") ? ":" : "=";
      const [key] = match.split(separator);
      return `${key}${separator}[REDACTED]`;
    });
  }

  for (const secretValue of [
    ...collectKnownSecretValues(),
    ...extraSecretValues.filter((value) => value.length >= 6)
  ]) {
    output = output.replace(new RegExp(escapeRegExp(secretValue), "gi"), "[REDACTED]");
  }

  return output;
}

export function hasSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
