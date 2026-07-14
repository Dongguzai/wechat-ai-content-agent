import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runDailyAuto,
  type RunDailyAutoOptions
} from "../scripts/run-daily-auto.js";
import { writeWechatDraftRunLock } from "../src/pipeline/wechatDraftRunLock.js";
import type { DailyAutoResult } from "../src/types/dailyAuto.js";

interface TempAutoRun {
  root: string;
  outputDir: string;
  logFile: string;
  lockDir: string;
  runsDir: string;
}

async function createTempAutoRun(prefix: string): Promise<TempAutoRun> {
  const root = await mkdtemp(join(tmpdir(), prefix));

  return {
    root,
    outputDir: join(root, "outputs"),
    logFile: join(root, "logs", "daily-auto.log"),
    lockDir: join(root, "locks"),
    runsDir: join(root, "runs")
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function completeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    REAL_PRODUCTION_MODE: "true",
    LLM_PROVIDER: "minimax",
    LLM_ENABLE_REAL_API: "true",
    LLM_DRY_RUN: "false",
    MINIMAX_API_KEY: "MINIMAX_KEY_VALUE",
    MINIMAX_MODEL: "minimax-m3-test",
    RSS_ENABLE_REAL_FETCH: "true",
    SEARCH_ENABLE_REAL_API: "true",
    TAVILY_API_KEY: "TAVILY_KEY_VALUE",
    COVER_ENABLE_REAL_API: "true",
    APIMART_API_KEY: "APIMART_KEY_VALUE",
    APIMART_IMAGE_API_URL: "https://api.apimart.test/images",
    WECHAT_API_ENABLE_REAL_DRAFT: "true",
    WECHAT_DRAFT_ALLOW_REAL_API: "true",
    WECHAT_DRAFT_DRY_RUN: "true",
    WECHAT_APP_ID: "APP_ID_VALUE",
    WECHAT_APP_SECRET: "APP_SECRET_VALUE",
    WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
    WECHAT_FORBID_PUBLISH: "true",
    WECHAT_FORBID_MASS_SEND: "true",
    ...overrides
  };
}

async function writeDraftFixture(outputDir: string): Promise<void> {
  const coverDir = join(outputDir, "covers");
  const coverPath = join(coverDir, "cover.svg");

  await mkdir(coverDir, { recursive: true });
  await writeFile(
    join(outputDir, "article.md"),
    [
      "# AI 编码代理真正卷到的，不是价格，而是工作流",
      "",
      "## 趋势判断",
      "",
      "编码代理竞争正在转向工作流控制权。"
    ].join("\n"),
    "utf8"
  );
  await writeJson(join(outputDir, "article-meta.json"), {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    wordCount: 1201,
    sourceTopic: "coding agent workflow",
    articleThesis: "编码代理竞争正在转向工作流控制权。",
    usedClaims: [],
    riskControls: [],
    generatedAt: "2026-05-29T00:00:00.000Z"
  });
  await writeJson(join(outputDir, "article-review.json"), {
    passed: true,
    score: 98,
    summary: "文章通过审核。",
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
    finalVerdict: "允许进入下一阶段。",
    generatedAt: "2026-05-29T00:00:00.000Z"
  });
  await writeFile(coverPath, "<svg />\n", "utf8");
  await writeJson(join(outputDir, "cover.json"), {
    provider: "apimart",
    mode: "mock",
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    coverText: "AI 编码代理\n卷向工作流",
    imagePrompt: "Mock cover prompt.",
    negativePrompt: "No real brand marks.",
    imageSize: "900x383",
    imagePath: coverPath,
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
  });
  await writeJson(join(outputDir, "cover-review.json"), {
    provider: "apimart",
    mode: "mock",
    imageSize: "900x383",
    imagePath: coverPath,
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
  });
  await writeFile(
    join(outputDir, "wechat.html"),
    '<section style="font-size:16px;line-height:1.78;"><h1>AI 编码代理真正卷到的，不是价格，而是工作流</h1><p>正文 HTML。</p></section>',
    "utf8"
  );
  await writeJson(join(outputDir, "wechat-layout.json"), {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    digest: "编码代理的主战场正在从模型能力转向工作流控制权。",
    htmlPath: "outputs/wechat.html",
    coverImagePath: coverPath,
    style: "stripe-inspired",
    compatibleWithWechat: true,
    htmlChecks: {
      hasInlineStyles: true,
      hasNoExternalCss: true,
      hasNoJavascript: true,
      hasNoIframe: true,
      hasNoForbiddenPublishText: true,
      hasTitle: true,
      hasCoverImage: true,
      hasHeadings: true,
      mobileReadable: true
    },
    warnings: [],
    generatedAt: "2026-05-29T00:00:00.000Z",
    allowedNextStage: true
  });
  await writeJson(join(outputDir, "topic-fact-pack.json"), {
    schemaVersion: "2.0",
    topicId: "fixture-daily-auto-dry-run",
    topicTitle: "AI 编码代理真正卷到的，不是价格，而是工作流",
    generatedAt: "2026-05-29T00:00:00.000Z",
    entities: [],
    sourceReliability: "medium",
    sourceReliabilityReason: "测试夹具使用最小事实包结构。",
    claims: [],
    unsupportedClaims: [],
    conflictingClaims: [],
    verifiedClaims: [],
    safeWritingBoundary: [],
    riskNotes: [],
    recommendedFraming: "",
    articleAngleSuggestions: [],
    sourceEvidenceIds: []
  });
}

