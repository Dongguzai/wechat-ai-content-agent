import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { forceApimartImage } from "../hooks/forceApimartImage.js";
import type {
  CoverGenerationMode,
  CoverImageProvider,
  CoverImageSize
} from "../types/cover.js";

export interface GenerateApimartImageOptions {
  provider: string | null | undefined;
  imagePrompt: string;
  negativePrompt: string;
  coverText: string;
  imageSize: CoverImageSize;
  outputDir: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export interface ApimartImageResult {
  provider: CoverImageProvider;
  mode: CoverGenerationMode;
  imagePath: string;
  realApiCalled: boolean;
}

interface ApimartImageConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  size: string;
  resolution: string;
  taskInitialDelayMs: number;
  taskPollIntervalMs: number;
  taskTimeoutMs: number;
}

interface ApimartImageRequestBody {
  model: string;
  prompt: string;
  n: 1;
  size: string;
  resolution: string;
}

type ImageFormat = "png" | "jpg";

interface ImageBytes {
  bytes: Buffer;
  format: ImageFormat;
}

const defaultImageModel = "gpt-image-2";
const requiredApiSize = "16:9";
const requiredApiResolution = "2k";
const defaultTaskInitialDelayMs = 10_000;
const defaultTaskPollIntervalMs = 5_000;
const defaultTaskTimeoutMs = 180_000;

function realApiEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.COVER_ENABLE_REAL_API?.trim().toLowerCase() === "true";
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function timestampForFile(now: Date): string {
  return now.toISOString().replace(/[^0-9A-Za-z]/g, "-");
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createMockSvg(coverText: string): string {
  const [lineOne = "AI 编码代理", lineTwo = "卷向工作流"] = coverText.split(/\r?\n/);

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="383" viewBox="0 0 900 383" role="img" aria-label="mock cover">',
    "  <defs>",
    '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '      <stop offset="0%" stop-color="#0F172A"/>',
    '      <stop offset="48%" stop-color="#146C94"/>',
    '      <stop offset="100%" stop-color="#F97316"/>',
    "    </linearGradient>",
    '    <radialGradient id="hub" cx="50%" cy="48%" r="45%">',
    '      <stop offset="0%" stop-color="#E0F2FE" stop-opacity="0.95"/>',
    '      <stop offset="100%" stop-color="#38BDF8" stop-opacity="0.08"/>',
    "    </radialGradient>",
    "  </defs>",
    '  <rect width="900" height="383" fill="url(#bg)"/>',
    '  <circle cx="470" cy="186" r="142" fill="url(#hub)"/>',
    '  <rect x="572" y="74" width="188" height="86" rx="18" fill="#E2E8F0" opacity="0.88"/>',
    '  <rect x="620" y="217" width="176" height="72" rx="16" fill="#F8FAFC" opacity="0.78"/>',
    '  <rect x="132" y="236" width="170" height="62" rx="16" fill="#E0F2FE" opacity="0.72"/>',
    '  <path d="M304 256 C382 218 398 184 470 184 C536 184 564 132 646 116" fill="none" stroke="#FDE68A" stroke-width="7" stroke-linecap="round" opacity="0.9"/>',
    '  <path d="M470 184 C536 202 590 232 676 250" fill="none" stroke="#BAE6FD" stroke-width="6" stroke-linecap="round" opacity="0.85"/>',
    '  <circle cx="470" cy="184" r="34" fill="#F8FAFC" opacity="0.96"/>',
    '  <circle cx="470" cy="184" r="16" fill="#0284C7"/>',
    `  <text x="292" y="152" fill="#FFFFFF" font-family="Arial, 'PingFang SC', sans-serif" font-size="58" font-weight="800">${escapeSvgText(lineOne)}</text>`,
    `  <text x="292" y="224" fill="#FFFFFF" font-family="Arial, 'PingFang SC', sans-serif" font-size="58" font-weight="800">${escapeSvgText(lineTwo)}</text>`,
    '  <text x="578" y="118" fill="#0F172A" font-family="Arial, sans-serif" font-size="18" font-weight="700">workflow hub</text>',
    '  <text x="636" y="257" fill="#0F172A" font-family="Arial, sans-serif" font-size="16" font-weight="700">code panels</text>',
    "</svg>",
    ""
  ].join("\n");
}

