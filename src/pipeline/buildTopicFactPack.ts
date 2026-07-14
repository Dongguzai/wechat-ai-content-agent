import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DynamicFactClaim,
  FactClaimStatus,
  FactPackClaim,
  FactRiskLevel,
  TopicFactPack,
  TopicFactPackOutputFiles,
  TopicFactPackResult
} from "../types/factPack.js";
import type { SelectedTopic, SourceReliability } from "../types/news.js";
import type { ResearchPlan } from "../types/researchPlan.js";
import type { SourceEvidence } from "../types/sourceEvidence.js";
import type { TopicProfile } from "../types/topicProfile.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface BuildTopicFactPackOptions {
  outputDir?: string;
  selectedTopicFile?: string;
  topicSelectionReportFile?: string;
  topicProfileFile?: string;
  researchPlanFile?: string;
  sourceEvidenceFile?: string;
  topic?: SelectedTopic;
  topicProfile?: TopicProfile;
  researchPlan?: ResearchPlan;
  sourceEvidence?: SourceEvidence;
  topicSelectionReport?: string;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function createOutputFiles(outputDir: string): TopicFactPackOutputFiles {
  return {
    topicFactPackJson: join(outputDir, "topic-fact-pack.json"),
    topicFactPackReport: join(outputDir, "topic-fact-pack.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function readSelectedTopic(path: string): Promise<SelectedTopic> {
  const parsed = await readJsonFile<unknown>(path);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("selected" in parsed) ||
    !("generatedAt" in parsed)
  ) {
    throw new Error(`Selected topic file is invalid: ${path}`);
  }

  return parsed as SelectedTopic;
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path);
  } catch {
    return undefined;
  }
}

