import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolvePoliciesForProfile,
  type ResolvedPolicy
} from "../config/policyRegistry.js";
import type { EditorialPlan, EditorialPlanSection } from "../types/editorialPlan.js";
import type { TopicFactPack } from "../types/factPack.js";
import type { SelectedTopic } from "../types/news.js";
import type { ResearchPlan, ResearchTask } from "../types/researchPlan.js";
import type { TopicContentMode, TopicEventType, TopicProfile } from "../types/topicProfile.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface BuildEditorialPlanOptions {
  outputDir?: string;
  selectedTopicFile?: string;
  topicProfileFile?: string;
  researchPlanFile?: string;
  topicFactPackFile?: string;
  topic?: SelectedTopic;
  topicProfile?: TopicProfile;
  researchPlan?: ResearchPlan;
  factPack?: TopicFactPack;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function createOutputFiles(outputDir: string) {
  return {
    editorialPlanJson: join(outputDir, "editorial-plan.json"),
    editorialPlanReport: join(outputDir, "editorial-plan.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
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

function compact(values: Array<string | undefined>): string[] {
  return values.map((value) => value?.trim() ?? "").filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function titleFor(topic: SelectedTopic): string {
  return (
    topic.selected.titleZh ||
    topic.selected.rawTitle ||
    topic.selected.title ||
    "当前 AI 资讯"
  );
}

function fallbackTopicProfile(topic: SelectedTopic, now: Date): TopicProfile {
  return {
    schemaVersion: "1.0",
    id: `topic-profile-${topic.selected.id}`,
    topicId: topic.selected.id,
    primaryDomain: topic.selected.category === "funding" ? "business" : topic.selected.category,
    secondaryDomains: [],
    eventTypes: ["opinion"],
    entities: [{ name: topic.selected.sourceName, type: "source" }],
    targetAudiences: ["普通 AI 关注者"],
    readerQuestions: [topic.selected.selection.publicInterest],
    evidenceNeeds: ["选题原始 URL"],
    riskDimensions: topic.selected.selection.riskNotes ?? ["来源可靠性", "事实边界"],
    recommendedContentMode: "news_analysis",
    confidence: 0.3,
    classificationReason: "未找到 topic-profile.json，使用编辑计划 fallback。",
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
    tasks: profile.readerQuestions.map((question, index) => ({
      id: `research-task-reader-question-${index + 1}`,
      question,
      expectedEvidence: profile.evidenceNeeds,
      priority: index === 0 ? "high" : "medium",
      relatedEventTypes: profile.eventTypes,
      relatedRiskDimensions: profile.riskDimensions,
      policyIds: []
    })),
    sourcePriorities: ["选题原始 URL", "官方公告或原文"],
    stopConditions: ["缺少来源证据时必须降低确定性。"],
    generatedAt: now.toISOString()
  };
}

function policyRefs(policies: ResolvedPolicy[]) {
  return policies.map((policy) => ({
    id: policy.id,
    version: policy.version,
    scope: policy.scope,
    sourcePath: policy.sourcePath,
    matchReasons: policy.matchReasons
  }));
}

function taskForEvent(tasks: ResearchTask[], eventType: TopicEventType): ResearchTask | undefined {
  return tasks.find((task) => task.relatedEventTypes.includes(eventType));
}

function idsForClaims(input: {
  factPack: TopicFactPack;
  keywords: string[];
  fallbackCount?: number;
}): string[] {
  const keywordSet = input.keywords.map((keyword) => keyword.toLowerCase());
  const matched = input.factPack.claims
    .filter((claim) => {
      const text = [
        claim.id,
        claim.statement,
        claim.safeWording,
        ...claim.riskDimensions,
        ...claim.requiredQualifiers
      ]
        .join("\n")
        .toLowerCase();
      return keywordSet.some((keyword) => text.includes(keyword));
    })
    .map((claim) => claim.id);

  if (matched.length > 0) {
    return unique(matched);
  }

  return input.factPack.claims
    .slice(0, input.fallbackCount ?? 2)
    .map((claim) => claim.id);
}

function evidenceIdsForClaims(factPack: TopicFactPack, claimIds: string[]): string[] {
  return unique(
    factPack.claims
      .filter((claim) => claimIds.includes(claim.id))
      .flatMap((claim) => claim.evidenceIds)
  );
}

function section(input: {
  id: string;
  role: EditorialPlanSection["role"];
  heading: string;
  purpose: string;
  claimIds: string[];
  factPack: TopicFactPack;
  keyQuestions: string[];
  writingInstructions: string[];
  riskControls: string[];
}): EditorialPlanSection {
  return {
    id: input.id,
    role: input.role,
    heading: input.heading,
    purpose: input.purpose,
    allowedClaimIds: input.claimIds,
    requiredEvidenceIds: evidenceIdsForClaims(input.factPack, input.claimIds),
    keyQuestions: input.keyQuestions,
    writingInstructions: input.writingInstructions,
    riskControls: input.riskControls
  };
}

function sourceSection(topic: SelectedTopic, factPack: TopicFactPack): EditorialPlanSection {
  const claimIds = idsForClaims({
    factPack,
    keywords: ["source", "来源", "选题", "claim-source-topic"],
    fallbackCount: 1
  });

  return section({
    id: "section-source-boundary",
    role: "context",
    heading: "先把来源和边界说清",
    purpose: `交代 ${topic.selected.sourceName} 的线索和当前不能越过的事实边界。`,
    claimIds,
    factPack,
    keyQuestions: ["这条线索来自哪里？", "哪些表述还不能当成确定事实？"],
    writingInstructions: [
      "先写来源，再写不确定性。",
      "不得把标题、搜索摘要或编辑概括写成官方结论。"
    ],
    riskControls: ["保留限定语", "避免行业定论"]
  });
}

function sectionsForEvent(input: {
  topic: SelectedTopic;
  profile: TopicProfile;
  plan: ResearchPlan;
  factPack: TopicFactPack;
  policies: ResolvedPolicy[];
}): EditorialPlanSection[] {
  const { topic, profile, plan, factPack } = input;
  const tasks = plan.tasks;
  const primaryEvent = profile.eventTypes[0] ?? "opinion";
  const policyInstructions = input.policies.flatMap((policy) => policy.instructions).slice(0, 3);
  const source = sourceSection(topic, factPack);
  const summaryClaimIds = idsForClaims({
    factPack,
    keywords: ["summary", "概括", "claim-topic-summary", primaryEvent],
    fallbackCount: 2
  });
  const angleClaimIds = idsForClaims({
    factPack,
    keywords: ["angle", "编辑", "claim-editorial-angle", primaryEvent],
    fallbackCount: 3
  });

  if (profile.eventTypes.includes("pricing")) {
    const task = taskForEvent(tasks, "pricing");
    return [
      source,
      section({
        id: "section-pricing-boundary",
        role: "facts",
        heading: "价格变化到底改了什么",
        purpose: "说明套餐、币种、周期、免费层和额外用量边界。",
        claimIds: unique([...summaryClaimIds, ...idsForClaims({ factPack, keywords: ["pricing", "价格", "订阅", "免费层", "币种"], fallbackCount: 3 })]),
        factPack,
        keyQuestions: compact([task?.question, "价格事实是否能和套餐边界对应？"]),
        writingInstructions: ["区分订阅、API 和免费层。", ...policyInstructions],
        riskControls: ["不得把免费层写成零成本", "不得把一个套餐价格套到所有用户"]
      }),
      section({
        id: "section-user-cost",
        role: "impact",
        heading: "不同用户会怎样重新算账",
        purpose: "分析个人、团队或企业用户的成本和选择变化。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: ["谁的成本结构会变化？", "哪些选择仍需要等待更多证据？"],
        writingInstructions: ["把影响写成分层观察，不写单一胜负。"],
        riskControls: ["避免夸大用户迁移", "避免替用户做财务结论"]
      }),
      section({
        id: "section-next-watch",
        role: "next_steps",
        heading: "接下来要看哪些信号",
        purpose: "给出后续观察清单，避免把单条价格新闻写成终局。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: tasks.slice(0, 2).map((item) => item.question),
        writingInstructions: ["用观察问题收束文章。"],
        riskControls: ["不写行业定论"]
      })
    ];
  }

  if (profile.eventTypes.includes("benchmark")) {
    const task = taskForEvent(tasks, "benchmark");
    return [
      source,
      section({
        id: "section-benchmark-conditions",
        role: "facts",
        heading: "先看测试条件，而不是只看分数",
        purpose: "解释指标、测试条件、基线和复现状态。",
        claimIds: unique([...summaryClaimIds, ...idsForClaims({ factPack, keywords: ["benchmark", "指标", "测试", "基线", "复现"], fallbackCount: 3 })]),
        factPack,
        keyQuestions: compact([task?.question, "结果对应的是哪一个指标？"]),
        writingInstructions: ["比较结论必须绑定具体指标。", ...policyInstructions],
        riskControls: ["不得把单项分数写成全面胜负"]
      }),
      section({
        id: "section-benchmark-limits",
        role: "risks",
        heading: "这些结果不能说明什么",
        purpose: "把厂商自测、样本限制和第三方复现状态讲清楚。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: ["测试限制是什么？", "有没有第三方复现？"],
        writingInstructions: ["限制必须和结果一起出现。"],
        riskControls: ["不得省略测试条件"]
      }),
      section({
        id: "section-benchmark-impact",
        role: "impact",
        heading: "对开发者和产品团队意味着什么",
        purpose: "把 benchmark 转成读者可理解的工作影响。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: profile.readerQuestions,
        writingInstructions: ["从读者问题解释指标意义。"],
        riskControls: ["避免把测试写成产品承诺"]
      })
    ];
  }

  if (profile.eventTypes.includes("funding")) {
    return [
      source,
      section({
        id: "section-funding-facts",
        role: "facts",
        heading: "融资事实先分层",
        purpose: "区分融资金额、轮次、投资方、估值和确认状态。",
        claimIds: unique([...summaryClaimIds, ...idsForClaims({ factPack, keywords: ["funding", "融资", "估值", "投资方", "轮次"], fallbackCount: 3 })]),
        factPack,
        keyQuestions: tasks.map((item) => item.question).slice(0, 2),
        writingInstructions: ["把已确认和未确认信息分开。", ...policyInstructions],
        riskControls: ["不得把融资等同于 PMF 已成"]
      }),
      section({
        id: "section-funding-market",
        role: "analysis",
        heading: "钱投向了哪条市场判断",
        purpose: "解释资金用途、市场位置和竞争逻辑。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: ["这笔钱支持了什么战略判断？"],
        writingInstructions: ["避免胜利通稿口吻。"],
        riskControls: ["不得放大未确认估值"]
      }),
      section({
        id: "section-funding-risks",
        role: "risks",
        heading: "风险不应被融资热度盖住",
        purpose: "把商业化、客户、估值和执行风险放回文章。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: profile.readerQuestions,
        writingInstructions: ["趋势判断必须带风险条件。"],
        riskControls: ["不替公司背书"]
      })
    ];
  }

  if (profile.eventTypes.includes("regulation")) {
    return [
      source,
      section({
        id: "section-policy-scope",
        role: "facts",
        heading: "这条规则适用谁、何时生效",
        purpose: "说明司法辖区、生效时间、适用对象和实际义务。",
        claimIds: unique([...summaryClaimIds, ...idsForClaims({ factPack, keywords: ["regulation", "政策", "义务", "辖区", "生效"], fallbackCount: 3 })]),
        factPack,
        keyQuestions: tasks.map((item) => item.question).slice(0, 2),
        writingInstructions: ["用通俗语言解释义务，不做法律意见。", ...policyInstructions],
        riskControls: ["不得跨地区泛化", "不得把指南写成法律结论"]
      }),
      section({
        id: "section-policy-impact",
        role: "impact",
        heading: "企业真正要调整什么",
        purpose: "把规则翻译成产品、合规和运营影响。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: profile.readerQuestions,
        writingInstructions: ["区分已经生效和仍在过渡的信息。"],
        riskControls: ["不提供法律意见"]
      }),
      section({
        id: "section-policy-watch",
        role: "next_steps",
        heading: "接下来观察执行和解释口径",
        purpose: "列出后续需要关注的监管执行、细则和企业反馈。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: tasks.slice(0, 2).map((item) => item.question),
        writingInstructions: ["用观察清单收束。"],
        riskControls: ["避免恐慌式表达"]
      })
    ];
  }

  if (profile.eventTypes.includes("research_release")) {
    return [
      source,
      section({
        id: "section-research-question",
        role: "facts",
        heading: "这项研究真正问了什么",
        purpose: "解释研究问题、方法、实验设置和样本边界。",
        claimIds: unique([...summaryClaimIds, ...idsForClaims({ factPack, keywords: ["research", "研究", "论文", "实验", "样本"], fallbackCount: 3 })]),
        factPack,
        keyQuestions: tasks.map((item) => item.question).slice(0, 2),
        writingInstructions: ["把方法翻译成读者能理解的问题。", ...policyInstructions],
        riskControls: ["不得把论文实验写成产品能力"]
      }),
      section({
        id: "section-research-limits",
        role: "risks",
        heading: "局限和结果要放在一起读",
        purpose: "写清泛化限制、样本范围和还不能推出的结论。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: ["哪些结论不能外推？"],
        writingInstructions: ["局限必须和结果一起出现。"],
        riskControls: ["不得省略局限"]
      }),
      section({
        id: "section-research-impact",
        role: "impact",
        heading: "它可能影响哪类产品判断",
        purpose: "连接研究结果与产品、开发者或行业观察。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: profile.readerQuestions,
        writingInstructions: ["用可能性表达影响。"],
        riskControls: ["不写成已经落地"]
      })
    ];
  }

  if (profile.eventTypes.includes("incident")) {
    return [
      source,
      section({
        id: "section-incident-confirmed",
        role: "facts",
        heading: "先写已经确认的影响范围",
        purpose: "说明发生了什么、披露时间线、数据类型和修复状态。",
        claimIds: unique([...summaryClaimIds, ...idsForClaims({ factPack, keywords: ["incident", "事故", "影响范围", "修复", "披露"], fallbackCount: 3 })]),
        factPack,
        keyQuestions: tasks.map((item) => item.question).slice(0, 2),
        writingInstructions: ["已确认事实和调查中信息分开。", ...policyInstructions],
        riskControls: ["不得夸大受影响数据"]
      }),
      section({
        id: "section-incident-user-action",
        role: "impact",
        heading: "用户和团队现在该看什么",
        purpose: "给出可观察的用户影响和团队处置关注点。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: profile.readerQuestions,
        writingInstructions: ["避免制造恐慌。"],
        riskControls: ["不做无来源攻击"]
      }),
      section({
        id: "section-incident-lesson",
        role: "next_steps",
        heading: "这件事留下的行业提醒",
        purpose: "从权限、数据和治理角度收束。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: ["后续披露还需要验证什么？"],
        writingInstructions: ["用治理提醒收束。"],
        riskControls: ["不写阴谋化判断"]
      })
    ];
  }

  if (profile.eventTypes.includes("case_study")) {
    return [
      source,
      section({
        id: "section-case-scene",
        role: "facts",
        heading: "这个案例发生在什么场景",
        purpose: "说明场景、做法、指标口径和供应商材料边界。",
        claimIds: unique([...summaryClaimIds, ...idsForClaims({ factPack, keywords: ["case", "案例", "场景", "指标", "供应商"], fallbackCount: 3 })]),
        factPack,
        keyQuestions: tasks.map((item) => item.question).slice(0, 2),
        writingInstructions: ["把供应商叙事降级为案例材料。", ...policyInstructions],
        riskControls: ["不得把案例数字泛化到所有企业"]
      }),
      section({
        id: "section-case-transfer",
        role: "analysis",
        heading: "哪些条件决定它能不能复制",
        purpose: "解释人工复核、部署条件、组织约束和可迁移性。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: profile.readerQuestions,
        writingInstructions: ["把适用条件写清楚。"],
        riskControls: ["不得忽略供应商案例偏差"]
      }),
      section({
        id: "section-case-watch",
        role: "next_steps",
        heading: "读者该带走的判断框架",
        purpose: "给出判断案例价值的观察框架。",
        claimIds: angleClaimIds,
        factPack,
        keyQuestions: ["这个案例对读者有什么可迁移价值？"],
        writingInstructions: ["用判断框架收束。"],
        riskControls: ["不写成普遍承诺"]
      })
    ];
  }

  return [
    source,
    section({
      id: "section-change",
      role: "facts",
      heading: profile.eventTypes.includes("launch") || profile.eventTypes.includes("update")
        ? "这次变化改变了什么"
        : "这条线索真正值得看的是什么",
      purpose: "解释产品、模型、工具或行业线索的实际变化。",
      claimIds: summaryClaimIds,
      factPack,
      keyQuestions: tasks.map((item) => item.question).slice(0, 2),
      writingInstructions: ["避免只复述发布稿。", ...policyInstructions],
      riskControls: ["不得暗示所有用户已经可用", "不得把单条资讯写成行业定论"]
    }),
    section({
      id: "section-reader-impact",
      role: "impact",
      heading: "它会影响谁的判断",
      purpose: "把选题转成目标读者能理解的影响。",
      claimIds: angleClaimIds,
      factPack,
      keyQuestions: profile.readerQuestions,
      writingInstructions: ["围绕目标读者解释影响。"],
      riskControls: ["不把趋势判断写成事实"]
    }),
    section({
      id: "section-next-questions",
      role: "next_steps",
      heading: "下一步该继续验证什么",
      purpose: "用后续观察问题收束文章。",
      claimIds: angleClaimIds,
      factPack,
      keyQuestions: tasks.slice(0, 3).map((item) => item.question),
      writingInstructions: ["把不确定事实留在观察清单里。"],
      riskControls: ["不补写 fact pack 之外的数字或结论"]
    })
  ];
}

function requiredThemesFor(input: {
  profile: TopicProfile;
  sections: EditorialPlanSection[];
}): string[] {
  return unique([
    "来源",
    "边界",
    ...input.profile.eventTypes.map((eventType) => {
      const labels: Record<TopicEventType, string> = {
        launch: "发布",
        update: "变化",
        benchmark: "测试",
        pricing: "价格",
        funding: "融资",
        acquisition: "并购",
        regulation: "政策",
        case_study: "案例",
        incident: "影响",
        opinion: "判断",
        tutorial: "做法",
        research_release: "研究"
      };
      return labels[eventType];
    }),
    ...input.sections.map((item) => item.heading.slice(0, 4))
  ]).slice(0, 5);
}

function contentModeFor(profile: TopicProfile): TopicContentMode {
  if (profile.eventTypes.includes("pricing") || profile.eventTypes.includes("benchmark")) {
    return "comparison";
  }
  if (profile.eventTypes.includes("case_study")) {
    return "case_review";
  }
  if (profile.eventTypes.includes("tutorial")) {
    return "practical_guide";
  }
  if (profile.primaryDomain === "policy" || profile.primaryDomain === "research") {
    return "explainer";
  }
  return profile.recommendedContentMode;
}

function createEditorialPlan(input: {
  topic: SelectedTopic;
  profile: TopicProfile;
  researchPlan: ResearchPlan;
  factPack: TopicFactPack;
  policies: ResolvedPolicy[];
  now: Date;
}): EditorialPlan {
  const sections = sectionsForEvent({
    topic: input.topic,
    profile: input.profile,
    plan: input.researchPlan,
    factPack: input.factPack,
    policies: input.policies
  });
  const contentMode = contentModeFor(input.profile);
  const riskControls = unique([
    ...sections.flatMap((item) => item.riskControls),
    ...input.policies.flatMap((policy) => policy.riskRules),
    ...input.factPack.riskNotes
  ]);

  return {
    schemaVersion: "1.0",
    id: `editorial-plan-${input.topic.selected.id}`,
    topicId: input.topic.selected.id,
    primaryDomain: input.profile.primaryDomain,
    eventTypes: input.profile.eventTypes,
    contentMode,
    audience: input.profile.targetAudiences,
    thesis:
      input.topic.selected.selection.articleThesis ||
      input.factPack.recommendedFraming ||
      `从 ${input.profile.primaryDomain} 角度解释 ${titleFor(input.topic)}。`,
    tone: "第三视角、事实边界优先、通俗解释、避免通稿口吻。",
    structure: sections.map((item) => item.heading),
    sections,
    requiredThemes: requiredThemesFor({ profile: input.profile, sections }),
    forbiddenWording: unique(input.factPack.claims.flatMap((claim) => claim.forbiddenWording)),
    riskControls,
    policyRefs: policyRefs(input.policies),
    generatedAt: input.now.toISOString()
  };
}

function createMarkdownReport(plan: EditorialPlan): string {
  return [
    "# Editorial Plan",
    "",
    `Generated at: ${plan.generatedAt}`,
    "",
    "## Topic",
    "",
    `- topicId: ${plan.topicId}`,
    `- primaryDomain: ${plan.primaryDomain}`,
    `- eventTypes: ${plan.eventTypes.join(", ")}`,
    `- contentMode: ${plan.contentMode}`,
    "",
    "## Structure",
    "",
    ...plan.sections.map((sectionItem, index) =>
      [
        `### ${index + 1}. ${sectionItem.heading}`,
        "",
        `- id: ${sectionItem.id}`,
        `- role: ${sectionItem.role}`,
        `- purpose: ${sectionItem.purpose}`,
        `- allowedClaimIds: ${sectionItem.allowedClaimIds.join(", ") || "none"}`,
        `- requiredEvidenceIds: ${sectionItem.requiredEvidenceIds.join(", ") || "none"}`,
        `- keyQuestions: ${sectionItem.keyQuestions.join(" / ") || "none"}`,
        `- riskControls: ${sectionItem.riskControls.join(" / ") || "none"}`
      ].join("\n")
    ),
    "",
    "## Required Themes",
    "",
    ...plan.requiredThemes.map((theme) => `- ${theme}`),
    "",
    "## Forbidden Wording",
    "",
    ...plan.forbiddenWording.map((wording) => `- ${wording}`),
    "",
    "## Policies",
    "",
    ...plan.policyRefs.map(
      (policy) =>
        `- ${policy.id}@${policy.version} (${policy.sourcePath}) reasons=${policy.matchReasons.join(", ")}`
    ),
    "",
    "## 阶段边界",
    "",
    "- 本阶段只生成 editorial plan。",
    "- 不写正文，不生成标题，不生成封面，不排版 HTML，不调用公众号后台。",
    ""
  ].join("\n");
}

export async function buildEditorialPlan(
  options: BuildEditorialPlanOptions = {}
): Promise<{
  outputDir: string;
  files: ReturnType<typeof createOutputFiles>;
  plan: EditorialPlan;
  report: string;
}> {
  const logger = options.logger ?? createLogger("editorial-plan");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const files = createOutputFiles(outputDir);
  const selectedTopicFile = options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const topicProfileFile = options.topicProfileFile ?? join(outputDir, "topic-profile.json");
  const researchPlanFile = options.researchPlanFile ?? join(outputDir, "research-plan.json");
  const topicFactPackFile = options.topicFactPackFile ?? join(outputDir, "topic-fact-pack.json");
  const writeOutputs = options.writeOutputs ?? true;
  const now = options.now ?? new Date();
  const topic = options.topic ?? (await readJsonFile<SelectedTopic>(selectedTopicFile));
  const profile =
    options.topicProfile ??
    (await readOptionalJsonFile<TopicProfile>(topicProfileFile)) ??
    fallbackTopicProfile(topic, now);
  const researchPlan =
    options.researchPlan ??
    (await readOptionalJsonFile<ResearchPlan>(researchPlanFile)) ??
    fallbackResearchPlan(profile, now);
  const factPack =
    options.factPack ?? (await readJsonFile<TopicFactPack>(topicFactPackFile));
  const policies = await resolvePoliciesForProfile(profile, {
    scopes: ["editorial"],
    now
  });
  const plan = createEditorialPlan({
    topic,
    profile,
    researchPlan,
    factPack,
    policies,
    now
  });
  const report = createMarkdownReport(plan);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.editorialPlanJson, plan);
    await writeFile(files.editorialPlanReport, report, "utf8");
  }

  logger.info(
    `Built editorial plan for ${plan.topicId} with ${plan.sections.length} sections.`
  );

  return {
    outputDir,
    files,
    plan,
    report
  };
}
