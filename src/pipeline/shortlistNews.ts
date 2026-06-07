import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateShortlistScore,
  scoreShortlistDimensions
} from "../config/scoring.js";
import { requireSourceUrl } from "../hooks/requireSourceUrl.js";
import type {
  NewsCategory,
  NewsShortlistResult,
  NewsTag,
  NormalizedNewsItem,
  SearchProvider,
  ShortlistedNewsItem,
  ShortlistElimination,
  ShortlistOutputFiles,
  ShortlistRecommendedUse,
  ShortlistScoreDimensions
} from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface ShortlistNewsOptions {
  outputDir?: string;
  inputFile?: string;
  candidates?: NormalizedNewsItem[];
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

type TopicFamily =
  | "model_product"
  | "open_source_tooling"
  | "paper_research"
  | "business_funding"
  | "community_policy";

interface ScoredCandidate {
  item: ShortlistedNewsItem;
  family: TopicFamily;
  shallowUpdate: boolean;
  rankingScore: number;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

const targetShortlistCount = 10;
const rssMinShortlistCount = 7;
const globalSearchMaxShortlistCount = 3;
const searchProviderMaxShortlistCount = 3;

const categoryOrder: NewsCategory[] = [
  "model",
  "product",
  "tooling",
  "research",
  "funding",
  "policy"
];

const tagOrder: NewsTag[] = [
  "tooling",
  "open-source",
  "agent",
  "developer-workflow",
  "model",
  "product",
  "research",
  "business",
  "community",
  "policy"
];

const familySoftMax: Record<TopicFamily, number> = {
  model_product: 3,
  open_source_tooling: 3,
  paper_research: 2,
  business_funding: 2,
  community_policy: 2
};

const familyIntroBoost: Record<TopicFamily, number> = {
  model_product: 2,
  open_source_tooling: 8,
  paper_research: 7,
  business_funding: 6,
  community_policy: 4
};

function trimText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function displayTitle(item: NormalizedNewsItem): string {
  return trimText(item.titleZh) || trimText(item.title);
}

function displaySummary(item: NormalizedNewsItem): string {
  return trimText(item.summaryZh) || trimText(item.summary);
}

function combinedText(item: NormalizedNewsItem): string {
  return [
    displayTitle(item),
    displaySummary(item),
    item.rawTitle,
    item.rawSummary,
    item.sourceName,
    item.tags?.join(" ")
  ]
    .map(trimText)
    .filter(Boolean)
    .join(" ");
}

function hasRequiredSource(item: NormalizedNewsItem): boolean {
  return trimText(item.url).length > 0 && trimText(item.sourceName).length > 0;
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const serialized = parsed.toString();
    return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
  } catch {
    return url.trim().toLowerCase();
  }
}

function titleFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "with",
    "that",
    "this",
    "from",
    "into",
    "will",
    "your",
    "about",
    "launches",
    "launch",
    "released",
    "release",
    "new",
    "ai"
  ]);

  return new Set(
    titleFingerprint(title)
      .split(" ")
      .filter((word) => word.length > 2 && !stopWords.has(word))
  );
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  return intersection.length / union.size;
}

function titleForDuplicateSimilarity(item: NormalizedNewsItem): string {
  return trimText(item.rawTitle) || trimText(item.title);
}

function isDuplicateOf(
  candidate: NormalizedNewsItem,
  selected: NormalizedNewsItem[]
): NormalizedNewsItem | undefined {
  const candidateUrlKey = normalizeUrlKey(candidate.url);
  const candidateSimilarityTitle = titleForDuplicateSimilarity(candidate);

  return selected.find((item) => {
    if (candidate.id === item.id) {
      return true;
    }

    if (candidate.duplicateKey && candidate.duplicateKey === item.duplicateKey) {
      return true;
    }

    if (candidateUrlKey && candidateUrlKey === normalizeUrlKey(item.url)) {
      return true;
    }

    return (
      titleSimilarity(candidateSimilarityTitle, titleForDuplicateSimilarity(item)) >=
      0.82
    );
  });
}

function familyFor(category: NewsCategory): TopicFamily {
  if (category === "tooling") {
    return "open_source_tooling";
  }
  if (category === "research") {
    return "paper_research";
  }
  if (category === "funding") {
    return "business_funding";
  }
  if (category === "policy") {
    return "community_policy";
  }
  return "model_product";
}

