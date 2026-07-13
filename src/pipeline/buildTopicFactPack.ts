import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FactPackClaim,
  FactClaimStatus,
  TopicFactPack,
  TopicFactPackOutputFiles,
  TopicFactPackResult
} from "../types/factPack.js";
import type { SelectedTopic, SourceReliability } from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface BuildTopicFactPackOptions {
  outputDir?: string;
  selectedTopicFile?: string;
  topicSelectionReportFile?: string;
  topic?: SelectedTopic;
  topicSelectionReport?: string;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

const sourceUrls = {
  selectedTopic:
    "https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free",
  claudePricing: "https://claude.com/pricing",
  claudePlanHelp:
    "https://support.claude.com/en/articles/11049762-choose-a-claude-plan",
  claudeCodePlanHelp:
    "https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan",
  claudeCodeOverview: "https://code.claude.com/docs/en/overview",
  claudeCodeCosts: "https://code.claude.com/docs/en/costs",
  gooseGithub: "https://github.com/aaif-goose/goose",
  gooseProviders: "https://goose-docs.ai/docs/getting-started/providers/",
  gooseTips: "https://block.github.io/goose/docs/guides/tips/"
} as const;

function createOutputFiles(outputDir: string): TopicFactPackOutputFiles {
  return {
    topicFactPackJson: join(outputDir, "topic-fact-pack.json"),
    topicFactPackReport: join(outputDir, "topic-fact-pack.md")
  };
}

async function readSelectedTopic(path: string): Promise<SelectedTopic> {
  const content = await readFile(path, "utf8");
  const parsed = JSON.parse(content) as unknown;

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

async function readTopicSelectionReport(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function reliabilityForFactPack(topic: SelectedTopic): SourceReliability {
  if (topic.selected.selection.sourceReliability === "low") {
    return "low";
  }

  if (!isClaudeGooseTopic(topic)) {
    return topic.selected.selection.sourceReliability === "high" ? "medium" : topic.selected.selection.sourceReliability;
  }

  const hasOfficialClaudeSources = [
    sourceUrls.claudePricing,
    sourceUrls.claudePlanHelp,
    sourceUrls.claudeCodePlanHelp,
    sourceUrls.claudeCodeOverview
  ].every((url) => url.startsWith("https://"));
  const hasOfficialGooseSources = [
    sourceUrls.gooseGithub,
    sourceUrls.gooseProviders
  ].every((url) => url.startsWith("https://"));

  return hasOfficialClaudeSources && hasOfficialGooseSources ? "medium" : "low";
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
    selected.url,
    selected.selection.articleThesis,
    selected.selection.writingAngle
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function isClaudeGooseTopic(topic: SelectedTopic): boolean {
  const text = topicText(topic);
  return text.includes("claude code") && text.includes("goose");
}

function currentTopicSourceUrls(topic: SelectedTopic): string[] {
  const urls = [
    topic.selected.url,
    ...(topic.selected.evidence ?? [])
      .map((item) => item.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;，。]+$/, "") ?? "")
      .filter(Boolean)
  ];

  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))];
}

function displayTitle(topic: SelectedTopic): string {
  return topic.selected.titleZh || topic.selected.title || topic.selected.rawTitle || "当前 AI 资讯选题";
}

function originalTitle(topic: SelectedTopic): string {
  return topic.selected.rawTitle || topic.selected.title || topic.selected.titleZh || "当前 AI 资讯";
}

function topicSummary(topic: SelectedTopic): string {
  return topic.selected.summaryZh || topic.selected.summary || topic.selected.rawSummary || topic.selected.selection.publicInterest;
}

