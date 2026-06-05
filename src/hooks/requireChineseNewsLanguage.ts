import type {
  NewsChineseLanguageCheckResult,
  NewsChineseLanguageField,
  NewsChineseLanguageViolation
} from "../types/news.js";

type ChineseNewsLanguageItem = {
  title: string;
  query?: string;
  snippet?: string;
  summary?: string;
  rawContent?: string;
};

const chineseCharacterPattern = /\p{Script=Han}/u;
const urlPattern = /https?:\/\/\S+/gi;
const emailPattern = /\b\S+@\S+\.\S+\b/gi;
const latinTermPattern = /\b[A-Za-z][A-Za-z0-9+.#/-]*\b/g;

const allowedLatinTermPatterns = [
  /\bClaude\s+Code\b/gi,
  /\bHugging\s+Face\b/gi,
  /\bGoogle\s+DeepMind\b/gi,
  /\bThe\s+Verge\b/gi,
  /\bSimon\s+Willison\b/gi,
  /\b(?:OpenAI|Anthropic|Google|DeepMind|Microsoft|Meta|NVIDIA|Codex|Claude|Gemini|Llama|Mistral|Copilot|GitHub|LangChain|MIT|BAIR|VentureBeat|Tavily|Exa|Goose|ChatGPT|MiniMax|APIMart|Neon|Wechat|WeChat)\b/gi,
  /\b(?:AI|API|SDK|LLM|RAG|OCR|CRM|CLI|HTML|XML|JSON|RSS|IP|JPG|JPEG|PNG|R2|MCP|SQL|SQLite|PAYG)\b/g,
  /\bGPT-\d+(?:\.\d+)?\b/gi,
  /\b[A-Z]{2,}(?:[-/][A-Z0-9]+)*\b/g
];

const checkedFields: NewsChineseLanguageField[] = [
  "title",
  "query",
  "snippet",
  "summary",
  "rawContent"
];

function trimText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function stripAllowedLatinTerms(value: string): string {
  let stripped = value.replace(urlPattern, " ").replace(emailPattern, " ");

  for (const pattern of allowedLatinTermPatterns) {
    stripped = stripped.replace(pattern, " ");
  }

  return stripped;
}

function uniqueTerms(terms: string[]): string[] {
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
}

function findDisallowedEnglishTerms(value: string): string[] {
  const stripped = stripAllowedLatinTerms(value);
  const matches = stripped.match(latinTermPattern) ?? [];

  return uniqueTerms(
    matches.filter((term) => term.replace(/[^A-Za-z]/g, "").length >= 3)
  );
}

export function checkChineseNewsLanguage(
  item: ChineseNewsLanguageItem
): NewsChineseLanguageCheckResult {
  const violations: NewsChineseLanguageViolation[] = [];

  for (const field of checkedFields) {
    const value = trimText(item[field]);
    if (!value) {
      continue;
    }

    if (!chineseCharacterPattern.test(value)) {
      violations.push({
        field,
        reason: "missing_chinese_text",
        disallowedTerms: findDisallowedEnglishTerms(value)
      });
      continue;
    }

    const disallowedTerms = findDisallowedEnglishTerms(value);
    if (disallowedTerms.length > 0) {
      violations.push({
        field,
        reason: "contains_untranslated_english",
        disallowedTerms
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations
  };
}

export function formatChineseNewsLanguageViolation(
  check: NewsChineseLanguageCheckResult
): string {
  return check.violations
    .map((violation) => {
      const terms =
        violation.disallowedTerms.length > 0
          ? ` (${violation.disallowedTerms.join(", ")})`
          : "";
      return `${violation.field}: ${violation.reason}${terms}`;
    })
    .join("; ");
}

export function requireChineseNewsLanguage<T extends ChineseNewsLanguageItem>(
  items: T | T[]
): void {
  const list = Array.isArray(items) ? items : [items];
  const failed = list.find((item) => !checkChineseNewsLanguage(item).passed);

  if (!failed) {
    return;
  }

  const check = checkChineseNewsLanguage(failed);
  throw new Error(
    `News item must use Chinese language except fixed proper names: ${
      failed.title
    } (${formatChineseNewsLanguageViolation(check)})`
  );
}
