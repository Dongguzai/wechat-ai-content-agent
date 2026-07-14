import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countArticleChars } from "./writeArticle.js";
import { createChatCompletion } from "../adapters/minimax.js";
import {
  formatLlmUsage,
  mockLlmMetadata,
  realLlmMetadata,
  resolveLlmStageConfig
} from "../adapters/llm.js";
import {
  resolvePoliciesForProfile,
  type ResolvedPolicy
} from "../config/policyRegistry.js";
import type {
  ArticleMeta,
  ArticleReviewIssue,
  ArticleReviewIssueSource,
  ArticleReviewIssueType,
  ArticleReviewOutputFiles,
  ArticleReviewPipelineResult,
  ArticleReviewResult,
  ArticleReviewSeverity,
  ArticleUsedClaim
} from "../types/article.js";
import type { FactPackClaim, TopicFactPack } from "../types/factPack.js";
import type { SelectedTopic } from "../types/news.js";
import type { TopicProfile } from "../types/topicProfile.js";
import type {
  LlmChatCompletionClient,
  LlmFetch,
  LlmRunMetadata
} from "../types/llm.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { requestLlmJsonWithRepair } from "../utils/llmJson.js";

export interface ReviewArticleInput {
  articleMarkdown: string;
  articleMeta: ArticleMeta;
  factPack: TopicFactPack;
  selectedTopic: SelectedTopic;
  topicProfile?: TopicProfile;
  reviewPolicies?: ResolvedPolicy[];
}

export interface ReviewArticleOptions {
  outputDir?: string;
  articleFile?: string;
  articleMetaFile?: string;
  topicFactPackFile?: string;
  topicFactPackReportFile?: string;
  selectedTopicFile?: string;
  topicProfileFile?: string;
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  factPack?: TopicFactPack;
  topicFactPackReport?: string;
  selectedTopic?: SelectedTopic;
  topicProfile?: TopicProfile;
  reviewPolicies?: ResolvedPolicy[];
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion?: LlmChatCompletionClient;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const requiredThemes = ["事实边界", "读者影响", "风险控制", "后续观察"] as const;

interface ReviewIssueMeta {
  ruleId?: string;
  policyId?: string;
  source?: ArticleReviewIssueSource;
  blocking?: boolean;
}

interface FactBoundaryViolation {
  label: string;
  ruleId: string;
  policyId?: string;
  source: ArticleReviewIssueSource;
}

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

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }

    throw error;
  }
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

function stableRuleId(prefix: string, value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return `${prefix}.${hash.toString(36)}`;
}

function stableRuleSuffix(value: string): string {
  const id = stableRuleId("term", value);
  return id.slice(id.lastIndexOf(".") + 1);
}

function addIssue(
  issues: ArticleReviewIssue[],
  type: ArticleReviewIssueType,
  severity: ArticleReviewSeverity,
  message: string,
  evidence: string,
  suggestion: string,
  meta: ReviewIssueMeta = {}
): void {
  issues.push({
    type,
    severity,
    message,
    evidence,
    suggestion,
    ruleId: meta.ruleId ?? stableRuleId(`local.${type}`, message),
    ...(meta.policyId ? { policyId: meta.policyId } : {}),
    source: meta.source ?? "local_rule",
    blocking: meta.blocking ?? severity !== "low"
  });
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forbiddenPhraseMatches(text: string, phrase: string): boolean {
  const trimmed = phrase.trim();
  if (!trimmed) {
    return false;
  }

  const escaped = escapeRegExp(trimmed);
  const pattern = new RegExp(escaped, "gi");
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 24), index);
    if (
      !/(不写|不写成|不要写|禁止|避免|不能写|不得|不应|不等于|并不等于|不是|并非|不意味着|不要把.{0,14}写成|不能把.{0,14}写成|不得把.{0,14}写成)$/.test(
        prefix
      )
    ) {
      return true;
    }
  }

  return false;
}

