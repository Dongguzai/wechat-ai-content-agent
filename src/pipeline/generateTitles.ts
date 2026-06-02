import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countArticleChars } from "./writeArticle.js";
import { createChatCompletion } from "../adapters/minimax.js";
import {
  formatLlmUsage,
  mockLlmMetadata,
  realLlmMetadata,
  resolveLlmStageConfig
} from "../adapters/llm.js";
import { loadEditorialFeedback } from "./loadEditorialFeedback.js";
import { loadEditorialStyle } from "./loadEditorialStyle.js";
import type { ArticleMeta } from "../types/article.js";
import type {
  EditorialApproval,
  EditorialStyleLoadResult
} from "../types/editorial.js";
import type { EditorialFeedbackLoadResult } from "../types/feedback.js";
import type { TopicFactPack } from "../types/factPack.js";
import type { SelectedTopic } from "../types/news.js";
import type {
  TitleCandidate,
  TitleCandidatesFile,
  TitleCandidateKind,
  TitleGenerationOutputFiles,
  TitleGenerationResult,
  TitleSelectionSummary
} from "../types/title.js";
import type {
  LlmChatCompletionClient,
  LlmFetch,
  LlmRunMetadata
} from "../types/llm.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { requestLlmJsonWithRepair } from "../utils/llmJson.js";