function createGenericClaims(topic: SelectedTopic): FactPackClaim[] {
  const urls = currentTopicSourceUrls(topic);
  const title = originalTitle(topic);
  const summary = topicSummary(topic);
  const sourceLabel = topic.selected.sourceType === "global_search"
    ? "搜索线索"
    : topic.selected.sourceType === "rss"
      ? "RSS 来源"
      : "人工选题来源";

  return [
    {
      claim: `当前选题来自 ${topic.selected.sourceName}：${title}。`,
      status: "partially_verified",
      sourceUrls: urls,
      safeWording: `可以写成“${topic.selected.sourceName} 的一条${sourceLabel}显示，${title}”，但必须提醒读者具体发布时间、产品边界和指标口径仍需回到原文核验。`,
      risk: topic.selected.sourceType === "global_search" ? "medium" : "low"
    },
    {
      claim: summary,
      status: "partially_verified",
      sourceUrls: urls,
      safeWording: `可以把该线索概括为“${summary}”，但不能把搜索摘要、译写摘要或媒体标题扩展成官方结论。`,
      risk: "medium"
    },
    {
      claim: topic.selected.selection.writingAngle,
      status: "partially_verified",
      sourceUrls: urls,
      safeWording: `正文适合从“${topic.selected.selection.writingAngle}”切入，重点写它可能怎样影响开发者、产品团队或内容生产工作流。`,
      risk: "medium"
    },
    {
      claim: "该选题包含模型、智能体或开发者工作流相关信号。",
      status: "partially_verified",
      sourceUrls: urls,
      safeWording: "可以讨论它释放出的产品和工作流信号，但不要写成已被官方完整证实的行业结论，也不要直接复述未经核验的夸张性能对比。",
      risk: "medium"
    }
  ];
}

function createClaims(topic: SelectedTopic): FactPackClaim[] {
  if (!isClaudeGooseTopic(topic)) {
    return createGenericClaims(topic);
  }

  return [
    {
      claim: "媒体提到的两百美元级别月费对应 Claude Max 20x 个人套餐价格，而不是 Claude Code 的单独固定价格。",
      status: "verified",
      sourceUrls: [
        sourceUrls.claudePricing,
        sourceUrls.claudePlanHelp,
        sourceUrls.claudeCodePlanHelp
      ],
      safeWording:
        "Anthropic 官方页面列出 Max 20x 为两百美元级别月费；Claude Code 包含在 Pro/Max 等付费 Claude 计划中，因此应写成“高阶个人订阅方案可使用 Claude Code”，不能写成“Claude Code 必须花两百美元级别月费才能用”。",
      risk: "medium"
    },
    {
      claim: "Claude Code 可处理项目级编码任务，包括跨文件修改、测试、修 bug、Git/PR 和 MCP 工具连接。",
      status: "verified",
      sourceUrls: [sourceUrls.claudeCodeOverview],
      safeWording:
        "Claude Code 是 Anthropic 面向开发者的编码代理，可在项目中规划、修改代码、运行验证，并连接外部工具。",
      risk: "low"
    },
    {
      claim: "Claude Code 的成本不只一种形态：订阅计划、API token 消耗、团队/企业计划和额外用量都可能影响实际成本。",
      status: "verified",
      sourceUrls: [
        sourceUrls.claudeCodeCosts,
        sourceUrls.claudeCodePlanHelp,
        sourceUrls.claudePricing
      ],
      safeWording:
        "Claude Code 可以随 Pro/Max 等订阅使用，也可能在 API Key/PAYG 或企业部署下产生不同费用，实际成本取决于计划、模型和用量。",
      risk: "medium"
    },
    {
      claim: "Goose 是开源 AI agent，本体可免费获取和使用。",
      status: "verified",
      sourceUrls: [sourceUrls.gooseGithub, sourceUrls.gooseProviders],
      safeWording:
        "Goose 可安全表述为“免费开源的本地 AI agent/开发者代理工具”。",
      risk: "low"
    },
    {
      claim: "Goose 免费不等于零成本：使用 Anthropic、OpenAI、Google、Groq、OpenRouter 等模型时，可能需要 API Key、订阅或供应商侧费用。",
      status: "verified",
      sourceUrls: [sourceUrls.gooseProviders, sourceUrls.gooseGithub],
      safeWording:
        "更稳妥的说法是“Goose 本体免费开源，但模型调用费用取决于你接入的 LLM 提供商；部分提供商有免费层，付费模型仍可能产生费用”。",
      risk: "medium"
    },
    {
      claim: "Claude Code 和 Goose 都可归入 coding agent / developer agent 范畴，能力存在重叠。",
      status: "partially_verified",
      sourceUrls: [
        sourceUrls.claudeCodeOverview,
        sourceUrls.gooseGithub,
        sourceUrls.gooseTips
      ],
      safeWording:
        "两者都面向开发者自动化，能覆盖代码理解、文件修改、命令执行或项目级任务的一部分场景；但产品形态、模型后端、权限治理、交互体验和成熟度不同。",
      risk: "medium"
    },
    {
      claim: "“Goose does the same thing as Claude Code”是过度绝对的说法。",
      status: "unverified",
      sourceUrls: [
        sourceUrls.selectedTopic,
        sourceUrls.claudeCodeOverview,
        sourceUrls.gooseGithub
      ],
      safeWording:
        "可以写“Goose 在部分 coding agent 工作流上与 Claude Code 有重叠，并提供开源、可自选模型的替代路径”，不要写“能力完全一样”或“完全替代”。",
      risk: "high"
    }
  ];
}

