import { writeJsonRelative, type DashboardFsOptions } from "./paths";
import { redactJson } from "./redaction";

export interface EditorialApprovalInput {
  approvedByUser: boolean;
  approvedTopicId: string;
  approvedTitle: string;
  notes: string;
}

export interface FeedbackInput {
  date: string;
  title: string;
  topic?: string;
  draftMediaId?: string;
  published: boolean;
  views: number;
  likes: number;
  shares: number;
  myRating: number;
  topicQuality: number;
  titleQuality: number;
  coverQuality?: number;
  articleProblems: string[];
  notes: string;
}

export interface SaveFeedbackInput {
  fileName?: string;
  feedback?: Partial<FeedbackInput>;
  createTemplate?: boolean;
}

export function normalizeApproval(input: unknown): EditorialApprovalInput {
  const value = isRecord(input) ? input : {};
  return {
    approvedByUser: Boolean(value.approvedByUser),
    approvedTopicId: stringValue(value.approvedTopicId),
    approvedTitle: stringValue(value.approvedTitle),
    notes: stringValue(value.notes)
  };
}

export async function saveApproval(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ path: string; approval: EditorialApprovalInput }> {
  const approval = normalizeApproval(input);
  const writtenPath = await writeJsonRelative(
    "inputs/editorial-approval.json",
    approval,
    options
  );
  return { path: writtenPath, approval };
}

export function normalizeFeedback(input: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    date: stringValue(input.date) || new Date().toISOString().slice(0, 10),
    title: stringValue(input.title),
    topic: stringValue(input.topic),
    draftMediaId: stringValue(input.draftMediaId),
    published: Boolean(input.published),
    views: numberValue(input.views),
    likes: numberValue(input.likes),
    shares: numberValue(input.shares),
    myRating: numberValue(input.myRating),
    topicQuality: numberValue(input.topicQuality),
    titleQuality: numberValue(input.titleQuality),
    coverQuality:
      input.coverQuality === undefined ? undefined : numberValue(input.coverQuality),
    articleProblems: Array.isArray(input.articleProblems)
      ? input.articleProblems.map((item) => stringValue(item)).filter(Boolean)
      : [],
    notes: stringValue(input.notes)
  };
}

export async function saveFeedback(
  input: SaveFeedbackInput,
  options: DashboardFsOptions = {}
): Promise<{ path: string; feedback: FeedbackInput }> {
  const feedback = normalizeFeedback(input.feedback ?? {});
  const fileName = input.createTemplate
    ? `${feedback.date}.json`
    : sanitizeFeedbackFileName(input.fileName || `${feedback.date}.json`);

  const writtenPath = await writeJsonRelative(
    `feedback/${fileName}`,
    redactJson(feedback),
    options
  );

  return {
    path: writtenPath,
    feedback
  };
}

function sanitizeFeedbackFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!/^[A-Za-z0-9._ -]+\.json$/.test(trimmed)) {
    throw new Error("Feedback file name must be a local .json file.");
  }
  if (trimmed.includes("..") || trimmed.startsWith(".")) {
    throw new Error("Feedback file name is not allowed.");
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
