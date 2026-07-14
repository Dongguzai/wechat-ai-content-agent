import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedPolicy } from "../config/policyRegistry.js";
import { resolvePoliciesForProfile } from "../config/policyRegistry.js";
import type {
  ResearchPlan,
  ResearchPlanOutputFiles,
  ResearchPlanResult,
  ResearchTask
} from "../types/researchPlan.js";
import type { TopicEventType, TopicProfile } from "../types/topicProfile.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface BuildResearchPlanOptions {
  outputDir?: string;
  topicProfileFile?: string;
  topicProfile?: TopicProfile;
  researchPolicies?: ResolvedPolicy[];
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function createOutputFiles(outputDir: string): ResearchPlanOutputFiles {
  return {
    researchPlanJson: join(outputDir, "research-plan.json"),
    researchPlanReport: join(outputDir, "research-plan-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function policyRefs(policies: ResolvedPolicy[]): ResearchPlan["policyRefs"] {
  return policies.map((policy) => ({
    id: policy.id,
    version: policy.version,
    scope: policy.scope,
    sourcePath: policy.sourcePath,
    matchReasons: policy.matchReasons
  }));
}

function taskPriority(eventType: TopicEventType): ResearchTask["priority"] {
  if (
    eventType === "regulation" ||
    eventType === "incident" ||
    eventType === "benchmark" ||
    eventType === "pricing"
  ) {
    return "high";
  }

  if (
    eventType === "funding" ||
    eventType === "acquisition" ||
    eventType === "research_release"
  ) {
    return "medium";
  }

  return "low";
}

function taskForEventType(
  eventType: TopicEventType,
  profile: TopicProfile,
  policyIds: string[]
): ResearchTask {
  const relatedRiskDimensions = profile.riskDimensions.filter((risk) => {
    if (eventType === "launch" || eventType === "update") {
      return /发布|可用|开放|功能|地区|对象/.test(risk);
    }
    if (eventType === "benchmark") {
      return /指标|测试|自测|复现|基线/.test(risk);
    }
    if (eventType === "pricing") {
      return /币种|生效|订阅|API|免费|套餐|用量/.test(risk);
    }
    if (eventType === "funding") {
      return /融资|轮次|投资方|估值/.test(risk);
    }
    if (eventType === "acquisition") {
      return /交易|监管|审批|整合|竞争/.test(risk);
    }
    if (eventType === "regulation") {
      return /司法辖区|生效|适用|义务|合规/.test(risk);
    }
    if (eventType === "incident") {
      return /影响|披露|用户数据|修复|泄露/.test(risk);
    }
    if (eventType === "research_release") {
      return /实验|样本|泛化|同行评审|论文/.test(risk);
    }
    if (eventType === "case_study") {
      return /案例|指标|迁移|人工复核|供应商/.test(risk);
    }
    return false;
  });

  const templates: Record<TopicEventType, Omit<ResearchTask, "id" | "relatedRiskDimensions" | "policyIds">> = {
    launch: {
      question: "这是否已经正式发布，面向哪些用户开放？",
      expectedEvidence: ["官方公告", "发布时间", "可用地区", "开放对象", "功能边界"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    update: {
      question: "这次更新改变了哪些功能边界和使用限制？",
      expectedEvidence: ["发布说明", "功能说明", "限制条件", "分批开放信息"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    benchmark: {
      question: "benchmark 的指标、条件、基线和复现状态是什么？",
      expectedEvidence: ["benchmark 原文", "指标定义", "测试条件", "对比基线", "第三方复现"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    pricing: {
      question: "价格变化的套餐、币种、周期和额外用量边界是什么？",
      expectedEvidence: ["官方价格页", "套餐说明", "生效日期", "API 与订阅差异", "免费层说明"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    funding: {
      question: "融资金额、轮次、投资方和估值确认状态是什么？",
      expectedEvidence: ["公司公告", "投资方确认", "融资金额", "轮次", "估值状态"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    acquisition: {
      question: "交易状态、价格、审批和整合计划是否已确认？",
      expectedEvidence: ["双方公告", "交易条款", "监管审批状态", "整合计划"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    regulation: {
      question: "政策的司法辖区、生效时间、适用对象和实际义务是什么？",
      expectedEvidence: ["政策原文", "官方解释", "司法辖区", "生效时间", "适用对象"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    case_study: {
      question: "案例指标是否有口径、第三方材料和可迁移条件？",
      expectedEvidence: ["案例原文", "指标口径", "供应商参与程度", "第三方材料", "人工复核说明"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    incident: {
      question: "事故影响范围、披露时间线、数据类型和修复状态是什么？",
      expectedEvidence: ["官方事故报告", "状态页", "影响范围", "修复时间线", "用户补救动作"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    opinion: {
      question: "哪些是事实，哪些是观点或编辑判断？",
      expectedEvidence: ["原始来源", "作者身份", "事实引用", "观点上下文"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    tutorial: {
      question: "教程或指南是否适用于当前版本和目标用户？",
      expectedEvidence: ["官方文档", "版本说明", "适用条件", "限制说明"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    },
    research_release: {
      question: "研究问题、实验设置、样本规模和局限是什么？",
      expectedEvidence: ["论文原文", "实验设置", "数据集", "代码或复现材料", "局限"],
      priority: taskPriority(eventType),
      relatedEventTypes: [eventType]
    }
  };

  return {
    id: `research-task-${eventType}`,
    ...templates[eventType],
    relatedRiskDimensions,
    policyIds
  };
}

function buildTasks(profile: TopicProfile, policies: ResolvedPolicy[]): ResearchTask[] {
  const policyIds = unique(policies.map((policy) => policy.id));
  const eventTasks = profile.eventTypes.map((eventType) =>
    taskForEventType(eventType, profile, policyIds)
  );
  const evidenceTask: ResearchTask = {
    id: "research-task-source-boundary",
    question: "哪些来源可以支持事实，哪些只能作为线索？",
    expectedEvidence: profile.evidenceNeeds,
    priority: "high",
    relatedEventTypes: profile.eventTypes,
    relatedRiskDimensions: profile.riskDimensions,
    policyIds
  };

  return [evidenceTask, ...eventTasks];
}

function sourcePrioritiesFor(profile: TopicProfile): string[] {
  const priorities = ["选题原始 URL", "官方公告或原文", "可公开访问的第一手材料"];

  if (profile.eventTypes.includes("research_release") || profile.eventTypes.includes("benchmark")) {
    priorities.push("论文原文", "代码仓库或评测脚本");
  }
  if (profile.eventTypes.includes("regulation")) {
    priorities.push("政策原文", "监管机构官方解释");
  }
  if (profile.eventTypes.includes("pricing")) {
    priorities.push("官方价格页", "套餐说明页");
  }
  if (profile.eventTypes.includes("incident")) {
    priorities.push("官方事故报告", "状态页");
  }

  priorities.push("搜索摘要只能作为 search_lead");
  return unique(priorities);
}

function createPlan(profile: TopicProfile, policies: ResolvedPolicy[], now: Date): ResearchPlan {
  return {
    schemaVersion: "1.0",
    id: `research-plan-${profile.topicId}`,
    topicId: profile.topicId,
    primaryDomain: profile.primaryDomain,
    eventTypes: profile.eventTypes,
    riskDimensions: profile.riskDimensions,
    policyRefs: policyRefs(policies),
    tasks: buildTasks(profile, policies),
    sourcePriorities: sourcePrioritiesFor(profile),
    stopConditions: [
      "缺少原始 URL 时停止进入 verified fact pack。",
      "只有 search_lead 时不得生成 verified claim。",
      "关键数字找不到来源时不得写入正文事实。",
      "政策、价格、安全事故和 benchmark 无法核验时必须降低确定性。"
    ],
    generatedAt: now.toISOString()
  };
}

function createMarkdownReport(plan: ResearchPlan): string {
  return [
    "# Research Plan",
    "",
    `Generated at: ${plan.generatedAt}`,
    "",
    "## Topic",
    "",
    `- topicId: ${plan.topicId}`,
    `- primaryDomain: ${plan.primaryDomain}`,
    `- eventTypes: ${plan.eventTypes.join(" / ")}`,
    `- riskDimensions: ${plan.riskDimensions.join(" / ")}`,
    "",
    "## Policy Refs",
    "",
    ...plan.policyRefs.map(
      (policy) =>
        `- ${policy.scope}:${policy.id}@${policy.version} (${policy.sourcePath})\n  - matchReasons: ${policy.matchReasons.join(" / ") || "none"}`
    ),
    "",
    "## Tasks",
    "",
    ...plan.tasks.map(
      (task) =>
        `- [${task.priority}] ${task.id}: ${task.question}\n  - evidence: ${task.expectedEvidence.join(" / ")}\n  - policies: ${task.policyIds.join(" / ") || "none"}`
    ),
    "",
    "## Source Priorities",
    "",
    ...plan.sourcePriorities.map((item) => `- ${item}`),
    "",
    "## Stop Conditions",
    "",
    ...plan.stopConditions.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

export async function buildResearchPlan(
  options: BuildResearchPlanOptions = {}
): Promise<ResearchPlanResult> {
  const logger = options.logger ?? createLogger("research-plan");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const topicProfileFile = options.topicProfileFile ?? join(outputDir, "topic-profile.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const profile = options.topicProfile ?? (await readJsonFile<TopicProfile>(topicProfileFile));
  const policies =
    options.researchPolicies ??
    (await resolvePoliciesForProfile(profile, { scopes: ["research"] }));
  const plan = createPlan(profile, policies, options.now ?? new Date());
  const report = createMarkdownReport(plan);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.researchPlanJson, plan);
    await writeFile(files.researchPlanReport, report, "utf8");
  }

  logger.info(
    `Built research plan for ${plan.topicId}: tasks=${plan.tasks.length}; policies=${plan.policyRefs.length}.`
  );

  return {
    outputDir,
    files,
    plan,
    report
  };
}
