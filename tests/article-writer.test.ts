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
import type { LlmChatCompletionInput } from "../src/types/llm.js";
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
  "Claude Code 是单独固定 $200/month 工具",
  "免费平替",
  "完全替代",
  "$200",
  "免费替代高价工具"
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
    assert.equal(meta.llm?.provider, "minimax");
    assert.equal(meta.llm?.mode, "mock");

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

test("writeArticleWithReport keeps mock path when LLM_ENABLE_REAL_API=false", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-writer-mock-"));
  const topic = selectedTopicFixture();
  let called = false;

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
    const factPack = await buildTopicFactPack({
      outputDir,
      topic,
      topicSelectionReport: "# Topic Selection Report",
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    const result = await writeArticleWithReport({
      outputDir,
      topic,
      factPack: factPack.factPack,
      topicSelectionReport: "# Topic Selection Report",
      topicFactPackReport: "# Topic Fact Pack",
      env: {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "false",
        LLM_DRY_RUN: "true"
      },
      chatCompletion: async () => {
        called = true;
        throw new Error("should not call MiniMax in mock mode");
      },
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(called, false);
    assert.equal(result.meta.llm?.mode, "mock");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("writeArticleWithReport real mode calls MiniMax adapter and records usage", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "article-writer-real-"));
  const topic = selectedTopicFixture();
  let called = 0;

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
    const factPack = await buildTopicFactPack({
      outputDir,
      topic,
      topicSelectionReport: "# Topic Selection Report",
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    const result = await writeArticleWithReport({
      outputDir,
      topic,
      factPack: factPack.factPack,
      topicSelectionReport: "# Topic Selection Report",
      topicFactPackReport: "# Topic Fact Pack",
      env: {
        LLM_PROVIDER: "minimax",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        ARTICLE_WRITER_PROVIDER: "minimax",
        ARTICLE_WRITER_MODEL: "MiniMax-M2.7"
      },
      chatCompletion: async (input: LlmChatCompletionInput) => {
        called += 1;
        assert.equal(input.model, "MiniMax-M2.7");
        assert.match(input.userPrompt ?? "", /selected-topic\.json/);
        return {
          provider: "minimax",
          model: "MiniMax-M2.7",
          content: JSON.stringify({
            title: "AI 编码代理真正卷到的，不是价格，而是工作流",
            subtitle: "开源路径和闭源订阅都在争夺默认入口。",
            articleThesis: "编码代理竞争正在从模型能力转向工作流控制权。",
            sections: [
              {
                heading: "冲突先摆出来",
                body: "开源工具和闭源订阅工具被放在一起讨论，表面是成本差异，实际是开发者工作流入口在重新分配。"
              },
              {
                heading: "事实边界要收紧",
                body: "Claude Code 与 Goose 都触及部分 coding agent 工作流，但产品形态、模型后端、权限治理和成熟度不同，不能写成能力边界一致。"
              },
              {
                heading: "团队会重新算账",
                body: "团队关注的不只是价格，还包括工具锁定、审计、安全和模型调用成本。开源方案降低入口门槛，但外部模型调用仍可能产生费用。"
              }
            ],
            riskControls: ["不写完全替代", "不写零成本", "不写单独固定高价工具"]
          }),
          usage: {
            promptTokens: 101,
            completionTokens: 88,
            totalTokens: 189
          },
          finishReason: "stop",
          generatedAt: "2026-05-29T00:00:00.000Z"
        };
      },
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(called, 1);
    assert.equal(result.meta.llm?.provider, "minimax");
    assert.equal(result.meta.llm?.model, "MiniMax-M2.7");
    assert.equal(result.meta.llm?.mode, "real");
    assert.deepEqual(result.meta.llm?.usage, {
      promptTokens: 101,
      completionTokens: 88,
      totalTokens: 189
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
