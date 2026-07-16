import type {
  ArticleGenerationTaskRecord,
  CloudArticleHandoffPayload,
  CloudTopicSelectionRecord
} from "../../types/cloud.js";

export interface TopicAnalysisResult {
  taskId: string;
  topicSelectionId: string;
  selectedTopicId: string;
  approvedTitle: string;
  sourceUrl: string;
  sourceName?: string;
  category?: string;
  tags?: string[];
  summary?: string;
  topicAngle?: string;
  riskNotes?: string[];
  editorialBrief?: {
    coreConflict?: string;
    writingAngle?: string;
    articleThesis?: string;
    sourceReliability?: string;
  };
  analyzedAt: string;
}

export interface TopicAnalysisInputSummary {
  taskId: string;
  topicSelectionId: string;
  selectedTopicId: string;
  approvedTitle: string;
  hasSelectedTopic: boolean;
  hasEditorialBrief: boolean;
  shortlistedCount: number;
  candidateCount: number;
}

type JsonRecord = Record<string, unknown>;

export function createTopicAnalysisInputSummary(input: {
  task: ArticleGenerationTaskRecord;
  topicSelection: CloudTopicSelectionRecord;
}): TopicAnalysisInputSummary {
  const handoff = input.topicSelection.handoffJson;
  return {
    taskId: input.task.id,
    topicSelectionId: input.topicSelection.id,
    selectedTopicId: input.task.selectedTopicId,
    approvedTitle: input.task.approvedTitle,
    hasSelectedTopic: isRecord(handoff.selectedTopic),
    hasEditorialBrief: isRecord(handoff.editorialBrief),
    shortlistedCount: Array.isArray(handoff.shortlistedNews) ? handoff.shortlistedNews.length : 0,
    candidateCount: Array.isArray(handoff.candidateNews) ? handoff.candidateNews.length : 0
  };
}

export function analyzeTopicSelection(input: {
  task: ArticleGenerationTaskRecord;
  topicSelection: CloudTopicSelectionRecord;
  analyzedAt?: string;
}): TopicAnalysisResult {
  const { task, topicSelection } = input;
  const handoff = topicSelection.handoffJson;
  const approval = handoff.approval;

  if (!approval?.approvedByUser) {
    throw new Error("选题未通过人工确认。");
  }
  if (approval.approvedTopicId !== task.selectedTopicId) {
    throw new Error("人工确认选题 ID 与任务选题 ID 不一致。");
  }
  if (topicSelection.selectedShortlistedItemId !== task.selectedTopicId) {
    throw new Error("Topic Selection 指向的选题与任务选题 ID 不一致。");
  }

  const selectedTopicContainer = handoff.selectedTopic;
  if (!isRecord(selectedTopicContainer)) {
    throw new Error("handoff 缺少 selectedTopic。");
  }

  const selectedTopic = unwrapSelectedTopic(selectedTopicContainer);
  const selectedTopicId = readString(selectedTopic.id);
  if (!selectedTopicId) {
    throw new Error("selectedTopic 缺少 ID。");
  }
  if (selectedTopicId !== task.selectedTopicId) {
    throw new Error("selectedTopic ID 与任务选题 ID 不一致。");
  }

  const title = readFirstString(selectedTopic.titleZh, selectedTopic.title, approval.approvedTitle);
  if (!title) {
    throw new Error("selectedTopic 缺少标题。");
  }

  const sourceUrl = readString(selectedTopic.url);
  if (!sourceUrl) {
    throw new Error("selectedTopic 缺少原文 URL。");
  }
  validateHttpUrl(sourceUrl);

  const approvedTitle = readString(approval.approvedTitle);
  if (!approvedTitle) {
    throw new Error("人工确认标题为空。");
  }
  if (task.approvedTitle.trim() && task.approvedTitle.trim() !== approvedTitle) {
    throw new Error("任务标题与人工确认标题不一致。");
  }

  const selection = isRecord(selectedTopic.selection) ? selectedTopic.selection : {};
  const recommendedTopic = recommendedTopicFromBrief(handoff.editorialBrief);
  const result: TopicAnalysisResult = {
    taskId: task.id,
    topicSelectionId: topicSelection.id,
    selectedTopicId,
    approvedTitle,
    sourceUrl,
    analyzedAt: input.analyzedAt ?? new Date().toISOString()
  };

  const sourceName = readFirstString(selectedTopic.sourceName);
  const category = readFirstString(selectedTopic.category);
  const tags = readFirstStringArray(selectedTopic.tags);
  const summary = readFirstString(selectedTopic.summaryZh, selectedTopic.summary);
  const topicAngle = readFirstString(
    selectedTopic.topicAngleZh,
    selectedTopic.topicAngle,
    selection.writingAngle
  );
  const riskNotes = readFirstStringArray(
    selectedTopic.riskNotesZh,
    selectedTopic.riskNotes,
    selection.riskNotes
  );
  if (sourceName) result.sourceName = sourceName;
  if (category) result.category = category;
  if (tags.length > 0) result.tags = tags;
  if (summary) result.summary = summary;
  if (topicAngle) result.topicAngle = topicAngle;
  if (riskNotes.length > 0) result.riskNotes = riskNotes;

  const editorialBrief = {
    coreConflict: readFirstString(recommendedTopic.coreConflict, selection.coreConflict),
    writingAngle: readFirstString(recommendedTopic.writingAngle, selection.writingAngle),
    articleThesis: readFirstString(recommendedTopic.articleThesis, selection.articleThesis),
    sourceReliability: readFirstString(recommendedTopic.sourceReliability, selection.sourceReliability)
  };
  if (Object.values(editorialBrief).some(Boolean)) {
    result.editorialBrief = editorialBrief;
  }

  return result;
}

function unwrapSelectedTopic(value: JsonRecord): JsonRecord {
  return isRecord(value.selected) ? value.selected : value;
}

function recommendedTopicFromBrief(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  return isRecord(value.recommendedTopic) ? value.recommendedTopic : value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFirstString(...values: unknown[]): string {
  for (const value of values) {
    const stringValue = readString(value);
    if (stringValue) {
      return stringValue;
    }
  }
  return "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readString(item)).filter(Boolean);
}

function readFirstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const items = readStringArray(value);
    if (items.length > 0) {
      return items;
    }
  }
  return [];
}

function validateHttpUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("selectedTopic 原文 URL 格式无效。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("selectedTopic 原文 URL 必须是 HTTP(S)。");
  }
}
