import type { NewsSourceType, SearchProvider } from "./news.js";
import type { LlmRunMetadata } from "./llm.js";

export type NewsSourceLanguage = "zh" | "en" | "unknown";

export interface LocalizeNewsItemInput {
  title: string;
  summary?: string;
  snippet?: string;
  url: string;
  sourceName: string;
  sourceType: NewsSourceType;
  provider?: SearchProvider;
  query?: string;
}

export interface LocalizedNewsItem {
  sourceLanguage: NewsSourceLanguage;
  rawTitle: string;
  rawSummary: string;
  titleZh: string;
  summaryZh: string;
  topicAngleZh: string;
  shortlistReasonZh: string;
  riskNotesZh: string[];
  url: string;
  localized: boolean;
  llm?: LlmRunMetadata;
}
