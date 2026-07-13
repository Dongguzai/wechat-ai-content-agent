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
import type {
  LlmChatCompletionClient,
  LlmFetch,
  LlmRunMetadata
} from "../types/llm.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { requestLlmJsonWithRepair } from "../utils/llmJson.js";
import { loadEditorialStyle } from "./loadEditorialStyle.js";

export interface WriteArticleOptions {
  outputDir?: string;
  selectedTopicFile?: string;
  topicSelectionReportFile?: string;
  topicFactPackFile?: string;
  topicFactPackReportFile?: string;
  topic?: SelectedTopic;
  topicSelectionReport?: string;
  factPack?: TopicFactPack;
  topicFactPackReport?: string;
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
  "Goose 完全替代 Claude Code",
  "Goose 和 Claude Code 完全一样",
  "Goose 零成本",
  "Claude Code 必须花 $200 才能用",
  "Claude Code 是单独固定 $200/month 工具",
  "Claude Code 必须花两百美元级别月费才能用",
  "Claude Code 是单独固定两百美元级别月费工具",
  "免费平替",
  "免费替代高价工具",
  "完全替代",
  "能力相同",
  "直接互换"
];

const requiredDiscussionTerms = ["开源", "工作流", "成本", "工具锁定"];

function createOutputFiles(outputDir: string): ArticleWritingOutputFiles {
  return {
    article: join(outputDir, "article.md"),
    articleMeta: join(outputDir, "article-meta.json"),
    articleWritingReport: join(outputDir, "article-writing-report.md"),
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function pickTitle(topic: SelectedTopic): string {
  return (
    topic.selected.selection.suggestedTitles.find((title) =>
      title.includes("工作流")
    ) ?? "AI 编码代理真正卷到的，不是价格，而是工作流"
  );
}

function isGenericFactPack(factPack: TopicFactPack): boolean {
  return factPack.comparison.claudeCode.pricing.startsWith("不适用。");
}

function sanitizeFactPackTextForHtmlSafety(value: string): string {
  return value
    .replace(/Claude Code costs up to \$200 a month\. Goose does the same thing for free\./g, "Claude Code paid plans and Goose open-source workflow comparison.")
    .replace(/“up to \$200 a month”对应 Claude Max 20x 个人套餐价格，而不是 Claude Code 的单独固定价格。/g, "外界提到的高价订阅价格对应 Claude 高阶个人订阅方案，而不是 Claude Code 的单独固定价格。")
    .replace(/Anthropic 官方页面列出 Max 20x 为 \$200\/month；Claude Code 包含在 Pro\/Max 等付费 Claude 计划中，因此应写成“最高可到 \$200\/月的 Claude Max 20x 订阅可使用 Claude Code”，不能写成“Claude Code 必须 \$200\/月”。/g, "Claude Code 可以通过相关 Claude 付费计划使用，高阶套餐价格更高；不要写成 Claude Code 是单独固定高价工具。")
    .replace(/Goose 免费不等于零成本：使用 Anthropic、OpenAI、Google、Groq、OpenRouter 等模型时，可能需要 API Key、订阅或供应商侧费用。/g, "Goose 本身是免费开源项目，但接入模型服务仍可能产生 API 或订阅成本。")
    .replace(/“Goose does the same thing as Claude Code”是过度绝对的说法。/g, "媒体标题中“做同一件事”的说法需要降级为部分工作流重叠。")
    .replace(/不要写“能力完全一样”或“完全替代”/g, "不要写成能力边界一致或覆盖所有场景")
    .replace(/\$200(?:\/month|\/月)?/g, "高阶付费方案")
    .replace(/免费平替|免费替代高价工具/g, "开源替代路径")
    .replace(/完全替代/g, "覆盖所有场景")
    .replace(/能力完全一样|能力相同/g, "能力边界一致")
    .replace(/直接互换|全量互换/g, "无差别迁移")
    .replace(/零成本/g, "没有任何成本");
}

function usedClaimsFromFactPack(factPack: TopicFactPack): ArticleUsedClaim[] {
  return factPack.verifiedClaims.map((claim) => ({
    claim: sanitizeFactPackTextForHtmlSafety(claim.claim),
    safeWording: sanitizeFactPackTextForHtmlSafety(claim.safeWording),
    sourceUrls: claim.sourceUrls
  }));
}

function createRiskControls(factPack?: TopicFactPack): string[] {
  if (factPack && isGenericFactPack(factPack)) {
    return [
      "不把搜索摘要、中文化摘要或媒体标题当作官方确定事实。",
      "涉及参数、benchmark、任务解决率、上下文长度等指标时，只使用 fact pack safeWording 的谨慎表达。",
      "不复用无关旧专题事实，不把当前选题写成 Claude Code / Goose 价格对比。",
      "讨论开源、工作流、成本和工具锁定时，限定为对开发者与团队决策的观察维度。",
      "本阶段只生成公众号正文、meta 和写作报告，不进入封面、HTML 排版、APIMart、后台或浏览器自动化。"
    ];
  }

  return [
    "高价订阅价格只对应 Claude 高阶个人订阅方案边界，不写成 Claude Code 的单独固定价格。",
    "Goose 的免费表述限定为工具本体免费开源，同时说明外部模型调用可能产生 API Key、订阅或按量费用。",
    "二者比较只写成部分 coding agent 工作流有重叠，不写能力等同或无差别迁移。",
    "VentureBeat 标题只作为选题线索，正文事实边界来自 fact pack 的 safeWording。",
    "本阶段只生成公众号正文、meta 和写作报告，不进入封面、HTML 排版、APIMart、后台或浏览器自动化。"
  ];
}

function createGenericArticleSections(
  topic: SelectedTopic,
  factPack: TopicFactPack
): ArticleSection[] {
  const selected = topic.selected;
  const sourceTitle = selected.rawTitle || selected.titleZh || selected.title;
  const summary =
    selected.summaryZh ||
    selected.summary ||
    selected.rawSummary ||
    selected.selection.publicInterest;
  const boundary = factPack.safeWritingBoundary[2] ?? "具体指标和产品边界需要回到原文核验。";

  return [
    {
      heading: "先把边界说清",
      body:
        `${selected.sourceName} 的线索显示，${sourceTitle}。这类 AI 资讯适合写，但不能把搜索摘要或标题化表达直接当成官方结论。更稳的写法，是先交代来源，再把确定性降下来：${boundary}`
    },
    {
      heading: "真正值得看的不是热闹",
      body:
        `${summary} 这件事的价值，不只在某个参数或一句能力描述，而在它把模型更新继续推向智能体工作流。对开发者来说，重要问题是工具能不能进入真实项目；对产品团队来说，重要问题是它会不会改变功能设计、协作流程和交付节奏。`
    },
    {
      heading: "团队会重新算账",
      body:
        "一旦 AI 能力进入日常流程，成本就不只是模型调用费，还包括接入、权限、审计、稳定性和维护成本。开源方案可能降低试错门槛，闭源平台可能提供更完整的产品体验，但两边都会带来工具锁定和迁移成本。"
    },
    {
      heading: "怎么判断后续影响",
      body:
        `${selected.selection.writingAngle} 接下来更值得观察的是三个问题：它是否真的改变开发者工作流，相关指标是否能被原文或官方材料支撑，以及团队采用它时能否控制成本和权限边界。把这三点写清楚，比单纯复述“发布了什么”更有信息量。`
    },
    {
      heading: "结论",
      body:
        `${selected.selection.articleThesis} 这不是一句模型更新就能盖棺定论的事，而是 AI 产品竞争继续向工作流入口移动的信号。越接近真实业务流程，越需要把事实边界、成本结构和工具锁定讲明白。`
    }
  ];
}

function createArticleSections(topic: SelectedTopic, factPack: TopicFactPack): ArticleSection[] {
  if (isGenericFactPack(factPack)) {
    return createGenericArticleSections(topic, factPack);
  }

  return [
    {
      heading: "冲突先摆出来",
      body:
        "高价订阅和免费开源放在一起，冲突很直观：一边是 Claude Code，另一边是 Goose。但这件事不能被写成简单的价格口号。真正值得关注的是，coding agent 正在从聊天框里的能力，变成开发者日常工作流入口。"
    },
    {
      heading: "事实先说准确",
      body:
        "更准确的边界是：外界常说的高价订阅价格，更安全地对应 Claude 的高阶个人订阅方案，不是 Claude Code 的单独固定价格；Claude Code 可以随 Pro/Max 等订阅使用，也可能在 API Key/PAYG 或企业部署下产生不同费用，实际成本取决于计划、模型和用量。Goose 也不是没有账单的魔法，它是免费开源的本地 AI agent/开发者代理工具，但模型调用费用取决于接入的 LLM 提供商；部分提供商有免费层，付费模型仍可能产生费用。"
    },
    {
      heading: "行业逻辑是什么",
      body:
        "Claude Code 是 Anthropic 面向开发者的编码代理，可在项目中规划、修改代码、运行验证，并连接外部工具。Goose 则把类似工作流拆成开源、本地、可选模型的路径。两者都面向开发者自动化，能覆盖代码理解、文件修改、命令执行或项目级任务的一部分场景；但产品形态、模型后端、权限治理、交互体验和成熟度不同。闭源订阅工具把模型、交互、上下文和团队治理打包成入口；开源工具则把流程拆出来，让团队能自托管、换模型、接自己的权限系统和工程工具链。价格只是表层，背后是成本结构、可控性和工具锁定的重新计算。"
    },
    {
      heading: "谁会先被影响",
      body:
        "个人开发者会更在意每月订阅和 API 消耗，愿意用开源方案对冲成本。团队不会只看便宜，而会看权限、安全、审计、标准化和能不能接入既有研发流程。创业者看到的则是另一个信号：AI coding agent 可能从产品竞争进入基础设施竞争，未来的差异不只是谁模型强，而是谁占住工作流。内容创作者和普通用户，也会越来越常见“高价工具对开源方案”的叙事，但真正要看的是总成本，而不是一句价格对比。"
    },
    {
      heading: "趋势判断",
      body:
        "Goose 在部分 coding agent 工作流上与 Claude Code 有重叠，并提供开源、可自选模型的替代路径，但这不等于两者能力边界一致，也不代表可以无差别迁移。更稳的判断是：这不是简单的开源工具链选择，而是 coding agent 正在从付费产品变成开源基础设施的一次信号。 下一阶段，coding agent 的竞争重点会从“谁的模型更强”，转向“谁能占住开发者工作流入口”。谁掌握入口，谁就掌握预算、数据流和工具链的默认选择。"
    }
  ];
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

function validateArticle(article: ArticleDraft, meta: ArticleMeta): void {
  if (!article.title.trim()) {
    throw new Error("Article title is missing.");
  }

  if (article.wordCount > 1500) {
    throw new Error(`Article exceeds the 1500 character limit: ${article.wordCount}.`);
  }

  if (meta.usedClaims.length < 3) {
    throw new Error("article-meta.usedClaims must include at least 3 claims.");
  }

  if (meta.riskControls.length < 3) {
    throw new Error("article-meta.riskControls must include at least 3 controls.");
  }

  const forbidden = forbiddenArticlePhrases.find((phrase) =>
    article.markdown.includes(phrase)
  );
  if (forbidden) {
    throw new Error(`Article contains forbidden absolute wording: ${forbidden}`);
  }

  const coveredThemes = requiredDiscussionTerms.filter((term) =>
    article.markdown.includes(term)
  );
  if (coveredThemes.length < 3) {
    throw new Error(
      `Article must discuss at least 3 required themes; got ${coveredThemes.join(", ")}.`
    );
  }
}

function createMeta(
  article: ArticleDraft,
  generatedAt: string,
  llm: LlmRunMetadata,
  editorialApproval?: EditorialApproval
): ArticleMeta {
  return {
    title: article.title,
    wordCount: article.wordCount,
    sourceTopic: article.sourceTopic,
    articleThesis: article.articleThesis,
    usedClaims: article.usedClaims,
    riskControls: article.riskControls,
    editorialApproval,
    llm,
    generatedAt
  };
}

function createWritingReport(
  article: ArticleDraft,
  meta: ArticleMeta,
  editorialStyle?: EditorialStyleLoadResult
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
    "- appliedStructure: 冲突切入 → 事实解释 → 行业逻辑 → 影响人群 → 趋势判断",
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
    "## 避免的高风险表达",
    "",
    "- 没有把 Claude Code 写成单独固定高价工具。",
    "- 没有把 Goose 写成无任何成本的工具。",
    "- 没有把 Goose 和 Claude Code 写成能力等同、无差别迁移或胜负已定。",
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
  options: { now?: Date; editorialApproval?: EditorialApproval } = {}
): ArticleDraft {
  if (factPack.sourceReliability === "low") {
    throw new Error("Topic fact pack sourceReliability is low; stop before writing.");
  }

  const title = pickTitle(topic);
  const sections = createArticleSections(topic, factPack);
  const markdown = createArticleMarkdown(title, sections, topic.selected.url);
  const wordCount = countArticleChars(markdown);
  const usedClaims = usedClaimsFromFactPack(factPack);
  const riskControls = createRiskControls(factPack);
  const article: ArticleDraft = {
    title,
    subtitle: "这不是简单的价格对比，而是 coding agent 工作流入口之争。",
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
    options.editorialApproval
  );

  validateArticle(article, meta);
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
    "不得编造事实，不得把搜索摘要当确定性事实。",
    "保持第三视角、非通稿、1500 字以内。",
    "禁止写发布、群发、确认发送、立即发送等公众号操作内容。"
  ].join("\n");
}

function createArticleWriterUserPrompt(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
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
    "返回 JSON 结构：",
    "",
    articleWriterExpectedJsonShape,
    "",
    "硬性要求：",
    "- 正文必须使用 fact pack safeWritingBoundary 和 verifiedClaims.safeWording。",
    "- 每条 verifiedClaims.safeWording 的关键限定必须在正文中被明确反映，不能只写近似意思。",
    "- 如果涉及 Claude 高阶订阅价格，正文必须写出“高阶个人订阅方案”或“高阶套餐价格”，并明确“不是 Claude Code 的单独固定价格”。",
    "- 如果提到媒体标题中“做同一件事”的说法，正文必须明确写出“不等于两者能力边界一致”或“不代表可以无差别迁移”。",
    "- 不得写 forbidden terms 或 unsafeComparisonClaims。",
    "- 必须解释开源、工作流、成本、工具锁定中的至少 3 个主题。",
    "- 结尾保留原始选题线索 URL。",
    "",
    "writer-context.json:",
    JSON.stringify(writerContext, null, 2)
  ].join("\n");
}

function createArticleWriterRepairPrompt(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  editorialApproval?: EditorialApproval;
  titleContext?: string;
}): string {
  const writerContext = createArticleWriterContext(input);

  return [
    "上一次返回内容不是合法 JSON，或疑似被截断。",
    "请重新生成一篇更短的完整中文公众号文章，并且只返回合法 JSON。",
    "不要 Markdown，不要解释，不要代码块，不要 JSON 外的任何文字。",
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
      verifiedClaims: input.factPack.verifiedClaims.map((claim) => ({
        claim: claim.claim,
        safeWording: claim.safeWording,
        sourceUrls: claim.sourceUrls,
        risk: claim.risk
      })),
      unsafeComparisonClaims: input.factPack.comparison.unsafeComparisonClaims
    },
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
  const sections = payload.sections;
  const title = payload.title;
  const markdown = createArticleMarkdown(title, sections, input.topic.selected.url);
  const wordCount = countArticleChars(markdown);
  const usedClaims = usedClaimsFromFactPack(input.factPack);
  const riskControlsFromModel = Array.isArray(payload.riskControls)
    ? payload.riskControls.filter((value): value is string => typeof value === "string")
    : [];
  const riskControls = [
    ...new Set([...riskControlsFromModel, ...createRiskControls(input.factPack)])
  ];
  const article: ArticleDraft = {
    title,
    subtitle:
      typeof payload.subtitle === "string" && payload.subtitle.trim()
        ? payload.subtitle.trim()
        : "这不是简单的价格对比，而是 coding agent 工作流入口之争。",
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
    usedClaims,
    riskControls,
    createdAt: (input.now ?? new Date()).toISOString()
  };
  const llm = realLlmMetadata(completion, "real");
  const meta = createMeta(
    article,
    article.createdAt,
    llm,
    input.editorialApproval
  );

  validateArticle(article, meta);
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
              editorialApproval: options.editorialApproval
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

  const { article, llm } = generated;
  const meta = createMeta(
    article,
    article.createdAt,
    llm,
    options.editorialApproval
  );
  const report = createWritingReport(article, meta, editorialStyle);

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
