import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatLlmUsage } from "../adapters/llm.js";
import type { ArticleMeta } from "../types/article.js";
import type { CoverPipelineResult, CoverResult, CoverReviewResult } from "../types/cover.js";
import type { EditorialBrief } from "../types/editorial.js";
import type { TopicFactPack } from "../types/factPack.js";
import type { TopicProfile } from "../types/topicProfile.js";
import type { ResearchPlan } from "../types/researchPlan.js";
import type { SourceEvidence } from "../types/sourceEvidence.js";
import type { EditorialPlan } from "../types/editorialPlan.js";
import type {
  DailyPipelineArtifacts,
  DailyPipelineResult,
  PipelineOutputFiles
} from "../types/pipeline.js";
import type {
  NormalizedNewsItem,
  SelectedTopic,
  ShortlistedNewsItem
} from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { buildTopicFactPack } from "./buildTopicFactPack.js";
import { buildEditorialPlan } from "./buildEditorialPlan.js";
import { buildResearchPlan } from "./buildResearchPlan.js";
import { classifyTopicWithReport } from "./classifyTopic.js";
import { collectSourceEvidence } from "./collectSourceEvidence.js";
import { checkSourceHealthWithReport } from "./checkSourceHealth.js";
import { collectNewsWithReport } from "./collectNews.js";
import { generateCoverWithReport, reviewCover } from "./generateCover.js";
import { generateEditorialBrief } from "./generateEditorialBrief.js";
import { generateTitlesWithReport } from "./generateTitles.js";
import { loadEditorialApproval, resolveEditorialApprovalForTopic } from "./loadEditorialApproval.js";
import { loadEditorialFeedback } from "./loadEditorialFeedback.js";
import { loadEditorialStyle } from "./loadEditorialStyle.js";
import { loadManualTopic } from "./loadManualTopic.js";
import { renderWechatHtmlWithReport } from "./renderWechatHtml.js";
import { reviewArticleWithReport } from "./reviewArticle.js";
import { saveWechatDraftWithReport } from "./saveWechatDraft.js";
import {
  selectManualTopicWithReport,
  selectTopicWithReport
} from "./selectTopic.js";
import { shortlistNewsWithReport } from "./shortlistNews.js";
import { writeArticleWithReport } from "./writeArticle.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type RunDailyUntilStage = "brief" | "topic";
export type RunDailyFromStage = "article" | "layout";

export interface RunDailyPipelineOptions {
  outputDir?: string;
  logger?: Logger;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  useMockRss?: boolean;
  manualTopicFile?: string;
  approvalFile?: string;
  until?: RunDailyUntilStage;
  from?: RunDailyFromStage;
}

