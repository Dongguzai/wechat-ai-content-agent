import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  canEnterWechatDraftStage,
  renderWechatHtmlWithReport,
  reviewWechatHtmlChecks
} from "../src/pipeline/renderWechatHtml.js";
import type { ArticleMeta, ArticleReviewResult } from "../src/types/article.js";
import type { CoverResult, CoverReviewResult } from "../src/types/cover.js";
import type { WechatLayoutResult } from "../src/types/layout.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const forbiddenPublishTerms = ["群发", "发布", "确认发送", "立即发送"];
const forbiddenFactPackExpressions = [
  "Goose 完全替代 Claude Code",
  "Goose 和 Claude Code 完全一样",
  "Goose 零成本",
  "Claude Code 必须花 $200 才能用",
  "免费平替",
  "$200",
  "免费替代高价工具",
  "能力完全一样",
  "完全免费且没有任何成本"
];

function articleMarkdownFixture(): string {
  return [
    "AI 编码代理真正卷到的，不是价格，而是工作流",
    "",
    "## 先把这件事说准确",
    "",
    "高价订阅和免费开源放在一起，冲突很直观。但这件事不能被写成简单的价格口号。更准确的边界是：高价订阅价格更安全地对应 Claude 的高阶个人订阅方案，不是 Claude Code 的单独固定价格。",
    "",
    "## 趋势判断",
    "",
    "Goose 在部分 coding agent 工作流上与 Claude Code 有重叠，但这不等于两者能力边界一致，也不代表可以无差别迁移。更稳的判断是：这不是简单的开源工具链选择，而是 coding agent 正在从付费产品变成开源基础设施的一次信号。"
  ].join("\n");
}

