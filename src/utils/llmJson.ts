import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LlmStage, LlmStageConfig } from "../adapters/llm.js";
import type {
  LlmChatCompletionClient,
  LlmChatCompletionResult,
  LlmFetch,
  LlmProvider
} from "../types/llm.js";
import {
  createContentPreview,
  extractJsonFromText
} from "./extractJsonFromText.js";

export interface LlmJsonErrorReport {
  failedStep: LlmStage;
  provider: LlmProvider;
  model: string;
  expectedJsonShape: string;
  parseError: string;
  contentPreview: string;
  retryAttempted: boolean;
  retrySucceeded: boolean;
  suggestedFix: string;
  generatedAt: string;
}

export interface LlmJsonRequestResult<T> {
  value: T;
  completion: LlmChatCompletionResult;
}

interface LlmJsonAcceptSuccess<T> {
  ok: true;
  value: T;
}

interface LlmJsonAcceptFailure {
  ok: false;
  parseError: string;
  contentPreview: string;
}

export class LlmJsonError extends Error {
  readonly report: LlmJsonErrorReport;

  constructor(report: LlmJsonErrorReport) {
    super(
      `MiniMax JSON output could not be accepted for ${report.failedStep}: ${report.parseError}`
    );
    this.name = "LlmJsonError";
    this.report = report;
  }
}

function redactSensitiveText(text: string, env: NodeJS.ProcessEnv): string {
  const secrets = [
    env.MINIMAX_API_KEY,
    env.WECHAT_APP_SECRET,
    env.APIMART_API_KEY
  ]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);

  return secrets.reduce(
    (current, secret) => current.split(secret).join("[redacted]"),
    text
  );
}

function safeErrorMessage(error: unknown, env: NodeJS.ProcessEnv): string {
  const message = error instanceof Error ? error.message : "Unknown error.";
  return redactSensitiveText(message, env);
}

function acceptJson<T>(
  content: string,
  validate: (value: unknown) => T,
  env: NodeJS.ProcessEnv
): LlmJsonAcceptSuccess<T> | LlmJsonAcceptFailure {
  const extracted = extractJsonFromText(content);

  if (!extracted.ok) {
    const attempts = extracted.error.attempts
      .map((attempt) => `${attempt.source}: ${attempt.parseError}`)
      .join("; ");
    return {
      ok: false,
      parseError: attempts || extracted.error.message,
      contentPreview: redactSensitiveText(extracted.error.contentPreview, env)
    };
  }

  try {
    return {
      ok: true,
      value: validate(extracted.value)
    };
  } catch (error) {
    return {
      ok: false,
      parseError: `JSON schema validation failed: ${safeErrorMessage(error, env)}`,
      contentPreview: redactSensitiveText(createContentPreview(content), env)
    };
  }
}

function createRepairPrompt(expectedJsonShape: string): string {
  return [
    "你上一次返回的内容不是合法 JSON。",
    "请只返回合法 JSON。",
    "不要解释。",
    "不要使用 Markdown。",
    "不要包裹 ```json。",
    "不要输出 <think> 或任何思考过程。",
    "不要输出任何 JSON 之外的文字。",
    "必须符合以下结构：",
    expectedJsonShape
  ].join("\n");
}

function truncationDiagnostic(
  completion: LlmChatCompletionResult,
  maxCompletionTokens: number
): string | undefined {
  const finishReason = completion.finishReason?.trim().toLowerCase() ?? "";
  const completionTokens = completion.usage.completionTokens;
  const nearLimit =
    typeof completionTokens === "number" &&
    completionTokens >= Math.max(1, Math.floor(maxCompletionTokens * 0.95));

  if (
    finishReason === "length" ||
    finishReason === "max_tokens" ||
    finishReason === "content_length" ||
    nearLimit
  ) {
    return `MiniMax output likely hit maxCompletionTokens=${maxCompletionTokens}; finishReason=${completion.finishReason ?? "unknown"}, completionTokens=${completionTokens ?? "unknown"}. Increase the stage token budget or shorten the prompt.`;
  }

  return undefined;
}

function createSuggestedFix(input: {
  failedStep: LlmStage;
  retryAttempted: boolean;
  retrySucceeded: boolean;
}): string {
  if (input.retrySucceeded) {
    return "Repair retry succeeded; no manual fix is required.";
  }

  return [
    `检查 ${input.failedStep} 的 MiniMax prompt 和模型输出，确保模型只返回合法 JSON 且字段完整。`,
    "当前运行已阻断，不能 fallback mock 继续进入正式草稿。"
  ].join(" ");
}

