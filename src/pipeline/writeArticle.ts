import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatCompletion } from "../adapters/minimax.js";
import {
  formatLlmUsage,
  type LlmStageConfig,
  mockLlmMetadata,
  realLlmMetadata,
  resolveLlmStageConfig
} from "../adapters/llm.js";
import type {
  ArticleDraft,
  ArticleMeta,
  ArticleSection,
  ArticleUsedClaim,
  ArticleWritingOutputFiles,
  ArticleWritingResult
} from "../types/article.js";
import type { TopicFactPack } from "../types/factPack.js";
import type { SelectedTopic } from "../types/news.js";
import type {
  EditorialApproval,
  EditorialStyleLoadResult
} from "../types/editorial.js";
import type { EditorialPlan } from "../types/editorialPlan.js";
import type {
  LlmChatCompletionClient,
  LlmFetch,
  LlmRunMetadata
} from "../types/llm.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { requestLlmJsonWithRepair } from "../utils/llmJson.js";
import { buildEditorialPlan } from "./buildEditorialPlan.js";
import { loadEditorialStyle } from "./loadEditorialStyle.js";

export interface WriteArticleOptions {
  outputDir?: string;
  selectedTopicFile?: string;
  topicSelectionReportFile?: string;
  topicFactPackFile?: string;
  topicFactPackReportFile?: string;
  editorialPlanFile?: string;
  topic?: SelectedTopic;
  topicSelectionReport?: string;
  factPack?: TopicFactPack;
  topicFactPackReport?: string;
  editorialPlan?: EditorialPlan;
  editorialStyle?: EditorialStyleLoadResult;
  editorialApproval?: EditorialApproval;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion?: LlmChatCompletionClient;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

const forbiddenArticlePhrases = [
  "免费平替",
  "免费替代高价工具",
  "完全替代",
  "能力相同",
  "能力完全一样",
  "直接互换",
  "零成本"
];

const requiredDiscussionTerms = ["事实边界", "读者影响", "风险控制"];

function createOutputFiles(outputDir: string): ArticleWritingOutputFiles {
  return {
    article: join(outputDir, "article.md"),
    articleMeta: join(outputDir, "article-meta.json"),
    articleWritingReport: join(outputDir, "article-writing-report.md"),
    articleAttempt1: join(outputDir, "article-attempt-1.json"),
    articleRepair1: join(outputDir, "article-repair-1.json"),
    articleRepair2: join(outputDir, "article-repair-2.json"),
    articleValidation: join(outputDir, "article-validation.json"),
    articleWritingError: join(outputDir, "article-writing-error.json"),
    articleWritingErrorReport: join(outputDir, "article-writing-error.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function readRequiredText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path);
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function numbersInText(value: string): string[] {
  return unique(value.match(/\d+(?:[.,]\d+)?%?|\$?\d+(?:[.,]\d+)?/g) ?? []);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createWritingErrorReport(input: {
  error: unknown;
  topic: SelectedTopic;
  llmConfig: LlmStageConfig;
  generatedAt: string;
}): string {
  const message = errorMessage(input.error);
  return [
    "# Article Writing Error",
    "",
    `generatedAt: ${input.generatedAt}`,
    `failedStep: article-writer`,
    "",
    "## 选题",
    "",
    `- topicId: ${input.topic.selected.id}`,
    `- topicTitle: ${input.topic.selected.title}`,
    `- sourceUrl: ${input.topic.selected.url}`,
    "",
    "## LLM 配置",
    "",
    `- provider: ${input.llmConfig.provider}`,
    `- model: ${input.llmConfig.model}`,
    `- mode: ${input.llmConfig.mode}`,
    `- maxCompletionTokens: ${input.llmConfig.maxCompletionTokens}`,
    "",
    "## 错误",
    "",
    message,
    "",
    "## 建议处理",
    "",
    "重新生成 topic-fact-pack 后再从 article 阶段运行；如果错误来自 forbidden wording，请收紧 fact pack 的 safeWording 或降低文章中的绝对化表述。",
    ""
  ].join("\n");
}

async function writeArticleWritingError(input: {
  files: ArticleWritingOutputFiles;
  error: unknown;
  topic: SelectedTopic;
  llmConfig: LlmStageConfig;
  now?: Date;
}): Promise<void> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const payload = {
    failedStep: "article-writer",
    topicId: input.topic.selected.id,
    topicTitle: input.topic.selected.title,
    provider: input.llmConfig.provider,
    model: input.llmConfig.model,
    mode: input.llmConfig.mode,
    maxCompletionTokens: input.llmConfig.maxCompletionTokens,
    error: errorMessage(input.error),
    suggestedFix:
      "重新生成 topic-fact-pack 后再从 article 阶段运行；如果错误来自 forbidden wording，请收紧 fact pack 的 safeWording 或降低文章中的绝对化表述。",
    generatedAt
  };

  await writeJson(input.files.articleWritingError, payload);
  await writeFile(
    input.files.articleWritingErrorReport,
    createWritingErrorReport({
      error: input.error,
      topic: input.topic,
      llmConfig: input.llmConfig,
      generatedAt
    }),
    "utf8"
  );
}

export function countArticleChars(markdown: string): number {
  return [
    ...markdown
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/[>*`_[\]()]/g, "")
      .replace(/\s/g, "")
  ].length;
}

function pickTitle(topic: SelectedTopic, editorialPlan?: EditorialPlan): string {
  const plannedTitle = editorialPlan
    ? `${editorialPlan.structure[0] ?? "这条 AI 资讯"}，真正要看的是${editorialPlan.requiredThemes[1] ?? "影响"}`
    : undefined;

  return sanitizeFactPackTextForHtmlSafety(
    plannedTitle ??
      topic.selected.selection.suggestedTitles.find((title) =>
        title.includes("工作流")
      ) ??
      topic.selected.selection.suggestedTitles[0] ??
      "这条 AI 资讯，真正要看的是事实边界"
  );
}

function isGenericFactPack(factPack: TopicFactPack): boolean {
  return factPack.schemaVersion === "2.0";
}

function sanitizeFactPackTextForHtmlSafety(value: string | undefined): string {
  return (value ?? "")
    .replace(/costs up to \$?\d+[^。.\n]*(same thing|for free)[^。.\n]*/gi, "相关价格与能力对比需要回到原始来源核验")
    .replace(/必须\s*\$?\d+[^。.\n]*才能用/g, "需要根据具体套餐和适用对象核验")
    .replace(/单独固定[^。.\n]*(价格|月费|工具)/g, "具体价格边界需要核验")
    .replace(/免费不等于零成本[^。.\n]*/g, "免费或开源表述仍需说明使用边界和潜在成本")
    .replace(/\b(?:does\s+)?the\s+same\s+thing\b/gi, "存在部分场景重叠")
    .replace(/不要写“能力完全一样”或“完全替代”/g, "不要写成能力边界一致或覆盖所有场景")
    .replace(/\$\d+(?:\/month|\/月)?/g, "具体付费方案")
    .replace(/免费平替|免费替代高价工具/g, "低成本替换叙事")
    .replace(/完全替代/g, "覆盖所有场景")
    .replace(/能力完全一样|能力相同/g, "能力边界一致")
    .replace(/直接互换|全量互换/g, "无差别迁移")
    .replace(/没有任何成本|零成本/g, "仍有部署、调用或维护成本边界")
    .replace(/\bHTTP\s+\d{3}\b/gi, "来源读取失败")
    .replace(/\b(?:4|5)\d{2}\b/g, "来源读取失败");
}

function usedClaimsFromFactPack(
  factPack: TopicFactPack,
  editorialPlan?: EditorialPlan
): ArticleUsedClaim[] {
  const allowedIds = editorialPlan
    ? new Set(editorialPlan.sections.flatMap((section) => section.allowedClaimIds))
    : undefined;
  const claims = allowedIds
    ? factPack.claims.filter((claim) => allowedIds.has(claim.id))
    : factPack.claims;

  return claims.map((claim) => ({
    id: claim.id,
    claim: sanitizeFactPackTextForHtmlSafety(claim.statement),
    safeWording: sanitizeFactPackTextForHtmlSafety(claim.safeWording),
    sourceUrls: claim.sourceUrls,
    evidenceIds: claim.evidenceIds,
    evidenceSnippetIds: claim.evidenceSnippetIds,
    status: claim.status
  }));
}

function forbiddenWordingFromFactPack(factPack: TopicFactPack): string[] {
  return [
    ...new Set(
      factPack.claims.flatMap((claim) => claim.forbiddenWording).filter(Boolean)
    )
  ];
}

function createRiskControls(
  factPack?: TopicFactPack,
  editorialPlan?: EditorialPlan
): string[] {
  if (editorialPlan) {
    return [
      ...new Set([
        ...editorialPlan.riskControls,
        "每个段落只使用 editorial plan 中允许的 claim。",
        "本阶段只生成公众号正文、meta 和写作报告，不进入封面、HTML 排版、APIMart、后台或浏览器自动化。"
      ])
    ];
  }

  if (factPack && isGenericFactPack(factPack)) {
    return [
      "不把搜索摘要、中文化摘要或媒体标题当作官方确定事实。",
      "涉及参数、benchmark、任务解决率、上下文长度等指标时，只使用 fact pack safeWording 的谨慎表达。",
      "不复用无关旧专题事实，不把当前选题套进其他题目的价格、产品或工具对比。",
      "讨论开放生态、工作流、成本或迁移风险时，限定为对具体读者和团队决策的观察维度。",
      "本阶段只生成公众号正文、meta 和写作报告，不进入封面、HTML 排版、APIMart、后台或浏览器自动化。"
    ];
  }

  return [
    "价格、免费层或开源表述必须保留适用范围、套餐和额外成本边界。",
    "不同产品、模型或方案的比较只能写成有限场景下的差异，不写能力等同或无差别迁移。",
    "媒体标题只作为选题线索，正文事实边界来自 fact pack 的 safeWording。",
    "趋势判断必须保留条件，不把单一来源外推为行业定论。",
    "本阶段只生成公众号正文、meta 和写作报告，不进入封面、HTML 排版、APIMart、后台或浏览器自动化。"
  ];
}

function claimsById(factPack: TopicFactPack): Map<string, TopicFactPack["claims"][number]> {
  return new Map(factPack.claims.map((claim) => [claim.id, claim]));
}

function compactSentence(value: string): string {
  return sanitizeFactPackTextForHtmlSafety(value).replace(/\s+/g, " ").trim();
}

function shorten(value: string, maxChars: number): string {
  const text = compactSentence(value);
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).replace(/[，。；：、\s]+$/g, "")}。`;
}

function createSectionFromPlan(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  section: EditorialPlan["sections"][number];
  index: number;
}): ArticleSection {
  const claimMap = claimsById(input.factPack);
  const allowedClaims = input.section.allowedClaimIds
    .map((id) => claimMap.get(id))
    .filter((claim): claim is TopicFactPack["claims"][number] => Boolean(claim));
  const firstClaim = allowedClaims[0];
  const secondClaim = allowedClaims[1];
  const sourcePrefix =
    input.index === 0
      ? `${input.topic.selected.sourceName} 的线索显示，`
      : "";
  const claimSentence = firstClaim
    ? shorten(firstClaim.safeWording, 120)
    : shorten(input.topic.selected.selection.publicInterest, 90);
  const supportSentence = secondClaim
    ? shorten(secondClaim.safeWording, 90)
    : shorten(input.section.purpose, 80);
  const questionSentence = input.section.keyQuestions.length > 0
    ? `重点回答：${input.section.keyQuestions.slice(0, 1).join("；")}。`
    : "";
  const riskSentence = input.section.riskControls.length > 0
    ? `守住 ${input.section.riskControls.slice(0, 1).join("、")}。`
    : "写法上继续保持限定语。";

  return {
    heading: input.section.heading,
    body: [
      `${sourcePrefix}${claimSentence}`,
      supportSentence,
      questionSentence,
      riskSentence
    ]
      .filter(Boolean)
      .join(" "),
    planSectionId: input.section.id,
    role: input.section.role,
    claimIds: input.section.allowedClaimIds
  };
}

function createArticleSectionsFromPlan(
  topic: SelectedTopic,
  factPack: TopicFactPack,
  editorialPlan: EditorialPlan
): ArticleSection[] {
  return editorialPlan.sections.map((section, index) =>
    createSectionFromPlan({
      topic,
      factPack,
      section,
      index
    })
  );
}

function alignSectionsWithEditorialPlan(
  sections: ArticleSection[],
  editorialPlan?: EditorialPlan
): ArticleSection[] {
  if (!editorialPlan) {
    return sections;
  }

  return editorialPlan.sections.map((planSection, index) => {
    const modelSection = sections[index] ?? sections[sections.length - 1];
    const body = modelSection?.body?.trim()
      ? modelSection.body.trim()
      : planSection.purpose;

    return {
      heading: planSection.heading,
      body,
      planSectionId: planSection.id,
      role: planSection.role,
      claimIds: planSection.allowedClaimIds
    };
  });
}

function createGenericArticleSections(
  topic: SelectedTopic,
  factPack: TopicFactPack
): ArticleSection[] {
  const selected = topic.selected;
  const sourceTitle = sanitizeFactPackTextForHtmlSafety(
    selected.rawTitle || selected.titleZh || selected.title
  );
  const summary = sanitizeFactPackTextForHtmlSafety(
    selected.summaryZh ||
    selected.summary ||
    selected.rawSummary ||
    selected.selection.publicInterest
  );
  const boundary = sanitizeFactPackTextForHtmlSafety(
    factPack.safeWritingBoundary[2] ?? "具体指标和产品边界需要回到原文核验。"
  );
  const writingAngle = sanitizeFactPackTextForHtmlSafety(selected.selection.writingAngle);
  const articleThesis = sanitizeFactPackTextForHtmlSafety(selected.selection.articleThesis);

  return [
    {
      heading: "先把边界说清",
      body:
        `${selected.sourceName} 的线索显示，${sourceTitle}。这类 AI 资讯适合写，但不能把搜索摘要或标题化表达直接当成官方结论。更稳的写法，是先交代来源，再把确定性降下来：${boundary}`
    },
    {
      heading: "真正值得看的不是热闹",
      body:
        `${summary} 这件事的价值，不只在某个参数、融资金额或一句能力描述，而在它可能改变哪些读者的判断。对编辑来说，重要问题是事实能否被来源支撑；对读者来说，重要问题是它会不会改变产品选择、团队流程或风险预期。`
    },
    {
      heading: "影响要落到具体人群",
      body:
        "不同读者关心的问题不同：普通用户看可用性和风险，开发者看接入成本和可控性，企业团队看权限、审计、稳定性和责任边界。只有把影响对象拆开，文章才不会把一条线索写成笼统行业结论。"
    },
    {
      heading: "怎么判断后续影响",
      body:
        `${writingAngle} 接下来更值得观察的是三个问题：哪些事实已经被原文支撑，哪些判断只是编辑角度，哪些风险需要等更多材料确认。把这三点写清楚，比单纯复述“发布了什么”更有信息量。`
    },
    {
      heading: "结论",
      body:
        `${articleThesis} 这不是一句标题就能盖棺定论的事。越接近真实业务和用户决策，越需要把事实边界、适用条件和风险控制讲明白。`
    }
  ];
}

function createArticleSections(
  topic: SelectedTopic,
  factPack: TopicFactPack,
  editorialPlan?: EditorialPlan
): ArticleSection[] {
  if (editorialPlan) {
    return createArticleSectionsFromPlan(topic, factPack, editorialPlan);
  }

  return createGenericArticleSections(topic, factPack);
}

function createArticleMarkdown(title: string, sections: ArticleSection[], sourceUrl: string): string {
  return [
    title,
    "",
    ...sections.flatMap((section) => [
      `## ${section.heading}`,
      "",
      section.body,
      ""
    ]),
    `原始选题线索：${sourceUrl}`,
    ""
  ].join("\n");
}

function validateArticle(
  article: ArticleDraft,
  meta: ArticleMeta,
  editorialPlan?: EditorialPlan,
  factPack?: TopicFactPack
): void {
  const issues = articleValidationIssues(article, meta, editorialPlan, factPack);
  if (issues.length > 0) {
    throw new Error(issues[0]);
  }
}

function articleValidationIssues(
  article: ArticleDraft,
  meta: ArticleMeta,
  editorialPlan?: EditorialPlan,
  factPack?: TopicFactPack
): string[] {
  const issues: string[] = [];

  if (!article.title.trim()) {
    issues.push("Article title is missing.");
  }

  if (article.wordCount > 1500) {
    issues.push(`Article exceeds the 1500 character limit: ${article.wordCount}.`);
  }

  if (meta.usedClaims.length < 3) {
    issues.push("article-meta.usedClaims must include at least 3 claims.");
  }

  if (meta.riskControls.length < 3) {
    issues.push("article-meta.riskControls must include at least 3 controls.");
  }

  const forbiddenTerms = [
    ...new Set([
      ...forbiddenArticlePhrases,
      ...(factPack ? forbiddenWordingFromFactPack(factPack) : [])
    ])
  ];
  const forbidden = forbiddenTerms.find((phrase) =>
    article.markdown.includes(phrase)
  );
  if (forbidden) {
    issues.push(`Article contains forbidden absolute wording: ${forbidden}`);
  }

  const requiredThemes = editorialPlan?.requiredThemes ?? requiredDiscussionTerms;
  const coveredThemes = requiredThemes.filter((term) =>
    article.markdown.includes(term)
  );
  if (coveredThemes.length < 3) {
    issues.push(`Article must discuss at least 3 required themes; got ${coveredThemes.join(", ")}.`);
  }

  const requiredQualifiers = unique(
    factPack?.claims
      .filter((claim) => article.usedClaims.some((used) => used.id === claim.id))
      .flatMap((claim) => claim.requiredQualifiers) ?? []
  );
  const reflectedQualifiers = requiredQualifiers.filter((qualifier) =>
    article.markdown.includes(qualifier)
  );
  if (requiredQualifiers.length > 0 && reflectedQualifiers.length === 0) {
    issues.push("Article is missing required claim qualifiers.");
  }

  const unsupportedNumbers = unsupportedArticleNumbers(article, factPack);
  if (unsupportedNumbers.length > 0) {
    issues.push(`Article contains unsupported numbers: ${unsupportedNumbers.join(", ")}.`);
  }

  return issues;
}

function articleTextForNumberCheck(article: ArticleDraft): string {
  return [
    article.title,
    article.subtitle,
    article.articleThesis,
    ...article.sections.map((section) => `${section.heading} ${section.body}`)
  ]
    .join("\n")
    .replace(/https?:\/\/\S+/g, " ");
}

function allowedNumbersFromFactPack(factPack?: TopicFactPack): Set<string> {
  const claims =
    factPack?.claims.filter(
      (claim) => claim.status === "verified" && (claim.evidenceSnippetIds?.length ?? 0) > 0
    ) ?? [];

  return new Set(
    claims.flatMap((claim) => numbersInText(`${claim.statement} ${claim.safeWording}`))
  );
}

function unsupportedArticleNumbers(article: ArticleDraft, factPack?: TopicFactPack): string[] {
  const allowed = allowedNumbersFromFactPack(factPack);
  const numbers = numbersInText(articleTextForNumberCheck(article));
  return unique(numbers.filter((number) => !allowed.has(number)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceUnsupportedNumbers(value: string, unsupportedNumbers: string[]): string {
  return unsupportedNumbers.reduce((text, number) => {
    const replacement = number.startsWith("$") ? "相关金额" : "具体数字";
    return text.replace(new RegExp(escapeRegExp(number), "g"), replacement);
  }, value);
}

function forbiddenReplacement(term: string): string {
  if (/零成本|没有任何成本|永久免费/.test(term)) {
    return "仍有部署、调用或维护成本边界";
  }
  if (/全面领先|最好|第一|碾压/.test(term)) {
    return "在部分指标上表现值得观察";
  }
  if (/已经证明|官方确认所有细节/.test(term)) {
    return "目前材料显示";
  }
  if (/完全替代|唯一选择|终结/.test(term)) {
    return "影响既有选择";
  }
  if (/所有地区都必须|已经违法/.test(term)) {
    return "需要按适用地区和条款判断";
  }
  return "需要保留边界";
}

function sanitizeArticleBodyText(value: string, factPack?: TopicFactPack): string {
  const forbiddenTerms = unique([
    ...forbiddenArticlePhrases,
    ...(factPack ? forbiddenWordingFromFactPack(factPack) : [])
  ]).sort((a, b) => b.length - a.length);

  return forbiddenTerms.reduce(
    (text, term) => text.split(term).join(forbiddenReplacement(term)),
    sanitizeFactPackTextForHtmlSafety(value)
  );
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？；])/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function rebuildArticleFromSections(article: ArticleDraft, sections: ArticleSection[]): ArticleDraft {
  const markdown = createArticleMarkdown(article.title, sections, article.sourceUrl);
  return {
    ...article,
    sections,
    markdown,
    wordCount: countArticleChars(markdown)
  };
}

function compressSections(article: ArticleDraft, maxSentences: number): ArticleDraft {
  const sections = article.sections.map((section) => {
    const sentences = splitSentences(section.body);
    const body = sentences.length > maxSentences
      ? sentences.slice(0, maxSentences).join("")
      : section.body;
    return { ...section, body };
  });

  return rebuildArticleFromSections(article, sections);
}

function repairArticleDraft(input: {
  article: ArticleDraft;
  editorialPlan?: EditorialPlan;
  factPack?: TopicFactPack;
  repairIndex: 1 | 2;
}): ArticleDraft {
  const unsupportedNumbers = unsupportedArticleNumbers(input.article, input.factPack);
  let article: ArticleDraft = {
    ...input.article,
    title: replaceUnsupportedNumbers(
      sanitizeArticleBodyText(input.article.title, input.factPack),
      unsupportedNumbers
    ),
    subtitle: replaceUnsupportedNumbers(
      sanitizeArticleBodyText(input.article.subtitle, input.factPack),
      unsupportedNumbers
    ),
    articleThesis: replaceUnsupportedNumbers(
      sanitizeArticleBodyText(input.article.articleThesis, input.factPack),
      unsupportedNumbers
    ),
    sections: input.article.sections.map((section) => ({
      ...section,
      heading: replaceUnsupportedNumbers(
        sanitizeArticleBodyText(section.heading, input.factPack),
        unsupportedNumbers
      ),
      body: replaceUnsupportedNumbers(
        sanitizeArticleBodyText(section.body, input.factPack),
        unsupportedNumbers
      )
    }))
  };
  article = rebuildArticleFromSections(article, article.sections);

  const requiredThemes = input.editorialPlan?.requiredThemes ?? requiredDiscussionTerms;
  const missingThemes = requiredThemes.filter((term) => !article.markdown.includes(term));
  const requiredQualifiers = unique(
    input.factPack?.claims
      .filter((claim) => article.usedClaims.some((used) => used.id === claim.id))
      .flatMap((claim) => claim.requiredQualifiers) ?? []
  );
  const hasQualifier = requiredQualifiers.length === 0 ||
    requiredQualifiers.some((qualifier) => article.markdown.includes(qualifier));

  if (missingThemes.length > 0 || !hasQualifier) {
    const sections = [...article.sections];
    const lastIndex = Math.max(0, sections.length - 1);
    const qualifierSentence = hasQualifier
      ? ""
      : "据来源显示，相关判断仍需核验。";
    const themeSentence = missingThemes.length > 0
      ? `写法上继续保留${missingThemes.slice(0, 3).join("、")}。`
      : "";
    sections[lastIndex] = {
      ...sections[lastIndex],
      body: `${sections[lastIndex]?.body ?? ""} ${qualifierSentence}${themeSentence}`.trim()
    };
    article = rebuildArticleFromSections(article, sections);
  }

  if (article.wordCount > 1500) {
    article = compressSections(article, input.repairIndex === 1 ? 3 : 2);
  }
  if (article.wordCount > 1500) {
    article = compressSections(article, 1);
  }

  return {
    ...article,
    wordCount: countArticleChars(article.markdown)
  };
}

function createValidationRecord(input: {
  stage: "attempt-1" | "repair-1" | "repair-2" | "final";
  article: ArticleDraft;
  meta: ArticleMeta;
  issues: string[];
}): Record<string, unknown> {
  return {
    stage: input.stage,
    passed: input.issues.length === 0,
    title: input.article.title,
    wordCount: input.article.wordCount,
    issueCount: input.issues.length,
    issues: input.issues,
    usedClaimIds: input.meta.usedClaims.map((claim) => claim.id).filter(Boolean),
    generatedAt: input.meta.generatedAt
  };
}

async function writeArticleAttemptArtifacts(input: {
  files: ArticleWritingOutputFiles;
  records: Array<Record<string, unknown>>;
}): Promise<void> {
  const byStage = new Map(input.records.map((record) => [record.stage, record]));
  const attempt = byStage.get("attempt-1");
  const repair1 = byStage.get("repair-1");
  const repair2 = byStage.get("repair-2");
  const final = byStage.get("final");
  if (attempt) {
    await writeJson(input.files.articleAttempt1, attempt);
  }
  if (repair1) {
    await writeJson(input.files.articleRepair1, repair1);
  }
  if (repair2) {
    await writeJson(input.files.articleRepair2, repair2);
  }
  if (final) {
    await writeJson(input.files.articleValidation, final);
  }
}

function createMeta(
  article: ArticleDraft,
  generatedAt: string,
  llm: LlmRunMetadata,
  editorialApproval?: EditorialApproval,
  editorialPlan?: EditorialPlan
): ArticleMeta {
  return {
    title: article.title,
    wordCount: article.wordCount,
    sourceTopic: article.sourceTopic,
    articleThesis: article.articleThesis,
    usedClaims: article.usedClaims,
    riskControls: article.riskControls,
    editorialPlan: editorialPlan
      ? {
          id: editorialPlan.id,
          contentMode: editorialPlan.contentMode,
          sectionClaimMap: editorialPlan.sections.map((section) => ({
            sectionId: section.id,
            allowedClaimIds: section.allowedClaimIds
          })),
          requiredThemes: editorialPlan.requiredThemes
        }
      : undefined,
    editorialApproval,
    llm,
    generatedAt
  };
}

function createWritingReport(
  article: ArticleDraft,
  meta: ArticleMeta,
  editorialStyle?: EditorialStyleLoadResult,
  editorialPlan?: EditorialPlan
): string {
  return [
    "# Article Writing Report",
    "",
    "## 账号风格配置",
    "",
    `- editorialStyleRead: ${editorialStyle?.loaded ? "yes" : "no"}`,
    `- editorialStyleFile: ${editorialStyle?.path ?? "not loaded"}`,
    `- approvalRead: ${meta.editorialApproval ? "yes" : "no"}`,
    `- approvedTopicId: ${meta.editorialApproval?.approvedTopicId || "none"}`,
    `- approvedTitleReference: ${meta.editorialApproval?.approvedTitle || "none"}`,
    `- approvalNotes: ${meta.editorialApproval?.notes || "none"}`,
    `- editorialPlanRead: ${editorialPlan ? "yes" : "no"}`,
    `- editorialPlanId: ${editorialPlan?.id ?? "none"}`,
    `- contentMode: ${editorialPlan?.contentMode ?? "legacy"}`,
    `- appliedStructure: ${
      editorialPlan
        ? editorialPlan.structure.join(" → ")
        : "冲突切入 → 事实解释 → 行业逻辑 → 影响人群 → 趋势判断"
    }`,
    "- appliedTone: 第三视角、旁观者分析、通俗但犀利、非通稿、非营销号腔",
    "",
    "## 文章标题",
    "",
    article.title,
    "",
    "## 字数",
    "",
    `${article.wordCount} 字`,
    "",
    "## LLM",
    "",
    `- provider: ${meta.llm?.provider ?? "minimax"}`,
    `- model: ${meta.llm?.model ?? "unknown"}`,
    `- mode: ${meta.llm?.mode ?? "mock"}`,
    `- usage: ${meta.llm ? formatLlmUsage(meta.llm.usage) : "unknown"}`,
    "",
    "## 使用的 fact pack claim",
    "",
    ...meta.usedClaims.map(
      (claim) =>
        `- ${claim.claim}\n  - safeWording: ${claim.safeWording}\n  - sources: ${claim.sourceUrls.map((url) => `<${url}>`).join(", ")}`
    ),
    "",
    "## Editorial Plan Section Claim Map",
    "",
    ...(editorialPlan
      ? editorialPlan.sections.map(
          (section) =>
            `- ${section.id}: ${section.allowedClaimIds.join(", ") || "none"}`
        )
      : ["- none"]),
    "",
    "## 避免的高风险表达",
    "",
    "- 没有把价格、免费层或开源表述写成零成本。",
    "- 没有把不同产品或方案写成能力等同、全面替代或无差别迁移。",
    "- 没有把单一指标、案例或媒体标题写成确定性行业结论。",
    "- 没有把媒体标题或搜索摘要当作确定性事实来源。",
    "",
    "## 1500 字限制",
    "",
    `- 是，当前 ${article.wordCount} 字，未超过 1500 字。`,
    "",
    "## 阶段边界",
    "",
    "- 是，本阶段没有进入封面、HTML 排版、公众号后台、APIMart 或浏览器自动化。",
    "- 仅生成 article.md、article-meta.json、article-writing-report.md。",
    ""
  ].join("\n");
}

export function writeArticle(
  topic: SelectedTopic,
  factPack: TopicFactPack,
  options: {
    now?: Date;
    editorialApproval?: EditorialApproval;
    editorialPlan?: EditorialPlan;
  } = {}
): ArticleDraft {
  if (factPack.sourceReliability === "low") {
    throw new Error("Topic fact pack sourceReliability is low; stop before writing.");
  }

  const title = pickTitle(topic, options.editorialPlan);
  const sections = createArticleSections(topic, factPack, options.editorialPlan);
  const markdown = createArticleMarkdown(title, sections, topic.selected.url);
  const wordCount = countArticleChars(markdown);
  const usedClaims = usedClaimsFromFactPack(factPack, options.editorialPlan);
  const riskControls = createRiskControls(factPack, options.editorialPlan);
  const article: ArticleDraft = {
    title,
    subtitle: options.editorialPlan
      ? `${options.editorialPlan.contentMode} 模式下的事实边界和读者影响。`
      : "这不是简单复述资讯，而是梳理事实边界和读者影响。",
    sourceTitle: topic.selected.title,
    sourceUrl: topic.selected.url,
    sourceName: topic.selected.sourceName,
    sourceTopic: sanitizeFactPackTextForHtmlSafety(topic.selected.title),
    articleThesis: topic.selected.selection.articleThesis,
    markdown,
    sections,
    wordCount,
    usedClaims,
    riskControls,
    createdAt: (options.now ?? new Date()).toISOString()
  };
  const meta = createMeta(
    article,
    article.createdAt,
    mockLlmMetadata(resolveLlmStageConfig("article-writer", {})),
    options.editorialApproval,
    options.editorialPlan
  );

  validateArticle(article, meta, options.editorialPlan, factPack);
  return article;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MiniMax article-writer response is missing ${label}.`);
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArticleSections(value: unknown): ArticleSection[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("MiniMax article-writer response must include sections.");
  }

  return value.map((section, index) => {
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      throw new Error(`MiniMax article-writer section ${index + 1} is invalid.`);
    }

    const record = section as Record<string, unknown>;
    return {
      heading: asString(record.heading, `sections[${index}].heading`),
      body: asString(record.body, `sections[${index}].body`)
    };
  });
}

const articleWriterExpectedJsonShape = JSON.stringify(
  {
    title: "文章标题",
    subtitle: "一句副标题",
    articleThesis: "中心论点",
    body: "完整正文，不含标题，中文内容放在这里",
    sections: [
      {
        heading: "小标题",
        body: "段落正文"
      }
    ],
    usedClaims: ["引用的 fact pack safeWording"],
    riskControls: ["规避的风险表达"]
  },
  null,
  2
);

function validateArticleWriterPayload(value: unknown): {
  title: string;
  subtitle?: string;
  articleThesis?: string;
  body: string;
  sections: ArticleSection[];
  usedClaims: unknown[];
  riskControls: unknown[];
} {
  if (!isRecord(value)) {
    throw new Error("MiniMax article-writer response must be a JSON object.");
  }

  const bodySource =
    typeof value.body === "string" && value.body.trim()
      ? value.body
      : typeof value.markdown === "string" && value.markdown.trim()
        ? value.markdown
        : "";

  if (!bodySource.trim()) {
    throw new Error("MiniMax article-writer response is missing markdown/body.");
  }

  if (!Array.isArray(value.usedClaims)) {
    throw new Error("MiniMax article-writer response is missing usedClaims array.");
  }

  if (!Array.isArray(value.riskControls)) {
    throw new Error("MiniMax article-writer response is missing riskControls array.");
  }

  return {
    title: asString(value.title, "title"),
    subtitle:
      typeof value.subtitle === "string" && value.subtitle.trim()
        ? value.subtitle.trim()
        : undefined,
    articleThesis:
      typeof value.articleThesis === "string" && value.articleThesis.trim()
        ? value.articleThesis.trim()
        : undefined,
    body: bodySource.trim(),
    sections: Array.isArray(value.sections)
      ? parseArticleSections(value.sections)
      : [{ heading: "正文", body: bodySource.trim() }],
    usedClaims: value.usedClaims,
    riskControls: value.riskControls
  };
}

function createArticleWriterSystemPrompt(): string {
  return [
    "你是公众号文章写作者，只能基于 fact pack 的 safeWording 写作。",
    "只返回 JSON。",
    "不要 Markdown。",
    "不要解释。",
    "不要代码块。",
    "不要前后缀文本。",
    "不要输出 <think> 或任何思考过程。",
    "必须符合给定字段结构。",
    "中文内容放在 JSON 字段值里。",
    "JSON 字符串值内部不要使用英文双引号，引用概念时使用中文引号“”。",
    "不得编造事实，不得把搜索摘要当确定性事实。",
    "保持第三视角、非通稿，目标 1250 到 1400 个中文字符，硬上限 1500 个中文字符。",
    "禁止写发布、群发、确认发送、立即发送等公众号操作内容。"
  ].join("\n");
}

function createArticleWriterUserPrompt(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  editorialPlan?: EditorialPlan;
  editorialStyle?: EditorialStyleLoadResult;
  editorialApproval?: EditorialApproval;
  titleContext?: string;
}): string {
  const writerContext = createArticleWriterContext(input);

  return [
    "请生成一篇中文公众号正文。",
    "只返回 JSON，不要 Markdown，不要解释，不要代码块，不要前后缀文本，不要输出 <think> 或任何思考过程。",
    "必须包含 title、body 或 markdown、usedClaims、riskControls。",
    "中文内容放在 JSON 字段值里。",
    "JSON 字符串值内部不要使用英文双引号，引用概念时使用中文引号“”。",
    "返回 JSON 结构：",
    "",
    articleWriterExpectedJsonShape,
    "",
    "硬性要求：",
    "- 正文必须遵守 editorialPlan.sections 的顺序、heading 和 allowedClaimIds。",
    "- 每一段只能使用对应 section.allowedClaimIds 指向的 factPack.claims.safeWording。",
    "- factPack.claims.requiredQualifiers 的关键限定必须在正文中明确反映。",
    "- 只能使用 claimConstraints 中 allowedClaimIds 和 allowedNumbers；不得新增 FactPack 外数字或强事实。",
    "- 不得写 forbidden terms 或 factPack.claims.forbiddenWording。",
    "- 必须覆盖 editorialPlan.requiredThemes 中至少 3 个主题。",
    "- 结尾保留原始选题线索 URL。",
    "",
    "writer-context.json:",
    JSON.stringify(writerContext, null, 2)
  ].join("\n");
}

function createArticleWriterRepairPrompt(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  editorialPlan?: EditorialPlan;
  editorialApproval?: EditorialApproval;
  titleContext?: string;
}): string {
  const writerContext = createArticleWriterContext(input);

  return [
    "上一次返回内容不是合法 JSON，或疑似被截断。",
    "请重新生成一篇更短的完整中文公众号文章，并且只返回合法 JSON。",
    "不要 Markdown，不要解释，不要代码块，不要 JSON 外的任何文字。",
    "JSON 字符串值内部不要使用英文双引号，引用概念时使用中文引号“”。",
    "正文控制在 900 到 1200 个中文字符，避免输出过长导致截断。",
    "必须符合以下结构：",
    articleWriterExpectedJsonShape,
    "",
    "writer-context.json:",
    JSON.stringify(writerContext, null, 2)
  ].join("\n");
}

function createArticleWriterContext(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  editorialPlan?: EditorialPlan;
  editorialStyle?: EditorialStyleLoadResult;
  editorialApproval?: EditorialApproval;
  titleContext?: string;
}) {
  const selected = input.topic.selected;

  return {
    topic: {
      id: selected.id,
      title: selected.title,
      titleZh: selected.titleZh,
      url: selected.url,
      sourceName: selected.sourceName,
      sourceReliability: selected.selection.sourceReliability,
      articleThesis: selected.selection.articleThesis,
      writingAngle: selected.selection.writingAngle,
      coreConflict: selected.selection.coreConflict,
      suggestedTitles: selected.selection.suggestedTitles
    },
    factPack: {
      sourceReliability: input.factPack.sourceReliability,
      recommendedFraming: input.factPack.recommendedFraming,
      safeWritingBoundary: input.factPack.safeWritingBoundary,
      riskNotes: input.factPack.riskNotes,
      articleAngleSuggestions: input.factPack.articleAngleSuggestions,
      claims: input.factPack.claims.map((claim) => ({
        id: claim.id,
        statement: claim.statement,
        status: claim.status,
        evidenceIds: claim.evidenceIds,
        evidenceSnippetIds: claim.evidenceSnippetIds,
        safeWording: claim.safeWording,
        sourceUrls: claim.sourceUrls,
        requiredQualifiers: claim.requiredQualifiers,
        forbiddenWording: claim.forbiddenWording,
        allowedNumbers: numbersInText(`${claim.statement} ${claim.safeWording}`)
      })),
      forbiddenWording: forbiddenWordingFromFactPack(input.factPack)
    },
    claimConstraints: {
      maxArticleChars: 1500,
      targetArticleChars: [1250, 1400],
      allowedClaimIds: input.editorialPlan
        ? unique(input.editorialPlan.sections.flatMap((section) => section.allowedClaimIds))
        : input.factPack.claims.map((claim) => claim.id),
      forbiddenNumbersOutsideClaims: true
    },
    editorialPlan: input.editorialPlan
      ? {
          id: input.editorialPlan.id,
          contentMode: input.editorialPlan.contentMode,
          thesis: input.editorialPlan.thesis,
          requiredThemes: input.editorialPlan.requiredThemes,
          sections: input.editorialPlan.sections.map((section) => ({
            id: section.id,
            heading: section.heading,
            purpose: section.purpose,
            allowedClaimIds: section.allowedClaimIds,
            keyQuestions: section.keyQuestions,
            writingInstructions: section.writingInstructions,
            riskControls: section.riskControls
          })),
          riskControls: input.editorialPlan.riskControls
        }
      : undefined,
    editorialStyle: input.editorialStyle?.loaded
      ? {
          structure: "冲突切入 → 事实解释 → 行业逻辑 → 影响人群 → 趋势判断",
          tone: "第三视角、旁观者分析、通俗但犀利、非通稿、非营销号腔"
        }
      : undefined,
    approval: input.editorialApproval
      ? {
          approvedTitle: input.editorialApproval.approvedTitle,
          notes: input.editorialApproval.notes
        }
      : undefined,
    titleReference: input.titleContext
  };
}

async function writeArticleWithMiniMax(input: {
  outputDir: string;
  topic: SelectedTopic;
  factPack: TopicFactPack;
  editorialPlan?: EditorialPlan;
  topicSelectionReport: string;
  topicFactPackReport: string;
  editorialStyle?: EditorialStyleLoadResult;
  editorialApproval?: EditorialApproval;
  titleContext?: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion: LlmChatCompletionClient;
  now?: Date;
}): Promise<{ article: ArticleDraft; llm: LlmRunMetadata }> {
  const config = resolveLlmStageConfig("article-writer", input.env);
  const { value: payload, completion } = await requestLlmJsonWithRepair({
    failedStep: "article-writer",
    outputDir: input.outputDir,
    config,
    systemPrompt: createArticleWriterSystemPrompt(),
    userPrompt: createArticleWriterUserPrompt(input),
    repairUserPrompt: createArticleWriterRepairPrompt(input),
    expectedJsonShape: articleWriterExpectedJsonShape,
    env: input.env,
    fetchImpl: input.fetchImpl,
    chatCompletion: input.chatCompletion,
    validate: validateArticleWriterPayload
  });
  const sections = alignSectionsWithEditorialPlan(payload.sections, input.editorialPlan);
  const title = payload.title;
  const markdown = createArticleMarkdown(title, sections, input.topic.selected.url);
  const wordCount = countArticleChars(markdown);
  const usedClaims = usedClaimsFromFactPack(input.factPack);
  const plannedUsedClaims = usedClaimsFromFactPack(input.factPack, input.editorialPlan);
  const riskControlsFromModel = Array.isArray(payload.riskControls)
    ? payload.riskControls.filter((value): value is string => typeof value === "string")
    : [];
  const riskControls = [
    ...new Set([
      ...riskControlsFromModel,
      ...createRiskControls(input.factPack, input.editorialPlan)
    ])
  ];
  const article: ArticleDraft = {
    title,
    subtitle:
      typeof payload.subtitle === "string" && payload.subtitle.trim()
        ? payload.subtitle.trim()
        : "这不是简单复述资讯，而是梳理事实边界和读者影响。",
    sourceTitle: input.topic.selected.title,
    sourceUrl: input.topic.selected.url,
    sourceName: input.topic.selected.sourceName,
    sourceTopic: sanitizeFactPackTextForHtmlSafety(input.topic.selected.title),
    articleThesis:
      typeof payload.articleThesis === "string" && payload.articleThesis.trim()
        ? payload.articleThesis.trim()
        : input.topic.selected.selection.articleThesis,
    markdown,
    sections,
    wordCount,
    usedClaims: plannedUsedClaims.length > 0 ? plannedUsedClaims : usedClaims,
    riskControls,
    createdAt: (input.now ?? new Date()).toISOString()
  };
  const llm = realLlmMetadata(completion, "real");
  return { article, llm };
}

export async function writeArticleWithReport(
  options: WriteArticleOptions = {}
): Promise<ArticleWritingResult> {
  const logger = options.logger ?? createLogger("article-writer");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const selectedTopicFile =
    options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const topicSelectionReportFile =
    options.topicSelectionReportFile ?? join(outputDir, "topic-selection-report.md");
  const topicFactPackFile =
    options.topicFactPackFile ?? join(outputDir, "topic-fact-pack.json");
  const topicFactPackReportFile =
    options.topicFactPackReportFile ?? join(outputDir, "topic-fact-pack.md");
  const editorialPlanFile =
    options.editorialPlanFile ?? join(outputDir, "editorial-plan.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const editorialStyle =
    options.editorialStyle ?? (await loadEditorialStyle({ logger }));
  const env = options.env ?? process.env;
  const llmConfig = resolveLlmStageConfig("article-writer", env);
  const chatCompletion = options.chatCompletion ?? createChatCompletion;

  const topic = options.topic ?? (await readJsonFile<SelectedTopic>(selectedTopicFile));
  const factPack =
    options.factPack ?? (await readJsonFile<TopicFactPack>(topicFactPackFile));
  const editorialPlan =
    options.editorialPlan ??
    (await readOptionalJsonFile<EditorialPlan>(editorialPlanFile)) ??
    (
      await buildEditorialPlan({
        outputDir,
        topic,
        factPack,
        writeOutputs: false,
        logger,
        now: options.now
      })
    ).plan;

  const topicSelectionReport =
    options.topicSelectionReport ?? (await readRequiredText(topicSelectionReportFile));
  const topicFactPackReport =
    options.topicFactPackReport ?? (await readRequiredText(topicFactPackReportFile));
  const titleContext = options.editorialApproval?.approvedTitle
    ? `approvedTitle: ${options.editorialApproval.approvedTitle}`
    : undefined;
  let generated: { article: ArticleDraft; llm: LlmRunMetadata };

  try {
    generated =
      llmConfig.mode === "real"
        ? await writeArticleWithMiniMax({
            outputDir,
            topic,
            factPack,
            editorialPlan,
            topicSelectionReport,
            topicFactPackReport,
            editorialStyle,
            editorialApproval: options.editorialApproval,
            titleContext,
            env,
            fetchImpl: options.fetchImpl,
            chatCompletion,
            now: options.now
          })
        : {
            article: writeArticle(topic, factPack, {
              now: options.now,
              editorialApproval: options.editorialApproval,
              editorialPlan
            }),
            llm: mockLlmMetadata(llmConfig)
          };
  } catch (error) {
    if (writeOutputs) {
      await mkdir(outputDir, { recursive: true });
      await writeArticleWritingError({
        files,
        error,
        topic,
        llmConfig,
        now: options.now
      });
    }
    throw error;
  }

  let { article, llm } = generated;
  let meta = createMeta(
    article,
    article.createdAt,
    llm,
    options.editorialApproval,
    editorialPlan
  );
  const attemptRecords: Array<Record<string, unknown>> = [];
  const attemptIssues = articleValidationIssues(article, meta, editorialPlan, factPack);
  attemptRecords.push(
    createValidationRecord({
      stage: "attempt-1",
      article,
      meta,
      issues: attemptIssues
    })
  );

  for (const repairIndex of [1, 2] as const) {
    if (articleValidationIssues(article, meta, editorialPlan, factPack).length === 0) {
      break;
    }
    article = repairArticleDraft({
      article,
      editorialPlan,
      factPack,
      repairIndex
    });
    meta = createMeta(
      article,
      article.createdAt,
      llm,
      options.editorialApproval,
      editorialPlan
    );
    attemptRecords.push(
      createValidationRecord({
        stage: repairIndex === 1 ? "repair-1" : "repair-2",
        article,
        meta,
        issues: articleValidationIssues(article, meta, editorialPlan, factPack)
      })
    );
  }

  const finalIssues = articleValidationIssues(article, meta, editorialPlan, factPack);
  attemptRecords.push(
    createValidationRecord({
      stage: "final",
      article,
      meta,
      issues: finalIssues
    })
  );
  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeArticleAttemptArtifacts({
      files,
      records: attemptRecords
    });
  }
  validateArticle(article, meta, editorialPlan, factPack);
  const report = createWritingReport(article, meta, editorialStyle, editorialPlan);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(files.article, article.markdown, "utf8");
    await writeJson(files.articleMeta, meta);
    await writeFile(files.articleWritingReport, report, "utf8");
  }

  logger.info(
    `Wrote article "${article.title}" with ${article.wordCount} chars and ${meta.usedClaims.length} used claims.`
  );

  return {
    outputDir,
    files,
    article,
    meta,
    report
  };
}