function isShallowProductUpdate(item: NormalizedNewsItem): boolean {
  const text = combinedText(item).toLowerCase();

  return [
    "minor update",
    "small update",
    "patch release",
    "bug fix",
    "catch up on",
    "custom video feed",
    "roundup",
    "listicle"
  ].some((signal) => text.includes(signal));
}

function audienceFitFor(category: NewsCategory): string {
  const fit: Record<NewsCategory, string> = {
    model: "适合关注模型能力、成本曲线和落地边界的技术与产品读者。",
    product: "适合关注 AI 产品形态、工作流变化和团队效率的公众号读者。",
    research: "适合希望把论文和技术报告翻译成产业判断的进阶读者。",
    tooling: "适合开发者、技术负责人和正在搭建 AI 应用的团队。",
    funding: "适合关注 AI 商业化、资本流向和企业采购趋势的读者。",
    policy: "适合关注 AI 治理、安全、版权和企业合规的读者。"
  };

  return fit[category];
}

function canonicalTagsFor(item: NormalizedNewsItem): NewsTag[] {
  const text = combinedText(item).toLowerCase();
  const tags = new Set<NewsTag>();

  if (item.category === "model") {
    tags.add("model");
  }
  if (item.category === "product") {
    tags.add("product");
  }
  if (item.category === "research") {
    tags.add("research");
  }
  if (item.category === "tooling") {
    tags.add("tooling");
  }
  if (item.category === "funding") {
    tags.add("business");
  }
  if (item.category === "policy") {
    tags.add("policy");
  }

  if (/\b(agent|agentic|agents|codex|claude code|slackbot|cowork)\b|智能体|编码代理/.test(text)) {
    tags.add("agent");
  }

  if (
    /\b(tooling|developer|workflow|coding|code|codex|github|sdk|framework|terminal|agents\.md|sqlite|warp|goose)\b|开发者|工作流|编码|代码|工具|框架|终端|仓库|运行时/.test(
      text
    )
  ) {
    tags.add("tooling");
    tags.add("developer-workflow");
  }

  if (/\b(open source|open-source|github|goose|sqlite|agents\.md|warp)\b|开源/.test(text)) {
    tags.add("open-source");
  }

  if (/\b(model|llm|gpt|claude|benchmark|multimodal|frontier)\b|模型|大模型|基准测试|多模态|推理/.test(text)) {
    tags.add("model");
  }

  if (/\b(product|launch|desktop|slackbot|copilot|workspace)\b|产品|发布|工作台|办公套件/.test(text)) {
    tags.add("product");
  }

  if (/\b(research|paper|technical report|benchmark|evaluation)\b|研究|论文|技术报告|基准测试|评测|实验/.test(text)) {
    tags.add("research");
  }

  if (
    /\b(funding|startup|enterprise|revenue|pricing|product-market fit|salesforce|customer|organization)\b|融资|创业公司|企业|收入|定价|客户|组织|商业化/.test(
      text
    )
  ) {
    tags.add("business");
  }

  if (/\b(community|maintainer|open source|github|sqlite)\b|社区|维护者|开源/.test(text)) {
    tags.add("community");
  }

  if (/\b(policy|election|safety|copyright|governance|regulation)\b|政策|安全|版权|治理|监管|合规|隐私/.test(text)) {
    tags.add("policy");
  }

  return tagOrder.filter((tag) => tags.has(tag));
}

