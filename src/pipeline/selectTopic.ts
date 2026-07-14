import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateDecisionScore,
  getDomain,
  isLowTrustDomain,
  isTrustedDomain,
  scoreTopicDecisionDimensions
} from "../config/scoring.js";
import { DEFAULT_NEWS_LOOKBACK_HOURS } from "../config/sources.js";
import { requireSourceUrl } from "../hooks/requireSourceUrl.js";
import type {
  SelectedTopic,
  SelectedTopicRejectedItem,
  SelectedTopicRunnerUp,
  SelectedTopicSelection,
  ShortlistedNewsItem,
  SourceReliability,
  TopicSelectionOutputFiles,
  TopicSelectionResult
} from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { loadEditorialStyle } from "./loadEditorialStyle.js";
import type { EditorialStyleLoadResult, ManualTopicLoadResult } from "../types/editorial.js";
import type { EditorialFeedbackLoadResult } from "../types/feedback.js";

export interface SelectTopicOptions {
  outputDir?: string;
  inputFile?: string;
  shortlisted?: ShortlistedNewsItem[];
  editorialStyle?: EditorialStyleLoadResult;
  feedback?: EditorialFeedbackLoadResult;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

export interface SelectManualTopicOptions extends SelectTopicOptions {
  manualTopic: ManualTopicLoadResult;
}

interface RankedTopic {
  item: ShortlistedNewsItem;
  sourceReliability: SourceReliability;
  decisionScore: number;
  editorScore: number;
  ineligibleReason?: string;
}

interface EditorialProfile {
  selectedReason: string;
  whyMostWorthWriting: string;
  coreConflict: string;
  publicInterest: string;
  technicalSignificance: string;
  businessImpact: string;
  predictedImpact: string;
  writingAngle: string;
  suggestedTitles: string[];
  articleThesis: string;
  riskNotes: string[];
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const runnerUpCount = 2;

function trimText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function textFor(item: ShortlistedNewsItem): string {
  return `${item.title} ${item.summary} ${item.editorial.topicAngle}`.toLowerCase();
}

function hasSourceUrl(item: ShortlistedNewsItem): boolean {
  return trimText(item.url).length > 0;
}

function sourceReliabilityFor(item: ShortlistedNewsItem): SourceReliability {
  if (!hasSourceUrl(item) || isLowTrustDomain(item.url)) {
    return "low";
  }

  if (isTrustedDomain(item.url) || item.shortlistMetrics.sourceCredibility >= 90) {
    return "high";
  }

  if (item.shortlistMetrics.sourceCredibility >= 70) {
    return "medium";
  }

  return "low";
}

function hasReliableOriginalSource(item: ShortlistedNewsItem): boolean {
  if (item.sourceType !== "global_search") {
    return true;
  }

  const domain = getDomain(item.url);
  if (!domain || domain === "example.com" || domain.endsWith(".example.com")) {
    return false;
  }

  if (isTrustedDomain(item.url)) {
    return true;
  }

  return item.shortlistMetrics.sourceCredibility >= 80 && !isLowTrustDomain(item.url);
}

function ineligibleReasonFor(
  item: ShortlistedNewsItem,
  sourceReliability: SourceReliability,
  now: Date
): string | undefined {
  if (!hasSourceUrl(item)) {
    return "缺少 URL，不能作为今日主选题。";
  }

  const ageHours = ageHoursFor(item, now);
  if (ageHours !== undefined && ageHours > DEFAULT_NEWS_LOOKBACK_HOURS) {
    return `发布时间超过最近 ${DEFAULT_NEWS_LOOKBACK_HOURS} 小时窗口，不能作为每日简报主选题。`;
  }

  if (item.sourceType === "global_search" && !hasReliableOriginalSource(item)) {
    return "global_search 仅提供搜索摘要，缺少可靠原始来源支撑，不能作为今日主选题。";
  }

  if (sourceReliability === "low") {
    return "来源可靠性为 low，事实支撑不足，不能作为今日主选题。";
  }

  return undefined;
}

function conflictBoost(item: ShortlistedNewsItem): number {
  const text = textFor(item);
  let boost = 0;

  if (
    (text.includes("cost") && text.includes("free")) ||
    (text.includes("成本") && text.includes("免费")) ||
    (text.includes("价格") && text.includes("免费"))
  ) {
    boost += 3;
  }

  if (
    /\b(vs|versus|battles?)\b/.test(text) ||
    text.includes("替代") ||
    text.includes("对比") ||
    text.includes("竞争")
  ) {
    boost += 2;
  }

  if (
    text.includes("score below") ||
    text.includes("低于") ||
    text.includes("permission") ||
    text.includes("权限") ||
    text.includes("risk") ||
    text.includes("风险")
  ) {
    boost += 2;
  }

  if (text.includes("热议") || text.includes("争议") || text.includes("讨论")) {
    boost += 1.5;
  }

  if (
    text.includes("open source") ||
    text.includes("open-source") ||
    text.includes("开源") ||
    text.includes("agents.md")
  ) {
    boost += 1.5;
  }

  if (text.includes("workflow") || text.includes("工作流")) {
    boost += 1;
  }

  return boost;
}

function ageHoursFor(item: ShortlistedNewsItem, now: Date): number | undefined {
  if (!item.publishedAt) {
    return undefined;
  }

  const timestamp = Date.parse(item.publishedAt);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

function agePenalty(item: ShortlistedNewsItem, now: Date): number {
  const ageHours = ageHoursFor(item, now);
  if (ageHours === undefined) {
    return 1.5;
  }

  if (ageHours > DEFAULT_NEWS_LOOKBACK_HOURS) {
    return 10;
  }

  if (ageHours > 48) {
    return 1;
  }

  if (ageHours > 24) {
    return 0.4;
  }

  return 0;
}

function recencyBoost(item: ShortlistedNewsItem, now: Date): number {
  const ageHours = ageHoursFor(item, now);
  if (ageHours === undefined) {
    return -1;
  }

  if (ageHours <= 12) {
    return 2.5;
  }

  if (ageHours <= 24) {
    return 2;
  }

  if (ageHours <= 48) {
    return 1;
  }

  if (ageHours <= DEFAULT_NEWS_LOOKBACK_HOURS) {
    return 0.4;
  }

  return -4;
}

function topicalityBoost(item: ShortlistedNewsItem): number {
  let boost = 0;

  if (item.scores.heat >= 90) {
    boost += 3;
  } else if (item.scores.heat >= 80) {
    boost += 2;
  } else if (item.scores.heat >= 70) {
    boost += 1;
  }

  if (item.scores.wechatTopic >= 90) {
    boost += 2;
  } else if (item.scores.wechatTopic >= 80) {
    boost += 1;
  }

  if (item.scores.controversy >= 60) {
    boost += 1.5;
  }

  if ((item.duplicateSources?.length ?? 0) > 0) {
    boost += 1;
  }

  return boost;
}

function editorialScoreFor(
  item: ShortlistedNewsItem,
  decisionScore: number,
  sourceReliability: SourceReliability,
  ineligibleReason: string | undefined,
  now: Date
): number {
  let score =
    decisionScore +
    conflictBoost(item) +
    recencyBoost(item, now) +
    topicalityBoost(item) -
    agePenalty(item, now);

  if (sourceReliability === "high") {
    score += 1.5;
  } else if (sourceReliability === "medium") {
    score += 0.5;
  }

  if (item.sourceType === "rss") {
    score += 1;
  }

  if (item.editorial.recommendedUse === "main_topic_candidate") {
    score += 2;
  } else if (item.editorial.recommendedUse === "reference_only") {
    score -= 2;
  }

  if (item.category === "research" && item.shortlistMetrics.explainability < 70) {
    score -= 2;
  }

  if (textFor(item).includes("case study") || textFor(item).includes("客户案例")) {
    score -= 1.5;
  }

  if (ineligibleReason) {
    score -= 100;
  }

  return Math.round(score * 10) / 10;
}

function profileFor(item: ShortlistedNewsItem): EditorialProfile {
  const text = textFor(item);
  const title = trimText(item.titleZh) || trimText(item.title) || "这条 AI 资讯";
  const sourceName = trimText(item.sourceName) || "原始来源";
  const categoryProfiles: Record<ShortlistedNewsItem["category"], EditorialProfile> = {
    model: {
      selectedReason:
        "它能从模型能力更新延展到真实应用边界，适合用第三视角解释能力、成本和可用范围。",
      whyMostWorthWriting:
        "模型新闻容易被写成参数或跑分，但真正值得写的是它对产品、开发者和企业流程会造成什么具体影响。",
      coreConflict: "模型能力进展和真实场景可用性之间的落差。",
      publicInterest:
        "普通读者关心新能力能不能真的改善工作，而不是只看技术演示。",
      technicalSignificance:
        "模型能力变化会影响工具调用、多模态、评测、上下文和应用架构选择。",
      businessImpact:
        "它可能改变企业采购、开发者选型和应用层创业公司的产品路线。",
      predictedImpact:
        "后续竞争会更强调可复现评测、稳定性、成本和场景集成，而不是单一模型叙事。",
      writingAngle:
        "从能力边界和落地条件切入，解释这次模型变化会影响哪些工作流。",
      suggestedTitles: [
        `${title}，真正要看的不是热闹`,
        "模型更新之后，应用层要重新算一笔账",
        "AI 能力变强，问题开始转向落地边界"
      ],
      articleThesis:
        "模型能力的价值取决于它能否稳定进入具体工作流；比单点能力更重要的是成本、边界和可复现效果。",
      riskNotes: [
        "不要把厂商演示写成第三方复现结论。",
        "涉及 benchmark 时需要绑定指标、条件和来源。",
        "区分已经开放的能力、preview 和推测影响。"
      ]
    },
    product: {
      selectedReason:
        "它能把 AI 产品更新放进真实用户场景，读者容易理解，也适合讨论权限、可用范围和工作流变化。",
      whyMostWorthWriting:
        "产品发布不只是功能清单，关键是它把 AI 能力放进了哪个入口，以及哪些用户会改变工作方式。",
      coreConflict: "产品便利性提升和功能边界、权限治理之间的冲突。",
      publicInterest:
        "读者可以通过具体产品入口理解 AI 如何靠近日常工作。",
      technicalSignificance:
        "产品形态变化会牵动工具调用、上下文管理、权限、审计和人工接管。",
      businessImpact:
        "它可能改变用户留存、团队采购和平台入口竞争。",
      predictedImpact:
        "更多 AI 产品会从单点助手走向流程入口，企业也会同步要求治理能力。",
      writingAngle:
        "从用户实际工作方式的变化切入，少复述发布功能，多解释开放对象、限制和风险。",
      suggestedTitles: [
        `${title}，改变的不只是一个功能`,
        "AI 产品真正争夺的，是用户每天打开的入口",
        "新功能背后，是一次工作流重新分配"
      ],
      articleThesis:
        "AI 产品的影响不在于多一个入口，而在于它是否能嵌入真实流程并处理权限、边界和复核问题。",
      riskNotes: [
        "不要把 preview、灰度或 waitlist 写成全面开放。",
        "功能细节应回到官方公告或原始报道核验。",
        "避免替厂商做稳定性或安全性背书。"
      ]
    },
    tooling: {
      selectedReason:
        "它适合从开发者和团队工具链角度分析，能把技术变化落到成本、效率、治理和长期可控性。",
      whyMostWorthWriting:
        "工具链变化通常比单个模型更新更接近真实生产流程，也更能解释团队为什么会改变选型。",
      coreConflict: "工具效率提升和团队治理、成本、可迁移性之间的冲突。",
      publicInterest:
        "非技术读者能理解工具如何改变协作方式，技术读者也能看到具体选型问题。",
      technicalSignificance:
        "开发工具正在从单点功能走向任务编排、权限控制、上下文读取和自动执行。",
      businessImpact:
        "它会影响团队预算、供应商选择、开源策略和内部平台建设。",
      predictedImpact:
        "团队会更重视可审计流程、可替换架构和真实任务效果。",
      writingAngle:
        "从工具进入团队流程后的成本、权限和可控性切入，而不是写成单纯功能体验。",
      suggestedTitles: [
        `${title}，团队真正要算的是长期成本`,
        "AI 工具进入团队流程后，问题变复杂了",
        "开发工具的新竞争，开始转向流程控制权"
      ],
      articleThesis:
        "开发者工具的竞争正在从能力展示转向流程控制、成本结构和治理能力；谁能安全进入团队流程，谁才更接近真实价值。",
      riskNotes: [
        "不要把开源、免费或试用写成零成本。",
        "避免未经验证的工具胜负判断。",
        "说明来源线索和官方材料之间的边界。"
      ]
    },
    research: {
      selectedReason:
        "它适合把研究结果翻译成产业判断，同时提醒读者看懂实验设置和泛化限制。",
      whyMostWorthWriting:
        "研究发布容易被标题化为突破，但真正有价值的是解释方法、样本、局限和可能影响。",
      coreConflict: "实验结果的启发价值和现实应用泛化限制之间的冲突。",
      publicInterest:
        "读者能通过具体场景理解技术进展，同时避免把论文结论误读成产品能力。",
      technicalSignificance:
        "研究结果会影响评测方法、模型训练、产品路线和开发者工具选择。",
      businessImpact:
        "它可能影响企业试点方向、投资判断和产品研发优先级。",
      predictedImpact:
        "后续更重要的是第三方复现、开源材料、数据集和真实任务评估。",
      writingAngle:
        "从研究问题、实验设置和局限切入，把结果放进产业语境里谨慎解读。",
      suggestedTitles: [
        `${title}，先别急着写成落地`,
        "一项 AI 研究真正重要的，是它没有证明什么",
        "技术结果要看懂，先看实验边界"
      ],
      articleThesis:
        "研究发布的价值在于提供方向和证据线索，但只有结合实验边界、复现状态和应用条件，才能判断它对产业的真实影响。",
      riskNotes: [
        "不要把预印本或实验结果写成已经落地的产品能力。",
        "必须说明实验设置、样本或评测条件。",
        "避免从单项结果推出整体行业结论。"
      ]
    },
    funding: {
      selectedReason:
        "它适合从资本流向看 AI 应用和基础设施机会，但需要避免把融资写成商业成功定论。",
      whyMostWorthWriting:
        "融资新闻本身信息密度有限，值得写的是资金为什么流向这个问题，以及它反映的企业需求。",
      coreConflict: "资本热度和真实商业落地难度之间的冲突。",
      publicInterest:
        "创业者、从业者和企业读者都关心钱正在流向哪些 AI 场景。",
      technicalSignificance:
        "融资背后的技术价值通常落在数据、权限、评估、工作流集成或垂直自动化。",
      businessImpact:
        "它会影响创业方向、企业采购预期和竞争格局。",
      predictedImpact:
        "市场会继续筛选能解决真实流程问题的 AI 公司，而不只奖励概念包装。",
      writingAngle:
        "从融资背后的需求和约束切入，少写金额热度，多写为什么这个问题值得资本继续押注。",
      suggestedTitles: [
        `${title}，资本真正押注的是什么`,
        "AI 创业的钱，开始流向更具体的问题",
        "一笔融资背后，是企业 AI 的难题清单"
      ],
      articleThesis:
        "AI 融资事件更像需求信号而不是成功结论；真正值得观察的是资金背后的场景、壁垒和交付难度。",
      riskNotes: [
        "融资金额、轮次、投资方和估值必须有来源。",
        "不要把传闻估值写成确定事实。",
        "避免把单笔融资外推成行业定论。"
      ]
    },
    policy: {
      selectedReason:
        "它能帮助读者理解 AI 治理变化，但必须严格限定司法辖区、适用对象和生效状态。",
      whyMostWorthWriting:
        "政策题影响企业和产品决策，适合做清晰解释，但不能写成法律意见或跨地区泛化。",
      coreConflict: "技术快速扩散和监管规则逐步成形之间的冲突。",
      publicInterest:
        "企业、创作者和普通用户都会关心 AI 使用边界和责任变化。",
      technicalSignificance:
        "政策要求会反向影响模型评估、数据治理、安全流程和产品设计。",
      businessImpact:
        "它可能影响企业合规成本、产品上线节奏和跨区域运营。",
      predictedImpact:
        "AI 产品会更早把合规、审计和风险控制放进默认设计。",
      writingAngle:
        "从适用范围和实际义务切入，解释规则会改变哪些产品和团队动作。",
      suggestedTitles: [
        `${title}，影响要从适用范围看起`,
        "AI 监管真正改变的，是产品默认动作",
        "别把政策新闻写成口号，先看谁被影响"
      ],
      articleThesis:
        "AI 政策变化的关键不在态度表述，而在适用对象、义务范围和执行时间；这些细节会改变产品和企业流程。",
      riskNotes: [
        "不要输出法律意见口吻。",
        "不要跨司法辖区泛化。",
        "区分草案、指南、正式法规和执行动作。"
      ]
    }
  };

  const base = categoryProfiles[item.category];
  const tags = new Set(item.tags);
  const angleFromShortlist = trimText(item.editorial.topicAngle);
  const reasonFromShortlist = trimText(item.editorial.shortlistReason);
  const isSecurity = text.includes("security") || text.includes("安全") || text.includes("incident") || text.includes("事故");
  const isCaseStudy = text.includes("case study") || text.includes("客户案例") || text.includes("案例");
  const isOpenSource = tags.has("open-source") || /open source|open-source|开源/.test(text);
  const isAgent = tags.has("agent") || /agent|智能体|代理/.test(text);

  if (isSecurity) {
    return {
      selectedReason:
        reasonFromShortlist ||
        "它涉及 AI 安全、数据边界或事故响应，读者需要知道确认事实、影响范围和修复状态。",
      whyMostWorthWriting:
        "安全题不能只写恐慌点，更适合解释哪些事实已确认、哪些仍在调查，以及团队该如何理解风险。",
      coreConflict: "安全风险披露和事实边界仍不完整之间的冲突。",
      publicInterest:
        "用户和企业都会关心数据、账号、模型或系统是否受到影响。",
      technicalSignificance:
        "安全事件会暴露数据流、权限、模型调用或供应链中的薄弱环节。",
      businessImpact:
        "它会影响企业采购信任、合规审计和厂商响应机制。",
      predictedImpact:
        "团队会更重视影响范围、修复状态、日志和第三方复核。",
      writingAngle:
        angleFromShortlist || "从影响范围和确认状态切入，解释安全事件为什么不能被写成恐慌标题。",
      suggestedTitles: [
        `${title}，先看哪些事实已经确认`,
        "AI 安全事件不能只看标题，要看影响范围",
        "一次风险披露背后，是 AI 系统的治理考题"
      ],
      articleThesis:
        "AI 安全事件的判断重点不是制造恐慌，而是确认影响范围、数据类型、修复状态和仍待核验的信息。",
      riskNotes: [
        "不要夸大泄露规模。",
        "区分确认事实和调查中信息。",
        "避免无来源指责具体责任方。"
      ]
    };
  }

  if (isCaseStudy) {
    return {
      selectedReason:
        reasonFromShortlist ||
        "它能用具体案例解释 AI 如何进入业务流程，但需要控制供应商案例偏差。",
      whyMostWorthWriting:
        "案例题有可读性，真正值得写的是指标口径、适用条件和哪些经验不能直接迁移。",
      coreConflict: "单一案例的启发价值和行业泛化风险之间的冲突。",
      publicInterest:
        "读者容易通过具体团队或场景理解 AI 落地的真实难点。",
      technicalSignificance:
        "案例通常能暴露数据、流程、评估和人工复核如何协同。",
      businessImpact:
        "它会影响企业试点、采购标准和供应商叙事。",
      predictedImpact:
        "更多团队会从小范围流程试点开始，而不是一次性替换完整岗位。",
      writingAngle:
        angleFromShortlist || "从案例适用条件切入，解释哪些经验值得借鉴、哪些不能外推。",
      suggestedTitles: [
        `${title}，不能被写成行业定论`,
        "一个 AI 案例真正有用的，是它的限制条件",
        "企业 AI 落地，先从可复核流程开始"
      ],
      articleThesis:
        "AI 案例的价值在于展示可执行路径，但只有说清指标口径、人工复核和迁移限制，才不会把个案误写成行业事实。",
      riskNotes: [
        "不要把单一案例泛化为行业事实。",
        "说明供应商参与程度和指标口径。",
        "保留人工复核条件。"
      ]
    };
  }

  if (isOpenSource || isAgent) {
    return {
      ...base,
      selectedReason:
        reasonFromShortlist ||
        "它能从工具生态变化讲到团队如何评估成本、可控性和治理边界。",
      coreConflict: "开放生态带来的可控性和真实使用成本、维护责任之间的冲突。",
      writingAngle:
        angleFromShortlist ||
        "从工具进入真实团队流程后的可控性、成本和治理切入，而不是写成简单替代叙事。",
      suggestedTitles: [
        `${title}，真正要看团队怎么用`,
        "AI 工具的竞争，开始回到流程和治理",
        "开源或智能体工具进入团队后，问题才刚开始"
      ],
      articleThesis:
        "工具生态变化的价值不在口号，而在团队能否把它安全、可控、可审计地接进真实流程。",
      riskNotes: [
        ...base.riskNotes,
        "不要把开源或免费写成零成本。",
        "不要写成未经验证的能力等同或全面替代。"
      ]
    };
  }

  return {
    ...base,
    selectedReason: reasonFromShortlist || base.selectedReason,
    writingAngle: angleFromShortlist || base.writingAngle,
    suggestedTitles: [
      `${title}，真正要看的是什么`,
      ...base.suggestedTitles
    ].slice(0, 4),
    riskNotes: [
      `原始来源为 ${sourceName}，正文需要回到原始材料核验。`,
      ...base.riskNotes
    ]
  };
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Manual Topic";
  }
}

function textFallback(value: string | undefined, fallback: string): string {
  const trimmed = trimText(value);
  return trimmed || fallback;
}

function createManualShortlistedItem(
  manualTopic: ManualTopicLoadResult,
  now: Date
): ShortlistedNewsItem {
  const title = textFallback(manualTopic.title, "人工选题");
  const url = textFallback(manualTopic.sourceUrl, "");

  if (!url) {
    throw new Error(
      `Manual topic requires a source URL before fact pack can run: ${manualTopic.filePath}`
    );
  }

  const sourceName = textFallback(manualTopic.sourceName, hostFromUrl(url));
  const topicAngle = textFallback(
    manualTopic.angle,
    "从第三视角分析这条 AI 资讯背后的冲突、事实边界、行业逻辑和影响人群。"
  );
  const thesis = textFallback(
    manualTopic.thesis,
    "人工选题需要被放回工作流、成本结构、工具生态或行业入口变化里判断。"
  );
  const fetchedAt = now.toISOString();

  return {
    id: `manual-${Buffer.from(`${title}:${url}`).toString("base64url").slice(0, 16)}`,
    title,
    url,
    sourceName,
    sourceType: "manual",
    provider: "none",
    fetchedAt,
    summary: textFallback(
      manualTopic.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" "),
      title
    ),
    category: "tooling",
    evidence: [`manual-topic: ${manualTopic.filePath}`, `url: ${url}`],
    duplicateKey: `manual:${url}`,
    scores: {
      freshness: 90,
      heat: 80,
      technicalValue: 82,
      wechatTopic: 88,
      businessImpact: 78,
      controversy: 45,
      final: 84
    },
    duplicateSources: [],
    tags: ["tooling", "agent", "developer-workflow", "business"],
    shortlistScore: 88,
    shortlistMetrics: {
      technicalValue: 82,
      wechatTopic: 88,
      businessImpact: 78,
      controversy: 45,
      sourceCredibility: 82,
      explainability: 86,
      originality: 90
    },
    editorial: {
      shortlistReason: "人工选题覆盖，优先进入今日主文候选。",
      audienceFit: "开发者、企业团队、内容创作者和普通 AI 关注者。",
      topicAngle,
      riskNote: "人工选题只能改变选题入口，不能绕过 fact pack、文章审核和排版检查。",
      recommendedUse: "main_topic_candidate"
    }
  };
}

function manualProfileFor(
  item: ShortlistedNewsItem,
  manualTopic: ManualTopicLoadResult
): EditorialProfile {
  const thesis = textFallback(
    manualTopic.thesis,
    "人工选题的价值不在复述新闻，而在解释它暴露出的工作流、成本结构和行业入口变化。"
  );

  return {
    selectedReason:
      "本次运行检测到非空 manual-topic.md，因此按人工选题覆盖今日主选题；覆盖只发生在选题入口，后续 fact pack、文章写作、文章审核、封面、排版和草稿 dry-run 仍按完整链路执行。",
    whyMostWorthWriting:
      "人工选题代表编辑已经提前判断它更适合今天账号语境，但系统仍需要用来源 URL、fact pack 和审核报告来约束事实边界。",
    coreConflict: "人工判断的内容方向和事实核验流程之间需要同时成立。",
    publicInterest:
      "读者关心的不是一条资讯本身，而是它会怎样改变普通人、开发者或企业团队的工作方式。",
    technicalSignificance:
      "该选题需要被放进 AI 工具、工作流、权限、成本或基础设施变化中解释。",
    businessImpact:
      "它可能影响企业采购、开发者选型、内容生产或创业机会判断。",
    predictedImpact:
      "更稳妥的趋势判断应来自事实包和文章审核，而不是人工选题本身的直觉。",
    writingAngle: textFallback(manualTopic.angle, item.editorial.topicAngle),
    suggestedTitles: [
      "AI 工具真正改变的，不是功能，而是工作流",
      "这条 AI 新闻值得写，因为冲突不在表面",
      "普通人会先感到变化，行业才会重新洗牌",
      "技术圈争论背后，是一次流程边界变化",
      "不要只看新功能，真正变化发生在流程里"
    ],
    articleThesis: thesis,
    riskNotes: [
      "人工选题必须保留来源 URL，后续 fact pack 不能被跳过。",
      "不能把 manual-topic.md 中的判断直接写成事实。",
      "标题和正文仍要避开 fact pack 禁止表达。"
    ]
  };
}

function buildSelection(
  ranked: RankedTopic,
  shortlisted: ShortlistedNewsItem[]
): SelectedTopicSelection {
  const profile = profileFor(ranked.item);
  const highestDecisionScore = Math.max(
    ...shortlisted.map((item) =>
      calculateDecisionScore(scoreTopicDecisionDimensions(item))
    )
  );
  const scoreNote =
    ranked.decisionScore < highestDecisionScore
      ? `它的 decisionScore 为 ${ranked.decisionScore.toFixed(
          1
        )}，不是机械选择分数最高项；编辑判断认为它的冲突、可写角度和风险控制更适合今天主文。`
      : `它的 decisionScore 为 ${ranked.decisionScore.toFixed(
          1
        )}，但最终选择仍经过冲突强度、读者理解、来源可靠性和 1500 字观点文可写性的复核。`;

  return {
    ...profile,
    selectedReason: `${profile.selectedReason} ${scoreNote}`,
    sourceReliability: ranked.sourceReliability,
    decisionScore: ranked.decisionScore
  };
}

function rankTopics(items: ShortlistedNewsItem[], now: Date): RankedTopic[] {
  return items
    .map((item) => {
      const sourceReliability = sourceReliabilityFor(item);
      const decisionScore = calculateDecisionScore(
        scoreTopicDecisionDimensions(item)
      );
      const ineligibleReason = ineligibleReasonFor(item, sourceReliability, now);

      return {
        item,
        sourceReliability,
        decisionScore,
        editorScore: editorialScoreFor(
          item,
          decisionScore,
          sourceReliability,
          ineligibleReason,
          now
        ),
        ineligibleReason
      };
    })
    .sort(
      (left, right) =>
        right.editorScore - left.editorScore ||
        right.decisionScore - left.decisionScore ||
        right.item.shortlistScore - left.item.shortlistScore
    );
}

function runnerReasonFor(ranked: RankedTopic): string {
  const profile = profileFor(ranked.item);
  return `${profile.coreConflict} decisionScore ${ranked.decisionScore.toFixed(
    1
  )}；${ranked.item.editorial.topicAngle}`;
}

function whyNotSelectedFor(ranked: RankedTopic): string {
  if (ranked.ineligibleReason) {
    return ranked.ineligibleReason;
  }

  const profile = profileFor(ranked.item);
  const categoryReason: Record<ShortlistedNewsItem["category"], string> = {
    model: "模型能力题可写，但今天主文需要更强的来源支撑和读者冲突。",
    product: "产品发布题读者面较广，但需确认开放范围和功能边界后更适合展开。",
    tooling: "工具链题适合技术读者，但传播面和事实支撑略弱于主选题。",
    research: "研究题技术含量高，但需要更多实验条件和局限信息支撑。",
    funding: "商业题有趋势价值，但金额、轮次或估值若缺少强来源，不宜作为主文。",
    policy: "政策题影响重要，但需要更清楚的司法辖区、适用对象和生效状态。"
  };

  return `${categoryReason[ranked.item.category]} ${profile.coreConflict}`;
}

function createRunnerUps(ranked: RankedTopic[], selectedId: string): SelectedTopicRunnerUp[] {
  return ranked
    .filter((entry) => entry.item.id !== selectedId)
    .slice(0, runnerUpCount)
    .map((entry) => ({
      title: entry.item.title,
      url: entry.item.url,
      reason: runnerReasonFor(entry),
      whyNotSelected: whyNotSelectedFor(entry)
    }));
}

function createRejected(
  shortlisted: ShortlistedNewsItem[],
  rankedById: Map<string, RankedTopic>,
  selectedId: string,
  runnerUps: SelectedTopicRunnerUp[]
): SelectedTopicRejectedItem[] {
  const runnerUpTitles = new Set(runnerUps.map((item) => item.title));

  return shortlisted
    .filter((item) => item.id !== selectedId && !runnerUpTitles.has(item.title))
    .map((item) => {
      const ranked = rankedById.get(item.id);
      return {
        title: item.title,
        url: item.url,
        reason: ranked
          ? whyNotSelectedFor(ranked)
          : "综合主编判断后未进入今日主选题。"
      };
    });
}

export function selectTopic(
  shortlisted: ShortlistedNewsItem[],
  options: Pick<SelectTopicOptions, "now"> = {}
): SelectedTopic {
  if (shortlisted.length === 0) {
    throw new Error("Cannot select a topic from an empty shortlist.");
  }

  const now = options.now ?? new Date();
  const ranked = rankTopics(shortlisted, now);
  const selectedRanked = ranked.find((entry) => !entry.ineligibleReason);

  if (!selectedRanked) {
    throw new Error("Cannot select a topic: no eligible shortlisted item remains.");
  }

  requireSourceUrl(selectedRanked.item);

  const selection = buildSelection(selectedRanked, shortlisted);
  if (selection.sourceReliability === "low") {
    throw new Error("Cannot select a topic with low source reliability.");
  }

  const runnersUp = createRunnerUps(ranked, selectedRanked.item.id);
  const rankedById = new Map(ranked.map((entry) => [entry.item.id, entry]));
  const rejected = createRejected(
    shortlisted,
    rankedById,
    selectedRanked.item.id,
    runnersUp
  );

  return {
    selected: {
      ...selectedRanked.item,
      selection
    },
    runnersUp,
    rejected,
    generatedAt: now.toISOString()
  };
}

export function selectManualTopic(
  manualTopic: ManualTopicLoadResult,
  shortlisted: ShortlistedNewsItem[] = [],
  options: Pick<SelectTopicOptions, "now"> = {}
): SelectedTopic {
  const now = options.now ?? new Date();
  const item = createManualShortlistedItem(manualTopic, now);
  requireSourceUrl(item);

  const selectionProfile = manualProfileFor(item, manualTopic);
  const selected = {
    ...item,
    selection: {
      ...selectionProfile,
      sourceReliability: "medium" as const,
      decisionScore: 90
    }
  };
  const runnerUps = shortlisted
    .slice(0, runnerUpCount)
    .map((runner) => ({
      title: runner.title,
      url: runner.url,
      reason: `${runner.editorial.topicAngle} decisionScore ${calculateDecisionScore(
        scoreTopicDecisionDimensions(runner)
      ).toFixed(1)}`,
      whyNotSelected:
        "本次存在人工选题覆盖，该入围资讯保留为备选，未绕过后续事实核验。"
    }));
  const runnerTitles = new Set(runnerUps.map((runner) => runner.title));
  const rejected = shortlisted
    .filter((runner) => !runnerTitles.has(runner.title))
    .map((runner) => ({
      title: runner.title,
      url: runner.url,
      reason: "本次存在人工选题覆盖，未进入今日主文。"
    }));

  return {
    selected,
    runnersUp: runnerUps,
    rejected,
    generatedAt: now.toISOString()
  };
}

function createOutputFiles(outputDir: string): TopicSelectionOutputFiles {
  return {
    selectedTopic: join(outputDir, "selected-topic.json"),
    topicSelectionReport: join(outputDir, "topic-selection-report.md")
  };
}

async function readShortlisted(inputFile: string): Promise<ShortlistedNewsItem[]> {
  const content = await readFile(inputFile, "utf8");
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`Shortlisted news file must contain an array: ${inputFile}`);
  }

  return parsed as ShortlistedNewsItem[];
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function markdownSafe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function createFeedbackSummary(feedback: EditorialFeedbackLoadResult | undefined): string[] {
  if (!feedback?.latest) {
    return ["- feedbackRead: no"];
  }

  const latest = feedback.latest;
  return [
    "- feedbackRead: yes",
    `- feedbackFile: ${latest.filePath}`,
    `- feedbackDate: ${latest.date}`,
    `- titleQuality: ${latest.titleQuality}`,
    `- topicQuality: ${latest.topicQuality}`,
    `- notes: ${latest.notes || "none"}`
  ];
}

