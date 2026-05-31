import type {
  LlmChatCompletionResult,
  LlmMode,
  LlmProvider,
  LlmRunMetadata,
  LlmUsage
} from "../types/llm.js";

export type LlmStage = "article-writer" | "title-generator" | "article-reviewer";

export interface LlmStageConfig {
  stage: LlmStage;
  provider: LlmProvider;
  model: string;
  mode: "mock" | "real";
  temperature: number;
  maxCompletionTokens: number;
}

const defaultProvider: LlmProvider = "minimax";
const defaultModel = "MiniMax-M2.7";
const defaultTemperature = 0.75;
const defaultMaxCompletionTokens = 2048;

const stageProviderEnv: Record<LlmStage, string> = {
  "article-writer": "ARTICLE_WRITER_PROVIDER",
  "title-generator": "TITLE_GENERATOR_PROVIDER",
  "article-reviewer": "ARTICLE_REVIEWER_PROVIDER"
};

const stageModelEnv: Record<LlmStage, string> = {
  "article-writer": "ARTICLE_WRITER_MODEL",
  "title-generator": "TITLE_GENERATOR_MODEL",
  "article-reviewer": "ARTICLE_REVIEWER_MODEL"
};

const nullUsage: LlmUsage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null
};

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function envNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number
): number {
  const rawValue = envValue(env, name);
  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }

  return value;
}

function isExplicitTrue(env: NodeJS.ProcessEnv, name: string): boolean {
  return envValue(env, name) === "true";
}

function isExplicitFalse(env: NodeJS.ProcessEnv, name: string): boolean {
  return envValue(env, name) === "false";
}

function resolveProvider(env: NodeJS.ProcessEnv, stage: LlmStage): LlmProvider {
  const provider =
    envValue(env, stageProviderEnv[stage]) ??
    envValue(env, "LLM_PROVIDER") ??
    defaultProvider;

  if (provider !== "minimax") {
    throw new Error(`Unsupported LLM provider "${provider}". Only minimax is configured.`);
  }

  return provider;
}

export function resolveLlmStageConfig(
  stage: LlmStage,
  env: NodeJS.ProcessEnv = process.env
): LlmStageConfig {
  const provider = resolveProvider(env, stage);
  const model =
    envValue(env, stageModelEnv[stage]) ??
    envValue(env, "MINIMAX_MODEL") ??
    defaultModel;
  const realEnabled = isExplicitTrue(env, "LLM_ENABLE_REAL_API");
  const dryRun = envValue(env, "LLM_DRY_RUN")
    ? !isExplicitFalse(env, "LLM_DRY_RUN")
    : !realEnabled;

  return {
    stage,
    provider,
    model,
    mode: realEnabled && !dryRun ? "real" : "mock",
    temperature: envNumber(env, "MINIMAX_TEMPERATURE", defaultTemperature),
    maxCompletionTokens: envNumber(
      env,
      "MINIMAX_MAX_COMPLETION_TOKENS",
      defaultMaxCompletionTokens
    )
  };
}

export function mockLlmMetadata(config: LlmStageConfig): LlmRunMetadata {
  return {
    provider: config.provider,
    model: config.model,
    mode: "mock",
    usage: { ...nullUsage }
  };
}

export function realLlmMetadata(
  completion: LlmChatCompletionResult,
  mode: Exclude<LlmMode, "mock"> = "real"
): LlmRunMetadata {
  return {
    provider: completion.provider,
    model: completion.model,
    mode,
    usage: completion.usage
  };
}

export function formatLlmUsage(usage: LlmUsage): string {
  return [
    `promptTokens=${usage.promptTokens ?? "unknown"}`,
    `completionTokens=${usage.completionTokens ?? "unknown"}`,
    `totalTokens=${usage.totalTokens ?? "unknown"}`
  ].join(", ");
}
