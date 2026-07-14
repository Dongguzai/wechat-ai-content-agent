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
  TopicContentMode,
  TopicEntity,
  TopicEventType,
  TopicPrimaryDomain,
  TopicProfile,
  TopicProfileOutputFiles,
  TopicProfileResult
} from "../types/topicProfile.js";
import type { SelectedTopic } from "../types/news.js";
import type {
  LlmChatCompletionClient,
  LlmFetch,
  LlmRunMetadata
} from "../types/llm.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { requestLlmJsonWithRepair } from "../utils/llmJson.js";

export interface ClassifyTopicOptions {
  outputDir?: string;
  selectedTopicFile?: string;
  topic?: SelectedTopic;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion?: LlmChatCompletionClient;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

const primaryDomains: TopicPrimaryDomain[] = [
  "model",
  "product",
  "tooling",
  "research",
  "business",
  "policy",
  "application",
  "creator",
  "security",
  "other"
];

const eventTypes: TopicEventType[] = [
  "launch",
  "update",
  "benchmark",
  "pricing",
  "funding",
  "acquisition",
  "regulation",
  "case_study",
  "incident",
  "opinion",
  "tutorial",
  "research_release"
];

const contentModes: TopicContentMode[] = [
  "news_analysis",
  "comparison",
  "explainer",
  "trend_analysis",
  "case_review",
  "practical_guide"
];

function createOutputFiles(outputDir: string): TopicProfileOutputFiles {
  return {
    topicProfileJson: join(outputDir, "topic-profile.json"),
    topicProfileReport: join(outputDir, "topic-profile-report.md")
  };
}

async function readSelectedTopic(path: string): Promise<SelectedTopic> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as SelectedTopic;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function topicText(topic: SelectedTopic): string {
  const selected = topic.selected;
  return [
    selected.title,
    selected.rawTitle,
    selected.titleZh,
    selected.summary,
    selected.rawSummary,
    selected.summaryZh,
    selected.sourceName,
    selected.url,
    selected.category,
    ...(selected.tags ?? []),
    selected.editorial.topicAngle,
    selected.selection.coreConflict,
    selected.selection.publicInterest,
    selected.selection.technicalSignificance,
    selected.selection.businessImpact,
    selected.selection.predictedImpact,
    selected.selection.writingAngle,
    selected.selection.articleThesis,
    ...selected.selection.riskNotes
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function inferPrimaryDomain(topic: SelectedTopic, text: string): TopicPrimaryDomain {
  if (hasAny(text, ["安全事故", "泄露", "漏洞", "暴露", "breach", "incident", "leak", "security"])) {
    return "security";
  }
  if (hasAny(text, ["创作者", "短视频", "故事板", "版权", "creator", "storyboard", "video"])) {
    return "creator";
  }
  if (hasAny(text, ["融资", "投资方", "估值", "收购", "并购", "funding", "series", "acquisition", "acquire"])) {
    return "business";
  }
  if (hasAny(text, ["法规", "政策", "监管", "合规", "司法辖区", "regulation", "policy", "ai act"])) {
    return "policy";
  }
  if (hasAny(text, ["客户案例", "应用案例", "制造企业", "质检", "case study", "customer story"])) {
    return "application";
  }
  if (hasAny(text, ["论文", "研究", "arxiv", "paper", "benchmark", "基准", "评测"])) {
    return "research";
  }
  if (hasAny(text, ["模型", "多模态", "长上下文", "语音", "model", "llm", "gpt", "gemini", "llama"])) {
    return "model";
  }
  if (hasAny(text, ["开源", "github", "框架", "api", "sdk", "工具", "计费", "定价", "套餐", "tooling"])) {
    return "tooling";
  }
  if (hasAny(text, ["产品", "功能", "工作区", "发布", "推出", "上线", "product", "release", "launch"])) {
    return "product";
  }

  const categoryMap: Partial<Record<string, TopicPrimaryDomain>> = {
    model: "model",
    product: "product",
    tooling: "tooling",
    research: "research",
    policy: "policy",
    funding: "business"
  };

  return categoryMap[topic.selected.category] ?? "other";
}

function inferEventTypes(text: string): TopicEventType[] {
  const matches: TopicEventType[] = [];

  if (hasAny(text, ["发布", "推出", "上线", "开放", "launch", "released", "announces"])) {
    matches.push("launch");
  }
  if (hasAny(text, ["更新", "新增", "调整", "升级", "版本", "update", "release", "v1.0", "1.0"])) {
    matches.push("update");
  }
  if (hasAny(text, ["benchmark", "基准", "评测", "评分", "榜单", "eval", "score"])) {
    matches.push("benchmark");
  }
  if (hasAny(text, ["定价", "价格", "套餐", "计费", "月付", "年付", "pricing", "subscription"])) {
    matches.push("pricing");
  }
  if (hasAny(text, ["融资", "轮融资", "投资方", "估值", "funding", "series"])) {
    matches.push("funding");
  }
  if (hasAny(text, ["收购", "并购", "acquisition", "acquire"])) {
    matches.push("acquisition");
  }
  if (hasAny(text, ["法规", "政策", "监管", "义务", "合规", "regulation", "policy"])) {
    matches.push("regulation");
  }
  if (hasAny(text, ["案例", "客户", "customer story", "case study"])) {
    matches.push("case_study");
  }
  if (hasAny(text, ["事故", "泄露", "漏洞", "暴露", "incident", "breach", "leak"])) {
    matches.push("incident");
  }
  if (hasAny(text, ["观点", "评论", "opinion", "analysis"])) {
    matches.push("opinion");
  }
  if (hasAny(text, ["教程", "指南", "迁移指南", "tutorial", "guide"])) {
    matches.push("tutorial");
  }
  if (hasAny(text, ["论文", "研究", "arxiv", "paper", "research"])) {
    matches.push("research_release");
  }

  return matches.length > 0 ? unique(matches) : ["opinion"];
}

function inferSecondaryDomains(primaryDomain: TopicPrimaryDomain, text: string): string[] {
  const domains: TopicPrimaryDomain[] = [];
  for (const domain of primaryDomains) {
    if (domain === primaryDomain || domain === "other") {
      continue;
    }
    if (
      (domain === "model" && hasAny(text, ["模型", "model", "llm"])) ||
      (domain === "product" && hasAny(text, ["产品", "功能", "工作区", "product"])) ||
      (domain === "tooling" && hasAny(text, ["工具", "api", "sdk", "github", "开源"])) ||
      (domain === "research" && hasAny(text, ["研究", "论文", "benchmark", "评测"])) ||
      (domain === "business" && hasAny(text, ["融资", "收购", "估值", "商业", "企业软件"])) ||
      (domain === "policy" && hasAny(text, ["政策", "监管", "合规", "义务"])) ||
      (domain === "application" && hasAny(text, ["应用", "案例", "制造", "质检"])) ||
      (domain === "creator" && hasAny(text, ["创作者", "视频", "版权", "故事板"])) ||
      (domain === "security" && hasAny(text, ["安全", "泄露", "漏洞", "权限"]))
    ) {
      domains.push(domain);
    }
  }

  return domains;
}

function inferRiskDimensions(text: string, events: TopicEventType[]): string[] {
  const risks: string[] = [];

  if (events.includes("launch") || events.includes("update")) {
    risks.push("发布时间", "可用范围", "功能边界");
  }
  if (events.includes("benchmark")) {
    risks.push("指标定义", "测试条件", "厂商自测", "第三方复现");
  }
  if (events.includes("pricing")) {
    risks.push("币种", "生效日期", "订阅与 API 差异", "免费层边界");
  }
  if (events.includes("funding")) {
    risks.push("融资金额", "轮次", "投资方", "估值确认状态");
  }
  if (events.includes("acquisition")) {
    risks.push("交易价格", "监管审批", "整合计划");
  }
  if (events.includes("regulation")) {
    risks.push("司法辖区", "生效时间", "适用对象", "实际义务");
  }
  if (events.includes("case_study")) {
    risks.push("供应商案例偏差", "指标口径", "可迁移性");
  }
  if (events.includes("incident")) {
    risks.push("影响范围", "披露时间线", "用户数据类型", "修复状态");
  }
  if (events.includes("research_release")) {
    risks.push("实验设置", "样本规模", "泛化限制");
  }
  if (hasAny(text, ["权限", "隐私", "数据"])) {
    risks.push("权限边界", "数据隐私");
  }
  if (hasAny(text, ["开源", "github", "release", "版本", "依赖"])) {
    risks.push("开源许可", "维护活跃度", "版本兼容", "安全依赖");
  }
  if (hasAny(text, ["版权", "商用", "授权"])) {
    risks.push("版权授权", "商用许可");
  }

  return unique(risks.length > 0 ? risks : ["来源可靠性", "事实边界"]);
}

function inferContentMode(
  primaryDomain: TopicPrimaryDomain,
  events: TopicEventType[]
): TopicContentMode {
  if (events.includes("acquisition")) {
    return "trend_analysis";
  }
  if (events.includes("pricing") || events.includes("benchmark")) {
    return "comparison";
  }
  if (events.includes("regulation") || events.includes("research_release")) {
    return "explainer";
  }
  if (events.includes("incident") || events.includes("case_study")) {
    return "case_review";
  }
  if (primaryDomain === "tooling" || primaryDomain === "creator" || primaryDomain === "product") {
    return "practical_guide";
  }
  return "news_analysis";
}

function inferAudiences(primaryDomain: TopicPrimaryDomain, events: TopicEventType[]): string[] {
  const audiences = ["普通 AI 关注者"];

  if (primaryDomain === "tooling" || primaryDomain === "model" || events.includes("benchmark")) {
    audiences.push("开发者", "技术团队");
  }
  if (primaryDomain === "business" || events.includes("pricing") || events.includes("funding")) {
    audiences.push("创业者", "企业决策者");
  }
  if (primaryDomain === "policy" || primaryDomain === "security") {
    audiences.push("企业合规负责人", "产品负责人");
  }
  if (primaryDomain === "creator") {
    audiences.push("内容创作者", "短视频团队");
  }
  if (primaryDomain === "application") {
    audiences.push("行业从业者", "运营管理者");
  }

  return unique(audiences);
}

function inferReaderQuestions(events: TopicEventType[], risks: string[]): string[] {
  const questions = [
    "这件事已经确定发生了吗？",
    "它会影响哪些人或团队？"
  ];

  if (events.includes("pricing")) {
    questions.push("价格变化对不同用户的真实成本是什么？");
  }
  if (events.includes("benchmark")) {
    questions.push("测试条件和指标能说明什么，不能说明什么？");
  }
  if (events.includes("regulation")) {
    questions.push("哪些主体需要遵守，什么时候生效？");
  }
  if (events.includes("incident")) {
    questions.push("影响范围、修复状态和后续风险是什么？");
  }
  if (risks.includes("版权授权")) {
    questions.push("生成内容是否允许商用，版权边界在哪里？");
  }

  return unique(questions);
}

function inferEvidenceNeeds(events: TopicEventType[], sourceName: string): string[] {
  const needs = [`原始来源：${sourceName}`];

  if (events.includes("launch") || events.includes("update")) {
    needs.push("官方公告", "发布时间", "可用地区和开放对象");
  }
  if (events.includes("benchmark")) {
    needs.push("benchmark 原文", "指标定义", "测试条件", "第三方复现");
  }
  if (events.includes("pricing")) {
    needs.push("官方价格页", "生效日期", "套餐与 API 计费说明");
  }
  if (events.includes("funding")) {
    needs.push("公司公告", "投资方确认", "融资金额和轮次");
  }
  if (events.includes("acquisition")) {
    needs.push("双方公告", "监管审批状态", "交易条款");
  }
  if (events.includes("regulation")) {
    needs.push("政策原文", "司法辖区", "生效时间");
  }
  if (events.includes("incident")) {
    needs.push("官方事故报告", "影响范围", "修复时间线");
  }
  if (events.includes("research_release")) {
    needs.push("论文原文", "代码或数据集", "实验设置");
  }
  if (events.includes("case_study")) {
    needs.push("客户案例原文", "指标口径", "第三方材料");
  }

  return unique(needs);
}

function extractEntities(topic: SelectedTopic, text: string): TopicEntity[] {
  const entities: TopicEntity[] = [
    {
      name: topic.selected.sourceName,
      type: "source"
    }
  ];
  const knownEntities = [
    "OpenAI",
    "Anthropic",
    "Google",
    "Microsoft",
    "Meta",
    "NVIDIA",
    "Notion",
    "Slack",
    "Salesforce",
    "GitHub",
    "欧盟",
    "腾讯",
    "SQLite"
  ];

  for (const entity of knownEntities) {
    if (text.includes(entity.toLowerCase()) || text.includes(entity)) {
      entities.push({ name: entity, type: "organization" });
    }
  }

  return unique(entities.map((entity) => JSON.stringify(entity))).map(
    (entity) => JSON.parse(entity) as TopicEntity
  );
}

export function classifyTopic(topic: SelectedTopic, now: Date = new Date()): TopicProfile {
  const text = topicText(topic);
  const primaryDomain = inferPrimaryDomain(topic, text);
  const eventTypesForTopic = inferEventTypes(text);
  const riskDimensions = inferRiskDimensions(text, eventTypesForTopic);
  const confidence =
    primaryDomain === "other"
      ? 0.3
      : clampConfidence(0.62 + Math.min(0.24, eventTypesForTopic.length * 0.04 + riskDimensions.length * 0.01));

  return {
    schemaVersion: "1.0",
    id: `topic-profile-${topic.selected.id}`,
    topicId: topic.selected.id,
    primaryDomain,
    secondaryDomains: inferSecondaryDomains(primaryDomain, text),
    eventTypes: eventTypesForTopic,
    entities: extractEntities(topic, text),
    targetAudiences: inferAudiences(primaryDomain, eventTypesForTopic),
    readerQuestions: inferReaderQuestions(eventTypesForTopic, riskDimensions),
    evidenceNeeds: inferEvidenceNeeds(eventTypesForTopic, topic.selected.sourceName),
    riskDimensions,
    recommendedContentMode: inferContentMode(primaryDomain, eventTypesForTopic),
    confidence,
    classificationReason:
      primaryDomain === "other"
        ? "未命中足够明确的领域和事件信号，进入保守 other 模式。"
        : `根据选题标题、摘要、来源、标签和编辑角度，识别为 ${primaryDomain} 领域，事件类型为 ${eventTypesForTopic.join(" / ")}。`,
    generatedAt: now.toISOString()
  };
}

function createFallbackProfile(
  topic: SelectedTopic,
  now: Date,
  reason: string
): TopicProfile {
  return {
    schemaVersion: "1.0",
    id: `topic-profile-${topic.selected.id}`,
    topicId: topic.selected.id,
    primaryDomain: "other",
    secondaryDomains: [],
    eventTypes: ["opinion"],
    entities: [{ name: topic.selected.sourceName, type: "source" }],
    targetAudiences: ["普通 AI 关注者"],
    readerQuestions: ["这件事是否有可靠来源？", "哪些事实还不能确认？"],
    evidenceNeeds: [`原始来源：${topic.selected.sourceName}`, "人工复核事实边界"],
    riskDimensions: ["来源可靠性", "事实边界"],
    recommendedContentMode: "news_analysis",
    confidence: 0.2,
    classificationReason: `分类失败，进入保守 other 模式：${reason}`,
    generatedAt: now.toISOString()
  };
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`MiniMax topic-classifier response is missing ${label}.`);
  }

  const result = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  if (result.length === 0) {
    throw new Error(`MiniMax topic-classifier response has empty ${label}.`);
  }

  return result.map((item) => item.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimaryDomain(value: unknown): value is TopicPrimaryDomain {
  return typeof value === "string" && primaryDomains.includes(value as TopicPrimaryDomain);
}

function isEventType(value: unknown): value is TopicEventType {
  return typeof value === "string" && eventTypes.includes(value as TopicEventType);
}

function isContentMode(value: unknown): value is TopicContentMode {
  return typeof value === "string" && contentModes.includes(value as TopicContentMode);
}

function parseEntities(value: unknown): TopicEntity[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) {
      return [];
    }

    return [
      {
        name: item.name.trim(),
        type: typeof item.type === "string" && item.type.trim() ? item.type.trim() : "unknown"
      }
    ];
  });
}

