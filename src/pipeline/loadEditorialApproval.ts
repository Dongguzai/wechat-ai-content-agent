import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EditorialApproval,
  EditorialApprovalLoadResult,
  EditorialApprovalMatchKind
} from "../types/editorial.js";
import type {
  SelectedTopic,
  SelectedTopicItem,
  ShortlistedNewsItem,
  SourceReliability
} from "../types/news.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface LoadEditorialApprovalOptions {
  approvalFile?: string;
  logger?: Logger;
}

export interface ResolveEditorialApprovalOptions extends LoadEditorialApprovalOptions {
  selectedTopic: SelectedTopic;
  shortlisted: ShortlistedNewsItem[];
  outputSelectedTopicFile?: string;
  writeSelectedTopic?: boolean;
}

export interface ResolvedEditorialApproval {
  approval: EditorialApprovalLoadResult;
  topic: SelectedTopic;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultApprovalFile = join(projectRoot, "inputs", "editorial-approval.json");

function emptyApproval(filePath: string, blockedReason: string): EditorialApprovalLoadResult {
  return {
    approvalRequired: true,
    approvalFile: filePath,
    approvalRead: false,
    approvedByUser: false,
    approvedTopicId: "",
    approvedTitle: "",
    notes: "",
    matchedTopicKind: "none",
    blockedReason
  };
}

function asApproval(value: unknown): EditorialApproval {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("editorial-approval.json must contain a JSON object.");
  }

