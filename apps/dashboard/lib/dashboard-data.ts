import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import {
  getRepoRoot,
  listDirectory,
  readImageAsDataUrl,
  readJsonFile,
  readSafeDashboardFile,
  readTextFile,
  relativePathFromMaybeAbsolute,
  resolveSafeReadPath,
  safeFileExists,
  toPosixPath,
  type DashboardFsOptions
} from "./paths";

type JsonObject = Record<string, any>;

export interface DashboardStep {
  key: string;
  label: string;
  state: "passed" | "failed" | "waiting" | "missing";
  detail: string;
}

export interface DashboardStatus {
  generatedAt: string;
  briefSource: "editorial-brief" | "pipeline-outputs" | "missing";
  needsHumanPublish: true;
  steps: DashboardStep[];
  selectedTopicTitle?: string;
  finalTitle?: string;
  draftMode?: string;
  safeNotice: string;
}

export interface BriefData {
  markdown?: string;
  json?: JsonObject;
  source: DashboardStatus["briefSource"];
  candidates: JsonObject[];
  shortlisted: JsonObject[];
  recommended?: JsonObject;
  alternatives: JsonObject[];
  riskNotes: string[];
  suggestPublishToday: boolean;
  approval: {
    approvedByUser: boolean;
    approvedTopicId: string;
    approvedTitle: string;
    notes: string;
  };
}

export interface ApprovalData {
  approval: {
    approvedByUser: boolean;
    approvedTopicId: string;
    approvedTitle: string;
    notes: string;
  };
  recommendedTopic?: JsonObject;
  shortlistedItems: JsonObject[];
}

export interface ArticleData {
  markdown?: string;
  meta?: JsonObject;
  review?: JsonObject;
  wordCount: number;
}

export interface CoverData {
  cover?: JsonObject;
  review?: JsonObject;
  image?: {
    dataUrl: string;
    relativePath: string;
  };
  history: Array<{
    imagePath: string;
    relativePath: string;
    updatedAt?: string;
    source: string;
  }>;
}

export interface WechatData {
  html?: string;
  layout?: JsonObject;
  htmlChecks: {
    allowedNextStage: boolean;
    hasNoLocalImagePaths: boolean;
    hasNoForbiddenTerms: boolean;
  };
}

export interface RunRecord {
  id: string;
  date: string;
  mainTopic?: string;
  articleTitle?: string;
  success: boolean;
  draftMediaId?: string;
  reportPath?: string;
  reportPreview?: string;
}

export interface FeedbackRecord {
  fileName: string;
  data: JsonObject;
}

export interface SettingsStatus {
  realProductionModeIsTrue: boolean;
  llmProviderIsMinimax: boolean;
  coverImageProviderIsApimart: boolean;
  wechatApiEnableRealDraftIsTrue: boolean;
  secretsPresent: {
    MINIMAX_API_KEY: boolean;
    APIMART_API_KEY: boolean;
    WECHAT_APP_SECRET: boolean;
  };
}

export const SAFE_NOTICE =
  "系统只创建公众号草稿，不会发布，不会群发，最终发布需人工确认。";