function validateTopicClassifierPayload(value: unknown, topic: SelectedTopic, now: Date): TopicProfile {
  if (!isRecord(value)) {
    throw new Error("MiniMax topic-classifier response must be a JSON object.");
  }

  if (!isPrimaryDomain(value.primaryDomain)) {
    throw new Error("MiniMax topic-classifier response has invalid primaryDomain.");
  }

  const parsedEventTypes = Array.isArray(value.eventTypes)
    ? value.eventTypes.filter(isEventType)
    : [];
  if (parsedEventTypes.length === 0) {
    throw new Error("MiniMax topic-classifier response has invalid eventTypes.");
  }

  if (!isContentMode(value.recommendedContentMode)) {
    throw new Error("MiniMax topic-classifier response has invalid recommendedContentMode.");
  }

  const confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? clampConfidence(value.confidence)
      : 0.45;

  return {
    schemaVersion: "1.0",
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim()
        : `topic-profile-${topic.selected.id}`,
    topicId: topic.selected.id,
    primaryDomain: value.primaryDomain,
    secondaryDomains: Array.isArray(value.secondaryDomains)
      ? value.secondaryDomains.filter((item): item is string => typeof item === "string")
      : [],
    eventTypes: unique(parsedEventTypes),
    entities: parseEntities(value.entities),
    targetAudiences: asStringArray(value.targetAudiences, "targetAudiences"),
    readerQuestions: asStringArray(value.readerQuestions, "readerQuestions"),
    evidenceNeeds: asStringArray(value.evidenceNeeds, "evidenceNeeds"),
    riskDimensions: asStringArray(value.riskDimensions, "riskDimensions"),
    recommendedContentMode: value.recommendedContentMode,
    confidence,
    classificationReason:
      typeof value.classificationReason === "string" && value.classificationReason.trim()
        ? value.classificationReason.trim()
        : "MiniMax classified topic with validated JSON.",
    generatedAt: now.toISOString()
  };
}

