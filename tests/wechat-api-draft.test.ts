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
import { forbidWechatPublishApi } from "../src/hooks/forbidWechatPublishApi.js";
import { saveWechatDraftApiWithReport } from "../src/pipeline/saveWechatDraftApi.js";
import type { ArticleMeta, ArticleReviewResult } from "../src/types/article.js";
import type { CoverResult, CoverReviewResult } from "../src/types/cover.js";
import type { TopicFactPack } from "../src/types/factPack.js";
import type { WechatLayoutResult } from "../src/types/layout.js";
import type { WechatApiDraftResult } from "../src/types/wechatApiDraft.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

interface ApiFixtureOverrides {
  articleReviewPassed?: boolean;
  coverReviewPassed?: boolean;
  layoutAllowedNextStage?: boolean;
  sourceReliability?: "high" | "medium" | "low";
}

function articleMetaFixture(): ArticleMeta {
  return {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    wordCount: 1201,
    sourceTopic: "coding agent workflow",
    articleThesis: "编码代理竞争正在转向工作流控制权。",
    usedClaims: [],
    riskControls: [],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function articleReviewFixture(passed: boolean): ArticleReviewResult {
  return {
    passed,
    score: passed ? 98 : 40,
    summary: passed ? "文章通过审核。" : "文章未通过审核。",
    issues: [],
    requiredFixes: passed ? [] : ["修正事实边界。"],
    optionalSuggestions: [],
    factBoundaryCheck: {
      passed,
      violations: passed ? [] : ["fact boundary failed"]
    },
    qualityCheck: {
      wordCountOk: true,
      hasTitle: true,
      hasHeadings: true,
      thirdPersonPerspective: true,
      notNewsRelease: true,
      themesCovered: ["开源", "工作流", "成本"]
    },
    finalVerdict: passed ? "允许进入下一阶段。" : "阻止进入下一阶段。",
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function coverFixture(imagePath: string): CoverResult {
  return {
    provider: "apimart",
    mode: "mock",
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    coverText: "AI 编码代理\n卷向工作流",
    imagePrompt: "Mock cover prompt.",
    negativePrompt: "No real brand marks.",
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

function coverReviewFixture(imagePath: string, passed: boolean): CoverReviewResult {
  return {
    provider: "apimart",
    mode: "mock",
    imageSize: "900x383",
    imagePath,
    passed,
    issues: passed ? [] : ["cover review failed"],
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
      embeddedReviewPassed: passed
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function wechatLayoutFixture(
  imagePath: string,
  allowedNextStage: boolean
): WechatLayoutResult {
  return {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    digest: "编码代理的主战场正在从模型能力转向工作流控制权。",
    htmlPath: "outputs/wechat.html",
    coverImagePath: imagePath,
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
    allowedNextStage
  };
}

function topicFactPackFixture(
  sourceReliability: "high" | "medium" | "low"
): TopicFactPack {
  return {
    topicTitle: "AI 编码代理真正卷到的，不是价格，而是工作流",
    generatedAt: "2026-05-29T00:00:00.000Z",
    sourceReliability,
    verifiedClaims: [],
    comparison: {
      claudeCode: {
        pricing: "",
        positioning: "",
        capabilities: [],
        sourceUrls: []
      },
      goose: {
        pricing: "",
        positioning: "",
        capabilities: [],
        sourceUrls: []
      },
      similarities: [],
      differences: [],
      unsafeComparisonClaims: []
    },
    safeWritingBoundary: [],
    riskNotes: [],
    recommendedFraming: "",
    articleAngleSuggestions: []
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeApiFixture(
  outputDir: string,
  overrides: ApiFixtureOverrides = {}
): Promise<void> {
  const articleReviewPassed = overrides.articleReviewPassed ?? true;
  const coverReviewPassed = overrides.coverReviewPassed ?? true;
  const layoutAllowedNextStage = overrides.layoutAllowedNextStage ?? true;
  const sourceReliability = overrides.sourceReliability ?? "medium";
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
  await writeJson(join(outputDir, "article-meta.json"), articleMetaFixture());
  await writeJson(
    join(outputDir, "article-review.json"),
    articleReviewFixture(articleReviewPassed)
  );
  await writeFile(coverPath, "<svg />\n", "utf8");
  await writeJson(join(outputDir, "cover.json"), coverFixture(coverPath));
  await writeJson(
    join(outputDir, "cover-review.json"),
    coverReviewFixture(coverPath, coverReviewPassed)
  );
  await writeFile(
    join(outputDir, "wechat.html"),
    '<section style="font-size:16px;line-height:1.78;"><h1>AI 编码代理真正卷到的，不是价格，而是工作流</h1><p>正文 HTML。</p></section>',
    "utf8"
  );
  await writeJson(
    join(outputDir, "wechat-layout.json"),
    wechatLayoutFixture(coverPath, layoutAllowedNextStage)
  );
  await writeFile(join(outputDir, "wechat-layout-report.md"), "layout ok\n", "utf8");
  await writeJson(
    join(outputDir, "topic-fact-pack.json"),
    topicFactPackFixture(sourceReliability)
  );
}

function realEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    WECHAT_API_ENABLE_REAL_DRAFT: "true",
    WECHAT_DRAFT_ALLOW_REAL_API: "true",
    WECHAT_DRAFT_DRY_RUN: "false",
    WECHAT_APP_ID: "APP_ID_VALUE",
    WECHAT_APP_SECRET: "APP_SECRET_VALUE",
    WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
    WECHAT_FORBID_PUBLISH: "true",
    WECHAT_FORBID_MASS_SEND: "true",
    ...overrides
  };
}

test("dry-run does not call real WeChat API and writes preview outputs", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-dry-run-"));

  try {
    await writeApiFixture(outputDir);

    const result = await saveWechatDraftApiWithReport({
      outputDir,
      logger: silentLogger,
      env: {
        WECHAT_DRAFT_DRY_RUN: "true",
        WECHAT_API_ENABLE_REAL_DRAFT: "false",
        WECHAT_DRAFT_ALLOW_REAL_API: "false"
      },
      fetchImpl: async () => {
        throw new Error("fetch should not be called in dry-run");
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await access(join(outputDir, "wechat-api-draft-result.json"));
    await access(join(outputDir, "wechat-api-draft-report.md"));
    await access(join(outputDir, "wechat-api-preflight.json"));

    const saved = JSON.parse(
      await readFile(result.files.wechatApiDraftResult, "utf8")
    ) as WechatApiDraftResult;
    const report = await readFile(result.files.wechatApiDraftReport, "utf8");

    assert.equal(saved.mode, "api_dry_run");
    assert.equal(saved.status, "request_preview_generated");
    assert.equal(saved.safety.publishApiCalled, false);
    assert.equal(saved.safety.massSendApiCalled, false);
    assert.equal(saved.safety.requiresHumanConfirmation, true);
    assert.match(report, /第 9C 阶段/);
    assert.match(report, /不调用发布接口/);
    assert.match(report, /不调用群发接口/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("real mode blocks when WECHAT_APP_ID is missing", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-no-appid-"));

  try {
    await writeApiFixture(outputDir);
    await assert.rejects(
      () =>
        saveWechatDraftApiWithReport({
          outputDir,
          logger: silentLogger,
          env: realEnv({ WECHAT_APP_ID: "" })
        }),
      /WECHAT_APP_ID is required/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("real mode blocks when WECHAT_APP_SECRET is missing", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-no-secret-"));

  try {
    await writeApiFixture(outputDir);
    await assert.rejects(
      () =>
        saveWechatDraftApiWithReport({
          outputDir,
          logger: silentLogger,
          env: realEnv({ WECHAT_APP_SECRET: "" })
        }),
      /WECHAT_APP_SECRET is required/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("preflight blocks failed article review, failed cover review, and disallowed layout", async () => {
  const cases: Array<[string, ApiFixtureOverrides, RegExp]> = [
    ["article", { articleReviewPassed: false }, /article-review\.json passed/],
    ["cover", { coverReviewPassed: false }, /cover-review\.json passed/],
    ["layout", { layoutAllowedNextStage: false }, /allowedNextStage/]
  ];

  for (const [name, overrides, message] of cases) {
    const outputDir = await mkdtemp(join(tmpdir(), `wechat-api-${name}-blocked-`));

    try {
      await writeApiFixture(outputDir, overrides);
      await assert.rejects(
        () =>
          saveWechatDraftApiWithReport({
            outputDir,
            logger: silentLogger,
            env: realEnv()
          }),
        message
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});

test("sourceReliability=low blocks draft creation", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-low-source-"));

  try {
    await writeApiFixture(outputDir, { sourceReliability: "low" });
    await assert.rejects(
      () =>
        saveWechatDraftApiWithReport({
          outputDir,
          logger: silentLogger,
          env: realEnv()
        }),
      /sourceReliability=low/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("mock SVG cover blocks real mode when no thumb media id is provided", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-mock-svg-"));

  try {
    await writeApiFixture(outputDir);
    await assert.rejects(
      () =>
        saveWechatDraftApiWithReport({
          outputDir,
          logger: silentLogger,
          env: realEnv({ WECHAT_COVER_MEDIA_ID: "" })
        }),
      /Mock SVG cover blocks real WeChat draft creation/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("WECHAT_COVER_MEDIA_ID skips cover upload and creates only a draft", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-real-env-thumb-"));
  const calls: string[] = [];

  try {
    await writeApiFixture(outputDir);

    const result = await saveWechatDraftApiWithReport({
      outputDir,
      lockDir: join(outputDir, "locks"),
      logger: silentLogger,
      env: realEnv(),
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes("/cgi-bin/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ACCESS_TOKEN_VALUE",
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
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.result.mode, "real_api");
    assert.equal(result.result.status, "draft_created");
    assert.equal(result.result.safety.publishApiCalled, false);
    assert.equal(result.result.safety.massSendApiCalled, false);
    assert.equal(result.result.safety.requiresHumanConfirmation, true);
    assert.equal(
      calls.some((url) => url.includes("/cgi-bin/material/add_material")),
      false
    );
    assert.equal(
      calls.some((url) => /freepublish|mass|sendall|publish/i.test(url)),
      false
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("secrets and access token values are not written to API draft outputs", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-no-secret-output-"));

  try {
    await writeApiFixture(outputDir);

    const result = await saveWechatDraftApiWithReport({
      outputDir,
      lockDir: join(outputDir, "locks"),
      logger: silentLogger,
      env: realEnv({
        WECHAT_APP_SECRET: "SUPER_SECRET_SHOULD_NOT_APPEAR"
      }),
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes("/cgi-bin/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ACCESS_TOKEN_SHOULD_NOT_APPEAR",
              expires_in: 7200
            })
          );
        }

        return new Response(
          JSON.stringify({
            media_id: "DRAFT_MEDIA_ID_VALUE"
          })
        );
      }
    });
    const outputText = [
      await readFile(result.files.wechatApiDraftResult, "utf8"),
      await readFile(result.files.wechatApiDraftReport, "utf8"),
      await readFile(result.files.wechatApiPreflight, "utf8")
    ].join("\n");

    assert.doesNotMatch(outputText, /SUPER_SECRET_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(outputText, /ACCESS_TOKEN_SHOULD_NOT_APPEAR/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("same-day real draft lock blocks duplicate creation by default", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-lock-"));
  const lockDir = join(outputDir, "locks");
  let calls = 0;

  const fetchImpl = async (input: string | URL) => {
    calls += 1;
    const url = String(input);

    if (url.includes("/cgi-bin/token")) {
      return new Response(
        JSON.stringify({
          access_token: "ACCESS_TOKEN_VALUE",
          expires_in: 7200
        })
      );
    }

    if (url.includes("/cgi-bin/draft/add")) {
      return new Response(
        JSON.stringify({
          media_id: `DRAFT_MEDIA_ID_${calls}`
        })
      );
    }

    throw new Error(`unexpected URL ${url}`);
  };

  try {
    await writeApiFixture(outputDir);

    await saveWechatDraftApiWithReport({
      outputDir,
      lockDir,
      logger: silentLogger,
      env: realEnv(),
      fetchImpl,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    const callsAfterFirstDraft = calls;

    await assert.rejects(
      () =>
        saveWechatDraftApiWithReport({
          outputDir,
          lockDir,
          logger: silentLogger,
          env: realEnv(),
          fetchImpl,
          now: new Date("2026-05-29T12:00:00.000Z")
        }),
      /A real WeChat draft was already created on 2026-05-29 .* Use --force to override\./
    );
    assert.equal(calls, callsAfterFirstDraft);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("--force overrides the same-day real draft lock", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-api-force-lock-"));
  const lockDir = join(outputDir, "locks");
  let draftAdds = 0;

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);

    if (url.includes("/cgi-bin/token")) {
      return new Response(
        JSON.stringify({
          access_token: "ACCESS_TOKEN_VALUE",
          expires_in: 7200
        })
      );
    }

    if (url.includes("/cgi-bin/draft/add")) {
      draftAdds += 1;
      return new Response(
        JSON.stringify({
          media_id: `DRAFT_MEDIA_ID_${draftAdds}`
        })
      );
    }

    throw new Error(`unexpected URL ${url}`);
  };

  try {
    await writeApiFixture(outputDir);

    await saveWechatDraftApiWithReport({
      outputDir,
      lockDir,
      logger: silentLogger,
      env: realEnv(),
      fetchImpl,
      now: new Date("2026-05-29T00:00:00.000Z")
    });
    const forced = await saveWechatDraftApiWithReport({
      outputDir,
      lockDir,
      logger: silentLogger,
      env: realEnv(),
      fetchImpl,
      now: new Date("2026-05-29T12:00:00.000Z"),
      force: true
    });

    assert.equal(forced.result.mode, "real_api");
    assert.equal(draftAdds, 2);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("forbidWechatPublishApi blocks publish and mass-send operations but allows draft add", () => {
  assert.throws(
    () =>
      forbidWechatPublishApi({
        url: ["/cgi-bin/free", "publish/submit"].join("")
      }),
    /Forbidden WeChat publish API operation/
  );
  assert.throws(
    () =>
      forbidWechatPublishApi({
        url: `/cgi-bin/message/${"mass"}/send`
      }),
    /Forbidden WeChat publish API operation/
  );
  assert.throws(
    () =>
      forbidWechatPublishApi({
        actionName: "publish action"
      }),
    /Forbidden WeChat publish API operation/
  );
  assert.doesNotThrow(() =>
    forbidWechatPublishApi({
      url: "/cgi-bin/draft/add",
      actionName: "创建草稿"
    })
  );
});

test("local environment files are gitignored while .env.example stays trackable", async () => {
  const gitignore = await readFile(join(process.cwd(), ".gitignore"), "utf8");

  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(gitignore, /^\.local\/$/m);
});

test("WeChat credentials are not exposed through frontend public env names", async () => {
  const files = [
    ".env.example",
    "package.json",
    "scripts/dry-run.ts",
    "scripts/push-wechat-draft.ts",
    "src/pipeline/saveWechatDraftApi.ts",
    "src/adapters/wechatOfficialApi.ts"
  ];
  const combined = (
    await Promise.all(
      files.map((file) => readFile(join(process.cwd(), file), "utf8"))
    )
  ).join("\n");

  assert.doesNotMatch(
    combined,
    /(?:NEXT_PUBLIC|VITE|PUBLIC)_WECHAT_(?:APP_ID|APP_SECRET|COVER_MEDIA_ID|COVER_IMAGE_PATH)/
  );
  assert.doesNotMatch(combined, /import\.meta\.env\.(?:NEXT_PUBLIC|VITE|PUBLIC)_WECHAT/);
});