async function createMockApimartImage(
  options: GenerateApimartImageOptions
): Promise<ApimartImageResult> {
  await mkdir(options.outputDir, { recursive: true });

  const imagePath = join(
    options.outputDir,
    `cover-apimart-mock-${timestampForFile(options.now ?? new Date())}.svg`
  );
  await writeFile(imagePath, createMockSvg(options.coverText), "utf8");

  return {
    provider: "apimart",
    mode: "mock",
    imagePath,
    realApiCalled: false
  };
}

async function createRealApimartImage(
  options: GenerateApimartImageOptions
): Promise<ApimartImageResult> {
  const env = options.env ?? process.env;
  const config = resolveApimartImageConfig(env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("COVER_ENABLE_REAL_API=true requires a runtime with fetch support.");
  }

  const requestBody: ApimartImageRequestBody = {
    model: config.model,
    prompt: createApimartPrompt(options),
    n: 1,
    size: config.size,
    resolution: config.resolution
  };
  const response = await fetchImpl(config.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, image/png, image/jpeg"
    },
    body: JSON.stringify(requestBody)
  });
  const contentType = response.headers.get("content-type") ?? "";
  const responseBytes = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error(
      `APIMart image API request failed with HTTP ${response.status}${formatStatusText(
        response.statusText
      )}.${formatResponsePreview(responseBytes, contentType, [config.apiKey])}`
    );
  }

  const image = await extractImageFromApimartResponse({
    bytes: responseBytes,
    contentType,
    fetchImpl,
    config
  });

  await mkdir(options.outputDir, { recursive: true });

  const imagePath = join(
    options.outputDir,
    `cover-apimart-real-${timestampForFile(options.now ?? new Date())}.${image.format}`
  );
  await writeFile(imagePath, image.bytes);

  return {
    provider: "apimart",
    mode: "real",
    imagePath,
    realApiCalled: true
  };
}

export async function generateApimartImage(
  options: GenerateApimartImageOptions
): Promise<ApimartImageResult> {
  forceApimartImage(options.provider);

  if (options.imageSize !== "900x383") {
    throw new Error(`APIMart cover image size must be 900x383; received ${options.imageSize}.`);
  }

  const env = options.env ?? process.env;

  if (!realApiEnabled(env)) {
    return createMockApimartImage(options);
  }

  return createRealApimartImage(options);
}

