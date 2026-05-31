export type LlmProvider = "minimax";

export type LlmMode = "mock" | "real" | "rules+real";

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface LlmRunMetadata {
  provider: LlmProvider;
  model: string;
  mode: LlmMode;
  usage: LlmUsage;
}

export type LlmChatMessageRole = "system" | "user" | "assistant";

export interface LlmChatMessage {
  role: LlmChatMessageRole;
  content: string;
}

export type LlmFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface LlmChatCompletionInput {
  model?: string;
  messages?: LlmChatMessage[];
  systemPrompt?: string;
  userPrompt?: string;
  temperature?: number;
  maxCompletionTokens?: number;
  responseFormat?: "json_object";
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
}

export interface LlmChatCompletionResult {
  provider: LlmProvider;
  model: string;
  content: string;
  usage: LlmUsage;
  finishReason: string | null;
  generatedAt: string;
}

export type LlmChatCompletionClient = (
  input: LlmChatCompletionInput
) => Promise<LlmChatCompletionResult>;
