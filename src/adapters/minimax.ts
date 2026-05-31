import type {
  LlmChatCompletionInput,
  LlmChatCompletionResult,
  LlmChatMessage,
  LlmFetch,
  LlmUsage
} from "../types/llm.js";

interface MiniMaxConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxCompletionTokens: number;
}

interface MiniMaxRequestBody {
  model: string;
  messages: LlmChatMessage[];
  temperature: number;
  max_completion_tokens: number;
  response_format?: {
    type: "json_object";
  };
}

interface MiniMaxResponsePreview {
  status: number;
  statusText: string;
  contentType: string;
  text: string;
}

const defaultBaseUrl = "https://api.minimaxi.com/v1";
const defaultModel = "MiniMax-M2.7";
const defaultTemperature = 0.75;
const defaultMaxCompletionTokens = 2048;

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

function resolveMiniMaxConfig(input: LlmChatCompletionInput): MiniMaxConfig {
  const env = input.env ?? process.env;
  const apiKey = envValue(env, "MINIMAX_API_KEY");
  const baseUrl = envValue(env, "MINIMAX_BASE_URL") ?? defaultBaseUrl;
  const model = input.model ?? envValue(env, "MINIMAX_MODEL") ?? defaultModel;
  const temperature =
    input.temperature ?? envNumber(env, "MINIMAX_TEMPERATURE", defaultTemperature);
  const maxCompletionTokens =
    input.maxCompletionTokens ??
    envNumber(
      env,
      "MINIMAX_MAX_COMPLETION_TOKENS",
      defaultMaxCompletionTokens
    );

  if (!apiKey) {
    throw new Error("MiniMax real API mode requires MINIMAX_API_KEY.");
  }

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("MINIMAX_BASE_URL must be a valid http(s) URL.");
  }

  if (temperature < 0 || temperature > 2) {
    throw new Error("MINIMAX_TEMPERATURE must be between 0 and 2.");
  }

  if (!Number.isInteger(maxCompletionTokens) || maxCompletionTokens <= 0) {
    throw new Error("MINIMAX_MAX_COMPLETION_TOKENS must be a positive integer.");
  }

  return {
    apiKey,
    baseUrl,
    model,
    temperature,
    maxCompletionTokens
  };
}

export function minimaxChatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");

  if (path.endsWith("/chat/completions")) {
    url.pathname = path;
  } else if (!path || path === "/") {
    url.pathname = "/chat/completions";
  } else {
    url.pathname = `${path}/chat/completions`;
  }

  return url.toString();
}

function createMessages(input: LlmChatCompletionInput): LlmChatMessage[] {
  if (input.messages) {
    return input.messages;
  }

  const messages: LlmChatMessage[] = [];

  if (input.systemPrompt?.trim()) {
    messages.push({
      role: "system",
      content: input.systemPrompt
    });
  }

  if (input.userPrompt?.trim()) {
    messages.push({
      role: "user",
      content: input.userPrompt
    });
  }

  return messages;
}

function createRequestBody(
  input: LlmChatCompletionInput,
  config: MiniMaxConfig,
  includeResponseFormat: boolean
): MiniMaxRequestBody {
  const messages = createMessages(input);

  if (messages.length === 0) {
    throw new Error("MiniMax chat completion requires at least one message.");
  }

  return {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_completion_tokens: config.maxCompletionTokens,
    ...(includeResponseFormat && input.responseFormat === "json_object"
      ? {
          response_format: {
            type: "json_object" as const
          }
        }
      : {})
  };
}

function redactSecrets(value: string, secrets: string[]): string {
  return secrets
    .filter(Boolean)
    .reduce((current, secret) => current.split(secret).join("[redacted]"), value);
}

async function responsePreview(
  response: Response,
  secrets: string[]
): Promise<MiniMaxResponsePreview> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = redactSecrets(
    (await response.text()).replace(/\s+/g, " ").trim(),
    secrets
  );

  return {
    status: response.status,
    statusText: response.statusText,
    contentType,
    text
  };
}

function formatStatusText(statusText: string): string {
  return statusText.trim() ? ` ${statusText.trim()}` : "";
}

function isResponseFormatUnsupported(preview: MiniMaxResponsePreview): boolean {
  return (
    (preview.status === 400 || preview.status === 422) &&
    /response_format|json_object|unsupported|not support|不支持/i.test(preview.text)
  );
}

