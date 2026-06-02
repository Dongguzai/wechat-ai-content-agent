import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeDashboardAction } from "./actions";
import {
  getRepoRoot,
  pathExists,
  readJsonFile,
  readTextFile,
  relativePathFromMaybeAbsolute,
  resolveSafeReadPath,
  toPosixPath,
  writeJsonRelative,
  type DashboardFsOptions
} from "./paths";
import { redactJson } from "./redaction";

type JsonObject = Record<string, any>;

export interface SaveArticleInput {
  title: string;
  content: string;
}

export interface RewriteArticleInput {
  content: string;
  instruction: string;
}

export interface CoverCropInput {
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  };
}

const blockedWechatTerms = [
  "publish",
  "freepublish",
  "mass",
  "sendall",
  "群发",
  "发布",
  "确认发送",
  "立即发送"
];

export async function selectBriefTopic(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ path: string; approval: JsonObject; redirectTo: "/article" }> {
  const topicId = stringField(input, "topicId");
  if (!topicId) {
    throw new Error("topicId is required.");
  }

  const brief = await readJsonFile<JsonObject>("outputs/editorial-brief.json", options);
  const shortlistedItems = shortlistedFromBrief(brief);
  const topic = shortlistedItems.find((item) => String(item.id ?? "") === topicId);

  if (!topic) {
    throw new Error("topicId was not found in outputs/editorial-brief.json shortlistedItems.");
  }
  if (!stringValue(topic.url)) {
    throw new Error("Topics without an original URL cannot be selected.");
  }

  const approval = {
    approvedByUser: true,
    approvedTopicId: topicId,
    approvedTitle: stringValue(topic.title),
    notes: ""
  };
  const writtenPath = await writeJsonRelative("inputs/editorial-approval.json", approval, options);
  return { path: writtenPath, approval, redirectTo: "/article" };
}

export async function saveArticleDraft(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ articlePath: string; metaPath: string; meta: JsonObject; markdown: string }> {
  const title = stringField(input, "title").trim();
  const content = stringField(input, "content");

  if (!title) {
    throw new Error("title is required.");
  }

  assertNoBlockedTerms(title, await forbiddenTitleTerms(options));

  const markdown = composeArticleMarkdown(title, content);
  const root = getRepoRoot(options);
  const outputsDir = path.join(root, "outputs");
  await mkdir(outputsDir, { recursive: true });

  const currentMeta = (await readJsonFile<JsonObject>("outputs/article-meta.json", options)) ?? {};
  const updatedAt = new Date().toISOString();
  const meta = {
    ...currentMeta,
    title,
    wordCount: countReadableUnits(markdown),
    updatedAt
  };

  await writeFile(path.join(outputsDir, "article.md"), markdown, "utf8");
  const metaPath = await writeJsonRelative("outputs/article-meta.json", meta, options);

  return {
    articlePath: "outputs/article.md",
    metaPath,
    meta: redactJson(meta) as JsonObject,
    markdown
  };
}

export async function selectArticleTitle(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ title: string; meta: JsonObject }> {
  const title = stringField(input, "title").trim();
  if (!title) {
    throw new Error("title is required.");
  }

  const titles = await readJsonFile<JsonObject>("outputs/title-candidates.json", options);
  const candidates = Array.isArray(titles?.candidates) ? titles.candidates : [];
  const candidate = candidates.find((item) => stringValue(item.title) === title);
  if (!candidate) {
    throw new Error("Selected title must come from outputs/title-candidates.json.");
  }
  if (Array.isArray(candidate.violations) && candidate.violations.length > 0) {
    throw new Error("Selected title has title safety violations.");
  }

  assertNoBlockedTerms(title, await forbiddenTitleTerms(options));

  const currentMeta = (await readJsonFile<JsonObject>("outputs/article-meta.json", options)) ?? {};
  const meta = {
    ...currentMeta,
    title,
    updatedAt: new Date().toISOString()
  };
  await writeJsonRelative("outputs/article-meta.json", meta, options);

  const currentMarkdown = await readTextFile("outputs/article.md", options);
  if (currentMarkdown !== undefined) {
    const root = getRepoRoot(options);
    await mkdir(path.join(root, "outputs"), { recursive: true });
    await writeFile(
      path.join(root, "outputs", "article.md"),
      replaceMarkdownTitle(currentMarkdown, title),
      "utf8"
    );
  }

  return { title, meta: redactJson(meta) as JsonObject };
}

export async function rewriteArticleWithLlm(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ rewrittenArticle: string; llm: JsonObject; action: JsonObject }> {
  const content = stringField(input, "content");
  const instruction = stringField(input, "instruction").trim();

  if (!content.trim()) {
    throw new Error("content is required.");
  }
  if (!instruction) {
    throw new Error("instruction is required.");
  }

  await writeJsonRelative(
    "outputs/article-rewrite-request.json",
    {
      content,
      instruction,
      requestedAt: new Date().toISOString()
    },
    options
  );
  const action = await executeDashboardAction("rewriteArticle", options);
  const result = await readJsonFile<JsonObject>("outputs/article-rewrite-result.json", options);
  if (!result?.rewrittenArticle) {
    throw new Error(action.message || "Article rewrite did not produce a result.");
  }
  return {
    rewrittenArticle: stringValue(result.rewrittenArticle),
    llm: redactJson(result.llm ?? {}) as JsonObject,
    action: redactJson(action) as JsonObject
  };
}