function resolveApimartImageConfig(env: NodeJS.ProcessEnv): ApimartImageConfig {
  const apiKey = envValue(env, "APIMART_API_KEY");
  const rawApiUrl = envValue(env, "APIMART_IMAGE_API_URL");
  const model = envValue(env, "APIMART_IMAGE_MODEL") ?? defaultImageModel;
  const size = envValue(env, "APIMART_IMAGE_SIZE") ?? requiredApiSize;
  const resolution =
    envValue(env, "APIMART_IMAGE_RESOLUTION") ?? requiredApiResolution;
  const taskInitialDelayMs = envMs(
    env,
    "APIMART_TASK_INITIAL_DELAY_MS",
    defaultTaskInitialDelayMs
  );
  const taskPollIntervalMs = envMs(
    env,
    "APIMART_TASK_POLL_INTERVAL_MS",
    defaultTaskPollIntervalMs
  );
  const taskTimeoutMs = envMs(
    env,
    "APIMART_TASK_TIMEOUT_MS",
    defaultTaskTimeoutMs
  );

  if (!apiKey) {
    throw new Error("COVER_ENABLE_REAL_API=true requires APIMART_API_KEY.");
  }

  if (!rawApiUrl) {
    throw new Error("COVER_ENABLE_REAL_API=true requires APIMART_IMAGE_API_URL.");
  }

  if (size !== requiredApiSize) {
    throw new Error(
      `APIMART_IMAGE_SIZE must be ${requiredApiSize}; received ${size}.`
    );
  }

  if (resolution !== requiredApiResolution) {
    throw new Error(
      `APIMART_IMAGE_RESOLUTION must be ${requiredApiResolution}; received ${resolution}.`
    );
  }

  try {
    const url = new URL(rawApiUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("APIMART_IMAGE_API_URL must be a valid http(s) URL.");
  }

  return {
    apiKey,
    apiUrl: normalizeApimartImageApiUrl(rawApiUrl),
    model,
    size,
    resolution,
    taskInitialDelayMs,
    taskPollIntervalMs,
    taskTimeoutMs
  };
}

function envMs(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number
): number {
  const rawValue = envValue(env, name);
  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number of milliseconds.`);
  }

  return value;
}

function normalizeApimartImageApiUrl(apiUrl: string): string {
  const url = new URL(apiUrl);

  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/v1/images/generations";
  }

  return url.toString();
}

function createApimartPrompt(options: GenerateApimartImageOptions): string {
  return options.imagePrompt;
}

function formatStatusText(statusText: string): string {
  return statusText.trim() ? ` ${statusText.trim()}` : "";
}

function formatResponsePreview(
  bytes: Buffer,
  contentType: string,
  secrets: string[]
): string {
  if (bytes.length === 0 || detectImageFormat(bytes, contentType, false)) {
    return "";
  }

  const compactText = redactSecrets(
    bytes.toString("utf8").replace(/\s+/g, " ").trim(),
    secrets
  );

  return compactText ? ` Response body: ${compactText.slice(0, 300)}` : "";
}

function redactSecrets(value: string, secrets: string[]): string {
  return secrets.reduce(
    (current, secret) => current.replaceAll(secret, "[redacted]"),
    value
  );
}

async function extractImageFromApimartResponse(input: {
  bytes: Buffer;
  contentType: string;
  fetchImpl: typeof fetch;
  config: ApimartImageConfig;
}): Promise<ImageBytes> {
  const inlineImageFormat = detectImageFormat(input.bytes, input.contentType);

  if (inlineImageFormat) {
    return {
      bytes: input.bytes,
      format: inlineImageFormat
    };
  }

  if (!looksLikeJson(input.bytes, input.contentType)) {
    throw new Error(
      "APIMart image API returned neither supported JSON nor PNG/JPG image bytes."
    );
  }

  const json = parseJsonResponse(input.bytes, [input.config.apiKey]);
  const base64Image = extractBase64Image(json);

  if (base64Image) {
    return decodeBase64Image(base64Image);
  }

  const imageUrl = extractImageUrl(json);

  if (imageUrl) {
    return fetchImageUrl(imageUrl, input.fetchImpl, input.config.apiKey);
  }

  const taskId = extractTaskId(json);

  if (taskId) {
    return pollApimartImageTask({
      taskId,
      fetchImpl: input.fetchImpl,
      config: input.config
    });
  }

  throw new Error(
    "APIMart image API response did not include data[0].url, data[0].b64_json, image_url, url, task_id, or binary PNG/JPG image bytes."
  );
}

function looksLikeJson(bytes: Buffer, contentType: string): boolean {
  if (contentType.toLowerCase().includes("json")) {
    return true;
  }

  const trimmed = bytes.toString("utf8").trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseJsonResponse(bytes: Buffer, secrets: string[]): unknown {
  const text = bytes.toString("utf8");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `APIMart image API returned invalid JSON.${formatResponsePreview(
        bytes,
        "application/json",
        secrets
      )}`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const data = value.data;

  if (Array.isArray(data) && isRecord(data[0])) {
    return data[0];
  }

  if (isRecord(data)) {
    return data;
  }

  return undefined;
}

function rootOrDataRecord(value: unknown): Record<string, unknown> | undefined {
  return firstDataRecord(value) ?? (isRecord(value) ? value : undefined);
}

function extractBase64Image(value: unknown): string | undefined {
  const dataRecord = firstDataRecord(value);

  if (dataRecord && typeof dataRecord.b64_json === "string") {
    return dataRecord.b64_json;
  }

  if (isRecord(value) && typeof value.b64_json === "string") {
    return value.b64_json;
  }

  return undefined;
}

function extractImageUrl(value: unknown): string | undefined {
  const dataRecord = firstDataRecord(value);

  if (dataRecord && typeof dataRecord.url === "string") {
    return dataRecord.url;
  }

  const nestedImageUrl = extractNestedImageUrl(dataRecord ?? value);
  if (nestedImageUrl) {
    return nestedImageUrl;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.image_url === "string") {
    return value.image_url;
  }

  if (isRecord(value.image_url) && typeof value.image_url.url === "string") {
    return value.image_url.url;
  }

  if (typeof value.url === "string") {
    return value.url;
  }

  return undefined;
}

function extractNestedImageUrl(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result = isRecord(value.result) ? value.result : value;
  const images = Array.isArray(result.images) ? result.images : undefined;

  if (!images) {
    return undefined;
  }

  for (const image of images) {
    if (!isRecord(image)) {
      continue;
    }

    if (typeof image.url === "string") {
      return image.url;
    }

    if (Array.isArray(image.url)) {
      const firstUrl = image.url.find((url) => typeof url === "string");
      if (typeof firstUrl === "string") {
        return firstUrl;
      }
    }

    if (typeof image.image_url === "string") {
      return image.image_url;
    }
  }

  return undefined;
}

function extractTaskId(value: unknown): string | undefined {
  const record = rootOrDataRecord(value);

  if (!record) {
    return undefined;
  }

  if (typeof record.task_id === "string") {
    return record.task_id;
  }

  if (typeof record.id === "string" && typeof record.status === "string") {
    return record.id;
  }

  return undefined;
}

function extractTaskStatus(value: unknown): string | undefined {
  const record = rootOrDataRecord(value);
  return typeof record?.status === "string" ? record.status : undefined;
}

function extractTaskError(value: unknown): string {
  const record = rootOrDataRecord(value);

  for (const key of ["error", "message", "errmsg"]) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "unknown APIMart task failure";
}

function taskStatusUrl(apiUrl: string, taskId: string): string {
  const url = new URL(apiUrl);
  const versionMatch = url.pathname.match(/^(.*?\/v\d+)(?:\/|$)/);
  const versionPath = versionMatch?.[1] || "/v1";

  return new URL(
    `${versionPath}/tasks/${encodeURIComponent(taskId)}`,
    url.origin
  ).toString();
}

async function pollApimartImageTask(input: {
  taskId: string;
  fetchImpl: typeof fetch;
  config: ApimartImageConfig;
}): Promise<ImageBytes> {
  const startedAt = Date.now();
  const deadline = startedAt + input.config.taskTimeoutMs;
  const statusUrl = taskStatusUrl(input.config.apiUrl, input.taskId);

  if (input.config.taskInitialDelayMs > 0) {
    await sleep(input.config.taskInitialDelayMs);
  }

  while (true) {
    const response = await input.fetchImpl(statusUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        Accept: "application/json, image/png, image/jpeg"
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    const responseBytes = Buffer.from(await response.arrayBuffer());

    if (!response.ok) {
      throw new Error(
        `APIMart image task query failed with HTTP ${response.status}${formatStatusText(
          response.statusText
        )}.${formatResponsePreview(responseBytes, contentType, [
          input.config.apiKey
        ])}`
      );
    }

    const inlineImageFormat = detectImageFormat(responseBytes, contentType);
    if (inlineImageFormat) {
      return {
        bytes: responseBytes,
        format: inlineImageFormat
      };
    }

    if (!looksLikeJson(responseBytes, contentType)) {
      throw new Error(
        "APIMart image task query returned neither supported JSON nor PNG/JPG image bytes."
      );
    }

    const json = parseJsonResponse(responseBytes, [input.config.apiKey]);
    const base64Image = extractBase64Image(json);

    if (base64Image) {
      return decodeBase64Image(base64Image);
    }

    const imageUrl = extractImageUrl(json);
    if (imageUrl) {
      return fetchImageUrl(imageUrl, input.fetchImpl, input.config.apiKey);
    }

    const status = extractTaskStatus(json)?.toLowerCase();

    if (status === "completed") {
      throw new Error("APIMart image task completed without a PNG/JPG image URL.");
    }

    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      throw new Error(`APIMart image task failed: ${extractTaskError(json)}.`);
    }

    if (Date.now() >= deadline) {
      break;
    }

    const remainingMs = Math.max(0, deadline - Date.now());
    await sleep(Math.min(input.config.taskPollIntervalMs, remainingMs));
  }

  throw new Error(
    `APIMart image task timed out after ${input.config.taskTimeoutMs}ms.`
  );
}

async function fetchImageUrl(
  imageUrl: string,
  fetchImpl: typeof fetch,
  apiKey: string
): Promise<ImageBytes> {
  const decodedDataUrl = decodeDataUrlImage(imageUrl);

  if (decodedDataUrl) {
    return decodedDataUrl;
  }

  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("APIMart image URL must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("APIMart image URL must use http(s).");
  }

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "image/png, image/jpeg"
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error(
      `APIMart image URL fetch failed with HTTP ${response.status}${formatStatusText(
        response.statusText
      )}.${formatResponsePreview(bytes, contentType, [apiKey])}`
    );
  }

  const format = detectImageFormat(bytes, contentType);
  if (!format) {
    throw new Error("APIMart image URL did not return PNG/JPG image bytes.");
  }

  return {
    bytes,
    format
  };
}

function decodeBase64Image(base64Value: string): ImageBytes {
  const dataUrlImage = decodeDataUrlImage(base64Value);
  if (dataUrlImage) {
    return dataUrlImage;
  }

  const compactBase64 = base64Value.replace(/\s+/g, "");

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compactBase64)) {
    throw new Error("APIMart b64_json image is not valid base64.");
  }

  const bytes = Buffer.from(compactBase64, "base64");
  const format = detectImageFormat(bytes, "");

  if (!format) {
    throw new Error("APIMart b64_json image did not decode to PNG/JPG image bytes.");
  }

  return {
    bytes,
    format
  };
}

function decodeDataUrlImage(value: string): ImageBytes | undefined {
  const match = /^data:(image\/(?:png|jpe?g));base64,(.+)$/is.exec(value.trim());

  if (!match) {
    return undefined;
  }

  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  const format = detectImageFormat(bytes, match[1]);

  if (!format) {
    throw new Error("APIMart data URL image did not decode to PNG/JPG image bytes.");
  }

  return {
    bytes,
    format
  };
}

function detectImageFormat(
  bytes: Buffer,
  contentType: string,
  strictDeclaredContentType = true
): ImageFormat | undefined {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    return "png";
  }

  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  ) {
    return "jpg";
  }

  const normalizedContentType = contentType.toLowerCase();
  if (
    strictDeclaredContentType &&
    bytes.length > 0 &&
    (normalizedContentType.includes("image/png") ||
      normalizedContentType.includes("image/jpeg") ||
      normalizedContentType.includes("image/jpg"))
  ) {
    throw new Error("APIMart response declared PNG/JPG but did not contain valid image bytes.");
  }

  return undefined;
}
