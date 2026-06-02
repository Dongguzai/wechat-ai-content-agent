import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createChatCompletion } from "../src/adapters/minimax.js";
import { formatLlmUsage } from "../src/adapters/llm.js";
import {
  loadDotEnv,
  miniMaxDotEnvOverrideKeys
} from "../src/config/env.js";
import type { LlmFetch, LlmUsage } from "../src/types/llm.js";

export interface MiniMaxSmokeOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
}

export interface MiniMaxSmokeCliOptions extends MiniMaxSmokeOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

export interface MiniMaxSmokeResult {
  provider: "minimax";
  model: string;
  contentPreview: string;
  usage?: LlmUsage;
}

const smokePrompt = "用一句中文说明 AI 编码代理是什么。";
const smokeMaxCompletionTokens = 80;
const smokeTemperature = 0.2;
const contentPreviewMaxLength = 120;
const invalidApiKeyHints = [
  "如果使用国际站 key，尝试 MINIMAX_BASE_URL=https://api.minimax.io/v1",
  "如果使用国内站 key，尝试 MINIMAX_BASE_URL=https://api.minimaxi.com/v1",
  "检查 Token Plan Key 和 Open Platform Key 是否混用",
  "检查 key 是否 active",
  "检查 .env 是否有中文引号、空格或复制错误"
];

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnvValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = envValue(env, name);

  if (!value) {
    throw new Error(`${name} is required for MiniMax smoke test.`);
  }

  return value;
}

function assertRealLlmEnabled(env: NodeJS.ProcessEnv): void {
  if (envValue(env, "LLM_ENABLE_REAL_API") !== "true") {
    throw new Error(
      "LLM_ENABLE_REAL_API=true is required for MiniMax smoke test."
    );
  }
}

function hasUsage(usage: LlmUsage): boolean {
  return (
    usage.promptTokens !== null ||
    usage.completionTokens !== null ||
    usage.totalTokens !== null
  );
}

function sanitizeSensitiveText(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) {
      return current;
    }

    return current.split(secret).join("[redacted]");
  }, text);
}

function contentPreview(content: string, secrets: string[]): string {
  const singleLine = sanitizeSensitiveText(
    content.replace(/\s+/g, " ").trim(),
    secrets
  );

  if (singleLine.length <= contentPreviewMaxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, contentPreviewMaxLength - 3)}...`;
}

function isMiniMaxInvalidApiKey2049(message: string): boolean {
  return (
    /HTTP 401/i.test(message) &&
    (/invalid api key/i.test(message) || /\b2049\b/.test(message))
  );
}

export async function runMiniMaxSmoke(
  options: MiniMaxSmokeOptions = {}
): Promise<MiniMaxSmokeResult> {
  const env = options.env ?? process.env;

  assertRealLlmEnabled(env);
  const apiKey = requiredEnvValue(env, "MINIMAX_API_KEY");

  const completion = await createChatCompletion({
    env,
    fetchImpl: options.fetchImpl,
    userPrompt: smokePrompt,
    temperature: smokeTemperature,
    maxCompletionTokens: smokeMaxCompletionTokens
  });

  return {
    provider: completion.provider,
    model: completion.model,
    contentPreview: contentPreview(completion.content, [apiKey]),
    ...(hasUsage(completion.usage) ? { usage: completion.usage } : {})
  };
}

export async function minimaxSmokeCli(
  options: MiniMaxSmokeCliOptions = {}
): Promise<number> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const knownSecrets = [envValue(env, "MINIMAX_API_KEY") ?? ""];

  try {
    const result = await runMiniMaxSmoke({
      env,
      fetchImpl: options.fetchImpl
    });

    stdout(`provider: ${result.provider}`);
    stdout(`model: ${result.model}`);
    stdout(`content preview: ${result.contentPreview}`);

    if (result.usage) {
      stdout(`usage: ${formatLlmUsage(result.usage)}`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    const safeMessage = sanitizeSensitiveText(message, knownSecrets);

    stderr(`[llm:minimax:smoke] blocked: ${safeMessage}`);

    if (isMiniMaxInvalidApiKey2049(safeMessage)) {
      stderr("[llm:minimax:smoke] MiniMax 401 invalid api key (2049) 排查建议:");
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
  process.exitCode = await minimaxSmokeCli();
}
