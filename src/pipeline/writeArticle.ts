import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatCompletion } from "../adapters/minimax.js";
import {
  formatLlmUsage,
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
import type { EditorialStyleLoadResult } from "../types/editorial.js";
import type {
  LlmChatCompletionClient,
  LlmChatCompletionResult,
  LlmFetch,
  LlmRunMetadata
} from "../types/llm.js";
import { createLogger, type Logger } from "../utils/logger.js";
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
  "免费平替",
  "免费替代高价工具",
  "完全替代",
  "$200",
  "能力相同",
  "直接互换"
];

const requiredDiscussionTerms = ["开源", "工作流", "成本", "工具锁定"];

function createOutputFiles(outputDir: string): ArticleWritingOutputFiles {
  return {
    article: join(outputDir, "article.md"),
    articleMeta: join(outputDir, "article-meta.json"),
    articleWritingReport: join(outputDir, "article-writing-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function readRequiredText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function createRiskControls(): string[] {
  return [
    "高价订阅价格只对应 Claude 高阶个人订阅方案边界，不写成 Claude Code 的单独固定价格。",
    "Goose 的免费表述限定为工具本体免费开源，同时说明外部模型调用可能产生 API Key、订阅或按量费用。",
    "二者比较只写成部分 coding agent 工作流有重叠，不写能力等同或无差别迁移。",
    "VentureBeat 标题只作为选题线索，正文事实边界来自 fact pack 的 safeWording。",
    "本阶段只生成公众号正文、meta 和写作报告，不进入封面、HTML 排版、APIMart、后台或浏览器自动化。"
  ];
}

function createArticleSections(factPack: TopicFactPack): ArticleSection[] {
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
  llm: LlmRunMetadata
): ArticleMeta {
  return {
    title: article.title,
    wordCount: article.wordCount,
    sourceTopic: article.sourceTopic,
    articleThesis: article.articleThesis,
    usedClaims: article.usedClaims,
    riskControls: article.riskControls,
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
  options: { now?: Date } = {}
): ArticleDraft {
  if (factPack.sourceReliability === "low") {
    throw new Error("Topic fact pack sourceReliability is low; stop before writing.");
  }

  const title = pickTitle(topic);
  const sections = createArticleSections(factPack);
  const markdown = createArticleMarkdown(title, sections, topic.selected.url);
  const wordCount = countArticleChars(markdown);
  const usedClaims = usedClaimsFromFactPack(factPack);
  const riskControls = createRiskControls();
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
    mockLlmMetadata(resolveLlmStageConfig("article-writer", {}))
  );

  validateArticle(article, meta);
  return article;
}

function parseJsonContent<T>(completion: LlmChatCompletionResult): T {
  try {
    return JSON.parse(completion.content) as T;
  } catch {
    throw new Error("MiniMax article-writer response was not valid JSON.");
  }
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MiniMax article-writer response is missing ${label}.`);
  }

  return value.trim();
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

function createArticleWriterSystemPrompt(): string {
  return [
    "你是公众号文章写作者，只能基于 fact pack 的 safeWording 写作。",
    "输出必须是 JSON object，不要输出 Markdown 围栏。",
    "不得编造事实，不得把搜索摘要当确定性事实。",
    "保持第三视角、非通稿、1500 字以内。",
    "禁止写发布、群发、确认发送、立即发送等公众号操作内容。"
  ].join("\n");
}

function createArticleWriterUserPrompt(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  topicSelectionReport: string;
  topicFactPackReport: string;
  editorialStyle?: EditorialStyleLoadResult;
  titleContext?: string;
}): string {
  return [
    "请生成一篇中文公众号正文，返回 JSON：",
    "",
    JSON.stringify(
      {
        title: "文章标题",
        subtitle: "一句副标题",
        articleThesis: "中心论点",
        sections: [
          {
            heading: "小标题",
            body: "段落正文"
          }
        ],
        riskControls: ["规避的风险表达"]
      },
      null,
      2
    ),
    "",
    "硬性要求：",
    "- 正文必须使用 fact pack safeWritingBoundary 和 verifiedClaims.safeWording。",
    "- 不得写 forbidden terms 或 unsafeComparisonClaims。",
    "- 必须解释开源、工作流、成本、工具锁定中的至少 3 个主题。",
    "- 结尾保留原始选题线索 URL。",
    "",
    "selected-topic.json:",
    JSON.stringify(input.topic, null, 2),
    "",
    "topic-fact-pack.json:",
    JSON.stringify(input.factPack, null, 2),
    "",
    "topic-selection-report.md:",
    input.topicSelectionReport,
    "",
    "topic-fact-pack.md:",
    input.topicFactPackReport,
    "",
    "editorial-style.md:",
    input.editorialStyle?.content ?? "not loaded",
    "",
    "title-candidates or selected title if present:",
    input.titleContext ?? "not available"
  ].join("\n");
}

async function writeArticleWithMiniMax(input: {
  topic: SelectedTopic;
  factPack: TopicFactPack;
  topicSelectionReport: string;
  topicFactPackReport: string;
  editorialStyle?: EditorialStyleLoadResult;
  titleContext?: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion: LlmChatCompletionClient;
  now?: Date;
}): Promise<{ article: ArticleDraft; llm: LlmRunMetadata }> {
  const config = resolveLlmStageConfig("article-writer", input.env);
  const completion = await input.chatCompletion({
    model: config.model,
    systemPrompt: createArticleWriterSystemPrompt(),
    userPrompt: createArticleWriterUserPrompt(input),
    temperature: config.temperature,
    maxCompletionTokens: config.maxCompletionTokens,
    responseFormat: "json_object",
    env: input.env,
    fetchImpl: input.fetchImpl
  });
  const payload = parseJsonContent<Record<string, unknown>>(completion);
  const sections = parseArticleSections(payload.sections);
  const title = asString(payload.title, "title");
  const markdown = createArticleMarkdown(title, sections, input.topic.selected.url);
  const wordCount = countArticleChars(markdown);
  const usedClaims = usedClaimsFromFactPack(input.factPack);
  const riskControlsFromModel = Array.isArray(payload.riskControls)
    ? payload.riskControls.filter((value): value is string => typeof value === "string")
    : [];
  const riskControls = [
    ...new Set([...riskControlsFromModel, ...createRiskControls()])
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
  const meta = createMeta(article, article.createdAt, llm);

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
  const titleContext = await readOptionalText(join(outputDir, "title-candidates.json"));
  const { article, llm } =
    llmConfig.mode === "real"
      ? await writeArticleWithMiniMax({
          topic,
          factPack,
          topicSelectionReport,
          topicFactPackReport,
          editorialStyle,
          titleContext,
          env,
          fetchImpl: options.fetchImpl,
          chatCompletion,
          now: options.now
        })
      : {
          article: writeArticle(topic, factPack, { now: options.now }),
          llm: mockLlmMetadata(llmConfig)
        };
  const meta = createMeta(article, article.createdAt, llm);
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
