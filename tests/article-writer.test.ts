import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTopicFactPack } from "../src/pipeline/buildTopicFactPack.js";
import {
  countArticleChars,
  writeArticleWithReport
} from "../src/pipeline/writeArticle.js";
import type { ArticleMeta } from "../src/types/article.js";
import type { SelectedTopic } from "../src/types/news.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const forbiddenArticlePhrases = [
  "Goose 完全替代 Claude Code",
  "Goose 和 Claude Code 完全一样",
  "Goose 零成本",
  "Claude Code 必须花 $200 才能用",
  "免费平替"
];

function selectedTopicFixture(): SelectedTopic {
  const now = "2026-05-29T00:00:00.000Z";

  return {
    selected: {
      id: "fixture-claude-code-goose",
      title: "Claude Code costs up to $200 a month. Goose does the same thing for free.",
      url: "https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free",
      sourceName: "VentureBeat AI",
      sourceType: "rss",
      provider: "none",
      publishedAt: now,
      fetchedAt: now,
      summary:
        "Claude Code has paid subscription paths while Goose is described as a free open source AI agent.",
      category: "tooling",
      evidence: [
        "source: VentureBeat AI",
        "url: https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free"
      ],
      duplicateKey: "fixture-claude-code-goose",
      scores: {
        freshness: 86,
        heat: 94,
        technicalValue: 98,
        wechatTopic: 98,
        businessImpact: 59,
        controversy: 30,
        final: 92.7
      },
      duplicateSources: [],
      tags: ["tooling", "open-source", "agent", "developer-workflow", "model"],
      shortlistScore: 81.9,
      shortlistMetrics: {
        technicalValue: 98,
        wechatTopic: 98,
        businessImpact: 59,
        controversy: 30,
        sourceCredibility: 82,
        explainability: 79,
        originality: 84
      },
      editorial: {
        shortlistReason: "Fixture shortlist reason.",
        audienceFit: "开发者和技术团队。",
        topicAngle:
          "表面上是 Claude Code 与 Goose 的价格对比，真正的问题是编码代理会不会从昂贵订阅走向开源替代。",
        recommendedUse: "main_topic_candidate"
      },
      selection: {
        selectedReason: "Fixture selection reason.",
        whyMostWorthWriting: "Fixture why most worth writing.",
        coreConflict: "闭源高价编码代理和免费开源替代之间的冲突。",
        publicInterest: "价格差异直观。",
        technicalSignificance: "coding agent 工作流变化。",
        businessImpact: "影响团队工具预算。",
        predictedImpact: "开源 agent 会成为成本对冲。",
        writingAngle: "从工作流和总成本分析。",
        suggestedTitles: [
          "AI 编码代理真正卷到的，不是价格，而是工作流",
          "Claude Code 很贵，Goose 免费：开发者为什么开始重新算账",
          "这次开源不是热闹，是编码代理的护城河开始松动"
        ],
        articleThesis: "编码代理竞争正在从模型能力转向工作流控制权。",
        riskNotes: ["需要核验官方价格。"],
        sourceReliability: "medium",
        decisionScore: 76.5
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: now
  };
}

async function assertFileMissing(path: string): Promise<void> {
  await assert.rejects(() => access(path), /ENOENT/);
}

test("writeArticleWithReport writes article outputs and obeys safety boundaries", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-writer-"));
  const topic = selectedTopicFixture();

  try {
    await writeFile(
      join(outputDir, "selected-topic.json"),
      `${JSON.stringify(topic, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      join(outputDir, "topic-selection-report.md"),
      "# Topic Selection Report\n",
      "utf8"
    );
    await buildTopicFactPack({
      outputDir,
      topic,
      topicSelectionReport: "# Topic Selection Report",
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    const result = await writeArticleWithReport({
      outputDir,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await access(result.files.article);
    await access(result.files.articleMeta);
    await access(result.files.articleWritingReport);
    await assertFileMissing(join(outputDir, "cover.json"));
    await assertFileMissing(join(outputDir, "wechat.html"));

    const article = await readFile(result.files.article, "utf8");
    const meta = JSON.parse(
      await readFile(result.files.articleMeta, "utf8")
    ) as ArticleMeta;
    const report = await readFile(result.files.articleWritingReport, "utf8");
    const title = article.split(/\r?\n/, 1)[0].trim();

    assert.ok(title);
    assert.equal(title, meta.title);
    assert.doesNotMatch(title, /^#/);
    assert.ok(countArticleChars(article) <= 1500);
    assert.ok(meta.wordCount <= 1500);
    assert.ok(meta.usedClaims.length >= 3);
    assert.ok(meta.riskControls.length >= 3);

    for (const phrase of forbiddenArticlePhrases) {
      assert.equal(article.includes(phrase), false, `forbidden phrase: ${phrase}`);
    }

    const discussedThemes = ["开源", "工作流", "成本", "工具锁定"].filter((term) =>
      article.includes(term)
    );
    assert.ok(discussedThemes.length >= 3);

    assert.match(report, /文章标题/);
    assert.match(report, /字数/);
    assert.match(report, /使用的 fact pack claim/);
    assert.match(report, /避免的高风险表达/);
    assert.match(report, /1500 字限制/);
    assert.match(report, /阶段边界/);
    assert.match(report, /没有进入封面、HTML 排版、公众号后台、APIMart 或浏览器自动化/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
