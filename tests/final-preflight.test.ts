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
import { runFinalPreflight } from "../src/pipeline/finalPreflight.js";
import { writeWechatDraftRunLock } from "../src/pipeline/wechatDraftRunLock.js";

const SAME_DAY_LOCK_BLOCKED_MESSAGE =
  "same-day real draft lock exists: a real draft was already created today.";
const SAME_DAY_LOCK_CLEAR_MESSAGE = "same-day real draft lock is clear.";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFinalPreflightFixture(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeJson(join(outputDir, "article-review.json"), {
    passed: true,
    llm: {
      provider: "minimax",
      model: "minimax-m3-test",
      mode: "mock",
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null
      }
    }
  });
  await writeJson(join(outputDir, "article-meta.json"), {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    wordCount: 42,
    sourceTopic: "source",
    articleThesis: "thesis",
    usedClaims: [],
    riskControls: [],
    generatedAt: "2026-05-29T00:00:00.000Z",
    llm: {
      provider: "minimax",
      model: "minimax-m3-test",
      mode: "mock",
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null
      }
    }
  });
  await writeJson(join(outputDir, "title-candidates.json"), {
    generatedAt: "2026-05-29T00:00:00.000Z",
    selectedTitle: "AI 编码代理真正卷到的，不是价格，而是工作流",
    selectedKind: "judgement",
    candidates: [],
    forbiddenTerms: [],
    llm: {
      provider: "minimax",
      model: "minimax-m3-test",
      mode: "mock",
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null
      }
    }
  });
  await writeJson(join(outputDir, "cover-review.json"), {
    passed: true
  });
  await writeJson(join(outputDir, "wechat-layout.json"), {
    allowedNextStage: true
  });
  await writeJson(join(outputDir, "wechat-api-preflight.json"), {
    mode: "api_dry_run",
    dryRun: true,
    passed: true,
    publishApiCalled: false,
    massSendApiCalled: false
  });
  await writeJson(join(outputDir, "wechat-api-draft-result.json"), {
    mode: "api_dry_run",
    status: "request_preview_generated",
    requestPreview: {
      endpoint: "/cgi-bin/draft/add",
      title: "AI 编码代理真正卷到的，不是价格，而是工作流",
      hasContent: true,
      hasThumbMediaId: true,
      contentLength: 42
    },
    safety: {
      draftOnly: true,
      publishApiCalled: false,
      massSendApiCalled: false,
      requiresHumanConfirmation: true
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  });
  await writeFile(
    join(outputDir, "wechat.html"),
    '<section style="font-size:16px;"><h1>AI 工作流</h1><p>正文 HTML。</p></section>',
    "utf8"
  );
}

