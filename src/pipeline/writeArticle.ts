import { requireSourceUrl } from "../hooks/requireSourceUrl.js";
import type { ArticleDraft, ArticleSection, SelectedTopic } from "../types/article.js";

function countArticleChars(markdown: string): number {
  return markdown.replace(/[#*`\-[\]\n\r\t\s]/g, "").length;
}

export function writeArticle(topic: SelectedTopic): ArticleDraft {
  requireSourceUrl(topic.news);

  const title = `从「${topic.news.title}」看内容生产的新拐点`;
  const subtitle = "多模态 Agent 正在把资料整理、图文理解和任务编排连接成一条更短的链路。";
  const sections: ArticleSection[] = [
    {
      heading: "为什么值得关注",
      body: `这条资讯的核心不是又多了一个工具入口，而是内容生产的组织方式正在变化。${topic.news.summary} 对公众号团队来说，这意味着选题、资料核对、提纲生成和配图沟通可以被放进同一条流程里，减少来回切换。`
    },
    {
      heading: "它改变了哪几个环节",
      body: "第一，资料整理会更像一个持续更新的工作台，而不是临时堆起来的链接列表。第二，图文理解会进入写作前置环节，截图、产品图和报告图表都能成为可检索素材。第三，任务编排会让编辑把规则写清楚，例如必须保留来源、必须人工审核、必须先存入草稿箱。"
    },
    {
      heading: "内容团队应该怎么用",
      body: "短期看，最适合先接入低风险环节：资讯聚合、选题评分、标题备选、摘要改写和 HTML 排版。中期再把审核清单、事实核对和封面需求结构化。这样做的好处是，每一步都有独立产物，也能被人工替换或回退。"
    },
    {
      heading: "需要保持的边界",
      body: "Agent 可以提升速度，但不能替代编辑判断。尤其是来源可信度、事实时效性、观点分寸和品牌语气，仍然需要人工把关。好的自动化流程不是把人挤出去，而是把重复劳动挪开，让编辑把时间留给判断和表达。"
    },
    {
      heading: "今天的判断",
      body: "多模态 Agent 工作台会先在内容、客服、研究和运营团队里落地。真正的分水岭不是功能数量，而是流程是否可审计、可拆换、可追踪。谁能把这些基础能力做扎实，谁就更可能成为团队日常工作的入口。"
    }
  ];

  const markdown = [
    `# ${title}`,
    "",
    `> ${subtitle}`,
    "",
    `来源：${topic.news.sourceName} | ${topic.news.url}`,
    "",
    ...sections.flatMap((section) => [
      `## ${section.heading}`,
      "",
      section.body,
      ""
    ])
  ].join("\n");

  const wordCount = countArticleChars(markdown);

  if (wordCount > 1500) {
    throw new Error(`Mock article is too long: ${wordCount} chars.`);
  }

  return {
    title,
    subtitle,
    sourceTitle: topic.news.title,
    sourceUrl: topic.news.url,
    sourceName: topic.news.sourceName,
    markdown,
    sections,
    wordCount,
    createdAt: new Date().toISOString()
  };
}