export interface GenerateTitlesOptions {
  outputDir?: string;
  articleFile?: string;
  articleMetaFile?: string;
  selectedTopicFile?: string;
  topicFactPackFile?: string;
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  selectedTopic?: SelectedTopic;
  factPack?: TopicFactPack;
  editorialStyle?: EditorialStyleLoadResult;
  editorialApproval?: EditorialApproval;
  feedback?: EditorialFeedbackLoadResult;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion?: LlmChatCompletionClient;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

export const FORBIDDEN_TITLE_TERMS = [
  "震惊",
  "炸了",
  "史上",
  "必看",
  "封神",
  "内幕",
  "彻底",
  "终结",
  "碾压",
  "吊打",
  "全网都在",
  "免费平替",
  "免费替代高价工具",
  "完全替代",
  "完全一样",
  "能力相同",
  "能力完全一样",
  "零成本",
  "没有任何成本",
  "$200",
  "200/month",
  "200 美元",
  "200美元",
  "确认发送",
  "立即发送",
  "群发"
] as const;

const candidateLabels: Record<TitleCandidateKind, string> = {
  judgement: "判断型标题",
  contrast: "反差型标题",
  trend: "趋势型标题",
  publicImpact: "普通人影响型标题",
  techDiscussion: "技术圈讨论型标题"
};

function createOutputFiles(outputDir: string): TitleGenerationOutputFiles {
  return {
    titleCandidates: join(outputDir, "title-candidates.json"),
    titleSelectionReport: join(outputDir, "title-selection-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readableLength(value: string): number {
  return [...value.replace(/\s/g, "")].length;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function textWithoutTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty === -1) {
    return markdown;
  }

  return lines.slice(firstNonEmpty + 1).join("\n");
}

function replaceMarkdownTitle(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonEmpty === -1) {
    return `${title}\n`;
  }

  const nextLines = [...lines];
  nextLines[firstNonEmpty] = title;
  return nextLines.join("\n");
}

function keywordSet(value: string): Set<string> {
  const keywords = [
    "AI",
    "编码代理",
    "Claude Code",
    "Goose",
    "开源",
    "工作流",
    "成本",
    "价格",
    "工具锁定",
    "开发者",
    "团队",
    "入口",
    "基础设施",
    "趋势"
  ];

  return new Set(keywords.filter((keyword) => value.includes(keyword)));
}

function findForbiddenTerms(
  title: string,
  factPack: TopicFactPack
): string[] {
  const terms = new Set<string>(FORBIDDEN_TITLE_TERMS);
  for (const unsafe of factPack.comparison.unsafeComparisonClaims) {
    terms.add(unsafe);
  }

  const violations = [...terms].filter((term) => title.includes(term));
  if (
    /Goose.{0,12}(免费|开源).{0,12}(平替|替代|取代).{0,12}Claude Code/.test(title) ||
    /Claude Code.{0,12}(被)?Goose.{0,12}(平替|替代|取代)/.test(title)
  ) {
    violations.push("暗示 Goose 免费替代 Claude Code");
  }

  return [...new Set(violations)];
}

function createRawCandidates(
  topic: SelectedTopic,
  approvedTitleReference?: string
): Array<{
  kind: TitleCandidateKind;
  title: string;
  rationale: string;
}> {
  const thesis = topic.selected.selection.articleThesis;
  const isCodingAgentTopic = /Claude Code|Goose|编码代理|coding agent/i.test(
    `${topic.selected.title} ${thesis}`
  );

  if (!isCodingAgentTopic) {
    const genericCandidates: Array<{
      kind: TitleCandidateKind;
      title: string;
      rationale: string;
    }> = [
      {
        kind: "judgement",
        title: approvedTitleReference || "AI 工具真正改变的，不是功能，而是工作流",
        rationale: approvedTitleReference
          ? "来自人工确认标题参考，仍会经过 forbidden terms 检查。"
          : "用判断句压住观点，避免复述资讯。"
      },
      {
        kind: "contrast",
        title: "这条 AI 新闻的反差，不在表面热闹",
        rationale: "保留反差感，但不放大未经核验的事实。"
      },
      {
        kind: "trend",
        title: "AI 应用开始从功能竞争转向流程竞争",
        rationale: "把选题放入趋势判断。"
      },
      {
        kind: "publicImpact",
        title: "普通人会先感到变化，行业才会重新洗牌",
        rationale: "强调影响人群，不写厂商口吻。"
      },
      {
        kind: "techDiscussion",
        title: "技术圈争论背后，是工作流入口之争",
        rationale: "给技术读者留下讨论空间。"
      }
    ];
    return genericCandidates;
  }

  return [
    {
      kind: "judgement",
      title:
        approvedTitleReference || "AI 编码代理真正卷到的，不是价格，而是工作流",
      rationale: approvedTitleReference
        ? "来自人工确认标题参考，仍会经过 forbidden terms 检查。"
        : "判断明确，贴合文章中心论点，避免胜负式标题。"
    },
    {
      kind: "contrast",
      title: "Claude Code 和 Goose 的分歧，不止在价格",
      rationale: "保留反差，但不写免费替代或能力等同。"
    },
    {
      kind: "trend",
      title: "编码代理开始从付费产品走向开源基础设施",
      rationale: "把单条资讯放进行业趋势。"
    },
    {
      kind: "publicImpact",
      title: "AI 写代码变成账单后，团队要重新算成本",
      rationale: "解释普通团队和非技术决策者会感到的变化。"
    },
    {
      kind: "techDiscussion",
      title: "开发者争论 Goose，背后是工作流入口之争",
      rationale: "给技术圈讨论点，但不引向能力胜负。"
    }
  ];
}

function scoreCandidate(input: {
  kind: TitleCandidateKind;
  title: string;
  rationale: string;
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  factPack: TopicFactPack;
  feedback?: EditorialFeedbackLoadResult;
}): TitleCandidate {
  const { kind, title, rationale, articleMarkdown, articleMeta, factPack, feedback } =
    input;
  const titleLength = readableLength(title);
  const body = textWithoutTitle(articleMarkdown);
  const titleKeywords = keywordSet(title);
  const thesisKeywords = keywordSet(`${articleMeta.articleThesis} ${body}`);
  const overlap = [...titleKeywords].filter((keyword) => thesisKeywords.has(keyword));
  const forbiddenTerms = findForbiddenTerms(title, factPack);
  const clickbaitPenalty = /(震惊|炸了|史上|必看|封神|内幕|彻底|终结|碾压|吊打|全网都在)/.test(
    title
  )
    ? 45
    : 0;
  const feedbackTitleQuality = feedback?.latest?.titleQuality ?? 0;
  const stricterFromFeedback = feedbackTitleQuality > 0 && feedbackTitleQuality < 3;

  const spreadScore = clampScore(
    72 +
      (/(不是|而是|不止|开始|背后|重新|真正)/.test(title) ? 15 : 4) +
      (titleLength >= 14 && titleLength <= 28 ? 8 : -6)
  );
  const accuracyScore = clampScore(
    96 - forbiddenTerms.length * 35 - (/\$|200/.test(title) ? 20 : 0)
  );
  const nonClickbaitScore = clampScore(
    100 - clickbaitPenalty - forbiddenTerms.length * 25 - (stricterFromFeedback ? 3 : 0)
  );
  const wechatFitScore = clampScore(
    82 +
      (titleLength >= 12 && titleLength <= 30 ? 12 : -10) +
      (/[，：]/.test(title) ? 3 : 0) -
      (titleLength > 36 ? 20 : 0)
  );
  const thesisMatchScore = clampScore(
    66 + overlap.length * 8 + (title.includes("工作流") ? 10 : 0)
  );
  const finalScore = clampScore(
    spreadScore * 0.2 +
      accuracyScore * 0.25 +
      nonClickbaitScore * 0.2 +
      wechatFitScore * 0.15 +
      thesisMatchScore * 0.2
  );

  return {
    kind,
    kindLabel: candidateLabels[kind],
    title,
    rationale,
    spreadScore,
    accuracyScore,
    nonClickbaitScore,
    wechatFitScore,
    thesisMatchScore,
    finalScore,
    violations: forbiddenTerms
  };
}

function createFeedbackSummary(feedback: EditorialFeedbackLoadResult): string | undefined {
  if (!feedback.latest) {
    return undefined;
  }

  return `最近反馈 ${feedback.latest.date}《${feedback.latest.title}》：topicQuality=${feedback.latest.topicQuality}, titleQuality=${feedback.latest.titleQuality}, notes=${feedback.latest.notes || "none"}`;
}

function createSelectionReason(selected: TitleCandidate): string {
  return [
    `${selected.kindLabel}得分最高且无 forbidden terms。`,
    `它的 spreadScore=${selected.spreadScore}、accuracyScore=${selected.accuracyScore}、nonClickbaitScore=${selected.nonClickbaitScore}、wechatFitScore=${selected.wechatFitScore}、thesisMatchScore=${selected.thesisMatchScore}，能够兼顾传播、准确性和中心论点。`,
    "标题没有暗示未经 fact pack 支撑的免费替代、能力等同或确定性胜负。"
  ].join(" ");
}

function createSelection(
  candidates: TitleCandidate[],
  input: {
    generatedAt: string;
    editorialStyle: EditorialStyleLoadResult;
    feedback: EditorialFeedbackLoadResult;
    editorialApproval?: EditorialApproval;
    llm: LlmRunMetadata;
  }
): TitleSelectionSummary {
  const eligible = candidates.filter((candidate) => candidate.violations.length === 0);
  if (eligible.length === 0) {
    throw new Error("No safe title candidate remains after forbidden term checks.");
  }

  const selected = [...eligible].sort(
    (left, right) =>
      right.finalScore - left.finalScore ||
      right.accuracyScore - left.accuracyScore ||
      right.nonClickbaitScore - left.nonClickbaitScore
  )[0];

  return {
    generatedAt: input.generatedAt,
    selectedTitle: selected.title,
    selectedKind: selected.kind,
    selectionReason: createSelectionReason(selected),
    candidates,
    forbiddenTerms: [...FORBIDDEN_TITLE_TERMS],
    approvedTitleReference: input.editorialApproval?.approvedTitle || undefined,
    editorialStyleRead: input.editorialStyle.loaded,
    feedbackRead: input.feedback.feedbackRead,
    feedbackSummary: createFeedbackSummary(input.feedback),
    llm: input.llm
  };
}

function createReport(selection: TitleSelectionSummary): string {
  const lines = selection.candidates.flatMap((candidate) => [
    `### ${candidate.kindLabel}`,
    "",
    `- title: ${candidate.title}`,
    `- spreadScore: ${candidate.spreadScore}`,
    `- accuracyScore: ${candidate.accuracyScore}`,
    `- nonClickbaitScore: ${candidate.nonClickbaitScore}`,
    `- wechatFitScore: ${candidate.wechatFitScore}`,
    `- thesisMatchScore: ${candidate.thesisMatchScore}`,
    `- finalScore: ${candidate.finalScore}`,
    `- violations: ${candidate.violations.length > 0 ? candidate.violations.join(" / ") : "none"}`,
    `- rationale: ${candidate.rationale}`,
    ""
  ]);

  return [
    "# Title Selection Report",
    "",
    `Generated at: ${selection.generatedAt}`,
    "",
    "## v0.3.1 输入",
    "",
    `- editorialStyleRead: ${selection.editorialStyleRead ? "yes" : "no"}`,
    `- feedbackRead: ${selection.feedbackRead ? "yes" : "no"}`,
    `- feedbackSummary: ${selection.feedbackSummary ?? "none"}`,
    `- approvedTitleReference: ${selection.approvedTitleReference ?? "none"}`,
    `- llmProvider: ${selection.llm?.provider ?? "minimax"}`,
    `- llmModel: ${selection.llm?.model ?? "unknown"}`,
    `- llmMode: ${selection.llm?.mode ?? "mock"}`,
    `- llmUsage: ${selection.llm ? formatLlmUsage(selection.llm.usage) : "unknown"}`,
    "",
    "## 最终标题",
    "",
    selection.selectedTitle,
    "",
    "## 选择理由",
    "",
    selection.selectionReason,
    "",
    "## 候选标题评分",
    "",
    ...lines,
    "## 安全边界",
    "",
    "- 禁止标题党。",
    "- 禁止违反 fact pack 安全边界。",
    "- 禁止出现 title generator 定义的 forbidden terms。",
    ""
  ].join("\n");
}

export function generateTitleCandidates(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  editorialApproval?: EditorialApproval;
  feedback?: EditorialFeedbackLoadResult;
}): TitleCandidate[] {
  return createRawCandidates(
    input.topic,
    input.editorialApproval?.approvedTitle
  ).map((candidate) =>
    scoreCandidate({
      ...candidate,
      articleMarkdown: input.articleMarkdown,
      articleMeta: input.articleMeta,
      factPack: input.factPack,
      feedback: input.feedback
    })
  );
}