async function writeProductionDraftFixture(outputDir: string): Promise<void> {
  const coverDir = join(outputDir, "covers");
  const coverPath = join(coverDir, "cover.png");
  const sourceUrls = [
    "https://openai.com/news/source-a",
    "https://www.anthropic.com/news/source-b",
    "https://github.com/block/goose"
  ];
  const baseNewsItem = {
    id: "real-rss-item",
    dataMode: "real",
    mock: false,
    title: "OpenAI ships a real AI agent workflow update",
    url: "https://openai.com/news/real-ai-agent-workflow",
    sourceName: "OpenAI News",
    sourceType: "rss",
    provider: "none",
    publishedAt: "2026-05-29T00:00:00.000Z",
    fetchedAt: "2026-05-29T00:00:00.000Z",
    summary: "A real AI agent workflow update with source URL.",
    category: "tooling",
    evidence: ["source: OpenAI News"],
    duplicateKey: "real-rss-item",
    scores: {
      freshness: 90,
      heat: 80,
      technicalValue: 88,
      wechatTopic: 86,
      businessImpact: 82,
      controversy: 35,
      final: 84
    },
    duplicateSources: [],
    tags: ["tooling", "agent", "developer-workflow"],
    shortlistScore: 86,
    shortlistMetrics: {
      technicalValue: 88,
      wechatTopic: 86,
      businessImpact: 82,
      controversy: 35,
      sourceCredibility: 90,
      explainability: 88,
      originality: 86
    },
    editorial: {
      shortlistReason: "Real source is suitable for production.",
      audienceFit: "Developers and AI product readers.",
      topicAngle: "AI agent workflow is changing production work.",
      recommendedUse: "main_topic_candidate"
    }
  };
  const selectedTopic = {
    selected: {
      ...baseNewsItem,
      selection: {
        selectedReason: "Real production source selected.",
        whyMostWorthWriting: "It has a real URL and verifiable source claims.",
        coreConflict: "AI agent workflow value versus production risk.",
        publicInterest: "Readers can understand the workflow impact.",
        technicalSignificance: "The update affects agent tooling.",
        businessImpact: "Teams may change tooling choices.",
        predictedImpact: "More teams evaluate agent workflows.",
        writingAngle: "Explain the production workflow shift.",
        suggestedTitles: ["AI Agent 工作流进入真实生产"],
        articleThesis: "AI agent workflows are becoming production infrastructure.",
        riskNotes: ["Keep facts sourced."],
        sourceReliability: "medium",
        decisionScore: 88
      }
    },
    runnersUp: [],
    rejected: [],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
  const usedClaims = sourceUrls.map((url, index) => ({
    claim: `Used production claim ${index + 1}`,
    safeWording: `Safe wording ${index + 1}`,
    sourceUrls: [url]
  }));
  const factClaims = sourceUrls.map((url, index) => ({
    claim: `Verified production claim ${index + 1}`,
    status: "verified",
    sourceUrls: [url],
    safeWording: `Safe wording ${index + 1}`,
    risk: "low"
  }));
  const dynamicClaims = factClaims.map((claim, index) => ({
    id: `fixture-claim-${index + 1}`,
    statement: claim.claim,
    status: "verified",
    evidenceIds: [`fixture-evidence-${index + 1}`],
    sourceUrls: claim.sourceUrls,
    confidence: 0.9,
    safeWording: claim.safeWording,
    requiredQualifiers: ["据来源显示"],
    forbiddenWording: [],
    riskDimensions: ["source quality"]
  }));

  await mkdir(coverDir, { recursive: true });
  await writeFile(
    join(outputDir, "article.md"),
    [
      "# AI Agent 工作流进入真实生产",
      "",
      "## 趋势判断",
      "",
      "编码代理竞争正在转向真实生产工作流。"
    ].join("\n"),
    "utf8"
  );
  await writeJson(join(outputDir, "article-meta.json"), {
    title: "AI Agent 工作流进入真实生产",
    wordCount: 1201,
    sourceTopic: "real AI agent workflow",
    articleThesis: "AI agent workflows are becoming production infrastructure.",
    usedClaims,
    riskControls: ["source facts", "avoid overclaiming", "keep human review"],
    generatedAt: "2026-05-29T00:00:00.000Z",
    llm: {
      provider: "minimax",
      model: "minimax-m3-test",
      mode: "real",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      }
    }
  });
  await writeJson(join(outputDir, "title-candidates.json"), {
    generatedAt: "2026-05-29T00:00:00.000Z",
    selectedTitle: "AI Agent 工作流进入真实生产",
    selectedKind: "judgement",
    candidates: [],
    forbiddenTerms: [],
    llm: {
      provider: "minimax",
      model: "minimax-m3-test",
      mode: "real",
      usage: {
        promptTokens: 11,
        completionTokens: 12,
        totalTokens: 23
      }
    }
  });
  await writeJson(join(outputDir, "article-review.json"), {
    passed: true,
    score: 98,
    summary: "文章通过审核。",
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
    finalVerdict: "允许进入下一阶段。",
    generatedAt: "2026-05-29T00:00:00.000Z",
    llm: {
      provider: "minimax",
      model: "minimax-m3-test",
      mode: "rules+real",
      usage: {
        promptTokens: 13,
        completionTokens: 14,
        totalTokens: 27
      }
    }
  });
  await writeJson(join(outputDir, "candidate-news.json"), [baseNewsItem]);
  await writeJson(join(outputDir, "shortlisted-news.json"), [baseNewsItem]);
  await writeJson(join(outputDir, "selected-topic.json"), selectedTopic);
  await writeFile(join(outputDir, "collection-report.md"), "# Collection\n\n- real only\n", "utf8");
  await writeJson(join(outputDir, "topic-fact-pack.json"), {
    schemaVersion: "2.0",
    topicId: "fixture-daily-auto-real-data",
    topicTitle: "OpenAI ships a real AI agent workflow update",
    generatedAt: "2026-05-29T00:00:00.000Z",
    entities: [],
    sourceReliability: "medium",
    sourceReliabilityReason: "测试夹具使用真实来源 URL。",
    claims: dynamicClaims,
    unsupportedClaims: [],
    conflictingClaims: [],
    verifiedClaims: factClaims,
    safeWritingBoundary: [],
    riskNotes: [],
    recommendedFraming: "Use verified sources only.",
    articleAngleSuggestions: [],
    sourceEvidenceIds: dynamicClaims.flatMap((claim) => claim.evidenceIds)
  });
  await writeFile(coverPath, "png\n", "utf8");
  await writeJson(join(outputDir, "cover.json"), {
    provider: "apimart",
    mode: "real",
    title: "AI Agent 工作流进入真实生产",
    coverText: "AI Agent\n真实生产",
    imagePrompt: "Real cover prompt.",
    negativePrompt: "No brand marks.",
    imageSize: "900x383",
    imagePath: coverPath,
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
  });
  await writeJson(join(outputDir, "cover-review.json"), {
    provider: "apimart",
    mode: "real",
    imageSize: "900x383",
    imagePath: coverPath,
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
  });
  await writeFile(
    join(outputDir, "wechat.html"),
    '<section style="font-size:16px;line-height:1.78;"><h1>AI Agent 工作流进入真实生产</h1><p>正文 HTML。</p></section>',
    "utf8"
  );
  await writeJson(join(outputDir, "wechat-layout.json"), {
    title: "AI Agent 工作流进入真实生产",
    digest: "编码代理的主战场正在从模型能力转向工作流控制权。",
    htmlPath: "outputs/wechat.html",
    coverImagePath: coverPath,
    style: "stripe-inspired",
    compatibleWithWechat: true,
    htmlChecks: {
      hasInlineStyles: true,
      hasNoExternalCss: true,
      hasNoJavascript: true,
      hasNoIframe: true,
      hasNoForbiddenPublishText: true,
      hasTitle: true,
      hasCoverImage: true,
      hasHeadings: true,
      mobileReadable: true
    },
    warnings: [],
    generatedAt: "2026-05-29T00:00:00.000Z",
    allowedNextStage: true
  });
}

