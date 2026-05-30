import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateApimartImage } from "../src/adapters/apimart.js";
import { forceApimartImage } from "../src/hooks/forceApimartImage.js";
import { generateCoverWithReport } from "../src/pipeline/generateCover.js";
import type { ArticleMeta, ArticleReviewResult } from "../src/types/article.js";
import type { CoverResult, CoverReviewResult } from "../src/types/cover.js";
import type { TopicFactPack } from "../src/types/factPack.js";
import type { SelectedTopic } from "../src/types/news.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const bannedPromptTerms = [
  "Claude Logo",
  "Goose Logo",
  "$200",
  "免费平替",
  "完全替代",
  "Pixar",
  "pixar",
  "皮克斯",
  "Disney",
  "disney",
  "迪士尼"
];

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw5uWQAAAABJRU5ErkJggg==",
  "base64"
);

function apimartRealEnv(
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    COVER_ENABLE_REAL_API: "true",
    APIMART_API_KEY: "real-key-placeholder",
    APIMART_IMAGE_API_URL: "https://api.apimart.test/images",
    APIMART_IMAGE_MODEL: "gpt-image-2",
    APIMART_IMAGE_SIZE: "16:9",
    APIMART_IMAGE_RESOLUTION: "2k",
    COVER_IMAGE_PROVIDER: "apimart",
    COVER_IMAGE_SIZE: "900x383",
    COVER_OUTPUT_DIR: "outputs/covers",
    ...overrides
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function pngResponse(): Response {
  return new Response(onePixelPng, {
    status: 200,
    headers: {
      "content-type": "image/png"
    }
  });
}

function assertNoBannedPromptTerms(value: string): void {
  for (const term of bannedPromptTerms) {
    assert.equal(value.includes(term), false, `forbidden prompt term: ${term}`);
  }
}

function articleMarkdownFixture(): string {
  return [
    "AI 编码代理真正卷到的，不是价格，而是工作流",
    "",
    "AI coding agent 的竞争重点正在从价格和模型能力，转向开发者工作流入口。",
    "闭源订阅入口和开源工具链路径正在争夺开发者默认工作流。"
  ].join("\n");
}

function articleMetaFixture(): ArticleMeta {
  return {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    wordCount: 64,
    sourceTopic: "AI coding agent workflow entry competition",
    articleThesis: "编码代理竞争正在从模型能力转向工作流控制权。",
    usedClaims: [
      {
        claim: "Claude Code 与 Goose 都可归入 coding agent / developer agent 范畴。",
        safeWording:
          "两者都面向开发者自动化，能覆盖代码理解、文件修改、命令执行或项目级任务的一部分场景；但产品形态、模型后端、权限治理、交互体验和成熟度不同。",
        sourceUrls: ["https://example.com/agent-source"]
      },
      {
        claim: "Goose 是开源 AI agent，本体可免费获取和使用。",
        safeWording: "Goose 可安全表述为免费开源的本地 AI agent/开发者代理工具。",
        sourceUrls: ["https://example.com/open-toolchain"]
      },
      {
        claim: "Claude Code 的成本不只一种形态。",
        safeWording:
          "Claude Code 可以随订阅使用，也可能在 API Key/PAYG 或企业部署下产生不同费用，实际成本取决于计划、模型和用量。",
        sourceUrls: ["https://example.com/subscription-entry"]
      }
    ],
    riskControls: [
      "不写单一固定价格。",
      "不写无成本工具。",
      "不写能力等同或全量互换。"
    ],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function articleReviewFixture(): ArticleReviewResult {
  return {
    passed: true,
    score: 92,
    summary: "文章通过审核，可以进入封面图生成阶段。",
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
      themesCovered: ["开源", "工作流", "成本", "工具锁定"]
    },
    finalVerdict: "允许进入封面图生成阶段。",
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function selectedTopicFixture(): SelectedTopic {
  return {
    selected: {
      id: "fixture-cover-topic",
      title: "AI coding agent workflow entry competition",
      url: "https://example.com/agent-workflow",
      sourceName: "Example AI",
      sourceType: "manual",
      provider: "none",
      publishedAt: "2026-05-29T00:00:00.000Z",
      fetchedAt: "2026-05-29T00:00:00.000Z",
      summary: "Coding agent competition is shifting toward workflow entry points.",
      category: "tooling",
      evidence: ["source: Example AI"],
      duplicateKey: "fixture-cover-topic",
      scores: {
        freshness: 80,
        heat: 80,
        technicalValue: 90,
        wechatTopic: 92,
        businessImpact: 85,
        controversy: 45,
        final: 85
      },
      duplicateSources: [],
      tags: ["tooling", "open-source", "agent", "developer-workflow", "business"],
      shortlistScore: 86,
      shortlistMetrics: {
        technicalValue: 90,
        wechatTopic: 92,
        businessImpact: 85,
        controversy: 45,
        sourceCredibility: 80,
        explainability: 90,
        originality: 82
      },
      editorial: {
        shortlistReason: "工作流入口变化具备技术读者解释价值。",
        audienceFit: "开发者、技术团队和 AI 工具关注者。",
        topicAngle: "从工具价格争议转向工作流入口争夺。",
        recommendedUse: "main_topic_candidate"
      },
      selection: {
        selectedReason: "适合写成工作流入口之争。",
        whyMostWorthWriting: "能解释 coding agent 产品竞争变化。",
        coreConflict: "闭源订阅入口与开源工具链路径争夺开发者默认工作流。",
        publicInterest: "开发者需要判断工具选择和总成本。",
        technicalSignificance: "工作流自动化正在成为 coding agent 的关键价值。",
        businessImpact: "影响团队预算、数据流和工具链默认选择。",
        predictedImpact: "更多团队会同时评估产品化入口和可控工具链。",
        writingAngle: "从工作流入口而非单点价格分析。",
        suggestedTitles: ["AI 编码代理真正卷到的，不是价格，而是工作流"],
        articleThesis: "编码代理竞争正在从模型能力转向工作流控制权。",
        riskNotes: ["避免品牌标识和价格口号。"],
        sourceReliability: "medium",
        decisionScore: 86
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function factPackFixture(): TopicFactPack {
  return {
    topicTitle: "AI coding agent workflow entry competition",
    generatedAt: "2026-05-29T00:00:00.000Z",
    sourceReliability: "medium",
    verifiedClaims: [],
    comparison: {
      claudeCode: {
        pricing: "订阅、API 和企业部署都会影响实际成本。",
        positioning: "产品化编码代理入口。",
        capabilities: ["项目级编码任务", "工具连接"],
        sourceUrls: ["https://example.com/subscription-entry"]
      },
      goose: {
        pricing: "工具本体可免费获取，但模型调用取决于外部供应商。",
        positioning: "开源本地开发者代理工具。",
        capabilities: ["本地运行", "可选模型"],
        sourceUrls: ["https://example.com/open-toolchain"]
      },
      similarities: ["都面向开发者自动化。"],
      differences: ["一个偏产品化入口，一个偏可控工具链。"],
      unsafeComparisonClaims: ["能力等同或全量互换。"]
    },
    safeWritingBoundary: [
      "只写工作流重叠和路径差异，不写绝对胜负。",
      "不写具体价格口号。"
    ],
    riskNotes: ["避免把媒体标题当成事实结论。"],
    recommendedFraming:
      "这不是简单的工具替换，而是 coding agent 正在从付费产品变成可控工作流基础设施的一次信号。",
    articleAngleSuggestions: ["从工作流控制权解释 coding agent 竞争变化。"]
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCoverInputFiles(outputDir: string): Promise<void> {
  await writeFile(join(outputDir, "article.md"), articleMarkdownFixture(), "utf8");
  await writeJson(join(outputDir, "article-meta.json"), articleMetaFixture());
  await writeJson(join(outputDir, "article-review.json"), articleReviewFixture());
  await writeJson(join(outputDir, "selected-topic.json"), selectedTopicFixture());
  await writeJson(join(outputDir, "topic-fact-pack.json"), factPackFixture());
}

async function assertFileMissing(path: string): Promise<void> {
  await assert.rejects(() => access(path), /ENOENT/);
}

test("generateCoverWithReport writes APIMart mock cover outputs and review artifacts", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "cover-image-"));

  try {
    await writeCoverInputFiles(outputDir);

    const result = await generateCoverWithReport({
      outputDir,
      logger: silentLogger,
      env: {
        COVER_ENABLE_REAL_API: "false",
        APIMART_API_KEY: "present-but-disabled",
        COVER_IMAGE_PROVIDER: "apimart",
        COVER_IMAGE_SIZE: "900x383",
        COVER_OUTPUT_DIR: "outputs/covers"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await access(result.files.cover);
    await access(result.files.coverPrompt);
    await access(result.files.coverReview);
    await access(result.cover.imagePath);
    await assertFileMissing(join(outputDir, "wechat.html"));

    const cover = JSON.parse(await readFile(result.files.cover, "utf8")) as CoverResult;
    const review = JSON.parse(
      await readFile(result.files.coverReview, "utf8")
    ) as CoverReviewResult;
    const promptMarkdown = await readFile(result.files.coverPrompt, "utf8");
    const generatedPrompt = `${cover.imagePrompt}\n${cover.negativePrompt}`;

    assert.equal(cover.provider, "apimart");
    assert.equal(cover.mode, "mock");
    assert.equal(cover.imageSize, "900x383");
    assert.match(cover.visualRequirements.quality, /2K/);
    assert.match(cover.coverText, /[\u3400-\u9fff]/);
    assert.match(cover.imagePrompt, /visual center/i);
    assert.match(cover.imagePrompt, /central subject/i);
    assert.equal(cover.review.passed, true);

    assertNoBannedPromptTerms(generatedPrompt);
    assertNoBannedPromptTerms(promptMarkdown);

    assert.equal(review.passed, true);
    assert.equal(review.checks.coverTextIsChinese, true);
    assert.equal(review.checks.hasVisualCenter, true);
    assert.equal(review.checks.imageSizeIs900x383, true);
    assert.equal(review.checks.declares2KQuality, true);
    assert.equal(review.checks.usesSafeAnimatedMovieStyle, true);
    assert.equal(review.checks.mentionsChineseHeadline, true);
    assert.equal(review.checks.mentionsSafeMargins, true);
    assert.equal(review.checks.providerIsApimart, true);
    assert.equal(review.checks.realApiModeProducesRealCover, true);
    assert.equal(review.checks.realApiModeDoesNotReturnMockSvg, true);
    assert.equal(review.checks.imagePathAvailable, true);
    assert.equal(review.checks.embeddedReviewPassed, true);

    assert.match(promptMarkdown, /文章标题/);
    assert.match(promptMarkdown, /封面中文大标题/);
    assert.match(promptMarkdown, /中文设计说明/);
    assert.match(promptMarkdown, /English Image Prompt/);
    assert.match(promptMarkdown, /Negative Prompt/);
    assert.match(promptMarkdown, /设计风格说明/);
    assert.match(promptMarkdown, /视觉中心说明/);
    assert.match(promptMarkdown, /900x383/);
    assert.match(promptMarkdown, /2K/);
    assert.match(promptMarkdown, /禁止元素/);
    assert.match(promptMarkdown, /provider: apimart/);
    assert.match(promptMarkdown, /mode: mock/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generateCoverWithReport sanitizes APIMART_COVER_STYLE studio names while preserving style intent", async () => {
  const cases: Array<[string, string]> = [
    [
      "Pixar-inspired warm friendly story-driven cover, clean composition, clear subject, horizontal 900x383px, prominent Chinese headline inside safe margins",
      "warm friendly 3D animated movie style warm friendly story-driven cover"
    ],
    [
      "皮克斯 warm friendly story-driven cover, clean composition, clear subject, horizontal 900x383px, prominent Chinese headline inside safe margins",
      "3D 动画电影质感 warm friendly story-driven cover"
    ],
    [
      "Disney disney 迪士尼 warm friendly story-driven cover, clean composition, clear subject, horizontal 900x383px, prominent Chinese headline inside safe margins",
      "animated family film animated family film 动画电影质感 warm friendly story-driven cover"
    ]
  ];

  for (const [style, expectedSanitizedFragment] of cases) {
    const outputDir = await mkdtemp(join(tmpdir(), "cover-image-style-"));

    try {
      await writeCoverInputFiles(outputDir);

      const result = await generateCoverWithReport({
        outputDir,
        logger: silentLogger,
        env: {
          COVER_ENABLE_REAL_API: "false",
          COVER_IMAGE_PROVIDER: "apimart",
          COVER_IMAGE_SIZE: "900x383",
          COVER_OUTPUT_DIR: "outputs/covers",
          APIMART_COVER_STYLE: style
        },
        now: new Date("2026-05-29T00:00:00.000Z")
      });
      const cover = JSON.parse(await readFile(result.files.cover, "utf8")) as CoverResult;
      const promptMarkdown = await readFile(result.files.coverPrompt, "utf8");
      const generatedPrompt = `${cover.imagePrompt}\n${cover.negativePrompt}\n${promptMarkdown}`;

      assertNoBannedPromptTerms(generatedPrompt);
      assert.match(cover.imagePrompt, /3D animated movie style/i);
      assert.match(cover.imagePrompt, /warm friendly/i);
      assert.match(cover.imagePrompt, /story-driven/i);
      assert.match(cover.imagePrompt, /clean composition/i);
      assert.match(cover.imagePrompt, /clear subject/i);
      assert.match(cover.imagePrompt, /horizontal 900x383px/i);
      assert.match(cover.imagePrompt, /prominent Chinese headline/i);
      assert.match(cover.imagePrompt, /safe margins/i);
      assert.match(cover.imagePrompt, new RegExp(expectedSanitizedFragment));
      assert.equal(result.review.passed, true);
      assert.equal(result.review.checks.doesNotNameSpecificStudios, true);
      assert.equal(result.review.checks.usesSafeAnimatedMovieStyle, true);
      assert.equal(result.review.checks.mentionsSafeMargins, true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});

test("generateCoverWithReport writes real APIMart cover outputs when real API returns b64_json", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "cover-image-real-report-"));
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCalls.push({
      input: input.toString(),
      init
    });

    return jsonResponse({
      data: [
        {
          b64_json: onePixelPng.toString("base64")
        }
      ]
    });
  };

  try {
    await writeCoverInputFiles(outputDir);

    const result = await generateCoverWithReport({
      outputDir,
      logger: silentLogger,
      env: apimartRealEnv(),
      now: new Date("2026-05-29T00:00:00.000Z"),
      fetchImpl
    });

    await access(result.cover.imagePath);

    const cover = JSON.parse(await readFile(result.files.cover, "utf8")) as CoverResult;
    const savedBytes = await readFile(result.cover.imagePath);
    const requestBody = JSON.parse(
      fetchCalls[0]?.init?.body?.toString() ?? "{}"
    ) as Record<string, unknown>;
    const requestHeaders = new Headers(fetchCalls[0]?.init?.headers);

    assert.equal(result.cover.provider, "apimart");
    assert.equal(result.cover.mode, "real");
    assert.equal(cover.mode, "real");
    assert.match(result.cover.imagePath, /\/covers\/cover-apimart-real-.*\.png$/);
    assert.deepEqual(savedBytes, onePixelPng);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(Object.keys(requestBody).sort(), [
      "model",
      "n",
      "prompt",
      "resolution",
      "size"
    ]);
    assert.equal(requestBody.model, "gpt-image-2");
    assert.equal(requestBody.n, 1);
    assert.equal(requestBody.size, "16:9");
    assert.equal(requestBody.resolution, "2k");
    assert.match(String(requestBody.prompt), /900x383/);
    assert.match(String(requestBody.prompt), /3D animated movie quality/i);
    assert.match(String(requestBody.prompt), /2K/);
    assert.match(String(requestBody.prompt), /AI 编码代理/);
    assert.match(String(requestBody.prompt), /Article title/);
    assert.match(String(requestBody.prompt), /Core viewpoint/);
    assert.match(String(requestBody.prompt), /safe margins/);
    assert.equal(requestHeaders.get("authorization"), "Bearer real-key-placeholder");

    assertNoBannedPromptTerms(String(requestBody.prompt));
    assert.equal(result.review.checks.realApiModeProducesRealCover, true);
    assert.equal(result.review.checks.realApiModeDoesNotReturnMockSvg, true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("forceApimartImage rejects missing or non-APIMart providers", () => {
  assert.doesNotThrow(() => forceApimartImage("apimart"));
  assert.throws(() => forceApimartImage("openai"), /must be apimart/i);
  assert.throws(() => forceApimartImage(""), /provider is required/i);
  assert.throws(() => forceApimartImage(undefined), /provider is required/i);
});

test("generateCoverWithReport rejects non-APIMart provider configuration", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "cover-image-provider-"));

  try {
    await writeCoverInputFiles(outputDir);

    await assert.rejects(
      () =>
        generateCoverWithReport({
          outputDir,
          logger: silentLogger,
          env: {
            COVER_ENABLE_REAL_API: "false",
            COVER_IMAGE_PROVIDER: "replicate",
            COVER_IMAGE_SIZE: "900x383"
          },
          now: new Date("2026-05-29T00:00:00.000Z")
        }),
      /must be apimart/i
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generateApimartImage real mode accepts APIMart data[0].url, image_url, and url responses", async () => {
  const responseCases: Array<[string, unknown]> = [
    ["data[0].url", { data: [{ url: "https://cdn.apimart.test/data-url.png" }] }],
    ["image_url", { image_url: "https://cdn.apimart.test/image-url.png" }],
    ["url", { url: "https://cdn.apimart.test/top-url.png" }]
  ];

  for (const [caseName, payload] of responseCases) {
    const outputDir = await mkdtemp(join(tmpdir(), `cover-image-real-${caseName}-`));
    const fetchCalls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      fetchCalls.push(input.toString());

      if (fetchCalls.length === 1) {
        return jsonResponse(payload);
      }

      return pngResponse();
    };

    try {
      const result = await generateApimartImage({
        provider: "apimart",
        imagePrompt:
          "Create a 900x383 cover with clear visual center, central subject, Chinese headline, and 2K quality.",
        negativePrompt: "real brand marks, official product marks, price labels",
        coverText: "AI 编码代理\n卷向工作流",
        imageSize: "900x383",
        outputDir,
        env: apimartRealEnv(),
        now: new Date("2026-05-29T00:00:00.000Z"),
        fetchImpl
      });
      const savedBytes = await readFile(result.imagePath);

      assert.equal(result.provider, "apimart", caseName);
      assert.equal(result.mode, "real", caseName);
      assert.equal(result.realApiCalled, true, caseName);
      assert.match(result.imagePath, /\.png$/, caseName);
      assert.deepEqual(savedBytes, onePixelPng, caseName);
      assert.equal(fetchCalls.length, 2, caseName);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});

test("generateApimartImage real mode accepts a binary PNG image response", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "cover-image-real-binary-"));
  const fetchImpl: typeof fetch = async () => pngResponse();

  try {
    const result = await generateApimartImage({
      provider: "apimart",
      imagePrompt:
        "Create a 900x383 cover with clear visual center, central subject, Chinese headline, and 2K quality.",
      negativePrompt: "real brand marks, official product marks, price labels",
      coverText: "AI 编码代理\n卷向工作流",
      imageSize: "900x383",
      outputDir,
      env: apimartRealEnv(),
      now: new Date("2026-05-29T00:00:00.000Z"),
      fetchImpl
    });
    const savedBytes = await readFile(result.imagePath);

    assert.equal(result.mode, "real");
    assert.equal(result.realApiCalled, true);
    assert.match(result.imagePath, /\.png$/);
    assert.deepEqual(savedBytes, onePixelPng);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generateApimartImage real mode blocks when APIMART_API_KEY is missing", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "cover-image-real-no-key-"));

  try {
    await assert.rejects(
      () =>
        generateApimartImage({
          provider: "apimart",
          imagePrompt:
            "Create a 900x383 cover with clear visual center, central subject, Chinese headline, and 2K quality.",
          negativePrompt: "real brand marks, official product marks, price labels",
          coverText: "AI 编码代理\n卷向工作流",
          imageSize: "900x383",
          outputDir,
          env: apimartRealEnv({ APIMART_API_KEY: "" }),
          now: new Date("2026-05-29T00:00:00.000Z")
        }),
      /COVER_ENABLE_REAL_API=true requires APIMART_API_KEY/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generateApimartImage real mode blocks when APIMART_IMAGE_API_URL is missing", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "cover-image-real-no-url-"));

  try {
    await assert.rejects(
      () =>
        generateApimartImage({
          provider: "apimart",
          imagePrompt:
            "Create a 900x383 cover with clear visual center, central subject, Chinese headline, and 2K quality.",
          negativePrompt: "real brand marks, official product marks, price labels",
          coverText: "AI 编码代理\n卷向工作流",
          imageSize: "900x383",
          outputDir,
          env: apimartRealEnv({ APIMART_IMAGE_API_URL: "" }),
          now: new Date("2026-05-29T00:00:00.000Z")
        }),
      /COVER_ENABLE_REAL_API=true requires APIMART_IMAGE_API_URL/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generateApimartImage real mode does not fallback to mock when APIMart response lacks image data", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "cover-image-real-no-fallback-"));
  const fetchImpl: typeof fetch = async () => jsonResponse({ data: [{}] });

  try {
    await assert.rejects(
      () =>
        generateApimartImage({
          provider: "apimart",
          imagePrompt:
            "Create a 900x383 cover with clear visual center, central subject, Chinese headline, safe margins, and 2K quality.",
          negativePrompt: "real brand marks, official product marks, price labels",
          coverText: "AI 编码代理\n卷向工作流",
          imageSize: "900x383",
          outputDir,
          env: apimartRealEnv(),
          now: new Date("2026-05-29T00:00:00.000Z"),
          fetchImpl
        }),
      /did not include data\[0\]\.url/
    );
    await assertFileMissing(
      join(outputDir, "cover-apimart-mock-2026-05-29T00-00-00-000Z.svg")
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