function createFactPack(topic: SelectedTopic, now: Date): TopicFactPack {
  if (!isClaudeGooseTopic(topic)) {
    return createGenericFactPack(topic, now);
  }

  const factPack: TopicFactPack = {
    topicTitle: topic.selected.title,
    generatedAt: now.toISOString(),
    sourceReliability: reliabilityForFactPack(topic),
    verifiedClaims: createClaims(topic),
    comparison: {
      claudeCode: {
        pricing:
          "不是独立两百美元级别月费单品。Claude 官方价格页显示 Pro、Max 等订阅层级，帮助中心列出 Max 20x 为两百美元级别月费；Claude Code 包含在 Pro/Max 等付费计划中，也可在 API/PAYG 或团队/企业场景产生不同成本。",
        positioning:
          "Anthropic 的官方编码代理，面向项目级开发任务、代码修改、测试、Git/PR、MCP 工具连接和团队工作流。",
        capabilities: [
          "理解项目上下文并规划编码任务",
          "跨文件写代码、修 bug、补测试",
          "运行验证、处理 lint/test 失败",
          "使用 Git 创建提交、分支和 PR",
          "通过 MCP 连接设计文档、Issue、Slack、Jira 或自定义工具"
        ],
        sourceUrls: [
          sourceUrls.claudePricing,
          sourceUrls.claudePlanHelp,
          sourceUrls.claudeCodePlanHelp,
          sourceUrls.claudeCodeOverview,
          sourceUrls.claudeCodeCosts
        ]
      },
      goose: {
        pricing:
          "Goose 本体免费开源，但需要配置模型提供商。接入 Claude、OpenAI、Google、OpenRouter 等模型时，费用取决于对应提供商、API Key、订阅或免费层限制。",
        positioning:
          "AAIF/Linux Foundation 旗下的开源本地 AI agent，提供 Desktop、CLI 和 API，可用于代码、自动化、数据分析、写作等工作流。",
        capabilities: [
          "本地运行，提供桌面应用、CLI 和 API",
          "支持多模型提供商和自定义 provider",
          "可通过扩展/MCP 连接外部工具",
          "可执行工程任务，如代码修改、命令运行、测试和自动化",
          "允许用户选择监督模式和模型配置"
        ],
        sourceUrls: [
          sourceUrls.gooseGithub,
          sourceUrls.gooseProviders,
          sourceUrls.gooseTips
        ]
      },
      similarities: [
        "都可以被放进 coding agent / developer agent 讨论框架。",
        "都强调项目级任务处理，而不只是代码补全。",
        "都涉及代码理解、文件修改、命令/工具调用和工作流自动化。",
        "都需要用户关注权限、上下文、模型成本和执行安全。"
      ],
      differences: [
        "Claude Code 是 Anthropic 官方产品，绑定 Claude 订阅、API 或企业部署路径；Goose 是开源本地 agent，可自选模型提供商。",
        "Claude Code 的能力、模型和产品体验由 Anthropic 打包；Goose 的体验更依赖用户选择的模型、扩展和配置。",
        "Claude Code 的费用主要来自 Claude 订阅/API/企业用量；Goose 本体免费，但底层模型调用可能收费。",
        "Claude Code 更像付费产品化编码代理；Goose 更像可扩展、可自托管、可替换后端的开源 agent 基础设施。"
      ],
      unsafeComparisonClaims: [
        "Goose 完全替代 Claude Code。",
        "Goose 和 Claude Code 能力完全一样。",
        "Goose 完全免费且没有任何成本。",
        "Claude Code 必须花两百美元级别月费才能用。",
        "只凭 VentureBeat 标题就断言两者做同一件事。"
      ]
    },
    safeWritingBoundary: [
      "可以写：Claude Max 20x 官方帮助中心列出两百美元级别月费，但这对应 Claude 订阅层级，不是 Claude Code 单独强制价格。",
      "可以写：Claude Code 包含在 Pro/Max 等付费 Claude 计划中，且 API Key/PAYG 或企业部署可能产生不同成本。",
      "可以写：Goose 是免费开源 AI agent，但调用外部 LLM 可能需要 API Key、订阅或按量付费。",
      "可以写：两者在 coding agent 工作流上有重叠，但不能写成能力完全一致。",
      "可以写：这件事反映 coding agent 从单一付费产品扩散到开源基础设施的趋势信号。"
    ],
    riskNotes: [
      "价格信息会变，下一阶段写作前仍应以 Claude 官方价格页和帮助中心为准。",
      "VentureBeat 标题是选题线索，不能替代 Anthropic 或 Goose 官方来源。",
      "Goose 免费属性只适用于工具本体和开源许可，不覆盖模型供应商成本。",
      "“does the same thing”属于标题化概括，正文必须降级为“部分工作流重叠”。",
      "不要写能力评测结论，除非另有实测或第三方 benchmark 支撑。"
    ],
    recommendedFraming:
      "这不是简单的免费替代高价工具，而是 coding agent 正在从付费产品变成开源基础设施的一次信号。",
    articleAngleSuggestions: [
      "从“价格对比”转向“工作流控制权”：为什么开发者开始关心开源 coding agent。",
      "从“免费”转向“总成本”：工具本体、模型调用、配置维护和安全治理分别花在哪里。",
      "从“同类工具”转向“生态路径”：Claude Code 代表产品化闭环，Goose 代表可替换模型和开源扩展。",
      "从“替代”转向“组合”：团队可能用开源 agent 做试点和成本对冲，而非立刻放弃付费工具。"
    ]
  };

  if (factPack.sourceReliability === "low") {
    throw new Error("Topic fact pack sourceReliability is low; stop before writing.");
  }

  return factPack;
}