function successHandlers(
  calls: string[] = []
): NonNullable<RunDailyAutoOptions["stepHandlers"]> {
  return {
    "run:daily": async () => {
      calls.push("run:daily");
      return {
        selectedTitle: "自动选题标题",
        message: "daily ok"
      };
    },
    "real-data-audit": async () => {
      calls.push("real-data-audit");
      return {
        message: "real data audit ok"
      };
    },
    "wechat:draft:dry-run": async () => {
      calls.push("wechat:draft:dry-run");
      return {
        message: "dry-run ok"
      };
    },
    "preflight:final": async () => {
      calls.push("preflight:final");
      return {
        message: "preflight ok"
      };
    },
    "wechat:draft:real": async () => {
      calls.push("wechat:draft:real");
      return {
        selectedTitle: "自动选题标题",
        draftMediaId: "DRAFT_MEDIA_ID_VALUE",
        message: "real draft ok"
      };
    }
  };
}

async function runTempAuto(
  temp: TempAutoRun,
  options: RunDailyAutoOptions = {}
): Promise<DailyAutoResult> {
  return runDailyAuto({
    outputDir: temp.outputDir,
    logFile: temp.logFile,
    lockDir: temp.lockDir,
    runsDir: temp.runsDir,
    now: new Date(2026, 4, 29, 9, 0, 0),
    env: completeEnv(),
    loadEnv: false,
    consoleOutput: false,
    archiveRuns: false,
    ...options
  });
}