function topicAngleFor(item: NormalizedNewsItem): string {
  const localizedAngle = trimText(item.topicAngleZh);
  if (localizedAngle) {
    return localizedAngle;
  }

  const text = combinedText(item).toLowerCase();

  if (text.includes("claude code") && text.includes("goose")) {
    return "表面上是 Claude Code 与 Goose 的价格对比，真正的问题是编码代理会不会从昂贵订阅走向开源替代。对开发者来说，这关系到工具选型、团队成本和代码工作流是否被单一平台锁住。";
  }

  if (text.includes("cowork")) {
    return "表面上是 Claude Desktop 加入能操作文件的 Cowork，背后矛盾是 agent 从程序员工具走向普通办公用户时，便利性和文件权限风险如何平衡。适合讨论非技术团队会不会开始重构日常工作流。";
  }

  if (text.includes("slackbot")) {
    return "表面上是 Slackbot 升级为 AI agent，背后是企业聊天入口到底归协作软件、CRM 还是办公套件控制。对普通职场读者，它影响信息搜索、销售跟进和内部知识流动的默认入口。";
  }

  if (text.includes("product-market fit")) {
    return "表面上是判断 Anthropic 和 OpenAI 找到产品市场匹配，背后是基础模型公司到底靠模型能力还是具体工作流变现。对创业者和产品经理，这是判断 AI 机会还剩在哪里的线索。";
  }

  if (text.includes("itbench-aa")) {
    return "表面上是企业 IT agent 基准测试分数低，真正值得讨论的是演示里的自动化和真实企业环境之间差了多少权限、系统和异常处理。对技术负责人，它提醒别把 agent 采购等同于马上省人。";
  }

  if (text.includes("funding") || text.includes("startup")) {
    return "表面上是企业知识 agent 创业公司融资，背后是资本还在押注检索、权限、评估这些不显眼的基础设施。对创业者，它提示 AI 应用赚钱可能不在聊天界面，而在企业知识流的脏活累活。";
  }

  if (text.includes("warp")) {
    return "表面上是 Warp 用 GPT-5.5 押注开源建设，背后是开发工具厂商既想借开源扩散，又要守住商业产品入口。对开发者，它影响终端、代码生成和社区贡献会不会被 agent 工作流重新组织。";
  }

  if (text.includes("sqlite") || text.includes("agents.md")) {
    return "表面上只是 sqlite 仓库出现 AGENTS.md，真正有意思的是开源项目开始给 coding agent 写协作说明。对开发者，这可能像 README 一样成为新基础设施，改变维护者和 AI 工具的协作边界。";
  }

  if (text.includes("tax agents")) {
    return "表面上是用 Codex 构建会自我改进的税务 agent，背后矛盾是专业服务能自动化多少、责任又由谁承担。对普通读者和创业者，它展示 AI agent 正在进入高门槛知识流程，而不是只写代码。";
  }

  if (text.includes("endava")) {
    return "表面上是 Endava 讲如何用 Codex 做 agentic organization，背后是企业转型到底靠买工具还是重写流程和管理方式。对管理者，它提示 AI 落地的难点可能是组织协作，而不是模型调用。";
  }

  if (item.sourceType === "global_search") {
    return "表面上是一条搜索发现的 AI 资讯线索，真正要讨论的是它是否代表了某个新场景正在升温。对编辑部来说，这类题只能先进入备选清单，后续必须回到原文核验事实和可写性。";
  }

  return `表面上是关于 ${item.title} 的一条 AI 资讯，背后值得追问的是它改变了哪类人的工作流程、成本结构或决策方式。对读者来说，重点不是新闻本身，而是这类变化会不会进入自己的工具箱。`;
}

function recommendedUseFor(
  item: NormalizedNewsItem,
  metrics: ShortlistScoreDimensions,
  shortlistScore: number
): ShortlistRecommendedUse {
  if (
    shortlistScore >= 80 &&
    metrics.sourceCredibility >= 75 &&
    metrics.originality >= 70 &&
    item.sourceType === "rss"
  ) {
    return "main_topic_candidate";
  }

  if (shortlistScore >= 68 && metrics.sourceCredibility >= 60) {
    return "secondary_topic";
  }

  return "reference_only";
}

function shortlistReasonFor(
  item: NormalizedNewsItem,
  metrics: ShortlistScoreDimensions,
  shortlistScore: number
): string {
  const localizedReason = trimText(item.shortlistReasonZh);
  if (localizedReason) {
    return localizedReason;
  }

  if (item.sourceType === "global_search") {
    return `来自 ${
      item.provider ?? "global_search"
    } 搜索线索，技术含金量 ${metrics.technicalValue.toFixed(
      1
    )}、公众号传播价值 ${metrics.wechatTopic.toFixed(
      1
    )}，综合初筛分 ${shortlistScore.toFixed(
      1
    )}；标题和原始链接指向的主题具备讨论价值，但搜索摘要不作为事实依据，后续必须回到原文核验。`;
  }

  const sourcePhrase =
    item.sourceType === "rss"
      ? "来自 RSS 主来源"
      : `来自 ${item.provider ?? "global_search"} 搜索线索`;
  const originalityPhrase =
    metrics.originality >= 78
      ? "较接近原始来源"
      : "需要进一步回到原文核验";

  return `${sourcePhrase}，技术含金量 ${metrics.technicalValue.toFixed(
    1
  )}、公众号传播价值 ${metrics.wechatTopic.toFixed(
    1
  )}，综合初筛分 ${shortlistScore.toFixed(
    1
  )}；事件事实相对清晰，${originalityPhrase}，具备展开观点的空间。`;
}

