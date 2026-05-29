import type { ArticleDraft, WechatHtmlRender } from "../types/article.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdownLine(line: string): string {
  if (line.startsWith("# ")) {
    return `<h1 style="font-size:22px;line-height:1.45;margin:0 0 18px;font-weight:700;color:#111;">${escapeHtml(line.slice(2))}</h1>`;
  }

  if (line.startsWith("## ")) {
    return `<h2 style="font-size:18px;line-height:1.5;margin:28px 0 10px;font-weight:700;color:#111;">${escapeHtml(line.slice(3))}</h2>`;
  }

  if (line.startsWith("> ")) {
    return `<blockquote style="margin:0 0 20px;padding:10px 14px;border-left:4px solid #576b95;background:#f7f8fa;color:#555;line-height:1.8;">${escapeHtml(line.slice(2))}</blockquote>`;
  }

  if (line.trim().length === 0) {
    return "";
  }

  return `<p style="font-size:16px;line-height:1.85;margin:12px 0;color:#222;">${escapeHtml(line)}</p>`;
}

export function renderWechatHtml(article: ArticleDraft): WechatHtmlRender {
  const body = article.markdown
    .split(/\r?\n/)
    .map(renderMarkdownLine)
    .filter(Boolean)
    .join("\n");

  const html = [
    '<section data-role="wechat-article" style="max-width:677px;margin:0 auto;padding:0 4px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">',
    body,
    `<p style="font-size:14px;line-height:1.7;margin:28px 0 0;color:#888;">原始来源：<a href="${escapeHtml(article.sourceUrl)}" style="color:#576b95;text-decoration:none;">${escapeHtml(article.sourceName)}</a></p>`,
    "</section>"
  ].join("\n");

  return {
    html,
    renderedAt: new Date().toISOString(),
    wordCount: article.wordCount
  };
}