export async function confirmArticleAndReview(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ next?: "/preview"; articleReview?: JsonObject; action: JsonObject }> {
  await saveArticleDraft(input, options);

  const action = await executeDashboardAction("refreshLayout", options);
  const articleReview = await readJsonFile<JsonObject>("outputs/article-review.json", options);

  return {
    next: articleReview?.passed === true ? "/preview" : undefined,
    articleReview: redactJson(articleReview ?? {}) as JsonObject,
    action: redactJson(action) as JsonObject
  };
}

export async function regenerateCover(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ cover?: JsonObject; action: JsonObject }> {
  const instruction = stringField(input, "instruction").trim();
  await writeJsonRelative(
    "outputs/cover-regenerate-request.json",
    {
      instruction,
      requestedAt: new Date().toISOString()
    },
    options
  );

  const action = await executeDashboardAction("regenerateCover", options);
  const cover = await readJsonFile<JsonObject>("outputs/cover.json", options);

  return {
    cover: redactJson(cover ?? {}) as JsonObject,
    action: redactJson(action) as JsonObject
  };
}

export async function cropCover(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ cover: JsonObject; imagePath: string }> {
  const crop = normalizeCrop(input);
  const cover = await readJsonFile<JsonObject>("outputs/cover.json", options);
  if (!cover?.imagePath) {
    throw new Error("outputs/cover.json imagePath is required before cropping.");
  }

  const root = getRepoRoot(options);
  const relativeImagePath = relativePathFromMaybeAbsolute(String(cover.imagePath), options);
  if (!relativeImagePath) {
    throw new Error("Cover imagePath must point inside this repository.");
  }
  const resolvedImage = resolveSafeReadPath(relativeImagePath, options);
  const extension = path.extname(resolvedImage.absolutePath) || ".png";
  const nextRelative = `outputs/covers/cover-crop-${fileTimestamp(new Date())}${extension}`;
  const nextAbsolute = path.join(root, nextRelative);

  await mkdir(path.dirname(nextAbsolute), { recursive: true });
  await copyFile(resolvedImage.absolutePath, nextAbsolute);

  const nextCover = {
    ...cover,
    imagePath: nextAbsolute,
    crop,
    sourceImagePath: cover.imagePath,
    generatedAt: new Date().toISOString()
  };
  await writeJsonRelative("outputs/cover.json", nextCover, options);

  return {
    cover: redactJson(nextCover) as JsonObject,
    imagePath: toPosixPath(path.relative(root, nextAbsolute))
  };
}

export async function setCurrentCoverVersion(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ cover: JsonObject }> {
  const imagePath = stringField(input, "imagePath");
  const relative = relativePathFromMaybeAbsolute(imagePath, options);
  if (!relative || !relative.startsWith("outputs/covers/")) {
    throw new Error("imagePath must be an outputs/covers file.");
  }
  resolveSafeReadPath(relative, options);

  const root = getRepoRoot(options);
  const cover = (await readJsonFile<JsonObject>("outputs/cover.json", options)) ?? {};
  const nextCover = {
    ...cover,
    imagePath: path.join(root, relative),
    generatedAt: new Date().toISOString()
  };
  await writeJsonRelative("outputs/cover.json", nextCover, options);
  return { cover: redactJson(nextCover) as JsonObject };
}

export async function deleteCoverVersion(
  input: unknown,
  options: DashboardFsOptions = {}
): Promise<{ deleted: string }> {
  const imagePath = stringField(input, "imagePath");
  const relative = relativePathFromMaybeAbsolute(imagePath, options);
  if (!relative || !relative.startsWith("outputs/covers/")) {
    throw new Error("imagePath must be an outputs/covers file.");
  }
  const resolved = resolveSafeReadPath(relative, options);
  const currentCover = await readJsonFile<JsonObject>("outputs/cover.json", options);
  const currentRelative = relativePathFromMaybeAbsolute(String(currentCover?.imagePath ?? ""), options);
  if (currentRelative === relative) {
    throw new Error("The current cover cannot be deleted.");
  }
  await unlink(resolved.absolutePath);
  return { deleted: relative };
}