function riskNoteFor(
  item: NormalizedNewsItem,
  metrics: ShortlistScoreDimensions
): string | undefined {
  if (item.sourceType === "global_search") {
    return "Tavily/Exa 搜索摘要不能作为事实依据；后续只能用可访问的原始 URL 核验事实。";
  }

  if (metrics.sourceCredibility < 70) {
    return "来源可信度一般，后续进入选题会前需要交叉验证。";
  }

  if (metrics.controversy >= 70) {
    return "争议度较高，后续表达需要区分事实、判断和观点。";
  }

  return undefined;
}

function toShortlistedItem(item: NormalizedNewsItem): ShortlistedNewsItem {
  const shortlistMetrics = scoreShortlistDimensions(item);
  const shortlistScore = calculateShortlistScore(shortlistMetrics);
  const tags = canonicalTagsFor(item);
  const topicAngle = topicAngleFor(item);
  const shortlistReason = shortlistReasonFor(item, shortlistMetrics, shortlistScore);
  const riskNotes = [
    ...(item.riskNotesZh ?? []).map(trimText),
    trimText(riskNoteFor(item, shortlistMetrics))
  ].filter(Boolean);

  return {
    ...item,
    title: displayTitle(item),
    summary: displaySummary(item),
    titleZh: trimText(item.titleZh) || displayTitle(item),
    summaryZh: trimText(item.summaryZh) || displaySummary(item),
    topicAngleZh: topicAngle,
    shortlistReasonZh: shortlistReason,
    riskNotesZh: [...new Set(riskNotes)],
    tags,
    shortlistScore,
    shortlistMetrics,
    editorial: {
      shortlistReason,
      audienceFit: audienceFitFor(item.category),
      topicAngle,
      riskNote: riskNotes.length > 0 ? [...new Set(riskNotes)].join("；") : undefined,
      recommendedUse: recommendedUseFor(item, shortlistMetrics, shortlistScore)
    }
  };
}

function toScoredCandidate(item: NormalizedNewsItem): ScoredCandidate {
  const shortlisted = toShortlistedItem(item);
  const shallowUpdate = isShallowProductUpdate(item);
  const rankingScore =
    shortlisted.shortlistScore +
    shortlisted.shortlistMetrics.originality * 0.08 +
    shortlisted.scores.heat * 0.04 -
    (item.sourceType === "global_search" ? 3 : 0) -
    (shallowUpdate ? 8 : 0);

  return {
    item: shortlisted,
    family: familyFor(item.category),
    shallowUpdate,
    rankingScore
  };
}

function countSourceType(
  items: ShortlistedNewsItem[],
  sourceType: "rss" | "global_search"
): number {
  return items.filter((item) => item.sourceType === sourceType).length;
}

function countSearchProviders(items: ShortlistedNewsItem[]): number {
  return items.filter(
    (item) => item.provider === "tavily" || item.provider === "exa"
  ).length;
}

function countProvider(
  items: ShortlistedNewsItem[],
  provider: Exclude<SearchProvider, "none">
): number {
  return items.filter((item) => item.provider === provider).length;
}

function sourceQuotaAllows(
  candidate: ShortlistedNewsItem,
  selected: ShortlistedNewsItem[]
): boolean {
  if (
    candidate.sourceType === "global_search" &&
    countSourceType(selected, "global_search") >= globalSearchMaxShortlistCount
  ) {
    return false;
  }

  if (
    (candidate.provider === "tavily" || candidate.provider === "exa") &&
    countSearchProviders(selected) >= searchProviderMaxShortlistCount
  ) {
    return false;
  }

  return true;
}

