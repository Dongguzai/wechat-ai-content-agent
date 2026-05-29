import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
}

export interface ApimartImageResult {
  provider: CoverImageProvider;
  mode: CoverGenerationMode;
  imagePath: string;
  realApiCalled: boolean;
}

function realApiEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.COVER_ENABLE_REAL_API?.trim().toLowerCase() === "true";
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
  void options;
  throw new Error(
    "TODO: APIMart real image generation is not implemented yet. Confirm APIMart endpoint, request schema, authentication, and image response handling before enabling real calls. No fallback image provider is allowed."
  );
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

  if (!env.APIMART_API_KEY?.trim()) {
    throw new Error(
      "COVER_ENABLE_REAL_API=true requires APIMART_API_KEY. Refusing to call APIMart without credentials."
    );
  }

  return createRealApimartImage(options);
}