async function writeProductionPreflightFixture(
  outputDir: string,
  options: {
    coverMode?: "real" | "mock";
    coverFileName?: string;
  } = {}
): Promise<void> {
  await writeFinalPreflightFixture(outputDir);

  const coverMode = options.coverMode ?? "real";
  const coverFileName = options.coverFileName ?? "cover.png";
  const coverDir = join(outputDir, "covers");
  const coverPath = join(coverDir, coverFileName);

  await mkdir(coverDir, { recursive: true });
  await writeFile(coverPath, coverFileName.endsWith(".svg") ? "<svg />\n" : "png\n", "utf8");
  await writeJson(join(outputDir, "cover.json"), {
    provider: "apimart",
    mode: coverMode,
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    coverText: "AI 编码代理\n卷向工作流",
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
    mode: coverMode,
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
  await writeJson(join(outputDir, "real-data-audit.json"), {
    passed: true,
    realProductionMode: true,
    generatedAt: "2026-05-29T00:00:00.000Z",
    outputDir,
    checks: [],
    issues: [],
    warnings: [],
    summary: {
      candidateCount: 1,
      shortlistedCount: 1,
      realRssCandidateCount: 1,
      realTavilyCandidateCount: 0,
      realExaCandidateCount: 0,
      mockCandidateCount: 0,
      mockShortlistedCount: 0,
      mockSearchCandidateCount: 0,
      mockRssCandidateCount: 0,
      mockFallbackDetected: false,
      coverMode,
      coverImagePath: coverPath
    },
    files: {
      result: join(outputDir, "real-data-audit.json"),
      report: join(outputDir, "real-data-audit-report.md")
    }
  });
  await writeJson(join(outputDir, "article-meta.json"), {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    wordCount: 42,
    sourceTopic: "source",
    articleThesis: "thesis",
    usedClaims: [],
    riskControls: [],
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
    selectedTitle: "AI 编码代理真正卷到的，不是价格，而是工作流",
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
}

test("final preflight passes when all real-draft prerequisites are satisfied", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-pass-"));

  try {
    await writeFinalPreflightFixture(outputDir);

    const result = await runFinalPreflight({
      outputDir,
      lockDir: join(outputDir, "locks"),
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
        WECHAT_APP_SECRET: "SUPER_SECRET_SHOULD_NOT_APPEAR"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.passed, true);
    await access(join(outputDir, "final-preflight.json"));
    await access(join(outputDir, "final-preflight-report.md"));

    const outputText = [
      await readFile(join(outputDir, "final-preflight.json"), "utf8"),
      await readFile(join(outputDir, "final-preflight-report.md"), "utf8")
    ].join("\n");

    assert.doesNotMatch(outputText, /SUPER_SECRET_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(outputText, /access_token\s*[:=]/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("same-day draft lock preflight passes when no lock exists", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-no-lock-"));

  try {
    await writeFinalPreflightFixture(outputDir);

    const result = await runFinalPreflight({
      outputDir,
      lockDir: join(outputDir, "locks"),
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });
    const lockCheck = result.checks.find(
      (check) => check.name === "same-day real draft lock"
    );
    const report = await readFile(join(outputDir, "final-preflight-report.md"), "utf8");

    assert.equal(result.passed, true);
    assert.equal(lockCheck?.passed, true);
    assert.equal(lockCheck?.message, SAME_DAY_LOCK_CLEAR_MESSAGE);
    assert.match(report, /same-day real draft lock is clear\./);
    assert.doesNotMatch(report, /No same-day real draft lock exists/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("same-day draft lock blocks final preflight without force", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-lock-blocked-"));
  const lockDir = join(outputDir, "locks");

  try {
    await writeFinalPreflightFixture(outputDir);
    await writeWechatDraftRunLock({
      lockDir,
      mediaId: "DRAFT_MEDIA_ID_VALUE",
      title: "AI 编码代理真正卷到的，不是价格，而是工作流",
      now: new Date("2026-05-29T08:00:00.000Z")
    });

    const result = await runFinalPreflight({
      outputDir,
      lockDir,
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
      },
      now: new Date("2026-05-29T12:00:00.000Z")
    });
    const lockCheck = result.checks.find(
      (check) => check.name === "same-day real draft lock"
    );
    const report = await readFile(join(outputDir, "final-preflight-report.md"), "utf8");
    const expectedIssue = `same-day real draft lock: ${SAME_DAY_LOCK_BLOCKED_MESSAGE}`;

    assert.equal(result.passed, false);
    assert.equal(lockCheck?.passed, false);
    assert.equal(lockCheck?.message, SAME_DAY_LOCK_BLOCKED_MESSAGE);
    assert.deepEqual(result.issues, [expectedIssue]);
    assert.match(
      report,
      /## Blocking Issues\n\n- same-day real draft lock: same-day real draft lock exists: a real draft was already created today\./
    );
    assert.doesNotMatch(report, /No same-day real draft lock exists/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("--force lets final preflight pass with a same-day draft lock", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-lock-force-"));
  const lockDir = join(outputDir, "locks");

  try {
    await writeFinalPreflightFixture(outputDir);
    await writeWechatDraftRunLock({
      lockDir,
      mediaId: "DRAFT_MEDIA_ID_VALUE",
      title: "AI 编码代理真正卷到的，不是价格，而是工作流",
      now: new Date("2026-05-29T08:00:00.000Z")
    });

    const result = await runFinalPreflight({
      outputDir,
      lockDir,
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
      },
      now: new Date("2026-05-29T12:00:00.000Z"),
      force: true
    });
    const lockCheck = result.checks.find(
      (check) => check.name === "same-day real draft lock"
    );
    const report = await readFile(join(outputDir, "final-preflight-report.md"), "utf8");

    assert.equal(result.passed, true);
    assert.equal(lockCheck?.passed, true);
    assert.equal(
      lockCheck?.message,
      "Existing same-day lock is being overridden by --force."
    );
    assert.match(report, /Existing same-day lock is being overridden by --force\./);
    assert.doesNotMatch(report, /No same-day real draft lock exists/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("final preflight reports blocking conditions", async () => {
  const cases: Array<{
    name: string;
    mutate: (outputDir: string) => Promise<void>;
    env?: NodeJS.ProcessEnv;
    issue: RegExp;
  }> = [
    {
      name: "missing-cover-media-id",
      mutate: async () => undefined,
      env: {},
      issue: /cover media id present/
    },
    {
      name: "failed-article-review",
      mutate: async (outputDir) =>
        writeJson(join(outputDir, "article-review.json"), { passed: false }),
      issue: /article-review passed/
    },
    {
      name: "local-image-path",
      mutate: async (outputDir) =>
        writeFile(
          join(outputDir, "wechat.html"),
          '<section><img src="outputs/covers/cover.png"></section>',
          "utf8"
        ),
      issue: /local image paths/
    },
    {
      name: "forbidden-html-term",
      mutate: async (outputDir) =>
        writeFile(join(outputDir, "wechat.html"), "<section>立即发送</section>", "utf8"),
      issue: /forbidden terms/
    },
    {
      name: "dangerous-api-endpoint",
      mutate: async (outputDir) =>
        writeJson(join(outputDir, "wechat-api-draft-result.json"), {
          mode: "api_dry_run",
          status: "request_preview_generated",
          requestPreview: {
            endpoint: "/cgi-bin/freepublish/submit",
            title: "title",
            hasContent: true,
            hasThumbMediaId: true,
            contentLength: 42
          },
          safety: {
            draftOnly: true,
            publishApiCalled: false,
            massSendApiCalled: false,
            requiresHumanConfirmation: true
          },
          generatedAt: "2026-05-29T00:00:00.000Z"
        }),
      issue: /draft-only/
    },
    {
      name: "secret-output",
      mutate: async (outputDir) =>
        writeFile(join(outputDir, "article.md"), "SUPER_SECRET_VALUE\n", "utf8"),
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
        WECHAT_APP_SECRET: "SUPER_SECRET_VALUE"
      },
      issue: /outputs contain no secrets/
    },
    {
      name: "minimax-secret-output",
      mutate: async (outputDir) =>
        writeFile(join(outputDir, "article.md"), "MINIMAX_SECRET_VALUE\n", "utf8"),
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
        MINIMAX_API_KEY: "MINIMAX_SECRET_VALUE"
      },
      issue: /outputs contain no secrets/
    }
  ];

  for (const item of cases) {
    const outputDir = await mkdtemp(join(tmpdir(), `final-preflight-${item.name}-`));

    try {
      await writeFinalPreflightFixture(outputDir);
      await item.mutate(outputDir);

      const result = await runFinalPreflight({
        outputDir,
        lockDir: join(outputDir, "locks"),
        env: item.env ?? {
          WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
        },
        now: new Date("2026-05-29T00:00:00.000Z")
      });

      assert.equal(result.passed, false, item.name);
      assert.match(result.issues.join("\n"), item.issue, item.name);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});

test("REAL_PRODUCTION_MODE=true blocks mock cover mode in final preflight", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-prod-mock-cover-"));

  try {
    await writeProductionPreflightFixture(outputDir, {
      coverMode: "mock",
      coverFileName: "cover.png"
    });

    const result = await runFinalPreflight({
      outputDir,
      lockDir: join(outputDir, "locks"),
      env: {
        REAL_PRODUCTION_MODE: "true",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        LLM_PROVIDER: "minimax",
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /production cover mode is real/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("REAL_PRODUCTION_MODE=true blocks svg cover imagePath in final preflight", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-prod-svg-cover-"));

  try {
    await writeProductionPreflightFixture(outputDir, {
      coverMode: "real",
      coverFileName: "cover.svg"
    });

    const result = await runFinalPreflight({
      outputDir,
      lockDir: join(outputDir, "locks"),
      env: {
        REAL_PRODUCTION_MODE: "true",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        LLM_PROVIDER: "minimax",
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /production cover image is jpg or png|mock svg/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("REAL_PRODUCTION_MODE=true blocks mock article LLM mode in final preflight", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-prod-mock-llm-"));

  try {
    await writeProductionPreflightFixture(outputDir);
    await writeJson(join(outputDir, "article-meta.json"), {
      title: "AI 编码代理真正卷到的，不是价格，而是工作流",
      wordCount: 42,
      sourceTopic: "source",
      articleThesis: "thesis",
      usedClaims: [],
      riskControls: [],
      generatedAt: "2026-05-29T00:00:00.000Z",
      llm: {
        provider: "minimax",
        model: "minimax-m3-test",
        mode: "mock",
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null
        }
      }
    });

    const result = await runFinalPreflight({
      outputDir,
      lockDir: join(outputDir, "locks"),
      env: {
        REAL_PRODUCTION_MODE: "true",
        LLM_ENABLE_REAL_API: "true",
        LLM_DRY_RUN: "false",
        LLM_PROVIDER: "minimax",
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.passed, false);
    assert.match(result.issues.join("\n"), /production article writer llm is real/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