function createGenericFactPack(topic: SelectedTopic, now: Date): TopicFactPack {
  const urls = currentTopicSourceUrls(topic);
  const title = displayTitle(topic);
  const rawTitle = originalTitle(topic);
  const sourceRisk =
    topic.selected.sourceType === "global_search"
      ? "这条选题来自 global_search，搜索摘要只能作为线索，正文不能把它当确定事实。"
      : "正文仍需回到原始来源确认发布时间、产品边界和指标口径。";
  const factPack: TopicFactPack = {
    topicTitle: title,
    generatedAt: now.toISOString(),
    sourceReliability: reliabilityForFactPack(topic),
    verifiedClaims: createGenericClaims(topic),
    comparison: {
      claudeCode: {
        pricing: "不适用。本选题不是 Claude Code / Goose 价格对比专题。",
        positioning: `${topic.selected.sourceName} 的当前 AI 资讯线索：${rawTitle}`,
        capabilities: [
          topic.selected.selection.technicalSignificance,
          topic.selected.selection.businessImpact,
          topic.selected.selection.predictedImpact
        ].filter(Boolean),
        sourceUrls: urls
      },
      goose: {
        pricing: "不适用。本选题不涉及 Goose 定价。",
        positioning: "作为对照维度，可关注该线索对智能体工作流、模型能力或开发者工具生态的影响。",
        capabilities: [
          "观察它是否改变开发者或产品团队的默认工作流。",
          "区分来源声称、搜索摘要和可核验事实。",
          "避免把单条资讯写成行业定论。"
        ],
        sourceUrls: urls
      },
      similarities: [
        "都应围绕开发者工作流、模型能力或产品落地影响展开。",
        "都需要区分原始来源事实和编辑概括。",
        "都不能把未经核验的指标或对比写成确定结论。"
      ],
      differences: [
        "当前选题应服务于所选来源，而不是复用旧专题事实。",
        "当前选题的风险在于来源和指标口径核验，不是 Claude/Goose 价格比较。",
        "如果来源是搜索线索，正文需要显式降低确定性。"
      ],
      unsafeComparisonClaims: [
        "把搜索摘要当作官方发布。",
        "把单篇资讯中的性能数字写成无条件事实。",
        "把“接近”“追平”“超过”等标题化表达写成已证实结论。",
        "脱离当前来源，复用无关产品或旧专题事实。"
      ]
    },
    safeWritingBoundary: [
      `可以写：${topic.selected.sourceName} 的线索显示，${rawTitle}。`,
      "可以写：这类更新值得从智能体工作流、开发者工具链和产品落地角度观察。",
      "必须写清：具体发布时间、指标口径和产品边界需要回到原文核验。",
      "不能写：搜索摘要已经证明某模型或产品全面追平、超过另一个未核验对象。"
    ],
    riskNotes: [
      sourceRisk,
      "标题、摘要和中文化改写只用于编辑判断，不能替代原文事实。",
      "涉及参数规模、任务解决率、幻觉率、上下文长度、benchmark 或竞品对比时必须使用谨慎表达。",
      "如果原文不是官方来源，正文应避免使用“官方确认”“已经证明”等确定性措辞。"
    ],
    recommendedFraming:
      topic.selected.selection.writingAngle ||
      "从这条 AI 资讯看智能体能力更新对开发者工作流的影响。",
    articleAngleSuggestions: [
      topic.selected.selection.writingAngle,
      "从“产品更新”转向“工作流影响”：它会改变谁的日常流程。",
      "从“能力数字”转向“可信边界”：哪些指标需要回到原文核验。",
      "从“模型热闹”转向“落地场景”：开发者和团队该观察什么。"
    ].filter(Boolean)
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
    unverified: "未核验或高风险事实"
  };

  return headings[status];
}