export async function getDashboardStatus(
  options: DashboardFsOptions = {}
): Promise<DashboardStatus> {
  const [
    editorialBriefJsonExists,
    editorialBriefMdExists,
    candidateExists,
    shortlistedExists,
    selectedTopic,
    approval,
    articleMeta,
    articleReview,
    coverReview,
    layout,
    finalPreflight,
    apiPreflight,
    draft,
    apiDraft,
    titleCandidates
  ] = await Promise.all([
    safeFileExists("outputs/editorial-brief.json", options),
    safeFileExists("outputs/editorial-brief.md", options),
    safeFileExists("outputs/candidate-news.json", options),
    safeFileExists("outputs/shortlisted-news.json", options),
    readJsonFile<JsonObject>("outputs/selected-topic.json", options),
    readJsonFile<JsonObject>("inputs/editorial-approval.json", options),
    readJsonFile<JsonObject>("outputs/article-meta.json", options),
    readJsonFile<JsonObject>("outputs/article-review.json", options),
    readJsonFile<JsonObject>("outputs/cover-review.json", options),
    readJsonFile<JsonObject>("outputs/wechat-layout.json", options),
    readJsonFile<JsonObject>("outputs/final-preflight.json", options),
    readJsonFile<JsonObject>("outputs/wechat-api-preflight.json", options),
    readJsonFile<JsonObject>("outputs/wechat-draft-result.json", options),
    readJsonFile<JsonObject>("outputs/wechat-api-draft-result.json", options),
    readJsonFile<JsonObject>("outputs/title-candidates.json", options)
  ]);

  const briefSource: DashboardStatus["briefSource"] =
    editorialBriefJsonExists || editorialBriefMdExists
      ? "editorial-brief"
      : candidateExists || shortlistedExists || selectedTopic
        ? "pipeline-outputs"
        : "missing";

  const preflight = finalPreflight ?? apiPreflight;
  const draftCreated = Boolean(
    draft?.status === "draft_saved" ||
      apiDraft?.status === "draft_created" ||
      apiDraft?.media_id ||
      apiDraft?.mediaId
  );

  return {
    generatedAt: new Date().toISOString(),
    briefSource,
    needsHumanPublish: true,
    selectedTopicTitle: selectedTopic?.selected?.title,
    finalTitle: articleMeta?.title ?? titleCandidates?.selectedTitle,
    draftMode: draft?.mode ?? apiDraft?.mode,
    safeNotice: SAFE_NOTICE,
    steps: [
      {
        key: "brief",
        label: "今日编辑简报",
        state: briefSource === "missing" ? "missing" : "passed",
        detail:
          briefSource === "editorial-brief"
            ? "已生成 editorial-brief 文件。"
            : briefSource === "pipeline-outputs"
              ? "已生成候选、入围和主选题产物，可作为简报展示。"
              : "尚未生成。"
      },
      {
        key: "approval",
        label: "人工确认选题",
        state: approval?.approvedByUser ? "passed" : "waiting",
        detail: approval?.approvedByUser
          ? `已确认：${approval.approvedTitle || approval.approvedTopicId || "未命名选题"}`
          : "等待在 /approval 确认。"
      },
      {
        key: "article",
        label: "文章生成",
        state: articleMeta?.title ? "passed" : "missing",
        detail: articleMeta?.title ?? "尚未生成 article.md / article-meta.json。"
      },
      stateFromPassedFile("article-review", "文章审核", articleReview),
      stateFromPassedFile("cover-review", "封面审核", coverReview),
      {
        key: "wechat-layout",
        label: "公众号 HTML 排版",
        state: stateFromBoolean(layout?.allowedNextStage, Boolean(layout)),
        detail: layout
          ? `compatible=${Boolean(layout.compatibleWithWechat)}, allowedNextStage=${Boolean(layout.allowedNextStage)}`
          : "尚未生成 wechat-layout.json。"
      },
      stateFromPassedFile("preflight", "最终 / API preflight", preflight),
      {
        key: "wechat-draft",
        label: "微信草稿",
        state: draftCreated ? "passed" : "waiting",
        detail: draftCreated
          ? `已生成草稿结果，mode=${draft?.mode ?? apiDraft?.mode ?? "unknown"}。`
          : "尚未创建草稿；真实草稿仍需双开关和人工确认。"
      },
      {
        key: "human-publish",
        label: "人工发布",
        state: "waiting",
        detail: "最终发布必须人工进入公众号后台完成。"
      }
    ]
  };
}

export async function getBriefData(options: DashboardFsOptions = {}): Promise<BriefData> {
  const [markdown, json, candidates, shortlisted, selectedTopic, approval] = await Promise.all([
    readTextFile("outputs/editorial-brief.md", options),
    readJsonFile<JsonObject>("outputs/editorial-brief.json", options),
    readJsonFile<JsonObject[]>("outputs/candidate-news.json", options),
    readJsonFile<JsonObject[]>("outputs/shortlisted-news.json", options),
    readJsonFile<JsonObject>("outputs/selected-topic.json", options),
    readJsonFile<BriefData["approval"]>("inputs/editorial-approval.json", options)
  ]);

  const source: BriefData["source"] =
    markdown || json ? "editorial-brief" : candidates || shortlisted || selectedTopic ? "pipeline-outputs" : "missing";
  const briefShortlisted = Array.isArray(json?.shortlistedItems)
    ? json.shortlistedItems
    : Array.isArray(json?.shortlisted)
      ? json.shortlisted
      : shortlisted ?? [];

  return {
    markdown,
    json,
    source,
    candidates: json?.candidates ?? candidates ?? [],
    shortlisted: briefShortlisted,
    recommended: json?.recommendedTopic ?? json?.recommendedMainTopic ?? selectedTopic?.selected,
    alternatives: json?.runnersUp ?? json?.alternatives ?? selectedTopic?.runnersUp ?? [],
    riskNotes:
      json?.recommendedTopic?.riskNotes ??
      (json?.riskReminder
        ? [
            json.riskReminder.factRisk,
            json.riskReminder.sourceRisk,
            json.riskReminder.titleRisk
          ].filter(Boolean)
        : undefined) ??
      json?.riskNotes ??
      selectedTopic?.selected?.selection?.riskNotes ??
      selectedTopic?.selected?.editorial?.riskNote?.split("\n") ??
      [],
    suggestPublishToday: Boolean(
      json?.shouldPublishToday ?? json?.suggestPublishToday ?? selectedTopic?.selected
    ),
    approval: approval ?? {
      approvedByUser: false,
      approvedTopicId: "",
      approvedTitle: "",
      notes: ""
    }
  };
}