const topicClassifierExpectedJsonShape = JSON.stringify(
  {
    primaryDomain: "model",
    secondaryDomains: ["product"],
    eventTypes: ["launch"],
    entities: [{ name: "OpenAI", type: "organization" }],
    targetAudiences: ["普通 AI 关注者", "开发者"],
    readerQuestions: ["这件事已经确定发生了吗？"],
    evidenceNeeds: ["官方公告"],
    riskDimensions: ["可用范围"],
    recommendedContentMode: "news_analysis",
    confidence: 0.72,
    classificationReason: "根据标题、摘要、来源和编辑角度分类。"
  },
  null,
  2
);

function createTopicClassifierSystemPrompt(): string {
  return [
    "你是选题画像分类器。",
    "只返回 JSON。",
    "不要 Markdown。",
    "不要解释。",
    "不要代码块。",
    "不要前后缀文本。",
    "不要输出 <think> 或任何思考过程。",
    "必须按给定枚举输出 primaryDomain、eventTypes 和 recommendedContentMode。",
    "同一个选题可以有多个 eventTypes 和 riskDimensions。",
    "如果不确定，primaryDomain 使用 other，confidence 不得高于 0.35。",
    "不要把单一历史示例当作默认分类。"
  ].join("\n");
}

function createTopicClassifierUserPrompt(topic: SelectedTopic): string {
  const selected = topic.selected;

  return [
    "请为这个 AI 内容选题生成 TopicProfile。",
    "只返回 JSON，不要 Markdown，不要解释，不要代码块，不要输出 JSON 以外的文字。",
    "枚举范围：",
    `primaryDomain=${primaryDomains.join(", ")}`,
    `eventTypes=${eventTypes.join(", ")}`,
    `recommendedContentMode=${contentModes.join(", ")}`,
    "返回 JSON 结构：",
    topicClassifierExpectedJsonShape,
    "",
    "selected-topic.json:",
    JSON.stringify(
      {
        id: selected.id,
        title: selected.title,
        rawTitle: selected.rawTitle,
        titleZh: selected.titleZh,
        summary: selected.summary,
        rawSummary: selected.rawSummary,
        summaryZh: selected.summaryZh,
        url: selected.url,
        sourceName: selected.sourceName,
        sourceType: selected.sourceType,
        category: selected.category,
        tags: selected.tags,
        editorial: selected.editorial,
        selection: selected.selection
      },
      null,
      2
    )
  ].join("\n");
}