function createTitleGeneratorSystemPrompt(): string {
  return [
    "你是安全的微信公众号标题生成器。",
    "只返回 JSON。",
    "不要 Markdown。",
    "不要解释。",
    "不要代码块。",
    "不要前后缀文本。",
    "不要输出 <think> 或任何思考过程。",
    "必须符合给定字段结构。",
    "中文内容放在 JSON 字段值里。",
    "必须遵守 fact pack 安全边界，不得标题党。",
    "不得写免费平替、完全替代、能力相同、零成本、发布、群发等 forbidden terms。"
  ].join("\n");
}

const titleGeneratorExpectedJsonShape = JSON.stringify(
  {
    candidates: [
      {
        type: "judgement",
        title: "标题",
        rationale: "生成理由",
        scores: {
          spread: 80,
          accuracy: 90,
          nonClickbait: 90,
          wechatFit: 85,
          thesisMatch: 88
        }
      }
    ],
    finalSelectedTitle: "必须是 candidates 中的一个 title"
  },
  null,
  2
);

function createTitleGeneratorUserPrompt(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  editorialStyle: EditorialStyleLoadResult;
  feedback: EditorialFeedbackLoadResult;
  editorialApproval?: EditorialApproval;
}): string {
  return [
    "请生成 5 个中文公众号标题候选，必须各 1 个 type：judgement, contrast, trend, publicImpact, techDiscussion。",
    "只返回 JSON，不要 Markdown，不要解释，不要代码块，不要前后缀文本，不要输出 <think> 或任何思考过程。",
    "字段 type 必须使用 judgement, contrast, trend, publicImpact, techDiscussion 之一。",
    "每个候选必须包含 type、title、rationale、scores。",
    "finalSelectedTitle 必须存在，且必须是 candidates 中的一个 title。",
    "返回 JSON 结构：",
    titleGeneratorExpectedJsonShape,
    "",
    "article.md:",
    input.articleMarkdown,
    "",
    "article-meta.json:",
    JSON.stringify(input.articleMeta, null, 2),
    "",
    "selected-topic.json:",
    JSON.stringify(input.topic, null, 2),
    "",
    "topic-fact-pack.json:",
    JSON.stringify(input.factPack, null, 2),
    "",
    "editorial-style.md:",
    input.editorialStyle.content,
    "",
    "feedback:",
    input.feedback.latest ? JSON.stringify(input.feedback.latest, null, 2) : "none",
    "",
    "editorial-approval.json:",
    input.editorialApproval
      ? JSON.stringify(input.editorialApproval, null, 2)
      : "not provided",
    "",
    "approved title reference:",
    input.editorialApproval?.approvedTitle || "none"
  ].join("\n");
}

