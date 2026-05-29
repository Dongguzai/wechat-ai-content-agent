import { requireSourceUrl } from "../hooks/requireSourceUrl.js";
import type { SelectedTopic } from "../types/article.js";
import type { NewsItem } from "../types/news.js";

export function selectTopic(news: NewsItem[]): SelectedTopic {
  if (news.length === 0) {
    throw new Error("Cannot select a topic from an empty news list.");
  }

  requireSourceUrl(news);

  const [topNews] = [...news].sort((a, b) => b.scores.final - a.scores.final);

  return {
    news: topNews,
    angle: "从内容团队视角观察多模态 Agent 工作台如何改变选题、写作和素材处理链路。",
    rationale:
      "该选题同时具备高讨论度、明确应用场景和较强读者相关性，适合作为今日主选题。",
    targetAudience: "关注 AI 产品、内容生产效率和企业知识工作流的公众号读者",
    selectedAt: new Date().toISOString()
  };
}