function canStillMeetRssMinimum(
  candidate: ShortlistedNewsItem,
  selected: ShortlistedNewsItem[],
  scoredCandidates: ScoredCandidate[]
): boolean {
  const selectedAfter = [...selected, candidate];
  const rssAfter = countSourceType(selectedAfter, "rss");
  const remainingSlots = targetShortlistCount - selectedAfter.length;
  const remainingRssAvailable = scoredCandidates.filter(
    (entry) =>
      entry.item.sourceType === "rss" &&
      !selectedAfter.some((item) => item.id === entry.item.id) &&
      !isDuplicateOf(entry.item, selectedAfter)
  ).length;

  return (
    rssAfter + Math.min(remainingSlots, remainingRssAvailable) >=
    rssMinShortlistCount
  );
}

function dynamicRankingScore(
  candidate: ScoredCandidate,
  selected: ShortlistedNewsItem[]
): number {
  const rssNeeded = Math.max(
    0,
    rssMinShortlistCount - countSourceType(selected, "rss")
  );
  const remainingSlots = targetShortlistCount - selected.length;
  const familyCount = selected.filter(
    (item) => familyFor(item.category) === candidate.family
  ).length;
  const categoryCount = selected.filter(
    (item) => item.category === candidate.item.category
  ).length;

  if (rssNeeded === remainingSlots && candidate.item.sourceType !== "rss") {
    return Number.NEGATIVE_INFINITY;
  }

  let score = candidate.rankingScore;

  if (rssNeeded > 0 && candidate.item.sourceType === "rss") {
    score += 10;
  }

  if (familyCount === 0) {
    score += familyIntroBoost[candidate.family];
  }

  if (familyCount >= familySoftMax[candidate.family]) {
    score -= (familyCount - familySoftMax[candidate.family] + 1) * 7;
  }

  if (categoryCount >= 3) {
    score -= (categoryCount - 2) * 4;
  }

  return score;
}

function selectShortlist(scoredCandidates: ScoredCandidate[]): ShortlistedNewsItem[] {
  const selected: ShortlistedNewsItem[] = [];
  const validRssCount = scoredCandidates.filter(
    (entry) => entry.item.sourceType === "rss"
  ).length;

  if (scoredCandidates.length < targetShortlistCount) {
    throw new Error(
      `Cannot shortlist ${targetShortlistCount} items from ${scoredCandidates.length} valid candidates.`
    );
  }

  if (validRssCount < rssMinShortlistCount) {
    throw new Error(
      `Cannot meet RSS shortlist quota: ${validRssCount} valid RSS candidates, ${rssMinShortlistCount} required.`
    );
  }

  while (selected.length < targetShortlistCount) {
    const eligible = scoredCandidates.filter((candidate) => {
      if (selected.some((item) => item.id === candidate.item.id)) {
        return false;
      }

      if (isDuplicateOf(candidate.item, selected)) {
        return false;
      }

      if (!sourceQuotaAllows(candidate.item, selected)) {
        return false;
      }

      return canStillMeetRssMinimum(candidate.item, selected, scoredCandidates);
    });

    if (eligible.length === 0) {
      throw new Error("Cannot build a 10-item shortlist while respecting quotas.");
    }

    eligible.sort(
      (left, right) =>
        dynamicRankingScore(right, selected) -
          dynamicRankingScore(left, selected) ||
        right.item.shortlistScore - left.item.shortlistScore
    );

    selected.push(eligible[0].item);
  }

  return selected.sort((left, right) => right.shortlistScore - left.shortlistScore);
}

function createCategoryCounts(
  shortlisted: ShortlistedNewsItem[]
): Record<NewsCategory, number> {
  const counts = Object.fromEntries(
    categoryOrder.map((category) => [category, 0])
  ) as Record<NewsCategory, number>;

  for (const item of shortlisted) {
    counts[item.category] += 1;
  }

  return counts;
}

function createTagCounts(shortlisted: ShortlistedNewsItem[]): Record<NewsTag, number> {
  const counts = Object.fromEntries(
    tagOrder.map((tag) => [tag, 0])
  ) as Record<NewsTag, number>;

  for (const item of shortlisted) {
    for (const tag of item.tags) {
      counts[tag] += 1;
    }
  }

  return counts;
}