function articleMetaFixture(): ArticleMeta {
  return {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    wordCount: 280,
    sourceTopic: "Claude Code and Goose workflow entry competition",
    articleThesis: "编码代理竞争正在从模型能力转向工作流控制权。",
    usedClaims: [
      {
        claim: "Claude Code 和 Goose 都属于开发者自动化工具讨论范畴。",
        safeWording:
          "两者都面向开发者自动化，但产品形态、模型后端、权限治理、交互体验和成熟度不同。",
        sourceUrls: ["https://example.com/source"]
      }
    ],
    riskControls: [
      "不写具体价格口号。",
      "不写零成本工具。",
      "不写能力等同或全量替代。"
    ],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function articleReviewFixture(): ArticleReviewResult {
  return {
    passed: true,
    score: 96,
    summary: "文章通过审核，可以进入 HTML 排版阶段。",
    issues: [],
    requiredFixes: [],
    optionalSuggestions: [],
    factBoundaryCheck: {
      passed: true,
      violations: []
    },
    qualityCheck: {
      wordCountOk: true,
      hasTitle: true,
      hasHeadings: true,
      thirdPersonPerspective: true,
      notNewsRelease: true,
      themesCovered: ["开源", "工作流", "成本"]
    },
    finalVerdict: "允许进入 HTML 排版。",
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function coverFixture(imagePath: string): CoverResult {
  return {
    provider: "apimart",
    mode: "mock",
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    coverText: "AI 编码代理\n卷向工作流",
    imagePrompt: "Abstract non-branded workflow hub, 900x383, 2K quality.",
    negativePrompt: "real brand marks, official product marks, price labels",
    imageSize: "900x383",
    imagePath,
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
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function coverReviewFixture(imagePath: string): CoverReviewResult {
  return {
    provider: "apimart",
    mode: "mock",
    imageSize: "900x383",
    imagePath,
    passed: true,
    issues: [],
    riskNotes: [],
    checks: {
      providerIsApimart: true,
      coverTextIsChinese: true,
      imageSizeIs900x383: true,
      declares2KQuality: true,
      hasVisualCenter: true,
      doesNotRequestRealBrandMarks: true,
      doesNotRequestOfficialMarks: true,
      doesNotIncludeSpecificPrice: true,
      doesNotIncludeFreeSubstituteSlogan: true,
      doesNotIncludeAbsoluteSubstituteClaim: true,
      doesNotNameSpecificStudios: true,
      imagePathAvailable: true,
      embeddedReviewPassed: true
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("renderWechatHtmlWithReport writes WeChat-compatible Stripe-inspired layout outputs", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-html-layout-"));
  const coverPath = join(outputDir, "cover.svg");

  try {
    await writeFile(join(outputDir, "article.md"), articleMarkdownFixture(), "utf8");
    await writeJson(join(outputDir, "article-meta.json"), articleMetaFixture());
    await writeJson(join(outputDir, "article-review.json"), articleReviewFixture());
    await writeFile(coverPath, "<svg />\n", "utf8");
    await writeJson(join(outputDir, "cover.json"), coverFixture(coverPath));
    await writeJson(join(outputDir, "cover-review.json"), coverReviewFixture(coverPath));

    const result = await renderWechatHtmlWithReport({
      outputDir,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await access(join(outputDir, "wechat.html"));
    await access(join(outputDir, "wechat-layout.json"));
    await access(join(outputDir, "wechat-layout-report.md"));

    const html = await readFile(result.files.wechatHtml, "utf8");
    const layout = JSON.parse(
      await readFile(result.files.wechatLayout, "utf8")
    ) as WechatLayoutResult;
    const report = await readFile(result.files.wechatLayoutReport, "utf8");

    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /<link\b[^>]*stylesheet/i);
    assert.doesNotMatch(html, /<style\b/i);
    assert.doesNotMatch(html, /<iframe\b/i);
    assert.match(html, /\sstyle="/i);
    assert.match(html, /AI 编码代理真正卷到的，不是价格，而是工作流/);
    assert.match(html, /<h2\b/i);
    assert.ok(/<img\b/i.test(html) || layout.coverImagePath.length > 0);

    for (const term of forbiddenPublishTerms) {
      assert.equal(html.includes(term), false, `forbidden publish term: ${term}`);
    }

    for (const expression of forbiddenFactPackExpressions) {
      assert.equal(
        html.includes(expression),
        false,
        `forbidden fact expression: ${expression}`
      );
    }

    assert.equal(layout.compatibleWithWechat, true);
    assert.equal(layout.htmlChecks.hasNoJavascript, true);
    assert.equal(layout.htmlChecks.hasNoExternalCss, true);
    assert.equal(layout.htmlChecks.hasNoIframe, true);
    assert.equal(layout.htmlChecks.hasInlineStyles, true);
    assert.equal(layout.htmlChecks.hasTitle, true);
    assert.equal(layout.htmlChecks.hasHeadings, true);
    assert.equal(layout.htmlChecks.mobileReadable, true);
    assert.equal(layout.allowedNextStage, true);
    assert.equal(layout.coverImagePath, coverPath);
    assert.match(report, /排版阶段结论/);
    assert.match(report, /是否允许进入下一阶段：公众号草稿箱写入/);
    assert.match(report, /是/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("renderWechatHtmlWithReport blocks next stage when source text needed HTML safety rewriting", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-html-layout-blocked-"));
  const coverPath = join(outputDir, "cover.svg");

  try {
    await writeFile(
      join(outputDir, "article.md"),
      [
        "AI 编码代理真正卷到的，不是价格，而是工作流",
        "",
        "## 趋势判断",
        "",
        "Goose 完全替代 Claude Code。"
      ].join("\n"),
      "utf8"
    );
    await writeJson(join(outputDir, "article-meta.json"), articleMetaFixture());
    await writeJson(join(outputDir, "article-review.json"), articleReviewFixture());
    await writeFile(coverPath, "<svg />\n", "utf8");
    await writeJson(join(outputDir, "cover.json"), coverFixture(coverPath));
    await writeJson(join(outputDir, "cover-review.json"), coverReviewFixture(coverPath));

    const result = await renderWechatHtmlWithReport({
      outputDir,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.layout.compatibleWithWechat, true);
    assert.equal(result.layout.allowedNextStage, false);
    assert.ok(result.layout.warnings.length > 0);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("raw HTML review blocks next stage when restricted expressions remain in HTML", () => {
  const html = [
    '<section style="max-width:677px;font-size:16px;line-height:1.78;">',
    '<img src="outputs/covers/cover.svg" alt="cover" style="width:100%;">',
    "<h1>AI 编码代理真正卷到的，不是价格，而是工作流</h1>",
    "<h2>趋势判断</h2>",
    "<p>免费平替</p>",
    "</section>"
  ].join("");
  const checks = reviewWechatHtmlChecks(html, {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    coverImagePath: "outputs/covers/cover.svg"
  });

  assert.equal(checks.hasNoForbiddenPublishText, false);
  assert.equal(
    canEnterWechatDraftStage({
      checks,
      warnings: [],
      articleReviewPassed: true,
      coverReviewPassed: true
    }),
    false
  );
});

test("current generated WeChat layout is safe and allowed for next draft stage", async () => {
  const outputDir = join(process.cwd(), "outputs");
  const html = await readFile(join(outputDir, "wechat.html"), "utf8");
  const layout = JSON.parse(
    await readFile(join(outputDir, "wechat-layout.json"), "utf8")
  ) as WechatLayoutResult;

  for (const expression of [...forbiddenPublishTerms, ...forbiddenFactPackExpressions]) {
    assert.equal(
      html.includes(expression),
      false,
      `current HTML forbidden expression: ${expression}`
    );
  }

  assert.equal(layout.compatibleWithWechat, true);
  assert.equal(layout.allowedNextStage, true);
});