async function classifyTopicWithMiniMax(input: {
  outputDir: string;
  topic: SelectedTopic;
  env: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion: LlmChatCompletionClient;
  now: Date;
}): Promise<{ profile: TopicProfile; llm: LlmRunMetadata }> {
  const config = resolveLlmStageConfig("topic-classifier", input.env);
  const { value: profile, completion } = await requestLlmJsonWithRepair({
    failedStep: "topic-classifier",
    outputDir: input.outputDir,
    config,
    systemPrompt: createTopicClassifierSystemPrompt(),
    userPrompt: createTopicClassifierUserPrompt(input.topic),
    expectedJsonShape: topicClassifierExpectedJsonShape,
    env: input.env,
    fetchImpl: input.fetchImpl,
    chatCompletion: input.chatCompletion,
    validate: (value) => validateTopicClassifierPayload(value, input.topic, input.now)
  });

  return {
    profile,
    llm: realLlmMetadata(completion, "real")
  };
}

function createMarkdownReport(input: {
  profile: TopicProfile;
  llm?: LlmRunMetadata;
}): string {
  const { profile, llm } = input;

  return [
    "# Topic Profile Report",
    "",
    `Generated at: ${profile.generatedAt}`,
    "",
    "## 画像",
    "",
    `- topicId: ${profile.topicId}`,
    `- primaryDomain: ${profile.primaryDomain}`,
    `- secondaryDomains: ${profile.secondaryDomains.join(" / ") || "none"}`,
    `- eventTypes: ${profile.eventTypes.join(" / ")}`,
    `- recommendedContentMode: ${profile.recommendedContentMode}`,
    `- confidence: ${profile.confidence}`,
    `- classificationReason: ${profile.classificationReason}`,
    "",
    "## 风险维度",
    "",
    ...profile.riskDimensions.map((item) => `- ${item}`),
    "",
    "## 读者问题",
    "",
    ...profile.readerQuestions.map((item) => `- ${item}`),
    "",
    "## 证据需求",
    "",
    ...profile.evidenceNeeds.map((item) => `- ${item}`),
    "",
    "## LLM",
    "",
    `- provider: ${llm?.provider ?? "minimax"}`,
    `- model: ${llm?.model ?? "not-configured"}`,
    `- mode: ${llm?.mode ?? "mock"}`,
    `- usage: ${llm ? formatLlmUsage(llm.usage) : "unknown"}`,
    "",
    "## 阶段边界",
    "",
    "- 本阶段只生成 TopicProfile。",
    "- 旧 TopicFactPack 继续运行。",
    "- 不写文章，不生成封面，不调用微信接口，不发布，不群发。",
    ""
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function classifyTopicWithReport(
  options: ClassifyTopicOptions = {}
): Promise<TopicProfileResult> {
  const logger = options.logger ?? createLogger("topic-classifier");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const selectedTopicFile =
    options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const files = createOutputFiles(outputDir);
  const topic = options.topic ?? (await readSelectedTopic(selectedTopicFile));
  const writeOutputs = options.writeOutputs ?? true;
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const config = resolveLlmStageConfig("topic-classifier", env);
  let llm: LlmRunMetadata | undefined;
  let profile: TopicProfile;

  if (config.mode === "real") {
    try {
      const realResult = await classifyTopicWithMiniMax({
        outputDir,
        topic,
        env,
        fetchImpl: options.fetchImpl,
        chatCompletion: options.chatCompletion ?? createChatCompletion,
        now
      });
      profile = realResult.profile;
      llm = realResult.llm;
    } catch (error) {
      profile = createFallbackProfile(topic, now, errorMessage(error));
      logger.warn(`Topic classifier fell back to other: ${profile.classificationReason}`);
    }
  } else {
    profile = classifyTopic(topic, now);
    llm = mockLlmMetadata(config);
  }

  const report = createMarkdownReport({ profile, llm });

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.topicProfileJson, profile);
    await writeFile(files.topicProfileReport, report, "utf8");
  }

  logger.info(
    `Classified topic ${profile.topicId}: domain=${profile.primaryDomain}; events=${profile.eventTypes.join("/")}; confidence=${profile.confidence}.`
  );

  return {
    outputDir,
    files,
    profile,
    report,
    llm
  };
}