function explainElimination(
  candidate: NormalizedNewsItem,
  scoredById: Map<string, ScoredCandidate>,
  shortlisted: ShortlistedNewsItem[]
): ShortlistElimination {
  const scored = scoredById.get(candidate.id);
  const duplicate = isDuplicateOf(candidate, shortlisted);

  if (!hasRequiredSource(candidate)) {
    return {
      id: candidate.id,
      title: candidate.title,
      sourceName: candidate.sourceName,
      sourceType: candidate.sourceType,
      provider: candidate.provider,
      reason: "缺少 url 或 sourceName，不能进入编辑部初筛。"
    };
  }

  if (candidate.rejection) {
    return {
      id: candidate.id,
      title: candidate.title,
      sourceName: candidate.sourceName,
      sourceType: candidate.sourceType,
      provider: candidate.provider,
      reason: `候选项带有 rejection 标记：${candidate.rejection.reason}。`,
      shortlistScore: scored?.item.shortlistScore
    };
  }

  if (duplicate) {
    return {
      id: candidate.id,
      title: candidate.title,
      sourceName: candidate.sourceName,
      sourceType: candidate.sourceType,
      provider: candidate.provider,
      reason: `与已入围资讯《${duplicate.title}》疑似同一事件，避免重复入围。`,
      shortlistScore: scored?.item.shortlistScore
    };
  }

  if (candidate.sourceType === "global_search") {
    const globalQuotaReached =
      countSourceType(shortlisted, "global_search") >=
      globalSearchMaxShortlistCount;
    const providerQuotaReached =
      countSearchProviders(shortlisted) >= searchProviderMaxShortlistCount;
    const reason =
      globalQuotaReached || providerQuotaReached
        ? "受 global_search/Tavily/Exa 配额限制，且搜索摘要不能直接作为事实依据。"
        : "搜索线索的原创接近度和来源确定性弱于已入围项目，且 Tavily/Exa 摘要不能直接作为事实依据。";

    return {
      id: candidate.id,
      title: candidate.title,
      sourceName: candidate.sourceName,
      sourceType: candidate.sourceType,
      provider: candidate.provider,
      reason,
      shortlistScore: scored?.item.shortlistScore
    };
  }

  if (scored?.shallowUpdate) {
    return {
      id: candidate.id,
      title: candidate.title,
      sourceName: candidate.sourceName,
      sourceType: candidate.sourceType,
      provider: candidate.provider,
      reason: "更像浅层产品更新或汇总类内容，讨论空间弱于已入围项目。",
      shortlistScore: scored.item.shortlistScore
    };
  }

  return {
    id: candidate.id,
    title: candidate.title,
    sourceName: candidate.sourceName,
    sourceType: candidate.sourceType,
    provider: candidate.provider,
    reason: "综合技术含金量、公众号传播价值、来源可信度和类型平衡后未进入前 10。",
    shortlistScore: scored?.item.shortlistScore
  };
}

function createOutputFiles(outputDir: string): ShortlistOutputFiles {
  return {
    shortlistedNews: join(outputDir, "shortlisted-news.json"),
    shortlistReport: join(outputDir, "shortlist-report.md")
  };
}