export async function getApprovalData(
  options: DashboardFsOptions = {}
): Promise<ApprovalData> {
  const [approval, selectedTopic, editorialBrief, shortlisted] = await Promise.all([
    readJsonFile<ApprovalData["approval"]>("inputs/editorial-approval.json", options),
    readJsonFile<JsonObject>("outputs/selected-topic.json", options),
    readJsonFile<JsonObject>("outputs/editorial-brief.json", options),
    readJsonFile<JsonObject[]>("outputs/shortlisted-news.json", options)
  ]);
  const shortlistedItems = Array.isArray(editorialBrief?.shortlistedItems)
    ? editorialBrief.shortlistedItems
    : Array.isArray(editorialBrief?.shortlisted)
      ? editorialBrief.shortlisted
      : shortlisted ?? [];

  return {
    approval: approval ?? {
      approvedByUser: false,
      approvedTopicId: "",
      approvedTitle: "",
      notes: ""
    },
    recommendedTopic: editorialBrief?.recommendedTopic ?? selectedTopic?.selected,
    shortlistedItems
  };
}

export async function getArticleData(options: DashboardFsOptions = {}): Promise<ArticleData> {
  const [markdown, meta, review] = await Promise.all([
    readTextFile("outputs/article.md", options),
    readJsonFile<JsonObject>("outputs/article-meta.json", options),
    readJsonFile<JsonObject>("outputs/article-review.json", options)
  ]);

  return {
    markdown,
    meta,
    review,
    wordCount: Number(meta?.wordCount ?? countReadableUnits(markdown ?? ""))
  };
}

export async function getTitlesData(options: DashboardFsOptions = {}): Promise<JsonObject | undefined> {
  return await readJsonFile<JsonObject>("outputs/title-candidates.json", options);
}

export async function getCoverData(options: DashboardFsOptions = {}): Promise<CoverData> {
  const [cover, review, history] = await Promise.all([
    readJsonFile<JsonObject>("outputs/cover.json", options),
    readJsonFile<JsonObject>("outputs/cover-review.json", options),
    getCoverHistory(options)
  ]);
  const image = await readImageAsDataUrl(
    cover?.imagePath ?? review?.imagePath,
    options
  ).catch(() => undefined);

  return { cover, review, image, history };
}

export async function getWechatData(options: DashboardFsOptions = {}): Promise<WechatData> {
  const [html, layout] = await Promise.all([
    readTextFile("outputs/wechat.html", options),
    readJsonFile<JsonObject>("outputs/wechat-layout.json", options)
  ]);
  const sanitizedHtml = sanitizePreviewHtml(html);
  const localPathPattern = /(file:\/\/|\/Users\/|\/private\/|outputs\/covers|runs\/.+\/covers)/i;
  const forbiddenPattern = /(publish|freepublish|mass|sendall|群发|发布|确认发送|立即发送)/i;

  return {
    html: sanitizedHtml,
    layout,
    htmlChecks: {
      allowedNextStage: Boolean(layout?.allowedNextStage),
      hasNoLocalImagePaths: !localPathPattern.test(sanitizedHtml ?? ""),
      hasNoForbiddenTerms:
        Boolean(layout?.htmlChecks?.hasNoForbiddenPublishText ?? true) &&
        !forbiddenPattern.test(sanitizedHtml ?? "")
    }
  };
}

export async function getRunsData(options: DashboardFsOptions = {}): Promise<RunRecord[]> {
  const entries = await listDirectory("runs", options).catch(() => []);
  const runIds = entries.filter((entry) => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(entry));
  const records = await Promise.all(
    runIds.sort().reverse().map(async (id) => {
      const base = `runs/${id}`;
      const [selected, articleMeta, articleReview, coverReview, layout, preflight, draft, apiDraft, report] =
        await Promise.all([
          readJsonFile<JsonObject>(`${base}/selected-topic.json`, options),
          readJsonFile<JsonObject>(`${base}/article-meta.json`, options),
          readJsonFile<JsonObject>(`${base}/article-review.json`, options),
          readJsonFile<JsonObject>(`${base}/cover-review.json`, options),
          readJsonFile<JsonObject>(`${base}/wechat-layout.json`, options),
          readJsonFile<JsonObject>(`${base}/wechat-api-preflight.json`, options),
          readJsonFile<JsonObject>(`${base}/wechat-draft-result.json`, options),
          readJsonFile<JsonObject>(`${base}/wechat-api-draft-result.json`, options),
          readTextFile(`${base}/run-report.md`, options)
        ]);

      return {
        id,
        date: id.slice(0, 10),
        mainTopic: selected?.selected?.title,
        articleTitle: articleMeta?.title,
        success: Boolean(
          articleReview?.passed &&
            coverReview?.passed &&
            layout?.allowedNextStage &&
            preflight?.passed
        ),
        draftMediaId:
          apiDraft?.media_id ??
          apiDraft?.mediaId ??
          draft?.media_id ??
          draft?.mediaId ??
          draft?.draftId,
        reportPath: report ? `${base}/run-report.md` : undefined,
        reportPreview: report ? report.slice(0, 900) : undefined
      };
    })
  );
  return records;
}