function createReportMarkdown(report: LlmJsonErrorReport): string {
  return [
    "# LLM JSON Error Report",
    "",
    `- failedStep: ${report.failedStep}`,
    `- provider: ${report.provider}`,
    `- model: ${report.model}`,
    `- retryAttempted: ${report.retryAttempted ? "true" : "false"}`,
    `- retrySucceeded: ${report.retrySucceeded ? "true" : "false"}`,
    "",
    "## Expected JSON Shape",
    "",
    "```json",
    report.expectedJsonShape,
    "```",
    "",
    "## Parse Error",
    "",
    report.parseError,
    "",
    "## Content Preview",
    "",
    report.contentPreview || "(empty)",
    "",
    "## Suggested Fix",
    "",
    report.suggestedFix,
    ""
  ].join("\n");
}

export async function writeLlmJsonErrorReport(
  outputDir: string,
  report: LlmJsonErrorReport
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "llm-json-error.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(outputDir, "llm-json-error-report.md"),
    createReportMarkdown(report),
    "utf8"
  );
}

export async function requestLlmJsonWithRepair<T>(input: {
  failedStep: LlmStage;
  outputDir: string;
  config: LlmStageConfig;
  systemPrompt: string;
  userPrompt: string;
  repairUserPrompt?: string;
  expectedJsonShape: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion: LlmChatCompletionClient;
  validate: (value: unknown) => T;
}): Promise<LlmJsonRequestResult<T>> {
  const completion = await input.chatCompletion({
    model: input.config.model,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    temperature: input.config.temperature,
    maxCompletionTokens: input.config.maxCompletionTokens,
    responseFormat: "json_object",
    env: input.env,
    fetchImpl: input.fetchImpl
  });
  const first = acceptJson(completion.content, input.validate, input.env);

  if (first.ok) {
    return {
      value: first.value,
      completion
    };
  }

  const firstTruncation = truncationDiagnostic(
    completion,
    input.config.maxCompletionTokens
  );
  let finalError = firstTruncation
    ? `${first.parseError}; ${firstTruncation}`
    : first.parseError;
  let finalPreview = first.contentPreview;
  let retryCompletion: LlmChatCompletionResult | undefined;

  try {
    retryCompletion = await input.chatCompletion({
      model: input.config.model,
      systemPrompt: input.systemPrompt,
      userPrompt:
        input.repairUserPrompt ??
        [input.userPrompt, "", createRepairPrompt(input.expectedJsonShape)].join("\n"),
      temperature: 0,
      maxCompletionTokens: input.config.maxCompletionTokens,
      responseFormat: "json_object",
      env: input.env,
      fetchImpl: input.fetchImpl
    });
    const second = acceptJson(retryCompletion.content, input.validate, input.env);

    if (second.ok) {
      return {
        value: second.value,
        completion: retryCompletion
      };
    }

    const secondTruncation = truncationDiagnostic(
      retryCompletion,
      input.config.maxCompletionTokens
    );
    finalError = `Initial attempt: ${firstTruncation ? `${first.parseError}; ${firstTruncation}` : first.parseError}; repair retry: ${
      secondTruncation ? `${second.parseError}; ${secondTruncation}` : second.parseError
    }`;
    finalPreview = second.contentPreview;
  } catch (error) {
    finalError = `Initial attempt: ${
      firstTruncation ? `${first.parseError}; ${firstTruncation}` : first.parseError
    }; repair retry request failed: ${safeErrorMessage(
      error,
      input.env
    )}`;
  }

  const report: LlmJsonErrorReport = {
    failedStep: input.failedStep,
    provider: input.config.provider,
    model: input.config.model,
    expectedJsonShape: input.expectedJsonShape,
    parseError: finalError,
    contentPreview: finalPreview,
    retryAttempted: true,
    retrySucceeded: false,
    suggestedFix: createSuggestedFix({
      failedStep: input.failedStep,
      retryAttempted: true,
      retrySucceeded: false
    }),
    generatedAt: new Date().toISOString()
  };

  await writeLlmJsonErrorReport(input.outputDir, report);
  throw new LlmJsonError(report);
}