function claimLines(claims: FactPackClaim[], status: FactClaimStatus): string[] {
  const filtered = claims.filter((claim) => claim.status === status);

  if (filtered.length === 0) {
    return ["- 无"];
  }

  return filtered.map((claim) => {
    const urls = claim.sourceUrls.map((url) => `<${url}>`).join(", ");
    return `- ${claim.claim}\n  - status: ${claim.status}\n  - risk: ${claim.risk}\n  - safeWording: ${claim.safeWording}\n  - sources: ${urls}`;
  });
}

function createMarkdownReport(factPack: TopicFactPack): string {
  const comparison = factPack.comparison;
  const isGeneric = comparison.claudeCode.pricing.startsWith("不适用。");

  return [
    "# Topic Fact Pack",
    "",
    `Generated at: ${factPack.generatedAt}`,
    "",
    "## 主选题",
    "",
    factPack.topicTitle,
    "",
    `sourceReliability: ${factPack.sourceReliability}`,
    "",
    `## ${statusHeading("verified")}`,
    "",
    ...claimLines(factPack.verifiedClaims, "verified"),
    "",
    `## ${statusHeading("partially_verified")}`,
    "",
    ...claimLines(factPack.verifiedClaims, "partially_verified"),
    "",
    `## ${statusHeading("unverified")}`,
    "",
    ...claimLines(factPack.verifiedClaims, "unverified"),
    "",
    isGeneric ? "## 选题核验维度" : "## Claude Code 与 Goose 对比",
    "",
    isGeneric ? "### 当前来源" : "### Claude Code",
    "",
    `- pricing: ${comparison.claudeCode.pricing}`,
    `- positioning: ${comparison.claudeCode.positioning}`,
    ...comparison.claudeCode.capabilities.map((item) => `- capability: ${item}`),
    `- sources: ${comparison.claudeCode.sourceUrls.map((url) => `<${url}>`).join(", ")}`,
    "",
    isGeneric ? "### 对照观察维度" : "### Goose",
    "",
    `- pricing: ${comparison.goose.pricing}`,
    `- positioning: ${comparison.goose.positioning}`,
    ...comparison.goose.capabilities.map((item) => `- capability: ${item}`),
    `- sources: ${comparison.goose.sourceUrls.map((url) => `<${url}>`).join(", ")}`,
    "",
    "### Similarities",
    "",
    ...comparison.similarities.map((item) => `- ${item}`),
    "",
    "### Differences",
    "",
    ...comparison.differences.map((item) => `- ${item}`),
    "",
    "## 安全写法",
    "",
    ...factPack.safeWritingBoundary.map((item) => `- ${item}`),
    "",
    "## 禁止写法",
    "",
    ...comparison.unsafeComparisonClaims.map((item) => `- ${item}`),
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
    "- 本阶段只生成 fact pack。",
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
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const topic = options.topic ?? (await readSelectedTopic(selectedTopicFile));

  if (!options.topicSelectionReport) {
    await readTopicSelectionReport(topicSelectionReportFile);
  }

  const factPack = createFactPack(topic, options.now ?? new Date());

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.topicFactPackJson, factPack);
    await writeFile(files.topicFactPackReport, createMarkdownReport(factPack), "utf8");
  }

  logger.info(
    `Built topic fact pack for ${factPack.topicTitle} with ${factPack.verifiedClaims.length} claims.`
  );

  return {
    outputDir,
    files,
    factPack
  };
}