export async function getFeedbackData(
  options: DashboardFsOptions = {}
): Promise<FeedbackRecord[]> {
  const entries = await listDirectory("feedback", options).catch(() => []);
  const jsonFiles = entries.filter((entry) => entry.endsWith(".json")).sort().reverse();
  return await Promise.all(
    jsonFiles.map(async (fileName) => ({
      fileName,
      data: (await readJsonFile<JsonObject>(`feedback/${fileName}`, options)) ?? {}
    }))
  );
}

async function getCoverHistory(
  options: DashboardFsOptions = {}
): Promise<CoverData["history"]> {
  const root = getRepoRoot(options);
  const entries = await listDirectory("outputs/covers", options).catch(() => []);
  const versions = await Promise.all(
    entries
      .filter((entry) => /\.(png|jpe?g|svg|webp)$/i.test(entry))
      .map(async (entry) => {
        const absolutePath = path.join(root, "outputs", "covers", entry);
        const stats = await stat(absolutePath).catch(() => undefined);
        return {
          imagePath: absolutePath,
          relativePath: toPosixPath(path.relative(root, absolutePath)),
          updatedAt: stats?.mtime.toISOString(),
          source: entry.includes("real") ? "real" : entry.includes("crop") ? "crop" : "mock"
        };
      })
  );

  return versions
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, 5);
}

export async function getSettingsStatus(
  options: DashboardFsOptions & { env?: NodeJS.ProcessEnv } = {}
): Promise<SettingsStatus> {
  const env = await readSafeEnv(options);
  const getValue = (key: string) => options.env?.[key] ?? env[key] ?? "";

  return {
    realProductionModeIsTrue: getValue("REAL_PRODUCTION_MODE") === "true",
    llmProviderIsMinimax: getValue("LLM_PROVIDER") === "minimax",
    coverImageProviderIsApimart: getValue("COVER_IMAGE_PROVIDER") === "apimart",
    wechatApiEnableRealDraftIsTrue: getValue("WECHAT_API_ENABLE_REAL_DRAFT") === "true",
    secretsPresent: {
      MINIMAX_API_KEY: Boolean(getValue("MINIMAX_API_KEY")),
      APIMART_API_KEY: Boolean(getValue("APIMART_API_KEY")),
      WECHAT_APP_SECRET: Boolean(getValue("WECHAT_APP_SECRET"))
    }
  };
}

export async function readFileForApi(
  requestedPath: string,
  options: DashboardFsOptions = {}
) {
  return await readSafeDashboardFile(requestedPath, options);
}

export function safeRelativeLinkForPath(
  filePath: string | undefined,
  options: DashboardFsOptions = {}
): string | undefined {
  const relativePath = relativePathFromMaybeAbsolute(filePath, options);
  if (!relativePath) {
    return undefined;
  }
  try {
    resolveSafeReadPath(relativePath, options);
    return relativePath;
  } catch {
    return undefined;
  }
}

function stateFromPassedFile(key: string, label: string, value?: JsonObject): DashboardStep {
  return {
    key,
    label,
    state: stateFromBoolean(value?.passed, Boolean(value)),
    detail: value ? `passed=${Boolean(value.passed)}` : `尚未生成 ${key}.json。`
  };
}

function stateFromBoolean(value: unknown, exists: boolean): DashboardStep["state"] {
  if (!exists) {
    return "missing";
  }
  return value ? "passed" : "failed";
}

function countReadableUnits(markdown: string): number {
  const compact = markdown.replace(/\s+/g, "");
  return compact.length;
}

function sanitizePreviewHtml(html: string | undefined): string | undefined {
  if (!html) {
    return undefined;
  }
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*["'][^"']*["']/gi, "");
}

async function readSafeEnv(options: DashboardFsOptions = {}): Promise<Record<string, string>> {
  const root = getRepoRoot(options);
  const envPath = path.join(root, ".env");
  const content = await readTextFromAbsolute(envPath);
  if (!content) {
    return {};
  }

  const parsed: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    parsed[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return parsed;
}

async function readTextFromAbsolute(absolutePath: string): Promise<string | undefined> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}