interface ReportInput {
  outputDir: string;
  files: PipelineOutputFiles;
  artifacts: DailyPipelineArtifacts;
  currentStage: string;
  stoppedAt: string;
  nextCommand: string;
  collectionStats?: DailyPipelineResult["collectionStats"];
  shortlistStats?: DailyPipelineResult["shortlistStats"];
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultOutputDir = join(projectRoot, "outputs");

function createOutputFiles(outputDir: string): PipelineOutputFiles {
  return {
    sourceHealth: join(outputDir, "source-health.json"),
    sourceHealthReport: join(outputDir, "source-health-report.md"),
    rawNews: join(outputDir, "raw-news.json"),
    normalizedNews: join(outputDir, "normalized-news.json"),
    rejectedNews: join(outputDir, "rejected-news.json"),
    candidateNews: join(outputDir, "candidate-news.json"),
    collectionReport: join(outputDir, "collection-report.md"),
    shortlistedNews: join(outputDir, "shortlisted-news.json"),
    shortlistReport: join(outputDir, "shortlist-report.md"),
    selectedTopic: join(outputDir, "selected-topic.json"),
    topicSelectionReport: join(outputDir, "topic-selection-report.md"),
    editorialBrief: join(outputDir, "editorial-brief.md"),
    editorialBriefJson: join(outputDir, "editorial-brief.json"),
    topicProfileJson: join(outputDir, "topic-profile.json"),
    topicProfileReport: join(outputDir, "topic-profile-report.md"),
    researchPlanJson: join(outputDir, "research-plan.json"),
    researchPlanReport: join(outputDir, "research-plan-report.md"),
    sourceEvidenceJson: join(outputDir, "source-evidence.json"),
    sourceEvidenceReport: join(outputDir, "source-evidence-report.md"),
    editorialPlanJson: join(outputDir, "editorial-plan.json"),
    editorialPlanReport: join(outputDir, "editorial-plan.md"),
    topicFactPackJson: join(outputDir, "topic-fact-pack.json"),
    topicFactPackReport: join(outputDir, "topic-fact-pack.md"),
    article: join(outputDir, "article.md"),
    articleMeta: join(outputDir, "article-meta.json"),
    articleWritingReport: join(outputDir, "article-writing-report.md"),
    titleCandidates: join(outputDir, "title-candidates.json"),
    titleSelectionReport: join(outputDir, "title-selection-report.md"),
    articleReview: join(outputDir, "article-review.json"),
    articleReviewReport: join(outputDir, "article-review-report.md"),
    cover: join(outputDir, "cover.json"),
    coverPrompt: join(outputDir, "cover-prompt.md"),
    coverReview: join(outputDir, "cover-review.json"),
    coverImageDir: join(outputDir, "covers"),
    wechatHtml: join(outputDir, "wechat.html"),
    wechatLayout: join(outputDir, "wechat-layout.json"),
    wechatLayoutReport: join(outputDir, "wechat-layout-report.md"),
    wechatDraftResult: join(outputDir, "wechat-draft-result.json"),
    wechatDraftReport: join(outputDir, "wechat-draft-report.md"),
    wechatApiDraftResult: join(outputDir, "wechat-api-draft-result.json"),
    wechatApiDraftReport: join(outputDir, "wechat-api-draft-report.md"),
    wechatApiPreflight: join(outputDir, "wechat-api-preflight.json"),
    dailyReport: join(outputDir, "daily-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function asEditorialApproval(input: DailyPipelineArtifacts["editorialApproval"]) {
  return input
    ? {
        approvedByUser: input.approvedByUser,
        approvedTopicId: input.approvedTopicId,
        approvedTitle: input.approvedTitle,
        notes: input.notes
      }
    : undefined;
}

function requireDynamicArtifact<T extends { topicId: string }>(
  value: T | undefined,
  fileName: string,
  expectedTopicId: string
): T {
  if (!value) {
    throw new Error(
      `Missing ${fileName}; run pnpm run:daily -- --from article to rebuild dynamic content artifacts before --from layout.`
    );
  }

  if (value.topicId !== expectedTopicId) {
    throw new Error(
      `${fileName} topicId mismatch: expected ${expectedTopicId}, got ${value.topicId}. Re-run pnpm run:daily -- --from article to avoid cross-topic artifact reuse.`
    );
  }

  return value;
}

function assertLayoutDynamicArtifacts(input: {
  selectedTopic: SelectedTopic;
  topicProfile?: TopicProfile;
  researchPlan?: ResearchPlan;
  sourceEvidence?: SourceEvidence;
  editorialPlan?: EditorialPlan;
  factPack: TopicFactPack;
  articleMeta: ArticleMeta;
}): {
  topicProfile: TopicProfile;
  researchPlan: ResearchPlan;
  sourceEvidence: SourceEvidence;
  editorialPlan: EditorialPlan;
} {
  const expectedTopicId = input.selectedTopic.selected.id;
  const topicProfile = requireDynamicArtifact(
    input.topicProfile,
    "topic-profile.json",
    expectedTopicId
  );
  const researchPlan = requireDynamicArtifact(
    input.researchPlan,
    "research-plan.json",
    expectedTopicId
  );
  const sourceEvidence = requireDynamicArtifact(
    input.sourceEvidence,
    "source-evidence.json",
    expectedTopicId
  );
  const editorialPlan = requireDynamicArtifact(
    input.editorialPlan,
    "editorial-plan.json",
    expectedTopicId
  );

  if (input.factPack.topicId !== expectedTopicId) {
    throw new Error(
      `topic-fact-pack.json topicId mismatch: expected ${expectedTopicId}, got ${input.factPack.topicId}. Re-run pnpm run:daily -- --from article.`
    );
  }

  if (
    input.articleMeta.editorialPlan?.id &&
    input.articleMeta.editorialPlan.id !== editorialPlan.id
  ) {
    throw new Error(
      `article-meta.json editorialPlan.id mismatch: expected ${editorialPlan.id}, got ${input.articleMeta.editorialPlan.id}. Re-run pnpm run:daily -- --from article.`
    );
  }

  return {
    topicProfile,
    researchPlan,
    sourceEvidence,
    editorialPlan
  };
}

async function reuseExistingCoverIfAvailable(
  outputDir: string,
  logger: Logger
): Promise<CoverPipelineResult | undefined> {
  const files = {
    cover: join(outputDir, "cover.json"),
    coverPrompt: join(outputDir, "cover-prompt.md"),
    coverReview: join(outputDir, "cover-review.json"),
    coverImageDir: join(outputDir, "covers")
  };

  try {
    const [cover, review] = await Promise.all([
      readJsonFile<CoverResult>(files.cover),
      readJsonFile<CoverReviewResult>(files.coverReview)
    ]);

    if (!review.passed || cover.imagePath !== review.imagePath) {
      return undefined;
    }

    logger.info(`Reusing existing cover artifacts; image=${cover.imagePath}.`);
    return {
      outputDir,
      files,
      cover,
      review,
      promptMarkdown: await readFile(files.coverPrompt, "utf8").catch(() => "")
    };
  } catch {
    return undefined;
  }
}

async function imagePathAvailable(imagePath: string): Promise<boolean> {
  if (imagePath.startsWith("mock://")) {
    return true;
  }

  return pathExists(imagePath);
}

async function reviewExistingCoverWithReport(input: {
  outputDir: string;
  files: PipelineOutputFiles;
  cover: CoverResult;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  now?: Date;
}): Promise<CoverPipelineResult> {
  const realApiEnabled =
    input.env?.COVER_ENABLE_REAL_API?.trim().toLowerCase() === "true";
  const review = reviewCover(input.cover, {
    imagePathAvailable: await imagePathAvailable(input.cover.imagePath),
    realApiEnabled,
    now: input.now
  });
  input.cover.review = {
    passed: review.passed,
    issues: review.issues,
    riskNotes: review.riskNotes
  };
  const promptMarkdown = await readFile(input.files.coverPrompt, "utf8").catch(
    () => "# Existing Cover Review\n"
  );

  await writeJson(input.files.cover, input.cover);
  await writeJson(input.files.coverReview, review);
  input.logger.info(
    `Reviewed existing cover; passed=${review.passed}; image=${input.cover.imagePath}.`
  );

  return {
    outputDir: input.outputDir,
    files: {
      cover: input.files.cover,
      coverPrompt: input.files.coverPrompt,
      coverReview: input.files.coverReview,
      coverImageDir: input.files.coverImageDir
    },
    cover: input.cover,
    review,
    promptMarkdown
  };
}

function createApprovalLines(artifacts: DailyPipelineArtifacts): string[] {
  const approval = artifacts.editorialApproval;

  return [
    `- approvalRequired: true`,
    `- editorialBriefGenerated: ${artifacts.editorialBrief ? "yes" : "no"}`,
    `- editorialApprovalRead: ${approval?.approvalRead ? "yes" : "no"}`,
    `- approvedByUser: ${approval?.approvedByUser ? "true" : "false"}`,
    `- approvedTopicId: ${approval?.approvedTopicId || "none"}`,
    `- approvedTitle: ${approval?.approvedTitle || "none"}`,
    `- approvalMatchedTopicKind: ${approval?.matchedTopicKind ?? "none"}`,
    `- aiRecommendedTopicId: ${approval?.aiRecommendedTopicId ?? "none"}`,
    `- userApprovedTopicId: ${approval?.userApprovedTopicId ?? approval?.approvedTopicId ?? "none"}`,
    `- userChangedTopic: ${approval?.userChangedTopic ? "yes" : "no"}`,
    `- approvalNotes: ${approval?.notes || "none"}`,
    `- approvalBlockedReason: ${approval?.blockedReason ?? "none"}`
  ];
}

function createDailyReport(input: ReportInput): string {
  const { artifacts, collectionStats, files, outputDir, shortlistStats } = input;
  const selected = artifacts.selectedTopic?.selected;
  const titleSelection = artifacts.titleSelection;
  const articleReview = artifacts.articleReview;
  const coverReview = artifacts.coverReview;
  const layout = artifacts.wechatLayout;
  const draft = artifacts.wechatDraft;
  const nextLines =
    input.stoppedAt === "brief"
      ? [
          "下一步：",
          "请查看 outputs/editorial-brief.md。",
          "如确认选题，请编辑 inputs/editorial-approval.json，将 approvedByUser 设为 true。",
          "然后运行：",
          "pnpm run:daily -- --from article"
        ]
      : ["下一步：", input.nextCommand];

  return [
    "# Daily AI Content Pipeline Report",
    "",
    `Output directory: ${outputDir}`,
    "",
    "## Stage",
    "",
    `- currentStage: ${input.currentStage}`,
    `- stoppedAt: ${input.stoppedAt}`,
    `- nextCommand: ${input.nextCommand}`,
    ...createApprovalLines(artifacts),
    "",
    "## Summary",
    "",
    `- Candidate news: ${artifacts.candidates?.length ?? "not loaded"}`,
    `- Shortlisted news: ${artifacts.shortlisted?.length ?? "not loaded"}`,
    `- Selected topic: ${selected?.title ?? "not selected"}`,
    `- Selected topic id: ${selected?.id ?? "none"}`,
    `- Selected source reliability: ${selected?.selection.sourceReliability ?? "unknown"}`,
    `- Topic profile: ${artifacts.topicProfile ? `${artifacts.topicProfile.primaryDomain} / ${artifacts.topicProfile.recommendedContentMode}` : "not run"}`,
    `- Research plan tasks: ${artifacts.researchPlan?.tasks.length ?? "not run"}`,
    `- Source evidence items: ${artifacts.sourceEvidence?.items.length ?? "not run"}`,
    `- Editorial style read: ${artifacts.editorialStyle?.loaded ? "yes" : "no"}`,
    `- Feedback read: ${artifacts.editorialFeedback?.feedbackRead ? "yes" : "no"}`,
    `- Source health passed: ${artifacts.sourceHealth?.passed ? "yes" : "not checked"}`,
    `- Article generated: ${artifacts.article ? "yes" : "no"}`,
    `- Writer LLM: ${
      artifacts.articleMeta?.llm
        ? `${artifacts.articleMeta.llm.provider} / ${artifacts.articleMeta.llm.model} / ${artifacts.articleMeta.llm.mode} (${formatLlmUsage(artifacts.articleMeta.llm.usage)})`
        : "not run"
    }`,
    `- Title candidates generated: ${artifacts.titleCandidates?.length ?? 0}`,
    `- Final title: ${titleSelection?.selectedTitle ?? "not generated"}`,
    `- Article review passed: ${articleReview ? (articleReview.passed ? "yes" : "no") : "not run"}`,
    `- Cover review passed: ${coverReview ? (coverReview.passed ? "yes" : "no") : "not run"}`,
    `- WeChat HTML compatible: ${layout ? (layout.compatibleWithWechat ? "yes" : "no") : "not run"}`,
    `- WeChat draft dry-run status: ${draft?.status ?? "not run"}`,
    `- WeChat official API preflight: ${artifacts.wechatApiPreflight ? (artifacts.wechatApiPreflight.passed ? "passed" : "blocked") : "not run in this stage"}`,
    `- RSS shortlisted: ${shortlistStats?.rssShortlistedCount ?? "not loaded"}`,
    `- global_search shortlisted: ${shortlistStats?.globalSearchShortlistedCount ?? "not loaded"}`,
    `- Collection API real call: ${collectionStats ? (collectionStats.apiRealCall ? "yes" : "no") : "not loaded"}`,
    "",
    "## Output Files",
    "",
    `- candidate-news.json: ${files.candidateNews}`,
    `- shortlisted-news.json: ${files.shortlistedNews}`,
    `- selected-topic.json: ${files.selectedTopic}`,
    `- editorial-brief.md: ${files.editorialBrief}`,
    `- editorial-brief.json: ${files.editorialBriefJson}`,
    `- topic-profile.json: ${files.topicProfileJson}`,
    `- research-plan.json: ${files.researchPlanJson}`,
    `- source-evidence.json: ${files.sourceEvidenceJson}`,
    `- topic-fact-pack.json: ${files.topicFactPackJson}`,
    `- article.md: ${files.article}`,
    `- article-meta.json: ${files.articleMeta}`,
    `- title-candidates.json: ${files.titleCandidates}`,
    `- article-review.json: ${files.articleReview}`,
    `- cover.json: ${files.cover}`,
    `- cover-review.json: ${files.coverReview}`,
    `- wechat.html: ${files.wechatHtml}`,
    `- wechat-layout.json: ${files.wechatLayout}`,
    `- wechat-draft-result.json: ${files.wechatDraftResult}`,
    `- wechat-api-preflight.json: ${files.wechatApiPreflight}`,
    `- daily-report.md: ${files.dailyReport}`,
    "",
    "## Next Step",
    "",
    ...nextLines,
    "",
    "## Safety Notes",
    "",
    "- 系统不会自动发布。",
    "- 系统不会自动群发。",
    "- 没有人工确认选题，不会写文章。",
    "- run:daily --from article 只生成到 mock 草稿 dry-run，不真实写入公众号草稿。",
    "- 真实草稿仍需手动执行 preflight:final 和 wechat:draft:real，且只允许官方 draft/add。",
    "- 未打开微信公众号后台。",
    "- 未点击发布、群发、确认发送或立即发送。",
    ""
  ].join("\n");
}

async function writeReport(input: ReportInput): Promise<void> {
  await writeFile(input.files.dailyReport, createDailyReport(input), "utf8");
}

async function runBriefStage(input: {
  outputDir: string;
  files: PipelineOutputFiles;
  logger: Logger;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  useMockRss?: boolean;
  manualTopicFile?: string;
}): Promise<Omit<DailyPipelineResult, "durationMs">> {
  const { outputDir, files, logger } = input;
  const editorialStyle = await loadEditorialStyle({ logger });
  const editorialFeedback = await loadEditorialFeedback({ logger });
  const manualTopic = await loadManualTopic({
    manualTopicFile: input.manualTopicFile,
    logger
  });

  logger.info("1/4 checkSourceHealth: probing RSS/search readiness.");
  const sourceHealth = await checkSourceHealthWithReport({
    outputDir,
    logger,
    fetchImpl: input.fetchImpl,
    env: input.env,
    now: input.now
  });

  if (!sourceHealth.passed) {
    throw new Error(`Source health blocked: ${sourceHealth.issues.join(" ")}`);
  }

  logger.info("2/4 collectNews: building the 20-item candidate pool.");
  const collection = await collectNewsWithReport({
    outputDir,
    logger,
    fetchImpl: input.fetchImpl,
    env: input.env,
    now: input.now,
    useMockRss: input.useMockRss
  });

  logger.info("3/4 shortlistNews and selectTopic: preparing editor choices.");
  const shortlist = await shortlistNewsWithReport({
    outputDir,
    candidates: collection.candidates,
    logger,
    writeOutputs: true
  });
  const topicSelection = manualTopic.used
    ? await selectManualTopicWithReport({
        outputDir,
        shortlisted: shortlist.shortlisted,
        manualTopic,
        editorialStyle,
        feedback: editorialFeedback,
        logger,
        writeOutputs: true,
        now: input.now
      })
    : await selectTopicWithReport({
        outputDir,
        shortlisted: shortlist.shortlisted,
        editorialStyle,
        feedback: editorialFeedback,
        logger,
        writeOutputs: true,
        now: input.now
      });

  logger.info("4/4 generateEditorialBrief: writing editor-facing brief.");
  const editorialBrief = await generateEditorialBrief({
    outputDir,
    candidates: collection.candidates,
    shortlisted: shortlist.shortlisted,
    selectedTopic: topicSelection.topic,
    logger,
    writeOutputs: true,
    now: input.now
  });
  const approval = await loadEditorialApproval({ logger });
  const artifacts: DailyPipelineArtifacts = {
    candidates: collection.candidates,
    shortlisted: shortlist.shortlisted,
    selectedTopic: topicSelection.topic,
    manualTopic,
    editorialStyle,
    editorialFeedback,
    editorialBrief: editorialBrief.brief,
    editorialApproval: approval,
    sourceHealth
  };
  const partial = {
    outputDir,
    files,
    artifacts,
    currentStage: "brief",
    stoppedAt: "brief",
    nextCommand: "pnpm run:daily -- --from article",
    collectionStats: collection.stats,
    shortlistStats: shortlist.stats
  };

  await writeReport(partial);
  return partial;
}

async function loadBriefArtifactsForArticle(input: {
  files: PipelineOutputFiles;
}): Promise<{
  candidates: NormalizedNewsItem[];
  shortlisted: ShortlistedNewsItem[];
  selectedTopic: SelectedTopic;
}> {
  const [candidates, shortlisted, selectedTopic] = await Promise.all([
    readJsonFile<NormalizedNewsItem[]>(input.files.candidateNews),
    readJsonFile<ShortlistedNewsItem[]>(input.files.shortlistedNews),
    readJsonFile<SelectedTopic>(input.files.selectedTopic)
  ]);

  return { candidates, shortlisted, selectedTopic };
}

async function runArticleStage(input: {
  outputDir: string;
  files: PipelineOutputFiles;
  logger: Logger;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  approvalFile?: string;
}): Promise<Omit<DailyPipelineResult, "durationMs">> {
  const { outputDir, files, logger } = input;
  const [editorialStyle, editorialFeedback, briefArtifacts] = await Promise.all([
    loadEditorialStyle({ logger }),
    loadEditorialFeedback({ logger }),
    loadBriefArtifactsForArticle({ files })
  ]);
  const resolvedApproval = await resolveEditorialApprovalForTopic({
    selectedTopic: briefArtifacts.selectedTopic,
    shortlisted: briefArtifacts.shortlisted,
    approvalFile: input.approvalFile,
    outputSelectedTopicFile: files.selectedTopic,
    logger
  });
  const selectedTopic = resolvedApproval.topic;
  const editorialApproval = resolvedApproval.approval;
  const existingBrief = await readOptionalJsonFile<EditorialBrief>(
    files.editorialBriefJson
  );

  logger.info("1/8 classifyTopic: building approved topic profile.");
  const topicProfile = await classifyTopicWithReport({
    outputDir,
    topic: selectedTopic,
    logger,
    env: input.env,
    fetchImpl: input.fetchImpl,
    writeOutputs: true,
    now: input.now
  });

  logger.info("2/10 buildResearchPlan: planning topic-specific evidence tasks.");
  const researchPlan = await buildResearchPlan({
    outputDir,
    topicProfile: topicProfile.profile,
    logger,
    writeOutputs: true,
    now: input.now
  });

  logger.info("3/10 collectSourceEvidence: recording source metadata boundaries.");
  const sourceEvidence = await collectSourceEvidence({
    outputDir,
    selectedTopic,
    researchPlan: researchPlan.plan,
    logger,
    env: input.env,
    fetchImpl: input.fetchImpl,
    writeOutputs: true,
    now: input.now
  });

  logger.info("4/10 buildTopicFactPack: verifying approved topic claims.");
  const factPack = await buildTopicFactPack({
    outputDir,
    topic: selectedTopic,
    logger,
    writeOutputs: true,
    now: input.now
  });

  logger.info("5/11 buildEditorialPlan: planning article structure.");
  const editorialPlan = await buildEditorialPlan({
    outputDir,
    topic: selectedTopic,
    topicProfile: topicProfile.profile,
    researchPlan: researchPlan.plan,
    factPack: factPack.factPack,
    logger,
    writeOutputs: true,
    now: input.now
  });

  logger.info("6/11 writeArticle: writing with editorial plan and approval notes.");
  const article = await writeArticleWithReport({
    outputDir,
    topic: selectedTopic,
    factPack: factPack.factPack,
    editorialPlan: editorialPlan.plan,
    editorialStyle,
    editorialApproval: asEditorialApproval(editorialApproval),
    logger,
    env: input.env,
    fetchImpl: input.fetchImpl,
    writeOutputs: true,
    now: input.now
  });

  logger.info("7/11 generateTitles: using approvedTitle as a checked reference.");
  const titleGeneration = await generateTitlesWithReport({
    outputDir,
    articleMarkdown: article.article.markdown,
    articleMeta: article.meta,
    selectedTopic,
    factPack: factPack.factPack,
    editorialStyle,
    editorialApproval: asEditorialApproval(editorialApproval),
    feedback: editorialFeedback,
    logger,
    env: input.env,
    fetchImpl: input.fetchImpl,
    writeOutputs: true,
    now: input.now
  });
  const articleForNextStages = {
    ...article.article,
    title: titleGeneration.articleMeta.title,
    markdown: titleGeneration.articleMarkdown,
    wordCount: titleGeneration.articleMeta.wordCount
  };
  const articleMetaForNextStages = titleGeneration.articleMeta;

  logger.info("8/11 reviewArticle: auditing approved article.");
  const articleReview = await reviewArticleWithReport({
    outputDir,
    articleMarkdown: articleForNextStages.markdown,
    articleMeta: articleMetaForNextStages,
    factPack: factPack.factPack,
    selectedTopic,
    topicProfile: topicProfile.profile,
    logger,
    env: input.env,
    fetchImpl: input.fetchImpl,
    writeOutputs: true,
    now: input.now
  });

  logger.info("9/11 cover: generating or reusing cover artifacts.");
  const cover =
    (await reuseExistingCoverIfAvailable(outputDir, logger)) ??
    (await generateCoverWithReport({
      outputDir,
      articleMarkdown: articleForNextStages.markdown,
      articleMeta: articleMetaForNextStages,
      articleReview: articleReview.review,
      selectedTopic,
      factPack: factPack.factPack,
      logger,
      env: input.env,
      writeOutputs: true,
      now: input.now
    }));

  logger.info("10/11 renderWechatHtml: creating WeChat HTML layout.");
  const wechatLayout = await renderWechatHtmlWithReport({
    outputDir,
    articleMarkdown: articleForNextStages.markdown,
    articleMeta: articleMetaForNextStages,
    articleReview: articleReview.review,
    cover: cover.cover,
    coverReview: cover.review,
    logger,
    writeOutputs: true,
    now: input.now
  });

  logger.info("11/11 saveWechatDraft: creating mock WeChat draft dry-run outputs.");
  const wechatDraft = await saveWechatDraftWithReport({
    outputDir,
    articleMarkdown: articleForNextStages.markdown,
    articleMeta: articleMetaForNextStages,
    articleReview: articleReview.review,
    cover: cover.cover,
    coverReview: cover.review,
    wechatHtml: wechatLayout.html,
    wechatLayout: wechatLayout.layout,
    logger,
    writeOutputs: true,
    now: input.now
  });
  const artifacts: DailyPipelineArtifacts = {
    candidates: briefArtifacts.candidates,
    shortlisted: briefArtifacts.shortlisted,
    selectedTopic,
    editorialStyle,
    editorialFeedback,
    editorialBrief: existingBrief,
    editorialApproval,
    topicProfile: topicProfile.profile,
    researchPlan: researchPlan.plan,
    sourceEvidence: sourceEvidence.evidence,
    editorialPlan: editorialPlan.plan,
    topicFactPack: factPack.factPack,
    article: articleForNextStages,
    articleMeta: articleMetaForNextStages,
    titleCandidates: titleGeneration.candidates,
    titleSelection: titleGeneration.selection,
    articleReview: articleReview.review,
    cover: cover.cover,
    coverReview: cover.review,
    wechatLayout: wechatLayout.layout,
    wechatDraft: wechatDraft.result
  };
  const partial = {
    outputDir,
    files,
    artifacts,
    currentStage: "draft-dry-run",
    stoppedAt: "draft-dry-run",
    nextCommand: "pnpm preflight:final"
  };

  await writeReport(partial);
  return partial;
}

async function runLayoutStage(input: {
  outputDir: string;
  files: PipelineOutputFiles;
  logger: Logger;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  approvalFile?: string;
}): Promise<Omit<DailyPipelineResult, "durationMs">> {
  const { outputDir, files, logger } = input;
  const [
    articleMarkdown,
    articleMeta,
    selectedTopic,
    topicProfile,
    researchPlan,
    sourceEvidence,
    editorialPlan,
    factPack,
    cover
  ] =
    await Promise.all([
      readFile(files.article, "utf8"),
      readJsonFile<ArticleMeta>(files.articleMeta),
      readJsonFile<SelectedTopic>(files.selectedTopic),
      readOptionalJsonFile<TopicProfile>(files.topicProfileJson),
      readOptionalJsonFile<ResearchPlan>(files.researchPlanJson),
      readOptionalJsonFile<SourceEvidence>(files.sourceEvidenceJson),
      readOptionalJsonFile<EditorialPlan>(files.editorialPlanJson),
      readJsonFile<TopicFactPack>(files.topicFactPackJson),
      readJsonFile<CoverResult>(files.cover)
    ]);
  const [editorialStyle, editorialFeedback, approval] = await Promise.all([
    loadEditorialStyle({ logger }),
    loadEditorialFeedback({ logger }),
    loadEditorialApproval({ approvalFile: input.approvalFile, logger })
  ]);
  const dynamicArtifacts = assertLayoutDynamicArtifacts({
    selectedTopic,
    topicProfile,
    researchPlan,
    sourceEvidence,
    editorialPlan,
    factPack,
    articleMeta
  });

  logger.info("1/4 reviewArticle: rechecking existing article artifacts.");
  const articleReview = await reviewArticleWithReport({
    outputDir,
    articleMarkdown,
    articleMeta,
    factPack,
    selectedTopic,
    topicProfile: dynamicArtifacts.topicProfile,
    logger,
    env: input.env,
    fetchImpl: input.fetchImpl,
    writeOutputs: true,
    now: input.now
  });

  logger.info("2/4 coverReview: reviewing existing cover.json.");
  const coverReview = await reviewExistingCoverWithReport({
    outputDir,
    files,
    cover,
    env: input.env,
    logger,
    now: input.now
  });

  logger.info("3/4 renderWechatHtml: creating WeChat HTML layout.");
  const wechatLayout = await renderWechatHtmlWithReport({
    outputDir,
    articleMarkdown,
    articleMeta,
    articleReview: articleReview.review,
    cover: coverReview.cover,
    coverReview: coverReview.review,
    logger,
    writeOutputs: true,
    now: input.now
  });

  logger.info("4/4 saveWechatDraft: creating mock WeChat draft dry-run outputs.");
  const wechatDraft = await saveWechatDraftWithReport({
    outputDir,
    articleMarkdown,
    articleMeta,
    articleReview: articleReview.review,
    cover: coverReview.cover,
    coverReview: coverReview.review,
    wechatHtml: wechatLayout.html,
    wechatLayout: wechatLayout.layout,
    logger,
    writeOutputs: true,
    now: input.now
  });
  const artifacts: DailyPipelineArtifacts = {
    selectedTopic,
    editorialStyle,
    editorialFeedback,
    editorialApproval: approval,
    topicProfile: dynamicArtifacts.topicProfile,
    researchPlan: dynamicArtifacts.researchPlan,
    sourceEvidence: dynamicArtifacts.sourceEvidence,
    editorialPlan: dynamicArtifacts.editorialPlan,
    topicFactPack: factPack,
    articleMeta,
    articleReview: articleReview.review,
    cover: coverReview.cover,
    coverReview: coverReview.review,
    wechatLayout: wechatLayout.layout,
    wechatDraft: wechatDraft.result
  };
  const partial = {
    outputDir,
    files,
    artifacts,
    currentStage: "draft-dry-run",
    stoppedAt: "draft-dry-run",
    nextCommand: "pnpm preflight:final"
  };

  await writeReport(partial);
  return partial;
}

export async function runDailyPipeline(
  options: RunDailyPipelineOptions = {}
): Promise<DailyPipelineResult> {
  const startedAt = Date.now();
  const logger = options.logger ?? createLogger("dry-run");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const files = createOutputFiles(outputDir);

  if (options.until && options.from) {
    throw new Error("Use either --until or --from, not both.");
  }

  await mkdir(outputDir, { recursive: true });
  logger.info(`Output directory ready: ${outputDir}`);

  const partial =
    options.from === "article"
      ? await runArticleStage({
          outputDir,
          files,
          logger,
          fetchImpl: options.fetchImpl,
          env: options.env,
          now: options.now,
          approvalFile: options.approvalFile
        })
      : options.from === "layout"
        ? await runLayoutStage({
            outputDir,
            files,
            logger,
            fetchImpl: options.fetchImpl,
            env: options.env,
            now: options.now,
            approvalFile: options.approvalFile
          })
        : await runBriefStage({
            outputDir,
            files,
            logger,
            fetchImpl: options.fetchImpl,
            env: options.env,
            now: options.now,
            useMockRss: options.useMockRss,
            manualTopicFile: options.manualTopicFile
          });

  const durationMs = Date.now() - startedAt;
  logger.info(
    `run:daily stopped at ${partial.stoppedAt} in ${durationMs}ms; next=${partial.nextCommand}.`
  );

  return {
    ...partial,
    durationMs
  };
}
