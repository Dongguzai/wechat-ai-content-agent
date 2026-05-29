import type { CoverInfo, SelectedTopic } from "../types/article.js";

export function generateCover(topic: SelectedTopic): CoverInfo {
  return {
    mode: "mock",
    title: `封面图：${topic.news.title}`,
    prompt:
      "Editorial cover image, clean newsroom desk, abstract AI workflow panels, readable composition, no brand logos, no real people.",
    imageUrl: `mock://cover/${topic.news.id}.png`,
    altText: `模拟封面图，用于表现${topic.news.title}`,
    createdAt: new Date().toISOString()
  };
}
