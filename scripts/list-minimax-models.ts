import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadDotEnv,
  miniMaxDotEnvOverrideKeys
} from "../src/config/env.js";
import type { LlmFetch } from "../src/types/llm.js";

export interface MiniMaxModelsOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
}

export interface MiniMaxModelsCliOptions extends MiniMaxModelsOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

export interface MiniMaxModelsResult {
  baseUrl: string;
  modelsUrl: string;
  modelIds: string[];
  configuredModel: string | null;
  configuredModelAvailable: boolean | null;
}

const defaultBaseUrl = "https://api.minimaxi.com/v1";

const invalidApiKeyHints = [
  "检查按量计费 API Key 是否有效。",
  "检查国内站 key 是否使用 https://api.minimaxi.com/v1。",
  "检查国际站 key 是否使用 https://api.minimax.io/v1。",
  "检查 key 是否 active。"
];

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnvValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = envValue(env, name);

  if (!value) {
    throw new Error(`${name} is required for MiniMax models diagnostics.`);
  }

  return value;
}

function sanitizeSensitiveText(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) {
      return current;
    }

    return current.split(secret).join("[redacted]");
  }, text);
}

function responsePreview(text: string, secrets: string[]): string {
  return sanitizeSensitiveText(text.replace(/\s+/g, " ").trim(), secrets).slice(
    0,
    300
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJson(text: string, apiKey: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `MiniMax /models returned invalid JSON.${text.trim() ? ` Response body: ${responsePreview(text, [apiKey])}` : ""}`
    );
  }
}

function extractModelIds(payload: unknown): string[] {
  const record = asRecord(payload);
  const candidates = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(record?.models)
      ? record.models
      : Array.isArray(payload)
        ? payload
        : [];

  return [
    ...new Set(
      candidates
        .map((item) => {
          if (typeof item === "string") {
            return item.trim();
          }

          const model = asRecord(item);
          return typeof model?.id === "string" ? model.id.trim() : "";
        })
        .filter(Boolean)
    )
  ];
}

export function minimaxModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");

  if (path.endsWith("/models")) {
    url.pathname = path;
  } else if (path.endsWith("/chat/completions")) {
    url.pathname = `${path.slice(0, -"/chat/completions".length)}/models`;
  } else if (!path || path === "/") {
    url.pathname = "/models";
  } else {
    url.pathname = `${path}/models`;
  }

  return url.toString();
}

export async function runMiniMaxModels(
  options: MiniMaxModelsOptions = {}
): Promise<MiniMaxModelsResult> {
  const env = options.env ?? process.env;
  const apiKey = requiredEnvValue(env, "MINIMAX_API_KEY");
  const baseUrl = envValue(env, "MINIMAX_BASE_URL") ?? defaultBaseUrl;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("MiniMax models diagnostics requires a runtime with fetch support.");
  }

  let modelsUrl = "";
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
    modelsUrl = minimaxModelsUrl(baseUrl);
  } catch {
    throw new Error("MINIMAX_BASE_URL must be a valid http(s) URL.");
  }

  const response = await fetchImpl(modelsUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const text = await response.text();

  if (!response.ok) {
    const preview = responsePreview(text, [apiKey]);
    throw new Error(
      `MiniMax /models request failed with HTTP ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      }.${preview ? ` Response body: ${preview}` : ""}`
    );
  }

  const payload = parseJson(text, apiKey);
  const modelIds = extractModelIds(payload);
  const configuredModel = envValue(env, "MINIMAX_MODEL") ?? null;

  return {
    baseUrl,
    modelsUrl,
    modelIds,
    configuredModel,
    configuredModelAvailable: configuredModel
      ? modelIds.includes(configuredModel)
      : null
  };
}

export async function minimaxModelsCli(
  options: MiniMaxModelsCliOptions = {}
): Promise<number> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const knownSecrets = [envValue(env, "MINIMAX_API_KEY") ?? ""];

  try {
    const result = await runMiniMaxModels({
      env,
      fetchImpl: options.fetchImpl
    });

    stdout(`modelsUrl: ${result.modelsUrl}`);
    stdout(`model count: ${result.modelIds.length}`);

    if (result.modelIds.length === 0) {
      stdout("model ids: none returned");
    } else {
      stdout("model ids:");
      for (const modelId of result.modelIds) {
        stdout(`- ${modelId}`);
      }
    }

    if (
      result.configuredModel &&
      result.configuredModelAvailable === false
    ) {
      stderr(
        `[llm:minimax:models] warning: MINIMAX_MODEL=${result.configuredModel} was not found in /models response.`
      );
    }

    return 0;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Unknown error.";
    const safeMessage = sanitizeSensitiveText(rawMessage, knownSecrets);

    stderr(`[llm:minimax:models] blocked: ${safeMessage}`);

    if (/HTTP 401/i.test(safeMessage)) {
      stderr("[llm:minimax:models] MiniMax 401 Unauthorized 排查建议:");
      for (const hint of invalidApiKeyHints) {
        stderr(`- ${hint}`);
      }
    }

    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await loadDotEnv({ overrideKeys: [...miniMaxDotEnvOverrideKeys] });
  process.exitCode = await minimaxModelsCli();
}
