import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchPlan } from "../types/researchPlan.js";
import type { SelectedTopic } from "../types/news.js";
import type {
  SourceEvidence,
  SourceEvidenceItem,
  SourceEvidenceKind,
  SourceEvidenceOutputFiles,
  SourceEvidenceResult
} from "../types/sourceEvidence.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface CollectSourceEvidenceOptions {
  outputDir?: string;
  selectedTopicFile?: string;
  researchPlanFile?: string;
  selectedTopic?: SelectedTopic;
  researchPlan?: ResearchPlan;
  logger?: Logger;
  fetchImpl?: SourceEvidenceFetch;
  env?: NodeJS.ProcessEnv;
  writeOutputs?: boolean;
  now?: Date;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const defaultFetchTimeoutMs = 8_000;
const defaultMaxBodyBytes = 2_000_000;
const maxRedirects = 3;

type SourceEvidenceFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function createOutputFiles(outputDir: string): SourceEvidenceOutputFiles {
  return {
    sourceEvidenceJson: join(outputDir, "source-evidence.json"),
    sourceEvidenceReport: join(outputDir, "source-evidence-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function compact(values: Array<string | undefined>): string[] {
  return values.map((value) => value?.trim() ?? "").filter(Boolean);
}

function normalizeUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s),.;，。]+/i);
  return match?.[0];
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const [a = 0, b = 0] = normalized.split(".").map((item) => Number(item));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (ipVersion === 6) {
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80")
    );
  }

  return false;
}

function parseSafeHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 http/https 来源。");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("阻断 localhost、loopback 或私有地址来源。");
  }
  return url;
}

function fetchTimeoutMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.SOURCE_EVIDENCE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultFetchTimeoutMs;
}

function maxBodyBytes(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.SOURCE_EVIDENCE_MAX_BODY_BYTES);
  return Number.isFinite(parsed) && parsed > 10_000 ? parsed : defaultMaxBodyBytes;
}

function reliabilityForKind(kind: SourceEvidenceKind): SourceEvidenceItem["reliability"] {
  if (kind === "official_source" || kind === "paper" || kind === "policy_text") {
    return "high";
  }
  if (kind === "search_lead") {
    return "low";
  }
  return "medium";
}

function evidenceKindFor(input: {
  url: string;
  sourceName: string;
  sourceType: SelectedTopic["selected"]["sourceType"];
  eventTypes: ResearchPlan["eventTypes"];
}): SourceEvidenceKind {
  const lowerUrl = input.url.toLowerCase();
  const lowerSource = input.sourceName.toLowerCase();

  if (input.sourceType === "global_search") {
    return "search_lead";
  }
  if (lowerUrl.includes("github.com")) {
    return "github";
  }
  if (lowerUrl.includes("arxiv.org") || lowerSource.includes("arxiv")) {
    return "paper";
  }
  if (
    input.eventTypes.includes("regulation") ||
    lowerSource.includes("commission") ||
    lowerUrl.includes("gov") ||
    lowerUrl.includes("europa.eu")
  ) {
    return "policy_text";
  }
  if (
    /openai|anthropic|google|microsoft|meta|nvidia|notion|salesforce|example ai|status/i.test(
      input.sourceName
    )
  ) {
    return "official_source";
  }

  return "original_url";
}

function itemForUrl(input: {
  id: string;
  topic: SelectedTopic;
  plan: ResearchPlan;
  url: string;
  sourceName: string;
  title: string;
  now: Date;
}): SourceEvidenceItem {
  const kind = evidenceKindFor({
    url: input.url,
    sourceName: input.sourceName,
    sourceType: input.topic.selected.sourceType,
    eventTypes: input.plan.eventTypes
  });
  const isSearchLead = kind === "search_lead";
  const reliability = reliabilityForKind(kind);

  return {
    id: input.id,
    topicId: input.topic.selected.id,
    url: input.url,
    title: input.title,
    sourceName: input.sourceName,
    kind,
    status: isSearchLead ? "lead_only" : "not_fetched",
    extractionStatus: isSearchLead ? "metadata_only" : "metadata_only",
    evidenceSnippets: [],
    supportsTaskIds: [],
    reliability,
    usableAsEvidence: false,
    rejectionReason: isSearchLead
      ? "搜索线索只能提示方向，不能单独支持 verified claim。"
      : "尚未完成正文抽取。",
    canSupportVerifiedClaim: false,
    evidenceUse: isSearchLead ? "lead_only" : "primary",
    unavailableReason: isSearchLead
      ? "搜索线索只能提示方向，不能单独支持 verified claim。"
      : "当前阶段未执行网页抓取或正文解析，只记录来源元数据。",
    notes: [
      "未伪造网页抓取结果。",
      "后续 DynamicFactPack 需要可用证据后才能将 claim 标为 verified。"
    ],
    policyIds: unique(input.plan.policyRefs.map((policy) => policy.id)),
    collectedAt: input.now.toISOString()
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    );
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(stripTags(match[1])).trim() : undefined;
}