async function readTopicSelectionReport(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function compact(values: Array<string | undefined>): string[] {
  return values.map((value) => value?.trim() ?? "").filter(Boolean);
}

function currentTopicSourceUrls(topic: SelectedTopic): string[] {
  const urls = [
    topic.selected.url,
    ...(topic.selected.evidence ?? [])
      .map((item) => item.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;，。]+$/, "") ?? "")
      .filter(Boolean),
    ...(topic.selected.duplicateSources ?? []).map((item) => item.url)
  ];

  return unique(urls.filter((url) => /^https?:\/\//i.test(url)));
}

function displayTitle(topic: SelectedTopic): string {
  return (
    topic.selected.titleZh ||
    topic.selected.title ||
    topic.selected.rawTitle ||
    "当前 AI 资讯选题"
  );
}

function originalTitle(topic: SelectedTopic): string {
  return (
    topic.selected.rawTitle ||
    topic.selected.title ||
    topic.selected.titleZh ||
    "当前 AI 资讯"
  );
}

function topicSummary(topic: SelectedTopic): string {
  return (
    topic.selected.summaryZh ||
    topic.selected.summary ||
    topic.selected.rawSummary ||
    topic.selected.selection.publicInterest
  );
}

function fallbackTopicProfile(topic: SelectedTopic, now: Date): TopicProfile {
  const riskNotes = topic.selected.selection.riskNotes ?? [];

  return {
    schemaVersion: "1.0",
    id: `topic-profile-${topic.selected.id}`,
    topicId: topic.selected.id,
    primaryDomain: topic.selected.category === "funding" ? "business" : topic.selected.category,
    secondaryDomains: [],
    eventTypes: ["opinion"],
    entities: [{ name: topic.selected.sourceName, type: "source" }],
    targetAudiences: ["普通 AI 关注者"],
    readerQuestions: ["这件事是否有可靠来源？"],
    evidenceNeeds: ["选题原始 URL"],
    riskDimensions: riskNotes.length > 0
      ? riskNotes
      : ["来源可靠性", "事实边界"],
    recommendedContentMode: "news_analysis",
    confidence: 0.3,
    classificationReason: "未找到 topic-profile.json，使用保守 fallback。",
    generatedAt: now.toISOString()
  };
}

function fallbackResearchPlan(profile: TopicProfile, now: Date): ResearchPlan {
  return {
    schemaVersion: "1.0",
    id: `research-plan-${profile.topicId}`,
    topicId: profile.topicId,
    primaryDomain: profile.primaryDomain,
    eventTypes: profile.eventTypes,
    riskDimensions: profile.riskDimensions,
    policyRefs: [],
    tasks: [
      {
        id: "research-task-source-boundary",
        question: "哪些来源可以支持事实，哪些只能作为线索？",
        expectedEvidence: profile.evidenceNeeds,
        priority: "high",
        relatedEventTypes: profile.eventTypes,
        relatedRiskDimensions: profile.riskDimensions,
        policyIds: []
      }
    ],
    sourcePriorities: ["选题原始 URL", "官方公告或原文", "搜索摘要只能作为 search_lead"],
    stopConditions: [
      "缺少原始 URL 时停止进入 verified fact pack。",
      "只有 search_lead 时不得生成 verified claim。"
    ],
    generatedAt: now.toISOString()
  };
}

function fallbackSourceEvidence(
  topic: SelectedTopic,
  now: Date
): SourceEvidence {
  const urls = currentTopicSourceUrls(topic);

  return {
    schemaVersion: "1.0",
    id: `source-evidence-${topic.selected.id}`,
    topicId: topic.selected.id,
    items: urls.map((url, index) => ({
      id: `source-evidence-${index + 1}`,
      topicId: topic.selected.id,
      url,
      title: displayTitle(topic),
      sourceName: topic.selected.sourceName,
      kind: topic.selected.sourceType === "global_search" ? "search_lead" : "original_url",
      status: topic.selected.sourceType === "global_search" ? "lead_only" : "not_fetched",
      extractionStatus: "metadata_only",
      evidenceSnippets: [],
      supportsTaskIds: [],
      reliability: topic.selected.sourceType === "global_search" ? "low" : "medium",
      usableAsEvidence: false,
      rejectionReason: "未找到 source-evidence.json，使用来源元数据 fallback。",
      canSupportVerifiedClaim: false,
      evidenceUse: topic.selected.sourceType === "global_search" ? "lead_only" : "primary",
      unavailableReason: "未找到 source-evidence.json，使用来源元数据 fallback。",
      notes: ["未伪造网页抓取结果。"],
      policyIds: [],
      collectedAt: now.toISOString()
    })),
    unsupportedReasons: [
      "未找到 source-evidence.json。",
      "当前 fact pack 只使用来源元数据，不能自动生成 verified claim。"
    ],
    collectionMode: "metadata_only",
    generatedAt: now.toISOString()
  };
}

function reliabilityForFactPack(input: {
  topic: SelectedTopic;
  evidence: SourceEvidence;
}): SourceReliability {
  if (input.topic.selected.selection.sourceReliability === "low") {
    return "low";
  }

  if (input.evidence.items.length === 0) {
    return "low";
  }

  if (input.evidence.items.every((item) => item.kind === "search_lead")) {
    return "medium";
  }

  if (!input.evidence.items.some((item) => item.usableAsEvidence)) {
    return "medium";
  }

  return input.topic.selected.selection.sourceReliability === "high"
    ? "medium"
    : input.topic.selected.selection.sourceReliability;
}

function reliabilityReason(reliability: SourceReliability, evidence: SourceEvidence): string {
  if (reliability === "low") {
    return "缺少可用于事实包的可靠来源元数据。";
  }

  if (evidence.collectionMode === "metadata_only") {
    return "当前仅记录来源元数据，未执行网页抓取或正文核验，因此不生成 verified claim。";
  }

  const usableCount = evidence.items.filter((item) => item.usableAsEvidence).length;
  return `来源可用于建立事实边界；${usableCount} 个来源提供了可用正文片段。`;
}

function riskForStatus(status: FactClaimStatus): FactRiskLevel {
  if (status === "verified") {
    return "low";
  }
  if (status === "partially_verified") {
    return "medium";
  }
  return "high";
}

function claimStatusFor(input: {
  evidenceIds: string[];
  evidenceSnippetIds: string[];
  statement: string;
  evidence: SourceEvidence;
}): FactClaimStatus {
  if (input.evidenceIds.length === 0) {
    return "unverified";
  }

  const items = input.evidence.items.filter((item) => input.evidenceIds.includes(item.id));
  const snippets = items.flatMap((item) =>
    item.evidenceSnippets.filter((snippet) => input.evidenceSnippetIds.includes(snippet.id))
  );
  const statementNumbers = numbersInText(input.statement);
  const snippetsText = snippets.map((snippet) => snippet.text).join(" ");
  const numbersSupported = statementNumbers.every((number) => snippetsText.includes(number));

  if (
    items.length > 0 &&
    snippets.length > 0 &&
    numbersSupported &&
    items.every((item) => item.usableAsEvidence && item.canSupportVerifiedClaim)
  ) {
    return "verified";
  }
  if (items.length > 0 && items.every((item) => item.kind === "search_lead")) {
    return "unverified";
  }

  return "partially_verified";
}

function numbersInText(value: string | undefined): string[] {
  return unique((value ?? "").match(/\d+(?:[.,]\d+)?%?|\$?\d+(?:[.,]\d+)?/g) ?? []);
}

function supportForEvidence(input: {
  evidence: SourceEvidence;
  taskId?: string;
}): { evidenceIds: string[]; evidenceSnippetIds: string[] } {
  const usableItems = input.evidence.items.filter((item) => item.usableAsEvidence);
  const selectedItems = input.taskId
    ? usableItems.filter((item) =>
        item.evidenceSnippets.some((snippet) => snippet.supportsTaskIds.includes(input.taskId!))
      )
    : usableItems;
  const items = selectedItems.length > 0 ? selectedItems : usableItems;

  return {
    evidenceIds: items.map((item) => item.id),
    evidenceSnippetIds: items.flatMap((item) =>
      item.evidenceSnippets
        .filter((snippet) => !input.taskId || snippet.supportsTaskIds.includes(input.taskId))
        .map((snippet) => snippet.id)
    )
  };
}

function forbiddenWordingFor(profile: TopicProfile): string[] {
  const terms = [
    "已经证明",
    "全面领先",
    "碾压",
    "终结",
    "唯一选择",
    "完全替代",
    "零成本",
    "官方确认所有细节"
  ];

  if (profile.eventTypes.includes("pricing")) {
    terms.push("永久免费", "没有任何成本");
  }
  if (profile.eventTypes.includes("benchmark")) {
    terms.push("最好", "第一", "全面领先");
  }
  if (profile.eventTypes.includes("regulation")) {
    terms.push("所有地区都必须", "已经违法");
  }

  return unique(terms);
}

function createClaim(input: {
  id: string;
  statement: string;
  evidenceIds: string[];
  evidenceSnippetIds: string[];
  sourceUrls: string[];
  evidence: SourceEvidence;
  safeWording: string;
  requiredQualifiers: string[];
  forbiddenWording: string[];
  riskDimensions: string[];
  confidence?: number;
}): DynamicFactClaim {
  const status = claimStatusFor({
    evidenceIds: input.evidenceIds,
    evidenceSnippetIds: input.evidenceSnippetIds,
    statement: input.statement,
    evidence: input.evidence
  });

  return {
    id: input.id,
    statement: input.statement,
    status,
    evidenceIds: input.evidenceIds,
    evidenceSnippetIds: input.evidenceSnippetIds,
    sourceUrls: input.sourceUrls,
    confidence:
      input.confidence ??
      (status === "verified" ? 0.9 : status === "partially_verified" ? 0.55 : 0.25),
    safeWording: input.safeWording,
    requiredQualifiers: input.requiredQualifiers,
    forbiddenWording: input.forbiddenWording,
    riskDimensions: input.riskDimensions
  };
}

function sourceUrlsForEvidence(evidence: SourceEvidence, evidenceIds: string[]): string[] {
  return evidence.items
    .filter((item) => evidenceIds.includes(item.id))
    .map((item) => item.url);
}

function createClaims(input: {
  topic: SelectedTopic;
  profile: TopicProfile;
  plan: ResearchPlan;
  evidence: SourceEvidence;
}): DynamicFactClaim[] {
  const genericSupport = supportForEvidence({ evidence: input.evidence });
  const fallbackEvidenceIds = genericSupport.evidenceIds.length > 0
    ? genericSupport.evidenceIds
    : input.evidence.items.map((item) => item.id);
  const sourceUrls = sourceUrlsForEvidence(input.evidence, fallbackEvidenceIds);
  const forbidden = forbiddenWordingFor(input.profile);
  const sourceLabel =
    input.topic.selected.sourceType === "global_search"
      ? "搜索线索"
      : input.topic.selected.sourceType === "rss"
        ? "RSS 来源"
        : "人工选题来源";
  const title = originalTitle(input.topic);
  const summary = topicSummary(input.topic);
  const claims = [
    createClaim({
      id: "claim-source-topic",
      statement: `当前选题来自 ${input.topic.selected.sourceName}：${title}。`,
      evidenceIds: fallbackEvidenceIds,
      evidenceSnippetIds: genericSupport.evidenceSnippetIds,
      sourceUrls,
      evidence: input.evidence,
      safeWording: `可以写成“${input.topic.selected.sourceName} 的一条${sourceLabel}显示，${title}”，但必须说明当前事实边界仍需回到原始来源核验。`,
      requiredQualifiers: ["据来源显示", "仍需核验"],
      forbiddenWording: forbidden,
      riskDimensions: ["来源可靠性", ...input.profile.riskDimensions]
    }),
    createClaim({
      id: "claim-topic-summary",
      statement: summary,
      evidenceIds: fallbackEvidenceIds,
      evidenceSnippetIds: genericSupport.evidenceSnippetIds,
      sourceUrls,
      evidence: input.evidence,
      safeWording: `可以概括为“${summary}”，但不能把摘要扩展成官方结论或已验证事实。`,
      requiredQualifiers: ["可以概括为", "据目前来源"],
      forbiddenWording: forbidden,
      riskDimensions: input.profile.riskDimensions
    }),
    createClaim({
      id: "claim-editorial-angle",
      statement: input.topic.selected.selection.writingAngle,
      evidenceIds: fallbackEvidenceIds,
      evidenceSnippetIds: genericSupport.evidenceSnippetIds,
      sourceUrls,
      evidence: input.evidence,
      safeWording: `正文适合从“${input.topic.selected.selection.writingAngle}”切入，但该角度属于编辑策略，不是事实本身。`,
      requiredQualifiers: ["适合观察", "可以从这个角度分析"],
      forbiddenWording: forbidden,
      riskDimensions: ["编辑判断", ...input.profile.riskDimensions]
    })
  ];

  for (const task of input.plan.tasks.filter((task) => task.id !== "research-task-source-boundary")) {
    const taskSupport = supportForEvidence({ evidence: input.evidence, taskId: task.id });
    const taskEvidenceIds = taskSupport.evidenceIds.length > 0
      ? taskSupport.evidenceIds
      : fallbackEvidenceIds;
    claims.push(
      createClaim({
        id: `claim-${task.id.replace(/^research-task-/, "")}`,
        statement: task.question,
        evidenceIds: taskEvidenceIds,
        evidenceSnippetIds: taskSupport.evidenceSnippetIds,
        sourceUrls: sourceUrlsForEvidence(input.evidence, taskEvidenceIds),
        evidence: input.evidence,
        safeWording: `写作前需要回答：“${task.question}” 需要的证据包括 ${task.expectedEvidence.join("、")}。当前阶段只能把它作为事实边界和核验清单。`,
        requiredQualifiers: ["需要核验", "当前阶段不能直接断言"],
        forbiddenWording: forbidden,
        riskDimensions: task.relatedRiskDimensions.length > 0
          ? task.relatedRiskDimensions
          : input.profile.riskDimensions,
        confidence: 0.45
      })
    );
  }

  return claims;
}

function compatibilityClaims(claims: DynamicFactClaim[]): FactPackClaim[] {
  return claims.map((claim) => ({
    id: claim.id,
    claim: claim.statement,
    status: claim.status,
    sourceUrls: claim.sourceUrls,
    safeWording: claim.safeWording,
    risk: riskForStatus(claim.status),
    evidenceIds: claim.evidenceIds,
    evidenceSnippetIds: claim.evidenceSnippetIds,
    confidence: claim.confidence,
    requiredQualifiers: claim.requiredQualifiers,
    forbiddenWording: claim.forbiddenWording,
    riskDimensions: claim.riskDimensions
  }));
}

function safeWritingBoundaryFor(input: {
  topic: SelectedTopic;
  profile: TopicProfile;
  evidence: SourceEvidence;
}): string[] {
  const title = originalTitle(input.topic);
  const boundaries = [
    `可以写：${input.topic.selected.sourceName} 的来源显示，${title}。`,
    `必须写清：本选题主要领域为 ${input.profile.primaryDomain}，事件类型为 ${input.profile.eventTypes.join(" / ")}。`,
    "必须区分原始来源事实、搜索线索、编辑概括和趋势判断。",
    "不能写：搜索摘要或中文化摘要已经证明未经核验的结论。",
    "不能写：FactPack 外的数字、价格、benchmark 结果、融资金额、政策义务或事故范围。"
  ];

  if (input.evidence.items.every((item) => item.kind === "search_lead")) {
    boundaries.push("当前只有 search_lead，不能生成 verified claim，也不能把线索当作官方事实。");
  }

  return boundaries;
}

function riskNotesFor(input: {
  topic: SelectedTopic;
  profile: TopicProfile;
  evidence: SourceEvidence;
}): string[] {
  const topicRiskNotes = input.topic.selected.selection.riskNotes ?? [];

  return unique([
    ...input.profile.riskDimensions.map((risk) => `风险维度：${risk}`),
    ...input.evidence.unsupportedReasons,
    ...topicRiskNotes,
    "标题、摘要和中文化改写只用于编辑判断，不能替代原文事实。",
    "涉及数字、价格、benchmark、融资、法规义务或事故范围时必须等待可用证据。"
  ]);
}

function recommendedFramingFor(topic: SelectedTopic, profile: TopicProfile): string {
  return (
    topic.selected.selection.writingAngle ||
    `从 ${profile.primaryDomain} / ${profile.eventTypes.join(" / ")} 角度解释这条 AI 资讯的事实边界和读者影响。`
  );
}

function articleAnglesFor(input: {
  topic: SelectedTopic;
  profile: TopicProfile;
  plan: ResearchPlan;
}): string[] {
  const baseAngles = [
    input.topic.selected.selection.writingAngle,
    `从“${input.profile.recommendedContentMode}”模式切入，先交代事实边界，再解释影响。`,
    `从读者问题切入：${input.profile.readerQuestions[0] ?? "这件事为什么重要？"}`,
    `从核验任务切入：${input.plan.tasks[0]?.question ?? "哪些事实还不能确定？"}`
  ];

  return unique(compact(baseAngles));
}

function createFactPack(input: {
  topic: SelectedTopic;
  profile: TopicProfile;
  plan: ResearchPlan;
  evidence: SourceEvidence;
  now: Date;
}): TopicFactPack {
  const sourceReliability = reliabilityForFactPack({
    topic: input.topic,
    evidence: input.evidence
  });
  const claims = createClaims(input);
  const factPack: TopicFactPack = {
    schemaVersion: "2.0",
    topicId: input.topic.selected.id,
    topicTitle: displayTitle(input.topic),
    generatedAt: input.now.toISOString(),
    entities: input.profile.entities,
    sourceReliability,
    sourceReliabilityReason: reliabilityReason(sourceReliability, input.evidence),
    claims,
    unsupportedClaims: claims.filter((claim) => claim.status === "unverified"),
    conflictingClaims: claims.filter((claim) => claim.status === "conflicting"),
    verifiedClaims: compatibilityClaims(claims),
    safeWritingBoundary: safeWritingBoundaryFor(input),
    riskNotes: riskNotesFor(input),
    recommendedFraming: recommendedFramingFor(input.topic, input.profile),
    articleAngleSuggestions: articleAnglesFor(input),
    sourceEvidenceIds: input.evidence.items.map((item) => item.id)
  };

  if (factPack.sourceReliability === "low") {
    throw new Error("Topic fact pack sourceReliability is low; stop before writing.");
  }

  return factPack;
}

function statusHeading(status: FactClaimStatus): string {
  const headings: Record<FactClaimStatus, string> = {
    verified: "已核验事实",
    partially_verified: "部分核验事实",
    conflicting: "冲突事实",
    unverified: "未核验或高风险事实"
  };

  return headings[status];
}

function claimLines(claims: DynamicFactClaim[], status: FactClaimStatus): string[] {
  const filtered = claims.filter((claim) => claim.status === status);

  if (filtered.length === 0) {
    return ["- 无"];
  }

  return filtered.map((claim) => {
    const urls = claim.sourceUrls.map((url) => `<${url}>`).join(", ");
    return [
      `- ${claim.id}: ${claim.statement}`,
      `  - status: ${claim.status}`,
      `  - confidence: ${claim.confidence}`,
      `  - evidenceIds: ${claim.evidenceIds.join(", ") || "none"}`,
      `  - safeWording: ${claim.safeWording}`,
      `  - requiredQualifiers: ${claim.requiredQualifiers.join(" / ") || "none"}`,
      `  - forbiddenWording: ${claim.forbiddenWording.join(" / ") || "none"}`,
      `  - sources: ${urls || "none"}`
    ].join("\n");
  });
}

function createMarkdownReport(factPack: TopicFactPack): string {
  return [
    "# Dynamic Topic Fact Pack",
    "",
    `Generated at: ${factPack.generatedAt}`,
    "",
    "## 主选题",
    "",
    factPack.topicTitle,
    "",
    `- schemaVersion: ${factPack.schemaVersion}`,
    `- topicId: ${factPack.topicId}`,
    `- sourceReliability: ${factPack.sourceReliability}`,
    `- sourceReliabilityReason: ${factPack.sourceReliabilityReason}`,
    "",
    `## ${statusHeading("verified")}`,
    "",
    ...claimLines(factPack.claims, "verified"),
    "",
    `## ${statusHeading("partially_verified")}`,
    "",
    ...claimLines(factPack.claims, "partially_verified"),
    "",
    `## ${statusHeading("conflicting")}`,
    "",
    ...claimLines(factPack.claims, "conflicting"),
    "",
    `## ${statusHeading("unverified")}`,
    "",
    ...claimLines(factPack.claims, "unverified"),
    "",
    "## 安全写法",
    "",
    ...factPack.safeWritingBoundary.map((item) => `- ${item}`),
    "",
    "## 禁止写法",
    "",
    ...unique(factPack.claims.flatMap((claim) => claim.forbiddenWording)).map(
      (item) => `- ${item}`
    ),
    "",
    "## 写作风险提醒",
    "",
    ...factPack.riskNotes.map((item) => `- ${item}`),
    "",
    "## 推荐公众号切入角度",
    "",
    `推荐 framing: ${factPack.recommendedFraming}`,
    "",
    ...factPack.articleAngleSuggestions.map((item) => `- ${item}`),
    "",
    "## 阶段边界",
    "",
    "- 本阶段只生成 dynamic fact pack。",
    "- 不写公众号正文，不生成封面，不排版 HTML。",
    "- 不调用 APIMart，不操作公众号后台，不加入 Playwright 或浏览器自动化。",
    ""
  ].join("\n");
}

export async function buildTopicFactPack(
  options: BuildTopicFactPackOptions = {}
): Promise<TopicFactPackResult> {
  const logger = options.logger ?? createLogger("topic-fact-checker");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const selectedTopicFile =
    options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const topicSelectionReportFile =
    options.topicSelectionReportFile ?? join(outputDir, "topic-selection-report.md");
  const topicProfileFile = options.topicProfileFile ?? join(outputDir, "topic-profile.json");
  const researchPlanFile = options.researchPlanFile ?? join(outputDir, "research-plan.json");
  const sourceEvidenceFile =
    options.sourceEvidenceFile ?? join(outputDir, "source-evidence.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const now = options.now ?? new Date();
  const topic = options.topic ?? (await readSelectedTopic(selectedTopicFile));

  if (!options.topicSelectionReport) {
    await readTopicSelectionReport(topicSelectionReportFile);
  }

  const profile =
    options.topicProfile ??
    (await readOptionalJsonFile<TopicProfile>(topicProfileFile)) ??
    fallbackTopicProfile(topic, now);
  const plan =
    options.researchPlan ??
    (await readOptionalJsonFile<ResearchPlan>(researchPlanFile)) ??
    fallbackResearchPlan(profile, now);
  const evidence =
    options.sourceEvidence ??
    (await readOptionalJsonFile<SourceEvidence>(sourceEvidenceFile)) ??
    fallbackSourceEvidence(topic, now);
  const factPack = createFactPack({
    topic,
    profile,
    plan,
    evidence,
    now
  });

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.topicFactPackJson, factPack);
    await writeFile(files.topicFactPackReport, createMarkdownReport(factPack), "utf8");
  }

  logger.info(
    `Built dynamic topic fact pack for ${factPack.topicTitle} with ${factPack.claims.length} claims.`
  );

  return {
    outputDir,
    files,
    factPack
  };
}
