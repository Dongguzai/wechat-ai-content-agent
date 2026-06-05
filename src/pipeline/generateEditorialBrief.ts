import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EditorialBrief,
  EditorialBriefCandidate,
  EditorialBriefOutputFiles,
  EditorialBriefResult,
  EditorialBriefRunnerUp,
  EditorialBriefShortlistedItem
} from "../types/editorial.js";
import type {
  NormalizedNewsItem,
  SelectedTopic,
  SelectedTopicRunnerUp,
  ShortlistedNewsItem
} from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface GenerateEditorialBriefOptions {
  outputDir?: string;
  candidates: NormalizedNewsItem[];
  shortlisted: ShortlistedNewsItem[];
  selectedTopic: SelectedTopic;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");

function createOutputFiles(outputDir: string): EditorialBriefOutputFiles {
  return {
    markdown: join(outputDir, "editorial-brief.md"),
    json: join(outputDir, "editorial-brief.json")
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function trimText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function displayTitle(item: NormalizedNewsItem): string {
  return trimText(item.titleZh) || trimText(item.title);
}

function displaySummary(item: NormalizedNewsItem): string {
  return trimText(item.summaryZh) || trimText(item.summary);
}

function toBriefCandidate(item: NormalizedNewsItem): EditorialBriefCandidate {
  return {
    id: item.id,
    title: displayTitle(item),
    rawTitle: item.rawTitle ?? item.title,
    titleZh: item.titleZh ?? displayTitle(item),
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    url: item.url,
    score: Number(item.scores.final.toFixed(1)),
    summary: displaySummary(item),
    rawSummary: item.rawSummary ?? item.summary,
    summaryZh: item.summaryZh ?? displaySummary(item)
  };
}

function toBriefShortlisted(
  item: ShortlistedNewsItem,
  index: number
): EditorialBriefShortlistedItem {
  const riskNote = item.editorial.riskNote?.trim();

  return {
    id: item.id,
    rank: index + 1,
    title: displayTitle(item),
    rawTitle: item.rawTitle ?? item.title,
    titleZh: item.titleZh ?? displayTitle(item),
    url: item.url,
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    provider: item.provider ?? null,
    query: item.query ?? null,
    category: item.category,
    tags: item.tags,
    summary: displaySummary(item),
    rawSummary: item.rawSummary ?? item.summary,
    summaryZh: item.summaryZh ?? displaySummary(item),
    riskNotes: riskNote ? [riskNote] : item.riskNotesZh ?? [],
    shortlistScore: Number(item.shortlistScore.toFixed(1)),
    topicAngle: item.topicAngleZh ?? item.editorial.topicAngle,
    topicAngleZh: item.topicAngleZh ?? item.editorial.topicAngle,
    shortlistReason: item.shortlistReasonZh ?? item.editorial.shortlistReason,
    shortlistReasonZh: item.shortlistReasonZh ?? item.editorial.shortlistReason,
    sourceLanguage: item.sourceLanguage,
    localized: item.localized
  };
}

function findRunnerUpId(
  runner: SelectedTopicRunnerUp,
  shortlisted: ShortlistedNewsItem[]
): string {
  return (
    shortlisted.find((item) => item.url === runner.url)?.id ??
    shortlisted.find((item) => item.title === runner.title)?.id ??
    runner.title
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) ??
    "runner-up"
  );
}

function toBriefRunnerUp(
  runner: SelectedTopicRunnerUp,
  shortlisted: ShortlistedNewsItem[]
): EditorialBriefRunnerUp {
  return {
    id: findRunnerUpId(runner, shortlisted),
    title: runner.title,
    url: runner.url,
    reason: runner.reason,
    whyNotSelected: runner.whyNotSelected
  };
}

function createRiskReminder(topic: SelectedTopic): EditorialBrief["riskReminder"] {
  const selected = topic.selected;
  const risks = selected.selection.riskNotes;
  const sourceReliability = selected.selection.sourceReliability;
  const needsManualCheck = sourceReliability !== "high" || risks.length > 0;

  return {
    factRisk:
      risks.find((note) => /fact|事实|价格|source|来源/i.test(note)) ??
      "需要在 fact pack 阶段继续核验核心事实与限定条件。",
    sourceRisk:
      sourceReliability === "high"
        ? "来源可靠性高，仍需在事实包中保留原始链接。"
        : `来源可靠性为 ${sourceReliability}，写作前需要人工确认原始来源边界。`,
    titleRisk:
      "标题不得使用标题党、绝对化替代、发布、群发或未经 fact pack 支撑的确定性胜负表达。",
    needsManualCheck
  };
}

function createPublishRecommendation(input: {
  topic: SelectedTopic;
  riskReminder: EditorialBrief["riskReminder"];
}): { shouldPublishToday: boolean; reason: string } {
  const reliability = input.topic.selected.selection.sourceReliability;

  if (reliability === "low") {
    return {
      shouldPublishToday: false,
      reason: "主选题来源可靠性为 low，今天不建议进入写作。"
    };
  }

  if (input.riskReminder.needsManualCheck) {
    return {
      shouldPublishToday: true,
      reason: "选题可写，但必须先人工确认选题，并在 fact pack 中处理风险提醒。"
    };
  }

  return {
    shouldPublishToday: true,
    reason: "选题来源与公众号角度都具备可写性，确认后可进入写作链路。"
  };
}

function createBrief(input: {
  candidates: NormalizedNewsItem[];
  shortlisted: ShortlistedNewsItem[];
  selectedTopic: SelectedTopic;
  generatedAt: string;
}): EditorialBrief {
  const riskReminder = createRiskReminder(input.selectedTopic);
  const recommendation = createPublishRecommendation({
    topic: input.selectedTopic,
    riskReminder
  });
  const selected = input.selectedTopic.selected;
  const selection = selected.selection;
  const shortlistedItems = input.shortlisted
    .filter((item) => item.url.trim().length > 0)
    .sort((left, right) => right.shortlistScore - left.shortlistScore)
    .slice(0, 10)
    .map((item, index) => toBriefShortlisted(item, index));

  if (shortlistedItems.length !== 10) {
    throw new Error(
      `editorial brief requires 10 shortlisted items with source URLs, got ${shortlistedItems.length}.`
    );
  }

  return {
    generatedAt: input.generatedAt,
    candidateCount: input.candidates.length,
    shortlistedCount: shortlistedItems.length,
    candidates: input.candidates.slice(0, 20).map(toBriefCandidate),
    shortlistedItems,
    shortlisted: shortlistedItems,
    recommendedTopic: {
      id: selected.id,
      title: displayTitle(selected),
      rawTitle: selected.rawTitle ?? selected.title,
      titleZh: selected.titleZh ?? displayTitle(selected),
      url: selected.url,
      reason: selection.selectedReason,
      coreConflict: selection.coreConflict,
      writingAngle: selection.writingAngle,
      articleThesis: selection.articleThesis,
      sourceReliability: selection.sourceReliability,
      riskNotes: selection.riskNotes
    },
    runnersUp: input.selectedTopic.runnersUp
      .slice(0, 2)
      .map((runner) => toBriefRunnerUp(runner, input.shortlisted)),
    riskReminder,
    shouldPublishToday: recommendation.shouldPublishToday,
    publishRecommendationReason: recommendation.reason,
    approvalRequired: true,
    nextStep:
      "Read the 10 shortlisted source URLs, then edit inputs/editorial-approval.json."
  };
}

function markdownLink(title: string, url: string): string {
  return url ? `[${title}](${url})` : title;
}

function sourceLabel(item: EditorialBriefShortlistedItem): string {
  const base = `${item.sourceName} / ${item.sourceType}`;

  if (item.sourceType !== "global_search") {
    return base;
  }

  return `${base}（provider: ${item.provider ?? "unknown"}；query: ${
    item.query ?? "unknown"
  }）`;
}

function riskText(riskNotes: string[]): string {
  return riskNotes.length > 0 ? riskNotes.join("；") : "无明显风险";
}

function createMarkdown(brief: EditorialBrief): string {
  const shortlistedLines = brief.shortlistedItems.flatMap((item, index) => [
    `### ${index + 1}. ${item.titleZh ?? item.title}`,
    "",
    `- 中文标题：${item.titleZh ?? item.title}`,
    `- 原始标题：${item.rawTitle ?? item.title}`,
    `- 原文 URL：[${item.url}](${item.url})`,
    `- 来源：${sourceLabel(item)}`,
    `- 分类：${item.category}`,
    `- 标签：${item.tags.join(", ")}`,
    `- 分数：${item.shortlistScore}`,
    `- 中文摘要：${item.summaryZh ?? item.summary}`,
    `- 中文选题角度：${item.topicAngleZh ?? item.topicAngle}`,
    `- 中文入围理由：${item.shortlistReasonZh ?? item.shortlistReason}`,
    `- 风险提醒：${riskText(item.riskNotes)}`,
    ""
  ]);
  const runnerLines = brief.runnersUp.flatMap((item, index) => [
    `### ${index + 1}. ${item.title}`,
    "",
    `- 原文链接：${markdownLink(item.url, item.url)}`,
    `- 为什么备选：${item.reason}`,
    `- 为什么没有被选为第一推荐：${item.whyNotSelected}`,
    ""
  ]);

  return [
    "# 今日 AI 资讯编辑简报",
    "",
    `生成时间：${brief.generatedAt}`,
    "",
    "## 一、今日 10 条入围资讯阅读清单",
    "",
    ...shortlistedLines,
    "## 二、AI 推荐今日主选题",
    "",
    `- 推荐标题：${brief.recommendedTopic.title}`,
    `- 原文链接：${markdownLink(brief.recommendedTopic.url, brief.recommendedTopic.url)}`,
    `- 为什么推荐: ${brief.recommendedTopic.reason}`,
    `- 核心冲突：${brief.recommendedTopic.coreConflict}`,
    `- 写作角度：${brief.recommendedTopic.writingAngle}`,
    `- 文章中心论点：${brief.recommendedTopic.articleThesis}`,
    `- 风险提醒：${riskText(brief.recommendedTopic.riskNotes)}`,
    "",
    "## 三、备选主题 2 条",
    "",
    ...runnerLines,
    "## 四、人工确认建议",
    "",
    "请先阅读上方 10 条入围资讯原文。",
    "如果认可 AI 推荐主选题，请在 inputs/editorial-approval.json 中填写：",
    "",
    "```json",
    JSON.stringify(
      {
        approvedByUser: true,
        approvedTopicId: brief.recommendedTopic.id,
        approvedTitle: brief.recommendedTopic.title,
        notes: "你的写作补充要求"
      },
      null,
      2
    ),
    "```",
    "",
    "如果想改选其他入围资讯，也可以把 approvedTopicId 改成对应资讯 ID。",
    ""
  ].join("\n");
}

export async function generateEditorialBrief(
  options: GenerateEditorialBriefOptions
): Promise<EditorialBriefResult> {
  const outputDir = options.outputDir ?? defaultOutputDir;
  const logger = options.logger ?? createLogger("editorial-brief");
  const files = createOutputFiles(outputDir);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const brief = createBrief({
    candidates: options.candidates,
    shortlisted: options.shortlisted,
    selectedTopic: options.selectedTopic,
    generatedAt
  });
  const markdown = createMarkdown(brief);

  if (options.writeOutputs ?? true) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(files.markdown, markdown, "utf8");
    await writeJson(files.json, brief);
  }

  logger.info(
    `Generated editorial brief with ${brief.candidates.length} candidates, ${brief.shortlisted.length} shortlisted items, and approvalRequired=true.`
  );

  return {
    outputDir,
    files,
    brief,
    markdown
  };
}