function extractPublishedAt(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate|publishdate)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate|publishdate)["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }

  return undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function readableTextFromHtml(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(?:header|footer|nav|aside|form)[^>]*>[\s\S]*?<\/(?:header|footer|nav|aside|form)>/gi, " ")
    .replace(/<(?:p|br|li|h[1-6]|article|section|div|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|article|section|div|blockquote)>/gi, "\n");

  return decodeHtmlEntities(stripTags(cleaned))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .join("\n");
}

function tokenizeForTask(value: string): string[] {
  const normalized = value.toLowerCase();
  const ascii = normalized.match(/[a-z0-9][a-z0-9.+-]{2,}/g) ?? [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  return unique([...ascii, ...chinese]).filter((token) => token.length <= 24);
}

function taskTokens(plan: ResearchPlan): Map<string, string[]> {
  return new Map(
    plan.tasks.map((task) => [
      task.id,
      tokenizeForTask(`${task.question} ${task.expectedEvidence.join(" ")} ${task.relatedRiskDimensions.join(" ")}`)
    ])
  );
}

function truncateSnippet(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 460) {
    return text;
  }
  return `${text.slice(0, 456).replace(/[，。；：、,\s]+$/g, "")}。`;
}

function createSnippets(input: {
  itemId: string;
  title: string;
  body: string;
  plan: ResearchPlan;
}): SourceEvidenceItem["evidenceSnippets"] {
  const paragraphs = input.body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 30 && line.length <= 1_200);
  const tokenMap = taskTokens(input.plan);
  const scored = paragraphs.map((paragraph, index) => {
    const lower = paragraph.toLowerCase();
    const supportsTaskIds = [...tokenMap.entries()]
      .filter(([, tokens]) => tokens.some((token) => lower.includes(token)))
      .map(([id]) => id);
    return {
      paragraph,
      index,
      supportsTaskIds,
      score: supportsTaskIds.length
    };
  });

  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8);
  const fallback = selected.length > 0 ? [] : scored.slice(0, 4);
  const snippets = [...selected, ...fallback].slice(0, 8);

  if (input.title.trim()) {
    snippets.unshift({
      paragraph: input.title,
      index: -1,
      supportsTaskIds: input.plan.tasks.slice(0, 2).map((task) => task.id),
      score: 1
    });
  }

  const seen = new Set<string>();
  return snippets
    .filter((item) => {
      const key = item.paragraph.slice(0, 120);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((item, index) => ({
      id: `${input.itemId}-snippet-${index + 1}`,
      text: truncateSnippet(item.paragraph),
      supportsTaskIds: item.supportsTaskIds.length > 0
        ? unique(item.supportsTaskIds)
        : input.plan.tasks.slice(0, 1).map((task) => task.id),
      extractedFrom: item.index === -1 ? "title" : "body"
    }));
}

async function fetchWithSafeRedirects(input: {
  url: string;
  fetchImpl: SourceEvidenceFetch;
  timeoutMs: number;
  maxBytes: number;
}): Promise<{ finalUrl: string; response: Response }> {
  let current = parseSafeHttpUrl(input.url);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await input.fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
          "user-agent": "wechat-ai-content-agent-source-evidence/0.1"
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("来源返回跳转但缺少 Location。");
        }
        current = parseSafeHttpUrl(new URL(location, current).toString());
        continue;
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
        throw new Error(`正文超过最大读取限制：${contentLength} bytes。`);
      }

      return { finalUrl: current.toString(), response };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("来源读取超时。");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("来源跳转次数超过限制。");
}

function isSupportedContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("text/html") ||
    normalized.includes("application/xhtml+xml") ||
    normalized.includes("text/plain")
  );
}