function isTitleCandidateKind(value: unknown): value is TitleCandidateKind {
  return (
    value === "judgement" ||
    value === "contrast" ||
    value === "trend" ||
    value === "publicImpact" ||
    value === "techDiscussion"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasTitleScores(record: Record<string, unknown>): boolean {
  if (isRecord(record.scores)) {
    return Object.values(record.scores).some(
      (value) => typeof value === "number" && Number.isFinite(value)
    );
  }

  return [
    "spreadScore",
    "accuracyScore",
    "nonClickbaitScore",
    "wechatFitScore",
    "thesisMatchScore",
    "finalScore",
    "score"
  ].some((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
}

function parseRawTitleCandidates(value: unknown): Array<{
  kind: TitleCandidateKind;
  title: string;
  rationale: string;
}> {
  if (!Array.isArray(value)) {
    throw new Error("MiniMax title-generator response must include candidates.");
  }

  const candidates = value.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error(`MiniMax title candidate ${index + 1} is invalid.`);
    }

    const record = candidate as Record<string, unknown>;
    const kind = record.type ?? record.kind;
    if (!isTitleCandidateKind(kind)) {
      throw new Error(
        `MiniMax title candidate ${index + 1} is missing valid type.`
      );
    }

    if (typeof record.title !== "string" || !record.title.trim()) {
      throw new Error(`MiniMax title candidate ${index + 1} is missing title.`);
    }

    if (!hasTitleScores(record)) {
      throw new Error(`MiniMax title candidate ${index + 1} is missing scores.`);
    }

    return {
      kind,
      title: record.title.trim(),
      rationale:
        typeof record.rationale === "string" && record.rationale.trim()
          ? record.rationale.trim()
          : "MiniMax generated title candidate."
    };
  });
  const requiredKinds: TitleCandidateKind[] = [
    "judgement",
    "contrast",
    "trend",
    "publicImpact",
    "techDiscussion"
  ];
  const missingKinds = requiredKinds.filter(
    (kind) => !candidates.some((candidate) => candidate.kind === kind)
  );

  if (candidates.length !== 5 || missingKinds.length > 0) {
    throw new Error(
      `MiniMax title-generator must return exactly 5 candidates with all required kinds; missing=${missingKinds.join(", ") || "none"}.`
    );
  }

  return requiredKinds.map(
    (kind) => candidates.find((candidate) => candidate.kind === kind)!
  );
}

function validateTitleGeneratorPayload(value: unknown): {
  candidates: Array<{
    kind: TitleCandidateKind;
    title: string;
    rationale: string;
  }>;
  finalSelectedTitle: string;
} {
  if (!isRecord(value)) {
    throw new Error("MiniMax title-generator response must be a JSON object.");
  }

  const candidates = parseRawTitleCandidates(value.candidates);
  const finalSelectedTitle =
    typeof value.finalSelectedTitle === "string" && value.finalSelectedTitle.trim()
      ? value.finalSelectedTitle.trim()
      : typeof value.selectedTitle === "string" && value.selectedTitle.trim()
        ? value.selectedTitle.trim()
        : "";

  if (!finalSelectedTitle) {
    throw new Error("MiniMax title-generator response is missing finalSelectedTitle.");
  }

  if (!candidates.some((candidate) => candidate.title === finalSelectedTitle)) {
    throw new Error(
      "MiniMax title-generator finalSelectedTitle must match one candidate title."
    );
  }

  return {
    candidates,
    finalSelectedTitle
  };
}

async function generateTitleCandidatesWithMiniMax(input: {
  outputDir: string;
  topic: SelectedTopic;
  factPack: TopicFactPack;
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  editorialStyle: EditorialStyleLoadResult;
  feedback: EditorialFeedbackLoadResult;
  editorialApproval?: EditorialApproval;
  env: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion: LlmChatCompletionClient;
}): Promise<{ candidates: TitleCandidate[]; llm: LlmRunMetadata }> {
  const config = resolveLlmStageConfig("title-generator", input.env);
  const { value: payload, completion } = await requestLlmJsonWithRepair({
    failedStep: "title-generator",
    outputDir: input.outputDir,
    config,
    systemPrompt: createTitleGeneratorSystemPrompt(),
    userPrompt: createTitleGeneratorUserPrompt(input),
    expectedJsonShape: titleGeneratorExpectedJsonShape,
    env: input.env,
    fetchImpl: input.fetchImpl,
    chatCompletion: input.chatCompletion,
    validate: validateTitleGeneratorPayload
  });
  const rawCandidates = payload.candidates;

  return {
    candidates: rawCandidates.map((candidate) =>
      scoreCandidate({
        ...candidate,
        articleMarkdown: input.articleMarkdown,
        articleMeta: input.articleMeta,
        factPack: input.factPack,
        feedback: input.feedback
      })
    ),
    llm: realLlmMetadata(completion, "real")
  };
}

function createTitleCandidatesFile(selection: TitleSelectionSummary): TitleCandidatesFile {
  if (!selection.llm) {
    throw new Error("Title selection is missing LLM metadata.");
  }

  return {
    generatedAt: selection.generatedAt,
    selectedTitle: selection.selectedTitle,
    selectedKind: selection.selectedKind,
    candidates: selection.candidates,
    forbiddenTerms: selection.forbiddenTerms,
    approvedTitleReference: selection.approvedTitleReference,
    llm: selection.llm
  };
}

export async function generateTitlesWithReport(
  options: GenerateTitlesOptions = {}
): Promise<TitleGenerationResult> {
  const logger = options.logger ?? createLogger("title-generator");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const files = createOutputFiles(outputDir);
  const articleFile = options.articleFile ?? join(outputDir, "article.md");
  const articleMetaFile = options.articleMetaFile ?? join(outputDir, "article-meta.json");
  const selectedTopicFile =
    options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const topicFactPackFile =
    options.topicFactPackFile ?? join(outputDir, "topic-fact-pack.json");
  const writeOutputs = options.writeOutputs ?? true;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const env = options.env ?? process.env;
  const llmConfig = resolveLlmStageConfig("title-generator", env);
  const chatCompletion = options.chatCompletion ?? createChatCompletion;

  const [articleMarkdown, articleMeta, topic, factPack, editorialStyle, feedback] =
    await Promise.all([
      options.articleMarkdown ?? readFile(articleFile, "utf8"),
      options.articleMeta ?? readJsonFile<ArticleMeta>(articleMetaFile),
      options.selectedTopic ?? readJsonFile<SelectedTopic>(selectedTopicFile),
      options.factPack ?? readJsonFile<TopicFactPack>(topicFactPackFile),
      options.editorialStyle ?? loadEditorialStyle({ logger }),
      options.feedback ?? loadEditorialFeedback({ logger })
    ]);

  const { candidates, llm } =
    llmConfig.mode === "real"
      ? await generateTitleCandidatesWithMiniMax({
          outputDir,
          topic,
          factPack,
          articleMarkdown,
          articleMeta,
          editorialStyle,
          feedback,
          editorialApproval: options.editorialApproval,
          env,
          fetchImpl: options.fetchImpl,
          chatCompletion
        })
      : {
          candidates: generateTitleCandidates({
            topic,
            factPack,
            articleMarkdown,
            articleMeta,
            editorialApproval: options.editorialApproval,
            feedback
          }),
          llm: mockLlmMetadata(llmConfig)
        };
  const selection = createSelection(candidates, {
    generatedAt,
    editorialStyle,
    feedback,
    editorialApproval: options.editorialApproval,
    llm
  });
  const selectedCandidate = candidates.find(
    (candidate) => candidate.title === selection.selectedTitle
  );

  if (!selectedCandidate) {
    throw new Error("Selected title is missing from title candidates.");
  }

  const updatedMarkdown = replaceMarkdownTitle(
    articleMarkdown,
    selection.selectedTitle
  );
  const updatedMeta: ArticleMeta = {
    ...articleMeta,
    title: selection.selectedTitle,
    wordCount: countArticleChars(updatedMarkdown),
    generatedAt
  };
  const report = createReport(selection);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.titleCandidates, createTitleCandidatesFile(selection));
    await writeFile(files.titleSelectionReport, report, "utf8");
    await writeFile(articleFile, updatedMarkdown, "utf8");
    await writeJson(articleMetaFile, updatedMeta);
  }

  logger.info(
    `Generated ${candidates.length} title candidates; selected "${selection.selectedTitle}".`
  );

  return {
    outputDir,
    files,
    candidates,
    selectedCandidate,
    selection,
    articleMarkdown: updatedMarkdown,
    articleMeta: updatedMeta,
    report
  };
}
