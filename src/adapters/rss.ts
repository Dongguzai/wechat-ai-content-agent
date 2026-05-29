import { createHash } from "node:crypto";
import { rssSources, type RssSourceConfig } from "../config/sources.js";
import type { CollectionWarning, RawNewsItem } from "../types/news.js";
import type { Logger } from "../utils/logger.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RssFetchOptions {
  fetchImpl?: FetchLike;
  logger?: Logger;
  maxItemsPerSource?: number;
  timeoutMs?: number;
  now?: Date;
}

export interface RssFetchResult {
  items: RawNewsItem[];
  warnings: CollectionWarning[];
}

function createNewsId(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 16);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10))
    );
}

function stripHtml(value: string): string {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTag(block: string, tagNames: string[]): string | undefined {
  for (const tagName of tagNames) {
    const regex = new RegExp(
      `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(
        tagName
      )}>`,
      "i"
    );
    const match = regex.exec(block);
    const value = match?.[1] ? stripHtml(match[1]) : undefined;

    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractLink(block: string): string | undefined {
  const atomHref = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block);
  if (atomHref?.[1]) {
    return decodeXml(atomHref[1]).trim();
  }

  return extractTag(block, ["link", "guid", "id"]);
}

function extractItemBlocks(xml: string): string[] {
  const rssItems = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(
    (match) => match[1] ?? ""
  );

  if (rssItems.length > 0) {
    return rssItems;
  }

  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(
    (match) => match[1] ?? ""
  );
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

async function fetchFeedText(
  source: RssSourceConfig,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(source.url, {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "user-agent": "wechat-ai-content-agent/0.1 rss-collector"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeedItems(
  source: RssSourceConfig,
  xml: string,
  fetchedAt: string,
  maxItemsPerSource: number
): RawNewsItem[] {
  return extractItemBlocks(xml)
    .slice(0, maxItemsPerSource)
    .map((block, index) => {
      const title = extractTag(block, ["title"]) ?? "";
      const url = extractLink(block) ?? "";
      const snippet =
        extractTag(block, ["description", "summary", "subtitle"]) ??
        extractTag(block, ["content:encoded", "content"]) ??
        undefined;
      const publishedAt = normalizeDate(
        extractTag(block, ["pubDate", "published", "updated", "dc:date"])
      );
      const id = createNewsId("rss", source.name, url, title, String(index));

      return {
        id,
        sourceType: "rss",
        provider: "none",
        title,
        url,
        snippet,
        sourceName: source.name,
        publishedAt,
        fetchedAt,
        rawContent: snippet
      };
    });
}

export async function fetchRssNews(
  sources: RssSourceConfig[] = rssSources,
  options: RssFetchOptions = {}
): Promise<RssFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxItemsPerSource = options.maxItemsPerSource ?? 8;
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const warnings: CollectionWarning[] = [];

  const batches = await Promise.all(
    sources.map(async (source) => {
      try {
        const xml = await fetchFeedText(source, fetchImpl, timeoutMs);
        return parseFeedItems(source, xml, fetchedAt, maxItemsPerSource);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown RSS fetch error";
        const warning: CollectionWarning = {
          source: "rss",
          message: `RSS fetch failed for ${source.name}`,
          detail: message
        };
        warnings.push(warning);
        options.logger?.warn(`${warning.message}: ${message}`);
        return [];
      }
    })
  );

  return {
    items: batches.flat(),
    warnings
  };
}