async function readCandidates(inputFile: string): Promise<NormalizedNewsItem[]> {
  const content = await readFile(inputFile, "utf8");
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`Candidate news file must contain an array: ${inputFile}`);
  }

  return parsed as NormalizedNewsItem[];
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function markdownSafe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function createShortlistReport(result: NewsShortlistResult): string {
  const { stats, shortlisted, eliminated } = result;
  const categoryLines = categoryOrder.map(
    (category) => `- ${category}: ${stats.categoryCounts[category]}`
  );
  const tagLines = tagOrder.map((tag) => `- ${tag}: ${stats.tagCounts[tag]}`);
  const shortlistedLines = shortlisted.map((item, index) => {
    const provider = item.provider && item.provider !== "none" ? `/${item.provider}` : "";
    return `${index + 1}. ${markdownSafe(item.title)} | ${markdownSafe(
      item.sourceName
    )} | ${item.sourceType}${provider} | ${item.category} | tags: ${item.tags.join(
      ", "
    )} | ${item.shortlistScore.toFixed(
      1
    )} | reason: ${item.editorial.shortlistReason} | angle: ${
      item.editorial.topicAngle
    }`;
  });
  const eliminatedLines = eliminated.map(
    (item, index) =>
      `${index + 1}. ${markdownSafe(item.title)} | ${markdownSafe(
        item.sourceName ?? "Unknown source"
      )} | ${item.shortlistScore?.toFixed(1) ?? "n/a"} | ${item.reason}`
  );

  return [
    "# News Shortlist Report",
    "",
    "## Counts",
    "",
    `- candidate 总数: ${stats.candidateCount}`,
    `- shortlisted 总数: ${stats.shortlistedCount}`,
    `- RSS 入围数量: ${stats.rssShortlistedCount}`,
    `- global_search 入围数量: ${stats.globalSearchShortlistedCount}`,
    `- Tavily 入围数量: ${stats.tavilyShortlistedCount}`,
    `- Exa 入围数量: ${stats.exaShortlistedCount}`,
    "",
    "## Category Distribution / category 分布",
    "",
    ...categoryLines,
    "",
    "## Tags Distribution / tags 分布",
    "",
    ...tagLines,
    "",
    "## Shortlisted",
    "",
    ...shortlistedLines,
    "",
    "## Eliminated",
    "",
    ...eliminatedLines,
    "",
    "## Editorial Notes",
    "",
    "- 初筛不是按 finalScore 直接排序，而是综合技术含金量、公众号传播价值、商业影响、争议度、来源可信度、可解释性和原创接近度。",
    "- global_search 仅作为选题线索；Tavily/Exa 摘要不能直接成为事实依据。",
    "- 本阶段不选择最终主选题，不写文章，不生成封面，不操作公众号后台。",
    ""
  ].join("\n");
}

function createStats(
  candidates: NormalizedNewsItem[],
  shortlisted: ShortlistedNewsItem[]
) {
  return {
    candidateCount: candidates.length,
    shortlistedCount: shortlisted.length,
    rssShortlistedCount: countSourceType(shortlisted, "rss"),
    globalSearchShortlistedCount: countSourceType(shortlisted, "global_search"),
    tavilyShortlistedCount: countProvider(shortlisted, "tavily"),
    exaShortlistedCount: countProvider(shortlisted, "exa"),
    categoryCounts: createCategoryCounts(shortlisted),
    tagCounts: createTagCounts(shortlisted)
  };
}

export async function shortlistNewsWithReport(
  options: ShortlistNewsOptions = {}
): Promise<NewsShortlistResult> {
  const logger = options.logger ?? createLogger("news-shortlister");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const inputFile = options.inputFile ?? join(outputDir, "candidate-news.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const candidates = options.candidates ?? (await readCandidates(inputFile));
  const validCandidates = candidates.filter(
    (candidate) => hasRequiredSource(candidate) && !candidate.rejection
  );
  const scoredCandidates = validCandidates
    .map(toScoredCandidate)
    .sort(
      (left, right) =>
        right.rankingScore - left.rankingScore ||
        right.item.shortlistScore - left.item.shortlistScore
    );
  const shortlisted = selectShortlist(scoredCandidates);

  requireSourceUrl(shortlisted);

  const scoredById = new Map(
    scoredCandidates.map((candidate) => [candidate.item.id, candidate])
  );
  const shortlistedIds = new Set(shortlisted.map((item) => item.id));
  const eliminated = candidates
    .filter((candidate) => !shortlistedIds.has(candidate.id))
    .map((candidate) =>
      explainElimination(candidate, scoredById, shortlisted)
    );
  const stats = createStats(candidates, shortlisted);
  const result: NewsShortlistResult = {
    outputDir,
    files,
    candidates,
    shortlisted,
    eliminated,
    stats
  };

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.shortlistedNews, shortlisted);
    await writeFile(files.shortlistReport, createShortlistReport(result), "utf8");
  }

  logger.info(
    `Shortlisted ${stats.shortlistedCount} items: ${stats.rssShortlistedCount} RSS, ${stats.globalSearchShortlistedCount} global_search.`
  );

  return result;
}

export async function shortlistNews(
  options: ShortlistNewsOptions = {}
): Promise<ShortlistedNewsItem[]> {
  const result = await shortlistNewsWithReport(options);
  return result.shortlisted;
}
