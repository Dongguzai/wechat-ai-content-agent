import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countArticleChars } from "./writeArticle.js";
import type {
  ArticleMeta,
  ArticleReviewIssue,
  ArticleReviewIssueType,
  ArticleReviewOutputFiles,
  ArticleReviewPipelineResult,
  ArticleReviewResult,
  ArticleReviewSeverity,
  ArticleUsedClaim
} from "../types/article.js";
import type { FactPackClaim, TopicFactPack } from "../types/factPack.js";
import type { SelectedTopic } from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface ReviewArticleInput {
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  factPack: TopicFactPack;
  selectedTopic: SelectedTopic;
}

export interface ReviewArticleOptions {
  outputDir?: string;
  articleFile?: string;
  articleMetaFile?: string;
  topicFactPackFile?: string;
  topicFactPackReportFile?: string;
  selectedTopicFile?: string;
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  factPack?: TopicFactPack;
  topicFactPackReport?: string;
  selectedTopic?: SelectedTopic;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const requiredThemes = ["开源", "工作流", "成本", "工具锁定"] as const;

const factBoundaryRules: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "Goose 完全替代 Claude Code",
    pattern: /Goose.{0,12}(完全|全面|彻底|直接)?(替代|取代|代替).{0,12}Claude Code|Claude Code.{0,12}(被)?Goose.{0,12}(完全|全面|彻底|直接)?(替代|取代|代替)/
  },
  {
    label: "Goose 和 Claude Code 完全一样",
    pattern: /Goose.{0,12}(和|与).{0,8}Claude Code.{0,16}(完全一样|完全相同|能力完全一样|能力相同|等同|做同一件事)/
  },
  {
    label: "Goose 零成本",
    pattern: /Goose.{0,16}(零成本|无成本|没有任何成本|完全免费且没有任何成本)/
  },
  {
    label: "Claude Code 必须花 $200 才能用",
    pattern: /Claude Code.{0,20}(必须|只能|需要|得|要).{0,12}(\$200|200\s*(美元|美金|刀|\/month|\/月)|200\/month).{0,20}(才能用|才可用|才可以用|使用|用)/
  },
  {
    label: "Claude Code 是单独固定 $200/month 工具",
    pattern: /Claude Code.{0,24}(单独固定|固定|单独).{0,12}(\$200|200\s*(美元|美金|刀|\/month|\/月)|200\/month).{0,16}(工具|产品|收费|月费|每月)/
  },
  {
    label: "免费平替",
    pattern: /免费平替|Goose.{0,12}平替.{0,12}Claude Code|Goose.{0,12}免费.{0,12}(平替|替代|取代).{0,12}Claude Code/
  }
];

