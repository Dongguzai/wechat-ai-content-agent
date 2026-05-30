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
  sourceReliability: SourceReliability
): string | undefined {
  if (!hasSourceUrl(item)) {
    return "缺少 URL，不能作为今日主选题。";
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

  if (text.includes("cost") && text.includes("free")) {
    boost += 3;
  }

  if (/\b(vs|versus|battles?)\b/.test(text) || text.includes("替代")) {
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

function agePenalty(item: ShortlistedNewsItem, now: Date): number {
  if (!item.publishedAt) {
    return 1;
  }

  const timestamp = Date.parse(item.publishedAt);
  if (!Number.isFinite(timestamp)) {
    return 1;
  }

  const ageDays = (now.getTime() - timestamp) / 86_400_000;
  if (ageDays > 45) {
    return 1.5;
  }
  if (ageDays > 14) {
    return 1;
  }
  return 0;
}

function editorialScoreFor(
  item: ShortlistedNewsItem,
  decisionScore: number,
  sourceReliability: SourceReliability,
  ineligibleReason: string | undefined,
  now: Date
): number {
  let score = decisionScore + conflictBoost(item) - agePenalty(item, now);

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

  if (text.includes("claude code") && text.includes("goose")) {
    return {
      selectedReason:
        "它把 AI 编码代理最容易被读者理解的矛盾放在了台面上：一个是高价闭源订阅，一个是免费开源替代。分数靠前只是结果，更关键的是这个题能同时讲清工具成本、开源生态和开发者工作流三件事。",
      whyMostWorthWriting:
        "这不是单纯的价格新闻，而是编码代理从新鲜工具走向日常生产力时必然遇到的选择题：团队到底买平台、押开源，还是把二者组合进自己的研发流程。普通读者能理解“每月 200 美元 vs 免费”，技术读者也能继续讨论能力边界、可控性和锁定风险。",
      coreConflict:
        "闭源高价编码代理的便利性和开源免费替代的可控性之间的冲突。",
      publicInterest:
        "价格差异足够直观，能让非技术读者理解 AI 工具正在从“试试看”变成真实预算问题。",
      technicalSignificance:
        "编码代理不再只是代码补全，而是在终端、仓库、测试和部署链路里执行长任务；开源替代的出现会影响开发者如何评估工具能力和安全边界。",
      businessImpact:
        "它会影响企业研发团队的订阅预算、工具采购、供应商锁定和开源方案试点，也会影响 AI 编程工具厂商的定价空间。",
      predictedImpact:
        "更多团队会把编码代理从个人尝鲜带入正式选型，开源工具会被用于成本对冲和能力验证，闭源工具需要用可靠性、集成和安全治理证明溢价。",
      writingAngle:
        "不要写成“谁更便宜”的评测，而要从第三视角分析：当编码代理开始进入真实研发流程，价格只是表层，背后是开发者工作方式、团队治理和工具生态控制权的重排。",
      suggestedTitles: [
        "AI 编码代理真正卷到的，不是价格，而是工作流",
        "Claude Code 很贵，Goose 免费：开发者为什么开始重新算账",
        "这次开源不是热闹，是编码代理的护城河开始松动",
        "当 AI 写代码变成月度账单，团队该怎么选工具",
        "所有人都在追新模型，开发者先遇到的是工具锁定"
      ],
      articleThesis:
        "编码代理的主战场正在从模型能力转向工作流控制权；高价闭源工具和免费开源替代的对比，提醒开发者和团队重新评估成本、可控性与长期锁定风险。",
      riskNotes: [
        "VentureBeat 是媒体报道，不是 Anthropic 或 Goose 的官方定价页，正文需要提示价格和功能以原始来源为准。",
        "不能把“免费”写成“零成本”，开源工具仍有部署、维护、安全审计和团队培训成本。",
        "避免做未经验证的能力胜负判断，文章应聚焦工具生态和工作流变化。"
      ]
    };
  }

  if (text.includes("cowork")) {
    return {
      selectedReason:
        "它把 coding agent 的能力带到普通办公文件里，读者面很广，冲突也清楚：方便和权限风险同时上升。",
      whyMostWorthWriting:
        "这个题适合讨论 agent 从开发者工具走向办公室工具的临界点，能连接普通用户、企业 IT 和内容团队的真实工作流。",
      coreConflict: "文件级自动化的效率提升和企业数据权限风险之间的冲突。",
      publicInterest:
        "不用写代码就能让 AI 操作文件，普通职场读者很容易代入自己的文档、表格和资料整理场景。",
      technicalSignificance:
        "agent 开始接管本地文件和跨应用任务，意味着工具调用、权限、审计和人工接管会成为产品核心能力。",
      businessImpact:
        "它会影响办公套件、协作软件和模型公司的入口竞争，也会推动企业重新制定文件权限和 AI 使用规范。",
      predictedImpact:
        "非技术团队会更快试用文件 agent，但企业采购会同步要求权限隔离、日志审计和可撤销操作。",
      writingAngle:
        "从“agent 离普通人还有多远”切入，分析文件操作能力为什么是办公自动化的分水岭，以及为什么权限治理会决定它能走多远。",
      suggestedTitles: [
        "AI Agent 走进文件夹，普通人的工作流开始变了",
        "不写代码也能用 Agent，真正的难题是权限",
        "Claude Desktop 的新方向：从聊天到替你处理文件",
        "AI 办公的下一步，不是写摘要，而是动手改文件"
      ],
      articleThesis:
        "文件 agent 的价值不在于多一个聊天入口，而在于让 AI 接近真实工作现场；它越有用，企业越需要把权限、审计和人工复核设计清楚。",
      riskNotes: [
        "需要区分产品发布信息和实际可用范围。",
        "涉及文件权限和隐私时，避免夸大安全风险或替厂商背书。",
        "如果缺少官方细节，正文应保留条件判断。"
      ]
    };
  }

  if (text.includes("slackbot")) {
    return {
      selectedReason:
        "它能从一个熟悉的企业聊天入口讲清 workplace AI 的平台之争，商业影响强，普通职场读者也容易理解。",
      whyMostWorthWriting:
        "Slackbot 变成 agent，背后不是一个功能更新，而是企业知识、销售线索和内部协作入口到底由谁掌控。",
      coreConflict: "协作软件入口、CRM 数据和办公 AI 平台之间的控制权冲突。",
      publicInterest:
        "很多读者都熟悉企业聊天工具，能理解“机器人从提醒变成办事入口”意味着什么。",
      technicalSignificance:
        "企业 agent 要连接搜索、知识库、CRM 和权限系统，难点在上下文、工具调用和可审计执行。",
      businessImpact:
        "Salesforce、Microsoft 和 Google 的 workplace AI 竞争会影响企业软件预算和员工默认工作入口。",
      predictedImpact:
        "聊天工具会继续从沟通层下探到业务执行层，企业会围绕数据权限和系统集成重新评估供应商。",
      writingAngle:
        "从“企业聊天窗口为什么变成 AI 战场”切入，写平台入口之争，而不是复述 Slackbot 功能。",
      suggestedTitles: [
        "Slackbot 变成 AI Agent，企业入口之争开始换打法",
        "工作群里的机器人，正在变成新的办公入口",
        "Salesforce 追上来了，职场 AI 的战场不只在文档里",
        "企业 AI 真正争夺的，是员工每天打开的那个窗口"
      ],
      articleThesis:
        "企业 AI 的关键入口可能不是独立应用，而是员工已经停留的协作窗口；谁能把聊天、知识和业务系统接起来，谁就更接近日常工作流。",
      riskNotes: [
        "不要把厂商发布等同于企业已经大规模替换工作流。",
        "需要提示 Salesforce、Microsoft、Google 的比较属于行业判断。",
        "功能细节应以原始报道和官方材料为准。"
      ]
    };
  }

  if (text.includes("product-market fit")) {
    return {
      selectedReason:
        "它适合做商业判断型文章，能讨论基础模型公司如何从能力竞赛转向工作流变现。",
      whyMostWorthWriting:
        "PMF 不是技术参数，但它解释了为什么 OpenAI 和 Anthropic 的收入增长会来自开发者、办公和企业流程。",
      coreConflict: "基础模型能力竞赛和具体工作流变现之间的冲突。",
      publicInterest:
        "读者能通过订阅费、企业账单和团队使用量理解模型公司为什么开始真正赚钱。",
      technicalSignificance:
        "模型能力只有嵌入 coding、写作、检索和企业流程，才会变成稳定使用频次。",
      businessImpact:
        "创业者需要重新判断机会是在做新模型、做垂直 agent，还是做企业流程里的集成和评估。",
      predictedImpact:
        "AI 创业叙事会从“谁的模型更强”转向“谁占住高频付费工作流”。",
      writingAngle:
        "把它写成一篇旁观者判断：模型公司的 PMF 不是聊天本身，而是开发者和企业用户愿意为高频工作流持续付费。",
      suggestedTitles: [
        "OpenAI 和 Anthropic 真正找到的，可能不是聊天需求",
        "AI 公司的 PMF，藏在越来越贵的团队账单里",
        "所有人都在看模型，真正的变化发生在工作流里",
        "基础模型公司开始赚钱，创业机会反而更难判断了"
      ],
      articleThesis:
        "基础模型公司的产品市场匹配，来自模型能力进入高频、刚需、可付费的工作流；这会同时抬高创业门槛，也暴露新的垂直机会。",
      riskNotes: [
        "原文包含传闻性表述，不能把利润或收入信息写成确定事实。",
        "Simon Willison 是可信技术观察者，但这是一篇观点文章，不是公司公告。",
        "需要区分事实、原文观点和本文判断。"
      ]
    };
  }

  if (text.includes("itbench-aa") || text.includes("score below 50")) {
    return {
      selectedReason:
        "它有很强的技术可靠性和反差：企业 agent 说得很热，但真实 IT 任务基准成绩并不理想。",
      whyMostWorthWriting:
        "这个题能提醒读者别把演示里的自动化等同于生产环境里的省人，适合做冷静的第三视角分析。",
      coreConflict: "AI agent 的营销预期和真实企业 IT 任务完成能力之间的冲突。",
      publicInterest:
        "企业正在考虑采购 agent，管理者和员工都关心它到底能不能替人处理复杂任务。",
      technicalSignificance:
        "基准测试把 agent 放进更接近企业环境的任务里，暴露权限、异常处理、跨系统操作和长期任务规划的短板。",
      businessImpact:
        "它会影响企业采购节奏、POC 评估标准和厂商对 agent 能力的表达方式。",
      predictedImpact:
        "企业会更重视 eval、审计和分阶段落地，agent 厂商也需要用真实任务指标证明价值。",
      writingAngle:
        "从“低于 50% 的成绩为什么反而是好消息”切入，讲清真实基准如何把 AI agent 从演示拉回生产环境。",
      suggestedTitles: [
        "企业 Agent 还没到替人时刻，基准测试先泼了冷水",
        "低于 50% 的成绩，说明 AI Agent 终于开始面对真实任务",
        "别急着用 Agent 省人，企业 IT 任务没有那么简单",
        "AI 自动化最大的差距，不在模型，而在真实工作现场"
      ],
      articleThesis:
        "企业 agent 的关键拐点不是演示更炫，而是能否在真实系统、权限和异常环境下稳定完成任务；低分基准让行业开始用更诚实的标准衡量自动化。",
      riskNotes: [
        "基准测试覆盖范围有限，不能外推为所有 agent 都不可靠。",
        "需要说明测试设计、任务类型和参与模型，以免读者误解。",
        "避免把低分写成失败，应强调它对评估标准的价值。"
      ]
    };
  }

  if (text.includes("warp")) {
    return {
      selectedReason:
        "它适合讨论开发工具厂商如何借开源扩散，同时保留商业入口。",
      whyMostWorthWriting:
        "Warp 的故事不只是一个厂商案例，而是 coding agent、终端、云端执行和开源协作如何重新组合。",
      coreConflict: "开源扩散速度和商业产品入口控制之间的冲突。",
      publicInterest:
        "开发者能理解终端和代码工作流的变化，非技术读者也能理解厂商为什么拥抱开源。",
      technicalSignificance:
        "它涉及本地、云端和开源仓库中的 agent 协作，代表开发工具从命令行走向任务编排。",
      businessImpact:
        "开发工具公司会用开源换分发和信任，再通过团队协作、云端能力和企业治理收费。",
      predictedImpact:
        "更多开发工具会把开源项目当作 agent 工作流的训练场和传播渠道。",
      writingAngle:
        "从“开发工具为什么又回到开源”切入，分析 agent 时代的终端和 IDE 入口竞争。",
      suggestedTitles: [
        "开发工具重新拥抱开源，AI Agent 是真正原因",
        "Warp 的押注说明：终端也在变成 Agent 工作台",
        "这次开源不是情怀，是开发工具的新分发方式",
        "AI 编程工具的入口之争，正在从 IDE 蔓延到终端"
      ],
      articleThesis:
        "agent 时代的开发工具竞争，不只是谁的模型更强，而是谁能把本地终端、云端执行和开源协作组织成稳定工作流。",
      riskNotes: [
        "OpenAI 官方材料可能带有合作案例属性，表达时要避免营销化。",
        "需要核验 Warp 与 GPT-5.5 的具体关系和可用范围。",
        "不要把单一案例写成行业已经完成转向。"
      ]
    };
  }

  if (text.includes("sqlite") || text.includes("agents.md")) {
    return {
      selectedReason:
        "它是一个小切口但很有技术含金量的开发者工作流话题，能从 AGENTS.md 讲到开源项目如何适配 AI 协作者。",
      whyMostWorthWriting:
        "这个题看起来小，实则提示开源项目开始为 coding agent 明确规则，未来可能像 README、CONTRIBUTING 一样成为协作基础设施。",
      coreConflict: "开源维护者的人类协作规则和 AI agent 自动改代码之间的边界冲突。",
      publicInterest:
        "普通读者能通过“项目开始给 AI 写说明书”理解变化，开发者则会关心规则、贡献和维护成本。",
      technicalSignificance:
        "AGENTS.md 把仓库约定、测试方式和禁区显式化，有助于减少 agent 误操作和无效 PR。",
      businessImpact:
        "开发团队和开源项目可能需要维护面向 AI 工具的协作规范，工具厂商也会围绕这些规范做解析和执行。",
      predictedImpact:
        "更多仓库会出现面向 agent 的规则文件，代码协作会从只服务人类读者扩展到服务自动化工具。",
      writingAngle:
        "从 sqlite 这个小变化切入，写“开源项目为什么开始教育 AI 工具”，重点放在协作规则而非文件本身。",
      suggestedTitles: [
        "SQLite 多了一个 AGENTS.md，开源协作开始变味了",
        "开源项目给 AI 写说明书，可能会成为新常态",
        "AI 写代码之前，先得学会读项目规矩",
        "真正改变开发工作流的，可能是一份仓库说明"
      ],
      articleThesis:
        "AGENTS.md 的意义不在一个文件，而在开源项目开始把 AI 工具当作需要约束和引导的协作者；这会改变维护者、开发者和 coding agent 的协作边界。",
      riskNotes: [
        "话题偏开发者，需要把概念解释得足够通俗。",
        "不要夸大 AGENTS.md 已经成为标准，只能写成趋势信号。",
        "需要说明 SQLite 具体规则来自原文观察。"
      ]
    };
  }

  if (text.includes("tax agents")) {
    return {
      selectedReason:
        "它把 AI agent 放进高门槛专业服务流程，普通读者能理解税务场景，创业者也能看到垂直自动化机会。",
      whyMostWorthWriting:
        "税务 agent 的关键不是自动写代码，而是专业责任、准确性和流程复核如何与 AI 自动化共存。",
      coreConflict: "专业服务自动化效率和责任归属之间的冲突。",
      publicInterest:
        "税务申报是普通人和企业都能理解的高压力场景，读者容易理解为什么准确性重要。",
      technicalSignificance:
        "自我改进 agent 涉及评估、反馈闭环、工具调用和专业知识流程固化。",
      businessImpact:
        "会影响会计、税务、法务等专业服务的交付方式，也会给垂直 agent 创业提供案例。",
      predictedImpact:
        "专业服务会先在资料整理、初稿生成、校验和复核辅助环节落地，而不是一步替代责任主体。",
      writingAngle:
        "从“AI 能不能处理高责任专业流程”切入，分析 agent 自动化和人工复核如何重新分工。",
      suggestedTitles: [
        "AI Agent 进入税务流程，真正难的是责任边界",
        "专业服务被 AI 改造，不会从替代人开始",
        "税务 Agent 的启示：高门槛工作也在被拆解",
        "AI 自动化越深入，人工复核越重要"
      ],
      articleThesis:
        "专业服务里的 AI agent 不会简单替代专家，而是先重组资料、校验和复核流程；真正的竞争力来自可审计的自动化闭环。",
      riskNotes: [
        "OpenAI 官方案例有宣传属性，需要避免写成普遍事实。",
        "税务属于高责任领域，不能暗示 AI 可独立完成合规判断。",
        "应强调人工复核和责任主体。"
      ]
    };
  }

  if (text.includes("endava")) {
    return {
      selectedReason:
        "它适合从组织管理角度讨论 agentic organization，但更像案例材料，主文冲突不如其他题直接。",
      whyMostWorthWriting:
        "企业转型的难点不是买工具，而是重写流程、角色和管理节奏。",
      coreConflict: "企业购买 AI 工具的速度和组织流程改造速度之间的冲突。",
      publicInterest:
        "管理者和团队成员能理解“公司引入 AI 后流程怎么变”的问题。",
      technicalSignificance:
        "企业级 agent 落地需要权限、审计、任务拆解和跨角色协作机制。",
      businessImpact:
        "咨询、外包和企业 IT 服务公司会用 agentic organization 重新包装交付方式。",
      predictedImpact:
        "更多企业会把 AI 项目从工具试点升级为组织流程项目。",
      writingAngle:
        "从“为什么企业 AI 落地不是装几个工具”切入，分析组织流程才是 agent 价值兑现的瓶颈。",
      suggestedTitles: [
        "企业 AI 落地，难点不是工具，而是组织",
        "Agentic Organization 不是口号，是流程重写",
        "买了 AI 工具之后，公司真正要改什么",
        "AI 进入组织，管理方式先被考验"
      ],
      articleThesis:
        "企业 AI 的落地难点在组织协作而非单点工具；agent 要产生价值，必须嵌入权限、流程和责任分工。",
      riskNotes: [
        "官方案例宣传属性较强，不能把个案写成普遍结论。",
        "概念偏管理，需要避免空泛。",
        "需要把 agentic organization 翻译成具体流程变化。"
      ]
    };
  }

  if (text.includes("funding") || text.includes("融资")) {
    return {
      selectedReason:
        "它有商业信息，但如果来源只是搜索摘要或融资快讯，主文支撑偏弱。",
      whyMostWorthWriting:
        "企业知识 agent 融资能说明资本仍在押注检索、权限和评估等基础设施。",
      coreConflict: "资本追逐 AI 应用热度和企业知识系统落地难度之间的冲突。",
      publicInterest:
        "创业者和企业读者会关心 AI 钱流向哪里，以及哪些场景仍有机会。",
      technicalSignificance:
        "企业知识 agent 的难点在权限同步、检索质量、评估和工作流集成。",
      businessImpact:
        "它能反映资本和企业采购对知识基础设施的持续需求。",
      predictedImpact:
        "企业知识库、权限治理和评估工具仍会是 AI 应用创业的重要底座。",
      writingAngle:
        "从融资背后的基础设施需求切入，而不是写金额和投资方。",
      suggestedTitles: [
        "AI 创业的钱，仍在流向企业知识的脏活累活",
        "企业知识 Agent 为什么还能拿到资本押注",
        "AI 应用赚钱，不一定在聊天界面",
        "真正难做的企业 AI，往往藏在权限和检索里"
      ],
      articleThesis:
        "企业 AI 的长期机会不只在前台聊天界面，还在检索、权限、评估和流程集成这些基础设施环节。",
      riskNotes: [
        "如果只有搜索摘要，不能作为主选题事实来源。",
        "融资信息需要原始报道或公司公告交叉验证。",
        "避免把单笔融资解释成行业确定趋势。"
      ]
    };
  }

  return {
    selectedReason:
      "它在技术含金量、读者理解门槛和行业影响之间有较好的平衡，适合做一篇短观点文章。",
    whyMostWorthWriting:
      "这条资讯不只是事实更新，还能延展到工作流、成本结构或行业竞争格局的变化。",
    coreConflict:
      "AI 能力快速进入真实工作流，但成本、可靠性和责任边界仍需要重新分配。",
    publicInterest:
      "普通读者能通过具体产品或场景理解这条资讯和自己工作的关系。",
    technicalSignificance:
      "它反映了 AI 工具从单点功能走向任务编排、系统集成和可审计流程。",
    businessImpact:
      "它会影响企业采购、开发者选型或创作者的生产流程。",
    predictedImpact:
      "相关团队会更重视工具组合、流程治理和来源核验，而不是只追逐单个模型能力。",
    writingAngle:
      "从第三视角分析这条资讯改变了哪类人的工作方式，避免复述新闻。",
    suggestedTitles: [
      "AI 工具真正改变的，是工作方式",
      "这条 AI 新闻背后，是一次工作流重排",
      "不要只看新功能，真正变化发生在流程里"
    ],
    articleThesis:
      "AI 产品和 agent 的价值正在从功能展示转向工作流重组；能被稳定、可审计地放进真实流程，才是它们影响行业的关键。",
    riskNotes: [
      "需要回到原始来源核验事实。",
      "避免把单个案例过度外推。",
      "正文应区分事实、判断和预测。"
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
      "技术圈争论背后，是一次工作流入口变化",
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
      const ineligibleReason = ineligibleReasonFor(item, sourceReliability);

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

  const text = textFor(ranked.item);
  if (text.includes("cowork")) {
    return "读者面很广，但更偏产品发布和权限讨论，今天主文的开发者成本与开源替代冲突更集中。";
  }
  if (text.includes("slackbot")) {
    return "商业影响很强，但技术含金量略弱于编码代理生态变化，更适合作为企业 AI 入口竞争的备选题。";
  }
  if (text.includes("product-market fit")) {
    return "观点空间大，但原文含传闻性判断，作为主文需要更多交叉来源支撑。";
  }
  if (text.includes("itbench-aa") || text.includes("score below 50")) {
    return "来源可靠、技术含金量高，但普通读者理解门槛较高，更适合做技术深读或二条。";
  }
  if (text.includes("warp")) {
    return "来源可靠但更像厂商案例，商业和公共讨论张力弱于主选题。";
  }
  if (text.includes("sqlite") || text.includes("agents.md")) {
    return "开发者视角很新，但话题切口偏窄，公众号主文传播面不如主选题。";
  }
  if (text.includes("tax agents")) {
    return "场景通俗，但官方案例属性较强，技术冲突和生态影响不如主选题集中。";
  }
  if (text.includes("endava")) {
    return "管理话题可写，但概念偏案例化，容易写成企业转型泛论。";
  }

  return "综合冲突强度、读者理解门槛、技术含金量和来源风险后，今天不作为主文。";
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