function createStyleSummary(style: EditorialStyleLoadResult | undefined): string[] {
  if (!style?.loaded) {
    return ["- editorialStyleRead: no"];
  }

  return [
    "- editorialStyleRead: yes",
    `- editorialStyleFile: ${style.path}`,
    "- styleApplied: 第三视角 / 旁观者分析 / 通俗但犀利 / 非通稿 / 非营销号腔"
  ];
}

function createTopicSelectionReport(
  topic: SelectedTopic,
  context: {
    editorialStyle?: EditorialStyleLoadResult;
    feedback?: EditorialFeedbackLoadResult;
    manualTopic?: ManualTopicLoadResult;
  } = {}
): string {
  const { selected, runnersUp, rejected } = topic;
  const selection = selected.selection;
  const titleLines = selection.suggestedTitles.map((title) => `- ${title}`);
  const riskLines = selection.riskNotes.map((note) => `- ${note}`);
  const impactLines = [
    `- 开发者/技术团队：${selection.technicalSignificance}`,
    `- 企业和创业者：${selection.businessImpact}`,
    `- 普通读者/知识工作者：${selection.publicInterest}`,
    `- 后续趋势：${selection.predictedImpact}`
  ];
  const runnerUpLines = runnersUp.map(
    (item, index) =>
      `${index + 1}. ${markdownSafe(item.title)} | ${item.url} | ${item.whyNotSelected}`
  );
  const rejectedLines = rejected.map(
    (item, index) =>
      `${index + 1}. ${markdownSafe(item.title)} | ${item.url || "missing url"} | ${item.reason}`
  );

  return [
    "# Topic Selection Report",
    "",
    `Generated at: ${topic.generatedAt}`,
    "",
    "## v0.3.1 内容质量输入",
    "",
    `- manualTopicUsed: ${context.manualTopic?.used ? "yes" : "no"}`,
    context.manualTopic?.used
      ? `- manualTopicFile: ${context.manualTopic.filePath}`
      : "- manualTopicFile: none",
    ...createStyleSummary(context.editorialStyle),
    ...createFeedbackSummary(context.feedback),
    "",
    "## 今日主选题标题",
    "",
    selected.title,
    "",
    "## 来源链接",
    "",
    `[${selected.sourceName}](${selected.url})`,
    "",
    "## 为什么它最值得写",
    "",
    selection.whyMostWorthWriting,
    "",
    `主编决策说明：${selection.selectedReason}`,
    "",
    `decisionScore: ${selection.decisionScore.toFixed(1)}`,
    `sourceReliability: ${selection.sourceReliability}`,
    "",
    "## 它的核心冲突是什么",
    "",
    selection.coreConflict,
    "",
    "## 它适合公众号的写作角度",
    "",
    selection.writingAngle,
    "",
    "## 建议标题",
    "",
    ...titleLines,
    "",
    "## 文章中心论点 articleThesis",
    "",
    selection.articleThesis,
    "",
    "## 预计会影响哪些人",
    "",
    ...impactLines,
    "",
    "## 写作风险提醒",
    "",
    ...riskLines,
    "",
    "## 为什么没有选择其他入围资讯",
    "",
    "### Runners-up",
    "",
    ...runnerUpLines,
    "",
    "### Rejected",
    "",
    ...rejectedLines,
    "",
    "## 边界",
    "",
    "- 本阶段只做主编选题决策。",
    "- 不写公众号正文，不生成 article.md，不生成封面，不排版 HTML。",
    "- 不调用 APIMart，不操作公众号后台，不加入 Playwright 或浏览器自动化。",
    ""
  ].join("\n");
}