  const record = value as Record<string, unknown>;
  return {
    approvedByUser: record.approvedByUser === true,
    approvedTopicId:
      typeof record.approvedTopicId === "string" ? record.approvedTopicId.trim() : "",
    approvedTitle:
      typeof record.approvedTitle === "string" ? record.approvedTitle.trim() : "",
    notes: typeof record.notes === "string" ? record.notes.trim() : ""
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadEditorialApproval(
  options: LoadEditorialApprovalOptions = {}
): Promise<EditorialApprovalLoadResult> {
  const logger = options.logger ?? createLogger("editorial-approval");
  const approvalFile = options.approvalFile ?? defaultApprovalFile;

  let content: string;
  try {
    content = await readFile(approvalFile, "utf8");
  } catch {
    return emptyApproval(
      approvalFile,
      "Missing inputs/editorial-approval.json; stop before article writing."
    );
  }

  const approval = asApproval(JSON.parse(content) as unknown);
  logger.info(
    `Loaded editorial approval: approvedByUser=${approval.approvedByUser}; approvedTopicId=${approval.approvedTopicId || "none"}.`
  );

  return {
    approvalRequired: true,
    approvalFile,
    approvalRead: true,
    approvedByUser: approval.approvedByUser,
    approvedTopicId: approval.approvedTopicId,
    approvedTitle: approval.approvedTitle,
    notes: approval.notes,
    matchedTopicKind: "none",
    blockedReason: approval.approvedByUser
      ? undefined
      : "approvedByUser is not true; stop before article writing."
  };
}

function reliabilityFromShortlisted(item: ShortlistedNewsItem): SourceReliability {
  if (item.shortlistMetrics.sourceCredibility >= 90) {
    return "high";
  }

  if (item.shortlistMetrics.sourceCredibility >= 70 && item.url.trim()) {
    return "medium";
  }

  return "low";
}

function approvedSelectionFor(
  item: ShortlistedNewsItem,
  approval: EditorialApprovalLoadResult
): SelectedTopicItem["selection"] {
  const approvedTitle = approval.approvedTitle || item.title;
  const riskNotes = [
    item.editorial.riskNote,
    "该选题由 inputs/editorial-approval.json 人工确认，后续仍必须经过 fact pack、文章审核、封面审核、排版检查和草稿预检。"
  ].filter((value): value is string => Boolean(value?.trim()));

  return {
    selectedReason: `用户确认入围资讯 ${item.id} 作为今日主选题。原入围理由：${item.editorial.shortlistReason}`,
    whyMostWorthWriting: item.editorial.shortlistReason,
    coreConflict: item.editorial.topicAngle,
    publicInterest: item.summary,
    technicalSignificance: item.editorial.audienceFit,
    businessImpact: item.editorial.topicAngle,
    predictedImpact: "需要在 fact pack 与正文阶段继续核验具体影响范围。",
    writingAngle: approval.notes || item.editorial.topicAngle,
    suggestedTitles: [approvedTitle, item.title].filter(
      (title, index, titles) => title.trim() && titles.indexOf(title) === index
    ),
    articleThesis: item.editorial.topicAngle,
    riskNotes,
    sourceReliability: reliabilityFromShortlisted(item),
    decisionScore: item.shortlistScore
  };
}

function createApprovedTopicFromShortlisted(input: {
  selectedTopic: SelectedTopic;
  shortlisted: ShortlistedNewsItem[];
  approvedItem: ShortlistedNewsItem;
  approval: EditorialApprovalLoadResult;
}): SelectedTopic {
  const runnerUps = [
    input.selectedTopic.selected,
    ...input.shortlisted.filter((item) => item.id !== input.approvedItem.id)
  ]
    .slice(0, 2)
    .map((item) => ({
      title: item.title,
      url: item.url,
      reason:
        "该资讯仍可作为备选，但本次人工确认选择了另一条入围资讯。",
      whyNotSelected:
        item.id === input.selectedTopic.selected.id
          ? "用户通过 editorial-approval.json 选择了其他入围 topic id。"
          : "未被本次人工确认选中。"
    }));

  return {
    selected: {
      ...input.approvedItem,
      selection: approvedSelectionFor(input.approvedItem, input.approval)
    },
    runnersUp: runnerUps,
    rejected: input.selectedTopic.rejected,
    generatedAt: input.selectedTopic.generatedAt
  };
}

function matchApproval(input: {
  approval: EditorialApprovalLoadResult;
  selectedTopic: SelectedTopic;
  shortlisted: ShortlistedNewsItem[];
}): {
  kind: EditorialApprovalMatchKind;
  item?: ShortlistedNewsItem;
  topic: SelectedTopic;
} {
  const id = input.approval.approvedTopicId;
  const selected = input.selectedTopic.selected;

  if (id && (id === selected.id || id === selected.title || id === selected.url)) {
    return {
      kind: "selected-topic",
      item: selected,
      topic: input.selectedTopic
    };
  }

  const shortlistedItem = input.shortlisted.find(
    (item) => id === item.id || id === item.title || id === item.url
  );

  if (shortlistedItem) {
    return {
      kind: "shortlisted-news",
      item: shortlistedItem,
      topic: createApprovedTopicFromShortlisted({
        selectedTopic: input.selectedTopic,
        shortlisted: input.shortlisted,
        approvedItem: shortlistedItem,
        approval: input.approval
      })
    };
  }

  return {
    kind: "none",
    topic: input.selectedTopic
  };
}

export async function resolveEditorialApprovalForTopic(
  options: ResolveEditorialApprovalOptions
): Promise<ResolvedEditorialApproval> {
  const approval = await loadEditorialApproval(options);

  if (!approval.approvalRead) {
    throw new Error(approval.blockedReason);
  }

  if (!approval.approvedByUser) {
    throw new Error(approval.blockedReason);
  }

  if (!approval.approvedTopicId) {
    throw new Error("approvedTopicId is empty; stop before article writing.");
  }

  const match = matchApproval({
    approval,
    selectedTopic: options.selectedTopic,
    shortlisted: options.shortlisted
  });

  const resolvedApproval: EditorialApprovalLoadResult = {
    ...approval,
    matchedTopicKind: match.kind,
    matchedTopicId: match.item?.id,
    aiRecommendedTopicId: options.selectedTopic.selected.id,
    userApprovedTopicId: match.item?.id ?? approval.approvedTopicId,
    userChangedTopic:
      match.kind !== "none" && match.item?.id !== options.selectedTopic.selected.id,
    blockedReason:
      match.kind === "none"
        ? `approvedTopicId ${approval.approvedTopicId} does not match selected-topic or shortlisted-news.`
        : undefined
  };

  if (match.kind === "none") {
    throw new Error(resolvedApproval.blockedReason);
  }

  if (options.writeSelectedTopic ?? true) {
    await writeJson(
      options.outputSelectedTopicFile ?? join(projectRoot, "outputs", "selected-topic.json"),
      match.topic
    );
  }

  return {
    approval: resolvedApproval,
    topic: match.topic
  };
}
