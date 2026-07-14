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

function isGenericFactPack(factPack: TopicFactPack): boolean {
  return factPack.schemaVersion === "2.0";
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
  const keywords = titleKeywordUniverse(value);

  return new Set(keywords.filter((keyword) => value.includes(keyword)));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function shortText(value: string | undefined, fallback: string, maxLength = 18): string {
  const text = (value ?? fallback)
    .replace(/[#*_`>\[\]()]/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!text) {
    return fallback;
  }

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function titleKeywordUniverse(value: string): string[] {
  const extractedTerms = value.match(/[\u4e00-\u9fa5A-Za-z0-9/.-]{2,16}/g) ?? [];

  return unique([
    "AI",
    "模型",
    "产品",
    "工具",
    "研究",
    "政策",
    "融资",
    "并购",
    "案例",
    "事故",
    "安全",
    "价格",
    "成本",
    "benchmark",
    "测试",
    "指标",
    "发布",
    "更新",
    "影响",
    "边界",
    "风险",
    "开发者",
    "团队",
    "企业",
    "普通人",
    "创作者",
    "工作流",
    "流程",
    "入口",
    "趋势",
    ...extractedTerms
  ]);
}

function eventLabelFromMeta(articleMeta: ArticleMeta): string {
  const themes = articleMeta.editorialPlan?.requiredThemes ?? [];
  if (themes.includes("价格")) {
    return "价格";
  }
  if (themes.includes("测试")) {
    return "测试";
  }
  if (themes.includes("政策")) {
    return "政策";
  }
  if (themes.includes("融资")) {
    return "融资";
  }
  if (themes.includes("研究")) {
    return "研究";
  }
  if (themes.includes("案例")) {
    return "案例";
  }
  if (themes.includes("影响")) {
    return "影响";
  }
  if (themes.includes("发布")) {
    return "发布";
  }

  return themes[0] ?? "变化";
}

function primaryAudience(topic: SelectedTopic, articleMeta: ArticleMeta): string {
  const source = [
    topic.selected.editorial?.audienceFit,
    articleMeta.articleThesis,
    articleMeta.sourceTopic
  ].join("\n");

  if (/企业|团队|组织/.test(source)) {
    return "团队";
  }
  if (/开发者|工程/.test(source)) {
    return "开发者";
  }
  if (/创作者|内容/.test(source)) {
    return "创作者";
  }
  if (/普通|用户/.test(source)) {
    return "普通用户";
  }

  return "读者";
}

function claimTextForIds(factPack: TopicFactPack, claimIds: string[]): string {
  const idSet = new Set(claimIds);
  return factPack.claims
    .filter((claim) => idSet.has(claim.id))
    .map((claim) => `${claim.statement} ${claim.safeWording}`)
    .join("\n");
}

function claimIdsForTitle(title: string, factPack: TopicFactPack): string[] {
  const matches = factPack.claims
    .filter((claim) => {
      const claimText = `${claim.statement} ${claim.safeWording}`;
      const terms = unique([
        ...claimText.match(/[\u4e00-\u9fa5A-Za-z0-9/.-]{2,12}/g) ?? [],
        ...claim.riskDimensions,
        ...claim.requiredQualifiers
      ]);
      return terms.some((term) => title.includes(term));
    })
    .map((claim) => claim.id);

  return matches.length > 0
    ? unique(matches)
    : factPack.claims.slice(0, 1).map((claim) => claim.id);
}

function matchedThemesForTitle(title: string, articleMeta: ArticleMeta): string[] {
  return unique(
    (articleMeta.editorialPlan?.requiredThemes ?? []).filter((theme) =>
      title.includes(theme)
    )
  );
}

function titleContainsUnsupportedNumber(title: string, factPack: TopicFactPack): boolean {
  const numbers = title.match(/\d+(?:\.\d+)?\s*(?:%|美元|美金|亿|万|倍|x|X|分|年|月|天|小时|分钟)?/g) ?? [];
  if (numbers.length === 0) {
    return false;
  }

  const claimText = factPack.claims
    .map((claim) => `${claim.statement} ${claim.safeWording}`)
    .join("\n");

  return numbers.some((number) => !claimText.includes(number.trim()));
}

function titleContainsHardFactWithoutClaim(title: string, factPack: TopicFactPack): boolean {
  const hardFactPattern = /(价格|融资|估值|benchmark|测试|指标|合规|法规|事故|泄露|收购|并购|正式发布|全面开放)/;
  if (!hardFactPattern.test(title)) {
    return false;
  }

  return claimIdsForTitle(title, factPack).length === 0;
}

function findForbiddenTerms(
  title: string,
  factPack: TopicFactPack
): string[] {
  const terms = new Set<string>(FORBIDDEN_TITLE_TERMS);
  for (const unsafe of factPack.claims.flatMap((claim) => claim.forbiddenWording)) {
    terms.add(unsafe);
  }

  const violations = [...terms].filter((term) => title.includes(term));

  if (
    isGenericFactPack(factPack) &&
    /(默认流程|写进默认|已经落地|全面落地|已经证明|官方确认|成为标准|接管流程)/.test(title)
  ) {
    violations.push("通用资讯标题过度落地");
  }

  return [...new Set(violations)];
}

function createRawCandidates(
  topic: SelectedTopic,
  input: {
    factPack: TopicFactPack;
    articleMeta: ArticleMeta;
    articleMarkdown: string;
    approvedTitleReference?: string;
  }
): Array<{
  kind: TitleCandidateKind;
  title: string;
  rationale: string;
  sourceClaimIds: string[];
  matchedThemes: string[];
}> {
  const { factPack, articleMeta, approvedTitleReference } = input;
  const eventLabel = eventLabelFromMeta(articleMeta);
  const audience = primaryAudience(topic, articleMeta);
  const topicSignal = shortText(
    topic.selected.titleZh || topic.selected.rawTitle || topic.selected.title,
    "这条 AI 资讯",
    16
  );
  const thesisSignal = shortText(articleMeta.articleThesis, "事实边界", 12);
  const firstSection = articleMeta.editorialPlan?.sectionClaimMap[0];
  const secondSection = articleMeta.editorialPlan?.sectionClaimMap[1];
  const firstClaimText = shortText(
    claimTextForIds(factPack, firstSection?.allowedClaimIds ?? []),
    "来源边界",
    10
  );
  const secondClaimText = shortText(
    claimTextForIds(factPack, secondSection?.allowedClaimIds ?? []),
    eventLabel,
    10
  );
  const rawCandidates = [
    {
      kind: "judgement" as const,
      title:
        approvedTitleReference ||
        `${topicSignal}，真正要看的是${thesisSignal}`,
      rationale: approvedTitleReference
        ? "来自人工确认标题参考，仍会经过 forbidden terms 和 claim 支撑检查。"
        : "用选题主题加中心论点生成判断型标题。"
    },
    {
      kind: "contrast" as const,
      title: `${eventLabel}的反差，不在热闹而在${firstClaimText}`,
      rationale: "用 EditorialPlan 的来源边界制造反差，不补写 fact pack 外事实。"
    },
    {
      kind: "trend" as const,
      title: `AI ${eventLabel}开始考验${secondClaimText}`,
      rationale: "把正文第二段的事实或核验问题转成趋势视角。"
    },
    {
      kind: "publicImpact" as const,
      title: `${audience}最该关注的，是这次${eventLabel}边界`,
      rationale: "根据选题受众生成影响型标题，避免厂商口吻。"
    },
    {
      kind: "techDiscussion" as const,
      title: `技术圈争论${eventLabel}，其实是在争${thesisSignal}`,
      rationale: "保留讨论感，但落在文章 thesis 和动态主题上。"
    }
  ];

  return rawCandidates.map((candidate) => ({
    ...candidate,
    title:
      candidate.kind === "judgement" && approvedTitleReference
        ? approvedTitleReference
        : shortText(candidate.title, candidate.title, 30),
    sourceClaimIds: claimIdsForTitle(candidate.title, factPack),
    matchedThemes: matchedThemesForTitle(candidate.title, articleMeta)
  }));
}

function scoreCandidate(input: {
  kind: TitleCandidateKind;
  title: string;
  rationale: string;
  sourceClaimIds?: string[];
  matchedThemes?: string[];
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  factPack: TopicFactPack;
  feedback?: EditorialFeedbackLoadResult;
}): TitleCandidate {
  const { kind, title, rationale, articleMarkdown, articleMeta, factPack, feedback } =
    input;
  const titleLength = readableLength(title);
  const body = textWithoutTitle(articleMarkdown);
  const sourceClaimIds = input.sourceClaimIds ?? claimIdsForTitle(title, factPack);
  const matchedThemes = input.matchedThemes ?? matchedThemesForTitle(title, articleMeta);
  const titleKeywords = keywordSet(`${title} ${matchedThemes.join(" ")}`);
  const thesisKeywords = keywordSet(`${articleMeta.articleThesis} ${body}`);
  const overlap = [...titleKeywords].filter((keyword) => thesisKeywords.has(keyword));
  const unsupportedNumber = titleContainsUnsupportedNumber(title, factPack);
  const hardFactWithoutClaim = titleContainsHardFactWithoutClaim(title, factPack);
  const forbiddenTerms = [
    ...findForbiddenTerms(title, factPack),
    ...(unsupportedNumber ? ["标题数字缺少 claim 支撑"] : []),
    ...(hardFactWithoutClaim ? ["标题强事实缺少 claim 支撑"] : [])
  ];
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
    96 -
      forbiddenTerms.length * 35 -
      (/\$|200/.test(title) ? 20 : 0) +
      Math.min(sourceClaimIds.length, 3) * 3
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
    64 +
      overlap.length * 7 +
      matchedThemes.length * 8 +
      (articleMeta.editorialPlan?.contentMode &&
      title.includes(eventLabelFromMeta(articleMeta))
        ? 6
        : 0)
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
    sourceClaimIds,
    matchedThemes,
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
    `- sourceClaimIds: ${candidate.sourceClaimIds.join(", ") || "none"}`,
    `- matchedThemes: ${candidate.matchedThemes.join(" / ") || "none"}`,
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
    {
      factPack: input.factPack,
      articleMeta: input.articleMeta,
      articleMarkdown: input.articleMarkdown,
      approvedTitleReference: input.editorialApproval?.approvedTitle
    }
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
    "通用资讯线索不得写成默认流程、已经落地、官方确认或成为标准。",
    "不得写免费平替、完全替代、能力相同、零成本、发布、群发等 forbidden terms；具体禁用表述以 fact pack 为准。"
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
    "标题必须围绕 article-meta.editorialPlan.requiredThemes 和正文中心论点。",
    "如果标题出现数字、价格、benchmark、融资金额、监管义务、事故影响范围等强事实，必须能在 topic-fact-pack.claims 中找到对应支撑。",
    "不要复用无关旧专题结构，不要强行写工作流、成本或开源，除非这些主题来自 editorialPlan 或正文。",
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
    candidates: rawCandidates.map((candidate) => {
      const sourceClaimIds = claimIdsForTitle(candidate.title, input.factPack);
      return scoreCandidate({
        ...candidate,
        sourceClaimIds,
        matchedThemes: matchedThemesForTitle(candidate.title, input.articleMeta),
        articleMarkdown: input.articleMarkdown,
        articleMeta: input.articleMeta,
        factPack: input.factPack,
        feedback: input.feedback
      });
    }),
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