function findFactBoundaryViolations(
  markdown: string,
  factPack: TopicFactPack
): FactBoundaryViolation[] {
  const checkText = stripUrls(markdown);
  const forbiddenTerms = dedupe([
    ...(factPack.claims ?? []).flatMap((claim) => claim.forbiddenWording),
    ...(factPack.unsupportedClaims ?? []).flatMap((claim) => claim.forbiddenWording),
    ...(factPack.conflictingClaims ?? []).flatMap((claim) => claim.forbiddenWording)
  ]);

  return forbiddenTerms
    .filter((term) => forbiddenPhraseMatches(checkText, term))
    .map((term) => ({
      label: `禁用表述：${term}`,
      ruleId: `fact-pack.forbidden-wording.${stableRuleSuffix(term)}`,
      source: "fact_pack" as const
    }));
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isGenericFactPack(factPack: TopicFactPack): boolean {
  return factPack.schemaVersion === "2.0";
}

function claimIsReflectedSafely(
  claim: ArticleUsedClaim,
  factPackClaim: FactPackClaim,
  markdown: string
): { passed: boolean; reason: string } {
  const text = articlePlainText(markdown);
  const forbiddenTerms = factPackClaim.forbiddenWording ?? [];
  const matchedForbidden = forbiddenTerms.find((term) =>
    forbiddenPhraseMatches(text, term)
  );

  if (matchedForbidden) {
    return {
      passed: false,
      reason: `正文出现该 claim 禁止使用的表述：“${matchedForbidden}”。`
    };
  }

  return { passed: true, reason: "未命中特定高风险 claim 规则。" };
}

function findUntrackedBodyFacts(
  markdown: string,
  usedClaims: ArticleUsedClaim[],
  allFactPackClaims: FactPackClaim[]
): string[] {
  const text = articlePlainText(markdown);
  const usedClaimIds = new Set(usedClaims.map((claim) => claim.id).filter(Boolean));
  const usedClaimTexts = new Set(usedClaims.map((claim) => claim.claim));

  return allFactPackClaims
    .filter(
      (claim) =>
        !usedClaimIds.has(claim.id) &&
        !usedClaimTexts.has(claim.claim) &&
        claim.claim.length >= 12 &&
        text.includes(claim.claim)
    )
    .map((claim) => claim.id ?? claim.claim.slice(0, 40));
}

function createQualityCheck(markdown: string, themes: readonly string[] = requiredThemes) {
  const plainText = articlePlainText(markdown);
  const wordCount = countArticleChars(markdown);
  const title = extractTitle(markdown);
  const firstPersonSignals = [
    "我认为",
    "我觉得",
    "我们认为",
    "我们觉得",
    "本人",
    "笔者",
    "亲测",
    "体验下来",
    "我的"
  ];
  const newsReleaseSignals = [
    "本公司",
    "隆重发布",
    "新闻稿",
    "记者获悉",
    "截至发稿",
    "以下简称"
  ];
  const themesCovered = themes.filter((theme) => plainText.includes(theme));

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

function findTitleForbiddenTerm(title: string, factPack: TopicFactPack): string | undefined {
  const forbiddenTerms = dedupe([
    ...(factPack.claims ?? []).flatMap((claim) => claim.forbiddenWording),
    ...(factPack.unsupportedClaims ?? []).flatMap((claim) => claim.forbiddenWording),
    ...(factPack.conflictingClaims ?? []).flatMap((claim) => claim.forbiddenWording)
  ]);

  return forbiddenTerms.find((term) => forbiddenPhraseMatches(title, term));
}

function titleMatchesBody(title: string, markdown: string): boolean {
  const plainText = articlePlainText(markdown);
  const keywords = dedupe(
    Array.from(title.matchAll(/[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9-]{2,}/g)).map(
      (match) => match[0]
    )
  ).filter((keyword) => !["为什么", "真正", "开始", "不是", "而是"].includes(keyword));

  return keywords.length === 0 || keywords.some((keyword) => plainText.includes(keyword));
}

function titleHasGenericFactOverclaim(title: string, factPack: TopicFactPack): boolean {
  if (!isGenericFactPack(factPack)) {
    return false;
  }

  return /(默认流程|写进默认|已经落地|全面落地|已经证明|官方确认|成为标准|接管流程)/.test(title);
}

function extractSupportedNumbers(claims: FactPackClaim[]): Set<string> {
  const supported = new Set<string>();
  for (const claim of claims) {
    const text = `${claim.claim} ${claim.safeWording}`;
    for (const match of text.matchAll(/(?:\$|¥|€)?\d+(?:\.\d+)?(?:\s*(?:%|美元|美金|人民币|亿元|万元|万|亿|月|年|天|小时|tokens?|次|倍|x))?/gi)) {
      supported.add(match[0].replace(/\s+/g, "").toLowerCase());
    }
  }

  return supported;
}

function extractBodyNumbers(markdown: string): string[] {
  const text = stripUrls(markdown);
  return dedupe(
    Array.from(
      text.matchAll(/(?:\$|¥|€)?\d+(?:\.\d+)?(?:\s*(?:%|美元|美金|人民币|亿元|万元|万|亿|月|年|天|小时|tokens?|次|倍|x))?/gi)
    ).map((match) => match[0].replace(/\s+/g, "").toLowerCase())
  );
}

function addPolicyIssue(
  issues: ArticleReviewIssue[],
  policy: ResolvedPolicy,
  ruleKey: string,
  severity: ArticleReviewSeverity,
  message: string,
  evidence: string,
  suggestion: string
): void {
  addIssue(issues, "policy", severity, message, evidence, suggestion, {
    ruleId: `review-policy.${policy.id}.${ruleKey}`,
    policyId: policy.id,
    source: "review_policy",
    blocking: severity !== "low"
  });
}

function policyHasRiskRule(policy: ResolvedPolicy, text: string): boolean {
  return policy.riskRules.some((rule) => rule.includes(text));
}

function anyAssertedTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => forbiddenPhraseMatches(text, term));
}