function safeJsonParse(text: string, apiKey: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `MiniMax chat completion returned invalid JSON.${text.trim() ? ` Response body: ${redactSecrets(text, [apiKey]).slice(0, 300)}` : ""}`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function responseUsage(value: unknown): LlmUsage {
  if (!isRecord(value)) {
    return {
      promptTokens: null,
      completionTokens: null,
      totalTokens: null
    };
  }

  const usage = isRecord(value.usage) ? value.usage : {};

  return {
    promptTokens: numberOrNull(usage.prompt_tokens ?? usage.promptTokens),
    completionTokens: numberOrNull(
      usage.completion_tokens ?? usage.completionTokens
    ),
    totalTokens: numberOrNull(usage.total_tokens ?? usage.totalTokens)
  };
}

function contentFromMessageContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (isRecord(part) && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("");
  }

  return "";
}

function parseCompletionPayload(
  payload: unknown,
  model: string,
  responseFormat: "json_object" | undefined
): Omit<LlmChatCompletionResult, "provider" | "model" | "generatedAt"> {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !payload.choices[0]) {
    throw new Error("MiniMax chat completion response is missing choices[0].");
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) {
    throw new Error("MiniMax chat completion response has an invalid choice.");
  }

  const message = isRecord(firstChoice.message) ? firstChoice.message : {};
  const rawContent = contentFromMessageContent(message.content);
  const content =
    responseFormat === "json_object"
      ? normalizeJsonObjectContent(rawContent)
      : rawContent;
  const finishReason =
    typeof firstChoice.finish_reason === "string"
      ? firstChoice.finish_reason
      : typeof firstChoice.finishReason === "string"
        ? firstChoice.finishReason
        : null;

  if (!content.trim()) {
    throw new Error(`MiniMax chat completion returned empty content for ${model}.`);
  }

  return {
    content,
    usage: responseUsage(payload),
    finishReason
  };
}

function normalizeJsonObjectContent(content: string): string {
  const trimmed = content.trim();

  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    const extracted = extractJsonValue(trimmed);
    if (extracted) {
      return JSON.stringify(extracted);
    }
  }

  throw new Error("MiniMax response did not contain valid JSON content.");
}

function extractJsonValue(text: string): unknown | undefined {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const candidates = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = candidates.length > 0 ? Math.min(...candidates) : -1;

  if (start === -1) {
    return undefined;
  }

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

async function postMiniMaxChatCompletion(input: {
  url: string;
  config: MiniMaxConfig;
  body: MiniMaxRequestBody;
  fetchImpl: LlmFetch;
}): Promise<Response | MiniMaxResponsePreview> {
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input.body)
  });

  if (response.ok) {
    return response;
  }

  return responsePreview(response, [input.config.apiKey]);
}

export async function createChatCompletion(
  input: LlmChatCompletionInput
): Promise<LlmChatCompletionResult> {
  const config = resolveMiniMaxConfig(input);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("MiniMax real API mode requires a runtime with fetch support.");
  }

  const url = minimaxChatCompletionsUrl(config.baseUrl);
  const wantsJson = input.responseFormat === "json_object";
  let body = createRequestBody(input, config, wantsJson);

  try {
    let response = await postMiniMaxChatCompletion({
      url,
      config,
      body,
      fetchImpl
    });

    if (!(response instanceof Response)) {
      if (wantsJson && isResponseFormatUnsupported(response)) {
        body = createRequestBody(input, config, false);
        response = await postMiniMaxChatCompletion({
          url,
          config,
          body,
          fetchImpl
        });
      }
    }

    if (!(response instanceof Response)) {
      throw new Error(
        `MiniMax chat completion request failed with HTTP ${response.status}${formatStatusText(
          response.statusText
        )}.${response.text ? ` Response body: ${response.text.slice(0, 300)}` : ""}`
      );
    }

    const text = await response.text();
    const payload = safeJsonParse(text, config.apiKey);
    const completion = parseCompletionPayload(payload, config.model, input.responseFormat);

    return {
      provider: "minimax",
      model: config.model,
      ...completion,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    throw new Error(redactSecrets(message, [config.apiKey]));
  }
}