export async function selectTopicWithReport(
  options: SelectTopicOptions = {}
): Promise<TopicSelectionResult> {
  const logger = options.logger ?? createLogger("topic-editor");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const inputFile = options.inputFile ?? join(outputDir, "shortlisted-news.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const shortlisted = options.shortlisted ?? (await readShortlisted(inputFile));
  const editorialStyle =
    options.editorialStyle ?? (await loadEditorialStyle({ logger }));
  const topic = selectTopic(shortlisted, { now: options.now });

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.selectedTopic, topic);
    await writeFile(
      files.topicSelectionReport,
      createTopicSelectionReport(topic, {
        editorialStyle,
        feedback: options.feedback
      }),
      "utf8"
    );
  }

  logger.info(
    `Selected topic: ${topic.selected.title} (decisionScore ${topic.selected.selection.decisionScore.toFixed(
      1
    )}, sourceReliability ${topic.selected.selection.sourceReliability}).`
  );

  return {
    outputDir,
    files,
    shortlisted,
    topic
  };
}

export async function selectManualTopicWithReport(
  options: SelectManualTopicOptions
): Promise<TopicSelectionResult> {
  const logger = options.logger ?? createLogger("topic-editor");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const inputFile = options.inputFile ?? join(outputDir, "shortlisted-news.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const shortlisted = options.shortlisted ?? (await readShortlisted(inputFile));
  const editorialStyle =
    options.editorialStyle ?? (await loadEditorialStyle({ logger }));
  const topic = selectManualTopic(options.manualTopic, shortlisted, {
    now: options.now
  });

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.selectedTopic, topic);
    await writeFile(
      files.topicSelectionReport,
      createTopicSelectionReport(topic, {
        editorialStyle,
        feedback: options.feedback,
        manualTopic: options.manualTopic
      }),
      "utf8"
    );
  }

  logger.info(
    `Selected manual topic: ${topic.selected.title} (sourceReliability ${topic.selected.selection.sourceReliability}).`
  );

  return {
    outputDir,
    files,
    shortlisted,
    topic
  };
}
