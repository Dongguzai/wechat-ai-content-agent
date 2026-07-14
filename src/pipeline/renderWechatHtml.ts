import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ArticleDraft,
  ArticleMeta,
  ArticleReviewResult,
  WechatHtmlRender
} from "../types/article.js";
import type { CoverResult, CoverReviewResult } from "../types/cover.js";
import type {
  WechatHtmlChecks,
  WechatLayoutOutputFiles,
  WechatLayoutPipelineResult,
  WechatLayoutResult
} from "../types/layout.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface RenderWechatHtmlOptions {
  outputDir?: string;
  articleFile?: string;
  articleMetaFile?: string;
  articleReviewFile?: string;
  coverFile?: string;
  coverReviewFile?: string;
  articleMarkdown?: string;
  articleMeta?: ArticleMeta;
  articleReview?: ArticleReviewResult;
  cover?: CoverResult;
  coverReview?: CoverReviewResult;
  includeCoverImage?: boolean;
  logger?: Logger;
  writeOutputs?: boolean;
  now?: Date;
}

type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "quote"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "rule" };

interface SanitizedText {
  text: string;
  warningCodes: Set<string>;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(currentDir, "..", "..", "outputs");
const layoutStyle = "stripe-inspired" as const;
export const INSERT_COVER_IN_CONTENT = false;

const restrictedReplacements: Array<{
  code: string;
  pattern: RegExp;
  replacement: string;
  blocking?: boolean;
}> = [
  {
    code: "wechat-send-action",
    pattern: /确认发送|立即发送|群发/g,
    replacement: "人工确认动作"
  },
  {
    code: "wechat-publish-action",
    pattern: /点击发布|自动发布|确认发布|立即发布|发布到公众号|公众号后台发布|最终发布/g,
    replacement: "人工上线动作"
  },
  {
    code: "news-publish-wording",
    pattern: /发布/g,
    replacement: "上线",
    blocking: false
  },
  {
    code: "absolute-substitute-claim",
    pattern: /[\w\u4e00-\u9fff-]{2,24}\s*完全替代\s*[\w\u4e00-\u9fff-]{2,24}/gi,
    replacement: "不同方案只在部分场景有重叠"
  },
  {
    code: "absolute-sameness-claim",
    pattern: /[\w\u4e00-\u9fff-]{2,24}\s*(和|与)\s*[\w\u4e00-\u9fff-]{2,24}\s*完全一样/gi,
    replacement: "不同方案不能视为能力边界一致"
  },
  {
    code: "zero-cost-claim",
    pattern: /[\w\u4e00-\u9fff-]{2,24}\s*零成本/g,
    replacement: "相关方案仍需说明潜在成本"
  },
  {
    code: "forced-price-claim",
    pattern: /[\w\u4e00-\u9fff-]{2,24}\s*必须花\s*\$?\d+[^，。,.]{0,12}\s*才能用/gi,
    replacement: "具体成本取决于套餐、对象和用量"
  },
  {
    code: "free-substitute-slogan",
    pattern: /免费平替|免费替代高价工具/g,
    replacement: "开源基础设施路径"
  },
  {
    code: "absolute-zero-cost-claim",
    pattern: /完全免费且没有任何成本/g,
    replacement: "本体开源但外部模型仍可能产生成本"
  },
  {
    code: "specific-price-token",
    pattern: /\$200(?:\s*\/\s*(?:month|月))?\s+更安全地对应/gi,
    replacement: "这个价格边界更安全地对应"
  },
  {
    code: "specific-price-token",
    pattern: /\$200(?:\s*\/\s*(?:month|月))?/gi,
    replacement: "具体高阶套餐价格"
  },
  {
    code: "absolute-capability-wording",
    pattern: /能力相同|能力完全一样/g,
    replacement: "能力边界一致"
  },
  {
    code: "absolute-swap-wording",
    pattern: /直接互换|全量互换/g,
    replacement: "无差别迁移"
  },
  {
    code: "absolute-substitute-wording",
    pattern: /完全替代/g,
    replacement: "覆盖所有场景"
  }
];

const forbiddenHtmlPatterns = [
  /群发/,
  /发布/,
  /确认发送/,
  /立即发送/,
  /[\w\u4e00-\u9fff-]{2,24}\s*完全替代\s*[\w\u4e00-\u9fff-]{2,24}/i,
  /[\w\u4e00-\u9fff-]{2,24}\s*(和|与)\s*[\w\u4e00-\u9fff-]{2,24}\s*完全一样/i,
  /[\w\u4e00-\u9fff-]{2,24}\s*零成本/,
  /[\w\u4e00-\u9fff-]{2,24}\s*必须花\s*\$?\d+[^，。,.]{0,12}\s*才能用/i,
  /免费平替/,
  /\$\d+/i,
  /免费替代高价工具/,
  /能力完全一样/,
  /完全免费且没有任何成本/
];

function createOutputFiles(outputDir: string): WechatLayoutOutputFiles {
  return {
    wechatHtml: join(outputDir, "wechat.html"),
    wechatLayout: join(outputDir, "wechat-layout.json"),
    wechatLayoutReport: join(outputDir, "wechat-layout-report.md")
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeRestrictedText(value: string): SanitizedText {
  let text = value;
  const warningCodes = new Set<string>();

  for (const item of restrictedReplacements) {
    if (item.pattern.test(text)) {
      if (item.blocking !== false) {
        warningCodes.add(item.code);
      }
      text = text.replace(item.pattern, item.replacement);
    }
    item.pattern.lastIndex = 0;
  }

  return { text, warningCodes };
}

function renderInlineMarkdown(value: string): string {
  const sanitized = sanitizeRestrictedText(value).text;
  const escaped = escapeHtml(sanitized);

  return escaped.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong style="font-weight:700;color:#0f172a;">$1</strong>'
  );
}

function extractMarkdownTitle(markdown: string, fallback: string): string {
  const firstLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine?.replace(/^#{1,6}\s*/, "").trim() || fallback;
}

function createDigest(meta: ArticleMeta, markdown: string): string {
  const source =
    meta.articleThesis ||
    markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ||
    meta.title;
  const normalized = source.replace(/\s+/g, " ").trim();

  if (normalized.length <= 86) {
    return sanitizeRestrictedText(normalized).text;
  }

  return sanitizeRestrictedText(`${normalized.slice(0, 85).trim()}...`).text;
}

function parseMarkdown(markdown: string, title: string): MarkdownBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let skippedTitle = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push({
      kind: "paragraph",
      text: paragraphLines.join(" ").replace(/\s+/g, " ").trim()
    });
    paragraphLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    const normalizedTitleLine = line.replace(/^#{1,6}\s*/, "").trim();
    if (!skippedTitle && normalizedTitleLine === title) {
      skippedTitle = true;
      continue;
    }

    if (/^---+$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ kind: "heading", level: 2, text: line.slice(3).trim() });
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      blocks.push({ kind: "heading", level: 1, text: line.slice(2).trim() });
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      blocks.push({ kind: "quote", text: line.slice(2).trim() });
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

function isEmphasisParagraph(text: string): boolean {
  return [
    "真正值得关注的是",
    "更稳的判断是",
    "下一阶段",
    "主战场",
    "不是简单"
  ].some((signal) => text.includes(signal));
}

function renderBlock(block: MarkdownBlock): string {
  if (block.kind === "heading" && block.level === 1) {
    return `<h1 style="font-size:24px;line-height:1.42;margin:32px 0 14px;font-weight:700;color:#0f172a;">${renderInlineMarkdown(block.text)}</h1>`;
  }

  if (block.kind === "heading" && block.level === 2) {
    return [
      '<h2 style="font-size:18px;line-height:1.55;margin:34px 0 14px;padding:10px 0 10px 14px;border-left:4px solid #635bff;background:#f7f9ff;font-weight:700;color:#111827;">',
      renderInlineMarkdown(block.text),
      "</h2>"
    ].join("");
  }

  if (block.kind === "quote") {
    return [
      '<blockquote style="margin:18px 0 22px;padding:14px 16px;border-left:4px solid #7a89c2;background:#f6f8fb;color:#334155;font-size:15px;line-height:1.78;">',
      renderInlineMarkdown(block.text),
      "</blockquote>"
    ].join("");
  }

  if (block.kind === "rule") {
    return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">';
  }

  if (isEmphasisParagraph(block.text)) {
    return [
      '<section style="margin:20px 0;padding:16px 18px;background:#f4f7fb;border:1px solid #e2e8f0;border-radius:8px;">',
      '<p style="font-size:16px;line-height:1.78;margin:0;color:#1f2937;">',
      renderInlineMarkdown(block.text),
      "</p>",
      "</section>"
    ].join("");
  }

  return `<p style="font-size:16px;line-height:1.78;margin:16px 0;color:#1f2937;">${renderInlineMarkdown(block.text)}</p>`;
}

function imageSrcForHtml(imagePath: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(imagePath)) {
    return sanitizeRestrictedText(imagePath).text;
  }

  const projectRoot = join(currentDir, "..", "..");
  const projectRelative = relative(projectRoot, imagePath).replaceAll("\\", "/");
  if (
    projectRelative &&
    projectRelative !== ".." &&
    !projectRelative.startsWith("../")
  ) {
    return sanitizeRestrictedText(projectRelative).text;
  }

  return sanitizeRestrictedText(imagePath).text;
}

function renderCoverImage(cover: CoverResult, title: string): string {
  const imagePath = imageSrcForHtml(cover.imagePath);
  const alt = sanitizeRestrictedText(cover.title || title || "文章封面图").text;

  return `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:100%;height:auto;margin:0 0 26px;border-radius:8px;border:1px solid #e5e7eb;">`;
}

function renderLayoutHtml(input: {
  title: string;
  digest: string;
  blocks: MarkdownBlock[];
  cover: CoverResult;
  includeCoverImage: boolean;
}): string {
  const body = input.blocks.map(renderBlock).join("\n");
  const coverImage = input.includeCoverImage
    ? `${renderCoverImage(input.cover, input.title)}\n`
    : "";

  return [
    '<section data-role="wechat-layout" style="max-width:677px;margin:0 auto;padding:20px 14px 36px;background:#ffffff;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:0;">',
    coverImage,
    '<section style="margin:0 0 28px;padding:0 0 20px;border-bottom:1px solid #e5e7eb;">',
    `<h1 style="font-size:26px;line-height:1.35;margin:0 0 14px;font-weight:700;color:#0f172a;">${renderInlineMarkdown(input.title)}</h1>`,
    `<p style="font-size:15px;line-height:1.72;margin:0;color:#475569;">${renderInlineMarkdown(input.digest)}</p>`,
    "</section>",
    body,
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 18px;">',
    '<p style="font-size:13px;line-height:1.7;margin:0;color:#64748b;">原始选题线索见正文末尾。本文排版仅生成可粘贴 HTML，不包含任何后台操作入口。</p>',
    "</section>"
  ].join("\n");
}

function htmlHasForbiddenText(html: string): boolean {
  return forbiddenHtmlPatterns.some((pattern) => pattern.test(html));
}

export function reviewWechatHtmlChecks(
  html: string,
  input: { title: string; coverImagePath: string }
): WechatHtmlChecks {
  return {
    hasInlineStyles: /\sstyle="/i.test(html),
    hasNoExternalCss: !/(<link\b[^>]*stylesheet|<style\b|@import)/i.test(html),
    hasNoJavascript: !/(<script\b|javascript:|\son[a-z]+\s*=)/i.test(html),
    hasNoIframe: !/<iframe\b/i.test(html),
    hasNoForbiddenPublishText: !htmlHasForbiddenText(html),
    hasTitle: html.includes(escapeHtml(sanitizeRestrictedText(input.title).text)),
    hasCoverImage: /<img\b/i.test(html) || input.coverImagePath.length > 0,
    hasHeadings: /<h2\b/i.test(html),
    mobileReadable:
      /max-width:\s*677px/i.test(html) &&
      /font-size:\s*16px/i.test(html) &&
      /line-height:\s*1\.7[258]/i.test(html) &&
      !/display:\s*(grid|flex)|position:\s*fixed/i.test(html)
  };
}

export function canEnterWechatDraftStage(input: {
  checks: WechatHtmlChecks;
  warnings: string[];
  articleReviewPassed: boolean;
  coverReviewPassed: boolean;
}): boolean {
  return (
    allChecksPassed(input.checks) &&
    input.warnings.length === 0 &&
    input.articleReviewPassed &&
    input.coverReviewPassed
  );
}

function createWarnings(input: {
  sourceWarningCodes: Set<string>;
  articleReview: ArticleReviewResult;
  coverReview: CoverReviewResult;
  checks: WechatHtmlChecks;
}): string[] {
  const warnings: string[] = [];

  if (input.sourceWarningCodes.size > 0) {
    warnings.push(
      `Source markdown contained restricted wording and was rendered with safer wording (${[
        ...input.sourceWarningCodes
      ].join(", ")}).`
    );
  }

  if (!input.articleReview.passed) {
    warnings.push("Article review has not passed; next stage is blocked.");
  }

  if (!input.coverReview.passed) {
    warnings.push("Cover review has not passed; next stage is blocked.");
  }

  for (const [key, value] of Object.entries(input.checks)) {
    if (!value) {
      warnings.push(`HTML check failed: ${key}.`);
    }
  }

  return warnings;
}

function allChecksPassed(checks: WechatHtmlChecks): boolean {
  return Object.values(checks).every(Boolean);
}

function createLayoutReport(layout: WechatLayoutResult): string {
  const checkLines = Object.entries(layout.htmlChecks).map(
    ([key, value]) => `- ${key}: ${value ? "pass" : "fail"}`
  );
  const warningLines =
    layout.warnings.length > 0
      ? layout.warnings.map((warning) => `- ${warning}`)
      : ["- none"];

  return [
    "# WeChat HTML Layout Report",
    "",
    "## 1. 排版阶段结论",
    "",
    layout.compatibleWithWechat
      ? "公众号兼容 HTML 已生成。"
      : "公众号兼容 HTML 检查未完全通过。",
    "",
    "## 2. 文章标题",
    "",
    layout.title,
    "",
    "## 3. HTML 输出路径",
    "",
    layout.htmlPath,
    "",
    "## 4. 封面图路径",
    "",
    layout.coverImagePath || "未提供",
    "",
    "## 5. 是否公众号兼容",
    "",
    layout.compatibleWithWechat ? "是" : "否",
    "",
    "## 6. 使用了哪些排版元素",
    "",
    "- section",
    "- h1",
    "- h2",
    "- p",
    "- strong",
    "- blockquote",
    "- hr",
    "",
    "## 7. 检查项结果",
    "",
    ...checkLines,
    "",
    "## 8. 是否存在 warning",
    "",
    layout.warnings.length > 0 ? "是" : "否",
    "",
    ...warningLines,
    "",
    "## 9. 是否允许进入下一阶段：公众号草稿箱写入",
    "",
    layout.allowedNextStage ? "是" : "否",
    ""
  ].join("\n");
}

function collectSourceWarningCodes(values: string[]): Set<string> {
  const warningCodes = new Set<string>();

  for (const value of values) {
    const sanitized = sanitizeRestrictedText(value);
    for (const code of sanitized.warningCodes) {
      warningCodes.add(code);
    }
  }

  return warningCodes;
}

function outputPathForJson(outputDir: string, path: string): string {
  const projectRelative = relative(join(currentDir, "..", ".."), path).replaceAll(
    "\\",
    "/"
  );

  if (projectRelative.startsWith("outputs/")) {
    return projectRelative;
  }

  return path;
}

export function renderWechatHtml(article: ArticleDraft): WechatHtmlRender {
  const title = article.title || extractMarkdownTitle(article.markdown, "");
  const digest = sanitizeRestrictedText(article.subtitle || article.articleThesis).text;
  const cover: CoverResult = {
    provider: "apimart",
    mode: "mock",
    title,
    coverText: title,
    imagePrompt: "",
    negativePrompt: "",
    imageSize: "900x383",
    imagePath: "",
    visualRequirements: {
      style: "3D animated movie quality, not specific studio imitation",
      size: "900x383",
      quality: "2K render quality",
      language: "Chinese",
      mainTextRequired: true,
      visualCenterRequired: true
    },
    review: {
      passed: true,
      issues: [],
      riskNotes: []
    },
    generatedAt: article.createdAt
  };
  const html = renderLayoutHtml({
    title,
    digest,
    blocks: parseMarkdown(article.markdown, title),
    cover,
    includeCoverImage: false
  });

  return {
    html,
    renderedAt: new Date().toISOString(),
    wordCount: article.wordCount
  };
}

export async function renderWechatHtmlWithReport(
  options: RenderWechatHtmlOptions = {}
): Promise<WechatLayoutPipelineResult> {
  const logger = options.logger ?? createLogger("wechat-html-layout");
  const outputDir = options.outputDir ?? defaultOutputDir;
  const files = createOutputFiles(outputDir);
  const articleFile = options.articleFile ?? join(outputDir, "article.md");
  const articleMetaFile = options.articleMetaFile ?? join(outputDir, "article-meta.json");
  const articleReviewFile =
    options.articleReviewFile ?? join(outputDir, "article-review.json");
  const coverFile = options.coverFile ?? join(outputDir, "cover.json");
  const coverReviewFile =
    options.coverReviewFile ?? join(outputDir, "cover-review.json");
  const writeOutputs = options.writeOutputs ?? true;
  const includeCoverImage = options.includeCoverImage ?? INSERT_COVER_IN_CONTENT;
  const generatedAt = (options.now ?? new Date()).toISOString();

  const articleMarkdown = options.articleMarkdown ?? (await readFile(articleFile, "utf8"));
  const articleMeta =
    options.articleMeta ?? (await readJsonFile<ArticleMeta>(articleMetaFile));
  const articleReview =
    options.articleReview ?? (await readJsonFile<ArticleReviewResult>(articleReviewFile));
  const cover = options.cover ?? (await readJsonFile<CoverResult>(coverFile));
  const coverReview =
    options.coverReview ?? (await readJsonFile<CoverReviewResult>(coverReviewFile));
  const rawTitle =
    articleMeta.title || cover.title || extractMarkdownTitle(articleMarkdown, "");
  const title = sanitizeRestrictedText(rawTitle).text;
  const digest = createDigest(articleMeta, articleMarkdown);
  const blocks = parseMarkdown(articleMarkdown, rawTitle);
  const html = renderLayoutHtml({
    title,
    digest,
    blocks,
    cover,
    includeCoverImage
  });
  const checks = reviewWechatHtmlChecks(html, {
    title,
    coverImagePath: cover.imagePath
  });
  const sourceWarningCodes = collectSourceWarningCodes([
    articleMarkdown,
    articleMeta.title,
    articleMeta.articleThesis,
    cover.title
  ]);
  const warnings = createWarnings({
    sourceWarningCodes,
    articleReview,
    coverReview,
    checks
  });
  const compatibleWithWechat = allChecksPassed(checks);
  const layout: WechatLayoutResult = {
    title,
    digest,
    htmlPath: outputPathForJson(outputDir, files.wechatHtml),
    coverImagePath: cover.imagePath,
    style: layoutStyle,
    compatibleWithWechat,
    htmlChecks: checks,
    warnings,
    generatedAt,
    allowedNextStage: canEnterWechatDraftStage({
      checks,
      warnings,
      articleReviewPassed: articleReview.passed,
      coverReviewPassed: coverReview.passed
    })
  };
  const report = createLayoutReport(layout);

  if (writeOutputs) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(files.wechatHtml, html, "utf8");
    await writeJson(files.wechatLayout, layout);
    await writeFile(files.wechatLayoutReport, report, "utf8");
  }

  logger.info(
    `Rendered WeChat HTML layout; compatible=${layout.compatibleWithWechat}; warnings=${layout.warnings.length}.`
  );

  return {
    outputDir,
    files,
    layout,
    html,
    report
  };
}