function applyReviewPolicies(input: {
  issues: ArticleReviewIssue[];
  reviewPolicies: ResolvedPolicy[];
  markdown: string;
  title: string;
  factPackClaims: FactPackClaim[];
}): void {
  const text = articlePlainText(input.markdown);
  const titleAndText = `${input.title}\n${text}`;
  const supportedNumbers = extractSupportedNumbers(input.factPackClaims);

  for (const policy of input.reviewPolicies) {
    if (policyHasRiskRule(policy, "禁止无来源数字")) {
      const unsupportedNumbers = extractBodyNumbers(input.markdown).filter(
        (number) => !supportedNumbers.has(number)
      );
      if (unsupportedNumbers.length > 0) {
        addPolicyIssue(
          input.issues,
          policy,
          "unsupported-number",
          "medium",
          "正文包含未被 fact pack claim 支撑的数字。",
          unsupportedNumbers.join(" / "),
          "删除无来源数字，或先把数字补入 fact pack claim 并完成核验。"
        );
      }
    }

    if (
      policy.id === "pricing" &&
      anyAssertedTerm(titleAndText, [
        "零成本",
        "没有任何成本",
        "永久免费",
        "完全免费且没有任何成本"
      ])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "free-tier-zero-cost",
        "high",
        "定价题把免费层或开源可用写成零成本。",
        input.title || "正文命中零成本表述。",
        "补充订阅、API、模型调用或额外用量边界，不写零成本。"
      );
    }

    if (
      policy.id === "pricing" &&
      /(API|接口|token|调用).{0,24}(订阅|套餐|会员).{0,24}(一样|等同|没有差异|同一种|混为)|(?:订阅|套餐|会员).{0,24}(API|接口|token|调用).{0,24}(一样|等同|没有差异|同一种|混为)/i.test(
        titleAndText
      )
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "subscription-api-mix",
        "medium",
        "定价题混淆订阅和 API 计费。",
        "检测到 API/订阅等同表述。",
        "分别说明订阅套餐、API 调用、额外用量和适用对象。"
      );
    }

    if (
      policy.id === "model-benchmark" &&
      anyAssertedTerm(titleAndText, [
        "全面领先",
        "碾压",
        "吊打",
        "最好",
        "第一",
        "胜出",
        "遥遥领先",
        "最强"
      ])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "benchmark-absolute-winner",
        "high",
        "Benchmark 题出现绝对胜负表达。",
        "检测到全面领先、最好、第一或类似表述。",
        "绑定具体 benchmark、指标和测试条件，避免用单项指标推出整体胜负。"
      );
    }

    if (
      policy.id === "regulation" &&
      anyAssertedTerm(titleAndText, [
        "所有地区都必须",
        "已经违法",
        "法律意见",
        "合规建议",
        "必须立即",
        "全球都要"
      ])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "jurisdiction-overgeneralization",
        "high",
        "政策题存在跨司法辖区泛化或法律意见口吻。",
        "检测到所有地区、已经违法或法律意见式表达。",
        "限定司法辖区、适用对象、生效时间和义务范围，只做信息解读。"
      );
    }

    if (
      policy.id === "security-incident" &&
      anyAssertedTerm(titleAndText, [
        "全部用户",
        "所有数据",
        "一定泄露",
        "确定泄露",
        "灾难性",
        "彻底失守"
      ])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "incident-impact-overclaim",
        "high",
        "安全事故题夸大影响范围或制造恐慌。",
        "检测到全部用户、所有数据、一定泄露或类似表述。",
        "区分确认事实、调查中信息、影响范围、数据类型和修复状态。"
      );
    }

    if (
      policy.id === "funding" &&
      anyAssertedTerm(titleAndText, ["商业成功定论", "必然上市", "估值确定", "稳赢"])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "funding-success-overclaim",
        "medium",
        "融资题把融资事件写成商业成功定论。",
        "检测到商业成功、必然上市、估值确定等表达。",
        "把融资写成资源与阶段信号，并说明估值确认状态。"
      );
    }

    if (
      policy.id === "acquisition" &&
      (/(待审批.{0,12}完成)/.test(titleAndText) ||
        anyAssertedTerm(titleAndText, ["一定会裁员", "确定关闭产品", "整合结果已定"]))
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "deal-status-overclaim",
        "medium",
        "并购题把待审批或未完成事项写成确定结果。",
        "检测到交易状态或整合结果过度确定表达。",
        "区分宣布、签署、待审批和完成，未确认整合结果只能写成可能路径。"
      );
    }

    if (
      policy.id === "product-launch" &&
      anyAssertedTerm(titleAndText, [
        "全面开放",
        "所有用户可用",
        "稳定能力",
        "正式全量可用"
      ])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "launch-availability-overclaim",
        "medium",
        "产品发布题把 preview、灰度或演示能力写成全量稳定可用。",
        "检测到全面开放、所有用户可用或稳定能力表述。",
        "说明发布状态、开放地区、开放对象和功能边界。"
      );
    }

    if (
      policy.id === "research-release" &&
      anyAssertedTerm(titleAndText, [
        "已经落地",
        "产品可用能力",
        "证明了所有",
        "必然泛化"
      ])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "research-generalization",
        "medium",
        "研究发布题把实验结果写成已经落地的产品能力。",
        "检测到已经落地、产品可用能力或过度泛化表述。",
        "补充实验设置、样本范围和局限，不把预印本或实验结果写成产品能力。"
      );
    }

    if (
      policy.id === "case-study" &&
      anyAssertedTerm(titleAndText, [
        "行业事实",
        "所有企业都适用",
        "无需人工复核",
        "一定可迁移"
      ])
    ) {
      addPolicyIssue(
        input.issues,
        policy,
        "case-study-overgeneralization",
        "medium",
        "案例题把单一案例泛化为行业事实。",
        "检测到行业事实、所有企业适用或无需人工复核表述。",
        "说明案例来源、指标口径、供应商参与程度和可迁移限制。"
      );
    }
  }
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
  if (usedClaim.id) {
    const matchedById = allFactPackClaims.find((claim) => claim.id === usedClaim.id);
    if (matchedById) {
      return matchedById;
    }
  }

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
            `- [${issue.severity}] ${issue.type}: ${issue.message}\n  - ruleId: ${issue.ruleId}\n  - policyId: ${issue.policyId ?? "none"}\n  - source: ${issue.source}\n  - blocking: ${issue.blocking ? "true" : "false"}\n  - evidence: ${issue.evidence}\n  - suggestion: ${issue.suggestion}`
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
  const reviewPolicyLines =
    (result.reviewPolicies?.length ?? 0) > 0
      ? result.reviewPolicies!.map(
          (policy) =>
            `- ${policy.id}@${policy.version}: ${policy.title} (${policy.matchReasons.join(" / ") || "no match reason"})`
        )
      : ["- 未加载动态 ReviewPolicy。"];

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
    "## 动态 ReviewPolicy",
    "",
    ...reviewPolicyLines,
    "",
    "## LLM 辅助审稿",
    "",
    `- provider: ${result.llm?.provider ?? "minimax"}`,
    `- model: ${result.llm?.model ?? "unknown"}`,
    `- mode: ${result.llm?.mode ?? "mock"}`,
    `- usage: ${result.llm ? formatLlmUsage(result.llm.usage) : "unknown"}`,
    "",
    "## 是否允许进入下一阶段",
    "",
    result.passed ? "允许进入“封面图生成 + HTML 排版”。" : "不允许进入下一阶段。",
    ""
  ].join("\n");
}