export async function createCurrentFeedback(
  options: DashboardFsOptions = {}
): Promise<{ path: string; feedback: JsonObject }> {
  const [articleMeta, selectedTopic, apiDraft] = await Promise.all([
    readJsonFile<JsonObject>("outputs/article-meta.json", options),
    readJsonFile<JsonObject>("outputs/selected-topic.json", options),
    readJsonFile<JsonObject>("outputs/wechat-api-draft-result.json", options)
  ]);
  const date = new Date().toISOString().slice(0, 10);
  const title = stringValue(articleMeta?.title);
  const topic = stringValue(selectedTopic?.selected?.title ?? selectedTopic?.title);
  const draftMediaId = stringValue(apiDraft?.media_id ?? apiDraft?.mediaId ?? "");
  const feedback = {
    date,
    title,
    topic,
    draftMediaId,
    published: false,
    views: 0,
    likes: 0,
    shares: 0,
    myRating: 0,
    topicQuality: 0,
    titleQuality: 0,
    coverQuality: 0,
    articleProblems: [],
    notes: ""
  };

  const fileName = await uniqueFeedbackFileName(date, title, options);
  const writtenPath = await writeJsonRelative(`feedback/${fileName}`, feedback, options);

  return {
    path: writtenPath,
    feedback
  };
}

function shortlistedFromBrief(brief: JsonObject | undefined): JsonObject[] {
  if (Array.isArray(brief?.shortlistedItems)) {
    return brief.shortlistedItems;
  }
  if (Array.isArray(brief?.shortlisted)) {
    return brief.shortlisted;
  }
  return [];
}

function composeArticleMarkdown(title: string, content: string): string {
  const body = removeMarkdownTitle(content).trim();
  return `# ${title}\n\n${body}\n`;
}

export function removeMarkdownTitle(markdown: string | undefined): string {
  const value = markdown ?? "";
  const lines = value.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent === -1) {
    return "";
  }
  if (/^#{1,6}\s+\S/.test(lines[firstContent].trim())) {
    return lines.slice(firstContent + 1).join("\n").trimStart();
  }
  return value;
}

function replaceMarkdownTitle(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent === -1) {
    return `# ${title}\n`;
  }
  if (/^#{1,6}\s+\S/.test(lines[firstContent].trim())) {
    lines[firstContent] = `# ${title}`;
    return lines.join("\n");
  }
  return `# ${title}\n\n${markdown}`;
}

function countReadableUnits(markdown: string): number {
  return [...markdown.replace(/\s+/g, "")].length;
}

async function forbiddenTitleTerms(options: DashboardFsOptions): Promise<string[]> {
  const titles = await readJsonFile<JsonObject>("outputs/title-candidates.json", options);
  const terms = Array.isArray(titles?.forbiddenTerms)
    ? titles.forbiddenTerms.map((term) => String(term))
    : [];
  return [...new Set([...terms, ...blockedWechatTerms])];
}

function assertNoBlockedTerms(value: string, terms: string[]): void {
  const lower = value.toLowerCase();
  const matched = terms.find((term) => {
    const normalized = term.toLowerCase();
    return normalized ? lower.includes(normalized) : false;
  });
  if (matched) {
    throw new Error(`Title contains a forbidden term: ${matched}`);
  }
}

function normalizeCrop(input: unknown): CoverCropInput["crop"] {
  const crop = recordField(input, "crop");
  const normalized = {
    x: finiteNumber(crop.x, "crop.x"),
    y: finiteNumber(crop.y, "crop.y"),
    width: finiteNumber(crop.width, "crop.width"),
    height: finiteNumber(crop.height, "crop.height"),
    scale: finiteNumber(crop.scale, "crop.scale")
  };
  if (normalized.width <= 0 || normalized.height <= 0 || normalized.scale <= 0) {
    throw new Error("crop width, height, and scale must be positive.");
  }
  return normalized;
}

async function uniqueFeedbackFileName(
  date: string,
  title: string,
  options: DashboardFsOptions
): Promise<string> {
  const slug = slugify(title) || "article";
  let candidate = `${date}-${slug}.json`;
  let suffix = 2;
  while (await pathExists(path.join(getRepoRoot(options), "feedback", candidate))) {
    candidate = `${date}-${slug}-${suffix}.json`;
    suffix += 1;
  }
  return candidate;
}

export async function listCoverVersions(
  options: DashboardFsOptions = {}
): Promise<Array<{ imagePath: string; relativePath: string; updatedAt?: string; source: string }>> {
  const root = getRepoRoot(options);
  const coversDir = path.join(root, "outputs", "covers");
  const entries = await readdir(coversDir).catch(() => []);
  const versions = await Promise.all(
    entries
      .filter((entry) => /\.(png|jpe?g|svg|webp)$/i.test(entry))
      .map(async (entry) => {
        const absolute = path.join(coversDir, entry);
        const stats = await stat(absolute).catch(() => undefined);
        return {
          imagePath: absolute,
          relativePath: toPosixPath(path.relative(root, absolute)),
          updatedAt: stats?.mtime.toISOString(),
          source: entry.includes("real") ? "real" : entry.includes("crop") ? "crop" : "mock"
        };
      })
  );

  return versions
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, 5);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function fileTimestamp(now: Date): string {
  return now.toISOString().replace(/[^0-9A-Za-z]/g, "-");
}

function stringField(input: unknown, key: string): string {
  const record = isRecord(input) ? input : {};
  return stringValue(record[key]);
}

function recordField(input: unknown, key: string): JsonObject {
  const record = isRecord(input) ? input : {};
  const value = record[key];
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
