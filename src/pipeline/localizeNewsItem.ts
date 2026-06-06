import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mockLlmMetadata,
  realLlmMetadata,
  resolveLlmStageConfig
} from "../adapters/llm.js";
import { createChatCompletion } from "../adapters/minimax.js";
import { checkChineseNewsLanguage } from "../hooks/requireChineseNewsLanguage.js";
import type {
  LocalizedNewsItem,
  LocalizeNewsItemInput,
  NewsSourceLanguage
} from "../types/localizedNews.js";
import type { LlmFetch } from "../types/llm.js";
import { requestLlmJsonWithRepair } from "../utils/llmJson.js";

export interface LocalizeNewsItemOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  outputDir?: string;
}

interface LocalizedNewsPayload {
  titleZh: string;
  summaryZh: string;
  topicAngleZh: string;
  shortlistReasonZh: string;
  riskNotesZh: string[];
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const chineseCharacterPattern = /\p{Script=Han}/u;
const latinLetterPattern = /[A-Za-z]/;

function trimText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function shouldForceRulesLocalization(env: NodeJS.ProcessEnv): boolean {
  return parseBoolean(env.NEWS_LOCALIZER_FORCE_RULES);
}

export function detectNewsSourceLanguage(input: {
  title?: string;
  summary?: string;
  snippet?: string;
}): NewsSourceLanguage {
  const text = [input.title, input.summary, input.snippet]
    .map(trimText)
    .filter(Boolean)
    .join(" ");

  if (
    chineseCharacterPattern.test(text) &&
    checkChineseNewsLanguage({
      title: input.title ?? "",
      summary: input.summary,
      snippet: input.snippet
    }).passed
  ) {
    return "zh";
  }

  if (latinLetterPattern.test(text)) {
    return "en";
  }

  return "unknown";
}

function topicDescriptor(text: string): string {
  const haystack = text.toLowerCase();

  if (/agent|workflow|automation|copilot|codex|智能体|工作流/.test(haystack)) {
    return "智能体工作流更新";
  }

  if (/model|llm|gpt|claude|gemini|multimodal|benchmark|模型|多模态|基准/.test(haystack)) {
    return "模型能力与评测动态";
  }

  if (/research|paper|study|technical report|论文|研究|技术报告/.test(haystack)) {
    return "AI 研究进展";
  }

  if (/funding|startup|revenue|acquisition|融资|创业|并购/.test(haystack)) {
    return "AI 商业化动态";
  }

  if (/policy|safety|copyright|regulation|governance|安全|版权|监管|治理/.test(haystack)) {
    return "AI 治理与安全动态";
  }

  if (/developer|github|open source|sdk|api|tool|开发者|开源|工具/.test(haystack)) {
    return "开发者工具生态变化";
  }

  return "AI 领域新动态";
}

function appendGlobalSearchRisk(
  input: LocalizeNewsItemInput,
  riskNotes: string[]
): string[] {
  const notes = [...riskNotes.map(trimText).filter(Boolean)];

  if (input.sourceType === "global_search") {
    const reminder = "global_search 结果需要回到原文核验；搜索摘要不作为确定事实。";
    if (!notes.some((note) => note.includes("需要回到原文核验"))) {
      notes.push(reminder);
    }
  }

  return [...new Set(notes)];
}

function mockNormalize(input: LocalizeNewsItemInput, sourceLanguage: NewsSourceLanguage): LocalizedNewsPayload {
  const rawText = [input.title, input.summary, input.snippet, input.query]
    .map(trimText)
    .filter(Boolean)
    .join(" ");
  const descriptor = topicDescriptor(rawText);
  const summaryZh =
    sourceLanguage === "zh"
      ? trimText(input.summary) || trimText(input.snippet) || "原文未提供完整摘要，需要阅读原文确认详情。"
      : `这条资讯围绕${descriptor}展开，适合作为 AI 领域选题线索；具体发布时间、产品边界和数据结论需要回到原文核验。`;
  const titleZh =
    sourceLanguage === "zh"
      ? trimText(input.title)
      : `AI 资讯：${descriptor}`;

  return {
    titleZh,
    summaryZh,
    topicAngleZh:
      `可以从“${descriptor}会怎样影响开发者、企业团队或内容生产者的工作流”切入；写作前必须回到原文确认事实边界。`,
    shortlistReasonZh:
      "来源链接和基础信息完整，主题包含 AI 相关信号，具备进入公众号编辑初筛的讨论价值。",
    riskNotesZh: appendGlobalSearchRisk(input, [
      sourceLanguage === "zh"
        ? "仍需在事实包阶段核验原文链接和关键限定条件。"
        : "已做中文化归一化，不能把译写摘要当作新增事实。"
    ])
  };
}

function createSystemPrompt(): string {
  return [
    "你是 AI 资讯中文化编辑，只做翻译、归一化和风险提示。",
    "只根据用户给出的标题、摘要、snippet、来源和 URL 工作，不编造任何事实。",
    "如果信息来自 global_search，必须提醒：需要回到原文核验，搜索摘要不作为确定事实。",
    "保留 OpenAI、Codex、Claude Code、API、SDK、LLM、RAG、R2 等固定专名或常见缩写。",
    "返回合法 JSON，不要 Markdown，不要解释。"
  ].join("\n");
}

function createUserPrompt(input: LocalizeNewsItemInput): string {
  return JSON.stringify(
    {
      task: "将原始 AI 资讯中文化，供公众号编辑简报初筛使用。",
      constraints: [
        "不改变 URL。",
        "不把搜索摘要当确定事实。",
        "不增加原文没有的信息。",
        "topicAngleZh 说明表面事件、背后矛盾和中国中文读者可读的切入角度。",
        "shortlistReasonZh 只解释为什么可以进入初筛，不承诺事实已经成立。"
      ],
      item: {
        title: input.title,
        summary: input.summary ?? "",
        snippet: input.snippet ?? "",
        url: input.url,
        sourceName: input.sourceName,
        sourceType: input.sourceType,
        provider: input.provider ?? null,
        query: input.query ?? null
      },
      expectedJson: {
        titleZh: "中文标题",
        summaryZh: "中文摘要",
        topicAngleZh: "中文选题角度",
        shortlistReasonZh: "中文入围理由",
        riskNotesZh: ["中文风险提醒"]
      }
    },
    null,
    2
  );
}

function expectedJsonShape(): string {
  return JSON.stringify(
    {
      titleZh: "string",
      summaryZh: "string",
      topicAngleZh: "string",
      shortlistReasonZh: "string",
      riskNotesZh: ["string"]
    },
    null,
    2
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: keyof LocalizedNewsPayload): string {
  const value = record[field];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MiniMax news-localizer response is missing ${field}.`);
  }

  return trimText(value);
}

function validatePayload(value: unknown): LocalizedNewsPayload {
  if (!isRecord(value)) {
    throw new Error("MiniMax news-localizer response must be a JSON object.");
  }

  const riskNotes = value.riskNotesZh;
  if (!Array.isArray(riskNotes)) {
    throw new Error("MiniMax news-localizer response is missing riskNotesZh array.");
  }

  return {
    titleZh: stringField(value, "titleZh"),
    summaryZh: stringField(value, "summaryZh"),
    topicAngleZh: stringField(value, "topicAngleZh"),
    shortlistReasonZh: stringField(value, "shortlistReasonZh"),
    riskNotesZh: riskNotes.map((item) => trimText(String(item))).filter(Boolean)
  };
}

export async function localizeNewsItem(
  input: LocalizeNewsItemInput,
  options: LocalizeNewsItemOptions = {}
): Promise<LocalizedNewsItem> {
  const env = options.env ?? process.env;
  const rawTitle = trimText(input.title);
  const rawSummary = trimText(input.summary) || trimText(input.snippet);
  const sourceLanguage = detectNewsSourceLanguage({
    title: rawTitle,
    summary: rawSummary,
    snippet: input.snippet
  });
  const config = resolveLlmStageConfig("news-localizer", env);

  if (sourceLanguage === "zh") {
    const payload = mockNormalize(input, sourceLanguage);
    return {
      sourceLanguage,
      rawTitle,
      rawSummary,
      ...payload,
      riskNotesZh: appendGlobalSearchRisk(input, payload.riskNotesZh),
      url: input.url,
      localized: false,
      llm: mockLlmMetadata(config)
    };
  }

  if (shouldForceRulesLocalization(env)) {
    const payload = mockNormalize(input, sourceLanguage);
    return {
      sourceLanguage,
      rawTitle,
      rawSummary,
      ...payload,
      riskNotesZh: appendGlobalSearchRisk(input, payload.riskNotesZh),
      url: input.url,
      localized: true,
      llm: mockLlmMetadata(config)
    };
  }

  if (config.mode !== "real") {
    if (parseBoolean(env.REAL_PRODUCTION_MODE)) {
      throw new Error(
        "REAL_PRODUCTION_MODE=true requires real LLM localization for non-Chinese news items."
      );
    }

    const payload = mockNormalize(input, sourceLanguage);
    return {
      sourceLanguage,
      rawTitle,
      rawSummary,
      ...payload,
      riskNotesZh: appendGlobalSearchRisk(input, payload.riskNotesZh),
      url: input.url,
      localized: true,
      llm: mockLlmMetadata(config)
    };
  }

  const { value: payload, completion } = await requestLlmJsonWithRepair({
    failedStep: "news-localizer",
    outputDir: options.outputDir ?? defaultOutputDir,
    config,
    systemPrompt: createSystemPrompt(),
    userPrompt: createUserPrompt(input),
    expectedJsonShape: expectedJsonShape(),
    env,
    fetchImpl: options.fetchImpl,
    chatCompletion: createChatCompletion,
    validate: validatePayload
  });

  return {
    sourceLanguage,
    rawTitle,
    rawSummary,
    ...payload,
    riskNotesZh: appendGlobalSearchRisk(input, payload.riskNotesZh),
    url: input.url,
    localized: true,
    llm: realLlmMetadata(completion, "real")
  };
}