async function enrichItemWithBody(input: {
  item: SourceEvidenceItem;
  plan: ResearchPlan;
  fetchImpl: SourceEvidenceFetch;
  env: NodeJS.ProcessEnv;
}): Promise<SourceEvidenceItem> {
  if (input.item.kind === "search_lead") {
    return input.item;
  }

  try {
    parseSafeHttpUrl(input.item.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...input.item,
      status: "unavailable",
      extractionStatus: "blocked",
      rejectionReason: message,
      unavailableReason: message,
      notes: [...input.item.notes, "URL 安全检查未通过。"]
    };
  }

  try {
    const maxBytes = maxBodyBytes(input.env);
    const { response } = await fetchWithSafeRedirects({
      url: input.item.url,
      fetchImpl: input.fetchImpl,
      timeoutMs: fetchTimeoutMs(input.env),
      maxBytes
    });

    if (!response.ok) {
      const reason = `HTTP ${response.status}`;
      return {
        ...input.item,
        status: "unavailable",
        extractionStatus: "failed",
        rejectionReason: reason,
        unavailableReason: reason,
        notes: [...input.item.notes, "来源 HTTP 响应不可用。"]
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!isSupportedContentType(contentType)) {
      const reason = `不支持的 content-type：${contentType || "unknown"}`;
      return {
        ...input.item,
        status: "unavailable",
        extractionStatus: "unsupported_content_type",
        rejectionReason: reason,
        unavailableReason: reason,
        notes: [...input.item.notes, "未读取非文本正文。"]
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      const reason = `正文超过最大读取限制：${arrayBuffer.byteLength} bytes。`;
      return {
        ...input.item,
        status: "unavailable",
        extractionStatus: "failed",
        rejectionReason: reason,
        unavailableReason: reason,
        notes: [...input.item.notes, "正文过大，未用于证据。"]
      };
    }

    const rawText = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer);
    const isHtml = contentType.toLowerCase().includes("html") || /<html|<article|<p[\s>]/i.test(rawText);
    const extractedTitle = isHtml ? extractHtmlTitle(rawText) : undefined;
    const body = isHtml ? readableTextFromHtml(rawText) : rawText.replace(/\s+/g, " ").trim();
    const snippets = createSnippets({
      itemId: input.item.id,
      title: extractedTitle ?? input.item.title,
      body,
      plan: input.plan
    }).filter((snippet) => snippet.text.length >= 20);
    const supportsTaskIds = unique(snippets.flatMap((snippet) => snippet.supportsTaskIds));
    const usableAsEvidence = snippets.some((snippet) => snippet.extractedFrom === "body");
    const rejectionReason = usableAsEvidence
      ? undefined
      : "未能从正文抽取足够证据片段。";

    return {
      ...input.item,
      title: extractedTitle ?? input.item.title,
      status: usableAsEvidence ? "available_body" : "available_metadata_only",
      extractionStatus: usableAsEvidence ? "success" : "metadata_only",
      evidenceSnippets: snippets,
      supportsTaskIds,
      usableAsEvidence,
      canSupportVerifiedClaim: usableAsEvidence,
      rejectionReason,
      unavailableReason: rejectionReason,
      publishedAt: isHtml ? extractPublishedAt(rawText) : undefined,
      notes: usableAsEvidence
        ? ["已抽取正文片段；未执行 JS、浏览器自动化或付费墙绕过。"]
        : [...input.item.notes, "正文片段不足，不能支持 verified claim。"]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = message.includes("超时") || message.includes("aborted");
    return {
      ...input.item,
      status: "unavailable",
      extractionStatus: timeout ? "timeout" : "failed",
      rejectionReason: message,
      unavailableReason: message,
      notes: [...input.item.notes, "正文抽取失败，不能支持 verified claim。"]
    };
  }
}

function collectUrls(topic: SelectedTopic): Array<{ url: string; sourceName: string; title: string }> {
  const selected = topic.selected;
  const candidates = [
    {
      url: selected.url,
      sourceName: selected.sourceName,
      title: selected.titleZh || selected.title || selected.rawTitle || "选题原始来源"
    },
    ...(selected.evidence ?? []).flatMap((value) => {
      const url = normalizeUrl(value);
      return url
        ? [
            {
              url,
              sourceName: selected.sourceName,
              title: value
            }
          ]
        : [];
    }),
    ...(selected.duplicateSources ?? []).map((source) => ({
      url: source.url,
      sourceName: source.sourceName,
      title: source.title
    }))
  ].filter((item) => /^https?:\/\//i.test(item.url));

  const seen = new Set<string>();
  return candidates.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

async function createEvidence(input: {
  topic: SelectedTopic;
  plan: ResearchPlan;
  now: Date;
  fetchImpl?: SourceEvidenceFetch;
  env: NodeJS.ProcessEnv;
}): Promise<SourceEvidence> {
  const { topic, plan, now } = input;
  const urls = collectUrls(topic);
  const metadataItems = urls.map((item, index) =>
    itemForUrl({
      id: `source-evidence-${index + 1}`,
      topic,
      plan,
      url: item.url,
      sourceName: item.sourceName,
      title: item.title,
      now
    })
  );
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const items = await Promise.all(
    metadataItems.map((item) =>
      enrichItemWithBody({
        item,
        plan,
        fetchImpl,
        env: input.env
      })
    )
  );
  const successCount = items.filter((item) => item.extractionStatus === "success").length;
  const unsupportedReasons = compact([
    "search_lead 明确不能单独支持 verified claim。",
    successCount === 0
      ? "未抽取到可用正文片段；后续 claim 不能因此自动成为 verified。"
      : undefined,
    ...items
      .filter((item) => !item.usableAsEvidence)
      .map((item) => `${item.id}: ${item.rejectionReason ?? item.unavailableReason ?? "不可用"}`)
  ]);

  if (items.length === 0) {
    unsupportedReasons.push("选题缺少可用 URL，无法建立来源证据。");
  }
  const collectionMode = successCount === 0
    ? "metadata_only"
    : successCount === items.length
      ? "extracted"
      : "mixed";

  return {
    schemaVersion: "1.0",
    id: `source-evidence-${topic.selected.id}`,
    topicId: topic.selected.id,
    items,
    unsupportedReasons,
    collectionMode,
    generatedAt: now.toISOString()
  };
}

function createMarkdownReport(evidence: SourceEvidence): string {
  return [
    "# Source Evidence Report",
    "",
    `Generated at: ${evidence.generatedAt}`,
    "",
    `- topicId: ${evidence.topicId}`,
    `- collectionMode: ${evidence.collectionMode}`,
    `- itemCount: ${evidence.items.length}`,
    "",
    "## Sources",
    "",
    ...(evidence.items.length > 0
      ? evidence.items.map(
          (item) =>
            `- ${item.id}: ${item.kind} / ${item.status}\n  - url: ${item.url}\n  - extractionStatus: ${item.extractionStatus}\n  - usableAsEvidence: ${item.usableAsEvidence}\n  - canSupportVerifiedClaim: ${item.canSupportVerifiedClaim}\n  - supportsTaskIds: ${item.supportsTaskIds.join(", ") || "none"}\n  - snippetCount: ${item.evidenceSnippets.length}\n  - evidenceUse: ${item.evidenceUse}\n  - rejectionReason: ${item.rejectionReason ?? "none"}`
        )
      : ["- 无"]),
    "",
    "## Unsupported Reasons",
    "",
    ...evidence.unsupportedReasons.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

export async function collectSourceEvidence(
  options: CollectSourceEvidenceOptions = {}
): Promise<SourceEvidenceResult> {
  const logger = options.logger ?? createLogger("source-evidence");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const selectedTopicFile = options.selectedTopicFile ?? join(outputDir, "selected-topic.json");
  const researchPlanFile = options.researchPlanFile ?? join(outputDir, "research-plan.json");
  const writeOutputs = options.writeOutputs ?? true;
  const files = createOutputFiles(outputDir);
  const [topic, plan] = await Promise.all([
    options.selectedTopic ?? readJsonFile<SelectedTopic>(selectedTopicFile),
    options.researchPlan ?? readJsonFile<ResearchPlan>(researchPlanFile)
  ]);
  const evidence = await createEvidence({
    topic,
    plan,
    now: options.now ?? new Date(),
    fetchImpl: options.fetchImpl,
    env: options.env ?? process.env
  });
  const report = createMarkdownReport(evidence);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(files.sourceEvidenceJson, evidence);
    await writeFile(files.sourceEvidenceReport, report, "utf8");
  }

  logger.info(
    `Collected source evidence for ${evidence.topicId}: items=${evidence.items.length}, mode=${evidence.collectionMode}.`
  );

  return {
    outputDir,
    files,
    evidence,
    report
  };
}