async function readAutoOutputs(temp: TempAutoRun): Promise<string> {
  return (
    await Promise.all([
      readFile(join(temp.outputDir, "daily-auto-result.json"), "utf8"),
      readFile(join(temp.outputDir, "daily-auto-report.md"), "utf8"),
      readFile(temp.logFile, "utf8")
    ])
  ).join("\n");
}

test("run:daily:auto blocks when WECHAT_APP_ID is missing", async () => {
  const temp = await createTempAutoRun("daily-auto-no-appid-");

  try {
    const result = await runTempAuto(temp, {
      env: completeEnv({ WECHAT_APP_ID: "" }),
      stepHandlers: successHandlers()
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /WECHAT_APP_ID/);
    assert.equal(
      result.steps.find((step) => step.name === "run:daily")?.status,
      "skipped"
    );
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("run:daily:auto blocks when WECHAT_APP_SECRET is missing", async () => {
  const temp = await createTempAutoRun("daily-auto-no-secret-");

  try {
    const result = await runTempAuto(temp, {
      env: completeEnv({ WECHAT_APP_SECRET: "" }),
      stepHandlers: successHandlers()
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /WECHAT_APP_SECRET/);
    assert.equal(
      result.steps.find((step) => step.name === "run:daily")?.status,
      "skipped"
    );
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("run:daily:auto blocks when REAL_PRODUCTION_MODE=true is missing", async () => {
  const temp = await createTempAutoRun("daily-auto-no-real-production-mode-");

  try {
    const result = await runTempAuto(temp, {
      env: completeEnv({ REAL_PRODUCTION_MODE: "false" }),
      stepHandlers: successHandlers()
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /REAL_PRODUCTION_MODE/);
    assert.equal(
      result.steps.find((step) => step.name === "run:daily")?.status,
      "skipped"
    );
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("run:daily:auto blocks when APIMART_API_KEY is missing", async () => {
  const temp = await createTempAutoRun("daily-auto-no-apimart-key-");

  try {
    const result = await runTempAuto(temp, {
      env: completeEnv({ APIMART_API_KEY: "" }),
      stepHandlers: successHandlers()
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /APIMART_API_KEY/);
    assert.equal(
      result.steps.find((step) => step.name === "run:daily")?.status,
      "skipped"
    );
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("run:daily:auto writes draft only and does not expose secrets or credentials", async () => {
  const temp = await createTempAutoRun("daily-auto-complete-");
  const calls: string[] = [];

  try {
    const result = await runTempAuto(temp, {
      env: completeEnv({
        WECHAT_APP_SECRET: "SUPER_SECRET_SHOULD_NOT_APPEAR"
      }),
      stepHandlers: {
        "run:daily": async () => {
          await writeProductionDraftFixture(temp.outputDir);
          return {
            selectedTitle: "AI Agent 工作流进入真实生产",
            message: "production fixture daily output ready"
          };
        }
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes("/cgi-bin/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ACCESS_TOKEN_SHOULD_NOT_APPEAR",
              expires_in: 7200
            })
          );
        }

        if (url.includes("/cgi-bin/draft/add")) {
          const body = JSON.parse(String(init?.body));
          assert.equal(body.articles[0].thumb_media_id, "THUMB_MEDIA_ID_VALUE");
          return new Response(
            JSON.stringify({
              media_id: "DRAFT_MEDIA_ID_VALUE"
            })
          );
        }

        throw new Error(`unexpected URL ${url}`);
      }
    });
    const saved = JSON.parse(
      await readFile(join(temp.outputDir, "daily-auto-result.json"), "utf8")
    ) as DailyAutoResult;
    const outputText = await readAutoOutputs(temp);

    assert.equal(result.status, "success");
    assert.equal(saved.status, "success");
    assert.equal(saved.mode, "daily_auto");
    assert.equal(typeof saved.startedAt, "string");
    assert.equal(typeof saved.finishedAt, "string");
    assert.equal(typeof saved.durationMs, "number");
    assert.equal(saved.draftOnly, true);
    assert.equal(saved.publishApiCalled, false);
    assert.equal(saved.massSendApiCalled, false);
    assert.equal(saved.requiresHumanConfirmation, true);
    assert.equal(
      saved.selectedTopicUrl,
      "https://openai.com/news/real-ai-agent-workflow"
    );
    assert.match(saved.coverImagePath ?? "", /cover\.png$/);
    assert.equal(saved.draftMediaId, "DRAFT_MEDIA_ID_VALUE");
    assert.equal(
      calls.some((url) => /freepublish|mass|sendall|publish/i.test(url)),
      false
    );
    assert.doesNotMatch(outputText, /SUPER_SECRET_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(outputText, /MINIMAX_KEY_VALUE/);
    assert.doesNotMatch(outputText, /ACCESS_TOKEN_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(outputText, /\baccess_token\b/i);
    await access(join(temp.outputDir, "daily-auto-result.json"));
    await access(join(temp.outputDir, "daily-auto-report.md"));
    await access(join(temp.root, "runs", "2026-05-29-090000", "run-report.md"));
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("run:daily:auto marks later steps skipped after a step failure", async () => {
  const temp = await createTempAutoRun("daily-auto-step-failure-");

  try {
    const result = await runTempAuto(temp, {
      stepHandlers: {
        "run:daily": async () => ({
          selectedTitle: "自动选题标题",
          message: "daily ok"
        }),
        "real-data-audit": async () => ({
          message: "real data audit ok"
        }),
        "wechat:draft:dry-run": async () => {
          throw new Error("dry-run failed intentionally");
        },
        "preflight:final": async () => {
          throw new Error("preflight should be skipped");
        },
        "wechat:draft:real": async () => {
          throw new Error("real draft should be skipped");
        }
      }
    });

    assert.equal(result.status, "failed");
    assert.equal(
      result.steps.find((step) => step.name === "wechat:draft:dry-run")?.status,
      "failed"
    );
    assert.equal(
      result.steps.find((step) => step.name === "preflight:final")?.status,
      "skipped"
    );
    assert.equal(
      result.steps.find((step) => step.name === "wechat:draft:real")?.status,
      "skipped"
    );
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("run:daily:auto report notes MiniMax JSON blocking report", async () => {
  const temp = await createTempAutoRun("daily-auto-llm-json-failure-");

  try {
    const result = await runTempAuto(temp, {
      stepHandlers: {
        "run:daily": async (context) => {
          await mkdir(context.outputDir, { recursive: true });
          await writeJson(join(context.outputDir, "llm-json-error.json"), {
            failedStep: "article-writer",
            provider: "minimax",
            model: "minimax-m3-test",
            expectedJsonShape: '{ "title": "..." }',
            parseError: "invalid JSON",
            contentPreview: "{ bad",
            retryAttempted: true,
            retrySucceeded: false,
            suggestedFix: "fix prompt",
            generatedAt: new Date().toISOString()
          });
          throw new Error(
            "MiniMax JSON output could not be accepted for article-writer"
          );
        }
      }
    });

    assert.equal(result.status, "failed");
    const report = await readFile(join(temp.outputDir, "daily-auto-report.md"), "utf8");
    assert.match(report, /MiniMax 返回非合法 JSON，已阻断正式草稿创建/);
    assert.match(report, /llm-json-error-report\.md/);
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("same-day draft lock blocks run:daily:auto by default", async () => {
  const temp = await createTempAutoRun("daily-auto-lock-blocked-");
  const calls: string[] = [];

  try {
    await writeWechatDraftRunLock({
      lockDir: temp.lockDir,
      mediaId: "EXISTING_DRAFT_MEDIA_ID",
      title: "已有草稿标题",
      now: new Date(2026, 4, 29, 8, 0, 0)
    });

    const result = await runTempAuto(temp, {
      stepHandlers: successHandlers(calls)
    });
    const report = await readFile(
      join(temp.outputDir, "daily-auto-report.md"),
      "utf8"
    );

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /same-day draft lock/);
    assert.deepEqual(calls, []);
    assert.equal(
      result.steps.find((step) => step.name === "same-day draft lock")?.status,
      "failed"
    );
    assert.match(report, /是否被同日真实草稿锁阻断: 是/);
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("--force allows run:daily:auto to bypass same-day draft lock", async () => {
  const temp = await createTempAutoRun("daily-auto-lock-force-");
  const calls: string[] = [];

  try {
    await writeWechatDraftRunLock({
      lockDir: temp.lockDir,
      mediaId: "EXISTING_DRAFT_MEDIA_ID",
      title: "已有草稿标题",
      now: new Date(2026, 4, 29, 8, 0, 0)
    });

    const result = await runTempAuto(temp, {
      force: true,
      stepHandlers: successHandlers(calls)
    });

    assert.equal(result.status, "success");
    assert.equal(result.draftMediaId, "DRAFT_MEDIA_ID_VALUE");
    assert.deepEqual(calls, [
      "run:daily",
      "real-data-audit",
      "wechat:draft:dry-run",
      "preflight:final",
      "wechat:draft:real"
    ]);
    assert.equal(
      result.steps.find((step) => step.name === "same-day draft lock")?.status,
      "success"
    );
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("REAL_PRODUCTION_MODE=true runs real-data-audit and does not call publish APIs", async () => {
  const temp = await createTempAutoRun("daily-auto-production-");
  const calls: string[] = [];

  try {
    const result = await runTempAuto(temp, {
      env: completeEnv({
        REAL_PRODUCTION_MODE: "true",
        RSS_ENABLE_REAL_FETCH: "true",
        SEARCH_ENABLE_REAL_API: "true",
        TAVILY_API_KEY: "TAVILY_KEY_VALUE",
        COVER_ENABLE_REAL_API: "true"
      }),
      stepHandlers: {
        "run:daily": async () => {
          await writeProductionDraftFixture(temp.outputDir);
          return {
            selectedTitle: "AI Agent 工作流进入真实生产",
            message: "production fixture daily output ready"
          };
        }
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes("/cgi-bin/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ACCESS_TOKEN_SHOULD_NOT_APPEAR",
              expires_in: 7200
            })
          );
        }

        if (url.includes("/cgi-bin/draft/add")) {
          const body = JSON.parse(String(init?.body));
          assert.equal(body.articles[0].thumb_media_id, "THUMB_MEDIA_ID_VALUE");
          return new Response(
            JSON.stringify({
              media_id: "DRAFT_MEDIA_ID_VALUE"
            })
          );
        }

        throw new Error(`unexpected URL ${url}`);
      }
    });

    assert.equal(result.status, "success");
    assert.equal(
      result.steps.find((step) => step.name === "real-data-audit")?.status,
      "success"
    );
    assert.equal(result.draftMediaId, "DRAFT_MEDIA_ID_VALUE");
    assert.equal(
      calls.some((url) => /freepublish|mass|sendall|publish/i.test(url)),
      false
    );
    await access(join(temp.outputDir, "real-data-audit.json"));
  } finally {
    await rm(temp.root, { recursive: true, force: true });
  }
});