function createOutputFiles(outputDir: string): ArticleReviewOutputFiles {
  return {
    articleReview: join(outputDir, "article-review.json"),
    articleReviewReport: join(outputDir, "article-review-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/g, "");
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readableCharCount(value: string): number {
  return [...value.replace(/\s/g, "")].length;
}

function extractTitle(markdown: string): string {
  const firstLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine?.replace(/^#{1,6}\s*/, "").trim() ?? "";
}

function markdownWithoutTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonEmptyIndex === -1) {
    return markdown;
  }

  return lines.slice(firstNonEmptyIndex + 1).join("\n");
}

function articlePlainText(markdown: string): string {
  return normalizeSpaces(
    stripUrls(markdown)
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/[>*`_[\]()]/g, "")
  );
}

function addIssue(
  issues: ArticleReviewIssue[],
  type: ArticleReviewIssueType,
  severity: ArticleReviewSeverity,
  message: string,
  evidence: string,
  suggestion: string
): void {
  issues.push({ type, severity, message, evidence, suggestion });
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function findFactBoundaryViolations(markdown: string): string[] {
  const checkText = stripUrls(markdown);

  return factBoundaryRules
    .filter((rule) => rule.pattern.test(checkText))
    .map((rule) => rule.label);
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function claimIsReflectedSafely(
  claim: ArticleUsedClaim,
  markdown: string
): { passed: boolean; reason: string } {
  const text = articlePlainText(markdown);
  const claimText = `${claim.claim} ${claim.safeWording}`;

  if (/200|Max 20x|up to \$200|高价订阅价格|高阶个人订阅|高阶套餐/i.test(claimText)) {
    const mentionsUnsafePrice = /(\$200|200\/month|200\s*\/\s*month|200\s*美元|200\s*美金|200\s*\/\s*月)/i.test(
      text
    );
    const preservesBoundary =
      hasAny(text, ["高阶个人订阅方案", "高价订阅价格", "高阶套餐价格"]) &&
      hasAny(text, ["不是 Claude Code 的单独固定价格", "不是 Claude Code 单独", "订阅"]);

    return {
      passed: !mentionsUnsafePrice && preservesBoundary,
      reason: "涉及高阶订阅价格时，正文需要说明这是 Claude 订阅层级边界，不是 Claude Code 单独固定价格。"
    };
  }

  if (claimText.includes("Claude Code 可处理项目级编码任务")) {
    const passed =
      text.includes("Claude Code") &&
      hasAny(text, ["规划", "修改代码", "运行验证", "外部工具", "项目级"]);

    return {
      passed,
      reason: "Claude Code 能力描述需要限制在项目级编码代理、修改代码、运行验证或外部工具连接等 safeWording 范围内。"
    };
  }

  if (claimText.includes("成本不只一种形态")) {
    const costSignals = ["Pro/Max", "API Key", "PAYG", "企业", "用量", "计划"].filter(
      (term) => text.includes(term)
    );

    return {
      passed: costSignals.length >= 2,
      reason: "Claude Code 成本描述需要体现订阅、API/PAYG、企业部署或用量差异，而不是单一价格。"
    };
  }

  if (claimText.includes("Goose 是开源 AI agent")) {
    return {
      passed: text.includes("Goose") && hasAny(text, ["免费开源", "开源", "本地 AI agent"]),
      reason: "Goose 应表述为免费开源的本地 AI agent/开发者代理工具。"
    };
  }

  if (
    claimText.includes("Goose 免费不等于零成本") ||
    claimText.includes("接入模型服务仍可能产生 API 或订阅成本")
  ) {
    const costBoundary =
      hasAny(text, ["模型调用费用", "LLM 提供商", "API Key", "付费模型", "可能产生费用"]) &&
      hasAny(text, ["取决于", "可能", "仍可能", "不是没有账单"]);

    return {
      passed: costBoundary,
      reason: "Goose 免费表述必须同时说明模型调用、API Key、订阅或供应商侧费用边界。"
    };
  }

  if (claimText.includes("能力存在重叠")) {
    const passed =
      hasAny(text, ["重叠", "部分场景", "一部分场景"]) &&
      hasAny(text, ["但", "不同", "不等于"]);

    return {
      passed,
      reason: "Claude Code 与 Goose 只能写成部分 coding agent 工作流重叠，并说明差异。"
    };
  }

  if (claimText.includes("过度绝对") || claimText.includes("做同一件事")) {
    const passed = hasAny(text, [
      "不等于两者能力边界一致",
      "不代表可以无差别迁移",
      "不能视为同一能力",
      "需要降级"
    ]);

    return {
      passed,
      reason: "对媒体标题化说法需要降级，明确不能写成同一能力或覆盖所有场景。"
    };
  }

  return { passed: true, reason: "未命中特定高风险 claim 规则。" };
}

function findUntrackedBodyFacts(
  markdown: string,
  usedClaims: ArticleUsedClaim[]
): string[] {
  const text = articlePlainText(markdown);
  const usedClaimText = usedClaims
    .map((claim) => `${claim.claim} ${claim.safeWording}`)
    .join("\n");
  const checks: Array<{ label: string; bodyPattern: RegExp; claimPattern: RegExp }> = [
    {
      label: "高阶订阅价格边界",
      bodyPattern: /(\$200|200\/month|200\s*美元|200\s*美金|Max 20x|高价订阅价格|高阶个人订阅方案|高阶套餐价格)/i,
      claimPattern: /(\$200|200|Max 20x|up to \$200|高价订阅价格|高阶个人订阅|高阶套餐价格)/i
    },
    {
      label: "Claude Code 订阅/API/PAYG 成本形态",
      bodyPattern: /(Pro\/Max|API Key|PAYG|企业部署|用量).{0,16}(成本|费用|计划|订阅)/i,
      claimPattern: /(成本不只一种形态|API token|PAYG|Pro\/Max|企业计划|用量)/
    },
    {
      label: "Claude Code 项目级编码代理能力",
      bodyPattern: /Claude Code.{0,32}(规划|修改代码|运行验证|外部工具|项目级|编码代理)/,
      claimPattern: /(Claude Code 可处理项目级编码任务|Anthropic 面向开发者的编码代理)/
    },
    {
      label: "Goose 免费开源属性",
      bodyPattern: /Goose.{0,20}(免费开源|开源|本地 AI agent|开发者代理工具)/,
      claimPattern: /(Goose 是开源 AI agent|免费开源的本地 AI agent)/
    },
    {
      label: "Goose 模型调用费用边界",
      bodyPattern: /Goose.{0,80}(模型调用费用|API Key|供应商|付费模型|可能产生费用)/,
      claimPattern: /(Goose 免费不等于零成本|模型调用费用取决于|接入模型服务仍可能产生 API 或订阅成本)/
    },
    {
      label: "Claude Code 与 Goose 能力重叠但不同",
      bodyPattern: /(Claude Code|Goose).{0,80}(重叠|部分场景|产品形态|模型后端|成熟度不同|能力边界一致|无差别迁移)/,
      claimPattern: /(能力存在重叠|过度绝对|部分 coding agent 工作流|部分工作流重叠)/
    }
  ];

  return checks
    .filter((check) => check.bodyPattern.test(text) && !check.claimPattern.test(usedClaimText))
    .map((check) => check.label);
}

function createQualityCheck(markdown: string) {
  const plainText = articlePlainText(markdown);
  const wordCount = countArticleChars(markdown);
  const title = extractTitle(markdown);
  const firstPersonSignals = ["我", "我们", "本人", "笔者", "亲测", "体验下来", "我的"];
  const newsReleaseSignals = [
    "本公司",
    "隆重发布",
    "新闻稿",
    "记者获悉",
    "截至发稿",
    "以下简称"
  ];
  const themesCovered = requiredThemes.filter((theme) => plainText.includes(theme));

  return {
    wordCountOk: wordCount <= 1500,
    hasTitle: title.length > 0,
    hasHeadings: /^##\s+\S/m.test(markdown),
    thirdPersonPerspective: !firstPersonSignals.some((signal) => plainText.includes(signal)),
    notNewsRelease: !newsReleaseSignals.some((signal) => plainText.includes(signal)),
    themesCovered
  };
}

function titleHasClickbait(title: string): boolean {
  return /(震惊|炸了|史上|必看|封神|内幕|彻底|终结|碾压|吊打|全网都在)/.test(title);
}

function titleImpliesUnsafeFreeReplacement(title: string): boolean {
  return /免费平替|Goose.{0,12}免费.{0,12}(平替|替代|取代).{0,12}Claude Code|Goose.{0,12}(平替|替代|取代).{0,12}Claude Code/.test(
    title
  );
}

function titleMatchesBody(title: string, markdown: string): boolean {
  const plainText = articlePlainText(markdown);
  const keywords = ["编码代理", "Claude Code", "Goose", "价格", "工作流", "开源", "成本"].filter(
    (keyword) => title.includes(keyword)
  );

  return keywords.length === 0 || keywords.some((keyword) => plainText.includes(keyword));
}

function collectStrengths(result: ArticleReviewResult): string[] {
  const strengths: string[] = [];

  if (result.factBoundaryCheck.passed) {
    strengths.push("未发现违反 fact pack 安全边界的高风险表述。");
  }

  if (result.qualityCheck.themesCovered.length >= 3) {
    strengths.push(
      `覆盖了 ${result.qualityCheck.themesCovered.join(" / ")} 等核心主题。`
    );
  }

  if (
    result.qualityCheck.hasTitle &&
    result.qualityCheck.hasHeadings &&
    result.qualityCheck.thirdPersonPerspective
  ) {
    strengths.push("标题、小标题和第三视角结构完整。");
  }

  if (result.score >= 80) {
    strengths.push("整体论点、事实边界和下一阶段可用性达到审核阈值。");
  }

  return strengths.length > 0 ? strengths : ["暂无明显优点，需先完成必修修改项。"];
}

function urlsOverlap(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((url) => rightSet.has(url));
}

function findMatchingFactPackClaim(
  usedClaim: ArticleUsedClaim,
  factPackClaims: Map<string, FactPackClaim>,
  allFactPackClaims: FactPackClaim[]
): FactPackClaim | undefined {
  return (
    factPackClaims.get(usedClaim.claim) ??
    allFactPackClaims.find(
      (claim) =>
        usedClaim.sourceUrls.length > 0 &&
        urlsOverlap(usedClaim.sourceUrls, claim.sourceUrls)
    )
  );
}

function createReviewReport(result: ArticleReviewResult): string {
  const strengths = collectStrengths(result);
  const issueLines =
    result.issues.length > 0
      ? result.issues.map(
          (issue) =>
            `- [${issue.severity}] ${issue.type}: ${issue.message}\n  - evidence: ${issue.evidence}\n  - suggestion: ${issue.suggestion}`
        )
      : ["- 未发现必须修改的问题。"];
  const requiredFixLines =
    result.requiredFixes.length > 0
      ? result.requiredFixes.map((fix) => `- ${fix}`)
      : ["- 无。"];
  const optionalLines =
    result.optionalSuggestions.length > 0
      ? result.optionalSuggestions.map((suggestion) => `- ${suggestion}`)
      : ["- 无。"];
  const boundaryLines =
    result.factBoundaryCheck.violations.length > 0
      ? result.factBoundaryCheck.violations.map((violation) => `- ${violation}`)
      : ["- 未发现边界违规。"];

  return [
    "# Article Review Report",
    "",
    "## 审核结论",
    "",
    result.finalVerdict,
    "",
    "## 总分",
    "",
    `${result.score}/100`,
    "",
    "## 是否通过",
    "",
    result.passed ? "通过" : "不通过",
    "",
    "## 主要优点",
    "",
    ...strengths.map((strength) => `- ${strength}`),
    "",
    "## 发现的问题",
    "",
    ...issueLines,
    "",
    "## 必修修改项",
    "",
    ...requiredFixLines,
    "",
    "## 可选优化建议",
    "",
    ...optionalLines,
    "",
    "## fact pack 边界检查结果",
    "",
    `- passed: ${result.factBoundaryCheck.passed ? "true" : "false"}`,
    ...boundaryLines,
    "",
    "## 是否允许进入下一阶段",
    "",
    result.passed ? "允许进入“封面图生成 + HTML 排版”。" : "不允许进入下一阶段。",
    ""
  ].join("\n");
}

export function reviewArticle(
  input: ReviewArticleInput,
  options: { now?: Date } = {}
): ArticleReviewResult {
  const { articleMarkdown, articleMeta, factPack, selectedTopic } = input;
  const issues: ArticleReviewIssue[] = [];
  const generatedAt = (options.now ?? new Date()).toISOString();
  const title = extractTitle(articleMarkdown);
  const bodyWithoutTitle = markdownWithoutTitle(articleMarkdown);
  const plainBody = articlePlainText(bodyWithoutTitle);
  const actualWordCount = countArticleChars(articleMarkdown);
  const qualityCheck = createQualityCheck(articleMarkdown);
  const boundaryViolations = findFactBoundaryViolations(articleMarkdown);
  const factBoundaryCheck = {
    passed: boundaryViolations.length === 0,
    violations: boundaryViolations
  };

  for (const violation of boundaryViolations) {
    addIssue(
      issues,
      "policy",
      "high",
      "文章触碰 topic-fact-pack 明确禁止的事实边界。",
      violation,
      "删除或降级该表述，改用 fact pack 中的 safeWording。"
    );
  }

  if (!qualityCheck.wordCountOk) {
    addIssue(
      issues,
      "structure",
      "high",
      "文章超过 1500 字限制。",
      `当前 ${actualWordCount} 字。`,
      "压缩正文至 1500 字以内。"
    );
  }

  if (Math.abs((articleMeta.wordCount ?? 0) - actualWordCount) > 10) {
    addIssue(
      issues,
      "structure",
      "low",
      "article-meta.wordCount 与正文实际字数不一致。",
      `meta=${articleMeta.wordCount}; actual=${actualWordCount}`,
      "同步更新 article-meta.wordCount，保持审核依据一致。"
    );
  }

  const usedClaims = Array.isArray(articleMeta.usedClaims)
    ? articleMeta.usedClaims
    : [];
  const allFactPackClaims = factPack.verifiedClaims;
  const factPackClaims = new Map<string, FactPackClaim>(
    allFactPackClaims.map((claim) => [claim.claim, claim])
  );

  if (usedClaims.length < 3) {
    addIssue(
      issues,
      "fact",
      "medium",
      "article-meta.usedClaims 少于 3 条。",
      `当前 ${usedClaims.length} 条。`,
      "至少引用 3 条来自 topic-fact-pack 的 usedClaims。"
    );
  }

  for (const usedClaim of usedClaims) {
    const factPackClaim = findMatchingFactPackClaim(
      usedClaim,
      factPackClaims,
      allFactPackClaims
    );

    if (!factPackClaim) {
      addIssue(
        issues,
        "fact",
        "medium",
        "usedClaim 不来自 topic-fact-pack。",
        usedClaim.claim,
        "删除该 claim，或先把它补入 topic-fact-pack 并完成核验。"
      );
      continue;
    }

    if (!usedClaim.safeWording?.trim()) {
      addIssue(
        issues,
        "fact",
        "medium",
        "usedClaim 缺少 safeWording。",
        usedClaim.claim,
        "为每条 usedClaim 保留 topic-fact-pack 中的 safeWording。"
      );
    } else if (
      usedClaim.claim === factPackClaim.claim &&
      usedClaim.safeWording.trim() !== factPackClaim.safeWording.trim()
    ) {
      addIssue(
        issues,
        "fact",
        "medium",
        "usedClaim.safeWording 与 topic-fact-pack 不一致。",
        usedClaim.claim,
        "使用 topic-fact-pack 中的原始 safeWording，避免审核边界漂移。"
      );
    }

    const safeReflection = claimIsReflectedSafely(usedClaim, articleMarkdown);
    if (!safeReflection.passed) {
      addIssue(
        issues,
        "fact",
        "medium",
        "正文没有基本遵守 usedClaim 的 safeWording。",
        `${usedClaim.claim}: ${safeReflection.reason}`,
        "调整正文表述，使其落在 safeWording 的限定范围内。"
      );
    }
  }

  const untrackedFacts = findUntrackedBodyFacts(articleMarkdown, usedClaims);
  for (const fact of untrackedFacts) {
    addIssue(
      issues,
      "fact",
      "medium",
      "正文包含未进入 usedClaims 的关键事实。",
      fact,
      "把该事实补入 article-meta.usedClaims，并确保它来自 topic-fact-pack。"
    );
  }

  if (!qualityCheck.hasTitle) {
    addIssue(
      issues,
      "structure",
      "medium",
      "文章缺少明确标题。",
      "正文首个非空行为空或不可识别。",
      "补充与正文主旨一致的标题。"
    );
  }

  if (!qualityCheck.hasHeadings) {
    addIssue(
      issues,
      "structure",
      "medium",
      "文章缺少小标题。",
      "未发现 Markdown 二级标题。",
      "为主要段落补充清晰小标题。"
    );
  }

  if (!qualityCheck.thirdPersonPerspective) {
    addIssue(
      issues,
      "style",
      "medium",
      "文章存在第一人称或体验文信号。",
      "检测到“我/我们/本人/笔者/亲测/体验下来”等表达。",
      "改为第三视角分析，不写第一人称体验文。"
    );
  }

  if (!qualityCheck.notNewsRelease) {
    addIssue(
      issues,
      "style",
      "medium",
      "文章呈现出新闻通稿信号。",
      "检测到通稿式表达。",
      "改为观点分析文章，减少通稿口吻。"
    );
  }

  if (qualityCheck.themesCovered.length < 3) {
    addIssue(
      issues,
      "structure",
      "medium",
      "文章核心主题覆盖不足。",
      `当前覆盖：${qualityCheck.themesCovered.join(" / ") || "无"}`,
      "至少解释“开源 / 工作流 / 成本 / 工具锁定”中的 3 个主题。"
    );
  }

  const hasClearPoint =
    Boolean(articleMeta.articleThesis?.trim()) &&
    /(真正|更稳|判断|主战场|重点|不是.+而是|转向|控制权|工作流入口)/.test(
      plainBody
    );
  if (!hasClearPoint) {
    addIssue(
      issues,
      "logic",
      "medium",
      "文章论点不够清晰。",
      articleMeta.articleThesis || "articleThesis 为空或正文未形成可识别论点。",
      "强化中心论点，并让开头、中段和结尾围绕同一判断展开。"
    );
  }

  const audienceSignals = ["开发者", "团队", "内容创作者", "创业者", "普通用户", "AI"].filter(
    (term) => plainBody.includes(term)
  );
  if (audienceSignals.length < 2) {
    addIssue(
      issues,
      "style",
      "low",
      "目标读者适配度还不够明确。",
      `读者信号：${audienceSignals.join(" / ") || "无"}`,
      "补充普通 AI 关注者、开发者、内容创作者或创业者能理解的解释。"
    );
  }

  const opening = articlePlainText(bodyWithoutTitle).slice(0, 320);
  if (!/(冲突|一边.+另一边|但|不是.+而是|问题|价格)/.test(opening)) {
    addIssue(
      issues,
      "logic",
      "medium",
      "开头没有建立清晰冲突。",
      opening || "开头为空。",
      "在开头交代高价订阅、开源工具、成本或工作流入口之间的冲突。"
    );
  }

  const middleStart = Math.floor(plainBody.length / 3);
  const middle = plainBody.slice(middleStart, middleStart + Math.floor(plainBody.length / 3));
  if (!/(行业|变化|竞争|基础设施|产品竞争|工作流|工具锁定|成本结构|入口)/.test(middle)) {
    addIssue(
      issues,
      "logic",
      "medium",
      "中段没有充分解释行业变化。",
      middle.slice(0, 120),
      "在中段解释 coding agent 从产品、模型能力或订阅工具走向工作流/基础设施竞争的变化。"
    );
  }

  if (/(所有团队|所有开发者|必然|一定会|彻底改变|已经证明.+行业|终结.+行业|淘汰.+所有)/.test(plainBody)) {
    addIssue(
      issues,
      "logic",
      "medium",
      "文章可能从个案过度推导行业结论。",
      "检测到绝对化行业判断。",
      "把结论降级为趋势信号或可能路径，避免从单个案例推出确定性行业结论。"
    );
  }

  const ending = plainBody.slice(Math.max(0, plainBody.length - 420));
  if (!/(趋势|下一阶段|转向|未来|更稳的判断|可能|会)/.test(ending)) {
    addIssue(
      issues,
      "logic",
      "low",
      "结尾趋势判断不够明确。",
      ending.slice(0, 160),
      "结尾补充趋势判断，但保持克制，不写成确定性胜负。"
    );
  }

  if (/(必然|一定|彻底|终结|碾压|吊打|改写一切)/.test(ending)) {
    addIssue(
      issues,
      "logic",
      "medium",
      "结尾趋势判断过度武断。",
      ending.slice(0, 160),
      "把结尾改为趋势判断或阶段性观察，避免绝对化预测。"
    );
  }

  const titleLength = readableCharCount(title);
  if (titleLength < 8 || titleLength > 36 || !/(不是|而是|真正|为什么|开始|重新|卷|成本|工作流|开源|价格)/.test(title)) {
    addIssue(
      issues,
      "title",
      "low",
      "标题传播感不足。",
      title || "无标题",
      "标题应保持克制传播感，最好体现冲突、转折或工作流主旨。"
    );
  }

  if (titleHasClickbait(title)) {
    addIssue(
      issues,
      "title",
      "medium",
      "标题存在标题党信号。",
      title,
      "删除震惊、封神、终结、碾压等夸张词。"
    );
  }

  if (titleImpliesUnsafeFreeReplacement(title)) {
    addIssue(
      issues,
      "title",
      "high",
      "标题暗示 Goose 免费平替 Claude Code。",
      title,
      "改为工作流、成本结构或开源基础设施角度，不写免费平替。"
    );
  }

  if (!titleMatchesBody(title, articleMarkdown)) {
    addIssue(
      issues,
      "title",
      "medium",
      "标题与正文主旨不一致。",
      title,
      "让标题关键词与正文主旨保持一致。"
    );
  }

  if (selectedTopic.selected.url && !articleMarkdown.includes(selectedTopic.selected.url)) {
    addIssue(
      issues,
      "fact",
      "medium",
      "正文缺少原始选题来源 URL。",
      selectedTopic.selected.url,
      "在正文或元信息中保留原始选题线索 URL，方便人工复核。"
    );
  }

  const highIssueCount = issues.filter((issue) => issue.severity === "high").length;
  const mediumIssueCount = issues.filter((issue) => issue.severity === "medium").length;
  const lowIssueCount = issues.filter((issue) => issue.severity === "low").length;
  let score = clampScore(100 - highIssueCount * 30 - mediumIssueCount * 12 - lowIssueCount * 5);

  if (!factBoundaryCheck.passed) {
    score = Math.min(score, 60);
  }

  if (!qualityCheck.wordCountOk) {
    score = Math.min(score, 70);
  }

  const requiredFixes = dedupe(
    issues
      .filter((issue) => issue.severity !== "low")
      .map((issue) => issue.suggestion)
  );
  const optionalSuggestions = dedupe(
    issues
      .filter((issue) => issue.severity === "low")
      .map((issue) => issue.suggestion)
  );
  const passed =
    score >= 80 &&
    highIssueCount === 0 &&
    factBoundaryCheck.passed &&
    qualityCheck.wordCountOk &&
    requiredFixes.length === 0;
  const summary = passed
    ? "文章事实边界、结构质量和标题逻辑通过审核，可以进入下一阶段。"
    : "文章未通过审核，需要先完成必修修改项。";
  const finalVerdict = passed
    ? "允许进入下一阶段“封面图生成 + HTML 排版”。"
    : "不允许进入下一阶段；完成必修修改项后需要重新审核。";

  return {
    passed,
    score,
    summary,
    issues,
    requiredFixes,
    optionalSuggestions,
    factBoundaryCheck,
    qualityCheck,
    finalVerdict,
    generatedAt
  };
}

export async function reviewArticleWithReport(
  options: ReviewArticleOptions = {}
): Promise<ArticleReviewPipelineResult> {
  const logger = options.logger ?? createLogger("article-reviewer");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const articleFile = options.articleFile ?? join(outputDir, "article.md");
  const articleMetaFile =
    options.articleMetaFile ?? join(outputDir, "article-meta.json");
  const topicFactPackFile =
    options.topicFactPackFile ?? join(outputDir, "topic-fact-pack.json");
  const topicFactPackReportFile =
    options.topicFactPackReportFile ?? join(outputDir, "topic-fact-pack.md");
  const selectedTopicFile =
    options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);

  const articleMarkdown =
    options.articleMarkdown ?? (await readFile(articleFile, "utf8"));
  const articleMeta =
    options.articleMeta ?? (await readJsonFile<ArticleMeta>(articleMetaFile));
  const factPack =
    options.factPack ?? (await readJsonFile<TopicFactPack>(topicFactPackFile));
  const selectedTopic =
    options.selectedTopic ?? (await readJsonFile<SelectedTopic>(selectedTopicFile));

  if (!options.topicFactPackReport) {
    await readFile(topicFactPackReportFile, "utf8");
  }

  const review = reviewArticle(
    {
      articleMarkdown,
      articleMeta,
      factPack,
      selectedTopic
    },
    { now: options.now }
  );
  const report = createReviewReport(review);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.articleReview, review);
    await writeFile(files.articleReviewReport, report, "utf8");
  }

  logger.info(
    `Reviewed article "${articleMeta.title}" with score ${review.score}; passed=${review.passed}.`
  );

  return {
    outputDir,
    files,
    review,
    report
  };
}