export function reviewArticle(
  input: ReviewArticleInput,
  options: { now?: Date; llm?: LlmRunMetadata } = {}
): ArticleReviewResult {
  const { articleMarkdown, articleMeta, factPack, selectedTopic } = input;
  const genericFactPack = isGenericFactPack(factPack);
  const issues: ArticleReviewIssue[] = [];
  const generatedAt = (options.now ?? new Date()).toISOString();
  const title = extractTitle(articleMarkdown);
  const bodyWithoutTitle = markdownWithoutTitle(articleMarkdown);
  const plainBody = articlePlainText(bodyWithoutTitle);
  const actualWordCount = countArticleChars(articleMarkdown);
  const reviewPolicies = input.reviewPolicies ?? [];
  const dynamicRequiredThemes =
    articleMeta.editorialPlan?.requiredThemes?.length
      ? articleMeta.editorialPlan.requiredThemes
      : [...requiredThemes];
  const qualityCheck = createQualityCheck(articleMarkdown, dynamicRequiredThemes);
  const boundaryViolations = findFactBoundaryViolations(articleMarkdown, factPack);
  const factBoundaryCheck = {
    passed: boundaryViolations.length === 0,
    violations: boundaryViolations.map((violation) => violation.label)
  };

  for (const violation of boundaryViolations) {
    addIssue(
      issues,
      "policy",
      "high",
      "文章触碰 topic-fact-pack 明确禁止的事实边界。",
      violation.label,
      "删除或降级该表述，改用 fact pack 中的 safeWording。",
      {
        ruleId: violation.ruleId,
        policyId: violation.policyId,
        source: violation.source,
        blocking: true
      }
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
  const dynamicClaims = factPack.claims ?? [];
  const allFactPackClaims: FactPackClaim[] =
    dynamicClaims.length > 0
      ? dynamicClaims.map((claim) => ({
          id: claim.id,
          claim: claim.statement,
          status: claim.status,
          sourceUrls: claim.sourceUrls,
          safeWording: claim.safeWording,
          risk: claim.status === "verified"
            ? "low"
            : claim.status === "partially_verified"
              ? "medium"
              : "high",
          evidenceIds: claim.evidenceIds,
          confidence: claim.confidence,
          requiredQualifiers: claim.requiredQualifiers,
          forbiddenWording: claim.forbiddenWording,
          riskDimensions: claim.riskDimensions
        }))
      : factPack.verifiedClaims;
  const factPackClaims = new Map<string, FactPackClaim>(
    allFactPackClaims.map((claim) => [claim.claim, claim])
  );
  const unsupportedNumbers = extractBodyNumbers(articleMarkdown).filter(
    (number) => !extractSupportedNumbers(allFactPackClaims).has(number)
  );
  if (unsupportedNumbers.length > 0) {
    addIssue(
      issues,
      "fact",
      "medium",
      "正文包含未被 fact pack claim 支撑的数字。",
      unsupportedNumbers.join(" / "),
      "删除无来源数字，或先把数字补入 topic-fact-pack 并完成核验。",
      {
        ruleId: "local.fact.unsupported-number",
        source: "fact_pack",
        blocking: true
      }
    );
  }

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

    const safeReflection = claimIsReflectedSafely(
      usedClaim,
      factPackClaim,
      articleMarkdown
    );
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

    const requiredQualifiers = factPackClaim.requiredQualifiers ?? [];
    const needsSourceQualifier = requiredQualifiers.some((qualifier) =>
      /据来源显示|据目前来源|仍需核验|需要核验/.test(qualifier)
    );
    const hasSourceQualifier = /据来源显示|据目前来源|线索显示|仍需核验|需要核验/.test(
      articleMarkdown
    );
    if (needsSourceQualifier && !hasSourceQualifier) {
      addIssue(
        issues,
        "fact",
        "medium",
        "正文缺少 usedClaim 要求的限定语。",
        `${usedClaim.claim}: required=${requiredQualifiers.join(" / ")}`,
        "恢复 fact pack requiredQualifiers 中的限定语，避免把线索写成确定事实。",
        {
          ruleId: "local.fact.required-qualifier-missing",
          source: "fact_pack",
          blocking: true
        }
      );
    }
  }

  const untrackedFacts = findUntrackedBodyFacts(
    articleMarkdown,
    usedClaims,
    allFactPackClaims
  );
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

  applyReviewPolicies({
    issues,
    reviewPolicies,
    markdown: articleMarkdown,
    title,
    factPackClaims: allFactPackClaims
  });

  {
    const regulationPolicy = reviewPolicies.find((policy) => policy.id === "regulation");
    const plainText = articlePlainText(articleMarkdown);
    const topicTitle = factPack.topicTitle ?? "";
    if (topicTitle.includes("伊利诺伊") && !plainText.includes("伊利诺伊")) {
      if (regulationPolicy) {
        addPolicyIssue(
          issues,
          regulationPolicy,
          "jurisdiction-missing",
          "medium",
          "政策题缺少司法辖区边界。",
          "原选题包含伊利诺伊州，但正文未保留该辖区。",
          "恢复州级或具体司法辖区表述，不能把州法写成泛化政策。"
        );
      } else {
        addIssue(
          issues,
          "policy",
          "medium",
          "政策题缺少司法辖区边界。",
          "原选题包含伊利诺伊州，但正文未保留该辖区。",
          "恢复州级或具体司法辖区表述，不能把州法写成泛化政策。",
          {
            ruleId: "local.policy.jurisdiction-missing",
            source: "local_rule",
            blocking: true
          }
        );
      }
    }
    if (/所有\s*AI\s*公司|全部\s*AI\s*公司|全球都要|必须立即照此执行/.test(plainText)) {
      if (regulationPolicy) {
        addPolicyIssue(
          issues,
          regulationPolicy,
          "covered-entity-overgeneralization",
          "medium",
          "政策题把适用对象或司法辖区泛化。",
          "检测到所有 AI 公司、全球都要或必须立即照此执行等表述。",
          "恢复法案适用对象和辖区边界，不能扩展为所有公司或全球义务。"
        );
      } else {
        addIssue(
          issues,
          "policy",
          "medium",
          "政策题把适用对象或司法辖区泛化。",
          "检测到所有 AI 公司、全球都要或必须立即照此执行等表述。",
          "恢复法案适用对象和辖区边界，不能扩展为所有公司或全球义务。",
          {
            ruleId: "local.policy.covered-entity-overgeneralization",
            source: "local_rule",
            blocking: true
          }
        );
      }
    }
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
    const requiredThemeText = dynamicRequiredThemes.join(" / ");
    addIssue(
      issues,
      "structure",
      "medium",
      "文章核心主题覆盖不足。",
      `当前覆盖：${qualityCheck.themesCovered.join(" / ") || "无"}`,
      `至少解释“${requiredThemeText}”中的 3 个主题。`
    );
  }

  const hasClearPoint =
    Boolean(articleMeta.articleThesis?.trim()) &&
    /(真正|更稳|判断|主战场|重点|不是.+而是|转向|控制权|边界|影响)/.test(
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
  const openingPattern = genericFactPack
    ? /(但|不是.+而是|问题|边界|风险|需要|不能|值得观察|差异|成本|工作流)/
    : /(冲突|一边.+另一边|但|不是.+而是|问题|价格)/;
  if (!openingPattern.test(opening)) {
    addIssue(
      issues,
      "logic",
      "medium",
      "开头没有建立清晰冲突。",
      opening || "开头为空。",
      genericFactPack
        ? "在开头交代来源线索和事实边界之间的张力，并说明为什么会影响工作流、成本或风险判断。"
        : "在开头交代事实线索、读者影响和风险边界之间的冲突。"
    );
  }

  const middleStart = Math.floor(plainBody.length / 3);
  const middle = plainBody.slice(middleStart, middleStart + Math.floor(plainBody.length / 3));
  const dynamicMiddleSignals =
    articleMeta.editorialPlan?.requiredThemes.filter((theme) => middle.includes(theme)) ?? [];
  const middleExplainsDynamicPlan =
    Boolean(articleMeta.editorialPlan) &&
    (dynamicMiddleSignals.length > 0 ||
      /(影响|边界|风险|读者|团队|产品|研究|政策|价格|融资|案例|验证|核验|观察)/.test(middle));
  if (
    !middleExplainsDynamicPlan &&
    !/(行业|变化|竞争|基础设施|产品竞争|工作流|成本结构|入口|边界|风险|治理|影响)/.test(middle)
  ) {
    addIssue(
      issues,
      "logic",
      "medium",
      "中段没有充分解释行业变化。",
      middle.slice(0, 120),
      genericFactPack
        ? "在中段解释这条资讯对模型能力、工作流、成本结构、风险治理或读者决策的影响。"
        : "在中段解释产品、模型能力、成本结构或流程治理的变化。"
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
  const titleSignalPattern = genericFactPack
    ? /(不是|而是|真正|为什么|开始|重新|工作流|安全|评测|方法|流程|团队|开发者|风险|边界)/
    : /(不是|而是|真正|为什么|开始|重新|成本|工作流|价格|边界|风险|影响)/;
  if (titleLength < 8 || titleLength > 36 || !titleSignalPattern.test(title)) {
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

  const titleForbiddenTerm = findTitleForbiddenTerm(title, factPack);
  if (titleForbiddenTerm) {
    addIssue(
      issues,
      "title",
      "high",
      "标题命中 fact pack 禁止表述。",
      titleForbiddenTerm,
      "改用 fact pack safeWording 中允许的限定表达。",
      {
        ruleId: `fact-pack.title-forbidden.${stableRuleSuffix(titleForbiddenTerm)}`,
        source: "fact_pack",
        blocking: true
      }
    );
  }

  if (titleHasGenericFactOverclaim(title, factPack)) {
    addIssue(
      issues,
      "title",
      "medium",
      "标题把通用资讯线索写成确定性落地结论。",
      title,
      "把标题降级为方法、线索、风险边界或工作流影响，不写默认流程、已经落地、官方确认。"
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

  const blockingIssues = issues.filter((issue) => issue.blocking);
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
      .filter((issue) => issue.blocking)
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
    blockingIssues.length === 0;
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
    reviewPolicies: reviewPolicies.map((policy) => ({
      id: policy.id,
      version: policy.version,
      title: policy.title,
      sourcePath: policy.sourcePath,
      matchReasons: policy.matchReasons
    })),
    ...(options.llm ? { llm: options.llm } : {}),
    finalVerdict,
    generatedAt
  };
}

function createReviewerSystemPrompt(): string {
  return [
    "你是公众号文章辅助审稿人。",
    "只返回 JSON。",
    "不要 Markdown。",
    "不要解释。",
    "不要代码块。",
    "不要前后缀文本。",
    "不要输出 <think> 或任何思考过程。",
    "必须符合给定字段结构。",
    "中文内容放在 JSON 字段值里。",
    "你只能辅助发现风险，不能放宽本地硬规则。",
    "重点检查事实边界、标题党、第一人称、通稿口吻、过度推导和 forbidden terms。"
  ].join("\n");
}

const articleReviewerExpectedJsonShape = JSON.stringify(
  {
    passed: true,
    score: 88,
    summary: "简短总结",
    issues: [
      {
        severity: "low",
        message: "问题",
        suggestion: "建议"
      }
    ],
    factBoundaryCheck: {
      passed: true,
      violations: []
    },
    qualityCheck: {
      wordCountOk: true,
      hasTitle: true,
      hasHeadings: true,
      thirdPersonPerspective: true,
      notNewsRelease: true,
      themesCovered: ["事实边界", "读者影响", "风险控制"]
    }
  },
  null,
  2
);

function createReviewerUserPrompt(input: ReviewArticleInput): string {
  return [
    "请辅助审稿。",
    "只返回 JSON，不要 Markdown，不要解释，不要代码块，不要前后缀文本，不要输出 <think> 或任何思考过程。",
    "必须包含 passed、score、issues、factBoundaryCheck、qualityCheck。",
    "中文内容放在 JSON 字段值里。",
    "返回 JSON 结构：",
    articleReviewerExpectedJsonShape,
    "",
    "article.md:",
    input.articleMarkdown,
    "",
    "article-meta.json:",
    JSON.stringify(input.articleMeta, null, 2),
    "",
    "topic-fact-pack.json:",
    JSON.stringify(input.factPack, null, 2),
    "",
    "selected-topic.json:",
    JSON.stringify(input.selectedTopic, null, 2)
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateArticleReviewerPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("MiniMax article-reviewer response must be a JSON object.");
  }

  if (typeof value.passed !== "boolean") {
    throw new Error("MiniMax article-reviewer response is missing boolean passed.");
  }

  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    throw new Error("MiniMax article-reviewer response is missing number score.");
  }

  if (!Array.isArray(value.issues)) {
    throw new Error("MiniMax article-reviewer response is missing issues array.");
  }

  if (!isRecord(value.factBoundaryCheck)) {
    throw new Error("MiniMax article-reviewer response is missing factBoundaryCheck.");
  }

  if (!isRecord(value.qualityCheck)) {
    throw new Error("MiniMax article-reviewer response is missing qualityCheck.");
  }

  return value;
}

function auxiliaryReviewerFoundBlockingIssue(value: unknown): {
  found: boolean;
  summary: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { found: false, summary: "" };
  }

  const record = value as Record<string, unknown>;
  const passed = record.passed === true;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const issues = Array.isArray(record.issues) ? record.issues : [];
  const severeIssue = issues.find((issue) => {
    if (typeof issue !== "object" || issue === null || Array.isArray(issue)) {
      return false;
    }

    const severity = (issue as Record<string, unknown>).severity;
    return severity === "medium" || severity === "high";
  });

  if (passed && !severeIssue) {
    return { found: false, summary };
  }

  if (typeof severeIssue === "object" && severeIssue !== null) {
    const issue = severeIssue as Record<string, unknown>;
    const message = typeof issue.message === "string" ? issue.message : "MiniMax 辅助审稿提示需要复核。";
    const suggestion =
      typeof issue.suggestion === "string" ? issue.suggestion : "人工复核该辅助审稿意见。";
    return {
      found: true,
      summary: `${message} ${suggestion}`.trim()
    };
  }

  return {
    found: !passed,
    summary: summary || "MiniMax 辅助审稿认为文章需要人工复核。"
  };
}

async function runMiniMaxAuxiliaryReview(input: {
  outputDir: string;
  reviewInput: ReviewArticleInput;
  env: NodeJS.ProcessEnv;
  fetchImpl?: LlmFetch;
  chatCompletion: LlmChatCompletionClient;
}): Promise<{
  llm: LlmRunMetadata;
  blockingSummary: string | null;
}> {
  const config = resolveLlmStageConfig("article-reviewer", input.env);
  const { value: payload, completion } = await requestLlmJsonWithRepair({
    failedStep: "article-reviewer",
    outputDir: input.outputDir,
    config,
    systemPrompt: createReviewerSystemPrompt(),
    userPrompt: createReviewerUserPrompt(input.reviewInput),
    expectedJsonShape: articleReviewerExpectedJsonShape,
    env: input.env,
    fetchImpl: input.fetchImpl,
    chatCompletion: input.chatCompletion,
    validate: validateArticleReviewerPayload
  });
  const auxiliary = auxiliaryReviewerFoundBlockingIssue(payload);

  return {
    llm: realLlmMetadata(completion, "rules+real"),
    blockingSummary: auxiliary.found ? auxiliary.summary : null
  };
}

function applyAuxiliaryReview(
  review: ArticleReviewResult,
  input: {
    llm: LlmRunMetadata;
    blockingSummary: string | null;
  }
): ArticleReviewResult {
  if (!input.blockingSummary) {
    return {
      ...review,
      llm: input.llm
    };
  }

  const issues: ArticleReviewIssue[] = [
    ...review.issues,
    {
      type: "logic",
      severity: "medium",
      message: "MiniMax 辅助审稿提示需要人工复核。",
      evidence: input.blockingSummary,
      suggestion: "人工复核 MiniMax 辅助审稿意见，必要时修改正文后重新审核。",
      ruleId: "auxiliary-llm.article-reviewer.blocking-summary",
      source: "auxiliary_llm",
      blocking: false
    }
  ];
  const optionalSuggestions = dedupe([
    ...review.optionalSuggestions,
    "人工复核 MiniMax 辅助审稿意见，必要时修改正文后重新审核。"
  ]);

  return {
    ...review,
    issues,
    optionalSuggestions,
    llm: input.llm,
    finalVerdict: review.finalVerdict
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
  const topicProfileFile =
    options.topicProfileFile ?? join(outputDir, "topic-profile.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const env = options.env ?? process.env;
  const llmConfig = resolveLlmStageConfig("article-reviewer", env);
  const chatCompletion = options.chatCompletion ?? createChatCompletion;

  const articleMarkdown =
    options.articleMarkdown ?? (await readFile(articleFile, "utf8"));
  const articleMeta =
    options.articleMeta ?? (await readJsonFile<ArticleMeta>(articleMetaFile));
  const factPack =
    options.factPack ?? (await readJsonFile<TopicFactPack>(topicFactPackFile));
  const selectedTopic =
    options.selectedTopic ?? (await readJsonFile<SelectedTopic>(selectedTopicFile));
  const topicProfile =
    options.topicProfile ?? (await readOptionalJsonFile<TopicProfile>(topicProfileFile));
  const reviewPolicies =
    options.reviewPolicies ??
    (topicProfile
      ? await resolvePoliciesForProfile(topicProfile, {
          scopes: ["review"],
          now: options.now
        })
      : []);

  if (!options.topicFactPackReport) {
    await readFile(topicFactPackReportFile, "utf8");
  }

  const reviewInput = {
    articleMarkdown,
    articleMeta,
    factPack,
    selectedTopic,
    ...(topicProfile ? { topicProfile } : {}),
    reviewPolicies
  };
  const baseReview = reviewArticle(reviewInput, { now: options.now });
  const review =
    llmConfig.mode === "real"
      ? applyAuxiliaryReview(
          baseReview,
          await runMiniMaxAuxiliaryReview({
            outputDir,
            reviewInput,
            env,
            fetchImpl: options.fetchImpl,
            chatCompletion
          })
        )
      : {
          ...baseReview,
          llm: mockLlmMetadata(llmConfig)
        };
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
